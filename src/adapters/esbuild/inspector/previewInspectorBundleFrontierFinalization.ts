/** Pure deterministic finalization primitives shared by bundle-frontier construction and tests. */
import { createHash } from 'node:crypto';
import type {
  PreviewCompilerFrontierPolicy,
  PreviewCompilerFrontierReason,
} from '../../../domain/previewCompilerFrontier';
import type { PreviewInspectorPageExecutionCandidate } from './previewInspectorPageExecutionTypes';
import type {
  PreviewInspectorBundleFrontier,
  PreviewInspectorProjectedEdge,
} from './previewInspectorBundleFrontierTypes';

export const PREVIEW_INSPECTOR_BUNDLE_FRONTIER_FORMAT_VERSION = 1;
export const PREVIEW_INSPECTOR_PAGE_EXECUTION_FRONTIER_FORMAT_VERSION = 2;

/** Returns structural failure reasons in deterministic diagnostic order. */
export function sortPreviewInspectorBundleFrontierReasons(
  reasons: ReadonlySet<PreviewCompilerFrontierReason>,
): readonly PreviewCompilerFrontierReason[] {
  const ordered: readonly PreviewCompilerFrontierReason[] = [
    'exact-source-unreadable',
    'source-parse-failure',
    'slice-unavailable',
    'frontier-mismatch',
  ];
  return ordered.filter((reason) => reasons.has(reason));
}

/** Produces a context-reuse key from immutable membership and fixed policy values. */
export function createPreviewInspectorBundleFrontierIdentity(
  policy: Readonly<Pick<PreviewCompilerFrontierPolicy, 'mode'>>,
  executionCandidate: PreviewInspectorPageExecutionCandidate | undefined,
  authenticSourcePaths: readonly string[],
  exactSourcePaths: readonly string[],
  packageDemandSourcePaths: readonly string[],
  components: PreviewInspectorBundleFrontier['authenticComponentExports'],
  projectedEdges: readonly PreviewInspectorProjectedEdge[],
  summary: PreviewInspectorBundleFrontier['summary'],
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        authenticSourcePaths,
        components,
        executionCandidate:
          executionCandidate === undefined
            ? undefined
            : {
                compositionEdges: executionCandidate.compositionEdges,
                fidelity: executionCandidate.fidelity,
                id: executionCandidate.id,
                optionalSurfaces: executionCandidate.optionalSurfaces,
                routeRecipe: executionCandidate.routeRecipe,
                surfaces: executionCandidate.criticalSurfaces,
              },
        exactSourcePaths,
        packageDemandSourcePaths,
        policy,
        projectedEdges,
        summary,
        version:
          executionCandidate === undefined
            ? PREVIEW_INSPECTOR_BUNDLE_FRONTIER_FORMAT_VERSION
            : PREVIEW_INSPECTOR_PAGE_EXECUTION_FRONTIER_FORMAT_VERSION,
      }),
    )
    .digest('hex');
}
