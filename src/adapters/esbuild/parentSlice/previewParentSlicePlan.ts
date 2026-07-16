/**
 * Converts one direct imported-target occurrence into a bounded same-module render-slice plan.
 * A source file often places a leaf below a private `Body` component and mounts that body beneath
 * a Form or Provider later in the same module. This planner follows only those local JSX uses; it
 * never executes the owner function and never imports the complete parent module as a render root.
 */
import { analyzePreviewLocalParentSlices, type PreviewParentSlice } from './previewParentSlice';
import type { PreviewParentSliceFrame } from './previewParentSliceSource';

const MAX_LOCAL_OWNER_DEPTH = 8;
const MAX_COMPOSED_FRAME_COUNT = 32;

/** Export-specific wrapper recipe consumed by the virtual parent-slice module plugin. */
export interface PreviewParentSlicePlan {
  /** Whether the analysis reached a declarative owner without an unsafe wrapper boundary. */
  readonly complete: boolean;
  /** Every authored file whose JSX contributed to this plan and therefore requires hot reload. */
  readonly dependencyPaths: readonly string[];
  /** Reproducible wrapper frames ordered from the target's immediate parent outwards. */
  readonly frames: readonly PreviewParentSliceFrame[];
  /** Number of private same-file component usages crossed after the direct imported occurrence. */
  readonly localOwnerDepth: number;
  /** Nearest remaining source owner after the bounded local climb. */
  readonly ownerExportNames: readonly string[];
  /** Local owner name retained for a future cross-module reverse-index climb. */
  readonly ownerLocalName: string | null;
  /** Number of exported owner-import edges followed through other package source modules. */
  readonly projectOwnerDepth: number;
  /** Direct consumer selected deterministically from the package source inventory. */
  readonly sourcePath: string;
}

/** Render-slice recipes keyed by the original target module's runtime export name. */
export type PreviewParentSlicePlansByExport = Readonly<Record<string, PreviewParentSlicePlan>>;

/** Inputs for composing one direct occurrence through private owners in its source module. */
export interface CreatePreviewParentSlicePlanOptions {
  /** Direct target occurrence returned by syntax-only import usage analysis. */
  readonly directSlice: PreviewParentSlice;
  /** Current editor-or-disk text for the direct consumer module. */
  readonly sourceText: string;
}

/**
 * Follows a unique first source-local owner usage and appends only its safe wrapper branch.
 *
 * The climb stops at the first dynamic imported wrapper, ambiguous/missing local use, cycle, or
 * fixed depth/frame budget. A partial plan remains useful: wrappers proven before the barrier are
 * safe to mount around the target while the existing automatic runtime boundary supplies generic
 * context fallbacks outside them.
 *
 * @param options Direct imported occurrence and the inert source text that contains it.
 * @returns Immutable wrapper plan that contains no executable source expressions.
 */
export function createPreviewParentSlicePlan(
  options: CreatePreviewParentSlicePlanOptions,
): PreviewParentSlicePlan {
  const frames: PreviewParentSliceFrame[] = [...options.directSlice.frames];
  const visitedLocalOwners = new Set<string>();
  let currentSlice = options.directSlice;
  let complete = currentSlice.complete;
  let localOwnerDepth = 0;

  while (
    complete &&
    localOwnerDepth < MAX_LOCAL_OWNER_DEPTH &&
    frames.length < MAX_COMPOSED_FRAME_COUNT
  ) {
    const localOwnerName = currentSlice.owner?.localName;
    if (
      localOwnerName === undefined ||
      localOwnerName === null ||
      visitedLocalOwners.has(localOwnerName)
    ) {
      break;
    }
    visitedLocalOwners.add(localOwnerName);

    const localAnalysis = analyzePreviewLocalParentSlices({
      consumerPath: options.directSlice.consumerPath,
      localComponentName: localOwnerName,
      sourceText: options.sourceText,
    });
    const localSlice = localAnalysis.slices[0];
    if (localSlice === undefined) {
      break;
    }

    const remainingFrameBudget = MAX_COMPOSED_FRAME_COUNT - frames.length;
    frames.push(...localSlice.frames.slice(0, remainingFrameBudget));
    localOwnerDepth += 1;
    currentSlice = localSlice;
    complete = localSlice.complete && localSlice.frames.length <= remainingFrameBudget;
  }

  if (localOwnerDepth >= MAX_LOCAL_OWNER_DEPTH || frames.length >= MAX_COMPOSED_FRAME_COUNT) {
    complete = false;
  }

  return Object.freeze({
    complete,
    dependencyPaths: Object.freeze([options.directSlice.consumerPath]),
    frames: Object.freeze(frames),
    localOwnerDepth,
    ownerExportNames: Object.freeze([...(currentSlice.owner?.exportNames ?? [])]),
    ownerLocalName: currentSlice.owner?.localName ?? null,
    projectOwnerDepth: 0,
    sourcePath: options.directSlice.consumerPath,
  });
}
