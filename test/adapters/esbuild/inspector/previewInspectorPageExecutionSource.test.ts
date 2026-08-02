import { describe, expect, it } from 'vitest';
import { createPreviewInspectorExecutionRootModuleContract } from '../../../../src/adapters/esbuild/inspector/previewInspectorExecutionRootModuleContract';
import { createPreviewInspectorPageExecutionSource } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionSource';
import { createPreviewInspectorTargetModuleContract } from '../../../../src/adapters/esbuild/inspector/previewInspectorTargetModuleContract';
import type { PreviewInspectorPageExecutionCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionTypes';

describe('createPreviewInspectorPageExecutionSource', () => {
  it('uses only exact composition modes and routes sliced surfaces through virtual specifiers', () => {
    const candidate = {
      compositionEdges: [
        {
          childSurfaceId: 'page',
          mode: 'route-outlet',
          parentSurfaceId: 'route',
          placementIndex: 0,
        },
        {
          childSurfaceId: 'target',
          mode: 'component-prop-slot',
          parentSurfaceId: 'page',
          placementIndex: 0,
          slotName: 'content',
        },
        {
          childSurfaceId: 'header',
          mode: 'sibling-before',
          parentSurfaceId: 'page',
          placementIndex: 0,
        },
      ],
      criticalSurfaces: [
        {
          bypassedWrapperNames: [],
          exportName: 'Route',
          id: 'route',
          omittedTopLevelEffectCount: 0,
          sourcePath: '/workspace/Route.tsx',
          strategy: 'authentic-module-export',
          watchSourcePaths: [],
        },
        {
          bypassedWrapperNames: [],
          exportName: 'default',
          id: 'page',
          omittedTopLevelEffectCount: 2,
          sourcePath: '/workspace/Page.tsx',
          strategy: 'selected-export-slice',
          watchSourcePaths: [],
        },
        {
          bypassedWrapperNames: [],
          exportName: 'Target',
          id: 'target',
          omittedTopLevelEffectCount: 0,
          sourcePath: '/workspace/Target.tsx',
          strategy: 'authentic-module-export',
          watchSourcePaths: [],
        },
        {
          bypassedWrapperNames: [],
          exportName: 'Header',
          id: 'header',
          omittedTopLevelEffectCount: 0,
          sourcePath: '/workspace/Header.tsx',
          strategy: 'authentic-module-export',
          watchSourcePaths: [],
        },
      ],
      executionRootSurfaceId: 'route',
      runtimeTargetSurfaceId: 'target',
    } as unknown as PreviewInspectorPageExecutionCandidate;

    const source = createPreviewInspectorPageExecutionSource({
      candidate,
      executionRootModuleContract: createExecutionRootContract(candidate),
      target: { exportName: 'Target', sourcePath: '/workspace/Target.tsx' },
      targetModuleContract: createPreviewInspectorTargetModuleContract({
        preparedSourceText: [
          'export function Target() { return null; }',
          'export default function DefaultTarget() { return null; }',
        ].join('\n'),
        selectedExportNames: ['Target'],
        sourcePath: '/workspace/Target.tsx',
      }),
    });

    expect(source).toContain('react-preview:page-surface/page');
    expect(source).toContain('React.createElement(Surface0, null');
    expect(source).toContain('"content": React.createElement(Surface2, null)');
    expect(source).toContain('react-preview:inspector-target-facade');
    expect(source).toContain('import { Route as Surface0 } from "/workspace/Route.tsx";');
    expect(source).toContain('Surface3');
    expect(source).not.toContain('ShellBoundary');
  });

  it('rejects PageExecution target drift from the prepared facade contract', () => {
    const candidate = {
      compositionEdges: [],
      criticalSurfaces: [
        {
          exportName: 'SelectedTarget',
          id: 'target',
          sourcePath: '/workspace/SelectedTarget.tsx',
          strategy: 'authentic-module-export',
        },
      ],
      executionRootSurfaceId: 'target',
      runtimeTargetSurfaceId: 'target',
    } as unknown as PreviewInspectorPageExecutionCandidate;
    const targetModuleContract = createPreviewInspectorTargetModuleContract({
      preparedSourceText: 'export function OtherTarget() { return null; }',
      selectedExportNames: ['OtherTarget'],
      sourcePath: '/workspace/OtherTarget.tsx',
    });

    expect(() =>
      createPreviewInspectorPageExecutionSource({
        candidate,
        executionRootModuleContract: createExecutionRootContract(candidate),
        target: {
          exportName: 'SelectedTarget',
          sourcePath: '/workspace/SelectedTarget.tsx',
        },
        targetModuleContract,
      }),
    ).toThrow('does not match the prepared target module contract');
  });

  it('installs a generic selected route without importing a route registry or executing loaders', () => {
    const candidate = {
      browserCandidate: { id: 'selected' },
      compositionEdges: [],
      criticalSurfaces: [
        {
          bypassedWrapperNames: [],
          exportName: 'default',
          id: 'page',
          omittedTopLevelEffectCount: 0,
          sourcePath: '/workspace/Page.tsx',
          strategy: 'authentic-module-export',
          watchSourcePaths: [],
        },
      ],
      executionRootSurfaceId: 'page',
      routeRecipe: {
        kind: 'generic-memory-location',
        loaderPolicy: 'never-execute',
        mounts: [],
        params: {},
        pattern: '/orders/:id',
        pathname: '/orders/42',
        rootOwnsRouter: false,
        searchParams: { filter: ['open', 'mine'] },
      },
      runtimeTargetSurfaceId: 'page',
    } as unknown as PreviewInspectorPageExecutionCandidate;

    const source = createPreviewInspectorPageExecutionSource({
      candidate,
      executionRootModuleContract: createExecutionRootContract(candidate),
      target: { exportName: 'default', sourcePath: '/workspace/Page.tsx' },
    });

    expect(source).toContain('react-preview:inspector-page-route-state');
    expect(source).not.toContain('useLayoutEffect');
    expect(source).not.toContain('loader(');
    expect(source).not.toContain('action(');
  });

  it('publishes bounded Next route state and composes a Pages `_app` Component surface', () => {
    const candidate = {
      compositionEdges: [
        {
          childSurfaceId: 'page',
          mode: 'component-prop-slot',
          parentSurfaceId: 'app',
          placementIndex: 0,
          slotName: 'Component',
        },
      ],
      criticalSurfaces: [
        {
          bypassedWrapperNames: [],
          exportName: 'default',
          id: 'app',
          omittedTopLevelEffectCount: 0,
          sourcePath: '/workspace/pages/_app.tsx',
          strategy: 'framework-page-surface',
          watchSourcePaths: [],
        },
        {
          bypassedWrapperNames: [],
          exportName: 'default',
          id: 'page',
          omittedTopLevelEffectCount: 0,
          sourcePath: '/workspace/pages/products/[id].tsx',
          strategy: 'authentic-module-export',
          watchSourcePaths: [],
        },
      ],
      executionRootSurfaceId: 'app',
      routeRecipe: {
        kind: 'next-pages',
        loaderPolicy: 'never-execute',
        mounts: [],
        params: { id: '42' },
        pattern: '/products/[id]',
        pathname: '/products/42',
        rootOwnsRouter: false,
        searchParams: {},
      },
      runtimeTargetSurfaceId: 'page',
    } as unknown as PreviewInspectorPageExecutionCandidate;

    const source = createPreviewInspectorPageExecutionSource({
      candidate,
      executionRootModuleContract: createExecutionRootContract(candidate),
      target: { exportName: 'default', sourcePath: '/workspace/pages/products/[id].tsx' },
    });

    expect(source).toContain('react-preview:inspector-page-route-state');
    expect(source).toContain('"Component": () => React.createElement(Surface1, null)');
    expect(source).toContain('"pageProps": {}');
    expect(source).not.toContain('route registry');
  });

  it('creates only the selected React Router v6 branch and no application registry', () => {
    const candidate = {
      compositionEdges: [],
      criticalSurfaces: [
        {
          bypassedWrapperNames: [],
          exportName: 'default',
          id: 'layout',
          omittedTopLevelEffectCount: 0,
          sourcePath: '/workspace/Layout.tsx',
          strategy: 'authentic-module-export',
          watchSourcePaths: [],
        },
        {
          bypassedWrapperNames: [],
          exportName: 'default',
          id: 'page',
          omittedTopLevelEffectCount: 0,
          sourcePath: '/workspace/Page.tsx',
          strategy: 'authentic-module-export',
          watchSourcePaths: [],
        },
      ],
      executionRootSurfaceId: 'layout',
      routeRecipe: {
        kind: 'react-router-v6',
        loaderPolicy: 'never-execute',
        params: {},
        pattern: '/orders/:id',
        pathname: '/orders/42',
        rootOwnsRouter: false,
        searchParams: {},
        routerModuleSpecifier: 'react-router',
        mounts: [
          {
            basePath: '/',
            childSurfaceId: 'page',
            contextPattern: '/root/*',
            hasWildcardFallback: false,
            parentSurfaceId: 'layout',
            pattern: '/orders/:id',
          },
        ],
      },
      runtimeTargetSurfaceId: 'page',
    } as unknown as PreviewInspectorPageExecutionCandidate;

    const source = createPreviewInspectorPageExecutionSource({
      candidate,
      executionRootModuleContract: createExecutionRootContract(candidate),
      target: { exportName: 'default', sourcePath: '/workspace/Page.tsx' },
    });

    expect(source).toContain("import { MemoryRouter, Route, Routes } from 'react-router';");
    expect(source).toContain('initialEntries: ["/orders/42"]');
    expect(source).toContain('path: "/root/*"');
    expect(source).toContain('React.createElement(Routes, null');
    expect(source).not.toContain('RouteRegistry');
    expect(source).not.toContain('loader:');
  });

  it('makes an inner v6 mount relative to the preceding selected mount', () => {
    const candidate = {
      compositionEdges: [],
      criticalSurfaces: [
        {
          bypassedWrapperNames: [],
          exportName: 'default',
          id: 'company-root',
          omittedTopLevelEffectCount: 0,
          sourcePath: '/workspace/CompanyRoot.tsx',
          strategy: 'authentic-module-export',
          watchSourcePaths: [],
        },
        {
          bypassedWrapperNames: [],
          exportName: 'default',
          id: 'company-layout',
          omittedTopLevelEffectCount: 0,
          sourcePath: '/workspace/CompanyLayout.tsx',
          strategy: 'authentic-module-export',
          watchSourcePaths: [],
        },
        {
          bypassedWrapperNames: [],
          exportName: 'default',
          id: 'company-page',
          omittedTopLevelEffectCount: 0,
          sourcePath: '/workspace/CompanyPage.tsx',
          strategy: 'authentic-module-export',
          watchSourcePaths: [],
        },
      ],
      executionRootSurfaceId: 'company-root',
      routeRecipe: {
        kind: 'react-router-v6',
        loaderPolicy: 'never-execute',
        mounts: [
          {
            basePath: '/company',
            childSurfaceId: 'company-layout',
            contextPattern: '/company/*',
            hasWildcardFallback: false,
            parentSurfaceId: 'company-root',
            pattern: '/company/*',
          },
          {
            basePath: '/company/:companyId',
            childSurfaceId: 'company-page',
            contextPattern: '/company/:companyId',
            hasWildcardFallback: false,
            parentSurfaceId: 'company-layout',
            pattern: '/company/:companyId',
          },
        ],
        params: { companyId: '42' },
        pattern: '/company/:companyId',
        pathname: '/company/42',
        rootOwnsRouter: false,
        routerModuleSpecifier: 'react-router-dom',
        searchParams: {},
      },
      runtimeTargetSurfaceId: 'company-page',
    } as unknown as PreviewInspectorPageExecutionCandidate;

    const source = createPreviewInspectorPageExecutionSource({
      candidate,
      executionRootModuleContract: createExecutionRootContract(candidate),
      target: { exportName: 'default', sourcePath: '/workspace/CompanyPage.tsx' },
    });

    expect(source).toContain('path: "/company/*", element: React.createElement(Surface0, null)');
    expect(source).toContain('path: ":companyId", element: React.createElement(Surface1, null)');
    expect(source).not.toContain('path: "/company/:companyId"');
    expect(source.match(/React\.createElement\(MemoryRouter/gu)).toHaveLength(1);
  });

  it('places an inline route wrapper and leaf page inside exactly one generated Router', () => {
    const candidate = {
      browserCandidate: { id: 'selected-leaf' },
      compositionEdges: [
        {
          childSurfaceId: 'page',
          mode: 'children-slot',
          parentSurfaceId: 'layout',
          placementIndex: 0,
        },
      ],
      criticalSurfaces: [
        {
          bypassedWrapperNames: [],
          exportName: 'default',
          id: 'layout',
          omittedTopLevelEffectCount: 0,
          sourcePath: '/workspace/RouteLayout.tsx',
          strategy: 'selected-export-slice',
          watchSourcePaths: [],
        },
        {
          bypassedWrapperNames: [],
          exportName: 'default',
          id: 'page',
          omittedTopLevelEffectCount: 0,
          sourcePath: '/workspace/SelectedPage.tsx',
          strategy: 'authentic-module-export',
          watchSourcePaths: [],
        },
      ],
      executionRootSurfaceId: 'layout',
      routeRecipe: {
        kind: 'react-router-v6',
        loaderPolicy: 'never-execute',
        mounts: [],
        params: { selectedId: '42' },
        pattern: '/selected/:selectedId(\\d+)',
        pathname: '/selected/42',
        rootOwnsRouter: false,
        routerModuleSpecifier: 'react-router-dom',
        searchParams: { tab: 'details' },
      },
      runtimeTargetSurfaceId: 'page',
    } as unknown as PreviewInspectorPageExecutionCandidate;

    const source = createPreviewInspectorPageExecutionSource({
      candidate,
      executionRootModuleContract: createExecutionRootContract(candidate),
      target: { exportName: 'default', sourcePath: '/workspace/SelectedPage.tsx' },
    });

    expect(source).toContain(
      'element: React.createElement(Surface0, null, React.createElement(Surface1, null))',
    );
    expect(source).toContain('initialEntries: ["/selected/42?tab=details"]');
    expect(source).toContain('path: "/selected/:selectedId"');
    expect(source).not.toContain('index: true');
    expect(source.match(/React\.createElement\(MemoryRouter/gu)).toHaveLength(1);
    expect(source).not.toContain('RouterProvider');
    expect(source).toContain('react-preview:inspector-target-facade');
  });

  it('does not nest a generated MemoryRouter around an authored React Router root', () => {
    const candidate = {
      compositionEdges: [],
      criticalSurfaces: [
        {
          bypassedWrapperNames: [],
          exportName: 'default',
          id: 'app',
          omittedTopLevelEffectCount: 0,
          sourcePath: '/workspace/App.tsx',
          strategy: 'authentic-module-export',
          watchSourcePaths: [],
        },
      ],
      executionRootSurfaceId: 'app',
      routeRecipe: {
        kind: 'react-router-v6',
        loaderPolicy: 'never-execute',
        mounts: [],
        params: {},
        pattern: '/selected',
        pathname: '/selected',
        rootOwnsRouter: true,
        routerModuleSpecifier: 'react-router-dom',
        searchParams: {},
      },
      runtimeTargetSurfaceId: 'app',
    } as unknown as PreviewInspectorPageExecutionCandidate;

    const source = createPreviewInspectorPageExecutionSource({
      candidate,
      executionRootModuleContract: createExecutionRootContract(candidate),
      target: { exportName: 'default', sourcePath: '/workspace/App.tsx' },
    });

    expect(source).toContain('react-preview:inspector-page-route-state');
    expect(source).toContain('return React.createElement(Surface0, null)');
    expect(source).not.toContain('MemoryRouter');
    expect(source).not.toContain('React.createElement(Routes');
  });
});

function createExecutionRootContract(candidate: PreviewInspectorPageExecutionCandidate) {
  const surface = candidate.criticalSurfaces.find(
    (candidateSurface) => candidateSurface.id === candidate.executionRootSurfaceId,
  );
  if (surface === undefined) throw new Error('Fixture execution root is missing.');
  return createPreviewInspectorExecutionRootModuleContract({
    exportName: surface.exportName,
    preparedSourceText:
      surface.exportName === 'default'
        ? 'export default function ExecutionRoot() { return null; }'
        : `export function ${surface.exportName}() { return null; }`,
    sourcePath: surface.sourcePath,
    surfaceId: surface.id,
  });
}
