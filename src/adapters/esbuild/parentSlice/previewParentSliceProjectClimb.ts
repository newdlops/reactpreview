/**
 * Continues a render-slice plan through exported owner usages in other package source files.
 * The planner composes syntax-only wrapper frames; it never mounts the owner component itself, so
 * sibling JSX, hooks, effects, route gates, and modal state in that owner remain outside the bundle.
 */
import path from 'node:path';
import {
  analyzePreviewParentSlices,
  type MatchesPreviewParentSliceTargetImport,
  type PreviewParentSlice,
} from './previewParentSlice';
import {
  createPreviewParentSlicePlan,
  type PreviewParentSlicePlan,
} from './previewParentSlicePlan';

const MAX_PROJECT_OWNER_DEPTH = 4;
const MAX_COMPOSED_FRAME_COUNT = 32;
const MAX_CONCURRENT_SOURCE_READS = 16;
const SOURCE_EXTENSION_PATTERN = /\.(?:[cm]?[jt]sx?)$/iu;

/** Lazily supplies current editor-or-disk text under the caller's package and byte budgets. */
export type ReadPreviewParentSliceSource = (sourcePath: string) => Promise<string | undefined>;

/** Inputs required for one bounded cross-module reverse owner climb. */
export interface ClimbPreviewParentSliceProjectOptions {
  /** Direct/same-module plan whose remaining owner exports become the first reverse frontier. */
  readonly initialPlan: PreviewParentSlicePlan;
  /** Project-aware alias resolution shared with direct usage discovery. */
  readonly matchesTargetImport?: MatchesPreviewParentSliceTargetImport;
  /** Bounded, package-local source inventory in deterministic lexical order. */
  readonly sourcePaths: readonly string[];
  /** Lazy source reader that applies dirty snapshot precedence and aggregate byte limits. */
  readonly readSource: ReadPreviewParentSliceSource;
}

/** Candidate occurrence and its already-expanded same-module wrapper recipe. */
interface ProjectParentCandidate {
  readonly plan: PreviewParentSlicePlan;
  readonly slice: PreviewParentSlice;
}

/**
 * Walks `target export → importing owner export` across at most four source modules.
 *
 * For each frontier the first occurrence with at least one safe wrapper wins; an earlier empty
 * occurrence is retained only as a pass-through fallback. Dynamic imported wrappers remain hard
 * barriers because the same-module planner marks that candidate incomplete. Cycles and the shared
 * 32-frame ceiling terminate with a safe partial plan.
 *
 * @param options Initial plan, package inventory, and bounded source reader.
 * @returns Combined immutable plan whose dependencies cover every selected parent edge.
 */
export async function climbPreviewParentSliceProject(
  options: ClimbPreviewParentSliceProjectOptions,
): Promise<PreviewParentSlicePlan> {
  let currentPlan = options.initialPlan;
  let projectOwnerDepth = currentPlan.projectOwnerDepth;
  let localOwnerDepth = currentPlan.localOwnerDepth;
  const frames = [...currentPlan.frames];
  const dependencies = new Set(currentPlan.dependencyPaths);
  const visitedFrontiers = new Set<string>();

  while (
    currentPlan.complete &&
    currentPlan.ownerExportNames.length > 0 &&
    projectOwnerDepth < MAX_PROJECT_OWNER_DEPTH &&
    frames.length < MAX_COMPOSED_FRAME_COUNT
  ) {
    const frontierKey = createFrontierKey(currentPlan.sourcePath, currentPlan.ownerExportNames);
    if (visitedFrontiers.has(frontierKey)) {
      return createCombinedPlan(
        currentPlan,
        frames,
        dependencies,
        localOwnerDepth,
        projectOwnerDepth,
        false,
      );
    }
    visitedFrontiers.add(frontierKey);

    const candidate = await findProjectParentCandidate({
      exportNames: currentPlan.ownerExportNames,
      ...(options.matchesTargetImport === undefined
        ? {}
        : { matchesTargetImport: options.matchesTargetImport }),
      readSource: options.readSource,
      sourcePaths: options.sourcePaths,
      targetPath: currentPlan.sourcePath,
    });
    if (candidate === undefined) {
      break;
    }

    const remainingFrameBudget = MAX_COMPOSED_FRAME_COUNT - frames.length;
    frames.push(...candidate.plan.frames.slice(0, remainingFrameBudget));
    for (const dependencyPath of candidate.plan.dependencyPaths) {
      dependencies.add(dependencyPath);
    }
    projectOwnerDepth += 1;
    localOwnerDepth += candidate.plan.localOwnerDepth;
    currentPlan = candidate.plan;
    if (candidate.plan.frames.length > remainingFrameBudget) {
      return createCombinedPlan(
        currentPlan,
        frames,
        dependencies,
        localOwnerDepth,
        projectOwnerDepth,
        false,
      );
    }
  }

  const budgetTruncated =
    currentPlan.complete &&
    currentPlan.ownerExportNames.length > 0 &&
    (projectOwnerDepth >= MAX_PROJECT_OWNER_DEPTH || frames.length >= MAX_COMPOSED_FRAME_COUNT);
  return createCombinedPlan(
    currentPlan,
    frames,
    dependencies,
    localOwnerDepth,
    projectOwnerDepth,
    currentPlan.complete && !budgetTruncated,
  );
}

/** Finds the first useful parent occurrence while preserving deterministic empty pass-throughs. */
async function findProjectParentCandidate(options: {
  readonly exportNames: readonly string[];
  readonly matchesTargetImport?: MatchesPreviewParentSliceTargetImport;
  readonly readSource: ReadPreviewParentSliceSource;
  readonly sourcePaths: readonly string[];
  readonly targetPath: string;
}): Promise<ProjectParentCandidate | undefined> {
  let emptyFallback: ProjectParentCandidate | undefined;
  for (
    let batchStart = 0;
    batchStart < options.sourcePaths.length;
    batchStart += MAX_CONCURRENT_SOURCE_READS
  ) {
    const pathBatch = options.sourcePaths.slice(
      batchStart,
      batchStart + MAX_CONCURRENT_SOURCE_READS,
    );
    const sourceBatch = await Promise.all(
      pathBatch.map(async (sourcePath) => ({
        sourcePath,
        sourceText:
          path.normalize(sourcePath) === path.normalize(options.targetPath)
            ? undefined
            : await options.readSource(sourcePath),
      })),
    );
    for (const source of sourceBatch) {
      if (
        source.sourceText === undefined ||
        !mayContainFrontierUsage(source.sourceText, options.targetPath)
      ) {
        continue;
      }
      const analysis = analyzePreviewParentSlices({
        consumerPath: source.sourcePath,
        ...(options.matchesTargetImport === undefined
          ? {}
          : { matchesTargetImport: options.matchesTargetImport }),
        sourceText: source.sourceText,
        targetExportNames: options.exportNames,
        targetPath: options.targetPath,
      });
      for (const slice of analysis.slices) {
        const plan = createPreviewParentSlicePlan({
          directSlice: slice,
          sourceText: source.sourceText,
        });
        const candidate = { plan, slice } satisfies ProjectParentCandidate;
        if (plan.frames.length > 0) {
          return candidate;
        }
        emptyFallback ??= candidate;
      }
    }
  }
  return emptyFallback;
}

/** Cheap import-stem and JSX gate used before allocating another TypeScript AST. */
function mayContainFrontierUsage(sourceText: string, targetPath: string): boolean {
  const targetStem = path.basename(targetPath).replace(SOURCE_EXTENSION_PATTERN, '');
  return sourceText.includes(targetStem) && sourceText.includes('<');
}

/** Builds a stable cycle identity for one canonical source/export frontier. */
function createFrontierKey(sourcePath: string, exportNames: readonly string[]): string {
  return `${path.normalize(sourcePath)}\0${[...exportNames].sort().join('|')}`;
}

/** Freezes one accumulated plan without retaining parser nodes or project source text. */
function createCombinedPlan(
  currentPlan: PreviewParentSlicePlan,
  frames: readonly PreviewParentSlicePlan['frames'][number][],
  dependencies: ReadonlySet<string>,
  localOwnerDepth: number,
  projectOwnerDepth: number,
  complete: boolean,
): PreviewParentSlicePlan {
  return Object.freeze({
    complete,
    dependencyPaths: Object.freeze([...dependencies].sort()),
    frames: Object.freeze([...frames]),
    localOwnerDepth,
    ownerExportNames: Object.freeze([...currentPlan.ownerExportNames]),
    ownerLocalName: currentPlan.ownerLocalName,
    projectOwnerDepth,
    sourcePath: currentPlan.sourcePath,
  });
}
