/**
 * Collects direct authored JSX dependencies beside every proven fast page-corridor step.
 *
 * The fast corridor is intentionally a shortest entry-to-target path, but a path alone omits the
 * header, navigation, provider shell, and sibling regions rendered by those same components. This
 * collector adds exactly the first resolved JSX import hop around each path step. It never follows
 * a collected dependency; the bundler instead keeps that root authentic and substitutes only its
 * next proven project-component boundary. Sources are inert TypeScript syntax and never evaluated.
 */
import path from 'node:path';
import { throwIfPreviewBuildCancelled } from '../../../domain/previewBuildExecution';
import { analyzePreviewRenderSource } from '../renderGraph/previewRenderSourceAnalysis';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph/previewRenderGraphTypes';
import type { ReadPreviewInspectorSource } from './previewInspectorAncestorTypes';
import { isPreviewInspectorFastAuxiliarySourcePath } from './previewInspectorFastResolvedImports';
import { collectPreviewInspectorShallowVisualEvidence } from './previewInspectorShallowVisualEvidence';
import type { PreviewInspectorOneHopVisualPath } from './previewInspectorShallowVisualTypes';
import { collectPreviewStaticRouteProjectionInventory } from './previewInspectorStaticRouteProjection';

const MAXIMUM_JSX_IMPORTS_PER_CORRIDOR_STEP = 48;
const SOURCE_FILE_PATTERN = /\.[cm]?[jt]sx?$/iu;

/** Inputs for one syntax-only direct JSX context collection pass. */
export interface CollectPreviewInspectorOneHopContextOptions {
  /** Proven authored entry/root-to-target path, in render direction. */
  readonly importPath: readonly string[];
  /** Maximum unique off-corridor modules admitted across all path steps. */
  readonly maximumFiles: number;
  /** Byte-bounded snapshot reader shared with the ordinary page-subtree lane. */
  readonly readSource: ReadPreviewInspectorSource;
  /** Alias-aware resolver used by the eventual preview bundle. */
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  /** Selected example/demo subtree that may cross normal auxiliary-source exclusions. */
  readonly selectedAuxiliaryRoot?: string;
  /** Cancels stale source reads before another editor revision can reuse their result. */
  readonly signal?: AbortSignal;
  /** Trusted workspace boundary for authored modules. */
  readonly workspaceRoot: string;
}

/** Frozen direct context result plus an honest signal that evidence was budget-pruned. */
export interface PreviewInspectorOneHopContext {
  /** Resolver/import/value-flow evidence for every admitted direct visual module. */
  readonly shallowVisualPaths: readonly PreviewInspectorOneHopVisualPath[];
  /** Fair, round-robin selection of direct JSX dependencies outside the corridor itself. */
  readonly sourcePaths: readonly string[];
  /** True when a source read or either candidate/file cap prevented complete collection. */
  readonly truncated: boolean;
}

/**
 * Reserves one direct JSX dependency per eligible corridor step before taking a second from any.
 *
 * Route-only static choices remain owned by the existing route projection pass and are excluded.
 * The selected corridor child is never at risk: all corridor paths are supplied independently by
 * the caller and direct candidates resolving back into that set do not consume this context cap.
 */
export async function collectPreviewInspectorOneHopContext(
  options: CollectPreviewInspectorOneHopContextOptions,
): Promise<PreviewInspectorOneHopContext> {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const corridorPaths = new Set(options.importPath.map((sourcePath) => path.normalize(sourcePath)));
  const candidatesByStep: {
    readonly sourcePath: string;
    readonly visualPaths: readonly PreviewInspectorOneHopVisualPath[];
  }[][] = [];
  const sourceTextByPath = new Map<string, string>();
  let truncated = false;

  for (const [stepIndex, sourcePath] of options.importPath.entries()) {
    throwIfPreviewBuildCancelled(options.signal);
    const selectedChildPath = options.importPath[stepIndex + 1];
    if (selectedChildPath === undefined) {
      candidatesByStep.push([]);
      continue;
    }
    const normalizedSourcePath = path.normalize(sourcePath);
    const sourceText = await options.readSource(normalizedSourcePath);
    if (sourceText === undefined) {
      candidatesByStep.push([]);
      truncated = true;
      continue;
    }
    sourceTextByPath.set(normalizedSourcePath, sourceText);
    const routeProjectionSpecifiers = sourceText.includes('import')
      ? collectPreviewStaticRouteProjectionInventory(normalizedSourcePath, sourceText)
          .projectionsBySpecifier
      : new Map();
    const evidence = collectPreviewInspectorShallowVisualEvidence({
      admitVisualPath: (visualPath) =>
        !routeProjectionSpecifiers.has(visualPath.moduleSpecifier) &&
        !isDeferredLazyComponentChoice(visualPath) &&
        isAdmittedProjectSourcePath(
          path.normalize(visualPath.sourcePath),
          workspaceRoot,
          options.selectedAuxiliaryRoot,
        ),
      importerPath: normalizedSourcePath,
      ...findCorridorOwnerExportName(
        options.importPath[stepIndex - 1],
        normalizedSourcePath,
        sourceTextByPath,
        options.resolveModule,
      ),
      resolveModule: options.resolveModule,
      selectedChildPath,
      sourceText,
    });
    truncated ||= evidence.truncated;
    const visualPathsBySourcePath = new Map<string, PreviewInspectorOneHopVisualPath[]>();
    for (const visualPath of evidence.paths) {
      const candidatePath = path.normalize(visualPath.sourcePath);
      if (
        corridorPaths.has(candidatePath) ||
        routeProjectionSpecifiers.has(visualPath.moduleSpecifier) ||
        !isAdmittedProjectSourcePath(candidatePath, workspaceRoot, options.selectedAuxiliaryRoot)
      ) {
        continue;
      }
      const candidatePaths = visualPathsBySourcePath.get(candidatePath) ?? [];
      candidatePaths.push(visualPath);
      visualPathsBySourcePath.set(candidatePath, candidatePaths);
    }
    const admittedCandidates = [...visualPathsBySourcePath].map(([candidatePath, visualPaths]) =>
      Object.freeze({
        sourcePath: candidatePath,
        visualPaths: Object.freeze(visualPaths),
      }),
    );
    if (admittedCandidates.length > MAXIMUM_JSX_IMPORTS_PER_CORRIDOR_STEP) truncated = true;
    candidatesByStep.push(admittedCandidates.slice(0, MAXIMUM_JSX_IMPORTS_PER_CORRIDOR_STEP));
  }

  const selectedPaths: string[] = [];
  const selectedPathSet = new Set<string>();
  const nextCandidateIndexes = candidatesByStep.map(() => 0);
  const maximumFiles = Math.max(0, Math.floor(options.maximumFiles));
  let candidatesRemain = true;
  while (selectedPaths.length < maximumFiles && candidatesRemain) {
    throwIfPreviewBuildCancelled(options.signal);
    candidatesRemain = false;
    for (const [stepIndex, candidates] of candidatesByStep.entries()) {
      let candidate = candidates[nextCandidateIndexes[stepIndex] ?? 0];
      while (candidate !== undefined && selectedPathSet.has(candidate.sourcePath)) {
        nextCandidateIndexes[stepIndex] = (nextCandidateIndexes[stepIndex] ?? 0) + 1;
        candidate = candidates[nextCandidateIndexes[stepIndex] ?? 0];
      }
      if (candidate === undefined) continue;
      candidatesRemain = true;
      selectedPathSet.add(candidate.sourcePath);
      selectedPaths.push(candidate.sourcePath);
      nextCandidateIndexes[stepIndex] = (nextCandidateIndexes[stepIndex] ?? 0) + 1;
      if (selectedPaths.length >= maximumFiles) break;
    }
  }

  if (
    candidatesByStep.some(
      (candidates, stepIndex) => (nextCandidateIndexes[stepIndex] ?? 0) < candidates.length,
    )
  ) {
    truncated = true;
  }
  const shallowVisualPaths = candidatesByStep.flatMap((candidates) =>
    candidates.flatMap((candidate) =>
      selectedPathSet.has(candidate.sourcePath) ? candidate.visualPaths : [],
    ),
  );
  return Object.freeze({
    shallowVisualPaths: Object.freeze(deduplicateShallowVisualPaths(shallowVisualPaths)),
    sourcePaths: Object.freeze(selectedPaths),
    truncated,
  });
}

/** Infers the current owner export from the preceding proven import/lazy corridor edge. */
function findCorridorOwnerExportName(
  previousSourcePath: string | undefined,
  ownerPath: string,
  sourceTextByPath: ReadonlyMap<string, string>,
  resolveModule: ResolvePreviewRenderGraphModule,
): { readonly ownerExportName?: string } {
  if (previousSourcePath === undefined) return {};
  const normalizedPreviousPath = path.normalize(previousSourcePath);
  const previousSourceText = sourceTextByPath.get(normalizedPreviousPath);
  if (previousSourceText === undefined) return {};
  const facts = analyzePreviewRenderSource(normalizedPreviousPath, previousSourceText).moduleFacts;
  for (const imported of facts.imports) {
    if (
      imported.importedName !== '*' &&
      path.normalize(resolveModule(imported.moduleSpecifier, normalizedPreviousPath) ?? '') ===
        ownerPath
    ) {
      return { ownerExportName: imported.importedName };
    }
  }
  for (const lazyImport of facts.lazyImports) {
    if (
      path.normalize(resolveModule(lazyImport.moduleSpecifier, normalizedPreviousPath) ?? '') ===
      ownerPath
    ) {
      return { ownerExportName: lazyImport.importedName };
    }
  }
  return {};
}

/**
 * Leaves off-corridor `React.lazy` component choices to the corridor plugin.
 *
 * A lazy sibling or wrapper can be visible page chrome and remains eligible. A lazy value used as
 * a component-valued prop is instead a route/factory/modal choice whose branch is not on the proven
 * target path. Promoting it to shallow visual context would mark the deferred module as exact again
 * and make esbuild traverse an inactive page graph during first paint.
 */
function isDeferredLazyComponentChoice(visualPath: PreviewInspectorOneHopVisualPath): boolean {
  return visualPath.importKind === 'react-lazy' && visualPath.relation === 'component-prop';
}

/** Removes duplicate evidence caused by equivalent outcomes or repeated sibling occurrences. */
function deduplicateShallowVisualPaths(
  visualPaths: readonly PreviewInspectorOneHopVisualPath[],
): readonly PreviewInspectorOneHopVisualPath[] {
  const seen = new Set<string>();
  return visualPaths.filter((visualPath) => {
    const key = [
      visualPath.importerPath,
      visualPath.sourcePath,
      visualPath.moduleSpecifier,
      visualPath.exportName,
      visualPath.renderedLocalName,
      visualPath.relation,
      visualPath.renderBoundaryStart,
      visualPath.occurrenceStart,
    ].join('\0');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Confines direct context to authored JS/TS modules inside the trusted workspace. */
function isAdmittedProjectSourcePath(
  sourcePath: string,
  workspaceRoot: string,
  selectedAuxiliaryRoot: string | undefined,
): boolean {
  if (
    !SOURCE_FILE_PATTERN.test(sourcePath) ||
    !isPathInside(workspaceRoot, sourcePath) ||
    /(?:^|\/)(?:node_modules|\.yarn|\.pnpm)(?:\/|$)/u.test(
      normalizePortableRelativePath(workspaceRoot, sourcePath),
    )
  ) {
    return false;
  }
  /*
   * Reuse the exact fast-graph classifier rather than maintaining a weaker directory-only copy.
   * Example owners are frequently colocated with product pages and use names such as
   * `feature-demo-page.tsx`; admitting one here can promote its complete application path over the
   * real owner and force esbuild to retain the demo's entire dependency graph.
   */
  const auxiliary = isPreviewInspectorFastAuxiliarySourcePath(sourcePath, workspaceRoot);
  return (
    !auxiliary ||
    (selectedAuxiliaryRoot !== undefined &&
      isPathInside(path.resolve(selectedAuxiliaryRoot), path.resolve(sourcePath)))
  );
}

/** Segment-aware containment prevents sibling path prefixes from crossing a trusted boundary. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

/** Produces one lowercase workspace-relative path for auxiliary/generated segment tests. */
function normalizePortableRelativePath(rootPath: string, sourcePath: string): string {
  return path
    .relative(path.resolve(rootPath), path.resolve(sourcePath))
    .replaceAll('\\', '/')
    .toLowerCase();
}
