/** Covers contracts behavior for previewInspectorBundleFrontier. */
/** Verifies authored-source previewInspectorBundleFrontier invariants. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';

import os from 'node:os';

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createPreviewCompilerFrontierPolicy,
  type PreviewCompilerFrontierReason,
} from '../../../../src/domain/previewCompilerFrontier';

import { preparePreviewInspectorBundleFrontier } from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleFrontier';

import {
  createPreviewInspectorBundleFrontierIdentity,
  PREVIEW_INSPECTOR_BUNDLE_FRONTIER_FORMAT_VERSION,
  PREVIEW_INSPECTOR_PAGE_EXECUTION_FRONTIER_FORMAT_VERSION,
  sortPreviewInspectorBundleFrontierReasons,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleFrontierFinalization';

import type { PreviewInspectorAncestorPlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorAncestorPlan';

import type { PreviewInspectorPageExecutionCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionTypes';

describe('preparePreviewInspectorBundleFrontier', () => {
  it('preserves exported versions, reason order, and canonical identity encoding', () => {
    expect(PREVIEW_INSPECTOR_BUNDLE_FRONTIER_FORMAT_VERSION).toBe(1);
    expect(PREVIEW_INSPECTOR_PAGE_EXECUTION_FRONTIER_FORMAT_VERSION).toBe(2);
    expect(
      sortPreviewInspectorBundleFrontierReasons(
        new Set<PreviewCompilerFrontierReason>([
          'frontier-mismatch',
          'slice-unavailable',
          'source-parse-failure',
          'exact-source-unreadable',
        ]),
      ),
    ).toEqual([
      'exact-source-unreadable',
      'source-parse-failure',
      'slice-unavailable',
      'frontier-mismatch',
    ]);
    expect(
      sortPreviewInspectorBundleFrontierReasons(
        new Set<PreviewCompilerFrontierReason>(['frontier-mismatch', 'exact-source-unreadable']),
      ),
    ).toEqual(['exact-source-unreadable', 'frontier-mismatch']);

    const policy = { graphAdmission: 'unbounded', mode: 'fast' } as never;
    const authenticSourcePaths = ['/workspace/Entry.tsx', '/workspace/Support.ts'] as const;
    const exactSourcePaths = ['/workspace/Entry.tsx'] as const;
    const packageDemandSourcePaths = ['/workspace/Entry.tsx'] as const;
    const components = [
      {
        exportNames: ['Widget'],
        runtimeHookExportNames: ['useWidget'],
        sourcePath: '/workspace/Support.ts',
      },
    ] as const;
    const projectedEdges = [
      {
        exportNames: ['default'],
        importerPath: '/workspace/Entry.tsx',
        moduleSpecifier: './Optional',
        occurrenceStart: 12,
        reason: 'source-parse-failure',
        runtimeHookExportNames: [],
        targetPath: '/workspace/Optional.tsx',
      },
    ] as const;
    const summary = {
      authoredEdgeCount: 1,
      exactModuleCount: 1,
      maximumDepth: 1,
      optionalComponentCount: 1,
      packageDemandSourceCount: 1,
      projectedEdgeCount: 1,
      sourceBytes: 321,
      supportModuleCount: 0,
      totalAuthoredModuleCount: 2,
      truncationReasons: ['source-parse-failure'],
    } as const;
    const executionCandidate = {
      compositionEdges: [{ childSurfaceId: 'child', ownerSurfaceId: 'owner' }],
      criticalSurfaces: [{ id: 'critical' }],
      fidelity: 'page-sliced',
      id: 'candidate',
      optionalSurfaces: [{ id: 'optional' }],
      routeRecipe: { kind: 'synthetic' },
    } as unknown as PreviewInspectorPageExecutionCandidate;

    expect(
      createPreviewInspectorBundleFrontierIdentity(
        policy,
        undefined,
        authenticSourcePaths,
        exactSourcePaths,
        packageDemandSourcePaths,
        components,
        projectedEdges,
        summary,
      ),
    ).toBe('778d07a0b4f4d9be118f8b374e2ba70ad501c98aab01bef4e231d09122b6cbdb');
    expect(
      createPreviewInspectorBundleFrontierIdentity(
        policy,
        executionCandidate,
        authenticSourcePaths,
        exactSourcePaths,
        packageDemandSourcePaths,
        components,
        projectedEdges,
        summary,
      ),
    ).toBe('94127395627924b02cf891aed4b2d43d294759acba0ae75da0f91dc70266ffd8');
  });

  it('keeps selected route/page/target sources in the compatibility frontier', async () => {
    const workspaceRoot = '/workspace';
    const targetPath = '/workspace/Target.tsx';
    const pagePath = '/workspace/SelectedPage.tsx';
    const routePath = '/workspace/SelectedRoute.tsx';
    const appPath = '/workspace/App.tsx';
    const entryPath = '/workspace/main.tsx';
    const sources = new Map<string, string>([
      [targetPath, 'export const Target = () => null;'],
      [
        pagePath,
        "import { Target } from './Target'; export const SelectedPage = () => <Target />;",
      ],
      [
        routePath,
        "import { SelectedPage } from './SelectedPage'; export const SelectedRoute = () => <SelectedPage />;",
      ],
      [appPath, "import './large-route-registry'; export const App = () => null;"],
      [entryPath, "import { App } from './App'; void App;"],
    ]);
    const plan = {
      edges: [],
      pageCandidates: [
        {
          dependencyPaths: [targetPath, pagePath, routePath, appPath, entryPath],
          edges: [],
          renderPath: {
            entryPoint: {
              kind: 'create-root',
              occurrenceStart: 4,
              sourcePath: entryPath,
              wrapperNames: [],
            },
            id: 'selected',
            steps: [
              {
                certainty: 'confirmed',
                kind: 'component-render',
                label: 'Target',
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
                certainty: 'confirmed',
                kind: 'route-branch',
                label: 'SelectedRoute',
                occurrenceStart: 3,
                sourcePath: routePath,
                wrapperNames: [],
              },
              {
                certainty: 'confirmed',
                kind: 'component-render',
                label: 'App',
                occurrenceStart: 4,
                sourcePath: appPath,
                wrapperNames: [],
              },
            ],
          },
          root: { exportName: 'SelectedPage', sourcePath: pagePath },
          rootAutomaticProps: {},
          rootOwnsRouter: true,
          routeLocation: {
            componentName: 'SelectedPage',
            dependencyPaths: [routePath],
            evidenceKind: 'route-jsx',
            pathname: '/selected',
            pattern: '/selected',
            routeMounts: [
              {
                basePath: '/',
                exportName: 'SelectedRoute',
                hasWildcardFallback: false,
                routeSlotCount: 1,
                sourcePath: routePath,
              },
            ],
            sourcePath: routePath,
          },
          stopReason: 'root-reached',
          targetAutomaticProps: {},
        },
      ],
      root: { exportName: 'SelectedPage', sourcePath: pagePath },
      target: { exportName: 'Target', sourcePath: targetPath },
    } as unknown as PreviewInspectorAncestorPlan;
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');

    const result = await preparePreviewInspectorBundleFrontier({
      plan,
      policy,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier, importer) => {
        const resolved = path.resolve(path.dirname(importer), `${specifier}.tsx`);
        return sources.has(resolved) ? resolved : undefined;
      },
      workspaceRoot,
    });

    expect(result.rejected).toBe(false);
    expect(result.frontier.authenticSourcePaths).toEqual(
      expect.arrayContaining([pagePath, routePath, targetPath]),
    );
  });

  it('keeps a static authored closure and excludes dormant dynamic branches before esbuild', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-frontier-'));
    const sourceDirectory = path.join(workspaceRoot, 'src');
    const targetPath = path.join(sourceDirectory, 'Target.tsx');
    const helperPath = path.join(sourceDirectory, 'helper.ts');
    const dormantPath = path.join(sourceDirectory, 'Dormant.tsx');
    await mkdir(sourceDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        targetPath,
        "import { helper } from './helper'; import 'package-a'; export const Target = helper; void import('./Dormant');",
      ),
      writeFile(helperPath, 'export const helper = 1;'),
      writeFile(dormantPath, "export const dormant = 'not in the frontier';"),
    ]);
    const plan = {
      edges: [],
      pageCandidates: [
        { dependencyPaths: [], edges: [], root: { exportName: 'Target', sourcePath: targetPath } },
      ],
      root: { exportName: 'Target', sourcePath: targetPath },
      target: { exportName: 'Target', sourcePath: targetPath },
    } as unknown as PreviewInspectorAncestorPlan;
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const result = await preparePreviewInspectorBundleFrontier({
      plan,
      policy,
      readSource: (sourcePath) => readFile(sourcePath, 'utf8').catch(() => undefined),
      resolveModule: (specifier, importer) =>
        specifier.startsWith('.')
          ? path.resolve(path.dirname(importer), `${specifier}.ts`)
          : undefined,
      workspaceRoot,
    });

    expect(result.rejected).toBe(false);
    expect(result.frontier.authenticSourcePaths).toEqual([helperPath, targetPath].sort());
    expect(result.frontier.exactSourcePaths).toEqual([targetPath]);
    expect(result.frontier.authenticSourcePaths).not.toContain(dormantPath);
    expect(result.frontier.packageDemandSourcePaths).toEqual([targetPath]);
    expect(Object.isFrozen(result.frontier)).toBe(true);
  });

  it('admits authored modules generated by a bounded eager Vite glob before esbuild', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-frontier-glob-'));
    const projectRoot = path.join(workspaceRoot, 'client');
    const sourceDirectory = path.join(projectRoot, 'src');
    const iconDirectory = path.join(sourceDirectory, 'icons');
    const targetPath = path.join(sourceDirectory, 'Target.tsx');
    const firstIconPath = path.join(iconDirectory, 'first-icon.tsx');
    const secondIconPath = path.join(iconDirectory, 'second-icon.tsx');
    const sharedPath = path.join(sourceDirectory, 'shared.ts');
    await mkdir(iconDirectory, { recursive: true });
    const sources = new Map<string, string>([
      [
        targetPath,
        "const icons = import.meta.glob('/src/icons/*-icon.tsx', { eager: true }); export const Target = () => Object.keys(icons).length;",
      ],
      [firstIconPath, "import { shared } from '../shared'; export const FirstIcon = shared;"],
      [secondIconPath, 'export const SecondIcon = 2;'],
      [sharedPath, 'export const shared = 1;'],
    ]);
    await Promise.all(
      [...sources].map(([sourcePath, sourceText]) => writeFile(sourcePath, sourceText)),
    );
    const plan = {
      edges: [],
      pageCandidates: [],
      root: { exportName: 'Target', sourcePath: targetPath },
      target: { exportName: 'Target', sourcePath: targetPath },
    } as unknown as PreviewInspectorAncestorPlan;
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');

    const result = await preparePreviewInspectorBundleFrontier({
      plan,
      policy,
      projectRoot,
      readSource: (sourcePath) => Promise.resolve(sources.get(path.normalize(sourcePath))),
      resolveModule: (specifier, importer) => {
        const direct = path.resolve(path.dirname(importer), specifier);
        return [direct, `${direct}.ts`, `${direct}.tsx`].find((candidate) =>
          sources.has(path.normalize(candidate)),
        );
      },
      workspaceRoot,
    });

    expect(result.rejected).toBe(false);
    expect(result.frontier.authenticSourcePaths).toEqual(
      expect.arrayContaining([targetPath, firstIconPath, secondIconPath, sharedPath]),
    );
    expect(result.frontier.summary.authoredEdgeCount).toBe(3);
  });

  it('admits rendered page-shell descendants from a selected-export execution-root slice', async () => {
    const workspaceRoot = '/workspace';
    const rootPath = '/workspace/RootLayout.tsx';
    const headerPath = '/workspace/Header.tsx';
    const sidebarPath = '/workspace/Sidebar.tsx';
    const pagePath = '/workspace/SelectedPage.tsx';
    const deepChildPath = '/workspace/DeepChild.tsx';
    const targetPath = '/workspace/Target.tsx';
    const unusedPath = '/workspace/Unused.tsx';
    const inactivePath = '/workspace/InactiveRoute.tsx';
    const sources = new Map<string, string>([
      [
        rootPath,
        [
          "import { Header } from './Header';",
          "import { Sidebar } from './Sidebar';",
          "import { SelectedPage } from './SelectedPage';",
          "import { Unused } from './Unused';",
          "import { InactiveRoute } from './InactiveRoute';",
          'export function RootLayout() { return <main><Header /><Sidebar /><SelectedPage /></main>; }',
          'export function RouteCatalog() { return <InactiveRoute />; }',
          'void Unused;',
        ].join('\n'),
      ],
      [
        headerPath,
        "import { DeepChild } from './DeepChild'; export function Header() { return <header><DeepChild /></header>; }",
      ],
      [sidebarPath, 'export function Sidebar() { return <aside />; }'],
      [
        pagePath,
        "import { Target } from './Target'; export function SelectedPage() { return <Target />; }",
      ],
      [deepChildPath, 'export function DeepChild() { return <span />; }'],
      [targetPath, 'export function Target() { return <article />; }'],
      [unusedPath, 'export function Unused() { return <aside />; }'],
      [inactivePath, 'export function InactiveRoute() { return <aside />; }'],
    ]);
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const result = await preparePreviewInspectorBundleFrontier({
      executionCandidate: {
        browserCandidate: { id: 'selected' },
        compositionEdges: [],
        criticalSurfaces: [
          {
            bypassedWrapperNames: [],
            exportName: 'RootLayout',
            id: 'root',
            omittedTopLevelEffectCount: 0,
            sourcePath: rootPath,
            strategy: 'selected-export-slice',
            watchSourcePaths: [rootPath],
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
        evidenceSourcePaths: [],
        executionRootSurfaceId: 'root',
        fidelity: 'page-sliced',
        id: 'selected',
        optionalSurfaces: [],
        runtimeTargetSurfaceId: 'target',
        watchSourcePaths: [rootPath, targetPath],
      } as never,
      plan: {
        edges: [],
        pageCandidates: [],
        root: { exportName: 'RootLayout', sourcePath: rootPath },
        target: { exportName: 'Target', sourcePath: targetPath },
      } as unknown as PreviewInspectorAncestorPlan,
      policy,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier, importer) => {
        const sourcePath = path.resolve(path.dirname(importer), `${specifier}.tsx`);
        return sources.has(sourcePath) ? sourcePath : undefined;
      },
      workspaceRoot,
    });

    expect(result.rejected).toBe(false);
    expect(result.frontier.authenticSourcePaths).toEqual(
      expect.arrayContaining([
        rootPath,
        headerPath,
        sidebarPath,
        pagePath,
        deepChildPath,
        targetPath,
      ]),
    );
    expect(result.frontier.authenticSourcePaths).not.toEqual(
      expect.arrayContaining([unusedPath, inactivePath]),
    );
    expect(result.frontier.authenticComponentExports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ exportNames: ['Header'], sourcePath: headerPath }),
        expect.objectContaining({ exportNames: ['Sidebar'], sourcePath: sidebarPath }),
        expect.objectContaining({ exportNames: ['SelectedPage'], sourcePath: pagePath }),
        expect.objectContaining({ exportNames: ['DeepChild'], sourcePath: deepChildPath }),
      ]),
    );
  });

  it('admits rendered descendants from a selected-route execution root without recording inactive imports', async () => {
    const workspaceRoot = '/workspace';
    const rootPath = '/workspace/RootLayout.tsx';
    const headerPath = '/workspace/Header.tsx';
    const sidebarPath = '/workspace/Sidebar.tsx';
    const pagePath = '/workspace/SelectedPage.tsx';
    const deepChildPath = '/workspace/DeepChild.tsx';
    const targetPath = '/workspace/Target.tsx';
    const unusedPath = '/workspace/Unused.tsx';
    const inactivePath = '/workspace/InactiveRoute.tsx';
    const sources = new Map<string, string>([
      [
        rootPath,
        [
          "import { Header } from './Header';",
          "import { Sidebar } from './Sidebar';",
          "import { SelectedPage } from './SelectedPage';",
          "import { Unused } from './Unused';",
          "import { InactiveRoute } from './InactiveRoute';",
          'export function RootLayout() { return <main><Header /><Sidebar /><SelectedPage /></main>; }',
          'export function InactiveCatalog() { return <InactiveRoute />; }',
          'void Unused;',
        ].join('\n'),
      ],
      [
        headerPath,
        "import { DeepChild } from './DeepChild'; export function Header() { return <header><DeepChild /></header>; }",
      ],
      [sidebarPath, 'export function Sidebar() { return <aside />; }'],
      [
        pagePath,
        "import { Target } from './Target'; export function SelectedPage() { return <Target />; }",
      ],
      [deepChildPath, 'export function DeepChild() { return <span />; }'],
      [targetPath, 'export function Target() { return <article />; }'],
      [unusedPath, 'export function Unused() { return <aside />; }'],
      [inactivePath, 'export function InactiveRoute() { return <aside />; }'],
    ]);
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const result = await preparePreviewInspectorBundleFrontier({
      executionCandidate: {
        browserCandidate: { id: 'selected' },
        compositionEdges: [
          { childSurfaceId: 'page', ownerSurfaceId: 'root', relation: 'contains-authored-child' },
        ],
        criticalSurfaces: [
          {
            bypassedWrapperNames: [],
            exportName: 'RootLayout',
            id: 'root',
            omittedTopLevelEffectCount: 0,
            sourcePath: rootPath,
            strategy: 'selected-route-surface',
            watchSourcePaths: [rootPath],
          },
          {
            bypassedWrapperNames: [],
            exportName: 'SelectedPage',
            id: 'page',
            omittedTopLevelEffectCount: 0,
            sourcePath: pagePath,
            strategy: 'authentic-module-export',
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
        evidenceSourcePaths: [],
        executionRootSurfaceId: 'root',
        fidelity: 'page-authentic',
        id: 'selected-route-root',
        optionalSurfaces: [],
        runtimeTargetSurfaceId: 'target',
        watchSourcePaths: [rootPath, pagePath, targetPath],
      } as never,
      plan: {
        edges: [],
        pageCandidates: [],
        root: { exportName: 'RootLayout', sourcePath: rootPath },
        target: { exportName: 'Target', sourcePath: targetPath },
      } as unknown as PreviewInspectorAncestorPlan,
      policy,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier, importer) => {
        const sourcePath = path.resolve(path.dirname(importer), `${specifier}.tsx`);
        return sources.has(sourcePath) ? sourcePath : undefined;
      },
      workspaceRoot,
    });

    expect(result.rejected).toBe(false);
    expect(result.frontier.authenticComponentExports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ exportNames: ['Header'], sourcePath: headerPath }),
        expect.objectContaining({ exportNames: ['Sidebar'], sourcePath: sidebarPath }),
        expect.objectContaining({ exportNames: ['SelectedPage'], sourcePath: pagePath }),
        expect.objectContaining({ exportNames: ['DeepChild'], sourcePath: deepChildPath }),
      ]),
    );
    expect(result.frontier.authenticComponentExports).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourcePath: unusedPath }),
        expect.objectContaining({ sourcePath: inactivePath }),
      ]),
    );
    expect(result.frontier.projectedEdges).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetPath: headerPath }),
        expect.objectContaining({ targetPath: sidebarPath }),
        expect.objectContaining({ targetPath: pagePath }),
        expect.objectContaining({ targetPath: deepChildPath }),
      ]),
    );
  });

  /** Keeps the one generated registry branch named by the selected Next route parameters. */
  it('admits a parameter-selected lazy component from a broad support registry', async () => {
    const workspaceRoot = '/workspace';
    const pagePath = '/workspace/page.tsx';
    const registryPath = '/workspace/registry.tsx';
    const selectedPath = '/workspace/registry/new-york-v4/blocks/dashboard-01/page.tsx';
    const selectedHelperPath = '/workspace/registry/new-york-v4/blocks/dashboard-01/Dashboard.tsx';
    const siblingPaths = Array.from(
      { length: 9 },
      (_, index) =>
        `/workspace/registry/new-york-v4/blocks/dashboard-${String(index + 2).padStart(2, '0')}/page.tsx`,
    );
    const registryEntries = [selectedPath, ...siblingPaths].map((sourcePath) => {
      const name = path.basename(path.dirname(sourcePath));
      return `${JSON.stringify(name)}: React.lazy(() => import(${JSON.stringify(`./registry/new-york-v4/blocks/${name}/page`)}))`;
    });
    const sources = new Map<string, string>([
      [
        pagePath,
        "import { getRegistryComponent } from './registry'; export default function Page(){ const Component = getRegistryComponent(); return <Component />; }",
      ],
      [
        registryPath,
        `import * as React from 'react'; const Components = {${registryEntries.join(',')}}; export function getRegistryComponent(){ return Components['dashboard-01']; }`,
      ],
      [
        selectedPath,
        "import { Dashboard } from './Dashboard'; export default function Page(){ return <Dashboard />; }",
      ],
      [selectedHelperPath, 'export function Dashboard(){ return <main>selected</main>; }'],
      ...siblingPaths.map(
        (sourcePath, index) =>
          [
            sourcePath,
            `export default function Sibling(){ return <main>${index.toString()}</main>; }`,
          ] as const,
      ),
    ]);
    const surface = {
      bypassedWrapperNames: [],
      exportName: 'default',
      id: 'page',
      omittedTopLevelEffectCount: 0,
      sourcePath: pagePath,
      strategy: 'authentic-module-export',
      watchSourcePaths: [pagePath],
    } as const;
    const plan = {
      edges: [],
      pageCandidates: [],
      root: { exportName: 'default', sourcePath: pagePath },
      target: { exportName: 'default', sourcePath: pagePath },
    } as unknown as PreviewInspectorAncestorPlan;
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');

    const result = await preparePreviewInspectorBundleFrontier({
      executionCandidate: {
        browserCandidate: { id: 'selected' },
        compositionEdges: [],
        criticalSurfaces: [surface],
        evidenceSourcePaths: [],
        executionRootSurfaceId: surface.id,
        fidelity: 'page-authentic',
        id: 'selected-dashboard',
        optionalSurfaces: [],
        routeRecipe: {
          kind: 'next-app',
          params: { name: 'dashboard-01', style: 'new-york-v4' },
        },
        runtimeTargetSurfaceId: surface.id,
        watchSourcePaths: [pagePath],
      } as never,
      plan,
      policy,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier, importer) => {
        if (!specifier.startsWith('.')) return undefined;
        const unresolved = path.resolve(path.dirname(importer), specifier);
        return [unresolved, `${unresolved}.ts`, `${unresolved}.tsx`].find((candidate) =>
          sources.has(candidate),
        );
      },
      workspaceRoot,
    });

    expect(result.rejected).toBe(false);
    expect(result.frontier.authenticSourcePaths).toEqual(
      expect.arrayContaining([pagePath, registryPath, selectedPath, selectedHelperPath]),
    );
    expect(
      result.frontier.authenticSourcePaths.filter((sourcePath) =>
        siblingPaths.includes(sourcePath),
      ),
    ).toEqual([]);
  });

  it('admits every runtime star-export branch that esbuild may evaluate', async () => {
    const workspaceRoot = '/workspace';
    const targetPath = '/workspace/Target.tsx';
    const barrelPath = '/workspace/ui/index.ts';
    const desiredPath = '/workspace/ui/Desired.tsx';
    const dormantPath = '/workspace/ui/Dormant.tsx';
    const sources = new Map<string, string>([
      [targetPath, "import { Desired } from './ui'; export const Target = Desired;"],
      [barrelPath, "export * from './Desired'; export * from './Dormant';"],
      [desiredPath, 'export const Desired = null;'],
      [
        dormantPath,
        Array.from(
          { length: 300 },
          (_, index) => `import { value${index.toString()} } from './dormant-${index.toString()}';`,
        ).join('\n'),
      ],
    ]);
    const plan = {
      edges: [],
      pageCandidates: [
        { dependencyPaths: [], edges: [], root: { exportName: 'Target', sourcePath: targetPath } },
      ],
      root: { exportName: 'Target', sourcePath: targetPath },
      target: { exportName: 'Target', sourcePath: targetPath },
    } as unknown as PreviewInspectorAncestorPlan;
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const result = await preparePreviewInspectorBundleFrontier({
      plan,
      policy,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier, importer) => {
        const relative = path.resolve(path.dirname(importer), specifier);
        return sources.has(relative)
          ? relative
          : sources.has(path.join(relative, 'index.ts'))
            ? path.join(relative, 'index.ts')
            : sources.has(`${relative}.ts`)
              ? `${relative}.ts`
              : sources.has(`${relative}.tsx`)
                ? `${relative}.tsx`
                : undefined;
      },
      workspaceRoot,
    });

    expect(result.rejected).toBe(false);
    expect(result.frontier.authenticSourcePaths).toEqual(
      [barrelPath, desiredPath, dormantPath, targetPath].sort(),
    );
    expect(result.frontier.summary.authoredEdgeCount).toBe(3);
  });

  it('admits an unrequested named re-export because its module can contribute runtime code', async () => {
    const workspaceRoot = '/workspace';
    const targetPath = '/workspace/Target.tsx';
    const barrelPath = '/workspace/ui/index.ts';
    const selectedPath = '/workspace/ui/Selected.tsx';
    const runtimePath = '/workspace/ui/runtime.ts';
    const sources = new Map<string, string>([
      [targetPath, "import { Selected } from './ui'; export const Target = Selected;"],
      [
        barrelPath,
        "export { Selected } from './Selected'; export { RUNTIME_VALUE } from './runtime';",
      ],
      [selectedPath, 'export const Selected = null;'],
      [runtimePath, 'globalThis.__runtimeEvaluated = true; export const RUNTIME_VALUE = 1;'],
    ]);
    const plan = {
      edges: [],
      pageCandidates: [
        { dependencyPaths: [], edges: [], root: { exportName: 'Target', sourcePath: targetPath } },
      ],
      root: { exportName: 'Target', sourcePath: targetPath },
      target: { exportName: 'Target', sourcePath: targetPath },
    } as unknown as PreviewInspectorAncestorPlan;
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const result = await preparePreviewInspectorBundleFrontier({
      plan,
      policy,
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier, importer) => {
        const relative = path.resolve(path.dirname(importer), specifier);
        return sources.has(relative)
          ? relative
          : sources.has(path.join(relative, 'index.ts'))
            ? path.join(relative, 'index.ts')
            : sources.has(`${relative}.ts`)
              ? `${relative}.ts`
              : sources.has(`${relative}.tsx`)
                ? `${relative}.tsx`
                : undefined;
      },
      workspaceRoot,
    });

    expect(result.rejected).toBe(false);
    expect(result.frontier.authenticSourcePaths).toEqual(
      [barrelPath, runtimePath, selectedPath, targetPath].sort(),
    );
    expect(result.frontier.summary.authoredEdgeCount).toBe(3);
  });
});
