import { createPreviewDependencyResolutionHintIdentity } from './previewDependencyResolutionHintIdentity';
/** Coordinates bounded adaptive passes and writes their shared setup, portal, and legacy-global outcomes. */
import { throwIfPreviewBuildCancelled } from '../../domain/previewBuildExecution';
import { discoverPreviewGlobalPackageBridges } from './globalPackageBridge';
import { createPreviewBuildPlanIdentity } from './previewBuildPlanIdentity';
import {
  haveEquivalentGlobalPackageBridges,
  haveEquivalentRouterSelections,
  selectPreviewInitialRouterBuild,
  selectPreviewRouterBuild,
  type PreviewRouterBuildSelection,
} from './previewCompilerDefaults';
import type {
  PreviewCompilerAdaptiveInputs,
  PreviewCompilerAdaptiveInputsServices,
} from './previewCompilerPhaseInputs';
import { discoverPreviewLegacyCommonJsGlobals } from './previewLegacyCommonJsGlobalDiscovery';
import {
  mergePreviewPortalHostIds,
  refinePreviewPortalHostsFromBuild,
} from './previewPortalHostBuildRefinement';
import { type PreviewRuntimeEnvironment } from './previewRuntimeEnvironment';

/** Executes one phase with explicit prepared inputs and caller-owned service lifetimes. */
export async function executePreviewCompilerAdaptiveBuild(
  inputs: PreviewCompilerAdaptiveInputs,
  services: PreviewCompilerAdaptiveInputsServices,
  environment: PreviewRuntimeEnvironment,
): ReturnType<typeof inputs.runBuild> {
  const adaptivePlanKey = createPreviewBuildPlanIdentity({
    dependencyResolutionHints: createPreviewDependencyResolutionHintIdentity(
      inputs.activeDependencyResolutionHints,
    ),
    documentPath: inputs.request.documentPath,
    environment,
    managedDependencyEnvironment: inputs.managedDependencyEnvironment.identity,
    preparationMode: inputs.request.preparationMode,
    projectRoot: inputs.projectRoot,
    renderMode: inputs.request.renderMode,
    tsconfigPath: inputs.request.tsconfigPath,
    workspaceRoot: inputs.canonicalWorkspaceRoot,
  });
  const cachedPlan = services.adaptiveBuildPlanCache.read(adaptivePlanKey);
  inputs.buildState.legacyCommonJsGlobalNames = cachedPlan?.legacyCommonJsGlobalNames ?? [];
  inputs.buildState.portalHostIds = mergePreviewPortalHostIds(
    inputs.styleContext.portalHostIds,
    cachedPlan?.portalHostIds ?? [],
  );
  const initialGlobalPackagePlan = await discoverPreviewGlobalPackageBridges({
    ...inputs.globalBridgeEvidencePolicy,
    nodeModulesPaths: inputs.managedDependencyEnvironment.nodeModulesPaths,
    projectRoot: inputs.projectRoot,
    referencedGlobalNames: [
      ...new Set([
        ...(cachedPlan?.referencedGlobalNames ?? []),
        ...inputs.adaptiveBuildSeed.referencedGlobalNames,
      ]),
    ].sort(),
    workspaceRoot: inputs.canonicalWorkspaceRoot,
  });
  const initialRouterSelection: PreviewRouterBuildSelection = selectPreviewInitialRouterBuild(
    cachedPlan?.routerRequirement,
    inputs.routerNeed,
    inputs.adaptiveBuildSeed.routerRequirement,
    inputs.request.renderMode,
  );
  let fallbackBoundary = inputs.createStorybookFallbackBoundary(environment);
  inputs.buildState.activeStorybookFallbackBoundary = fallbackBoundary;
  const initialBuild = await inputs.runBuild(
    environment,
    initialRouterSelection,
    initialGlobalPackagePlan,
    1,
    fallbackBoundary,
  );
  const exactGlobalPackagePlan = await discoverPreviewGlobalPackageBridges({
    ...inputs.globalBridgeEvidencePolicy,
    nodeModulesPaths: inputs.managedDependencyEnvironment.nodeModulesPaths,
    projectRoot: inputs.projectRoot,
    referencedGlobalNames: initialBuild.referencedGlobalNames,
    workspaceRoot: inputs.canonicalWorkspaceRoot,
  });
  const exactRouterSelection = selectPreviewRouterBuild(
    initialBuild.routerRequirement,
    inputs.request.renderMode,
  );
  const planIsExact =
    haveEquivalentRouterSelections(initialRouterSelection, exactRouterSelection) &&
    haveEquivalentGlobalPackageBridges(initialBuild.globalPackagePlan, exactGlobalPackagePlan);
  let finalBuild = initialBuild;
  if (!planIsExact) {
    fallbackBoundary = inputs.createStorybookFallbackBoundary(environment);
    inputs.buildState.activeStorybookFallbackBoundary = fallbackBoundary;
    finalBuild = await inputs.runBuild(
      environment,
      exactRouterSelection,
      exactGlobalPackagePlan,
      2,
      fallbackBoundary,
    );
  }
  const readReachedSource = (
    sourcePath: string,
    maximumBytes: number,
  ): Promise<string | undefined> =>
    services.projectUsageCache.readSourceText({ maximumBytes, sourcePath });
  const [portalRefinement, legacyCommonJsRefinement] = await Promise.all([
    refinePreviewPortalHostsFromBuild({
      baselineHostIds: inputs.styleContext.portalHostIds,
      currentHostIds: inputs.buildState.portalHostIds,
      metafile: finalBuild.result.metafile,
      readSource: readReachedSource,
      request: inputs.request,
    }),
    discoverPreviewLegacyCommonJsGlobals({
      currentGlobalNames: inputs.buildState.legacyCommonJsGlobalNames,
      metafile: finalBuild.result.metafile,
      readSource: readReachedSource,
      request: inputs.request,
    }),
  ]);
  inputs.buildState.portalHostIds = portalRefinement.hostIds;
  inputs.buildState.legacyCommonJsGlobalNames = legacyCommonJsRefinement.globalNames;
  if (portalRefinement.changed || legacyCommonJsRefinement.changed) {
    /*
     * Post-build refinement changes generated entry/define bytes, so returning the graph that
     * merely discovered those values postpones compatibility until a later hot compile. Close
     * both proof-based refinements in one bounded same-request pass. Their discovery reads the
     * already successful graph and neither plan is allowed to recursively schedule a rebuild.
     */
    fallbackBoundary = inputs.createStorybookFallbackBoundary(environment);
    inputs.buildState.activeStorybookFallbackBoundary = fallbackBoundary;
    finalBuild = await inputs.runBuild(
      environment,
      exactRouterSelection,
      exactGlobalPackagePlan,
      2,
      fallbackBoundary,
    );
  }
  throwIfPreviewBuildCancelled(inputs.buildSignal);
  services.adaptiveBuildPlanCache.write(adaptivePlanKey, {
    legacyCommonJsGlobalNames: inputs.buildState.legacyCommonJsGlobalNames,
    portalHostIds: inputs.buildState.portalHostIds,
    referencedGlobalNames: finalBuild.referencedGlobalNames,
    routerRequirement: finalBuild.routerRequirement,
  });
  return finalBuild;
}
