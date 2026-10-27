/** Initializes exact and optional visual seed admissions before authored-closure queue traversal. */
import path from 'node:path';
import { type FrontierSourceQueueItem } from './previewInspectorBundleFrontierModel';
import type { PreviewInspectorProjectedEdge } from './previewInspectorBundleFrontierTypes';
import {
  collectAuthenticInventorySourcePaths,
  compareVisualPaths,
} from './previewInspectorBundleRepresentations';
import {
  collectExactSeedPaths,
  collectExactVisualAdmissions,
  collectExactVisualRoots,
} from './previewInspectorBundleSeeds';
import { collectPreviewInspectorExecutionRouteParameterGroups } from './previewInspectorRouteParameterBranch';
import { readPreviewInspectorSelectedRouteContent } from './previewInspectorSelectedRouteContent';
/** Inert callbacks and candidate evidence used only while constructing the initial work queue. */
interface PreviewInspectorBundleInitialSeedInputs {
  readonly options: import('./previewInspectorBundleFrontierModel').PreparePreviewInspectorBundleFrontierOptions;
  readonly checkAuthoredPath: (sourcePath: string) => boolean;
  readonly readRawSource: (sourcePath: string) => Promise<string | undefined>;
  readonly resolveModule: (specifier: string, importer: string) => string | undefined;
}
/** Mutable queue and admission sets shared by reference with the following traversal. */
interface PreviewInspectorBundleInitialSeeds {
  readonly pending: import('./previewInspectorBundleFrontierModel').FrontierSourceQueueItem[];
  readonly authenticInventorySourcePaths: ReadonlySet<string>;
  readonly projectedEdges: import('./previewInspectorBundleFrontierTypes').PreviewInspectorProjectedEdge[];
  readonly optionalExportsByPath: Map<string, Set<string>>;
  readonly optionalIdentities: Set<string>;
  readonly exactSeedPaths: Set<string>;
  readonly selectedRouteParameterGroups: import('./previewInspectorRouteParameterBranch').PreviewInspectorRouteParameterGroups;
}
/** Keeps authored seed order and the exact optional-admission transaction boundaries. */
export async function preparePreviewInspectorBundleInitialSeeds(
  inputs: PreviewInspectorBundleInitialSeedInputs,
): Promise<PreviewInspectorBundleInitialSeeds> {
  const authenticInventorySourcePaths = collectAuthenticInventorySourcePaths(inputs.options);
  const selectedRouteParameterGroups = collectPreviewInspectorExecutionRouteParameterGroups(
    inputs.options.executionCandidate,
  );
  const exactSeedPaths = new Set(
    collectExactSeedPaths(inputs.options.plan, inputs.options.executionCandidate).map(
      (sourcePath) => path.normalize(sourcePath),
    ),
  );
  const pending: FrontierSourceQueueItem[] = [
    ...exactSeedPaths,
    ...(inputs.options.runtimeCompanionSourcePaths ?? []),
  ]
    .filter(inputs.checkAuthoredPath)
    .map((sourcePath) => ({ depth: 0, kind: 'exact', sourcePath }));
  const projectedEdges: PreviewInspectorProjectedEdge[] = [];
  const optionalExportsByPath = new Map<string, Set<string>>();
  const optionalIdentities = new Set<string>();
  for (const visualPath of [...(inputs.options.plan.shallowVisualPaths ?? [])]
    .filter(
      (candidate) =>
        inputs.options.executionCandidate === undefined ||
        exactSeedPaths.has(path.normalize(candidate.importerPath)),
    )
    .sort(compareVisualPaths)) {
    if (
      visualPath.relation === 'route-alternative' ||
      !inputs.checkAuthoredPath(visualPath.sourcePath)
    )
      continue;
    const sourcePath = path.normalize(visualPath.sourcePath);
    const edge = Object.freeze({
      exportNames: Object.freeze([visualPath.exportName]),
      importerPath: path.normalize(visualPath.importerPath),
      moduleSpecifier: visualPath.moduleSpecifier,
      occurrenceStart: visualPath.occurrenceStart,
      runtimeHookExportNames: Object.freeze([]),
      targetPath: sourcePath,
    });
    const identity = `${sourcePath}\0${visualPath.exportName}`;
    if (optionalIdentities.has(identity)) continue;
    optionalIdentities.add(identity);
    const exports = optionalExportsByPath.get(sourcePath) ?? new Set<string>();
    exports.add(visualPath.exportName);
    optionalExportsByPath.set(sourcePath, exports);
    pending.push({ depth: 1, kind: 'optional-component', optionalEdge: edge, sourcePath });
  }
  for (const reference of inputs.options.executionCandidate === undefined
    ? collectExactVisualRoots(inputs.options.plan)
    : []) {
    await collectExactVisualAdmissions(
      reference,
      optionalExportsByPath,
      optionalIdentities,
      pending,
      inputs.readRawSource,
      inputs.resolveModule,
      inputs.checkAuthoredPath,
    );
  }
  const authenticRuntimeTargetSurface = inputs.options.executionCandidate?.criticalSurfaces.find(
    (surface) =>
      surface.id === inputs.options.executionCandidate?.runtimeTargetSurfaceId &&
      surface.strategy === 'authentic-module-export',
  );
  if (authenticRuntimeTargetSurface !== undefined) {
    await collectExactVisualAdmissions(
      authenticRuntimeTargetSurface,
      optionalExportsByPath,
      optionalIdentities,
      pending,
      inputs.readRawSource,
      inputs.resolveModule,
      inputs.checkAuthoredPath,
      'static',
      'target-component',
    );
    await collectExactVisualAdmissions(
      authenticRuntimeTargetSurface,
      optionalExportsByPath,
      optionalIdentities,
      pending,
      inputs.readRawSource,
      inputs.resolveModule,
      inputs.checkAuthoredPath,
      'dynamic-import',
      'target-component',
    );
  }
  const fullAuthoredExecutionRootSurface = inputs.options.executionCandidate?.criticalSurfaces.find(
    (surface) =>
      surface.id === inputs.options.executionCandidate?.executionRootSurfaceId &&
      (surface.strategy === 'authentic-module-export' ||
        surface.strategy === 'selected-route-surface'),
  );
  if (
    fullAuthoredExecutionRootSurface !== undefined &&
    (fullAuthoredExecutionRootSurface.sourcePath !== authenticRuntimeTargetSurface?.sourcePath ||
      fullAuthoredExecutionRootSurface.exportName !== authenticRuntimeTargetSurface.exportName)
  ) {
    await collectExactVisualAdmissions(
      fullAuthoredExecutionRootSurface,
      optionalExportsByPath,
      optionalIdentities,
      pending,
      inputs.readRawSource,
      inputs.resolveModule,
      inputs.checkAuthoredPath,
      'static',
      'page-shell-component',
      inputs.options.plan,
    );
    await collectExactVisualAdmissions(
      fullAuthoredExecutionRootSurface,
      optionalExportsByPath,
      optionalIdentities,
      pending,
      inputs.readRawSource,
      inputs.resolveModule,
      inputs.checkAuthoredPath,
      'dynamic-import',
      'page-shell-component',
      inputs.options.plan,
    );
  }
  const selectedRouteContent = readPreviewInspectorSelectedRouteContent(
    inputs.options.executionCandidate,
  );
  if (
    selectedRouteContent !== undefined &&
    inputs.checkAuthoredPath(selectedRouteContent.sourcePath)
  ) {
    for (const edgeKind of ['static', 'dynamic-import'] as const) {
      await collectExactVisualAdmissions(
        selectedRouteContent,
        optionalExportsByPath,
        optionalIdentities,
        pending,
        inputs.readRawSource,
        inputs.resolveModule,
        inputs.checkAuthoredPath,
        edgeKind,
        'page-shell-component',
        inputs.options.plan,
      );
    }
  }
  for (const surface of inputs.options.executionCandidate?.optionalSurfaces ?? []) {
    const sourcePath = path.normalize(surface.sourcePath);
    if (!inputs.checkAuthoredPath(sourcePath)) continue;
    const identity = `${sourcePath}\0${surface.exportName}`;
    if (optionalIdentities.has(identity)) continue;
    optionalIdentities.add(identity);
    const edge = Object.freeze({
      exportNames: Object.freeze([surface.exportName]),
      importerPath: sourcePath,
      moduleSpecifier: surface.sourcePath,
      occurrenceStart: 0,
      runtimeHookExportNames: Object.freeze([]),
      targetPath: sourcePath,
    });
    const exports = optionalExportsByPath.get(sourcePath) ?? new Set<string>();
    for (const exportName of edge.exportNames) exports.add(exportName);
    optionalExportsByPath.set(sourcePath, exports);
    pending.push({
      depth: 1,
      kind: 'optional-component',
      optionalEdge: edge,
      sourcePath,
    });
  }
  return {
    pending,
    authenticInventorySourcePaths,
    projectedEdges,
    optionalExportsByPath,
    optionalIdentities,
    exactSeedPaths,
    selectedRouteParameterGroups,
  };
}
