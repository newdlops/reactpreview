/** Shared deterministic fixtures for previewInspectorBundleFrontier regression scenarios. */
import type { PreviewInspectorAncestorPlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorAncestorPlan';
import type { PreviewInspectorPageExecutionCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionTypes';

/** Creates the minimal ancestor plan used by authored-representation dominance fixtures. */
export function createRepresentationDominancePlan(appPath: string): PreviewInspectorAncestorPlan {
  return {
    edges: [],
    pageCandidates: [],
    root: { exportName: 'SlicedPage', sourcePath: appPath },
    target: { exportName: 'AuthenticTarget', sourcePath: appPath },
  } as unknown as PreviewInspectorAncestorPlan;
}

/** Creates sliced and optionally authored representations of one synthetic page module. */
export function createRepresentationDominanceCandidate(
  appPath: string,
  includesAuthenticSurface: boolean,
  includesOptionalSurface = false,
): PreviewInspectorPageExecutionCandidate {
  return {
    browserCandidate: { id: 'selected' },
    compositionEdges: [],
    criticalSurfaces: [
      {
        bypassedWrapperNames: [],
        exportName: 'SlicedPage',
        id: 'sliced-page',
        omittedTopLevelEffectCount: 0,
        sourcePath: appPath,
        strategy: 'selected-export-slice',
        watchSourcePaths: [appPath],
      },
      ...(includesAuthenticSurface
        ? [
            {
              bypassedWrapperNames: [],
              exportName: 'AuthenticTarget',
              id: 'authentic-target',
              omittedTopLevelEffectCount: 0,
              sourcePath: appPath,
              strategy: 'authentic-module-export',
              watchSourcePaths: [appPath],
            },
          ]
        : []),
    ],
    evidenceSourcePaths: [],
    fidelity: 'page-sliced',
    id: 'candidate',
    optionalSurfaces: includesOptionalSurface
      ? [
          {
            bypassedWrapperNames: [],
            exportName: 'OptionalPage',
            id: 'optional-page',
            omittedTopLevelEffectCount: 0,
            sourcePath: appPath,
            strategy: 'selected-route-surface',
            watchSourcePaths: [appPath],
          },
        ]
      : [],
    watchSourcePaths: [appPath],
  } as never;
}
