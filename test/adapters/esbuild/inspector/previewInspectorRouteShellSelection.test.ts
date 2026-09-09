/** Keeps authored page chrome when the route runtime supplies only a synthetic location. */
import { describe, expect, it } from 'vitest';
import { selectPreviewInspectorRouteShellSurfaces } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteShellSelection';
import { createPreviewInspectorPageExecutionCandidates } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionCandidates';
import type { PreviewInspectorMountSurface } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionTypes';
import type { PreviewInspectorVirtualPageShell } from '../../../../src/adapters/esbuild/inspector/previewInspectorVirtualPagePlan';
import { createPreviewInspectorVirtualPageCandidates } from '../../../../src/adapters/esbuild/inspector/previewInspectorVirtualPagePlan';
import type { PreviewInspectorAncestorPlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorAncestorPlan';
import type { PreviewInspectorPageCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorAncestorTypes';
import type { PreviewRenderChainCandidate } from '../../../../src/adapters/esbuild/renderGraph';

/** Creates an immutable admitted surface, not a filesystem or import discovery. */
function surface(name: string): PreviewInspectorMountSurface {
  return Object.freeze({
    bypassedWrapperNames: [],
    exportName: name,
    id: name,
    omittedTopLevelEffectCount: 0,
    sourcePath: `/workspace/${name}.tsx`,
    strategy: 'authentic-module-export',
    watchSourcePaths: [],
  });
}

const header = surface('Header');
const footer = surface('Footer');
const layout = surface('Layout');
const owner = surface('RouteOwner');
const surfaces = Object.freeze([header, layout, owner, footer]);
const shells: readonly PreviewInspectorVirtualPageShell[] = [
  { importerPath: '/workspace/App.tsx', placement: 'before', relation: 'sibling', root: header },
  { importerPath: '/workspace/App.tsx', relation: 'wrapper', root: layout },
  { importerPath: '/workspace/App.tsx', relation: 'owner', root: owner },
  { importerPath: '/workspace/App.tsx', placement: 'after', relation: 'sibling', root: footer },
];

describe('route shell selection', () => {
  it('keeps header and footer around a leaf-only route without admitting an unproven owner', () => {
    const selected = selectPreviewInspectorRouteShellSurfaces({
      hasAuthoredRouteOwner: false,
      routeCompositionSurfaces: [],
      shells,
      surfaces,
    });
    expect(selected).toEqual([header, layout, footer]);
    expect(Object.isFrozen(selected)).toBe(true);
    expect(surfaces).toEqual([header, layout, owner, footer]);
  });

  it('does not duplicate siblings already rendered by an authored route owner', () => {
    expect(
      selectPreviewInspectorRouteShellSurfaces({
        hasAuthoredRouteOwner: true,
        routeCompositionSurfaces: [owner],
        shells,
        surfaces,
      }),
    ).toEqual([layout]);
  });

  it('retains a proven factory owner and avoids repeating its siblings', () => {
    expect(
      selectPreviewInspectorRouteShellSurfaces({
        hasAuthoredRouteOwner: false,
        ownerSurface: owner,
        routeCompositionSurfaces: [],
        shells,
        surfaces,
      }),
    ).toEqual([layout, owner]);
  });

  it('keeps siblings when only an inline layout is supplied by the route', () => {
    expect(
      selectPreviewInspectorRouteShellSurfaces({
        hasAuthoredRouteOwner: false,
        routeCompositionSurfaces: [layout],
        shells,
        surfaces,
      }),
    ).toEqual([header, footer]);
  });

  it('deduplicates by exact normalized source/export identity', () => {
    expect(
      selectPreviewInspectorRouteShellSurfaces({
        hasAuthoredRouteOwner: false,
        routeCompositionSurfaces: [{ ...header, sourcePath: '/workspace/./Header.tsx' }],
        shells,
        surfaces,
      }),
    ).toEqual([layout, footer]);
  });

  it('does not admit surfaces absent from the proven shell recipe', () => {
    expect(
      selectPreviewInspectorRouteShellSurfaces({
        hasAuthoredRouteOwner: false,
        routeCompositionSurfaces: [],
        shells: [],
        surfaces,
      }),
    ).toEqual([]);
  });

  it('carries chrome through actual candidate generation without importing the app bootstrap', () => {
    const renderPath: PreviewRenderChainCandidate = {
      entryPoint: {
        kind: 'create-root',
        occurrenceStart: 1,
        sourcePath: '/workspace/main.tsx',
        wrapperNames: [],
      },
      id: 'page-path',
      steps: ['Target', 'ViewItems', 'App'].map((name, index) => ({
        certainty: 'confirmed',
        kind: index === 2 ? 'entry-render' : 'component-render',
        label: name,
        occurrenceStart: index,
        sourcePath: `/workspace/${name}.tsx`,
        wrapperNames: [],
      })),
    };
    const routeLocation = {
      componentExportName: 'ViewItems',
      componentName: 'ViewItems',
      componentSourcePath: '/workspace/ViewItems.tsx',
      dependencyPaths: [],
      evidenceKind: 'route-jsx' as const,
      pathname: '/items/1',
      pattern: '/items/:id',
      sourcePath: '/workspace/routes.tsx',
    };
    const app: PreviewInspectorPageCandidate = {
      complete: true,
      dependencyPaths: [],
      edges: [],
      id: 'app',
      renderPath,
      root: { exportName: 'App', sourcePath: '/workspace/App.tsx' },
      rootAutomaticProps: {},
      rootOwnsRouter: true,
      rootStepIndex: 2,
      routeLocation,
      stopReason: 'root-reached',
      targetAutomaticProps: {},
    };
    const page: PreviewInspectorPageCandidate = {
      ...app,
      complete: false,
      id: 'page',
      root: { exportName: 'ViewItems', sourcePath: '/workspace/ViewItems.tsx' },
      rootOwnsRouter: false,
      rootStepIndex: 1,
      stopReason: 'render-path-checkpoint',
    };
    const plan = {
      pageCandidates: [app, page],
      renderChain: { paths: [renderPath] },
      renderChainsByExport: {},
      target: { exportName: 'Target', sourcePath: '/workspace/Target.tsx' },
      shallowVisualPaths: [header, footer].map((item, index) => ({
        exportName: item.exportName,
        sourcePath: item.sourcePath,
        importerPath: '/workspace/App.tsx',
        importKind: 'static',
        localEdges: [],
        moduleSpecifier: `./${item.exportName}`,
        occurrenceStart: index === 0 ? 5 : 15,
        selectedOccurrenceStart: 10,
        relation: 'sibling',
        renderedLocalName: item.exportName,
        renderBoundaryStart: 3,
        selectedChildPath: '/workspace/ViewItems.tsx',
      })),
    } as unknown as PreviewInspectorAncestorPlan;
    const virtualPages = createPreviewInspectorVirtualPageCandidates(
      plan.pageCandidates,
      1,
      plan.shallowVisualPaths,
    );
    expect(virtualPages[0]?.recipe.shells.map((shell) => shell.root.sourcePath)).toEqual([
      '/workspace/Header.tsx',
      '/workspace/Footer.tsx',
    ]);
    const candidates = createPreviewInspectorPageExecutionCandidates({ plan });
    const authentic = candidates.find((item) => item.fidelity === 'page-authentic');
    expect(authentic?.criticalSurfaces.map((item) => item.sourcePath)).toEqual(
      expect.arrayContaining([
        '/workspace/Header.tsx',
        '/workspace/Footer.tsx',
        '/workspace/ViewItems.tsx',
        '/workspace/Target.tsx',
      ]),
    );
    expect(authentic?.criticalSurfaces.map((item) => item.sourcePath)).not.toContain(
      '/workspace/App.tsx',
    );
    expect(authentic?.compositionEdges.map((edge) => edge.mode)).toEqual(
      expect.arrayContaining(['sibling-before', 'sibling-after', 'contains-authored-child']),
    );
    expect(
      candidates.find((item) => item.fidelity === 'target-only')?.criticalSurfaces,
    ).toHaveLength(1);
  });
});
