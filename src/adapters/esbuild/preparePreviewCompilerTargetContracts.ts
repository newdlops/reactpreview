/** Resolves exact target-role contracts from bounded authored-source evidence without evaluating project modules. */
import path from 'node:path';
import { PreviewCompilationError } from '../../domain/preview';
import { throwIfPreviewBuildCancelled } from '../../domain/previewBuildExecution';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import {
  createPreviewInspectorExecutionRootModuleContract,
  createPreviewInspectorTargetModuleContract,
  resolvePreviewInspectorRuntimeOwnershipTarget,
  resolvePreviewInspectorRuntimeTargetMode,
} from './inspector';
import {
  isPreviewInspectorEffectControllerRenderOutcomePlan,
  isPreviewInspectorNavigationOnlyRenderOutcomePlan,
} from './pageInspector/previewInspectorTargetOutputRuntimeSource';
import { preparePreviewAdaptiveBuildSeed } from './previewAdaptiveBuildSeed';
import type {
  PreviewCompilerTargetContractInputs,
  PreviewCompilerTargetContracts,
  PreviewCompilerTargetContractServices,
} from './previewCompilerPhaseInputs';
import { collectPreviewDragDropRequirement } from './previewDragDropRequirement';
import { analyzePreviewReactRenderOutcomes } from './staticResources/previewReactRenderOutcomes';

/** Preserves contract validation and cancellation order before the first native graph build. */
export async function preparePreviewCompilerTargetContracts(
  inputs: PreviewCompilerTargetContractInputs,
  services: PreviewCompilerTargetContractServices,
): Promise<PreviewCompilerTargetContracts> {
  const analysisTarget =
    inputs.activeInspectorPlan?.target ?? inputs.targetUsageProps.inspectorPlan?.target;
  const runtimeTargetMode = resolvePreviewInspectorRuntimeTargetMode(
    inputs.activeInspectorPlan,
    inputs.request.inspectorTargetMode,
  );
  let runtimeOwnershipTarget =
    inputs.plannedRouteExecution?.runtimeOwnershipTarget ?? analysisTarget;
  if (inputs.plannedRouteExecution === undefined && runtimeTargetMode !== undefined) {
    if (inputs.request.renderMode !== 'page-inspector' || analysisTarget === undefined) {
      throw new PreviewCompilationError(
        'React Preview could not validate the selected route leaf for runtime ownership.',
        [
          {
            location: { column: 0, file: inputs.request.documentPath, line: 1 },
            message: 'Selected-route ownership requires an exact Page Inspector analysis target.',
            severity: 'error',
          },
        ],
      );
    }
    const selectedLeafPath =
      inputs.activePageExecutionCandidate?.browserCandidate.target?.sourcePath;
    const selectedLeafSourceText =
      selectedLeafPath === undefined
        ? undefined
        : (inputs.snapshotSourceByPath.get(path.normalize(selectedLeafPath)) ??
          (await services.projectUsageCache.readSourceText({
            maximumBytes: 1024 * 1024,
            sourcePath: selectedLeafPath,
          })));
    runtimeOwnershipTarget = resolvePreviewInspectorRuntimeOwnershipTarget({
      analysisTarget,
      ...(inputs.activePageExecutionCandidate === undefined
        ? {}
        : { candidate: inputs.activePageExecutionCandidate }),
      diagnosticPath: inputs.request.documentPath,
      ...(inputs.request.inspectorRouteSelection === undefined
        ? {}
        : { routeSelection: inputs.request.inspectorRouteSelection }),
      ...(inputs.activeInspectorPlan?.routeSelectionResolution === undefined
        ? {}
        : { routeSelectionResolution: inputs.activeInspectorPlan.routeSelectionResolution }),
      ...(selectedLeafSourceText === undefined ? {} : { selectedLeafSourceText }),
      targetMode: runtimeTargetMode,
    });
  }
  throwIfPreviewBuildCancelled(inputs.buildSignal);
  const runtimeTargetReference = runtimeOwnershipTarget ?? analysisTarget;
  const selectedTargetExportNames =
    runtimeTargetReference === undefined
      ? []
      : runtimeTargetMode === 'selected-route-leaf'
        ? [runtimeTargetReference.exportName]
        : Object.keys(
            (inputs.targetUsageProps.inspectorPlan ?? inputs.activeInspectorPlan)
              ?.renderChainsByExport ?? {},
          );
  const targetModuleSourceText =
    runtimeTargetReference === undefined
      ? undefined
      : (inputs.snapshotSourceByPath.get(path.normalize(runtimeTargetReference.sourcePath)) ??
        (path.normalize(runtimeTargetReference.sourcePath) ===
        path.normalize(inputs.request.documentPath)
          ? inputs.request.sourceText
          : await services.projectUsageCache.readSourceText({
              maximumBytes: 1024 * 1024,
              sourcePath: runtimeTargetReference.sourcePath,
            })));
  if (
    runtimeTargetReference !== undefined &&
    inputs.request.renderMode === 'page-inspector' &&
    targetModuleSourceText === undefined
  ) {
    throw new PreviewCompilationError(
      'React Preview could not read the exact runtime ownership target.',
      [
        {
          location: {
            column: 0,
            file: runtimeTargetReference.sourcePath,
            line: 1,
          },
          message: 'The prepared target module source is unavailable.',
          severity: 'error',
        },
      ],
    );
  }
  const targetModuleContract =
    inputs.plannedRouteExecution?.targetModuleContract ??
    (runtimeTargetReference === undefined ||
    inputs.request.renderMode !== 'page-inspector' ||
    targetModuleSourceText === undefined
      ? undefined
      : createPreviewInspectorTargetModuleContract({
          preparedSourceText: inputs.targetSelection.prepareSource(
            canonicalizeExistingPath(runtimeTargetReference.sourcePath),
            targetModuleSourceText,
          ),
          selectedExportNames: selectedTargetExportNames,
          sourcePath: runtimeTargetReference.sourcePath,
        }));
  const localTargetModuleContract =
    targetModuleContract ??
    (inputs.request.renderMode !== 'page-inspector' || inputs.inspectorExportName === undefined
      ? undefined
      : createPreviewInspectorTargetModuleContract({
          preparedSourceText: inputs.targetSelection.sourceText,
          selectedExportNames: [inputs.inspectorExportName],
          sourcePath: inputs.request.documentPath,
        }));
  const localTargetModuleSourceText =
    targetModuleContract === undefined ? inputs.request.sourceText : targetModuleSourceText;
  const initialDragDropRequirement =
    localTargetModuleContract === undefined || localTargetModuleSourceText === undefined
      ? undefined
      : collectPreviewDragDropRequirement(
          localTargetModuleContract.sourcePath,
          localTargetModuleSourceText,
        );
  const runtimeTargetInferredPropsByExport =
    localTargetModuleContract === undefined || localTargetModuleSourceText === undefined
      ? inputs.inferredPropsByExport
      : inputs.collectTargetInferredProps(
          localTargetModuleContract.sourcePath,
          localTargetModuleSourceText,
        );
  const targetRenderOutcomePlans =
    localTargetModuleContract === undefined || localTargetModuleSourceText === undefined
      ? []
      : analyzePreviewReactRenderOutcomes(
          localTargetModuleContract.sourcePath,
          path.normalize(localTargetModuleContract.sourcePath) ===
            path.normalize(inputs.request.documentPath)
            ? inputs.targetSelection.sourceText
            : localTargetModuleSourceText,
        ).filter((plan) => localTargetModuleContract.selectedExportNames.includes(plan.exportName));
  const navigationOnlyTargetExportNames = targetRenderOutcomePlans
    .filter((plan) => isPreviewInspectorNavigationOnlyRenderOutcomePlan(plan))
    .map((plan) => plan.exportName);
  const effectControllerTargetExportNames = targetRenderOutcomePlans
    .filter((plan) => isPreviewInspectorEffectControllerRenderOutcomePlan(plan))
    .map((plan) => plan.exportName);
  const executionRootRole = inputs.activePageExecutionCandidate?.executionRootContract;
  const executionRootSourceText =
    executionRootRole === undefined
      ? undefined
      : (inputs.snapshotSourceByPath.get(path.normalize(executionRootRole.sourcePath)) ??
        (path.normalize(executionRootRole.sourcePath) ===
        path.normalize(inputs.request.documentPath)
          ? inputs.request.sourceText
          : await services.projectUsageCache.readSourceText({
              maximumBytes: 1024 * 1024,
              sourcePath: executionRootRole.sourcePath,
            })));
  if (executionRootRole !== undefined && executionRootSourceText === undefined) {
    throw new PreviewCompilationError(
      'React Preview could not read the exact PageExecution root.',
      [
        {
          location: {
            column: 0,
            file: executionRootRole.sourcePath,
            line: 1,
          },
          message: 'The prepared execution-root module source is unavailable.',
          severity: 'error',
        },
      ],
    );
  }
  const executionRootModuleContract =
    inputs.plannedRouteExecution?.executionRootModuleContract ??
    (executionRootRole === undefined || executionRootSourceText === undefined
      ? undefined
      : createPreviewInspectorExecutionRootModuleContract({
          ...(inputs.activePageExecutionCandidate?.criticalSurfaces.find(
            (surface) => surface.id === executionRootRole.surfaceId,
          )?.strategy === 'selected-route-surface'
            ? { allowDefaultExportFallback: true }
            : {}),
          exportName: executionRootRole.exportName,
          preparedSourceText: inputs.targetSelection.prepareSource(
            canonicalizeExistingPath(executionRootRole.sourcePath),
            executionRootSourceText,
          ),
          sourcePath: executionRootRole.sourcePath,
          surfaceId: executionRootRole.surfaceId,
        }));
  const adaptiveBuildSeed = await preparePreviewAdaptiveBuildSeed({
    globalBridgeEvidencePolicy: inputs.globalBridgeEvidencePolicy,
    nodeModulesPaths: inputs.managedDependencyEnvironment.nodeModulesPaths,
    projectRoot: inputs.projectRoot,
    readSource: (sourcePath) =>
      inputs.snapshotSourceByPath.get(path.normalize(sourcePath)) ??
      services.projectUsageCache.readSourceText({ maximumBytes: 1024 * 1024, sourcePath }),
    sourcePaths:
      inputs.preparedBundleExecution?.prepared.frontier.authenticSourcePaths ??
      inputs.activeInspectorDependencyPaths,
    staticModuleResolver: inputs.analysisStaticModuleResolver,
    workspaceRoot: inputs.canonicalWorkspaceRoot,
  });
  return {
    runtimeTargetMode,
    runtimeOwnershipTarget,
    localTargetModuleContract,
    runtimeTargetInferredPropsByExport,
    effectControllerTargetExportNames,
    navigationOnlyTargetExportNames,
    targetModuleContract,
    initialDragDropRequirement,
    executionRootModuleContract,
    adaptiveBuildSeed,
  };
}
