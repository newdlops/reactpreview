/**
 * Pre-trains the Page Inspector's profile neural model by previewing real pages headlessly and
 * carrying the model from page to page, the way live panels share it through the extension host.
 *
 * This is developer tooling for `scripts/pretrain-page-inspector-neural.mjs`; it never runs inside
 * the extension. Pages are visited in round-robin chunks per workspace so the model does not drift
 * towards whichever project comes last. The result is an import document holding the starting
 * model and the trained model; the extension adds only their difference to the live profile model
 * (see `previewInspectorNeuralModelImport.ts`), and both models contain only bounded weights and
 * anonymous counters, never source, paths, or runtime values.
 */
import { createHash } from 'node:crypto';
import {
  mergePreviewInspectorNeuralModels,
  type PreviewInspectorNeuralModel,
} from '../../presentation/previewInspectorNeuralModelProtocol';
import {
  applyPreviewInspectorNeuralModelImport,
  PREVIEW_INSPECTOR_NEURAL_MODEL_IMPORT_FORMAT,
} from '../../presentation/previewInspectorNeuralModelImport';

/** One project and the page files previewed from it. */
export interface PreviewNeuralPretrainingWorkspace {
  readonly name: string;
  /** Page paths relative to `root`. */
  readonly pages: readonly string[];
  /** Workspace root passed to the compiler. */
  readonly root: string;
}

/** Outcome of previewing one page while training. */
export interface PreviewNeuralPretrainingPageResult {
  /** Model after the page, or `undefined` when the page produced none (build or protocol failure). */
  readonly model?: PreviewInspectorNeuralModel;
  /** Compact status for the progress log, such as `ready/partial-blocked` or `build-failed`. */
  readonly status: string;
}

/** One progress log row. */
export interface PreviewNeuralPretrainingRow {
  readonly durationMs: number;
  /** Head updates the page added, by head. */
  readonly learned: Readonly<Record<string, number>>;
  readonly page: string;
  readonly status: string;
  readonly workspace: string;
}

/** Inputs of one pre-training run. */
export interface PreviewNeuralPretrainingOptions {
  /** Model to continue from: a copy of the profile model, or an earlier checkpoint. */
  readonly base: PreviewInspectorNeuralModel;
  /** Pages per workspace before the next workspace takes a turn. */
  readonly chunkSize: number;
  /** Waits before each page until the machine has capacity for it (the resource governor). */
  readonly beforePage?: () => Promise<unknown>;
  /** Page keys (`<workspace>:<page>`) already trained by a resumed run. */
  readonly completed?: ReadonlySet<string>;
  /**
   * Statuses caused by a starved machine rather than the page. Such a page that produced no model
   * is not recorded; it is retried once after every other page.
   */
  readonly isRetryable?: (status: string) => boolean;
  /** Reports an attempt that will be retried; it is not part of the progress log. */
  readonly onRetry?: (row: PreviewNeuralPretrainingRow) => Promise<void> | void;
  /** Called after every page with its row and the model checkpoint. */
  readonly onPage?: (
    row: PreviewNeuralPretrainingRow,
    model: PreviewInspectorNeuralModel,
  ) => Promise<void> | void;
  /** Previews one page starting from `model`. */
  readonly previewPage: (
    workspace: PreviewNeuralPretrainingWorkspace,
    page: string,
    model: PreviewInspectorNeuralModel,
  ) => Promise<PreviewNeuralPretrainingPageResult>;
  readonly workspaces: readonly PreviewNeuralPretrainingWorkspace[];
}

/**
 * Visits every page once, in round-robin chunks, and returns the trained model.
 *
 * @param options Pages, starting model, and the page preview implementation.
 * @returns The model after the last page.
 */
export async function runPreviewNeuralPretraining(
  options: PreviewNeuralPretrainingOptions,
): Promise<PreviewInspectorNeuralModel> {
  let model = options.base;
  const queue = schedulePreviewNeuralPretraining(options.workspaces, options.chunkSize).filter(
    ({ page, workspace }) => options.completed?.has(`${workspace.name}:${page}`) !== true,
  );
  const retried = new Set<string>();
  // Iterating the live array also visits retries appended below.
  for (const entry of queue) {
    const { page, workspace } = entry;
    await options.beforePage?.();
    const started = Date.now();
    let result: PreviewNeuralPretrainingPageResult;
    try {
      result = await options.previewPage(workspace, page, model);
    } catch (error) {
      result = { status: `error:${error instanceof Error ? error.name : 'unknown'}` };
    }
    const next =
      result.model === undefined ? model : mergePreviewInspectorNeuralModels(model, result.model);
    const row: PreviewNeuralPretrainingRow = {
      durationMs: Date.now() - started,
      learned: readLearnedUpdates(model, next),
      page,
      status: result.status,
      workspace: workspace.name,
    };
    const key = `${workspace.name}:${page}`;
    if (
      result.model === undefined &&
      !retried.has(key) &&
      options.isRetryable?.(result.status) === true
    ) {
      retried.add(key);
      queue.push(entry);
      await options.onRetry?.(row);
      continue;
    }
    model = next;
    await options.onPage?.(row, model);
  }
  return model;
}

/**
 * Orders pages as round-robin chunks per workspace.
 *
 * @param workspaces Workspaces in priority order.
 * @param chunkSize Pages per turn; values below one are treated as one.
 * @returns Every page exactly once.
 */
export function schedulePreviewNeuralPretraining(
  workspaces: readonly PreviewNeuralPretrainingWorkspace[],
  chunkSize: number,
): readonly { readonly page: string; readonly workspace: PreviewNeuralPretrainingWorkspace }[] {
  const size = Math.max(1, Math.floor(chunkSize));
  const schedule: { page: string; workspace: PreviewNeuralPretrainingWorkspace }[] = [];
  const longest = Math.max(0, ...workspaces.map((workspace) => workspace.pages.length));
  for (let offset = 0; offset < longest; offset += size) {
    for (const workspace of workspaces) {
      for (const page of workspace.pages.slice(offset, offset + size)) {
        schedule.push({ page, workspace });
      }
    }
  }
  return schedule;
}

/**
 * Wraps a run's starting and trained models as the document the extension imports.
 *
 * @param base Model the run started from.
 * @param trained Model after the run.
 * @returns Import document; its identifier is derived from the trained model.
 */
export function createPreviewNeuralPretrainingImport(
  base: PreviewInspectorNeuralModel,
  trained: PreviewInspectorNeuralModel,
): Readonly<Record<string, unknown>> {
  const digest = createHash('sha256').update(JSON.stringify(trained)).digest('hex');
  return {
    base,
    format: PREVIEW_INSPECTOR_NEURAL_MODEL_IMPORT_FORMAT,
    id: `pretrain-${digest.slice(0, 12)}`,
    trained,
    version: 1,
  };
}

/**
 * Combines runs that trained different pages in parallel from the same start model by adding each
 * run's difference to the start: `start + Σ(lane − start)`.
 *
 * @param start Model every lane started from.
 * @param lanes Final models of the lanes.
 * @returns The combined model; outcome memories follow the import rules (no displacement).
 */
export function mergePreviewNeuralPretrainingLanes(
  start: PreviewInspectorNeuralModel,
  lanes: readonly PreviewInspectorNeuralModel[],
): PreviewInspectorNeuralModel {
  return lanes.reduce(
    (merged, lane) =>
      applyPreviewInspectorNeuralModelImport(merged, { base: start, id: 'lane', trained: lane }),
    start,
  );
}

/** Counts the head updates that separate two models. */
function readLearnedUpdates(
  before: PreviewInspectorNeuralModel,
  after: PreviewInspectorNeuralModel,
): Readonly<Record<string, number>> {
  const learned: Record<string, number> = {};
  for (const [headKey, head] of Object.entries(after.heads)) {
    const added = head.updates - (before.heads[headKey]?.updates ?? 0);
    if (added > 0) learned[headKey] = added;
  }
  return learned;
}
