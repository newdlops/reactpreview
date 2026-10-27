/** Tests exact-owner preservation, sibling isolation, and real closure memo admission changes. */
import { describe, expect, it } from 'vitest';
import type { PreviewInspectorAncestorPlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorAncestorPlan';
import {
  createPreviewInspectorBundleSourceInventoryMemo,
  preparePreviewInspectorBundleFrontier,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleFrontier';
import type { PreviewInspectorPageExecutionCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionTypes';
import { collectPreviewStaticRouteProjectionInventory } from '../../../../src/adapters/esbuild/inspector/previewInspectorStaticRouteProjection';
import { readPreviewInspectorUnresolvedRouteFactoryOwner } from '../../../../src/adapters/esbuild/inspector/previewInspectorUnresolvedRouteFactoryOwner';
import { createPreviewCompilerFrontierPolicy } from '../../../../src/domain/previewCompilerFrontier';
import { createCandidate } from './previewInspectorVirtualPagePlanFixtures';

const owner = { exportName: 'FeatureApp', sourcePath: '/workspace/FeatureApp.tsx' };
const leafPath = '/workspace/ListPage.tsx';
const selectedPath = '/workspace/OtherPage.tsx';
const ownerSource = [
  'import { ListPage } from "./ListPage";',
  'import { OtherPage } from "./OtherPage";',
  'export const FeatureApp = createAppModule("/feature", { ListPage, OtherPage }, [],',
  '({ entries }) => <Routes>{entries}<Route path="*" element={<p>fallback</p>} /></Routes>);',
].join('\n');

/** Creates a complete compiler contract with an unresolved owner or an explicitly selected child. */
function createFixture(preserve = true): {
  readonly plan: PreviewInspectorAncestorPlan;
  readonly execution: PreviewInspectorPageExecutionCandidate;
} {
  const renderPath = {
    id: 'owner-to-entry',
    entryPoint: {
      kind: 'create-root' as const,
      sourcePath: '/workspace/main.tsx',
      occurrenceStart: 0,
      wrapperNames: [],
    },
    steps: [
      {
        kind: 'component-render' as const,
        certainty: 'confirmed' as const,
        label: owner.exportName,
        sourcePath: owner.sourcePath,
        occurrenceStart: 0,
        wrapperNames: [],
      },
    ],
  };
  const browserCandidate = createCandidate({
    root: owner,
    target: owner,
    renderPath,
    routeLocation: {
      componentName: preserve ? owner.exportName : 'OtherPage',
      dependencyPaths: [owner.sourcePath],
      evidenceKind: preserve ? 'route-jsx' : 'route-catalog',
      sourcePath: owner.sourcePath,
      pathname: '/feature',
      pattern: '/feature',
      ...(preserve ? {} : { componentSourcePath: selectedPath, componentExportName: 'OtherPage' }),
      routeMounts: [
        {
          ...owner,
          basePath: '/feature/',
          routeSlotCount: 1,
          hasWildcardFallback: true,
          ...(preserve
            ? { contextOrigin: 'virtual-page-owner' as const, contextPattern: '/feature/*' }
            : {}),
        },
      ],
    },
  });
  const renderChain = {
    dependencyPaths: [owner.sourcePath],
    paths: [renderPath],
    target: owner,
    reachability: 'entry-connected' as const,
    truncated: false,
  };
  const plan: PreviewInspectorAncestorPlan = {
    ...browserCandidate,
    target: owner,
    pageCandidates: [browserCandidate],
    renderChain,
    renderChainsByExport: { FeatureApp: renderChain },
  };
  const surface = {
    ...owner,
    id: 'owner',
    strategy: 'authentic-module-export' as const,
    bypassedWrapperNames: [],
    omittedTopLevelEffectCount: 0,
    watchSourcePaths: [owner.sourcePath],
  };
  const role = { ...owner, surfaceId: surface.id };
  return {
    plan,
    execution: {
      id: 'owner-execution',
      fidelity: 'target-only',
      compositionEdges: [],
      criticalSurfaces: [surface],
      evidenceSourcePaths: [owner.sourcePath],
      optionalSurfaces: [],
      executionRootContract: role,
      executionRootSurfaceId: surface.id,
      runtimeTargetContract: role,
      runtimeTargetSurfaceId: surface.id,
      watchSourcePaths: [owner.sourcePath],
      browserCandidate,
    },
  };
}

describe('unresolved route-factory owner preservation capability', () => {
  it('admits the exact legacy and frozen authentic root with normalized base evidence', () => {
    const { plan, execution } = createFixture();
    expect(readPreviewInspectorUnresolvedRouteFactoryOwner(plan)).toEqual(owner);
    expect(readPreviewInspectorUnresolvedRouteFactoryOwner(plan, execution)).toEqual(owner);
  });

  it('retains the same whole owner referenced by an outer authored Route', () => {
    const { plan, execution } = createFixture();
    const location = execution.browserCandidate.routeLocation;
    if (location === undefined || !('routeMounts' in location))
      throw new Error('Missing controlled owner mount');
    const outer = {
      ...execution,
      browserCandidate: {
        ...execution.browserCandidate,
        routeLocation: {
          ...location,
          componentSourcePath: owner.sourcePath,
          componentExportName: owner.exportName,
          sourcePath: '/workspace/main.tsx',
          pattern: '/feature/*',
          routeMounts: location.routeMounts.map(({ contextOrigin, contextPattern, ...mount }) => {
            void contextOrigin;
            void contextPattern;
            return mount;
          }),
        },
      },
    };
    expect(readPreviewInspectorUnresolvedRouteFactoryOwner(plan, outer)).toEqual(owner);
  });

  it.each([
    'other-file',
    'other-export',
    'selected-child',
    'projected-root',
    'other-role',
    'standalone',
    'detached',
    'error-slot',
  ])('does not retain page imports for %s recovery', (mismatch) => {
    const fixture = createFixture();
    let { plan, execution } = fixture;
    if (mismatch === 'other-file' || mismatch === 'other-export') {
      plan = {
        ...plan,
        target: {
          ...owner,
          ...(mismatch === 'other-file' ? { sourcePath: '/workspace/OtherApp.tsx' } : {}),
          ...(mismatch === 'other-export' ? { exportName: 'OtherApp' } : {}),
        },
      };
    } else if (mismatch === 'selected-child') {
      const location = execution.browserCandidate.routeLocation;
      if (location === undefined || !('routeMounts' in location))
        throw new Error('Missing controlled route location');
      execution = {
        ...execution,
        browserCandidate: {
          ...execution.browserCandidate,
          routeLocation: { ...location, componentSourcePath: leafPath },
        },
      };
    } else if (mismatch === 'projected-root') {
      execution = {
        ...execution,
        criticalSurfaces: execution.criticalSurfaces.map((surface) => ({
          ...surface,
          strategy: 'selected-export-slice',
        })),
      };
    } else if (mismatch === 'other-role') {
      execution = {
        ...execution,
        runtimeTargetContract: { ...execution.runtimeTargetContract, exportName: 'OtherApp' },
      };
    } else if (mismatch === 'detached') {
      execution = {
        ...execution,
        browserCandidate: {
          ...execution.browserCandidate,
          detachedTargetPlacement: 'deferred-sibling',
        },
      };
    } else if (mismatch === 'error-slot') {
      execution = {
        ...execution,
        routeRecipe: {
          kind: 'react-router-v6',
          loaderPolicy: 'never-execute',
          mounts: [],
          params: {},
          searchParams: {},
          pattern: '/feature',
          pathname: '/feature',
          rootOwnsRouter: false,
          targetRole: 'error-element',
        },
      };
    } else execution = { ...execution, standaloneTarget: true };
    expect(readPreviewInspectorUnresolvedRouteFactoryOwner(plan, execution)).toBeUndefined();
  });

  it.each(['FeatureApp', 'PublicFeature', 'default'])(
    'preserves only the selected factory page map through public export %s',
    (exportName) => {
      const source = [
        ownerSource,
        'import { SiblingPage } from "./SiblingPage";',
        'export const OtherApp = createAppModule("/other", { SiblingPage }, [], ({ entries }) => <Routes>{entries}</Routes>);',
        'export { FeatureApp as PublicFeature, FeatureApp as default };',
      ].join('\n');
      const inventory = collectPreviewStaticRouteProjectionInventory(owner.sourcePath, source, {
        ...owner,
        exportName,
      });
      expect([...inventory.projectionsBySpecifier.keys()]).toEqual(['./SiblingPage']);
    },
  );

  it.each([
    { first: 'selected-child', second: 'owner' },
    { first: 'owner', second: 'selected-child' },
    { first: 'no-slots', second: 'owner' },
    { first: 'owner', second: 'no-slots' },
  ] as const)('separates cached closures from $first to $second', async ({ first, second }) => {
    const memo = createPreviewInspectorBundleSourceInventoryMemo();
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Missing normal fast frontier policy');
    const prepare = (
      state: 'owner' | 'selected-child' | 'no-slots',
      warm: boolean,
    ): ReturnType<typeof preparePreviewInspectorBundleFrontier> => {
      const fixture = createFixture(state !== 'selected-child');
      const { plan } = fixture;
      let { execution } = fixture;
      if (state === 'no-slots') {
        const location = execution.browserCandidate.routeLocation;
        if (location === undefined || !('routeMounts' in location))
          throw new Error('Missing controlled mount evidence');
        execution = {
          ...execution,
          browserCandidate: {
            ...execution.browserCandidate,
            routeLocation: {
              ...location,
              routeMounts: location.routeMounts.map((mount) => ({ ...mount, routeSlotCount: 0 })),
            },
          },
        };
      }
      return preparePreviewInspectorBundleFrontier({
        executionCandidate: execution,
        plan,
        policy,
        workspaceRoot: '/workspace',
        readSource: (file) =>
          Promise.resolve(
            file === owner.sourcePath
              ? ownerSource
              : file === leafPath
                ? 'export function ListPage() { return <p>authored leaf</p>; }'
                : file === selectedPath
                  ? 'export function OtherPage() { return <p>selected leaf</p>; }'
                  : undefined,
          ),
        resolveModule: (specifier) =>
          specifier === './ListPage'
            ? leafPath
            : specifier === './OtherPage'
              ? selectedPath
              : undefined,
        ...(warm ? { sourceInventoryMemo: memo } : {}),
      });
    };
    await prepare(first, true);
    const cold = await prepare(second, false);
    const warm = await prepare(second, true);
    expect(warm).toEqual(cold);
    expect(cold.rejected).toBe(false);
    expect(cold.frontier.authenticSourcePaths.includes(leafPath)).toBe(second === 'owner');
  });
});
