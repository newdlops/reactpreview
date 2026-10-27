/** Collects route, owner, and visual seed evidence for a frozen bundle closure. */
import path from 'node:path';
import { collectPreviewDynamicImportInventory } from '../staticResources/previewDynamicImportInventory';
import type { PreviewInspectorAncestorPlan } from './previewInspectorAncestorPlan';
import {
  type FrontierSourceQueueItem,
  MAXIMUM_SMALL_PAGE_SHELL_DYNAMIC_IMPORTS,
  SOURCE_MODULE_PATTERN,
} from './previewInspectorBundleFrontierModel';
import { promotePendingPreviewInspectorComponent } from './previewInspectorBundleRepresentations';
import type { PreviewInspectorPageExecutionCandidate } from './previewInspectorPageExecutionTypes';
import { collectPreviewInspectorRuntimeImportInventory } from './previewInspectorRuntimeImportInventory';
import { collectPreviewInspectorShallowProjectionInventory } from './previewInspectorShallowProjection';
import { collectPreviewStaticRouteProjectionInventory } from './previewInspectorStaticRouteProjection';
import { readPreviewInspectorSelectedRouteContent } from './previewInspectorSelectedRouteContent';
import { readPreviewInspectorUnresolvedRouteFactoryOwner } from './previewInspectorUnresolvedRouteFactoryOwner';

/** Requires existing one-hop render evidence before a dynamic import can enter a v2 slice. */
export function isSelectedDynamicVisualPath(
  plan: PreviewInspectorAncestorPlan,
  importerPath: string,
  sourcePath: string,
): boolean {
  return (plan.shallowVisualPaths ?? []).some(
    (visualPath) =>
      path.normalize(visualPath.importerPath) === path.normalize(importerPath) &&
      path.normalize(visualPath.sourcePath) === path.normalize(sourcePath) &&
      visualPath.relation !== 'route-alternative',
  );
}

/** Excludes a dynamically imported page that the analyzer proved belongs to another route. */
export function isRouteAlternativeVisualPath(
  plan: PreviewInspectorAncestorPlan,
  importerPath: string,
  sourcePath: string,
): boolean {
  return (plan.shallowVisualPaths ?? []).some(
    (visualPath) =>
      path.normalize(visualPath.importerPath) === path.normalize(importerPath) &&
      path.normalize(visualPath.sourcePath) === path.normalize(sourcePath) &&
      visualPath.relation === 'route-alternative',
  );
}

/** Promotes proven JSX children of an exact render root when broad plan evidence omits them. */
export async function collectExactVisualAdmissions(
  reference: { readonly exportName: string; readonly sourcePath: string },
  optionalExportsByPath: Map<string, Set<string>>,
  optionalIdentities: Set<string>,
  pending: FrontierSourceQueueItem[],
  readSource: (sourcePath: string) => Promise<string | undefined>,
  resolveModule: (specifier: string, importer: string) => string | undefined,
  checkAuthoredPath: (sourcePath: string) => boolean,
  edgeKind: 'static' | 'dynamic-import' = 'static',
  queueKind: Extract<
    FrontierSourceQueueItem['kind'],
    'optional-component' | 'page-shell-component' | 'target-component'
  > = 'optional-component',
  plan?: PreviewInspectorAncestorPlan,
): Promise<void> {
  const importerPath = path.normalize(reference.sourcePath);
  const sourceText = await readSource(importerPath);
  if (sourceText === undefined) return;
  const inventory = collectPreviewInspectorRuntimeImportInventory(importerPath, sourceText);
  const projections = collectPreviewInspectorShallowProjectionInventory(
    importerPath,
    sourceText,
    new Set([reference.exportName]),
  );
  if (projections.truncated) return;
  const pageShellRouteOnlySpecifiers =
    queueKind === 'page-shell-component' && edgeKind === 'static'
      ? collectPreviewStaticRouteProjectionInventory(
          importerPath,
          sourceText,
          plan === undefined ? undefined : readPreviewInspectorUnresolvedRouteFactoryOwner(plan),
        ).projectionsBySpecifier
      : undefined;
  const pageShellDynamicInventory =
    queueKind === 'page-shell-component' && edgeKind === 'dynamic-import'
      ? collectPreviewDynamicImportInventory(importerPath, sourceText)
      : undefined;
  const hasExactPageShellDynamicVisualEvidence =
    pageShellDynamicInventory !== undefined &&
    plan?.shallowVisualPaths?.some(
      (visualPath) =>
        path.normalize(visualPath.importerPath) === importerPath &&
        visualPath.importKind === 'react-lazy' &&
        visualPath.relation !== 'route-alternative',
    ) === true;
  const hasBroadPageShellDynamicRegistry =
    pageShellDynamicInventory !== undefined &&
    (!pageShellDynamicInventory.reliable ||
      pageShellDynamicInventory.truncated ||
      pageShellDynamicInventory.specifiers.length > MAXIMUM_SMALL_PAGE_SHELL_DYNAMIC_IMPORTS);
  for (const projection of projections.projectionsBySpecifier.values()) {
    if (pageShellRouteOnlySpecifiers?.has(projection.moduleSpecifier) === true) continue;
    const importEdge = inventory.find(
      (edge) =>
        (edgeKind === 'dynamic-import'
          ? edge.kind === 'dynamic-import'
          : edge.kind !== 'dynamic-import') && edge.moduleSpecifier === projection.moduleSpecifier,
    );
    if (importEdge === undefined) continue;
    const resolved = resolveModule(projection.moduleSpecifier, importerPath);
    if (resolved === undefined || !checkAuthoredPath(resolved)) continue;
    const sourcePath = path.normalize(resolved);
    if (
      hasExactPageShellDynamicVisualEvidence &&
      !isSelectedDynamicVisualPath(plan, importerPath, sourcePath)
    ) {
      continue;
    }
    if (
      queueKind === 'page-shell-component' &&
      edgeKind === 'dynamic-import' &&
      plan !== undefined &&
      isRouteAlternativeVisualPath(plan, importerPath, sourcePath)
    ) {
      continue;
    }
    if (
      hasBroadPageShellDynamicRegistry &&
      (plan === undefined || !isSelectedDynamicVisualPath(plan, importerPath, sourcePath))
    ) {
      continue;
    }
    const existingExports = optionalExportsByPath.get(sourcePath);
    if (existingExports !== undefined) {
      for (const exportName of projection.exportNames) existingExports.add(exportName);
      promotePendingPreviewInspectorComponent(pending, sourcePath, queueKind);
      continue;
    }
    const identity = `${sourcePath}\0${projection.exportNames.join('\0')}`;
    const edge = Object.freeze({
      exportNames: Object.freeze([...projection.exportNames]),
      importerPath,
      moduleSpecifier: projection.moduleSpecifier,
      occurrenceStart: importEdge.occurrenceStart,
      runtimeHookExportNames: Object.freeze([...projection.runtimeHookExportNames]),
      targetPath: sourcePath,
    });
    if (optionalIdentities.has(identity)) continue;
    optionalIdentities.add(identity);
    optionalExportsByPath.set(sourcePath, new Set(projection.exportNames));
    pending.push({
      depth: 1,
      kind: queueKind,
      optionalEdge: edge,
      sourcePath,
    });
  }
}

/** Lists only named exports the generated VirtualPage can mount or compose as authored roots. */
export function collectExactVisualRoots(
  plan: PreviewInspectorAncestorPlan,
): readonly { readonly exportName: string; readonly sourcePath: string }[] {
  const roots = new Map<string, { readonly exportName: string; readonly sourcePath: string }>();
  const add = (reference: { readonly exportName: string; readonly sourcePath: string }): void => {
    roots.set(`${path.normalize(reference.sourcePath)}\0${reference.exportName}`, {
      exportName: reference.exportName,
      sourcePath: path.normalize(reference.sourcePath),
    });
  };
  add(plan.target);
  add(plan.root);
  const active = plan.pageCandidates[0];
  if (active !== undefined) {
    add(active.root);
    if (active.target !== undefined) add(active.target);
    for (const edge of active.edges) {
      add(edge.child);
      add(edge.owner);
    }
  }
  return [...roots.values()].sort(
    (left, right) =>
      left.sourcePath.localeCompare(right.sourcePath) ||
      left.exportName.localeCompare(right.exportName),
  );
}

/** Selects only active structured Inspector evidence as exact authored seeds. */
export function collectExactSeedPaths(
  plan: PreviewInspectorAncestorPlan,
  executionCandidate: PreviewInspectorPageExecutionCandidate | undefined,
): readonly string[] {
  if (executionCandidate !== undefined) {
    const selectedRouteContent = readPreviewInspectorSelectedRouteContent(executionCandidate);
    return [
      ...new Set([
        ...executionCandidate.criticalSurfaces.map((surface) => path.normalize(surface.sourcePath)),
        ...(selectedRouteContent === undefined ? [] : [selectedRouteContent.sourcePath]),
        ...collectPreviewInspectorExecutionCorridorSeedPaths(plan, executionCandidate),
      ]),
    ].sort();
  }
  const active = plan.pageCandidates[0];
  const paths = new Set<string>([plan.target.sourcePath, plan.root.sourcePath]);
  const addReference = (reference: { readonly sourcePath: string } | undefined): void => {
    if (reference !== undefined) paths.add(reference.sourcePath);
  };
  if (active !== undefined) {
    addReference(active.root);
    addReference(active.target);
    for (const edge of active.edges) {
      addReference(edge.child);
      addReference(edge.owner);
    }
    /* TODO(plan7 Phase 7/8): replace this broad compatibility inventory with the selected Page
     * Execution Candidate's critical and admitted optional surfaces. Until composition surfaces
     * are wired into the root plugin, retaining it keeps strict metafile membership sound. */
    for (const step of active.renderPath?.steps.slice(active.rootStepIndex ?? 0) ?? []) {
      paths.add(step.sourcePath);
      for (const evidencePath of step.evidenceSourcePaths ?? []) paths.add(evidencePath);
    }
    if (active.routeLocation !== undefined && 'routeMounts' in active.routeLocation) {
      for (const mount of active.routeLocation.routeMounts ?? []) paths.add(mount.sourcePath);
    }
    for (const layout of active.nextAppLayoutChain ?? []) paths.add(layout.sourcePath);
    addReference(active.nextPagesShell?.app);
    for (const contextPath of active.contextModule?.importPath ?? []) paths.add(contextPath);
  }
  for (const edge of plan.edges) {
    addReference(edge.child);
    addReference(edge.owner);
  }
  for (const contextPath of plan.contextModule?.importPath ?? []) paths.add(contextPath);
  return [...paths].map((sourcePath) => path.normalize(sourcePath)).sort();
}

/**
 * Retains the selected lazy/HOC descent between a generated page root and the current-file target.
 *
 * Page Execution surfaces describe the mount topology, but an authentic route owner can still
 * reach its selected descendant through a barrel, React.lazy import, permission HOC, and ordinary
 * component parents. Those modules are compiler-proven by the same selected render path and must
 * remain authentic frontier members; otherwise broad-registry pruning replaces the lazy page and
 * the authored owner legitimately falls through without ever invoking the target. Steps above
 * the chosen execution root remain excluded so application entry and unrelated outer routes do
 * not expand the bounded execution slice.
 */
export function collectPreviewInspectorExecutionCorridorSeedPaths(
  plan: PreviewInspectorAncestorPlan,
  executionCandidate: PreviewInspectorPageExecutionCandidate,
): readonly string[] {
  const plannedPageCandidate = plan.pageCandidates.find(
    (candidate) => candidate.id === executionCandidate.browserCandidate.id,
  );
  const executionPageCandidate = executionCandidate.browserCandidate;
  const executionRootSurface = executionCandidate.criticalSurfaces.find(
    (surface) => surface.id === executionCandidate.executionRootSurfaceId,
  );
  const executionRootPath = executionRootSurface?.sourcePath;
  const normalizedExecutionRootPath =
    executionRootPath === undefined ? undefined : path.normalize(executionRootPath);
  const executionPageRootMatchesSurface =
    normalizedExecutionRootPath !== undefined &&
    executionPageCandidate.renderPath !== undefined &&
    path.normalize(executionPageCandidate.root.sourcePath) === normalizedExecutionRootPath &&
    executionPageCandidate.root.exportName === executionRootSurface?.exportName;
  const plannedPageRootMatchesSurface =
    normalizedExecutionRootPath !== undefined &&
    plannedPageCandidate !== undefined &&
    path.normalize(plannedPageCandidate.root.sourcePath) === normalizedExecutionRootPath &&
    plannedPageCandidate.root.exportName === executionRootSurface?.exportName;
  // Page Execution can pin a selected route to an authentic owner shell after the executable
  // plan was narrowed. Prefer that compiler-owned root/render path so checkpoint recovery follows
  // the component that esbuild will actually mount; the candidate id and proven-path filter below
  // still prevent unrelated analysis paths from entering the exact frontier.
  const pageCandidate =
    plannedPageCandidate?.id === executionPageCandidate.id &&
    executionPageCandidate.renderPath !== undefined &&
    executionPageCandidate.stopReason === 'render-path-checkpoint' &&
    executionPageRootMatchesSurface &&
    !plannedPageRootMatchesSurface
      ? executionPageCandidate
      : plannedPageCandidate;
  const rootStepIndex = pageCandidate?.rootStepIndex;
  const steps = pageCandidate?.renderPath?.steps;
  if (steps === undefined) return Object.freeze([]);
  const safeRootStepIndex =
    typeof rootStepIndex === 'number' &&
    Number.isSafeInteger(rootStepIndex) &&
    rootStepIndex >= 0 &&
    rootStepIndex < steps.length
      ? rootStepIndex
      : -1;
  const hasValidRootStepIndex = safeRootStepIndex >= 0;
  const provenPaths = new Set(
    executionCandidate.evidenceSourcePaths.map((sourcePath) => path.normalize(sourcePath)),
  );
  const candidateRootPath = pageCandidate?.root.sourcePath;
  const normalizedCandidateRootPath =
    candidateRootPath === undefined ? undefined : path.normalize(candidateRootPath);
  const executionRootStepIndex =
    normalizedExecutionRootPath === undefined
      ? -1
      : steps.findIndex(
          (step, index) =>
            index >= (hasValidRootStepIndex ? safeRootStepIndex : 0) &&
            path.normalize(step.sourcePath) === normalizedExecutionRootPath,
        );
  const findExactReferenceStepIndex = (reference: {
    readonly exportName: string;
    readonly sourcePath: string;
  }): number =>
    steps.findIndex(
      (step) =>
        path.normalize(step.sourcePath) === path.normalize(reference.sourcePath) &&
        (step.label === reference.exportName ||
          (reference.exportName === 'default' && step.label === '@default')),
    );
  // Route-leaf and pinned-browser candidates intentionally omit rootStepIndex. Recover an exact
  // checkpoint whose candidate root is also the admitted execution root; other missing-index
  // shapes remain fail-closed unless selected-route evidence below proves the whole corridor.
  const canRecoverCheckpointRoot =
    !hasValidRootStepIndex &&
    pageCandidate?.stopReason === 'render-path-checkpoint' &&
    normalizedCandidateRootPath !== undefined &&
    normalizedCandidateRootPath === normalizedExecutionRootPath &&
    pageCandidate.root.exportName === executionRootSurface?.exportName;
  const routeLocation = pageCandidate?.routeLocation;
  const routeTarget = pageCandidate?.target;
  const routeComponentSourcePath =
    routeLocation !== undefined && 'componentSourcePath' in routeLocation
      ? routeLocation.componentSourcePath
      : undefined;
  const routeComponentExportName =
    routeLocation !== undefined && 'componentExportName' in routeLocation
      ? routeLocation.componentExportName
      : undefined;
  const routeOwnerMatchesExecutionRoot =
    routeLocation !== undefined &&
    normalizedExecutionRootPath !== undefined &&
    path.normalize(routeLocation.sourcePath) === normalizedExecutionRootPath;
  const routeTargetMatchesLocation =
    routeComponentSourcePath !== undefined &&
    routeTarget !== undefined &&
    path.normalize(routeComponentSourcePath) === path.normalize(routeTarget.sourcePath) &&
    (routeComponentExportName ?? 'default') === routeTarget.exportName;
  const analysisTargetStepIndex = findExactReferenceStepIndex(plan.target);
  const candidateRootStepIndex =
    pageCandidate === undefined ? -1 : findExactReferenceStepIndex(pageCandidate.root);
  const routeTargetStepIndex =
    routeTarget === undefined ? -1 : findExactReferenceStepIndex(routeTarget);
  const exactExecutionRootStepIndex =
    executionRootSurface === undefined ? -1 : findExactReferenceStepIndex(executionRootSurface);
  const selectedRouteCorridorIsProven =
    analysisTargetStepIndex >= 0 &&
    exactExecutionRootStepIndex >= analysisTargetStepIndex &&
    steps
      .slice(analysisTargetStepIndex, exactExecutionRootStepIndex + 1)
      .every((step) => provenPaths.has(path.normalize(step.sourcePath)));
  // Expanding a statically selected route intentionally replaces the browser candidate target
  // with its barrel export and omits rootStepIndex. Admit that shape only when the exact ordered
  // target -> page root -> route export -> route owner chain is present in the selected path.
  const canRecoverSelectedRouteRoot =
    !hasValidRootStepIndex &&
    pageCandidate?.stopReason === 'root-reached' &&
    routeOwnerMatchesExecutionRoot &&
    routeTargetMatchesLocation &&
    selectedRouteCorridorIsProven &&
    analysisTargetStepIndex >= 0 &&
    candidateRootStepIndex >= analysisTargetStepIndex &&
    routeTargetStepIndex >= candidateRootStepIndex &&
    exactExecutionRootStepIndex >= routeTargetStepIndex;
  if (
    !hasValidRootStepIndex &&
    ((!canRecoverCheckpointRoot && !canRecoverSelectedRouteRoot) || executionRootStepIndex < 0)
  ) {
    return Object.freeze([]);
  }
  const corridorEndStepIndex = Math.max(safeRootStepIndex, executionRootStepIndex);
  const corridorPaths = new Set<string>();
  for (const step of steps.slice(0, corridorEndStepIndex + 1)) {
    for (const sourcePath of [step.sourcePath, ...(step.evidenceSourcePaths ?? [])]) {
      const normalizedPath = path.normalize(sourcePath);
      if (provenPaths.has(normalizedPath)) corridorPaths.add(normalizedPath);
    }
  }
  return Object.freeze([...corridorPaths].sort());
}

/** Excludes installed dependencies and non-source resources from authored graph accounting. */
export function isAuthoredPath(workspaceRoot: string, sourcePath: string): boolean {
  const relative = path.relative(path.normalize(workspaceRoot), path.normalize(sourcePath));
  return (
    relative.length > 0 &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !relative.split(path.sep).includes('node_modules') &&
    SOURCE_MODULE_PATTERN.test(sourcePath)
  );
}

/** Normalizes package subpaths so each package consumes one demand identity. */
export function normalizeBarePackageSpecifier(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:'))
    return undefined;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}
