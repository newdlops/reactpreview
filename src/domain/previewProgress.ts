/**
 * Defines the framework-neutral preparation stages emitted while one immutable preview revision is
 * resolved, analyzed, bundled, published, and mounted. The model contains no UI strings or VS Code
 * types so compiler, application, and presentation layers can share it without crossing boundaries.
 */

/** Structured-clone message discriminator shared by extension host and generated browser runtime. */
export const PREVIEW_PROGRESS_MESSAGE_TYPE = 'react-preview-progress';

/** Closed protocol vocabulary ordered from target resolution through browser completion. */
export const PREVIEW_PROGRESS_STAGES = Object.freeze([
  'resolving-target',
  'analyzing-project',
  'discovering-components',
  'preparing-runtime',
  'bundling-modules',
  'publishing-artifacts',
  'loading-preview',
  'ready',
] as const);

/** Ordered lifecycle stages visible to the owner of one pinned preview tab. */
export type PreviewProgressStage = (typeof PREVIEW_PROGRESS_STAGES)[number];

/** Optional observer used to report preparation without coupling work to a particular UI. */
export type PreviewProgressReporter = (stage: PreviewProgressStage) => void;
