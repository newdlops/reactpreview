/**
 * Defines the fixed graph-cost contract for each preview preparation mode.
 * Keeping this decision in one pure module prevents individual compiler branches from drifting.
 */
import type { PreviewBuildRequest, PreviewPreparationMode } from '../../domain/preview';
import {
  createPreviewCompilerFrontierPolicy,
  type PreviewCompilerFrontierPolicy,
} from '../../domain/previewCompilerFrontier';
import type { PreviewCompilerFrontierActivity } from '../../domain/previewCompilerActivity';

export type PreviewCompilerDiscoveryScope = 'selected-corridor' | 'workspace';

export interface PreviewPreparationPolicy {
  readonly allowAutomaticStorybook: boolean;
  readonly boundedTailwindSourceDiscovery: boolean;
  readonly collectRuntimeWatchInputs: boolean;
  readonly deferDormantOverlayImports: boolean;
  readonly frontierPolicy?: PreviewCompilerFrontierPolicy;
  readonly discoveryScope: PreviewCompilerDiscoveryScope;
  readonly maximumSmallDynamicImports?: number;
  readonly mode: PreviewPreparationMode;
  readonly optimizeSelectedPackageBarrels: boolean;
  readonly runtimeEvidence: 'critical' | 'complete';
  readonly styleEvidence: 'critical' | 'selected-complete' | 'workspace-complete';
  readonly useFastSourceCompatibility: boolean;
}

/** Returns the immutable policy for a request; omitted mode preserves the legacy full contract. */
export function createPreviewPreparationPolicy(
  request: Pick<PreviewBuildRequest, 'preparationMode' | 'useStorybookPreview'>,
): PreviewPreparationPolicy {
  const mode = request.preparationMode ?? 'full';
  if (mode === 'fast') {
    const frontierPolicy = createPreviewCompilerFrontierPolicy(mode);
    return {
      allowAutomaticStorybook: false,
      boundedTailwindSourceDiscovery: true,
      collectRuntimeWatchInputs: false,
      deferDormantOverlayImports: true,
      ...(frontierPolicy === undefined ? {} : { frontierPolicy }),
      discoveryScope: 'selected-corridor',
      maximumSmallDynamicImports: 8,
      mode,
      optimizeSelectedPackageBarrels: true,
      runtimeEvidence: 'critical',
      styleEvidence: 'critical',
      useFastSourceCompatibility: true,
    };
  }
  if (mode === 'corridor') {
    const frontierPolicy = createPreviewCompilerFrontierPolicy(mode);
    return {
      allowAutomaticStorybook: false,
      boundedTailwindSourceDiscovery: true,
      collectRuntimeWatchInputs: true,
      deferDormantOverlayImports: true,
      ...(frontierPolicy === undefined ? {} : { frontierPolicy }),
      discoveryScope: 'selected-corridor',
      maximumSmallDynamicImports: 8,
      mode,
      optimizeSelectedPackageBarrels: true,
      runtimeEvidence: 'complete',
      styleEvidence: 'selected-complete',
      useFastSourceCompatibility: false,
    };
  }
  return {
    allowAutomaticStorybook: request.useStorybookPreview ?? true,
    boundedTailwindSourceDiscovery: false,
    collectRuntimeWatchInputs: true,
    deferDormantOverlayImports: false,
    discoveryScope: 'workspace',
    mode,
    optimizeSelectedPackageBarrels: false,
    runtimeEvidence: 'complete',
    styleEvidence: 'workspace-complete',
    useFastSourceCompatibility: false,
  };
}

/** Projects one automatic policy into bounded graph-plan telemetry. */
export function createPreviewFrontierActivity(
  policy: PreviewPreparationPolicy,
  corridorSourceCount: number,
): PreviewCompilerFrontierActivity | undefined {
  const frontier = policy.frontierPolicy;
  if (frontier === undefined) return undefined;
  const rejected = corridorSourceCount > frontier.maximumTotalAuthoredModuleCount;
  return {
    maximumTotalModules: frontier.maximumTotalAuthoredModuleCount,
    reasons: rejected ? ['exact-module-count'] : [],
    rejected,
  };
}
