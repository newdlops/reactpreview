/** Covers mounts behavior for previewInspectorPageExecutionCandidates. */
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

import { PreviewCompilationError } from '../../../../src/domain/preview';

import type { PreviewRenderChainCandidate } from '../../../../src/adapters/esbuild/renderGraph';

import { canonicalizeExistingPath } from '../../../../src/shared/pathIdentity';

import { APP, TARGET } from './previewInspectorPageExecutionCandidatesFixtures';

describe('createPreviewInspectorPageExecutionCandidates', () => {
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
});
