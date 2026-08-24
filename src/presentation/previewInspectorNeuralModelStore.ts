/** Persists the anonymous Page Inspector neural model once per local VS Code profile. */
import type * as vscode from 'vscode';
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
  private pending: Promise<void> = Promise.resolve();
  private requiresPersistence = false;

  /** Retains the VS Code state adapter and diagnostic surface without reading eagerly. */
  public constructor(
    private readonly state: PreviewInspectorNeuralModelState,
    private readonly log: Pick<vscode.LogOutputChannel, 'debug'>,
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
    const current = this.model ?? this.readPersistedModel();
    const merged = mergePreviewInspectorNeuralModels(current, incoming);
    this.model = merged;
    if (!this.requiresPersistence && JSON.stringify(current) === JSON.stringify(merged)) {
      return merged;
    }
    try {
      await this.state.update(PREVIEW_INSPECTOR_NEURAL_MODEL_STATE_KEY, merged);
      this.requiresPersistence = false;
    } catch (error) {
      this.requiresPersistence = true;
      this.log.debug('Could not persist the shared React Inspector neural model.', error);
    }
    return merged;
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
