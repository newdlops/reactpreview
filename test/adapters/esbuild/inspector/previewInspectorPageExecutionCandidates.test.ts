/** Covers ownership behavior for previewInspectorPageExecutionCandidates. */
/** Verifies authored-source previewInspectorPageExecutionCandidates invariants. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

import os from 'node:os';

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
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

import { APP, PAGE, ROUTE, TARGET } from './previewInspectorPageExecutionCandidatesFixtures';

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
});
