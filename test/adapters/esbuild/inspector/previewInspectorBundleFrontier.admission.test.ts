/** Covers admission behavior for previewInspectorBundleFrontier. */
/** Verifies authored-source previewInspectorBundleFrontier invariants. */

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createPreviewCompilerFrontierPolicy } from '../../../../src/domain/previewCompilerFrontier';

import { preparePreviewInspectorBundleFrontier } from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleFrontier';

import type { PreviewInspectorAncestorPlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorAncestorPlan';

import type { PreviewInspectorPageExecutionCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionTypes';

import {
  createRepresentationDominanceCandidate,
  createRepresentationDominancePlan,
} from './previewInspectorBundleFrontierFixtures';

describe('preparePreviewInspectorBundleFrontier', () => {
  it('admits every optional visual identity without a component-count budget', async () => {
    const workspaceRoot = '/workspace';
    const targetPath = '/workspace/Target.tsx';
    const sources = new Map<string, string>([[targetPath, 'export const Target = null;']]);
    const shallowVisualPaths = Array.from({ length: 49 }, (_, index) => {
      const sourcePath = `/workspace/Component${index.toString()}.tsx`;
      sources.set(
        sourcePath,
        `export default function Component${index.toString()}() { return null; }`,
      );
      return {
        exportName: 'default',
        importerPath: targetPath,
        moduleSpecifier: `./Component${index.toString()}`,
        occurrenceStart: index,
        relation: 'sibling',
        renderBoundaryStart: 0,
        sourcePath,
      };
    });
    const plan = {
      edges: [],
      pageCandidates: [
        { dependencyPaths: [], edges: [], root: { exportName: 'Target', sourcePath: targetPath } },
      ],
      root: { exportName: 'Target', sourcePath: targetPath },
      shallowVisualPaths,
      target: { exportName: 'Target', sourcePath: targetPath },
    } as unknown as PreviewInspectorAncestorPlan;
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const result = await preparePreviewInspectorBundleFrontier({
      plan,
      policy,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: () => undefined,
      workspaceRoot,
    });

    expect(result.rejected).toBe(false);
    expect(result.frontier.summary.optionalComponentCount).toBe(49);
    expect(result.frontier.projectedEdges).toEqual([]);
  });

  it('admits a complete optional support closure without a support-module budget', async () => {
    const workspaceRoot = '/workspace';
    const targetPath = '/workspace/Target.tsx';
    const componentPath = '/workspace/Component.tsx';
    const sources = new Map<string, string>([[targetPath, 'export const Target = null;']]);
    const imports = Array.from({ length: 97 }, (_, index) => {
      const helperPath = `/workspace/helper${index.toString()}.ts`;
      sources.set(helperPath, `export const helper${index.toString()} = ${index.toString()};`);
      return `import { helper${index.toString()} } from './helper${index.toString()}';`;
    });
    sources.set(
      componentPath,
      `${imports.join('\n')}\nexport default function Component() { return null; }`,
    );
    const plan = {
      edges: [],
      pageCandidates: [
        { dependencyPaths: [], edges: [], root: { exportName: 'Target', sourcePath: targetPath } },
      ],
      root: { exportName: 'Target', sourcePath: targetPath },
      shallowVisualPaths: [
        {
          exportName: 'default',
          importerPath: targetPath,
          moduleSpecifier: './Component.tsx',
          occurrenceStart: 0,
          relation: 'sibling',
          renderBoundaryStart: 0,
          sourcePath: componentPath,
        },
      ],
      target: { exportName: 'Target', sourcePath: targetPath },
    } as unknown as PreviewInspectorAncestorPlan;
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const result = await preparePreviewInspectorBundleFrontier({
      plan,
      policy,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier, importer) =>
        specifier.startsWith('.')
          ? path.resolve(path.dirname(importer), `${specifier}.ts`)
          : undefined,
      workspaceRoot,
    });

    expect(result.rejected).toBe(false);
    expect(result.frontier.authenticSourcePaths).toHaveLength(99);
    expect(result.frontier.authenticSourcePaths).toContain(componentPath);
    expect(result.frontier.summary.supportModuleCount).toBe(97);
    expect(result.frontier.projectedEdges).toEqual([]);
  });

  it('keeps a statically imported rendered child inside its optional admission transaction', async () => {
    const workspaceRoot = '/workspace';
    const targetPath = '/workspace/Target.tsx';
    const componentPath = '/workspace/Component.tsx';
    const sources = new Map<string, string>([
      [
        targetPath,
        "import Component from './Component.tsx'; export const Target = () => <Component />;",
      ],
    ]);
    const imports = Array.from({ length: 97 }, (_, index) => {
      const helperPath = `/workspace/helper${index.toString()}.ts`;
      sources.set(helperPath, `export const helper${index.toString()} = ${index.toString()};`);
      return `import { helper${index.toString()} } from './helper${index.toString()}';`;
    });
    sources.set(
      componentPath,
      `${imports.join('\n')}\nexport default function Component() { return null; }`,
    );
    const plan = {
      edges: [],
      pageCandidates: [
        { dependencyPaths: [], edges: [], root: { exportName: 'Target', sourcePath: targetPath } },
      ],
      root: { exportName: 'Target', sourcePath: targetPath },
      shallowVisualPaths: [
        {
          exportName: 'default',
          importerPath: targetPath,
          moduleSpecifier: './Component.tsx',
          occurrenceStart: 0,
          relation: 'sibling',
          renderBoundaryStart: 0,
          sourcePath: componentPath,
        },
      ],
      target: { exportName: 'Target', sourcePath: targetPath },
    } as unknown as PreviewInspectorAncestorPlan;
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const result = await preparePreviewInspectorBundleFrontier({
      plan,
      policy,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier, importer) => {
        const extension = specifier.endsWith('.tsx') ? '' : '.ts';
        return path.resolve(path.dirname(importer), `${specifier}${extension}`);
      },
      workspaceRoot,
    });

    expect(result.rejected).toBe(false);
    expect(result.frontier.authenticSourcePaths).toHaveLength(99);
    expect(result.frontier.summary.supportModuleCount).toBe(97);
    expect(result.frontier.projectedEdges).toEqual([]);
  });

  it('admits a deep corridor component chain without a component-depth budget', async () => {
    const workspaceRoot = '/workspace';
    const targetPath = '/workspace/Target.tsx';
    const sources = new Map<string, string>([[targetPath, 'export const Target = null;']]);
    const componentPaths = Array.from(
      { length: 33 },
      (_, index) => `/workspace/C${index.toString()}.tsx`,
    );
    for (const [index, sourcePath] of componentPaths.entries()) {
      const childSpecifier =
        index === componentPaths.length - 1
          ? ''
          : `void import('./C${(index + 1).toString()}.tsx');`;
      sources.set(
        sourcePath,
        `${childSpecifier} export default function C${index.toString()}() { return null; }`,
      );
    }
    const plan = {
      edges: [],
      pageCandidates: [
        { dependencyPaths: [], edges: [], root: { exportName: 'Target', sourcePath: targetPath } },
      ],
      root: { exportName: 'Target', sourcePath: targetPath },
      shallowVisualPaths: [
        {
          exportName: 'default',
          importerPath: targetPath,
          moduleSpecifier: './C0.tsx',
          occurrenceStart: 0,
          relation: 'sibling',
          renderBoundaryStart: 0,
          sourcePath: componentPaths[0],
        },
      ],
      target: { exportName: 'Target', sourcePath: targetPath },
    } as unknown as PreviewInspectorAncestorPlan;
    const policy = createPreviewCompilerFrontierPolicy('corridor');
    if (policy === undefined) throw new Error('Expected the automatic corridor frontier policy.');
    const result = await preparePreviewInspectorBundleFrontier({
      plan,
      policy,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier, importer) => {
        const resolved = path.resolve(path.dirname(importer), specifier);
        return sources.has(resolved) ? resolved : undefined;
      },
      workspaceRoot,
    });

    expect(result.rejected).toBe(false);
    expect(result.frontier.summary.maximumDepth).toBe(33);
    expect(result.frontier.authenticSourcePaths).toContain(componentPaths[31]);
    expect(result.frontier.authenticSourcePaths).toContain(componentPaths[32]);
    expect(result.frontier.projectedEdges).toEqual([]);
  });

  it('admits every corridor optional identity without an identity-count budget', async () => {
    const workspaceRoot = '/workspace';
    const targetPath = '/workspace/Target.tsx';
    const sources = new Map<string, string>([[targetPath, 'export const Target = null;']]);
    const shallowVisualPaths = Array.from({ length: 97 }, (_, index) => {
      const sourcePath = `/workspace/Component${index.toString()}.tsx`;
      sources.set(
        sourcePath,
        `export default function Component${index.toString()}() { return null; }`,
      );
      return {
        exportName: 'default',
        importerPath: targetPath,
        moduleSpecifier: `./Component${index.toString()}`,
        occurrenceStart: index,
        relation: 'sibling',
        renderBoundaryStart: 0,
        sourcePath,
      };
    });
    const plan = {
      edges: [],
      pageCandidates: [
        { dependencyPaths: [], edges: [], root: { exportName: 'Target', sourcePath: targetPath } },
      ],
      root: { exportName: 'Target', sourcePath: targetPath },
      shallowVisualPaths,
      target: { exportName: 'Target', sourcePath: targetPath },
    } as unknown as PreviewInspectorAncestorPlan;
    const policy = createPreviewCompilerFrontierPolicy('corridor');
    if (policy === undefined) throw new Error('Expected the automatic corridor frontier policy.');
    const result = await preparePreviewInspectorBundleFrontier({
      plan,
      policy,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: () => undefined,
      workspaceRoot,
    });

    expect(result.rejected).toBe(false);
    expect(result.frontier.summary.optionalComponentCount).toBe(97);
    expect(result.frontier.projectedEdges).toEqual([]);
  });

  it('admits a Page Execution optional surface transaction without reopening broad plan evidence', async () => {
    const workspaceRoot = '/workspace';
    const targetPath = '/workspace/Target.tsx';
    const optionalPath = '/workspace/Optional.tsx';
    const helperPath = '/workspace/optional-helper.ts';
    const dataPath = '/workspace/optional-data.ts';
    const sources = new Map<string, string>([
      [targetPath, 'export const Target = () => null;'],
      [
        optionalPath,
        "import { helper } from './optional-helper'; export default function Optional() { return helper; }",
      ],
      [
        helperPath,
        "export const helper = null; export const loadData = () => import('./optional-data');",
      ],
      [dataPath, "export const Index = 'OPTIONAL_DYNAMIC_DATA';"],
    ]);
    const plan = {
      edges: [],
      pageCandidates: [],
      root: { exportName: 'Target', sourcePath: targetPath },
      target: { exportName: 'Target', sourcePath: targetPath },
    } as unknown as PreviewInspectorAncestorPlan;
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');

    const result = await preparePreviewInspectorBundleFrontier({
      executionCandidate: {
        browserCandidate: { id: 'selected' },
        compositionEdges: [],
        criticalSurfaces: [
          {
            bypassedWrapperNames: [],
            exportName: 'Target',
            id: 'target',
            omittedTopLevelEffectCount: 0,
            sourcePath: targetPath,
            strategy: 'authentic-module-export',
            watchSourcePaths: [targetPath],
          },
        ],
        evidenceSourcePaths: [],
        fidelity: 'target-contextual',
        id: 'candidate',
        optionalSurfaces: [
          {
            bypassedWrapperNames: [],
            exportName: 'default',
            id: 'optional',
            omittedTopLevelEffectCount: 0,
            sourcePath: optionalPath,
            strategy: 'selected-route-surface',
            watchSourcePaths: [optionalPath],
          },
        ],
        watchSourcePaths: [targetPath, optionalPath],
      } as never,
      plan,
      policy,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier, importer) =>
        specifier === './optional-helper' && importer === optionalPath
          ? helperPath
          : specifier === './optional-data' && importer === helperPath
            ? dataPath
            : undefined,
      workspaceRoot,
    });

    expect(result.rejected).toBe(false);
    expect(result.frontier.version).toBe(2);
    expect(result.frontier.sourceKinds?.[optionalPath]).toBe('optional-surface');
    expect(result.frontier.sourceKinds?.[helperPath]).toBe('optional-support');
    expect(result.frontier.authenticSourcePaths).toContain(dataPath);
    expect(result.frontier.summary.optionalComponentCount).toBe(1);
    expect(result.frontier.summary.supportModuleCount).toBe(2);
  });

  it.each(['DirectorsMeetingAgendaNewIssueEditPage', 'ShareholdersMeetingAgendaNewIssueEditPage'])(
    'admits only the selected named lazy leaf of an authentic runtime-target barrel for %s',
    async (selectedExportName) => {
      const workspaceRoot = '/workspace';
      const barrelPath = '/workspace/agenda-edit/index.ts';
      const selectedLeafPath = '/workspace/agenda-edit/agenda-new-issue-edit-page.tsx';
      const siblingLeafPath = '/workspace/agenda-edit/agenda-option-grant-edit-page.tsx';
      const sources = new Map<string, string>([
        [
          barrelPath,
          [
            "import { lazy } from 'react';",
            "export const AgendaOptionGrantEditPage = lazy(() => import('./agenda-option-grant-edit-page'));",
            'export const DirectorsMeetingAgendaNewIssueEditPage = lazy(() =>',
            "  import('./agenda-new-issue-edit-page').then(({ DirectorsMeetingAgendaNewIssueEditPage }) => ({",
            '    default: DirectorsMeetingAgendaNewIssueEditPage,',
            '  })),',
            ');',
            'export const ShareholdersMeetingAgendaNewIssueEditPage = lazy(() =>',
            "  import('./agenda-new-issue-edit-page').then(({ ShareholdersMeetingAgendaNewIssueEditPage }) => ({",
            '    default: ShareholdersMeetingAgendaNewIssueEditPage,',
            '  })),',
            ');',
          ].join('\n'),
        ],
        [
          selectedLeafPath,
          [
            'export const DirectorsMeetingAgendaNewIssueEditPage = () => null;',
            'export const ShareholdersMeetingAgendaNewIssueEditPage = () => null;',
          ].join('\n'),
        ],
        [siblingLeafPath, 'export default function AgendaOptionGrantEditPage() { return null; }'],
      ]);
      const plan = {
        edges: [],
        pageCandidates: [],
        root: { exportName: selectedExportName, sourcePath: barrelPath },
        target: { exportName: selectedExportName, sourcePath: barrelPath },
      } as unknown as PreviewInspectorAncestorPlan;
      const policy = createPreviewCompilerFrontierPolicy('fast');
      if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');

      const result = await preparePreviewInspectorBundleFrontier({
        executionCandidate: {
          browserCandidate: { id: 'selected' },
          compositionEdges: [],
          criticalSurfaces: [
            {
              bypassedWrapperNames: [],
              exportName: selectedExportName,
              id: 'target',
              omittedTopLevelEffectCount: 0,
              sourcePath: barrelPath,
              strategy: 'authentic-module-export',
              watchSourcePaths: [barrelPath],
            },
          ],
          evidenceSourcePaths: [],
          fidelity: 'route-page-authentic',
          id: 'candidate',
          optionalSurfaces: [],
          runtimeTargetSurfaceId: 'target',
          watchSourcePaths: [barrelPath, selectedLeafPath],
        } as never,
        plan,
        policy,
        readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
        resolveModule: (specifier, importer) => {
          if (importer !== barrelPath) return undefined;
          if (specifier === './agenda-new-issue-edit-page') return selectedLeafPath;
          if (specifier === './agenda-option-grant-edit-page') return siblingLeafPath;
          return undefined;
        },
        workspaceRoot,
      });

      expect(result.rejected).toBe(false);
      expect(result.frontier.authenticSourcePaths).toContain(selectedLeafPath);
      expect(result.frontier.authenticSourcePaths).not.toContain(siblingLeafPath);
      expect(result.frontier.authenticComponentExports).toContainEqual({
        exportNames: ['default'],
        runtimeHookExportNames: [],
        sourcePath: selectedLeafPath,
      });
    },
  );

  it('recovers an omitted-index lazy corridor only from exact checkpoint or selected-route evidence', async () => {
    const workspaceRoot = '/workspace';
    const targetPath = '/workspace/pages/Target.tsx';
    const flowPath = '/workspace/pages/DashboardFlow.tsx';
    const pagePath = '/workspace/pages/DashboardPage.tsx';
    const siblingPath = '/workspace/pages/SiblingPage.tsx';
    const barrelPath = '/workspace/pages/index.ts';
    const appPath = '/workspace/App.tsx';
    const sources = new Map<string, string>([
      [targetPath, 'export const Target = () => <section>TARGET</section>;'],
      [
        flowPath,
        "import { Target } from './Target'; export const DashboardFlow = () => <Target />;",
      ],
      [
        pagePath,
        "import { DashboardFlow } from './DashboardFlow'; const DashboardPage = () => <DashboardFlow />; export default withPermission(DashboardPage);",
      ],
      [siblingPath, 'export default function SiblingPage() { return null; }'],
      [
        barrelPath,
        [
          "import { lazy } from 'react';",
          "export const DashboardPage = lazy(() => import('./DashboardPage'));",
          "export const SiblingPage = lazy(() => import('./SiblingPage'));",
        ].join('\n'),
      ],
      [
        appPath,
        "import { DashboardPage, SiblingPage } from './pages'; export const App = () => <DashboardPage />; void SiblingPage;",
      ],
    ]);
    const scenarios = [
      {
        candidateRoot: { exportName: 'App', sourcePath: appPath },
        id: 'indexed-root',
        retainsCorridor: true,
        rootStepIndex: 2,
        stopReason: 'root-reached',
      },
      {
        candidateRoot: { exportName: 'App', sourcePath: appPath },
        id: 'matching-checkpoint-root',
        retainsCorridor: true,
        stopReason: 'render-path-checkpoint',
      },
      {
        candidateRoot: { exportName: 'App', sourcePath: appPath },
        id: 'unproven-missing-root',
        retainsCorridor: false,
        stopReason: 'root-reached',
      },
      {
        candidateRoot: { exportName: 'default', sourcePath: pagePath },
        candidateTarget: { exportName: 'DashboardPage', sourcePath: barrelPath },
        id: 'selected-route-root',
        retainsCorridor: true,
        routeLocation: {
          componentExportName: 'DashboardPage',
          componentName: 'DashboardPage',
          componentSourcePath: barrelPath,
          dependencyPaths: [barrelPath, appPath],
          evidenceKind: 'route-catalog',
          pathname: '/dashboard',
          pattern: '/dashboard',
          sourcePath: appPath,
        },
        stopReason: 'root-reached',
      },
      {
        candidateRoot: { exportName: 'default', sourcePath: pagePath },
        executionRootPinned: true,
        id: 'execution-pinned-checkpoint-root',
        retainsCorridor: true,
        routeLocation: {
          componentExportName: 'DashboardPage',
          componentName: 'DashboardPage',
          componentSourcePath: barrelPath,
          dependencyPaths: [barrelPath, appPath],
          evidenceKind: 'route-catalog',
          pathname: '/dashboard',
          pattern: '/dashboard',
          sourcePath: appPath,
        },
        stopReason: 'root-reached',
      },
      {
        candidateRoot: { exportName: 'default', sourcePath: pagePath },
        candidateTarget: { exportName: 'DashboardPage', sourcePath: barrelPath },
        evidenceSourcePaths: [targetPath, pagePath, appPath],
        id: 'unproven-selected-route-root',
        retainsCorridor: false,
        routeLocation: {
          componentExportName: 'DashboardPage',
          componentName: 'DashboardPage',
          componentSourcePath: barrelPath,
          dependencyPaths: [barrelPath, appPath],
          evidenceKind: 'route-catalog',
          pathname: '/dashboard',
          pattern: '/dashboard',
          sourcePath: appPath,
        },
        stopReason: 'root-reached',
      },
      {
        candidateRoot: { exportName: 'default', sourcePath: pagePath },
        id: 'mismatched-checkpoint-root',
        retainsCorridor: false,
        stopReason: 'render-path-checkpoint',
      },
    ] as const;
    for (const scenario of scenarios) {
      const candidateId = `selected-dashboard-${scenario.id}`;
      const plan = {
        edges: [],
        pageCandidates: [
          {
            dependencyPaths: [...sources.keys()],
            edges: [],
            id: candidateId,
            renderPath: {
              id: 'selected-dashboard-path',
              steps: [
                { label: 'Target', sourcePath: targetPath },
                { label: 'DashboardFlow', sourcePath: flowPath },
                { label: 'DashboardPage', sourcePath: pagePath },
                { label: '@default', sourcePath: pagePath },
                { label: 'DashboardPage', sourcePath: barrelPath },
                { label: 'App', sourcePath: appPath },
              ],
            },
            root: scenario.candidateRoot,
            ...('rootStepIndex' in scenario ? { rootStepIndex: scenario.rootStepIndex } : {}),
            ...('routeLocation' in scenario ? { routeLocation: scenario.routeLocation } : {}),
            stopReason: scenario.stopReason,
            target:
              'candidateTarget' in scenario
                ? scenario.candidateTarget
                : { exportName: 'Target', sourcePath: targetPath },
          },
        ],
        root: { exportName: 'App', sourcePath: appPath },
        target: { exportName: 'Target', sourcePath: targetPath },
      } as unknown as PreviewInspectorAncestorPlan;
      const executionCandidate = {
        browserCandidate:
          'executionRootPinned' in scenario
            ? {
                ...plan.pageCandidates[0],
                root: { exportName: 'App', sourcePath: appPath },
                rootStepIndex: undefined,
                stopReason: 'render-path-checkpoint',
              }
            : { id: candidateId },
        compositionEdges: [],
        criticalSurfaces: [
          {
            bypassedWrapperNames: [],
            exportName: 'App',
            id: 'app',
            omittedTopLevelEffectCount: 0,
            sourcePath: appPath,
            strategy: 'selected-route-surface',
            watchSourcePaths: [appPath],
          },
          {
            bypassedWrapperNames: ['withPermission'],
            exportName: 'default',
            id: 'page',
            localName: 'DashboardPage',
            omittedTopLevelEffectCount: 0,
            sourcePath: pagePath,
            strategy: 'inner-local-component-slice',
            watchSourcePaths: [pagePath],
          },
          {
            bypassedWrapperNames: [],
            exportName: 'Target',
            id: 'target',
            omittedTopLevelEffectCount: 0,
            sourcePath: targetPath,
            strategy: 'authentic-module-export',
            watchSourcePaths: [targetPath],
          },
        ],
        evidenceSourcePaths:
          'evidenceSourcePaths' in scenario
            ? scenario.evidenceSourcePaths
            : [targetPath, flowPath, pagePath, barrelPath, appPath],
        executionRootSurfaceId: 'app',
        fidelity: 'target-contextual',
        id: 'candidate',
        optionalSurfaces: [],
        runtimeTargetSurfaceId: 'target',
        watchSourcePaths: [...sources.keys()],
      } as unknown as PreviewInspectorPageExecutionCandidate;
      const policy = createPreviewCompilerFrontierPolicy('fast');
      if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');

      const result = await preparePreviewInspectorBundleFrontier({
        executionCandidate,
        plan,
        policy,
        readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
        resolveModule: (specifier, importer) => {
          if (!specifier.startsWith('.')) return undefined;
          const unresolved = path.resolve(path.dirname(importer), specifier);
          return [...sources.keys()].find(
            (sourcePath) =>
              sourcePath === unresolved ||
              sourcePath === `${unresolved}.ts` ||
              sourcePath === `${unresolved}.tsx` ||
              sourcePath === path.join(unresolved, 'index.ts'),
          );
        },
        workspaceRoot,
      });

      expect(result.rejected).toBe(false);
      if (scenario.retainsCorridor) {
        expect(result.frontier.exactSourcePaths).toEqual(
          expect.arrayContaining([targetPath, flowPath, pagePath, barrelPath, appPath]),
        );
        expect(result.frontier.authenticSourcePaths).not.toContain(siblingPath);
        expect(result.frontier.projectedEdges).not.toContainEqual(
          expect.objectContaining({ importerPath: appPath, targetPath: barrelPath }),
        );
      } else {
        expect(result.frontier.exactSourcePaths).not.toContain(flowPath);
        expect(result.frontier.exactSourcePaths).not.toContain(barrelPath);
      }
    }
  });

  it('uses full authored inventory when a sliced Page Execution source also has an authentic surface', async () => {
    const workspaceRoot = '/workspace';
    const appPath = '/workspace/legal/app/app.tsx';
    const appBasePath = '/workspace/common/ui/app/app-base.tsx';
    const sources = new Map<string, string>([
      [
        appPath,
        [
          "import { AppBase } from 'common/ui/app/app-base';",
          'export const SlicedPage = () => null;',
          'export const AuthenticTarget = () => <AppBase />;',
        ].join('\n'),
      ],
      [appBasePath, 'export const AppBase = () => null;'],
    ]);
    const plan = createRepresentationDominancePlan(appPath);
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');

    const result = await preparePreviewInspectorBundleFrontier({
      executionCandidate: createRepresentationDominanceCandidate(appPath, true),
      plan,
      policy,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier, importer) =>
        specifier === 'common/ui/app/app-base' && importer === appPath ? appBasePath : undefined,
      workspaceRoot,
    });

    expect(result.rejected).toBe(false);
    expect(result.frontier.version).toBe(2);
    expect(result.frontier.authenticSourcePaths).toEqual([appBasePath, appPath].sort());
    expect(result.frontier.sourceKinds?.[appBasePath]).toBe('critical-support');
    expect(result.frontier.summary.authoredEdgeCount).toBe(1);
    expect(result.frontier.summary.supportModuleCount).toBe(1);
    expect(result.frontier.summary.truncationReasons).toEqual([]);
  });

  it('keeps omitted authored imports outside a slice-only Page Execution frontier', async () => {
    const workspaceRoot = '/workspace';
    const appPath = '/workspace/legal/app/app.tsx';
    const appBasePath = '/workspace/common/ui/app/app-base.tsx';
    const sources = new Map<string, string>([
      [
        appPath,
        [
          "import { AppBase } from 'common/ui/app/app-base';",
          'export const SlicedPage = () => null;',
          'export const AuthenticTarget = () => <AppBase />;',
        ].join('\n'),
      ],
      [appBasePath, 'export const AppBase = () => null;'],
    ]);
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');

    const result = await preparePreviewInspectorBundleFrontier({
      executionCandidate: createRepresentationDominanceCandidate(appPath, false),
      plan: createRepresentationDominancePlan(appPath),
      policy,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier, importer) =>
        specifier === 'common/ui/app/app-base' && importer === appPath ? appBasePath : undefined,
      workspaceRoot,
    });

    expect(result.rejected).toBe(false);
    expect(result.frontier.authenticSourcePaths).toEqual([appPath]);
    expect(result.frontier.authenticSourcePaths).not.toContain(appBasePath);
    expect(result.frontier.summary.authoredEdgeCount).toBe(0);
    expect(result.frontier.summary.supportModuleCount).toBe(0);
  });

  it.each([
    ['a runtime companion', (appPath: string) => ({ runtimeCompanionSourcePaths: [appPath] })],
    [
      'an optional authored surface',
      (appPath: string) => ({
        executionCandidate: createRepresentationDominanceCandidate(appPath, false, true),
      }),
    ],
  ])('uses full authored inventory when a sliced source also has %s', async (_, options) => {
    const workspaceRoot = '/workspace';
    const appPath = '/workspace/legal/app/app.tsx';
    const appBasePath = '/workspace/common/ui/app/app-base.tsx';
    const sources = new Map<string, string>([
      [
        appPath,
        [
          "import { AppBase } from 'common/ui/app/app-base';",
          'export const SlicedPage = () => null;',
          'export const AuthenticTarget = () => <AppBase />;',
        ].join('\n'),
      ],
      [appBasePath, 'export const AppBase = () => null;'],
    ]);
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const overlap = options(appPath);
    const executionCandidate =
      'executionCandidate' in overlap
        ? overlap.executionCandidate
        : createRepresentationDominanceCandidate(appPath, false);
    const runtimeCompanionSourcePaths =
      'runtimeCompanionSourcePaths' in overlap ? overlap.runtimeCompanionSourcePaths : undefined;

    const result = await preparePreviewInspectorBundleFrontier({
      executionCandidate,
      plan: createRepresentationDominancePlan(appPath),
      policy,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier, importer) =>
        specifier === 'common/ui/app/app-base' && importer === appPath ? appBasePath : undefined,
      ...(runtimeCompanionSourcePaths === undefined ? {} : { runtimeCompanionSourcePaths }),
      workspaceRoot,
    });

    expect(result.rejected).toBe(false);
    expect(result.frontier.authenticSourcePaths).toContain(appBasePath);
    expect(result.frontier.summary.truncationReasons).toEqual([]);
  });

  it('rejects an unavailable slice even when the source also has an authentic surface', async () => {
    const workspaceRoot = '/workspace';
    const appPath = '/workspace/legal/app/app.tsx';
    const sources = new Map<string, string>([
      [appPath, 'export const AuthenticTarget = () => null;'],
    ]);
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');

    const result = await preparePreviewInspectorBundleFrontier({
      executionCandidate: createRepresentationDominanceCandidate(appPath, true),
      plan: createRepresentationDominancePlan(appPath),
      policy,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: () => undefined,
      workspaceRoot,
    });

    expect(result.rejected).toBe(true);
    expect(result.frontier.summary.truncationReasons).toEqual(['slice-unavailable']);
  });
});
