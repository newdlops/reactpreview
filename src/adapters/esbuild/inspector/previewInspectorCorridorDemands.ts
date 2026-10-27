/** Collects frozen corridor path, export, and runtime-hook demands. */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { canonicalizeExistingPath } from '../../../shared/pathIdentity';
import type {
  PreviewInspectorAncestorPlan,
  PreviewInspectorPageCandidate,
} from './previewInspectorAncestorPlan';
import type {
  PreviewInspectorFrontierComponentExports,
  PreviewInspectorProjectedEdge,
} from './previewInspectorBundleFrontierTypes';
import {
  type PreviewInspectorFrozenProjectedEdge,
  MAX_DYNAMIC_IMPORTER_SOURCE_BYTES,
} from './previewInspectorCorridorModel';

/**
 * Creates cheap lexical hints for the rare selected module hidden in a broad generated registry.
 * Resolving every branch defeats the fast corridor, while resolving matching stems preserves a
 * direct selected route even when no dynamic route parameter was statically available.
 */
export function createPreviewInspectorCorridorModuleStemSet(
  plan: PreviewInspectorAncestorPlan,
): ReadonlySet<string> {
  const stems = new Set<string>();
  const selectedPaths = [
    plan.root.sourcePath,
    plan.target.sourcePath,
    ...plan.pageCandidates.flatMap((candidate) => [
      candidate.root.sourcePath,
      ...collectPreviewInspectorRouteComponentSourcePaths(candidate),
      ...(candidate.renderPath?.steps.flatMap((step) => [
        step.sourcePath,
        ...(step.evidenceSourcePaths ?? []),
      ]) ?? []),
    ]),
    ...Object.values(plan.renderChainsByExport).flatMap((chain) =>
      chain.paths.flatMap((candidate) =>
        candidate.steps.flatMap((step) => [step.sourcePath, ...(step.evidenceSourcePaths ?? [])]),
      ),
    ),
    ...(plan.shallowVisualPaths?.map((item) => item.sourcePath) ?? []),
  ];
  for (const sourcePath of selectedPaths) {
    const extension = path.extname(sourcePath);
    const fileStem = path.basename(sourcePath, extension).toLowerCase();
    stems.add(
      fileStem === 'index' ? path.basename(path.dirname(sourcePath)).toLowerCase() : fileStem,
    );
  }
  return stems;
}

/** Groups retained shallow roots by exact source and runtime export for plugin-time analysis. */
export function collectPreviewInspectorShallowExportsByPath(
  plan: PreviewInspectorAncestorPlan,
  authenticComponentExports: readonly PreviewInspectorFrontierComponentExports[] = [],
): ReadonlyMap<string, ReadonlySet<string>> {
  const exportsByPath = new Map<string, Set<string>>();
  for (const item of plan.shallowVisualPaths ?? []) {
    /*
     * Route alternatives are inactive page outcomes and wrappers already belong to the exact
     * corridor. Siblings and ordinary component props are requested first-depth page composition:
     * a frame's `component={Header}` must keep Header authentic while projecting its descendants.
     */
    if (item.relation === 'wrapper' || item.relation === 'route-alternative') continue;
    const sourcePath = canonicalizeExistingPath(item.sourcePath);
    const exportNames = exportsByPath.get(sourcePath) ?? new Set<string>();
    exportNames.add(item.exportName);
    exportsByPath.set(sourcePath, exportNames);
  }
  // The frozen frontier already established these source/export pairs.  They
  // are roots only for shallow projection; authentic membership remains under
  // the separate fail-closed guard.
  for (const item of authenticComponentExports) {
    const sourcePath = canonicalizeExistingPath(item.sourcePath);
    const exportNames = exportsByPath.get(sourcePath) ?? new Set<string>();
    for (const exportName of item.exportNames) exportNames.add(exportName);
    exportsByPath.set(sourcePath, exportNames);
  }
  return new Map(
    [...exportsByPath].map(([sourcePath, exportNames]) => [
      sourcePath,
      new Set(exportNames) as ReadonlySet<string>,
    ]),
  );
}

/** Carries frontier-recorded hook surfaces through rebuild-safe shallow state. */
export function collectPreviewInspectorRuntimeHookExportsByPath(
  authenticComponentExports: readonly PreviewInspectorFrontierComponentExports[] = [],
): ReadonlyMap<string, ReadonlySet<string>> {
  const exportsByPath = new Map<string, Set<string>>();
  for (const item of authenticComponentExports) {
    if (item.runtimeHookExportNames.length === 0) continue;
    const sourcePath = canonicalizeExistingPath(item.sourcePath);
    const exportNames = exportsByPath.get(sourcePath) ?? new Set<string>();
    for (const exportName of item.runtimeHookExportNames) exportNames.add(exportName);
    exportsByPath.set(sourcePath, exportNames);
  }
  return new Map(
    [...exportsByPath].map(([sourcePath, exportNames]) => [
      sourcePath,
      new Set(exportNames) as ReadonlySet<string>,
    ]),
  );
}

/** Indexes only exact importer/specifier/target demands already frozen by frontier planning. */
export function collectPreviewInspectorFrozenProjectedEdges(
  projectedEdges: readonly PreviewInspectorProjectedEdge[] = [],
  canonicalizePath: (sourcePath: string) => string,
): ReadonlyMap<string, PreviewInspectorFrozenProjectedEdge> {
  const grouped = new Map<
    string,
    {
      readonly componentNames: Set<string>;
      readonly exportNames: Set<string>;
      readonly neutralRouteBasePaths: Set<string>;
      readonly runtimeHookNames: Set<string>;
      targetPath?: string;
      valid: boolean;
    }
  >();
  for (const edge of projectedEdges) {
    if (edge.targetPath === undefined) continue;
    const importerPath = canonicalizePath(edge.importerPath);
    const targetPath = canonicalizePath(edge.targetPath);
    const key = createPreviewInspectorFrozenProjectedEdgeKey(importerPath, edge.moduleSpecifier);
    const item = grouped.get(key) ?? {
      componentNames: new Set<string>(),
      exportNames: new Set<string>(),
      neutralRouteBasePaths: new Set<string>(),
      runtimeHookNames: new Set<string>(),
      targetPath,
      valid: true,
    };
    if (item.targetPath !== targetPath) item.valid = false;
    if (edge.neutralRouteBasePath !== undefined) {
      item.neutralRouteBasePaths.add(edge.neutralRouteBasePath);
      if (item.neutralRouteBasePaths.size > 1) item.valid = false;
    }
    const hookNames = new Set(edge.runtimeHookExportNames);
    for (const exportName of edge.exportNames) {
      item.exportNames.add(exportName);
      if (hookNames.has(exportName)) item.runtimeHookNames.add(exportName);
      else item.componentNames.add(exportName);
    }
    if ([...item.componentNames].some((name) => item.runtimeHookNames.has(name))) {
      item.valid = false;
    }
    grouped.set(key, item);
  }
  const result = new Map<string, PreviewInspectorFrozenProjectedEdge>();
  for (const [key, item] of grouped) {
    if (!item.valid || item.targetPath === undefined || item.exportNames.size === 0) continue;
    result.set(key, {
      projection: Object.freeze({
        exportNames: Object.freeze([...item.exportNames].sort()),
        moduleSpecifier: key.slice(key.indexOf('\0') + 1),
        ...(item.neutralRouteBasePaths.size === 1
          ? { neutralRouteBasePath: [...item.neutralRouteBasePaths][0] }
          : {}),
        runtimeHookExportNames: Object.freeze([...item.runtimeHookNames].sort()),
      }),
      targetPath: item.targetPath,
    });
  }
  return result;
}

/** Preserves the authored module specifier verbatim inside an importer-scoped edge identity. */
export function createPreviewInspectorFrozenProjectedEdgeKey(
  importerPath: string,
  moduleSpecifier: string,
): string {
  return `${importerPath}\0${moduleSpecifier}`;
}

/** Checks only a dynamic specifier's final path segment before paying for project resolution. */
export function matchesPreviewCorridorModuleStem(
  moduleSpecifier: string,
  corridorModuleStems: ReadonlySet<string>,
): boolean {
  const cleanSpecifier = moduleSpecifier.split(/[?#]/u, 1)[0] ?? moduleSpecifier;
  const finalSegment = cleanSpecifier.split(/[\\/]/u).filter(Boolean).at(-1);
  if (finalSegment === undefined) return false;
  const extension = path.extname(finalSegment);
  return corridorModuleStems.has(path.basename(finalSegment, extension).toLowerCase());
}

/** Reads a source only after a file-size check so resolver-time evidence remains memory-bounded. */
export async function readBoundedSource(sourcePath: string): Promise<string | undefined> {
  try {
    const sourceStats = await stat(sourcePath);
    if (!sourceStats.isFile() || sourceStats.size > MAX_DYNAMIC_IMPORTER_SOURCE_BYTES) {
      return undefined;
    }
    const sourceText = await readFile(sourcePath, 'utf8');
    return Buffer.byteLength(sourceText, 'utf8') <= MAX_DYNAMIC_IMPORTER_SOURCE_BYTES
      ? sourceText
      : undefined;
  } catch {
    return undefined;
  }
}

/** Collects every normalized source that proves a selectable candidate or render-chain path. */
export function createPreviewInspectorCorridorPathSet(
  plan: PreviewInspectorAncestorPlan,
): ReadonlySet<string> {
  const sourcePaths = new Set<string>([
    plan.root.sourcePath,
    plan.target.sourcePath,
    ...(plan.contextModule === undefined ? [] : plan.contextModule.importPath),
    ...plan.pageCandidates.flatMap((candidate) => [
      candidate.root.sourcePath,
      ...collectPreviewInspectorRouteComponentSourcePaths(candidate),
      ...(candidate.nextAppLayoutChain?.map((layout) => layout.sourcePath) ?? []),
      ...(candidate.renderPath?.steps.flatMap((step) => [
        step.sourcePath,
        ...(step.evidenceSourcePaths ?? []),
      ]) ?? []),
      ...(candidate.renderPath?.entryPoint === undefined
        ? []
        : [candidate.renderPath.entryPoint.sourcePath]),
    ]),
    ...Object.values(plan.renderChainsByExport).flatMap((renderChain) => [
      ...renderChain.paths.flatMap((candidate) => [
        ...candidate.steps.flatMap((step) => [
          step.sourcePath,
          ...(step.evidenceSourcePaths ?? []),
        ]),
        ...(candidate.entryPoint === undefined ? [] : [candidate.entryPoint.sourcePath]),
      ]),
    ]),
    ...(plan.shallowVisualPaths
      ?.filter((item) => item.relation === 'wrapper')
      .map((item) => item.sourcePath) ?? []),
  ]);
  return new Set([...sourcePaths].map(canonicalizeExistingPath));
}

/** Reads a generic route-factory page module while ignoring framework route-location variants. */
export function collectPreviewInspectorRouteComponentSourcePaths(
  candidate: PreviewInspectorPageCandidate,
): readonly string[] {
  const routeLocation = candidate.routeLocation;
  if (
    routeLocation === undefined ||
    !('componentSourcePath' in routeLocation) ||
    typeof routeLocation.componentSourcePath !== 'string'
  ) {
    return [];
  }
  const recursivePathValue: unknown =
    'componentSourcePaths' in routeLocation ? routeLocation.componentSourcePaths : undefined;
  const recursivePaths = Array.isArray(recursivePathValue)
    ? recursivePathValue.filter((item: unknown): item is string => typeof item === 'string')
    : [];
  return [...new Set([routeLocation.componentSourcePath, ...recursivePaths])];
}

/** Checks trusted-root containment while rejecting sibling-prefix lookalikes. */
export function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

/** Leaves installed or vendored dependency graphs under their normal package runtime semantics. */
export function containsDependencyDirectory(rootPath: string, candidatePath: string): boolean {
  // prettier-ignore
  return path.relative(rootPath, candidatePath).split(path.sep).some((segment) => segment === 'node_modules');
}
