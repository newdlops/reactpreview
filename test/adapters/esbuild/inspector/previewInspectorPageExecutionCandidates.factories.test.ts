/** Covers factories behavior for previewInspectorPageExecutionCandidates. */
/** Verifies authored-source previewInspectorPageExecutionCandidates invariants. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

import os from 'node:os';

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createPreviewInspectorExecutionRootModuleContract,
  createPreviewInspectorPageExecutionCandidates,
  createPreviewInspectorPageExecutionSource,
  resolvePreviewInspectorRuntimeOwnershipTarget,
  type PreviewInspectorAncestorPlan,
  type PreviewInspectorPageCandidate,
} from '../../../../src/adapters/esbuild/inspector';

import type { PreviewRenderChainCandidate } from '../../../../src/adapters/esbuild/renderGraph';

import { canonicalizeExistingPath } from '../../../../src/shared/pathIdentity';

import { APP, PAGE, ROUTE, TARGET } from './previewInspectorPageExecutionCandidatesFixtures';

describe('createPreviewInspectorPageExecutionCandidates', () => {
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
});
