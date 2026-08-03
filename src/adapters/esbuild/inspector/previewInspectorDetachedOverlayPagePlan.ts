/**
 * Recovers a bounded authored page shell for an exported overlay with no static consumer.
 *
 * A deleted or not-yet-wired modal cannot produce an ordinary reverse-import path. Page Context
 * should still avoid silently degrading to the component gallery when one strongly related page
 * surface exists in the same feature. This planner admits only overlay-shaped exports, requires a
 * same-feature `pages` source with at least two shared semantic tokens, and then requires that
 * source to prove its own ordinary page corridor. The selected overlay is composed as a generated
 * sibling above that page; no inferred containment edge is presented as authored evidence.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { PreviewInspectorRouteSelectionStep } from '../../../domain/preview';
import { throwIfPreviewBuildCancelled } from '../../../domain/previewBuildExecution';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';
import { analyzePreviewReactRenderOutcomes } from '../staticResources/previewReactRenderOutcomes';
import {
  createPreviewInspectorAncestorPlan,
  type PreviewInspectorAncestorPlan,
  type PreviewInspectorComponentReference,
  type PreviewInspectorPageCandidate,
  type ReadPreviewInspectorAcceptedSpecifiers,
  type ReadPreviewInspectorSource,
} from './previewInspectorAncestorPlan';
import {
  collectPreviewInspectorFastPageCorridor,
  type PreviewInspectorFastPageCorridor,
} from './previewInspectorFastPageCorridor';
import type { PreviewInspectorOneHopVisualPath } from './previewInspectorShallowVisualTypes';

const OVERLAY_EXPORT_PATTERN = /(?:Dialog|Drawer|Modal|Overlay|Popover|Sheet)$/u;
const SOURCE_PATTERN = /\.[cm]?[jt]sx?$/iu;
const MAXIMUM_RANKED_SOURCE_PATHS = 24;
const MAXIMUM_CONTEXT_ANCHORS = 6;
const MINIMUM_SHARED_TOKEN_COUNT = 2;
const FEATURE_COMPONENT_DIRECTORIES = new Set(['component', 'components']);
const PAGE_DIRECTORIES = new Set(['page', 'pages', 'route', 'routes', 'screen', 'screens', 'view', 'views']);
const IGNORED_TOKENS = new Set([
  'app',
  'component',
  'components',
  'dialog',
  'drawer',
  'index',
  'jsx',
  'modal',
  'modals',
  'overlay',
  'page',
  'pages',
  'popover',
  'route',
  'routes',
  'screen',
  'screens',
  'sheet',
  'src',
  'tsx',
  'view',
  'views',
]);

/** One fully validated contextual page result returned to compiler usage orchestration. */
export interface PreviewInspectorDetachedOverlayPagePlan {
  readonly plan: PreviewInspectorAncestorPlan;
  readonly shallowVisualPaths: readonly PreviewInspectorOneHopVisualPath[];
  readonly truncated: boolean;
}

/** Inputs remain confined to the source inventory already admitted by fast preparation. */
export interface CreatePreviewInspectorDetachedOverlayPagePlanOptions {
  readonly acceptedImportSpecifiers?: ReadPreviewInspectorAcceptedSpecifiers;
  readonly documentPath: string;
  readonly exportName: string;
  readonly projectRoot: string;
  readonly readSource: ReadPreviewInspectorSource;
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  readonly routeSelection?: readonly PreviewInspectorRouteSelectionStep[];
  readonly signal?: AbortSignal;
  readonly sourcePaths: readonly string[];
  readonly workspaceRoot: string;
}

interface PreviewInspectorDetachedOverlayAnchor {
  readonly exportName: string;
  readonly score: number;
  readonly sourcePath: string;
}

/** Reports whether an export is eligible for the detached page-overlay fallback. */
export function isPreviewInspectorDetachedOverlayExport(exportName: string): boolean {
  return OVERLAY_EXPORT_PATTERN.test(exportName);
}

/**
 * Selects one evidence-backed page anchor and re-bases its executable page on the original overlay.
 */
export async function createPreviewInspectorDetachedOverlayPagePlan(
  options: CreatePreviewInspectorDetachedOverlayPagePlanOptions,
): Promise<PreviewInspectorDetachedOverlayPagePlan | undefined> {
  throwIfPreviewBuildCancelled(options.signal);
  if (!isPreviewInspectorDetachedOverlayExport(options.exportName)) return undefined;
  const documentPath = path.normalize(options.documentPath);
  const featureRoot = findPreviewInspectorOverlayFeatureRoot(documentPath);
  if (featureRoot === undefined) return undefined;
  const anchors = await collectPreviewInspectorDetachedOverlayAnchors(
    options,
    documentPath,
    featureRoot,
  );
  if (anchors.length === 0) return undefined;

  const targetPlan = await createPreviewInspectorAncestorPlan({
    ...(options.acceptedImportSpecifiers === undefined
      ? {}
      : { acceptedImportSpecifiers: options.acceptedImportSpecifiers }),
    documentPath,
    exportName: options.exportName,
    readSource: options.readSource,
    resolveModule: options.resolveModule,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    sourcePaths: Object.freeze([documentPath]),
  });

  for (const anchor of anchors.slice(0, MAXIMUM_CONTEXT_ANCHORS)) {
    throwIfPreviewBuildCancelled(options.signal);
    const corridor = await collectPreviewInspectorFastPageCorridor({
      additionalSourcePaths: options.sourcePaths,
      documentPath: anchor.sourcePath,
      projectRoot: options.projectRoot,
      readSource: options.readSource,
      resolveModule: options.resolveModule,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      workspaceRoot: options.workspaceRoot,
    });
    if (corridor === undefined) continue;
    const anchorPlan = await tryCreatePreviewInspectorOverlayAnchorPlan(options, anchor, corridor);
    if (anchorPlan === undefined) continue;
    const plan = composePreviewInspectorDetachedOverlayPlan(targetPlan, anchorPlan, anchor);
    if (plan === undefined) continue;
    return Object.freeze({
      plan,
      shallowVisualPaths: corridor.shallowVisualPaths,
      truncated: corridor.truncated,
    });
  }
  return undefined;
}

/** Limits the fallback to a conventional component-to-pages feature boundary. */
function findPreviewInspectorOverlayFeatureRoot(documentPath: string): string | undefined {
  const parsed = path.parse(documentPath);
  const directorySegments = path
    .relative(parsed.root, path.dirname(documentPath))
    .split(path.sep)
    .filter(Boolean);
  const componentIndex = directorySegments.findIndex((segment) =>
    FEATURE_COMPONENT_DIRECTORIES.has(segment.toLowerCase()),
  );
  if (componentIndex <= 0) return undefined;
  return path.join(parsed.root, ...directorySegments.slice(0, componentIndex));
}

/** Reads only the highest-affinity page-area sources before allocating TypeScript ASTs. */
async function collectPreviewInspectorDetachedOverlayAnchors(
  options: CreatePreviewInspectorDetachedOverlayPagePlanOptions,
  documentPath: string,
  featureRoot: string,
): Promise<readonly PreviewInspectorDetachedOverlayAnchor[]> {
  const targetTokens = tokenizePreviewInspectorOverlayIdentity(
    `${documentPath} ${options.exportName}`,
  );
  const targetFileTokens = tokenizePreviewInspectorOverlayIdentity(path.basename(documentPath));
  const rankedPaths = options.sourcePaths
    .map((sourcePath) => path.normalize(sourcePath))
    .filter(
      (sourcePath) =>
        sourcePath !== documentPath &&
        SOURCE_PATTERN.test(sourcePath) &&
        isPreviewInspectorPageAreaSource(featureRoot, sourcePath),
    )
    .map((sourcePath) => ({
      score: scorePreviewInspectorOverlayAnchorPath(
        sourcePath,
        featureRoot,
        targetTokens,
        targetFileTokens,
      ),
      sourcePath,
    }))
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort(
      (left, right) =>
        right.score - left.score || left.sourcePath.localeCompare(right.sourcePath),
    )
    .slice(0, MAXIMUM_RANKED_SOURCE_PATHS);
  const anchors: PreviewInspectorDetachedOverlayAnchor[] = [];
  for (const candidate of rankedPaths) {
    throwIfPreviewBuildCancelled(options.signal);
    const sourceText = await options.readSource(candidate.sourcePath);
    if (sourceText === undefined) continue;
    for (const outcomePlan of analyzePreviewReactRenderOutcomes(candidate.sourcePath, sourceText)) {
      if (!outcomePlan.outcomes.some((outcome) => outcome.kind === 'jsx')) continue;
      const exportTokens = tokenizePreviewInspectorOverlayIdentity(outcomePlan.exportName);
      const exportOverlap = countPreviewInspectorSharedTokens(targetTokens, exportTokens);
      anchors.push(
        Object.freeze({
          exportName: outcomePlan.exportName,
          score: candidate.score + exportOverlap * 40,
          sourcePath: candidate.sourcePath,
        }),
      );
    }
  }
  return Object.freeze(
    anchors.sort(
      (left, right) =>
        right.score - left.score ||
        left.sourcePath.localeCompare(right.sourcePath) ||
        left.exportName.localeCompare(right.exportName),
    ),
  );
}

/** Requires the candidate to remain inside the same feature and below a pages-like directory. */
function isPreviewInspectorPageAreaSource(featureRoot: string, sourcePath: string): boolean {
  const relativePath = path.relative(featureRoot, sourcePath);
  if (
    relativePath.length === 0 ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    return false;
  }
  return relativePath
    .split(path.sep)
    .slice(0, -1)
    .some((segment) => PAGE_DIRECTORIES.has(segment.toLowerCase()));
}

/** Uses shared feature terms as an admission rule, not merely as a ranking preference. */
function scorePreviewInspectorOverlayAnchorPath(
  sourcePath: string,
  featureRoot: string,
  targetTokens: ReadonlySet<string>,
  targetFileTokens: ReadonlySet<string>,
): number {
  const sourceTokens = tokenizePreviewInspectorOverlayIdentity(sourcePath);
  const sharedTokens = countPreviewInspectorSharedTokens(targetTokens, sourceTokens);
  if (sharedTokens < MINIMUM_SHARED_TOKEN_COUNT) return Number.NEGATIVE_INFINITY;
  const sharedFileTokens = countPreviewInspectorSharedTokens(targetFileTokens, sourceTokens);
  const relativeDepth = path.relative(featureRoot, sourcePath).split(path.sep).length;
  return sharedTokens * 100 + sharedFileTokens * 60 - Math.min(relativeDepth, 32);
}

/** Normalizes filenames and PascalCase exports to stable lower-case semantic terms. */
function tokenizePreviewInspectorOverlayIdentity(value: string): ReadonlySet<string> {
  const tokens = value
    .replace(/([a-z\d])([A-Z])/gu, '$1 $2')
    .toLowerCase()
    .split(/[^a-z\d]+/gu)
    .filter((token) => token.length >= 3 && !IGNORED_TOKENS.has(token));
  return new Set(tokens);
}

/** Counts exact normalized terms without interpreting project-specific vocabulary. */
function countPreviewInspectorSharedTokens(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number {
  let count = 0;
  for (const token of left) if (right.has(token)) count += 1;
  return count;
}

/** Lets one malformed optional anchor fail closed without losing the direct preview fallback. */
async function tryCreatePreviewInspectorOverlayAnchorPlan(
  options: CreatePreviewInspectorDetachedOverlayPagePlanOptions,
  anchor: PreviewInspectorDetachedOverlayAnchor,
  corridor: PreviewInspectorFastPageCorridor,
): Promise<PreviewInspectorAncestorPlan | undefined> {
  try {
    return await createPreviewInspectorAncestorPlan({
      ...(options.acceptedImportSpecifiers === undefined
        ? {}
        : { acceptedImportSpecifiers: options.acceptedImportSpecifiers }),
      documentPath: anchor.sourcePath,
      exportName: anchor.exportName,
      readSource: options.readSource,
      resolveModule: options.resolveModule,
      ...(options.routeSelection === undefined
        ? {}
        : { routeSelection: options.routeSelection }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      sourcePaths: corridor.sourcePaths,
    });
  } catch {
    throwIfPreviewBuildCancelled(options.signal);
    return undefined;
  }
}

/** Requires the anchor itself to have escaped component-only execution before composing the modal. */
function isPreviewInspectorContextualOverlayCandidate(
  candidate: PreviewInspectorPageCandidate,
  anchor: PreviewInspectorDetachedOverlayAnchor,
): boolean {
  return (
    candidate.edges.length > 0 ||
    candidate.routeLocation !== undefined ||
    candidate.renderPath?.entryPoint !== undefined ||
    (candidate.renderPath?.steps.length ?? 0) > 1 ||
    path.normalize(candidate.root.sourcePath) !== path.normalize(anchor.sourcePath) ||
    candidate.root.exportName !== anchor.exportName
  );
}

/** Joins a real page corridor with one compiler-declared overlay sibling placement. */
function composePreviewInspectorDetachedOverlayPlan(
  targetPlan: PreviewInspectorAncestorPlan,
  anchorPlan: PreviewInspectorAncestorPlan,
  anchor: PreviewInspectorDetachedOverlayAnchor,
): PreviewInspectorAncestorPlan | undefined {
  const identity = createHash('sha256')
    .update(
      [
        path.normalize(targetPlan.target.sourcePath),
        targetPlan.target.exportName,
        path.normalize(anchor.sourcePath),
        anchor.exportName,
      ].join('\0'),
    )
    .digest('hex')
    .slice(0, 12);
  const pageCandidates = anchorPlan.pageCandidates
    .filter((candidate) => isPreviewInspectorContextualOverlayCandidate(candidate, anchor))
    .map((candidate) =>
      Object.freeze({
        ...candidate,
        dependencyPaths: Object.freeze(
          [...new Set([...candidate.dependencyPaths, ...targetPlan.dependencyPaths])].sort(),
        ),
        detachedTargetPlacement: 'overlay-sibling' as const,
        id: `${candidate.id}:detached-overlay:${identity}`,
        target: freezePreviewInspectorComponentReference(targetPlan.target),
        targetAutomaticProps: targetPlan.targetAutomaticProps,
      }),
    );
  const primary = pageCandidates[0];
  if (primary === undefined) return undefined;
  const dependencyPaths = Object.freeze(
    [...new Set([...targetPlan.dependencyPaths, ...anchorPlan.dependencyPaths])].sort(),
  );
  return Object.freeze({
    ...targetPlan,
    complete: primary.complete,
    dependencyPaths,
    edges: primary.edges,
    pageCandidates: Object.freeze(pageCandidates),
    root: primary.root,
    rootAutomaticProps: primary.rootAutomaticProps,
    ...(anchorPlan.routeBranches === undefined
      ? {}
      : { routeBranches: anchorPlan.routeBranches }),
    ...(anchorPlan.routeSelectionResolution === undefined
      ? {}
      : { routeSelectionResolution: anchorPlan.routeSelectionResolution }),
    ...(anchorPlan.selectedRouteBranchId === undefined
      ? {}
      : { selectedRouteBranchId: anchorPlan.selectedRouteBranchId }),
    stopReason: primary.stopReason,
  });
}

/** Prevents a mutable reference object from crossing the planner boundary. */
function freezePreviewInspectorComponentReference(
  reference: PreviewInspectorComponentReference,
): PreviewInspectorComponentReference {
  return Object.freeze({
    exportName: reference.exportName,
    sourcePath: path.normalize(reference.sourcePath),
  });
}
