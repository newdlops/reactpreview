/* eslint-disable max-lines -- PageExecution variants share one route/surface fixture vocabulary. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createEligiblePreviewInspectorPageExecutionCandidates,
  createPreviewInspectorExecutionRootModuleContract,
  createPreviewInspectorPageExecutionCandidates,
  createPreviewInspectorPageExecutionSource,
  createPreviewInspectorRootSource,
  resolvePreviewInspectorRuntimeOwnershipTarget,
  resolvePreviewInspectorRuntimeTargetMode,
  type PreviewInspectorAncestorPlan,
  type PreviewInspectorPageCandidate,
} from '../../../../src/adapters/esbuild/inspector';
import { PreviewCompilationError } from '../../../../src/domain/preview';
import type { PreviewRenderChainCandidate } from '../../../../src/adapters/esbuild/renderGraph';
import { expandPreviewInspectorRouteChoiceCandidates } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteChoiceCandidates';
import { canonicalizeExistingPath } from '../../../../src/shared/pathIdentity';

const TARGET = '/workspace/Target.tsx';
const PAGE = '/workspace/SelectedPage.tsx';
const ROUTE = '/workspace/RouteLayout.tsx';
const APP = '/workspace/App.tsx';

describe('createPreviewInspectorPageExecutionCandidates', () => {
  it('executes an exact resolved route leaf without re-entering its application router', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-route-leaf-'));
    const applicationPath = path.join(workspaceRoot, 'Application.tsx');
    const selectedPagePath = path.join(workspaceRoot, 'SelectedPage.tsx');
    try {
      const selectedPageSource =
        'export default function SelectedPage() { return <main>selected route</main>; }';
      await Promise.all([
        writeFile(
          applicationPath,
          [
            "import { Routes } from 'react-router-dom';",
            "import SelectedPage from './SelectedPage';",
            'export default function Application() {',
            '  return <Routes />;',
            '}',
            'void SelectedPage;',
          ].join('\n'),
        ),
        writeFile(selectedPagePath, selectedPageSource),
      ]);
      const routeLocation = {
        componentExportName: 'default',
        componentName: 'SelectedPage',
        componentSourcePath: selectedPagePath,
        dependencyPaths: [applicationPath, selectedPagePath],
        evidenceKind: 'route-jsx' as const,
        pathname: '/selected',
        pattern: '/selected',
        sourcePath: applicationPath,
      };
      const application = {
        complete: true,
        dependencyPaths: [applicationPath],
        edges: [],
        id: 'application-route-choice',
        root: { exportName: 'default', sourcePath: applicationPath },
        rootAutomaticProps: {},
        rootOwnsRouter: true,
        routeLocation,
        stopReason: 'root-reached',
        targetAutomaticProps: {},
      } as PreviewInspectorPageCandidate;
      const [selected] = expandPreviewInspectorRouteChoiceCandidates(
        [application],
        [routeLocation],
      );
      if (selected === undefined) throw new Error('Expected one expanded route choice.');
      const plan = {
        ...selected,
        pageCandidates: [selected],
        renderChain: { paths: [] },
        renderChainsByExport: {},
        routeSelectionResolution: 'exact',
        target: { exportName: 'default', sourcePath: applicationPath },
      } as unknown as PreviewInspectorAncestorPlan;

      const candidate = createPreviewInspectorPageExecutionCandidates({
        plan,
        targetMode: 'selected-route-leaf',
      })[0];
      expect(candidate?.browserCandidate).toMatchObject({
        root: { exportName: 'default', sourcePath: selectedPagePath },
        rootOwnsRouter: false,
        target: { exportName: 'default', sourcePath: selectedPagePath },
      });
      expect(candidate?.criticalSurfaces.map((surface) => surface.sourcePath)).toEqual([
        selectedPagePath,
      ]);
      expect(candidate?.executionRootSurfaceId).toBe(candidate?.runtimeTargetSurfaceId);
      expect(candidate?.executionRootContract).toEqual({
        exportName: 'default',
        sourcePath: selectedPagePath,
        surfaceId: candidate?.executionRootSurfaceId,
      });
      expect(candidate?.runtimeTargetContract).toEqual(candidate?.executionRootContract);
      expect(candidate?.routeRecipe).toMatchObject({
        kind: 'react-router-v6',
        pathname: '/selected',
        rootOwnsRouter: false,
      });
      if (candidate === undefined) throw new Error('Expected a selected route leaf candidate.');
      const runtimeOwnershipTarget = resolvePreviewInspectorRuntimeOwnershipTarget({
        analysisTarget: plan.target,
        candidate,
        diagnosticPath: applicationPath,
        routeSelection: [{ componentName: 'SelectedPage', pattern: '/selected' }],
        ...(plan.routeSelectionResolution === undefined
          ? {}
          : { routeSelectionResolution: plan.routeSelectionResolution }),
        selectedLeafSourceText: selectedPageSource,
        targetMode: 'selected-route-leaf',
      });
      expect(runtimeOwnershipTarget).toEqual({
        exportName: 'default',
        sourcePath: selectedPagePath,
      });
      const source = createPreviewInspectorPageExecutionSource({
        candidate,
        executionRootModuleContract: createPreviewInspectorExecutionRootModuleContract({
          exportName: candidate.executionRootContract.exportName,
          preparedSourceText: selectedPageSource,
          sourcePath: candidate.executionRootContract.sourcePath,
          surfaceId: candidate.executionRootContract.surfaceId,
        }),
        target: runtimeOwnershipTarget,
      });
      expect(source).toContain('from "react-preview:inspector-target-facade"');
      expect(source).toContain("import { MemoryRouter, Route, Routes } from 'react-router-dom';");
      expect(source).not.toContain(`from ${JSON.stringify(applicationPath)}`);
      const rootSource = createPreviewInspectorRootSource({
        pageExecutionCandidate: candidate,
        plan,
        runtimeOwnershipTarget,
      });
      expect(rootSource).toContain('"rootOwnsRouter":true');
      expect(rootSource).toContain(
        `"target":{"exportName":"default","sourcePath":${JSON.stringify(selectedPagePath)}}`,
      );
      expect(rootSource).not.toContain('direct-target:default');
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it('carries the exact static target tab key into the browser descriptor', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-target-tab-'));
    const pagePath = path.join(workspaceRoot, 'SelectedPage.tsx');
    const targetPath = path.join(workspaceRoot, 'Target.tsx');
    try {
      const pageSource = [
        "import { Target } from './Target';",
        'const otherKey = "other";',
        'export function SelectedPage() {',
        '  return (',
        '    <Tab>',
        '      <TabItem eventKey={otherKey}><div>Other</div></TabItem>',
        '      <TabItem eventKey="guideEmail"><Target /></TabItem>',
        '    </Tab>',
        '  );',
        '}',
      ].join('\n');
      await Promise.all([
        writeFile(pagePath, pageSource),
        writeFile(targetPath, 'export function Target() { return <table />; }'),
      ]);
      const renderPath: PreviewRenderChainCandidate = {
        id: 'target-tab-path',
        steps: [
          {
            certainty: 'confirmed',
            invocation: { calleeName: 'Target', mode: 'jsx', sourcePath: pagePath },
            kind: 'component-render',
            label: 'Target',
            occurrenceStart: pageSource.indexOf('<Target'),
            sourcePath: targetPath,
            wrapperNames: ['TabItem', 'Tab'],
          },
          {
            certainty: 'confirmed',
            kind: 'component-render',
            label: 'SelectedPage',
            occurrenceStart: pageSource.indexOf('SelectedPage'),
            sourcePath: pagePath,
            wrapperNames: [],
          },
        ],
      };
      const browserCandidate = {
        complete: true,
        dependencyPaths: [targetPath, pagePath],
        edges: [],
        id: 'target-tab-page',
        renderPath,
        root: { exportName: 'SelectedPage', sourcePath: pagePath },
        rootAutomaticProps: {},
        rootOwnsRouter: false,
        rootStepIndex: 1,
        stopReason: 'root-reached',
        targetAutomaticProps: {},
      } as PreviewInspectorPageCandidate;
      const plan = {
        ...browserCandidate,
        pageCandidates: [browserCandidate],
        renderChain: { paths: [renderPath] },
        renderChainsByExport: { Target: { paths: [renderPath] } },
        target: { exportName: 'Target', sourcePath: targetPath },
      } as unknown as PreviewInspectorAncestorPlan;

      const candidate = createPreviewInspectorPageExecutionCandidates({ plan })[0];

      expect(candidate?.targetPageTabKeys).toEqual(['guideEmail']);
      if (candidate === undefined) throw new Error('Expected a target-tab execution candidate.');
      const rootSource = createPreviewInspectorRootSource({
        pageExecutionCandidate: candidate,
        plan,
      });
      expect(rootSource).toContain('"targetPageTabKeys":["guideEmail"]');
      expect(rootSource).not.toContain('"targetPageTabKeys":["other"]');
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it('does not mistake a local Routes component for the React Router v6 export', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-v5-routes-name-'));
    const applicationPath = path.join(workspaceRoot, 'Routes.jsx');
    const projectPath = path.join(workspaceRoot, 'Project.jsx');
    try {
      const projectSource = 'export default function Project() { return <main>project</main>; }';
      await Promise.all([
        writeFile(
          applicationPath,
          [
            "import { Router, Switch, Route } from 'react-router-dom';",
            "import Project from './Project';",
            'const Routes = () => (',
            '  <Router><Switch><Route path="/project" component={Project} /></Switch></Router>',
            ');',
            'export default Routes;',
          ].join('\n'),
        ),
        writeFile(projectPath, projectSource),
      ]);
      const routeLocation = {
        componentExportName: 'default',
        componentName: 'Project',
        componentSourcePath: projectPath,
        dependencyPaths: [applicationPath, projectPath],
        evidenceKind: 'route-jsx' as const,
        pathname: '/project',
        pattern: '/project',
        sourcePath: applicationPath,
      };
      const application = {
        complete: true,
        dependencyPaths: [applicationPath],
        edges: [],
        id: 'v5-local-routes-name',
        root: { exportName: 'default', sourcePath: applicationPath },
        rootAutomaticProps: {},
        rootOwnsRouter: true,
        routeLocation,
        stopReason: 'root-reached',
        targetAutomaticProps: {},
      } as PreviewInspectorPageCandidate;
      const [selected] = expandPreviewInspectorRouteChoiceCandidates(
        [application],
        [routeLocation],
      );
      if (selected === undefined) throw new Error('Expected one expanded v5 route choice.');
      const plan = {
        ...selected,
        pageCandidates: [selected],
        renderChain: { paths: [] },
        renderChainsByExport: {},
        routeSelectionResolution: 'exact',
        target: { exportName: 'default', sourcePath: applicationPath },
      } as unknown as PreviewInspectorAncestorPlan;

      const candidate = createPreviewInspectorPageExecutionCandidates({
        plan,
        targetMode: 'selected-route-leaf',
      })[0];

      expect(candidate?.routeRecipe).toMatchObject({
        kind: 'react-router-v5',
        pathname: '/project',
        rootOwnsRouter: false,
      });
      if (candidate === undefined) throw new Error('Expected a v5 route execution candidate.');
      const source = createPreviewInspectorPageExecutionSource({
        candidate,
        executionRootModuleContract: createPreviewInspectorExecutionRootModuleContract({
          exportName: candidate.executionRootContract.exportName,
          preparedSourceText: projectSource,
          sourcePath: candidate.executionRootContract.sourcePath,
          surfaceId: candidate.executionRootContract.surfaceId,
        }),
        target: { exportName: 'default', sourcePath: projectPath },
      });
      expect(source).toContain("import { MemoryRouter, Route } from 'react-router-dom';");
      expect(source).not.toContain('MemoryRouter, Route, Routes');
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it('preserves active-document ownership when the opt-in mode is omitted', () => {
    const analysisTarget = { exportName: 'Target', sourcePath: TARGET };

    expect(
      resolvePreviewInspectorRuntimeOwnershipTarget({
        analysisTarget,
        diagnosticPath: TARGET,
      }),
    ).toBe(analysisTarget);
  });

  it('keeps active-document ownership for an automatically selected route candidate', () => {
    const leaf = { exportName: 'NamedPage', sourcePath: PAGE };
    const plan = {
      pageCandidates: [
        {
          routeLocation: {
            componentName: 'NamedPage',
            evidenceKind: 'route-jsx',
            pathname: '/named',
            pattern: '/named',
            sourcePath: APP,
          },
          target: leaf,
        },
      ],
      routeSelectionResolution: 'automatic',
      target: { exportName: 'default', sourcePath: APP },
    } as unknown as PreviewInspectorAncestorPlan;
    const targetMode = resolvePreviewInspectorRuntimeTargetMode(plan, undefined);

    expect(targetMode).toBeUndefined();
  });

  it('keeps active-document ownership when an automatic route already targets that document', () => {
    const target = { exportName: 'default', sourcePath: TARGET };
    const plan = {
      pageCandidates: [
        {
          routeLocation: {
            componentName: 'Target',
            evidenceKind: 'route-jsx',
            pathname: '/root/child',
            pattern: '/root/child',
            sourcePath: ROUTE,
          },
          target,
        },
      ],
      routeSelectionResolution: 'automatic',
      target,
    } as unknown as PreviewInspectorAncestorPlan;

    expect(resolvePreviewInspectorRuntimeTargetMode(plan, undefined)).toBeUndefined();
  });

  it('derives an exact named selected-route leaf from compiler-owned candidate evidence', () => {
    const leaf = { exportName: 'NamedPage', sourcePath: PAGE };
    const candidate = {
      browserCandidate: { root: leaf, target: leaf },
      criticalSurfaces: [
        {
          exportName: leaf.exportName,
          id: 'leaf',
          sourcePath: leaf.sourcePath,
          strategy: 'authentic-module-export',
        },
      ],
      executionRootSurfaceId: 'leaf',
      runtimeTargetSurfaceId: 'leaf',
    } as unknown as NonNullable<
      Parameters<typeof resolvePreviewInspectorRuntimeOwnershipTarget>[0]['candidate']
    >;

    expect(
      resolvePreviewInspectorRuntimeOwnershipTarget({
        analysisTarget: { exportName: 'App', sourcePath: APP },
        candidate,
        diagnosticPath: APP,
        routeSelection: [{ componentName: 'NamedPage', pattern: '/named' }],
        routeSelectionResolution: 'exact',
        selectedLeafSourceText: 'export function NamedPage() { return <main>named route</main>; }',
        targetMode: 'selected-route-leaf',
      }),
    ).toEqual(leaf);
  });

  it('fails selected-route ownership for empty or conflicting compiler evidence', () => {
    const analysisTarget = { exportName: 'Target', sourcePath: TARGET };
    const candidate = {
      browserCandidate: {
        root: { exportName: 'SelectedPage', sourcePath: PAGE },
        target: { exportName: 'OtherPage', sourcePath: PAGE },
      },
      criticalSurfaces: [
        {
          exportName: 'SelectedPage',
          id: 'selected-page',
          sourcePath: PAGE,
          strategy: 'authentic-module-export',
        },
      ],
      executionRootSurfaceId: 'selected-page',
      runtimeTargetSurfaceId: 'selected-page',
    } as unknown as NonNullable<
      Parameters<typeof resolvePreviewInspectorRuntimeOwnershipTarget>[0]['candidate']
    >;

    expect(() =>
      resolvePreviewInspectorRuntimeOwnershipTarget({
        analysisTarget,
        candidate,
        diagnosticPath: TARGET,
        routeSelection: [],
        routeSelectionResolution: 'exact',
        selectedLeafSourceText: 'export function SelectedPage() { return null; }',
        targetMode: 'selected-route-leaf',
      }),
    ).toThrow(PreviewCompilationError);
    expect(() =>
      resolvePreviewInspectorRuntimeOwnershipTarget({
        analysisTarget,
        candidate,
        diagnosticPath: TARGET,
        routeSelection: [{ componentName: 'SelectedPage', pattern: '/selected' }],
        routeSelectionResolution: 'exact',
        selectedLeafSourceText: 'export function SelectedPage() { return null; }',
        targetMode: 'selected-route-leaf',
      }),
    ).toThrow(/selected route leaf/u);
  });

  it('reports each Page Execution role conflict independently', () => {
    const leaf = { exportName: 'NamedPage', sourcePath: PAGE };
    const root = { exportName: 'App', sourcePath: APP };
    const leafSurface = {
      exportName: leaf.exportName,
      id: 'leaf',
      sourcePath: leaf.sourcePath,
      strategy: 'authentic-module-export',
    };
    const rootSurface = {
      exportName: root.exportName,
      id: 'root',
      sourcePath: root.sourcePath,
      strategy: 'authentic-module-export',
    };
    const baseCandidate = {
      browserCandidate: { root: leaf, target: leaf },
      criticalSurfaces: [leafSurface],
      executionRootSurfaceId: 'leaf',
      runtimeTargetSurfaceId: 'leaf',
    } as unknown as NonNullable<
      Parameters<typeof resolvePreviewInspectorRuntimeOwnershipTarget>[0]['candidate']
    >;
    const resolve = (candidate: unknown): void => {
      resolvePreviewInspectorRuntimeOwnershipTarget({
        analysisTarget: root,
        candidate: candidate as NonNullable<
          Parameters<typeof resolvePreviewInspectorRuntimeOwnershipTarget>[0]['candidate']
        >,
        diagnosticPath: APP,
        routeSelection: [{ componentName: 'NamedPage', pattern: '/named' }],
        routeSelectionResolution: 'exact',
        selectedLeafSourceText: 'export function NamedPage() { return null; }',
        targetMode: 'selected-route-leaf',
      });
    };

    expect(() => {
      resolve({ ...baseCandidate, executionRootSurfaceId: 'missing' });
    }).toThrow(/missing its execution-root surface/u);
    expect(() => {
      resolve({
        ...baseCandidate,
        criticalSurfaces: [leafSurface, { ...leafSurface }],
      });
    }).toThrow(/duplicate execution-root surfaces/u);
    expect(() => {
      resolve({
        ...baseCandidate,
        browserCandidate: { root, target: leaf },
      });
    }).toThrow(/candidate root that does not match its execution-root surface/u);
    expect(() => {
      resolve({ ...baseCandidate, runtimeTargetSurfaceId: 'missing' });
    }).toThrow(/missing its runtime-target surface/u);
    expect(() => {
      resolve({
        ...baseCandidate,
        browserCandidate: { root, target: leaf },
        criticalSurfaces: [rootSurface, leafSurface, { ...leafSurface }],
        executionRootSurfaceId: 'root',
      });
    }).toThrow(/duplicate runtime-target surfaces/u);
    expect(() => {
      resolve({
        ...baseCandidate,
        browserCandidate: {
          root: leaf,
          target: { exportName: 'OtherPage', sourcePath: PAGE },
        },
      });
    }).toThrow(/runtime-target leaf whose source or export does not match/u);
  });

  it('tries selected route/page surfaces before smaller page and target-only slices', () => {
    const renderPath: PreviewRenderChainCandidate = {
      entryPoint: {
        kind: 'create-root',
        occurrenceStart: 10,
        sourcePath: '/workspace/main.tsx',
        wrapperNames: [],
      },
      id: 'route-path',
      steps: [
        {
          certainty: 'confirmed',
          kind: 'component-render',
          label: 'Target',
          occurrenceStart: 1,
          sourcePath: TARGET,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed',
          kind: 'route-branch',
          label: 'SelectedPage',
          occurrenceStart: 2,
          sourcePath: PAGE,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed',
          kind: 'route-branch',
          label: 'RouteLayout',
          occurrenceStart: 3,
          sourcePath: ROUTE,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed',
          kind: 'component-render',
          label: 'App',
          occurrenceStart: 4,
          sourcePath: APP,
          wrapperNames: [],
        },
      ],
    };
    const candidate = {
      complete: true,
      dependencyPaths: [TARGET, PAGE, ROUTE, APP],
      edges: [],
      id: 'selected',
      renderPath,
      root: { exportName: 'SelectedPage', sourcePath: PAGE },
      rootAutomaticProps: { staleRoot: true },
      rootInference: {
        provenance: [{ kind: 'string', path: 'staleRoot', source: 'type' }],
        shape: {
          kind: 'object',
          properties: { staleRoot: { kind: 'string' } },
        },
      },
      rootOwnsRouter: true,
      rootStepIndex: 1,
      routeMountBasePath: '/stale',
      routeSlotCount: 99,
      routeLocation: {
        componentName: 'SelectedPage',
        dependencyPaths: [ROUTE],
        evidenceKind: 'route-jsx',
        pathname: '/selected/42',
        pattern: '/selected/:id',
        routeMounts: [
          {
            basePath: '/',
            exportName: 'RouteLayout',
            hasWildcardFallback: true,
            routeSlotCount: 1,
            sourcePath: ROUTE,
          },
        ],
        sourcePath: ROUTE,
      },
      stopReason: 'root-reached',
      targetAutomaticProps: {},
      wildcardFallbackPresent: false,
    } as PreviewInspectorPageCandidate;
    const plan = {
      pageCandidates: [candidate],
      renderChain: { paths: [renderPath] },
      renderChainsByExport: { Target: { paths: [renderPath] } },
      target: { exportName: 'Target', sourcePath: TARGET },
    } as unknown as PreviewInspectorAncestorPlan;

    const candidates = createPreviewInspectorPageExecutionCandidates({ plan });

    expect(candidates.map((item) => item.fidelity)).toEqual([
      'route-page-authentic',
      'route-page-sliced',
      'page-authentic',
      'page-sliced',
      'target-only',
    ]);
    expect(candidates[0]?.routeRecipe).toMatchObject({
      kind: 'generic-memory-location',
      loaderPolicy: 'never-execute',
      pathname: '/selected/42',
      rootOwnsRouter: false,
    });
    expect(candidates[0]?.criticalSurfaces.map((surface) => surface.sourcePath)).toEqual([
      ROUTE,
      PAGE,
      TARGET,
    ]);
    expect(candidates[0]?.criticalSurfaces.map((surface) => surface.sourcePath)).not.toContain(APP);
    expect(candidates.map((item) => item.browserCandidate.root.sourcePath)).toEqual([
      ROUTE,
      ROUTE,
      PAGE,
      PAGE,
      TARGET,
    ]);
    expect(
      candidates.every((item) => {
        const executionRoot = item.criticalSurfaces.find(
          (surface) => surface.id === item.executionRootSurfaceId,
        );
        return (
          executionRoot?.sourcePath === item.browserCandidate.root.sourcePath &&
          executionRoot.exportName === item.browserCandidate.root.exportName &&
          Object.isFrozen(item.browserCandidate)
        );
      }),
    ).toBe(true);
    expect(candidates[0]?.browserCandidate).toMatchObject({
      root: { exportName: 'RouteLayout', sourcePath: ROUTE },
      rootAutomaticProps: {},
      rootOwnsRouter: false,
      routeMountBasePath: '/',
      routeSlotCount: 1,
      wildcardFallbackPresent: true,
    });
    expect(candidates[0]?.browserCandidate.rootStepIndex).toBeUndefined();
    expect(candidates[0]?.browserCandidate.rootInference).toBeUndefined();
    expect(candidates[2]?.browserCandidate).toMatchObject({
      root: { exportName: 'SelectedPage', sourcePath: PAGE },
      rootAutomaticProps: { staleRoot: true },
      rootInference: candidate.rootInference,
      rootOwnsRouter: true,
      rootStepIndex: 1,
      routeMountBasePath: '/stale',
      routeSlotCount: 99,
      wildcardFallbackPresent: false,
    });
    expect(candidates.at(-1)?.browserCandidate).toMatchObject({
      root: { exportName: 'Target', sourcePath: TARGET },
      rootAutomaticProps: {},
      rootOwnsRouter: false,
    });
    expect(candidates.at(-1)?.browserCandidate.rootStepIndex).toBeUndefined();
    expect(candidates.at(-1)?.browserCandidate.rootInference).toBeUndefined();
    expect(candidates.at(-1)?.browserCandidate.routeMountBasePath).toBeUndefined();
    expect(candidate.root).toEqual({ exportName: 'SelectedPage', sourcePath: PAGE });
    expect(candidate.rootAutomaticProps).toEqual({ staleRoot: true });
    expect(candidate.rootStepIndex).toBe(1);
    expect(candidates[0]?.executionRootSurfaceId).toBe(candidates[0]?.criticalSurfaces[0]?.id);
    expect(
      candidates[0]?.criticalSurfaces.find(
        (surface) => surface.id === candidates[0]?.runtimeTargetSurfaceId,
      ),
    ).toMatchObject({ exportName: 'Target', sourcePath: TARGET });
    expect(candidates.at(-1)?.criticalSurfaces).toEqual([
      expect.objectContaining({ sourcePath: TARGET, strategy: 'authentic-module-export' }),
    ]);
    expect(candidates.every((item) => item.routeRecipe?.pathname === '/selected/42')).toBe(true);
    expect(candidates.map((item) => item.routeRecipe?.rootOwnsRouter)).toEqual([
      false,
      false,
      true,
      true,
      false,
    ]);
    const authenticRouteCandidate = candidates[0];
    if (authenticRouteCandidate === undefined) {
      throw new Error('Expected one authentic route candidate.');
    }
    const executionRoot = authenticRouteCandidate.criticalSurfaces.find(
      (surface) => surface.id === authenticRouteCandidate.executionRootSurfaceId,
    );
    if (executionRoot === undefined) throw new Error('Expected an execution-root surface.');
    const executionSource = createPreviewInspectorPageExecutionSource({
      candidate: authenticRouteCandidate,
      executionRootModuleContract: createPreviewInspectorExecutionRootModuleContract({
        exportName: executionRoot.exportName,
        preparedSourceText:
          executionRoot.exportName === 'default'
            ? 'export default function PreviewRouteRoot() { return null; }'
            : `export function ${executionRoot.exportName}() { return null; }`,
        sourcePath: executionRoot.sourcePath,
        surfaceId: executionRoot.id,
      }),
      target: plan.target,
    });
    expect(executionSource).not.toContain('PreviewInspectorContextualTargetFallback');
  });

  it('keeps shared descendant chrome outside an outer route mount', () => {
    const contentAndPanelPath = '/workspace/ContentAndPanel.tsx';
    const featureBranchPath = '/workspace/FeatureBranch.tsx';
    const renderPath: PreviewRenderChainCandidate = {
      entryPoint: {
        kind: 'create-root',
        occurrenceStart: 10,
        sourcePath: '/workspace/main.tsx',
        wrapperNames: [],
      },
      id: 'shared-descendant-route-path',
      steps: [
        {
          certainty: 'confirmed',
          kind: 'component-render',
          label: 'Target',
          occurrenceStart: 1,
          sourcePath: TARGET,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed',
          kind: 'component-render',
          label: 'ContentAndPanel',
          occurrenceStart: 2,
          sourcePath: contentAndPanelPath,
          wrapperNames: [],
        },
        {
          certainty: 'conditional',
          kind: 'route-branch',
          label: 'FeatureBranch',
          occurrenceStart: 3,
          sourcePath: featureBranchPath,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed',
          kind: 'component-render',
          label: 'Application',
          occurrenceStart: 4,
          sourcePath: APP,
          wrapperNames: [],
        },
      ],
    };
    const routeLocation = {
      componentExportName: 'FeatureBranch',
      componentName: 'FeatureBranch',
      componentSourcePath: featureBranchPath,
      dependencyPaths: [APP, featureBranchPath],
      evidenceKind: 'route-jsx' as const,
      pathname: '/feature',
      pattern: '/feature',
      routeMounts: [
        {
          basePath: '/',
          exportName: 'Application',
          hasWildcardFallback: false,
          routeSlotCount: 1,
          sourcePath: APP,
        },
      ],
      sourcePath: APP,
    };
    const createSharedCandidate = (
      id: string,
      root: PreviewInspectorPageCandidate['root'],
      rootStepIndex: number,
    ): PreviewInspectorPageCandidate => ({
      complete: rootStepIndex === 3,
      dependencyPaths: [TARGET, contentAndPanelPath, featureBranchPath, APP],
      edges: [],
      id,
      renderPath,
      root,
      rootAutomaticProps: {},
      rootOwnsRouter: rootStepIndex === 3,
      rootStepIndex,
      routeLocation,
      stopReason: rootStepIndex === 3 ? 'root-reached' : 'render-path-checkpoint',
      target: { exportName: 'FeatureBranch', sourcePath: featureBranchPath },
      targetAutomaticProps: {},
    });
    const plan = {
      pageCandidates: [
        createSharedCandidate(
          'shared-application',
          { exportName: 'Application', sourcePath: APP },
          3,
        ),
        createSharedCandidate(
          'shared-route-leaf',
          { exportName: 'FeatureBranch', sourcePath: featureBranchPath },
          2,
        ),
        createSharedCandidate(
          'shared-content-checkpoint',
          { exportName: 'ContentAndPanel', sourcePath: contentAndPanelPath },
          1,
        ),
      ],
      renderChain: { paths: [renderPath] },
      renderChainsByExport: { Target: { paths: [renderPath] } },
      target: { exportName: 'Target', sourcePath: TARGET },
    } as unknown as PreviewInspectorAncestorPlan;

    const candidates = createPreviewInspectorPageExecutionCandidates({ plan });

    expect(candidates.map((candidate) => candidate.fidelity)).toEqual([
      'page-authentic',
      'page-sliced',
      'target-only',
    ]);
    expect(candidates[0]?.browserCandidate.root).toEqual({
      exportName: 'ContentAndPanel',
      sourcePath: contentAndPanelPath,
    });
    expect(candidates[0]?.browserCandidate.routeLocation).toMatchObject({
      pathname: '/feature',
      routeMounts: [],
    });
    expect(candidates[0]?.criticalSurfaces.map((surface) => surface.sourcePath)).toEqual([
      contentAndPanelPath,
      TARGET,
    ]);
    expect(candidates.every((candidate) => candidate.routeRecipe?.pathname === '/feature')).toBe(
      true,
    );
  });

  it('keeps an outer page-layout wrapper around an exact nested route owner', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-nested-page-shell-'));
    const applicationPath = path.join(workspaceRoot, 'Application.tsx');
    const companyOwnerPath = path.join(workspaceRoot, 'CompanyOwnerApp.tsx');
    const featureOwnerPath = path.join(workspaceRoot, 'FeatureApp.tsx');
    const layoutPath = path.join(workspaceRoot, 'CompanyOwnerLayout.tsx');
    const pagePath = path.join(workspaceRoot, 'SelectedPage.tsx');
    const targetPath = path.join(workspaceRoot, 'TargetPanel.tsx');
    try {
      await Promise.all([
        writeFile(
          featureOwnerPath,
          [
            "import { Route, Routes } from 'react-router-dom';",
            "import SelectedPage from './SelectedPage';",
            'export const FeatureApp = createAppModule(',
            "  '/company/:companyId(\\\\d+)/feature',",
            '  { SelectedPage },',
            '  [],',
            '  ({ pageRoutes }) => <Routes>{pageRoutes}<Route path="*" element={null} /></Routes>,',
            ');',
          ].join('\n'),
        ),
        writeFile(
          layoutPath,
          'export function CompanyOwnerLayout({ children }) { return <main>{children}</main>; }',
        ),
        writeFile(
          pagePath,
          "import { TargetPanel } from './TargetPanel'; export default function SelectedPage() { return <TargetPanel />; }",
        ),
        writeFile(
          targetPath,
          'export function TargetPanel() { return <section>target</section>; }',
        ),
      ]);
      const renderPath: PreviewRenderChainCandidate = {
        entryPoint: {
          kind: 'create-root',
          occurrenceStart: 50,
          sourcePath: applicationPath,
          wrapperNames: [],
        },
        id: 'nested-route-with-outer-page-shell',
        steps: [
          {
            certainty: 'confirmed',
            invocation: { calleeName: 'TargetPanel', mode: 'jsx', sourcePath: pagePath },
            kind: 'component-render',
            label: 'TargetPanel',
            occurrenceStart: 1,
            sourcePath: targetPath,
            wrapperNames: [],
          },
          {
            certainty: 'confirmed',
            kind: 'route-branch',
            label: 'SelectedPage',
            occurrenceStart: 2,
            sourcePath: pagePath,
            wrapperNames: [],
          },
          {
            certainty: 'conditional',
            kind: 'route-branch',
            label: 'FeatureApp',
            occurrenceStart: 3,
            sourcePath: featureOwnerPath,
            wrapperNames: [],
          },
          {
            certainty: 'conditional',
            kind: 'route-branch',
            label: 'CompanyOwnerApp',
            occurrenceStart: 4,
            sourcePath: companyOwnerPath,
            wrapperNames: [],
          },
          {
            certainty: 'confirmed',
            kind: 'component-render',
            label: 'Application',
            occurrenceStart: 5,
            sourcePath: applicationPath,
            wrapperNames: [],
          },
        ],
      };
      const routeLocation = {
        componentExportName: 'default',
        componentName: 'SelectedPage',
        componentSourcePath: pagePath,
        dependencyPaths: [applicationPath, companyOwnerPath, featureOwnerPath, pagePath],
        evidenceKind: 'route-catalog' as const,
        pathname: '/company/1/feature/dashboard',
        pattern: '/company/:companyId(\\d+)/feature/dashboard',
        sourcePath: featureOwnerPath,
      };
      const createPageCandidate = (
        id: string,
        root: PreviewInspectorPageCandidate['root'],
        rootStepIndex: number,
      ): PreviewInspectorPageCandidate => ({
        complete: rootStepIndex === 4,
        dependencyPaths: [
          applicationPath,
          companyOwnerPath,
          featureOwnerPath,
          pagePath,
          targetPath,
        ],
        edges: [],
        id,
        renderPath,
        root,
        rootAutomaticProps: {},
        rootOwnsRouter: rootStepIndex === 4,
        rootStepIndex,
        routeLocation,
        stopReason: rootStepIndex === 4 ? 'root-reached' : 'render-path-checkpoint',
        target: { exportName: 'TargetPanel', sourcePath: targetPath },
        targetAutomaticProps: {},
      });
      const plan = {
        complete: true,
        dependencyPaths: [
          applicationPath,
          companyOwnerPath,
          featureOwnerPath,
          layoutPath,
          pagePath,
          targetPath,
        ],
        edges: [],
        pageCandidates: [
          createPageCandidate(
            'nested-shell-application',
            { exportName: 'Application', sourcePath: applicationPath },
            4,
          ),
          createPageCandidate(
            'nested-shell-feature-owner',
            { exportName: 'FeatureApp', sourcePath: featureOwnerPath },
            2,
          ),
          createPageCandidate(
            'nested-shell-page',
            { exportName: 'default', sourcePath: pagePath },
            1,
          ),
        ],
        renderChain: {
          paths: [renderPath],
          target: { exportName: 'TargetPanel', sourcePath: targetPath },
        },
        renderChainsByExport: { TargetPanel: { paths: [renderPath] } },
        root: { exportName: 'Application', sourcePath: applicationPath },
        rootAutomaticProps: {},
        shallowVisualPaths: [
          {
            exportName: 'CompanyOwnerLayout',
            importerPath: companyOwnerPath,
            importKind: 'static',
            localEdges: [],
            moduleSpecifier: './CompanyOwnerLayout',
            occurrenceStart: 40,
            relation: 'wrapper',
            renderedLocalName: 'CompanyOwnerLayout',
            renderBoundaryStart: 30,
            selectedChildPath: featureOwnerPath,
            sourcePath: layoutPath,
          },
        ],
        stopReason: 'root-reached',
        target: { exportName: 'TargetPanel', sourcePath: targetPath },
        targetAutomaticProps: {},
      } as unknown as PreviewInspectorAncestorPlan;

      const candidate = createPreviewInspectorPageExecutionCandidates({ plan }).find(
        (item) => item.fidelity === 'page-authentic',
      );
      if (candidate === undefined)
        throw new Error('Expected a page-authentic execution candidate.');
      const layoutSurface = candidate.criticalSurfaces.find(
        (surface) => surface.sourcePath === layoutPath,
      );
      const ownerSurface = candidate.criticalSurfaces.find(
        (surface) => surface.sourcePath === featureOwnerPath,
      );
      const pageSurface = candidate.criticalSurfaces.find(
        (surface) => surface.sourcePath === pagePath,
      );

      expect(layoutSurface).toBeDefined();
      expect(ownerSurface).toBeDefined();
      expect(pageSurface).toBeDefined();
      expect(candidate.compositionEdges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            childSurfaceId: ownerSurface?.id,
            mode: 'children-slot',
            parentSurfaceId: layoutSurface?.id,
          }),
          expect.objectContaining({
            childSurfaceId: pageSurface?.id,
            mode: 'contains-authored-child',
            parentSurfaceId: ownerSurface?.id,
          }),
        ]),
      );
      expect(candidate.executionRootSurfaceId).toBe(ownerSurface?.id);
      expect(candidate.browserCandidate.root).toEqual({
        exportName: 'FeatureApp',
        sourcePath: featureOwnerPath,
      });
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it('recreates the parent Route context for a retained useRoutes owner', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-use-routes-owner-'));
    const ownerPath = path.join(workspaceRoot, 'NestedOwner.tsx');
    const childPath = path.join(workspaceRoot, 'ChildPage.tsx');
    try {
      await Promise.all([
        writeFile(
          ownerPath,
          [
            "import { useRoutes } from 'react-router-dom';",
            "import ChildPage from './ChildPage';",
            'export default function NestedOwner() {',
            "  return useRoutes([{ path: 'child', element: <ChildPage /> }]);",
            '}',
          ].join('\n'),
        ),
        writeFile(
          childPath,
          'export default function ChildPage() { return <main>selected child</main>; }',
        ),
      ]);
      const routeLocation = {
        componentExportName: 'default',
        componentName: 'ChildPage',
        componentSourcePath: childPath,
        componentSourcePaths: [ownerPath, childPath],
        dependencyPaths: [ownerPath, childPath],
        evidenceKind: 'route-jsx' as const,
        pathname: '/root/child',
        pattern: '/root/child',
        routeMounts: [
          {
            basePath: '/root',
            contextPattern: '/root/*',
            exportName: 'default',
            hasWildcardFallback: false,
            routeSlotCount: 1,
            sourcePath: ownerPath,
          },
        ],
        sourcePath: ownerPath,
      };
      const owner = {
        complete: false,
        dependencyPaths: [ownerPath, childPath],
        edges: [],
        id: 'nested-owner',
        root: { exportName: 'default', sourcePath: ownerPath },
        rootAutomaticProps: {},
        rootOwnsRouter: false,
        routeLocation,
        stopReason: 'render-path-checkpoint',
        targetAutomaticProps: {},
      } as PreviewInspectorPageCandidate;
      const plan = {
        pageCandidates: [owner],
        renderChain: { paths: [] },
        renderChainsByExport: {},
        target: { exportName: 'default', sourcePath: childPath },
      } as unknown as PreviewInspectorAncestorPlan;

      const nestedCandidates = createPreviewInspectorPageExecutionCandidates({
        plan,
        targetMode: 'selected-route-leaf',
      });
      const candidate = nestedCandidates[0];
      expect(candidate?.routeRecipe).toMatchObject({
        kind: 'react-router-v6',
        mounts: [
          expect.objectContaining({
            contextPattern: '/root/*',
          }),
        ],
        pathname: '/root/child',
        rootOwnsRouter: false,
        routerModuleSpecifier: 'react-router-dom',
      });
      if (candidate === undefined)
        throw new Error('Expected one nested route execution candidate.');
      expect(nestedCandidates.every((item) => item.fidelity !== 'target-only')).toBe(true);
      expect(
        nestedCandidates.every(
          (item) => item.executionRootSurfaceId !== item.runtimeTargetSurfaceId,
        ),
      ).toBe(true);
      expect(owner.root).toEqual({ exportName: 'default', sourcePath: ownerPath });
      const ownerSurface = candidate.criticalSurfaces.find(
        (surface) => surface.sourcePath === ownerPath,
      );
      const childSurface = candidate.criticalSurfaces.find(
        (surface) => surface.sourcePath === childPath,
      );
      expect(candidate.executionRootSurfaceId).toBe(ownerSurface?.id);
      expect(candidate.runtimeTargetSurfaceId).toBe(childSurface?.id);
      expect(candidate.executionRootContract).toEqual({
        exportName: 'default',
        sourcePath: ownerPath,
        surfaceId: ownerSurface?.id,
      });
      expect(candidate.runtimeTargetContract).toEqual({
        exportName: 'default',
        sourcePath: childPath,
        surfaceId: childSurface?.id,
      });
      const ownershipOptions = {
        analysisTarget: { exportName: 'App', sourcePath: ownerPath },
        candidate,
        diagnosticPath: ownerPath,
        routeSelection: [
          { componentName: 'NestedOwner', pattern: '/root/*' },
          { componentName: 'ChildPage', pattern: '/root/child' },
        ],
        routeSelectionResolution: 'exact' as const,
        selectedLeafSourceText:
          'export default function ChildPage() { return <main>selected child</main>; }',
        targetMode: 'selected-route-leaf' as const,
      };
      const runtimeTarget = resolvePreviewInspectorRuntimeOwnershipTarget(ownershipOptions);
      expect(runtimeTarget).toEqual({ exportName: 'default', sourcePath: childPath });
      expect(
        resolvePreviewInspectorRuntimeOwnershipTarget({
          ...ownershipOptions,
          routeSelection: [{ componentName: 'NestedOwner', pattern: '/root/*' }],
        }),
      ).toEqual({ exportName: 'default', sourcePath: childPath });
      expect(() =>
        resolvePreviewInspectorRuntimeOwnershipTarget({
          ...ownershipOptions,
          routeSelection: [{ componentName: 'ChildPage', pattern: '/root/child' }],
        }),
      ).toThrow(/mismatched, cyclic, ambiguous, or reordered nested mount edge/u);
      const source = createPreviewInspectorPageExecutionSource({
        candidate,
        executionRootModuleContract: createPreviewInspectorExecutionRootModuleContract({
          exportName: candidate.executionRootContract.exportName,
          preparedSourceText: [
            "import { useRoutes } from 'react-router-dom';",
            "import ChildPage from './ChildPage';",
            'export default function NestedOwner() {',
            "  return useRoutes([{ path: 'child', element: <ChildPage /> }]);",
            '}',
          ].join('\n'),
          sourcePath: candidate.executionRootContract.sourcePath,
          surfaceId: candidate.executionRootContract.surfaceId,
        }),
        target: runtimeTarget,
      });
      expect(source).toContain("import { MemoryRouter, Route, Routes } from 'react-router-dom';");
      expect(source).toContain('initialEntries: ["/root/child"]');
      expect(source).toContain('path: "/root/*"');
      expect(source).toContain(`from ${JSON.stringify(canonicalizeExistingPath(ownerPath))}`);
      expect(source).toContain('from "react-preview:inspector-target-facade"');
      expect(source).not.toContain(`from ${JSON.stringify(childPath)}`);
      expect(source).not.toContain('path: "/root/child", element: React.createElement(Surface0');

      const routeRecipe = candidate.routeRecipe;
      const mount = routeRecipe?.mounts[0];
      if (routeRecipe === undefined || mount === undefined || ownerSurface === undefined) {
        throw new Error('Expected one complete nested route recipe.');
      }
      const invalidCandidates = [
        {
          ...candidate,
          routeRecipe: { ...routeRecipe, mounts: [] },
        },
        {
          ...candidate,
          routeRecipe: {
            ...routeRecipe,
            mounts: [{ ...mount, childSurfaceId: ownerSurface.id }],
          },
        },
        {
          ...candidate,
          routeRecipe: {
            ...routeRecipe,
            mounts: [{ ...mount, childSurfaceId: 'wrong-terminal' }],
          },
        },
        {
          ...candidate,
          routeRecipe: {
            ...routeRecipe,
            mounts: [{ ...mount, contextPattern: undefined }],
          },
        },
        {
          ...candidate,
          routeRecipe: {
            ...routeRecipe,
            mounts: [{ ...mount, contextPattern: '/wrong/*' }],
          },
        },
      ];
      for (const invalidCandidate of invalidCandidates) {
        expect(() =>
          resolvePreviewInspectorRuntimeOwnershipTarget({
            ...ownershipOptions,
            candidate: invalidCandidate as never,
          }),
        ).toThrow(PreviewCompilationError);
      }
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it('mounts an authentic route-factory shell at its proven base path', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-factory-shell-'));
    const ownerPath = path.join(workspaceRoot, 'CompanyOwnerApp.tsx');
    const pagePath = path.join(workspaceRoot, 'CompanyInitialPage.tsx');
    const layoutPath = path.join(workspaceRoot, 'CompanyOwnerLayout.tsx');
    const catalogPath = path.join(workspaceRoot, 'pages.json');
    const ownerSource = [
      "import { Routes } from 'react-router-dom';",
      "import CompanyInitialPage from './CompanyInitialPage';",
      'export const CompanyOwnerApp = createAppModule(',
      "  '/company/:companyId(\\\\d+)',",
      '  { CompanyInitialPage },',
      '  [],',
      '  ({ pageRoutes }) => (',
      '    <CompanyOwnerAppProviders>',
      '      <CompanyOwnerLayout><Routes>{pageRoutes}</Routes></CompanyOwnerLayout>',
      '      <GuideModalsCoordinator />',
      '    </CompanyOwnerAppProviders>',
      '  ),',
      ');',
    ].join('\n');
    const pageSource =
      'export default function CompanyInitialPage() { return <main>company initial</main>; }';
    try {
      await Promise.all([writeFile(ownerPath, ownerSource), writeFile(pagePath, pageSource)]);
      const routeLocation = {
        componentName: 'CompanyInitialPage',
        dependencyPaths: [catalogPath, ownerPath, pagePath],
        evidenceKind: 'route-catalog' as const,
        pathname: '/company/1',
        pattern: '/company/:companyId(\\d+)',
        sourcePath: catalogPath,
      };
      const renderPath: PreviewRenderChainCandidate = {
        entryPoint: {
          kind: 'create-root',
          occurrenceStart: 30,
          sourcePath: path.join(workspaceRoot, 'main.tsx'),
          wrapperNames: [],
        },
        id: 'company-owner-route-factory',
        steps: [
          {
            certainty: 'confirmed',
            kind: 'route-branch',
            label: 'CompanyInitialPage',
            occurrenceStart: 10,
            sourcePath: pagePath,
            wrapperNames: [],
          },
          {
            certainty: 'confirmed',
            kind: 'route-branch',
            label: 'CompanyOwnerApp',
            occurrenceStart: 20,
            sourcePath: ownerPath,
            wrapperNames: [],
          },
        ],
      };
      const owner = {
        complete: true,
        dependencyPaths: [catalogPath, ownerPath, pagePath],
        edges: [],
        id: 'company-owner',
        renderPath,
        root: { exportName: 'CompanyOwnerApp', sourcePath: ownerPath },
        rootAutomaticProps: {},
        rootOwnsRouter: false,
        rootStepIndex: 1,
        routeLocation,
        stopReason: 'root-reached',
        target: { exportName: 'default', sourcePath: pagePath },
        targetAutomaticProps: {},
      } as PreviewInspectorPageCandidate;
      const page = {
        ...owner,
        complete: false,
        id: 'company-page',
        root: { exportName: 'default', sourcePath: pagePath },
        rootStepIndex: 0,
        stopReason: 'render-path-checkpoint',
      } as PreviewInspectorPageCandidate;
      const plan = {
        complete: true,
        dependencyPaths: [catalogPath, ownerPath, pagePath],
        edges: [],
        pageCandidates: [owner, page],
        renderChain: {
          paths: [renderPath],
          target: { exportName: 'default', sourcePath: pagePath },
        },
        renderChainsByExport: { default: { paths: [renderPath] } },
        root: owner.root,
        rootAutomaticProps: {},
        routeSelectionResolution: 'exact',
        shallowVisualPaths: [
          {
            exportName: 'CompanyOwnerLayout',
            importerPath: ownerPath,
            importKind: 'static',
            localEdges: [],
            moduleSpecifier: './CompanyOwnerLayout',
            occurrenceStart: 40,
            relation: 'sibling',
            renderedLocalName: 'CompanyOwnerLayout',
            renderBoundaryStart: 35,
            selectedChildPath: pagePath,
            sourcePath: layoutPath,
          },
        ],
        stopReason: 'root-reached',
        target: { exportName: 'default', sourcePath: pagePath },
        targetAutomaticProps: {},
      } as unknown as PreviewInspectorAncestorPlan;

      const candidate = createPreviewInspectorPageExecutionCandidates({
        plan,
        targetMode: 'selected-route-leaf',
      })[0];
      if (candidate === undefined) {
        throw new Error('Expected one route-factory shell execution candidate.');
      }
      const ownerSurface = candidate.criticalSurfaces.find(
        (surface) => surface.sourcePath === ownerPath,
      );
      expect(candidate.executionRootSurfaceId).toBe(ownerSurface?.id);
      expect(candidate.executionRootSurfaceId).not.toBe(candidate.runtimeTargetSurfaceId);
      expect(candidate.browserCandidate.routeLocation).toMatchObject({
        routeMounts: [
          {
            basePath: '/company/:companyId(\\d+)',
            contextOrigin: 'virtual-page-owner',
            contextPattern: '/company/:companyId(\\d+)/*',
            exportName: 'CompanyOwnerApp',
            routeSlotCount: 1,
            sourcePath: ownerPath,
          },
        ],
      });
      expect(candidate.routeRecipe).toMatchObject({
        kind: 'react-router-v6',
        mounts: [
          {
            contextOrigin: 'virtual-page-owner',
            contextPattern: '/company/:companyId(\\d+)/*',
            parentSurfaceId: ownerSurface?.id,
          },
        ],
        pathname: '/company/1',
        rootOwnsRouter: false,
      });
      const runtimeTarget = resolvePreviewInspectorRuntimeOwnershipTarget({
        analysisTarget: plan.target,
        candidate,
        diagnosticPath: pagePath,
        routeSelection: [
          {
            componentName: 'CompanyInitialPage',
            pattern: '/company/:companyId(\\d+)',
          },
        ],
        routeSelectionResolution: 'exact',
        selectedLeafSourceText: pageSource,
        targetMode: 'selected-route-leaf',
      });
      const source = createPreviewInspectorPageExecutionSource({
        candidate,
        executionRootModuleContract: createPreviewInspectorExecutionRootModuleContract({
          exportName: candidate.executionRootContract.exportName,
          preparedSourceText: ownerSource,
          sourcePath: candidate.executionRootContract.sourcePath,
          surfaceId: candidate.executionRootContract.surfaceId,
        }),
        target: runtimeTarget,
      });
      expect(source).toContain("import { MemoryRouter, Route, Routes } from 'react-router-dom';");
      expect(source).toContain('initialEntries: ["/company/1"]');
      expect(source).toContain('path: "/company/:companyId/*"');
      expect(source).not.toContain('index: true');
      expect(source).toContain(`from ${JSON.stringify(canonicalizeExistingPath(ownerPath))}`);
      expect(source).toContain('from "react-preview:inspector-target-facade"');
      expect(source).toContain(
        `registerVirtualPageSource?.(${JSON.stringify(canonicalizeExistingPath(layoutPath))})`,
      );
      expect(source).not.toContain(`from ${JSON.stringify(pagePath)}`);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it('uses the live VirtualPage checkpoint ownership after omitting an authored app router', () => {
    const renderPath: PreviewRenderChainCandidate = {
      entryPoint: {
        kind: 'create-root',
        occurrenceStart: 4,
        sourcePath: '/workspace/main.tsx',
        wrapperNames: [],
      },
      id: 'virtual-page-path',
      steps: [
        {
          certainty: 'confirmed',
          kind: 'component-render',
          label: 'Target',
          occurrenceStart: 1,
          sourcePath: TARGET,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed',
          kind: 'route-branch',
          label: 'SelectedPage',
          occurrenceStart: 2,
          sourcePath: PAGE,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed',
          kind: 'component-render',
          label: 'AppRouter',
          occurrenceStart: 3,
          sourcePath: APP,
          wrapperNames: [],
        },
      ],
    };
    const routeLocation = {
      componentName: 'SelectedPage',
      dependencyPaths: [],
      evidenceKind: 'route-jsx' as const,
      pathname: '/selected',
      pattern: '/selected',
      routeMounts: [],
      sourcePath: APP,
    };
    const authoredApp = {
      complete: true,
      dependencyPaths: [TARGET, PAGE, APP],
      edges: [],
      id: 'app-root',
      renderPath,
      root: { exportName: 'default', sourcePath: APP },
      rootAutomaticProps: {},
      rootOwnsRouter: true,
      rootStepIndex: 2,
      routeLocation,
      stopReason: 'root-reached',
      targetAutomaticProps: {},
    } as PreviewInspectorPageCandidate;
    const contentPage = {
      ...authoredApp,
      complete: false,
      id: 'page-checkpoint',
      root: { exportName: 'SelectedPage', sourcePath: PAGE },
      rootOwnsRouter: false,
      rootStepIndex: 1,
      stopReason: 'render-path-checkpoint',
    } as PreviewInspectorPageCandidate;
    const plan = {
      pageCandidates: [authoredApp, contentPage],
      renderChain: { paths: [renderPath] },
      renderChainsByExport: { Target: { paths: [renderPath] } },
      target: { exportName: 'Target', sourcePath: TARGET },
    } as unknown as PreviewInspectorAncestorPlan;

    const candidates = createPreviewInspectorPageExecutionCandidates({
      plan,
      selectedPageCandidateId: 'app-root',
    });

    expect(candidates[0]?.browserCandidate.root.sourcePath).toBe(PAGE);
    expect(candidates[0]?.routeRecipe?.rootOwnsRouter).toBe(false);
    expect(candidates[0]?.criticalSurfaces.map((surface) => surface.sourcePath)).not.toContain(APP);
  });

  /** Rejects wrapper-only distinct roles when no retained mount chain proves their execution path. */
  it('keeps only an internally consistent leaf when inline wrappers lack a retained mount chain', () => {
    const routeLocation = {
      componentExportName: 'default',
      componentName: 'SelectedPage',
      componentSourcePath: PAGE,
      dependencyPaths: [APP, ROUTE, PAGE],
      elementWrappers: [
        {
          componentName: 'RouteLayout',
          exportName: 'default',
          sourcePath: ROUTE,
        },
      ],
      evidenceKind: 'route-jsx' as const,
      pathname: '/selected',
      pattern: '/selected',
      routeMounts: [
        {
          basePath: '/selected',
          exportName: 'RouteOwner',
          hasWildcardFallback: true,
          routeSlotCount: 1,
          sourcePath: APP,
        },
      ],
      sourcePath: APP,
    };
    const routePage = {
      complete: true,
      dependencyPaths: [APP, ROUTE, PAGE],
      edges: [],
      id: 'detached-route-leaf',
      root: { exportName: 'default', sourcePath: PAGE },
      rootAutomaticProps: {},
      rootOwnsRouter: false,
      routeLocation,
      stopReason: 'render-path-checkpoint',
      targetAutomaticProps: {},
    } as PreviewInspectorPageCandidate;
    const plan = {
      pageCandidates: [routePage],
      renderChain: { paths: [] },
      renderChainsByExport: {},
      target: { exportName: 'Target', sourcePath: TARGET },
    } as unknown as PreviewInspectorAncestorPlan;

    const candidates = createPreviewInspectorPageExecutionCandidates({
      plan,
      targetMode: 'selected-route-leaf',
    });
    const leaf = candidates[0];

    expect(candidates.map((candidate) => candidate.fidelity)).toEqual(['target-only']);
    expect(leaf?.criticalSurfaces).toEqual([
      expect.objectContaining({
        exportName: 'default',
        sourcePath: PAGE,
        strategy: 'authentic-module-export',
      }),
    ]);
    expect(leaf?.compositionEdges).toEqual([]);
    expect(leaf?.routeRecipe).toMatchObject({
      loaderPolicy: 'never-execute',
      mounts: [],
      pathname: '/selected',
      rootOwnsRouter: false,
    });
    expect(leaf?.browserCandidate.root).toEqual({
      exportName: 'default',
      sourcePath: PAGE,
    });
    expect(leaf?.criticalSurfaces.map((surface) => surface.sourcePath)).not.toContain(APP);
    expect(leaf?.criticalSurfaces.map((surface) => surface.sourcePath)).not.toContain(ROUTE);
    expect(leaf?.criticalSurfaces.map((surface) => surface.sourcePath)).not.toContain(TARGET);
    expect(leaf?.executionRootSurfaceId).toBe(leaf?.runtimeTargetSurfaceId);
  });

  it('retains an authenticated direct catalog owner around a detached selected route leaf', () => {
    const renderPath: PreviewRenderChainCandidate = {
      entryPoint: {
        kind: 'create-root',
        occurrenceStart: 3,
        sourcePath: '/workspace/main.tsx',
        wrapperNames: [],
      },
      id: 'catalog-route-path',
      steps: [
        {
          certainty: 'confirmed',
          kind: 'route-branch',
          label: 'SelectedPage',
          occurrenceStart: 1,
          sourcePath: PAGE,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed',
          kind: 'component-render',
          label: 'AppRouter',
          occurrenceStart: 2,
          sourcePath: APP,
          wrapperNames: [],
        },
      ],
    };
    const routeLocation = {
      componentExportName: 'default',
      componentName: 'SelectedPage',
      componentSourcePath: PAGE,
      dependencyPaths: [APP, PAGE, '/workspace/pages.json'],
      directRouteOwnerSourcePath: APP,
      evidenceKind: 'route-catalog' as const,
      pathname: '/selected',
      pattern: '/selected',
      routeMounts: [
        {
          basePath: '/',
          exportName: 'default',
          hasWildcardFallback: false,
          routeSlotCount: 1,
          sourcePath: APP,
        },
      ],
      sourcePath: '/workspace/pages.json',
    };
    const authoredApp = {
      complete: true,
      dependencyPaths: [APP, PAGE, '/workspace/pages.json'],
      edges: [],
      id: 'catalog-app-root',
      renderPath,
      root: { exportName: 'default', sourcePath: APP },
      rootAutomaticProps: {},
      rootOwnsRouter: true,
      rootStepIndex: 1,
      routeLocation,
      stopReason: 'root-reached',
      targetAutomaticProps: {},
    } as PreviewInspectorPageCandidate;
    const contentPage = {
      ...authoredApp,
      complete: false,
      id: 'catalog-page-checkpoint',
      root: { exportName: 'default', sourcePath: PAGE },
      rootOwnsRouter: false,
      rootStepIndex: 0,
      stopReason: 'render-path-checkpoint',
    } as PreviewInspectorPageCandidate;
    const plan = {
      pageCandidates: [authoredApp, contentPage],
      renderChain: { paths: [renderPath] },
      renderChainsByExport: { default: { paths: [renderPath] } },
      target: { exportName: 'default', sourcePath: APP },
    } as unknown as PreviewInspectorAncestorPlan;

    const candidates = createPreviewInspectorPageExecutionCandidates({
      plan,
      selectedPageCandidateId: 'catalog-app-root',
      targetMode: 'selected-route-leaf',
    });

    expect(candidates.map((candidate) => candidate.fidelity)).toContain('route-page-authentic');
    expect(candidates[0]?.browserCandidate.root).toEqual({
      exportName: 'default',
      sourcePath: APP,
    });
    expect(candidates[0]?.routeRecipe?.mounts).toHaveLength(1);
    expect(typeof candidates[0]?.routeRecipe?.mounts[0]?.parentSurfaceId).toBe('string');
    expect(candidates[0]?.executionRootSurfaceId).not.toBe(candidates[0]?.runtimeTargetSurfaceId);
    expect(candidates.map((candidate) => candidate.fidelity)).not.toContain('target-only');
    const candidate = candidates[0];
    const evidenceMount = routeLocation.routeMounts[0];
    const recipeMount = candidate?.routeRecipe?.mounts[0];
    if (candidate === undefined || evidenceMount === undefined || recipeMount === undefined) {
      throw new Error('Expected one complete direct catalog-owner mount.');
    }
    const ownershipOptions = {
      analysisTarget: plan.target,
      candidate,
      diagnosticPath: APP,
      routeSelection: [{ componentName: 'SelectedPage', pattern: '/selected' }],
      routeSelectionResolution: 'exact' as const,
      selectedLeafSourceText:
        'export default function SelectedPage() { return <main>selected route</main>; }',
      targetMode: 'selected-route-leaf' as const,
    };
    expect(resolvePreviewInspectorRuntimeOwnershipTarget(ownershipOptions)).toEqual({
      exportName: 'default',
      sourcePath: PAGE,
    });

    const withEvidenceMount = (mount: typeof evidenceMount): typeof candidate => ({
      ...candidate,
      browserCandidate: {
        ...candidate.browserCandidate,
        routeLocation: {
          ...routeLocation,
          routeMounts: [mount],
        },
      },
    });
    for (const invalidCandidate of [
      withEvidenceMount({ ...evidenceMount, sourcePath: ROUTE }),
      withEvidenceMount({ ...evidenceMount, exportName: 'OtherApp' }),
      {
        ...candidate,
        routeRecipe: {
          ...candidate.routeRecipe,
          mounts: [{ ...recipeMount, contextPattern: '/unexpected/*' }],
        },
      },
    ]) {
      expect(() =>
        resolvePreviewInspectorRuntimeOwnershipTarget({
          ...ownershipOptions,
          candidate: invalidCandidate as never,
        }),
      ).toThrow(PreviewCompilationError);
    }
  });

  it('preserves known generic route state when no authored route mount can be recovered', () => {
    const page = {
      complete: false,
      dependencyPaths: [PAGE],
      edges: [],
      id: 'selected',
      root: { exportName: 'Page', sourcePath: PAGE },
      rootAutomaticProps: {},
      rootOwnsRouter: false,
      routeLocation: {
        componentName: 'Page',
        dependencyPaths: [],
        evidenceKind: 'route-jsx',
        pathname: '/known/path',
        pattern: '/known/path',
        routeMounts: [],
        sourcePath: PAGE,
      },
      stopReason: 'render-path-checkpoint',
      targetAutomaticProps: {},
    } as PreviewInspectorPageCandidate;
    const plan = {
      pageCandidates: [page],
      renderChain: { paths: [] },
      renderChainsByExport: {},
      target: { exportName: 'Target', sourcePath: TARGET },
    } as unknown as PreviewInspectorAncestorPlan;

    const candidates = createPreviewInspectorPageExecutionCandidates({ plan });

    expect(candidates.map((candidate) => candidate.fidelity)).toEqual([
      'page-authentic',
      'page-sliced',
      'target-only',
    ]);
    expect(candidates.every((candidate) => candidate.routeRecipe?.pathname === '/known/path')).toBe(
      true,
    );
    expect(candidates.every((candidate) => candidate.routeRecipe?.rootOwnsRouter === false)).toBe(
      true,
    );
  });

  it('honors a valid persisted browser candidate without converting an app root into a fallback', () => {
    const page = (id: string, sourcePath: string): PreviewInspectorPageCandidate => ({
      complete: false,
      dependencyPaths: [sourcePath],
      edges: [],
      id,
      root: { exportName: 'default', sourcePath },
      rootAutomaticProps: {},
      rootOwnsRouter: false,
      stopReason: 'render-path-checkpoint',
      targetAutomaticProps: {},
    });
    const first = page('first', '/workspace/FirstPage.tsx');
    const second = page('second', '/workspace/SecondPage.tsx');
    const plan = {
      pageCandidates: [first, second],
      renderChain: { paths: [] },
      renderChainsByExport: {},
      target: { exportName: 'Target', sourcePath: TARGET },
    } as unknown as PreviewInspectorAncestorPlan;

    const candidates = createPreviewInspectorPageExecutionCandidates({
      plan,
      selectedPageCandidateId: 'second',
    });

    expect(candidates[0]?.browserCandidate.id).toBe('second');
    expect(
      candidates.every((item) =>
        item.criticalSurfaces.every((surface) => surface.sourcePath !== APP),
      ),
    ).toBe(true);
  });

  it('narrows a retry request to one compiler-recreated execution candidate id', () => {
    const candidate = {
      complete: false,
      dependencyPaths: [PAGE],
      edges: [],
      id: 'selected',
      root: { exportName: 'default', sourcePath: PAGE },
      rootAutomaticProps: {},
      rootOwnsRouter: false,
      stopReason: 'render-path-checkpoint',
      targetAutomaticProps: {},
    } as PreviewInspectorPageCandidate;
    const plan = {
      pageCandidates: [candidate],
      renderChain: { paths: [] },
      renderChainsByExport: {},
      target: { exportName: 'Target', sourcePath: TARGET },
    } as unknown as PreviewInspectorAncestorPlan;
    const all = createEligiblePreviewInspectorPageExecutionCandidates(plan, undefined);
    const retry = createEligiblePreviewInspectorPageExecutionCandidates(
      plan,
      undefined,
      all.at(-1)?.id,
    );

    expect(retry).toHaveLength(1);
    expect(retry[0]?.id).toBe(all.at(-1)?.id);
    expect(
      createEligiblePreviewInspectorPageExecutionCandidates(plan, undefined, 'not-a-candidate'),
    ).toEqual(all);
  });
});
