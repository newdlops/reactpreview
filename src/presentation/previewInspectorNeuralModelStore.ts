/** Persists the anonymous Page Inspector neural model once per local VS Code profile. */
import type * as vscode from 'vscode';
import {
  applyPreviewInspectorNeuralModelImport,
  type PreviewInspectorNeuralModelImportClaim,
  type PreviewInspectorNeuralModelImportSource,
} from './previewInspectorNeuralModelImport';
import {
  createEmptyPreviewInspectorNeuralModel,
  mergePreviewInspectorNeuralModels,
  readPreviewInspectorNeuralModel,
  type PreviewInspectorNeuralModel,
} from './previewInspectorNeuralModelProtocol';

const PREVIEW_INSPECTOR_NEURAL_MODEL_STATE_KEY = 'reactPreview.neuralResidualModel';

/** Minimal VS Code Memento surface used by the profile-local learner. */
export interface PreviewInspectorNeuralModelState {
  /** Reads one previously persisted structured-clone value. */
  get(key: string): unknown;
  /** Atomically schedules one profile state replacement. */
  update(key: string, value: unknown): Thenable<void>;
}

/** Serializes competing panel updates and returns the strongest merged model to every caller. */
export class PreviewInspectorNeuralModelStore {
  private model: PreviewInspectorNeuralModel | undefined;
  /** Import applied in memory and settled only after the combined model is persisted. */
  private importClaim: PreviewInspectorNeuralModelImportClaim | undefined;
  private pending: Promise<void> = Promise.resolve();
  private requiresPersistence = false;

  /**
   * Retains the VS Code state adapter and diagnostic surface without reading eagerly.
   *
   * @param importSource Storage checked once, on first use, for a pre-training import.
   */
  public constructor(
    private readonly state: PreviewInspectorNeuralModelState,
    private readonly log: Pick<vscode.LogOutputChannel, 'debug' | 'info'>,
    private readonly importSource?: PreviewInspectorNeuralModelImportSource,
  ) {}

  /** Merges one validated webview model into profile state in receive order. */
  public synchronize(incoming: PreviewInspectorNeuralModel): Promise<PreviewInspectorNeuralModel> {
    const task = this.pending.then(() => this.synchronizeNow(incoming));
    this.pending = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  /** Reads, merges, and writes inside the store's serialized promise corridor. */
  private async synchronizeNow(
    incoming: PreviewInspectorNeuralModel,
  ): Promise<PreviewInspectorNeuralModel> {
    const current = await this.readCurrentModel();
    const merged = mergePreviewInspectorNeuralModels(current, incoming);
    this.model = merged;
    if (!this.requiresPersistence && JSON.stringify(current) === JSON.stringify(merged)) {
      return merged;
    }
    try {
      await this.state.update(PREVIEW_INSPECTOR_NEURAL_MODEL_STATE_KEY, merged);
      this.requiresPersistence = false;
      const claim = this.importClaim;
      this.importClaim = undefined;
      await claim?.settle('applied').catch(() => undefined);
    } catch (error) {
      this.requiresPersistence = true;
      this.log.debug('Could not persist the shared React Inspector neural model.', error);
    }
    return merged;
  }

  /**
   * Returns this window's model combined with profile state another window may have stored since,
   * so neither window's learning (nor an applied import) is overwritten by a stale in-memory copy.
   */
  private async readCurrentModel(): Promise<PreviewInspectorNeuralModel> {
    if (this.model === undefined) return this.loadModel();
    try {
      const stored = readPreviewInspectorNeuralModel(
        this.state.get(PREVIEW_INSPECTOR_NEURAL_MODEL_STATE_KEY),
      );
      return stored === undefined
        ? this.model
        : mergePreviewInspectorNeuralModels(this.model, stored);
    } catch {
      return this.model;
    }
  }

  /** Reads the persisted model once and adds a pending pre-training import to it. */
  private async loadModel(): Promise<PreviewInspectorNeuralModel> {
    const persisted = this.readPersistedModel();
    const claim = await this.importSource?.claim().catch(() => undefined);
    if (claim === undefined) return persisted;
    const imported = claim.value;
    try {
      if (imported === undefined) throw new Error('The import document is malformed.');
      await claim.backup(persisted);
    } catch (error) {
      this.log.info('Skipped a React Inspector neural model import.', error);
      await claim.settle('rejected').catch(() => undefined);
      return persisted;
    }
    const model = applyPreviewInspectorNeuralModelImport(persisted, imported);
    this.requiresPersistence = true;
    this.importClaim = claim;
    this.log.info(`Imported pre-trained React Inspector neural model ${imported.id}.`);
    return model;
  }

  /** Falls back to a neutral model when an older extension stored malformed or stale data. */
  private readPersistedModel(): PreviewInspectorNeuralModel {
    try {
      const persisted = this.state.get(PREVIEW_INSPECTOR_NEURAL_MODEL_STATE_KEY);
      const model = readPreviewInspectorNeuralModel(persisted);
      if (model === undefined) return createEmptyPreviewInspectorNeuralModel();
      this.requiresPersistence = JSON.stringify(persisted) !== JSON.stringify(model);
      return model;
    } catch (error) {
      this.log.debug('Could not read the shared React Inspector neural model.', error);
      return createEmptyPreviewInspectorNeuralModel();
    }
  }
}
