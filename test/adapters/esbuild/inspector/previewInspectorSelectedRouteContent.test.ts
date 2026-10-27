/** Keeps a selected factory page executable without promoting unrelated target-only fallbacks. */
import { describe, expect, it } from 'vitest';
import { readPreviewInspectorSelectedRouteContent } from '../../../../src/adapters/esbuild/inspector/previewInspectorSelectedRouteContent';
import type { PreviewInspectorPageExecutionCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionTypes';
import { createCandidate } from './previewInspectorVirtualPagePlanFixtures';

const owner = { exportName: 'FeatureApp', sourcePath: '/workspace/FeatureApp.tsx' };
const leaf = { exportName: 'CreatePage', sourcePath: '/workspace/CreatePage.tsx' };

/** Mirrors an authentic factory owner selected as both current-file target and execution root. */
function createOwnerExecution(): PreviewInspectorPageExecutionCandidate {
  const surface = {
    ...owner,
    id: 'owner',
    strategy: 'authentic-module-export' as const,
    bypassedWrapperNames: [],
    omittedTopLevelEffectCount: 0,
    watchSourcePaths: [owner.sourcePath],
  };
  return {
    id: 'owner-execution',
    fidelity: 'target-only',
    compositionEdges: [],
    criticalSurfaces: [surface],
    evidenceSourcePaths: [owner.sourcePath, leaf.sourcePath],
    optionalSurfaces: [],
    executionRootContract: { ...owner, surfaceId: surface.id },
    executionRootSurfaceId: surface.id,
    runtimeTargetContract: { ...owner, surfaceId: surface.id },
    runtimeTargetSurfaceId: surface.id,
    watchSourcePaths: [owner.sourcePath, leaf.sourcePath],
    browserCandidate: createCandidate({
      root: owner,
      target: owner,
      routeLocation: {
        componentName: leaf.exportName,
        componentExportName: leaf.exportName,
        componentSourcePath: leaf.sourcePath,
        dependencyPaths: [owner.sourcePath, leaf.sourcePath],
        evidenceKind: 'route-catalog',
        pathname: '/feature/create',
        pattern: '/feature/create',
        sourcePath: owner.sourcePath,
        routeMounts: [
          { ...owner, basePath: '/feature', routeSlotCount: 1, hasWildcardFallback: true },
        ],
      },
    }),
  };
}

describe('selected content under an authentic current-file factory owner', () => {
  it('retains the selected child even when the owner has no outer page caller', () => {
    expect(readPreviewInspectorSelectedRouteContent(createOwnerExecution())).toEqual(leaf);
  });

  it.each([
    'missing-mount',
    'no-slots',
    'other-owner-export',
    'other-owner-file',
    'other-runtime-target',
    'other-execution-root',
    'other-browser-root',
    'projected-owner',
    'error-slot',
  ])('keeps unrelated target-only recovery excluded: %s', (mismatch) => {
    let candidate = createOwnerExecution();
    const location = candidate.browserCandidate.routeLocation;
    if (location === undefined || !('routeMounts' in location))
      throw new Error('Missing fixture route mount.');
    const mount = location.routeMounts[0];
    if (mount === undefined) throw new Error('Missing fixture owner.');
    if (
      mismatch === 'missing-mount' ||
      mismatch === 'no-slots' ||
      mismatch.startsWith('other-owner-')
    ) {
      candidate = {
        ...candidate,
        browserCandidate: {
          ...candidate.browserCandidate,
          routeLocation: {
            ...location,
            routeMounts:
              mismatch === 'missing-mount'
                ? []
                : [
                    {
                      ...mount,
                      ...(mismatch === 'no-slots' ? { routeSlotCount: 0 } : {}),
                      ...(mismatch === 'other-owner-export' ? { exportName: 'DifferentApp' } : {}),
                      ...(mismatch === 'other-owner-file'
                        ? { sourcePath: '/workspace/OtherApp.tsx' }
                        : {}),
                    },
                  ],
          },
        },
      };
    } else if (mismatch === 'other-runtime-target') {
      candidate = {
        ...candidate,
        runtimeTargetContract: { ...candidate.runtimeTargetContract, exportName: 'DifferentApp' },
      };
    } else if (mismatch === 'other-execution-root') {
      candidate = { ...candidate, executionRootSurfaceId: 'different-root' };
    } else if (mismatch === 'other-browser-root') {
      candidate = { ...candidate, browserCandidate: { ...candidate.browserCandidate, root: leaf } };
    } else if (mismatch === 'projected-owner') {
      candidate = {
        ...candidate,
        criticalSurfaces: candidate.criticalSurfaces.map((surface) => ({
          ...surface,
          strategy: 'selected-export-slice',
        })),
      };
    } else {
      candidate = {
        ...candidate,
        routeRecipe: {
          kind: 'react-router-v6',
          loaderPolicy: 'never-execute',
          mounts: [],
          params: {},
          searchParams: {},
          pattern: '/feature/create',
          pathname: '/feature/create',
          rootOwnsRouter: false,
          targetRole: 'error-element',
        },
      };
    }
    expect(readPreviewInspectorSelectedRouteContent(candidate)).toBeUndefined();
  });

  it('preserves ordinary page-context content without requiring a factory mount', () => {
    const candidate = createOwnerExecution();
    const location = candidate.browserCandidate.routeLocation;
    if (location === undefined || !('routeMounts' in location))
      throw new Error('Missing fixture route location.');
    expect(
      readPreviewInspectorSelectedRouteContent({
        ...candidate,
        fidelity: 'page-authentic',
        browserCandidate: {
          ...candidate.browserCandidate,
          routeLocation: { ...location, routeMounts: [] },
        },
      }),
    ).toEqual(leaf);
  });
});
