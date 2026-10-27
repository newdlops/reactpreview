/** Covers routeOwners behavior for previewInspectorVirtualPagePlan. */
/** Verifies authored-source previewInspectorVirtualPagePlan invariants. */
import { describe, expect, it } from 'vitest';

import type { PreviewRenderChainCandidate } from '../../../../src/adapters/esbuild/renderGraph';

import {
  createPreviewInspectorVirtualPageCandidates,
  selectPreviewInspectorVirtualPageContentCandidate,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorVirtualPagePlan';

import { expandPreviewInspectorRouteChoiceCandidates } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteChoiceCandidates';

import {
  APP_PATH,
  PAGE_PATH,
  RENDER_PATH,
  createCandidate,
  readRenderPathStep,
} from './previewInspectorVirtualPagePlanFixtures';

describe('PreviewInspectorVirtualPagePlan', () => {
  /** Keeps every route-factory page choice while collapsing redundant roots on the same path. */
  it('emits one selectable VirtualPage per route choice', () => {
    const application = createCandidate({
      complete: true,
      id: 'application-root',
      root: { exportName: 'FeatureApp', sourcePath: APP_PATH },
      rootOwnsRouter: false,
      rootStepIndex: 2,
      stopReason: 'root-reached',
    });
    const checkpoint = createCandidate({
      id: 'feature-checkpoint',
      root: { exportName: 'FeatureApp', sourcePath: PAGE_PATH },
      rootStepIndex: 1,
    });
    const routeChoices = [
      {
        componentName: 'DashboardPage',
        dependencyPaths: ['/workspace/pages.json'],
        evidenceKind: 'route-catalog' as const,
        pathname: '/workspace/1/feature',
        pattern: '/workspace/:workspaceId(\\d+)/feature',
        sourcePath: '/workspace/pages.json',
      },
      {
        componentName: 'SettingsPage',
        dependencyPaths: ['/workspace/pages.json'],
        evidenceKind: 'route-catalog' as const,
        pathname: '/workspace/1/feature/settings',
        pattern: '/workspace/:workspaceId(\\d+)/feature/settings',
        sourcePath: '/workspace/pages.json',
      },
    ];
    const expanded = expandPreviewInspectorRouteChoiceCandidates(
      [application, checkpoint],
      routeChoices,
    );

    const virtualPages = createPreviewInspectorVirtualPageCandidates(expanded);

    expect(virtualPages).toHaveLength(2);
    expect(
      virtualPages.map((candidate) => ({
        componentName: candidate.browserCandidate.routeLocation?.componentName,
        pathname: candidate.browserCandidate.routeLocation?.pathname,
      })),
    ).toEqual([
      { componentName: 'DashboardPage', pathname: '/workspace/1/feature' },
      { componentName: 'SettingsPage', pathname: '/workspace/1/feature/settings' },
    ]);
    expect(virtualPages[0]?.browserCandidate.dependencyPaths).toContain('/workspace/pages.json');
  });

  /** Keeps the proven route factory owner when a resolved descendant has no reverse-path proof. */
  it('keeps a route-factory owner when a resolved descendant lacks reverse-path proof', () => {
    const application = createCandidate({
      complete: true,
      id: 'application-root',
      root: { exportName: 'Application', sourcePath: APP_PATH },
      rootOwnsRouter: true,
      rootStepIndex: 2,
      stopReason: 'root-reached',
    });
    const routeLocation = {
      componentExportName: 'DashboardPage',
      componentName: 'DashboardPage',
      componentSourcePath: PAGE_PATH,
      dependencyPaths: [APP_PATH, PAGE_PATH],
      evidenceKind: 'route-jsx' as const,
      pathname: '/dashboard',
      pattern: '/dashboard',
      routeMounts: [
        {
          basePath: '/',
          exportName: 'Application',
          hasWildcardFallback: false,
          routeSlotCount: 1,
          sourcePath: APP_PATH,
        },
      ],
      sourcePath: APP_PATH,
    };

    const expanded = expandPreviewInspectorRouteChoiceCandidates([application], [routeLocation]);

    expect(expanded).toHaveLength(1);
    expect(expanded[0]).toMatchObject({
      complete: true,
      dependencyPaths: [APP_PATH, PAGE_PATH],
      edges: application.edges,
      root: application.root,
      rootAutomaticProps: application.rootAutomaticProps,
      rootOwnsRouter: true,
      routeLocation,
      stopReason: 'root-reached',
    });
    expect(expanded.map((candidate) => candidate.root)).not.toContainEqual({
      exportName: 'DashboardPage',
      sourcePath: PAGE_PATH,
    });

    const [virtualPage] = createPreviewInspectorVirtualPageCandidates(expanded);

    expect(virtualPage?.contentCandidate.root).toEqual(application.root);
    expect(virtualPage?.browserCandidate.root).toEqual(application.root);
    expect(virtualPage?.browserCandidate.routeLocation).toBe(routeLocation);
    expect(virtualPage?.browserCandidate.routeLocation?.pathname).toBe('/dashboard');
  });

  /**
   * A route choice attached to shared page chrome describes only the outer corridor. Executing its
   * application owner can stop at an unrelated route gate before the selected panel ever mounts.
   */
  it('keeps the nearest shared-surface checkpoint outside the selected route leaf', () => {
    const selectedPanelPath = '/workspace/features/SelectedPanel.tsx';
    const contentAndPanelPath = '/workspace/layout/ContentAndPanel.tsx';
    const featureRoutePath = '/workspace/routes/FeatureRoute.tsx';
    const renderPath: PreviewRenderChainCandidate = {
      ...RENDER_PATH,
      id: 'shared-panel-through-route',
      steps: [
        {
          certainty: 'confirmed',
          kind: 'component-render',
          label: 'SelectedPanel',
          occurrenceStart: 10,
          sourcePath: selectedPanelPath,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed',
          kind: 'component-render',
          label: 'ContentAndPanel',
          occurrenceStart: 20,
          sourcePath: contentAndPanelPath,
          wrapperNames: [],
        },
        {
          certainty: 'conditional',
          kind: 'route-branch',
          label: 'FeatureRoute',
          occurrenceStart: 30,
          sourcePath: featureRoutePath,
          wrapperNames: [],
        },
        {
          certainty: 'confirmed',
          kind: 'component-render',
          label: 'Application',
          occurrenceStart: 40,
          sourcePath: APP_PATH,
          wrapperNames: [],
        },
      ],
    };
    const routeLocation = {
      componentExportName: 'FeatureRoute',
      componentName: 'FeatureRoute',
      componentSourcePath: featureRoutePath,
      dependencyPaths: [APP_PATH, featureRoutePath],
      evidenceKind: 'route-jsx' as const,
      pathname: '/feature',
      pattern: '/feature',
      routeMounts: [
        {
          basePath: '/',
          exportName: 'Application',
          hasWildcardFallback: false,
          routeSlotCount: 1,
          sourcePath: APP_PATH,
        },
      ],
      sourcePath: APP_PATH,
    };
    const application = createCandidate({
      complete: true,
      id: 'shared-panel-application',
      renderPath,
      root: { exportName: 'Application', sourcePath: APP_PATH },
      rootOwnsRouter: true,
      rootStepIndex: 3,
      routeLocation,
      stopReason: 'root-reached',
      target: { exportName: 'FeatureRoute', sourcePath: featureRoutePath },
    });
    const contentAndPanel = createCandidate({
      id: 'shared-panel-checkpoint',
      renderPath,
      root: { exportName: 'ContentAndPanel', sourcePath: contentAndPanelPath },
      rootStepIndex: 1,
      routeLocation,
      target: { exportName: 'FeatureRoute', sourcePath: featureRoutePath },
    });
    const featureRoute = createCandidate({
      id: 'shared-panel-route-leaf',
      renderPath,
      root: { exportName: 'FeatureRoute', sourcePath: featureRoutePath },
      rootStepIndex: 2,
      routeLocation,
      target: { exportName: 'FeatureRoute', sourcePath: featureRoutePath },
    });

    expect(
      selectPreviewInspectorVirtualPageContentCandidate(
        [application, featureRoute, contentAndPanel],
        featureRoute,
      ),
    ).toBe(contentAndPanel);

    const [virtualPage] = createPreviewInspectorVirtualPageCandidates(
      [application, featureRoute, contentAndPanel],
      1,
    );

    expect(virtualPage?.contentCandidate).toBe(contentAndPanel);
    expect(virtualPage?.browserCandidate.root).toEqual(contentAndPanel.root);
    expect(virtualPage?.browserCandidate.routeLocation).toEqual({
      ...routeLocation,
      elementWrappers: [],
      routeMounts: [],
    });
  });

  /** Keeps the inner route owner when the selected component is proven below its concrete page. */
  it('keeps a route owner for a target reached through the selected page invocation', () => {
    const featureAppPath = '/workspace/routes/FeatureApp.tsx';
    const renderPath: PreviewRenderChainCandidate = {
      ...RENDER_PATH,
      id: 'selected-page-descendant',
      steps: [
        {
          ...readRenderPathStep(0),
          invocation: {
            calleeName: 'TargetPanel',
            mode: 'jsx',
            sourcePath: PAGE_PATH,
          },
        },
        readRenderPathStep(1),
        {
          certainty: 'conditional',
          kind: 'route-branch',
          label: 'FeatureApp',
          occurrenceStart: 25,
          sourcePath: featureAppPath,
          wrapperNames: [],
        },
        readRenderPathStep(2),
      ],
    };
    const routeLocation = {
      componentExportName: 'DashboardPage',
      componentName: 'DashboardPage',
      componentSourcePath: PAGE_PATH,
      dependencyPaths: [featureAppPath, PAGE_PATH],
      evidenceKind: 'route-catalog' as const,
      pathname: '/company/1/feature/dashboard',
      pattern: '/company/:companyId(\\d+)/feature/dashboard',
      routeMounts: [
        {
          basePath: '/company/:companyId(\\d+)/feature',
          contextOrigin: 'virtual-page-owner' as const,
          contextPattern: '/company/:companyId(\\d+)/feature/*',
          exportName: 'FeatureApp',
          hasWildcardFallback: true,
          routeSlotCount: 2,
          sourcePath: featureAppPath,
        },
      ],
      sourcePath: featureAppPath,
    };
    const application = createCandidate({
      complete: true,
      id: 'selected-page-application',
      renderPath,
      root: { exportName: 'Application', sourcePath: APP_PATH },
      rootOwnsRouter: true,
      rootStepIndex: 3,
      routeLocation,
      stopReason: 'root-reached',
    });
    const featureApp = createCandidate({
      id: 'selected-page-feature-app',
      renderPath,
      root: { exportName: 'FeatureApp', sourcePath: featureAppPath },
      rootStepIndex: 2,
      routeLocation,
    });
    const page = createCandidate({
      id: 'selected-page-checkpoint',
      renderPath,
      root: { exportName: 'DashboardPage', sourcePath: PAGE_PATH },
      rootStepIndex: 1,
      routeLocation,
    });

    const [virtualPage] = createPreviewInspectorVirtualPageCandidates([
      application,
      featureApp,
      page,
    ]);

    expect(virtualPage?.contentCandidate).toBe(featureApp);
    expect(virtualPage?.browserCandidate.root).toEqual(featureApp.root);
    const retainedRouteLocation = virtualPage?.browserCandidate.routeLocation;
    expect(
      retainedRouteLocation !== undefined && 'routeMounts' in retainedRouteLocation
        ? retainedRouteLocation.routeMounts
        : undefined,
    ).toEqual(routeLocation.routeMounts);
  });

  it('mounts a direct nested route owner instead of its detached child page', () => {
    const ownerPath = '/workspace/routes/NestedOwner.tsx';
    const routeLeafRenderPath: PreviewRenderChainCandidate = {
      ...RENDER_PATH,
      id: 'nested-route-leaf',
      steps: [
        {
          ...readRenderPathStep(0),
          label: 'ChildPage',
          sourcePath: PAGE_PATH,
        },
        {
          ...readRenderPathStep(1),
          label: 'NestedOwner',
          sourcePath: ownerPath,
        },
      ],
    };
    const child = createCandidate({
      id: 'nested-child',
      renderPath: routeLeafRenderPath,
      root: { exportName: 'default', sourcePath: PAGE_PATH },
      routeLocation: {
        componentExportName: 'default',
        componentName: 'ChildPage',
        componentSourcePath: PAGE_PATH,
        dependencyPaths: [ownerPath, PAGE_PATH],
        evidenceKind: 'route-jsx',
        pathname: '/root/child',
        pattern: '/root/child',
        routeMounts: [
          {
            basePath: '/root',
            exportName: 'default',
            hasWildcardFallback: false,
            routeSlotCount: 1,
            sourcePath: ownerPath,
          },
        ],
        sourcePath: ownerPath,
      },
    });
    const owner = createCandidate({
      id: 'nested-owner',
      renderPath: routeLeafRenderPath,
      root: { exportName: 'default', sourcePath: ownerPath },
      rootOwnsRouter: false,
    });

    const [virtualPage] = createPreviewInspectorVirtualPageCandidates([child, owner]);

    expect(virtualPage?.contentCandidate).toBe(owner);
    expect(virtualPage?.browserCandidate).toMatchObject({
      root: owner.root,
      routeMountBasePath: '/root',
      routeSlotCount: 1,
      wildcardFallbackPresent: false,
    });
  });

  /** Falls back to the authored root when no shared static render path proves a safer body. */
  it('retains an independently discovered authored candidate', () => {
    const standalone = createCandidate({
      root: { exportName: 'Widget', sourcePath: '/workspace/Widget.tsx' },
    });

    const selected = createPreviewInspectorVirtualPageCandidates([standalone], 1)[0];

    expect(selected?.contentCandidate).toBe(standalone);
    expect(selected?.recipe.mode).toBe('authored-root');
  });
});
