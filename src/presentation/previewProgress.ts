/**
 * Converts framework-neutral preparation stages into immutable, user-facing progress snapshots.
 * The presentation layer owns wording and ordering, while compiler and application code report only
 * stable stage identities. No elapsed-time percentage is invented from these discrete milestones.
 */
import {
  PREVIEW_PROGRESS_MESSAGE_TYPE,
  type PreviewProgressStage,
} from '../domain/previewProgress';

/** One visible preparation step with concise and explanatory text. */
export interface PreviewProgressStep {
  /** Supporting explanation shown below the active step. */
  readonly detail: string;
  /** Short step title suitable for full-screen and compact status views. */
  readonly label: string;
  /** Stable lifecycle identity emitted by the build pipeline. */
  readonly stage: Exclude<PreviewProgressStage, 'ready'>;
}

/** Complete presentation snapshot derived from one reported lifecycle stage. */
export interface PreviewProgressSnapshot {
  /** Whether the progress UI should be removed instead of updated. */
  readonly complete: boolean;
  /** Supporting text for the currently active operation. */
  readonly detail: string;
  /** Short active operation label. */
  readonly label: string;
  /** One-based completed/current milestone position. */
  readonly step: number;
  /** Original stage retained for diagnostics and deterministic tests. */
  readonly stage: PreviewProgressStage;
  /** Fixed number of visible preparation milestones. */
  readonly total: number;
}

/** Ordered steps shared by complete loading documents and retained hot-reload overlays. */
export const PREVIEW_PROGRESS_STEPS: readonly PreviewProgressStep[] = Object.freeze([
  Object.freeze({
    detail: 'Reading the latest snapshot of the pinned editor file.',
    label: 'Resolving target file',
    stage: 'resolving-target',
  }),
  Object.freeze({
    detail: 'Locating the project boundary, configuration, and React exports.',
    label: 'Analyzing project structure',
    stage: 'analyzing-project',
  }),
  Object.freeze({
    detail: 'Finding component usage, styles, props, and application render paths.',
    label: 'Discovering component context',
    stage: 'discovering-components',
  }),
  Object.freeze({
    detail: 'Composing browser-safe globals, providers, themes, and static values.',
    label: 'Preparing preview runtime',
    stage: 'preparing-runtime',
  }),
  Object.freeze({
    detail: 'Building only the reachable browser modules without starting a server.',
    label: 'Bundling reachable modules',
    stage: 'bundling-modules',
  }),
  Object.freeze({
    detail: 'Restoring exact lockfile packages into verified extension storage.',
    label: 'Acquiring missing dependencies',
    stage: 'acquiring-dependencies',
  }),
  Object.freeze({
    detail: 'Writing cache-busted JavaScript and CSS into VS Code storage.',
    label: 'Publishing local artifacts',
    stage: 'publishing-artifacts',
  }),
  Object.freeze({
    detail: 'Applying styles and mounting the selected React components.',
    label: 'Loading preview',
    stage: 'loading-preview',
  }),
]);

/**
 * Creates a deterministic UI snapshot for a build stage.
 *
 * @param stage Latest lifecycle milestone accepted by the owning session revision.
 * @returns Frozen text and position data safe to serialize into a webview message.
 */
export function createPreviewProgressSnapshot(
  stage: PreviewProgressStage,
): PreviewProgressSnapshot {
  if (stage === 'ready') {
    return Object.freeze({
      complete: true,
      detail: 'The latest preview revision is ready.',
      label: 'Preview ready',
      stage,
      step: PREVIEW_PROGRESS_STEPS.length,
      total: PREVIEW_PROGRESS_STEPS.length,
    });
  }
  const stepIndex = PREVIEW_PROGRESS_STEPS.findIndex((step) => step.stage === stage);
  const step = PREVIEW_PROGRESS_STEPS[stepIndex];
  if (step === undefined) {
    throw new TypeError(`Unknown preview progress stage: ${stage}`);
  }
  return Object.freeze({
    complete: false,
    detail: step.detail,
    label: step.label,
    stage,
    step: stepIndex + 1,
    total: PREVIEW_PROGRESS_STEPS.length,
  });
}

/**
 * Adds the revision and protocol discriminator required by the retained browser runtime.
 *
 * @param stage Current lifecycle milestone.
 * @param revision Monotonic session-local revision used to reject stale messages.
 * @returns Frozen structured-clone-safe extension-to-webview message.
 */
export function createPreviewProgressMessage(
  stage: PreviewProgressStage,
  revision: number,
): PreviewProgressSnapshot & {
  readonly revision: number;
  readonly type: typeof PREVIEW_PROGRESS_MESSAGE_TYPE;
} {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError('Preview progress revision must be a non-negative safe integer.');
  }
  return Object.freeze({
    ...createPreviewProgressSnapshot(stage),
    revision,
    type: PREVIEW_PROGRESS_MESSAGE_TYPE,
  });
}
