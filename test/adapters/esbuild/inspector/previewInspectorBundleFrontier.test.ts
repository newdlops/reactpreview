/* eslint-disable max-lines -- Frontier invariants require focused full-shape fixtures. */
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createPreviewCompilerFrontierPolicy,
  type PreviewCompilerFrontierReason,
} from '../../../../src/domain/previewCompilerFrontier';
import {
  createPreviewInspectorBundleSourceInventoryMemo,
  preparePreviewInspectorBundleFrontier,
  type PreviewInspectorBundleSourceInventoryMemo,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleFrontier';
import {
  collectPreviewInspectorBundleOptionalClosure,
  type PreviewInspectorBundleResolvedSourceNode,
  type PreviewInspectorBundleResolvedStaticEdge,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleSourceInventoryMemo';
import { createPreviewInspectorBundleDiagnosticsCollector } from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleDiagnostics';
import {
  createPreviewInspectorBundleFrontierIdentity,
  PREVIEW_INSPECTOR_BUNDLE_FRONTIER_FORMAT_VERSION,
  PREVIEW_INSPECTOR_PAGE_EXECUTION_FRONTIER_FORMAT_VERSION,
  sortPreviewInspectorBundleFrontierReasons,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleFrontierFinalization';
import type { PreviewInspectorAncestorPlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorAncestorPlan';
import type { PreviewInspectorPageExecutionCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionTypes';
import {
  createPreviewInspectorLocalComponentSlice,
  createPreviewInspectorSelectedExportSlice,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorMountSurfaceSlice';

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

  it('keeps frontier identity and membership stable across repeated equivalent source reads', async () => {
    const workspaceRoot = '/workspace';
    const targetPath = '/workspace/Target.tsx';
    const helperPath = '/workspace/helper.ts';
    const sources = new Map<string, string>([
      [targetPath, "import { helper } from './helper'; export const Target = helper;"],
      [helperPath, 'export const helper = null;'],
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
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        preparePreviewInspectorBundleFrontier({
          plan,
          policy,
          readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
          resolveModule: (specifier, importer) =>
            specifier === './helper'
              ? path.resolve(path.dirname(importer), 'helper.ts')
              : undefined,
          workspaceRoot,
        }),
      ),
    );
    const first = results[0];
    if (first === undefined) throw new Error('Expected one frontier result.');
    for (const result of results.slice(1)) {
      expect(result.frontier.identity).toBe(first.frontier.identity);
      expect(result.frontier.authenticSourcePaths).toEqual(first.frontier.authenticSourcePaths);
      expect(result.frontier.projectedEdges).toEqual(first.frontier.projectedEdges);
      expect(result.frontier.summary).toEqual(first.frontier.summary);
    }
    expect(Object.isFrozen(first.frontier.authenticSourcePaths)).toBe(true);
    expect(Object.isFrozen(first.frontier.summary)).toBe(true);
  });

  it('preserves interleaved queue traces, serialization, and diagnostics with an observer', async () => {
    const workspaceRoot = '/workspace';
    const exactA = '/workspace/ExactA.tsx';
    const exactB = '/workspace/ExactB.tsx';
    const shared = '/workspace/Shared.ts';
    const supportA = '/workspace/SupportA.ts';
    const optionalA = '/workspace/OptionalA.tsx';
    const optionalASupport = '/workspace/OptionalASupport.ts';
    const optionalB = '/workspace/OptionalB.tsx';
    const optionalBSupport = '/workspace/OptionalBSupport.ts';
    const optionalBroken = '/workspace/OptionalBroken.tsx';
    const optionalZ = '/workspace/OptionalZ.ts';
    const sources = new Map<string, string>([
      [
        exactA,
        [
          "import { shared as first } from './Shared';",
          "import { shared as second } from './Shared';",
          "import { support } from './SupportA';",
          'export const ExactA = first ?? second ?? support;',
        ].join('\n'),
      ],
      [exactB, "import { shared } from './Shared'; export const ExactB = shared;"],
      [shared, 'export const shared = true;'],
      [supportA, "import 'generic-package'; export const support = true;"],
      [
        optionalA,
        [
          "import { value as z } from './OptionalZ';",
          "import { value as a } from './OptionalASupport';",
          "import { value as zAgain } from './OptionalZ';",
          'export default function OptionalA() { return z ?? a ?? zAgain; }',
        ].join('\n'),
      ],
      [optionalASupport, 'export const value = "a";'],
      [
        optionalB,
        "import { value } from './OptionalBSupport'; export default function OptionalB() { return value; }",
      ],
      [optionalBSupport, 'export const value = "b";'],
      [optionalZ, 'export const value = "z";'],
    ]);
    const resolutions = new Map<string, string>([
      [`${exactA}\0./Shared`, shared],
      [`${exactA}\0./SupportA`, supportA],
      [`${exactB}\0./Shared`, shared],
      [`${optionalA}\0./OptionalZ`, optionalZ],
      [`${optionalA}\0./OptionalASupport`, optionalASupport],
      [`${optionalB}\0./OptionalBSupport`, optionalBSupport],
    ]);
    const plan = {
      edges: [],
      pageCandidates: [],
      root: { exportName: 'ExactA', sourcePath: exactA },
      target: { exportName: 'ExactA', sourcePath: exactA },
    } as unknown as PreviewInspectorAncestorPlan;
    const executionCandidate = {
      browserCandidate: { id: 'selected' },
      compositionEdges: [],
      criticalSurfaces: [
        {
          bypassedWrapperNames: [],
          exportName: 'ExactA',
          id: 'exact-a',
          omittedTopLevelEffectCount: 0,
          sourcePath: exactA,
          strategy: 'authentic-module-export',
          watchSourcePaths: [exactA],
        },
        {
          bypassedWrapperNames: [],
          exportName: 'ExactB',
          id: 'exact-b',
          omittedTopLevelEffectCount: 0,
          sourcePath: exactB,
          strategy: 'authentic-module-export',
          watchSourcePaths: [exactB],
        },
      ],
      evidenceSourcePaths: [],
      fidelity: 'page-sliced',
      id: 'stable-queue-candidate',
      optionalSurfaces: [optionalB, optionalBroken, optionalA].map((sourcePath, index) => ({
        bypassedWrapperNames: [],
        exportName: 'default',
        id: `optional-${index.toString()}`,
        omittedTopLevelEffectCount: 0,
        sourcePath,
        strategy: 'selected-route-surface',
        watchSourcePaths: [sourcePath],
      })),
      watchSourcePaths: [exactA, exactB, optionalA, optionalB, optionalBroken],
    } as never;
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const prepare = (
      bundleDiagnostics?: ReturnType<typeof createPreviewInspectorBundleDiagnosticsCollector>,
    ): {
      readonly resolverCalls: string[];
      readonly result: ReturnType<typeof preparePreviewInspectorBundleFrontier>;
      readonly sourceReads: string[];
    } => {
      const sourceReads: string[] = [];
      const resolverCalls: string[] = [];
      const result = preparePreviewInspectorBundleFrontier({
        ...(bundleDiagnostics === undefined ? {} : { bundleDiagnostics }),
        executionCandidate,
        plan,
        policy,
        readSource: (sourcePath) => {
          sourceReads.push(sourcePath);
          return Promise.resolve(sources.get(sourcePath));
        },
        resolveModule: (specifier, importer) => {
          resolverCalls.push(`${importer}\0${specifier}`);
          return resolutions.get(`${importer}\0${specifier}`);
        },
        runtimeCompanionSourcePaths: [exactA],
        workspaceRoot,
      });
      return { resolverCalls, result, sourceReads };
    };

    const withoutDiagnostics = prepare();
    let clockMicros = 0n;
    const diagnostics = createPreviewInspectorBundleDiagnosticsCollector(true, () => {
      const now = clockMicros;
      clockMicros += 1_000n;
      return now;
    });
    if (diagnostics === undefined) throw new Error('Expected bundle diagnostics.');
    const withDiagnostics = prepare(diagnostics);
    const [baseline, observed] = await Promise.all([
      withoutDiagnostics.result,
      withDiagnostics.result,
    ]);

    expect(withDiagnostics.sourceReads).toEqual(withoutDiagnostics.sourceReads);
    expect(withDiagnostics.resolverCalls).toEqual(withoutDiagnostics.resolverCalls);
    expect(withoutDiagnostics.sourceReads).toEqual([
      exactA,
      exactB,
      shared,
      supportA,
      optionalA,
      optionalASupport,
      optionalZ,
      optionalB,
      optionalBSupport,
      optionalBroken,
    ]);
    expect(withoutDiagnostics.resolverCalls).toEqual([
      `${exactA}\0./Shared`,
      `${exactA}\0./Shared`,
      `${exactA}\0./SupportA`,
      `${exactB}\0./Shared`,
      `${supportA}\0generic-package`,
      `${optionalA}\0./OptionalZ`,
      `${optionalA}\0./OptionalASupport`,
      `${optionalA}\0./OptionalZ`,
      `${optionalB}\0./OptionalBSupport`,
    ]);
    expect(JSON.stringify(observed)).toBe(JSON.stringify(baseline));
    expect(baseline.frontier.identity).toBe(
      'b4377a6e1c2907af5b99a45b19a054aca6b518601c83bb7982aab12154a67be3',
    );
    expect(baseline.frontier.authenticSourcePaths).toEqual([
      exactA,
      exactB,
      optionalA,
      optionalASupport,
      optionalB,
      optionalBSupport,
      optionalZ,
      shared,
      supportA,
    ]);
    expect(baseline.frontier.exactSourcePaths).toEqual([exactA, exactB]);
    expect(baseline.frontier.packageDemandSourcePaths).toEqual([supportA]);
    expect(baseline.frontier.authenticComponentExports).toEqual([
      {
        exportNames: ['default'],
        runtimeHookExportNames: [],
        sourcePath: optionalA,
      },
      {
        exportNames: ['default'],
        runtimeHookExportNames: [],
        sourcePath: optionalB,
      },
    ]);
    expect(baseline.frontier.projectedEdges).toEqual([
      {
        exportNames: ['default'],
        importerPath: optionalBroken,
        moduleSpecifier: optionalBroken,
        occurrenceStart: 0,
        reason: 'exact-source-unreadable',
        runtimeHookExportNames: [],
        targetPath: optionalBroken,
      },
    ]);
    expect(baseline.frontier.sourceKinds).toEqual({
      [exactA]: 'critical-surface',
      [exactB]: 'critical-surface',
      [shared]: 'critical-support',
      [supportA]: 'critical-support',
      [optionalA]: 'optional-surface',
      [optionalASupport]: 'optional-support',
      [optionalZ]: 'optional-support',
      [optionalB]: 'optional-surface',
      [optionalBSupport]: 'optional-support',
    });
    expect(baseline.frontier.summary).toEqual({
      authoredEdgeCount: 8,
      exactModuleCount: 2,
      maximumDepth: 1,
      optionalComponentCount: 2,
      packageDemandSourceCount: 1,
      projectedEdgeCount: 1,
      sourceBytes: 695,
      supportModuleCount: 5,
      totalAuthoredModuleCount: 9,
      truncationReasons: [],
    });
    const nonDurationDiagnostics = Object.fromEntries(
      Object.entries(diagnostics.snapshot()).filter(([name]) => !name.endsWith('Micros')),
    );
    expect(nonDurationDiagnostics).toEqual({
      authoredPathCheckCount: 14,
      candidateSelectionSortCount: 0,
      diagnosticsVersion: 1,
      edgeVisitCount: 13,
      frontierCount: 1,
      inventoryComputationCount: 9,
      inventoryHitCount: 0,
      inventoryReadPathCacheHitCount: 0,
      inventoryReadRequestCount: 10,
      inventoryRequestCount: 9,
      optionalClosureProbeCount: 3,
      queueIterationCount: 17,
      queuePeakLength: 8,
      queueSortCount: 17,
      rawSourceReadCount: 10,
      resolveModuleCount: 9,
      sliceComputationCount: 0,
      sliceHitCount: 0,
      sliceRequestCount: 0,
    });
    expect(diagnostics.snapshot().queueSortCount).toBe(diagnostics.snapshot().queueIterationCount);
  });

  it('reuses only exact selected-export and local-component slice operations', async () => {
    const sourcePath = '/workspace/Page.tsx';
    const changedPath = '/workspace/ChangedPage.tsx';
    const sourceText = [
      'const Inner = () => null;',
      'const Other = () => null;',
      'export const Page = Inner;',
      'export const OtherPage = Other;',
    ].join('\n');
    const changedSourceText = `${sourceText}\nexport const Changed = true;`;
    const memo = createPreviewInspectorBundleSourceInventoryMemo();

    const selected = memo.collectSelectedExportSlice(sourcePath, sourceText, 'Inner');
    const selectedAgain = memo.collectSelectedExportSlice(sourcePath, sourceText, 'Inner');
    const local = memo.collectLocalComponentSlice(sourcePath, sourceText, 'Inner', []);
    const localAgain = memo.collectLocalComponentSlice(sourcePath, sourceText, 'Inner', []);
    const changedPathSlice = memo.collectSelectedExportSlice(changedPath, sourceText, 'Inner');
    const changedTextSlice = memo.collectSelectedExportSlice(
      sourcePath,
      changedSourceText,
      'Inner',
    );
    const changedExportSlice = memo.collectSelectedExportSlice(sourcePath, sourceText, 'Other');
    const changedLocalSlice = memo.collectLocalComponentSlice(sourcePath, sourceText, 'Other', []);
    const memoWrapperSlice = memo.collectLocalComponentSlice(sourcePath, sourceText, 'Inner', [
      'memo',
    ]);
    const wrapperSequence = memo.collectLocalComponentSlice(sourcePath, sourceText, 'Inner', [
      'memo',
      'styled',
    ]);
    const changedWrapperSequence = memo.collectLocalComponentSlice(
      sourcePath,
      sourceText,
      'Inner',
      ['styled', 'memo'],
    );
    const failure = memo.collectSelectedExportSlice(sourcePath, sourceText, 'Missing');
    const failureAgain = memo.collectSelectedExportSlice(sourcePath, sourceText, 'Missing');

    expect(JSON.stringify(selectedAgain)).toBe(JSON.stringify(selected));
    expect(JSON.stringify(localAgain)).toBe(JSON.stringify(local));
    expect(JSON.stringify(selected)).toBe(
      JSON.stringify(
        createPreviewInspectorSelectedExportSlice({
          exportName: 'Inner',
          sourcePath,
          sourceText,
        }),
      ),
    );
    expect(JSON.stringify(local)).toBe(
      JSON.stringify(
        createPreviewInspectorLocalComponentSlice({
          localName: 'Inner',
          preservedWrapperKinds: [],
          sourcePath,
          sourceText,
        }),
      ),
    );
    expect(JSON.stringify(failure)).toBe(
      JSON.stringify(
        createPreviewInspectorSelectedExportSlice({
          exportName: 'Missing',
          sourcePath,
          sourceText,
        }),
      ),
    );
    expect(JSON.stringify(local)).not.toBe(JSON.stringify(selected));
    expect(changedWrapperSequence).not.toBe(wrapperSequence);
    expect(JSON.stringify(changedWrapperSequence)).toBe(JSON.stringify(wrapperSequence));
    expect(failureAgain).toBe(failure);
    for (const result of [
      selected,
      selectedAgain,
      local,
      localAgain,
      changedPathSlice,
      changedTextSlice,
      changedExportSlice,
      changedLocalSlice,
      memoWrapperSlice,
      wrapperSequence,
      changedWrapperSequence,
      failure,
      failureAgain,
    ]) {
      expect(Object.isFrozen(result)).toBe(true);
      if (result.kind === 'success') {
        expect(Object.isFrozen(result.slice)).toBe(true);
        expect(Object.isFrozen(result.slice.referencedLocalNames)).toBe(true);
      }
    }
    expect(memo.getSliceStatistics()).toEqual({
      released: false,
      sliceComputations: 10,
      sliceEntries: 10,
      sliceHits: 3,
      sliceRequests: 13,
    });

    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const frontierMemo = createPreviewInspectorBundleSourceInventoryMemo();
    const sampledGetSliceStatistics = vi.fn(frontierMemo.getSliceStatistics);
    const sampledGetStatistics = vi.fn(frontierMemo.getStatistics);
    const sampledMemo: PreviewInspectorBundleSourceInventoryMemo = Object.freeze({
      ...frontierMemo,
      getSliceStatistics: sampledGetSliceStatistics,
      getStatistics: sampledGetStatistics,
    });
    let clockMicros = 0n;
    const bundleDiagnostics = createPreviewInspectorBundleDiagnosticsCollector(true, () => {
      const now = clockMicros;
      clockMicros += 1_000n;
      return now;
    });
    if (bundleDiagnostics === undefined) throw new Error('Expected bundle diagnostics.');
    const candidate = (
      strategy: 'inner-local-component-slice' | 'selected-export-slice',
      includeLocalName = true,
    ): PreviewInspectorPageExecutionCandidate =>
      ({
        browserCandidate: { id: 'selected' },
        compositionEdges: [],
        criticalSurfaces: [
          {
            bypassedWrapperNames: [],
            exportName: 'Inner',
            id: strategy,
            ...(strategy === 'inner-local-component-slice' && includeLocalName
              ? { localName: 'Inner' }
              : {}),
            omittedTopLevelEffectCount: 0,
            sourcePath,
            strategy,
            watchSourcePaths: [sourcePath],
          },
        ],
        evidenceSourcePaths: [],
        fidelity: 'target-only',
        id: strategy,
        optionalSurfaces: [],
        watchSourcePaths: [sourcePath],
      }) as unknown as PreviewInspectorPageExecutionCandidate;
    const prepareFrontier = (
      strategy: 'inner-local-component-slice' | 'selected-export-slice',
      withMemo: boolean,
      includeLocalName = true,
      sourceInventoryMemo: PreviewInspectorBundleSourceInventoryMemo = sampledMemo,
      withDiagnostics = withMemo,
      sourceReads?: string[],
      resolverCalls?: string[],
    ): ReturnType<typeof preparePreviewInspectorBundleFrontier> =>
      preparePreviewInspectorBundleFrontier({
        executionCandidate: candidate(strategy, includeLocalName),
        plan: {
          edges: [],
          pageCandidates: [],
          root: { exportName: 'Inner', sourcePath },
          target: { exportName: 'Inner', sourcePath },
        } as unknown as PreviewInspectorAncestorPlan,
        policy,
        readSource: (requestedPath) => {
          sourceReads?.push(requestedPath);
          return Promise.resolve(sourceText);
        },
        resolveModule: (specifier, importer) => {
          resolverCalls?.push(`${importer}\0${specifier}`);
          return undefined;
        },
        ...(withMemo ? { sourceInventoryMemo } : {}),
        ...(withDiagnostics ? { bundleDiagnostics } : {}),
        workspaceRoot: '/workspace',
      });
    const selectedFrontierWithoutMemo = await prepareFrontier('selected-export-slice', false);
    const selectedFrontierWithMemo = await prepareFrontier('selected-export-slice', true);
    const localFrontierWithoutMemo = await prepareFrontier('inner-local-component-slice', false);
    const localFrontierWithMemo = await prepareFrontier('inner-local-component-slice', true);
    expect(JSON.stringify(selectedFrontierWithMemo)).toBe(
      JSON.stringify(selectedFrontierWithoutMemo),
    );
    expect(JSON.stringify(localFrontierWithMemo)).toBe(JSON.stringify(localFrontierWithoutMemo));
    await prepareFrontier('selected-export-slice', true);
    await prepareFrontier('inner-local-component-slice', true);
    await prepareFrontier('inner-local-component-slice', true, false);
    expect(frontierMemo.getSliceStatistics()).toEqual({
      released: false,
      sliceComputations: 2,
      sliceEntries: 2,
      sliceHits: 0,
      sliceRequests: 2,
    });
    expect(sampledGetSliceStatistics).toHaveBeenCalledTimes(4);
    expect(sampledGetStatistics).toHaveBeenCalledTimes(4);
    const diagnosticsSnapshot = bundleDiagnostics.snapshot();
    expect(diagnosticsSnapshot).toMatchObject({
      authoredPathCheckCount: 3,
      authoredPathCheckMicros: 3,
      candidateSelectionMicros: 0,
      candidateSelectionSortCount: 0,
      edgeVisitCount: 0,
      frontierCount: 5,
      frontierFinalizeMicros: 15,
      frontierIdentityMicros: 5,
      inventoryComputationCount: 2,
      inventoryHitCount: 0,
      inventoryLookupMicros: 2,
      inventoryReadPathCacheHitCount: 0,
      inventoryReadRequestCount: 2,
      optionalClosureMicros: 0,
      optionalClosureProbeCount: 0,
      queueIterationCount: 3,
      queuePeakLength: 1,
      queueSortCount: 3,
      queueSortMicros: 3,
      rawSourceReadCount: 2,
      rawSourceReadMicros: 2,
      resolveModuleCount: 0,
      resolveModuleMicros: 0,
      sliceComputationCount: 2,
      sliceHitCount: 0,
      sliceLookupMicros: 2,
      sliceRequestCount: 2,
    });
    expect(diagnosticsSnapshot.sliceRequestCount).toBe(
      diagnosticsSnapshot.sliceComputationCount + diagnosticsSnapshot.sliceHitCount,
    );
    expect(diagnosticsSnapshot.inventoryRequestCount).toBe(
      diagnosticsSnapshot.inventoryComputationCount + diagnosticsSnapshot.inventoryHitCount,
    );

    const observerOffRealMemo = createPreviewInspectorBundleSourceInventoryMemo();
    const observerOffGetSliceStatistics = vi.fn(observerOffRealMemo.getSliceStatistics);
    const observerOffGetStatistics = vi.fn(observerOffRealMemo.getStatistics);
    const observerOffMemo: PreviewInspectorBundleSourceInventoryMemo = Object.freeze({
      ...observerOffRealMemo,
      getSliceStatistics: observerOffGetSliceStatistics,
      getStatistics: observerOffGetStatistics,
    });
    const baselineSourceReads: string[] = [];
    const baselineResolverCalls: string[] = [];
    const observerOffSourceReads: string[] = [];
    const observerOffResolverCalls: string[] = [];
    const observerOffBaseline = await prepareFrontier(
      'selected-export-slice',
      false,
      true,
      sampledMemo,
      false,
      baselineSourceReads,
      baselineResolverCalls,
    );
    const observerOffFrontier = await prepareFrontier(
      'selected-export-slice',
      true,
      true,
      observerOffMemo,
      false,
      observerOffSourceReads,
      observerOffResolverCalls,
    );
    expect(observerOffGetSliceStatistics).toHaveBeenCalledTimes(0);
    expect(observerOffGetStatistics).toHaveBeenCalledTimes(0);
    const observerOffSliceStatistics = observerOffRealMemo.getSliceStatistics();
    const observerOffInventoryStatistics = observerOffRealMemo.getStatistics();
    expect(observerOffSliceStatistics.sliceRequests).toBeGreaterThan(0);
    expect(observerOffInventoryStatistics.requests).toBeGreaterThan(0);
    expect(JSON.stringify(observerOffFrontier)).toBe(JSON.stringify(observerOffBaseline));
    expect(observerOffFrontier.frontier.identity).toBe(observerOffBaseline.frontier.identity);
    expect(observerOffFrontier.frontier.summary).toEqual(observerOffBaseline.frontier.summary);
    expect(observerOffFrontier.frontier.authenticSourcePaths).toEqual(
      observerOffBaseline.frontier.authenticSourcePaths,
    );
    expect(observerOffFrontier.frontier.exactSourcePaths).toEqual(
      observerOffBaseline.frontier.exactSourcePaths,
    );
    expect(observerOffFrontier.frontier.authenticComponentExports).toEqual(
      observerOffBaseline.frontier.authenticComponentExports,
    );
    expect(observerOffFrontier.frontier.sourceKinds).toEqual(
      observerOffBaseline.frontier.sourceKinds,
    );
    expect(observerOffFrontier.frontier.projectedEdges).toEqual(
      observerOffBaseline.frontier.projectedEdges,
    );
    expect(observerOffFrontier.frontier.summary.truncationReasons).toEqual(
      observerOffBaseline.frontier.summary.truncationReasons,
    );
    expect(observerOffSourceReads).toEqual(baselineSourceReads);
    expect(observerOffResolverCalls).toEqual(baselineResolverCalls);
    observerOffMemo.release();
    expect(observerOffRealMemo.getSliceStatistics().released).toBe(true);
    expect(observerOffRealMemo.getStatistics().released).toBe(true);

    frontierMemo.release();
    expect(frontierMemo.getSliceStatistics()).toEqual({
      released: true,
      sliceComputations: 2,
      sliceEntries: 0,
      sliceHits: 0,
      sliceRequests: 2,
    });

    memo.collect(sourcePath, sourceText);
    expect(memo.getStatistics()).toEqual({
      computations: 1,
      entries: 1,
      hits: 0,
      released: false,
      requests: 1,
    });
    memo.release();
    expect(memo.getStatistics()).toEqual({
      computations: 1,
      entries: 0,
      hits: 0,
      released: true,
      requests: 1,
    });
    expect(memo.getSliceStatistics()).toEqual({
      released: true,
      sliceComputations: 10,
      sliceEntries: 0,
      sliceHits: 3,
      sliceRequests: 13,
    });
    expect(() => memo.collect(sourcePath, sourceText)).toThrow('memo was already released');
    expect(() => memo.collectSelectedExportSlice(sourcePath, sourceText, 'Inner')).toThrow(
      'memo was already released',
    );
  });

  it('reuses only exact path-and-text source inventories and releases every retained entry', async () => {
    const workspaceRoot = '/workspace';
    const targetPath = '/workspace/Target.tsx';
    const changedPath = '/workspace/ChangedTarget.tsx';
    const helperPath = '/workspace/helper.ts';
    const sourceText = "import { helper } from './helper'; export const Target = () => helper;";
    const changedSourceText = `${sourceText}\nexport const changed = true;`;
    const sources = new Map<string, string>([
      [targetPath, sourceText],
      [changedPath, sourceText],
      [helperPath, 'export const helper = null;'],
    ]);
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const memo = createPreviewInspectorBundleSourceInventoryMemo();
    const createPlan = (sourcePath: string): PreviewInspectorAncestorPlan =>
      ({
        edges: [],
        pageCandidates: [],
        root: { exportName: 'Target', sourcePath },
        target: { exportName: 'Target', sourcePath },
      }) as unknown as PreviewInspectorAncestorPlan;
    const run = (
      sourcePath: string,
      sourceInventoryMemo = memo,
    ): ReturnType<typeof preparePreviewInspectorBundleFrontier> =>
      preparePreviewInspectorBundleFrontier({
        plan: createPlan(sourcePath),
        policy,
        readSource: (requestedPath) => Promise.resolve(sources.get(requestedPath)),
        resolveModule: (specifier, importer) =>
          specifier === './helper' && importer === sourcePath ? helperPath : undefined,
        sourceInventoryMemo,
        workspaceRoot,
      });
    const runWithoutMemo = (
      sourcePath: string,
    ): ReturnType<typeof preparePreviewInspectorBundleFrontier> =>
      preparePreviewInspectorBundleFrontier({
        plan: createPlan(sourcePath),
        policy,
        readSource: (requestedPath) => Promise.resolve(sources.get(requestedPath)),
        resolveModule: (specifier, importer) =>
          specifier === './helper' && importer === sourcePath ? helperPath : undefined,
        workspaceRoot,
      });

    const first = await run(targetPath);
    expect(memo.getStatistics()).toEqual({
      computations: 2,
      entries: 2,
      hits: 0,
      released: false,
      requests: 2,
    });
    const second = await run(targetPath);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(JSON.stringify(first)).toBe(JSON.stringify(await runWithoutMemo(targetPath)));
    expect(memo.getStatistics()).toEqual({
      computations: 2,
      entries: 2,
      hits: 2,
      released: false,
      requests: 4,
    });

    sources.set(targetPath, changedSourceText);
    const changedText = await run(targetPath);
    expect(JSON.stringify(changedText)).toBe(JSON.stringify(await runWithoutMemo(targetPath)));
    expect(memo.getStatistics()).toEqual({
      computations: 3,
      entries: 3,
      hits: 3,
      released: false,
      requests: 6,
    });

    const changedPathResult = await run(changedPath);
    expect(JSON.stringify(changedPathResult)).toBe(
      JSON.stringify(await runWithoutMemo(changedPath)),
    );
    expect(memo.getStatistics()).toEqual({
      computations: 4,
      entries: 4,
      hits: 4,
      released: false,
      requests: 8,
    });
    expect(changedPathResult.frontier.authenticSourcePaths).toContain(changedPath);

    memo.release();
    expect(memo.getStatistics()).toEqual({
      computations: 4,
      entries: 0,
      hits: 4,
      released: true,
      requests: 8,
    });
    await expect(run(changedPath)).rejects.toThrow('memo was already released');
  });

  it('keeps unreadable and multiple-surface failures ahead of slice memo lookup', async () => {
    const sourcePath = '/workspace/Target.tsx';
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const memo = createPreviewInspectorBundleSourceInventoryMemo();
    const plan = {
      edges: [],
      pageCandidates: [],
      root: { exportName: 'Missing', sourcePath },
      target: { exportName: 'Missing', sourcePath },
    } as unknown as PreviewInspectorAncestorPlan;
    let reads = 0;
    const run = (
      sourceText: string | undefined,
      slicedSurfaceCount: number,
    ): ReturnType<typeof preparePreviewInspectorBundleFrontier> =>
      preparePreviewInspectorBundleFrontier({
        ...(slicedSurfaceCount > 0
          ? {
              executionCandidate: {
                browserCandidate: { id: 'selected' },
                compositionEdges: [],
                criticalSurfaces: Array.from({ length: slicedSurfaceCount }, (_, index) => ({
                  bypassedWrapperNames: [],
                  exportName: `Missing${index.toString()}`,
                  id: `missing-${index.toString()}`,
                  omittedTopLevelEffectCount: 0,
                  sourcePath,
                  strategy: 'selected-export-slice',
                  watchSourcePaths: [sourcePath],
                })),
                evidenceSourcePaths: [],
                fidelity: 'target-only',
                id: 'missing-slice',
                optionalSurfaces: [],
                watchSourcePaths: [sourcePath],
              } as unknown as PreviewInspectorPageExecutionCandidate,
            }
          : {}),
        plan,
        policy,
        readSource: () => {
          reads += 1;
          return Promise.resolve(sourceText);
        },
        resolveModule: () => undefined,
        sourceInventoryMemo: memo,
        workspaceRoot: '/workspace',
      });

    await expect(run(undefined, 0)).resolves.toMatchObject({
      frontier: { summary: { truncationReasons: ['exact-source-unreadable'] } },
      rejected: true,
    });
    await expect(run(undefined, 0)).resolves.toMatchObject({
      frontier: { summary: { truncationReasons: ['exact-source-unreadable'] } },
      rejected: true,
    });
    await expect(run('export const Other = null;', 2)).resolves.toMatchObject({
      frontier: { summary: { truncationReasons: ['slice-unavailable'] } },
      rejected: true,
    });
    await expect(run('export const Other = null;', 2)).resolves.toMatchObject({
      frontier: { summary: { truncationReasons: ['slice-unavailable'] } },
      rejected: true,
    });
    expect(memo.getSliceStatistics()).toEqual({
      released: false,
      sliceComputations: 0,
      sliceEntries: 0,
      sliceHits: 0,
      sliceRequests: 0,
    });
    await expect(run('export const Other = null;', 1)).resolves.toMatchObject({
      frontier: { summary: { truncationReasons: ['slice-unavailable'] } },
      rejected: true,
    });
    await expect(run('export const Other = null;', 1)).resolves.toMatchObject({
      frontier: { summary: { truncationReasons: ['slice-unavailable'] } },
      rejected: true,
    });
    expect(reads).toBe(6);
    expect(memo.getStatistics()).toEqual({
      computations: 0,
      entries: 0,
      hits: 0,
      released: false,
      requests: 0,
    });
    expect(memo.getSliceStatistics()).toEqual({
      released: false,
      sliceComputations: 1,
      sliceEntries: 1,
      sliceHits: 0,
      sliceRequests: 1,
    });
  });

  it('keys v2 closure templates exactly while rebuilding candidate-specific identity', async () => {
    const workspaceRoot = '/workspace';
    const targetPath = '/workspace/Target.tsx';
    const pagePath = '/workspace/Page.tsx';
    const optionalPath = '/workspace/Optional.tsx';
    const runtimePath = '/workspace/runtime.ts';
    const sourceText =
      'const Inner = () => null; export const Target = Inner; export const Other = Inner;';
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const surface = (
      sourcePath: string,
      exportName: string,
      strategy: PreviewInspectorPageExecutionCandidate['criticalSurfaces'][number]['strategy'],
      overrides: Record<string, unknown> = {},
    ): PreviewInspectorPageExecutionCandidate['criticalSurfaces'][number] => ({
      bypassedWrapperNames: [],
      exportName,
      id: `${sourcePath}-${exportName}`,
      omittedTopLevelEffectCount: 0,
      sourcePath,
      strategy,
      watchSourcePaths: [sourcePath],
      ...overrides,
    });
    const baseCriticalSurfaces = [
      surface(targetPath, 'Target', 'selected-export-slice'),
      surface(pagePath, 'Other', 'authentic-module-export'),
    ];
    const pageSurface = baseCriticalSurfaces[1];
    if (pageSurface === undefined) throw new Error('Expected the page surface fixture.');
    const baseOptionalSurfaces = [surface(optionalPath, 'Other', 'selected-route-surface')];
    const candidate = (
      id: string,
      criticalSurfaces = baseCriticalSurfaces,
      optionalSurfaces = baseOptionalSurfaces,
      overrides: Record<string, unknown> = {},
    ): PreviewInspectorPageExecutionCandidate =>
      ({
        browserCandidate: { id: 'browser' },
        compositionEdges: [],
        criticalSurfaces,
        evidenceSourcePaths: [],
        executionRootContract: {
          exportName: 'Other',
          sourcePath: pagePath,
          surfaceId: 'page-root',
        },
        executionRootSurfaceId: 'page-root',
        fidelity: 'page-sliced',
        id,
        optionalSurfaces,
        routeRecipe: { kind: 'generic-memory-location', pathname: `/${id}` },
        runtimeTargetContract: {
          exportName: 'Target',
          sourcePath: targetPath,
          surfaceId: 'runtime-target',
        },
        runtimeTargetSurfaceId: 'runtime-target',
        watchSourcePaths: [],
        ...overrides,
      }) as unknown as PreviewInspectorPageExecutionCandidate;
    const basePlan = {
      edges: [],
      pageCandidates: [],
      root: { exportName: 'Other', sourcePath: pagePath },
      shallowVisualPaths: [
        {
          exportName: 'Other',
          importerPath: pagePath,
          moduleSpecifier: './Optional',
          occurrenceStart: 1,
          relation: 'jsx-child',
          sourcePath: optionalPath,
        },
      ],
      target: { exportName: 'Target', sourcePath: targetPath },
    } as unknown as PreviewInspectorAncestorPlan;
    const memo = createPreviewInspectorBundleSourceInventoryMemo();
    const run = (
      executionCandidate: PreviewInspectorPageExecutionCandidate,
      overrides: Partial<Parameters<typeof preparePreviewInspectorBundleFrontier>[0]> = {},
      sourceInventoryMemo: PreviewInspectorBundleSourceInventoryMemo | false = memo,
    ): ReturnType<typeof preparePreviewInspectorBundleFrontier> =>
      preparePreviewInspectorBundleFrontier({
        executionCandidate,
        plan: basePlan,
        policy,
        readSource: () => Promise.resolve(sourceText),
        resolveModule: () => undefined,
        runtimeCompanionSourcePaths: [runtimePath],
        ...(sourceInventoryMemo === false ? {} : { sourceInventoryMemo }),
        workspaceRoot,
        ...overrides,
      });

    const firstCandidate = candidate('first');
    const identityOnlyCritical = baseCriticalSurfaces.map((item) => ({
      ...item,
      bypassedWrapperNames: ['changed'],
      id: `${item.id}-changed`,
      omittedTopLevelEffectCount: 99,
      watchSourcePaths: ['/workspace/changed-watch.ts'],
    }));
    const identityOnlyOptional = baseOptionalSurfaces.map((item) => ({
      ...item,
      id: `${item.id}-changed`,
      watchSourcePaths: ['/workspace/changed-optional-watch.ts'],
    }));
    const secondCandidate = candidate('second', identityOnlyCritical, identityOnlyOptional, {
      browserCandidate: { id: 'changed-browser' },
      compositionEdges: [{ id: 'changed-edge' }],
      evidenceSourcePaths: ['/workspace/evidence.ts'],
      executionRootContract: {
        exportName: 'ContractOnly',
        sourcePath: '/workspace/contract.ts',
        surfaceId: 'changed-root',
      },
      executionRootSurfaceId: 'changed-root',
      fidelity: 'target-only',
      runtimeTargetContract: {
        exportName: 'ContractOnly',
        sourcePath: '/workspace/contract.ts',
        surfaceId: 'changed-target',
      },
      runtimeTargetSurfaceId: 'changed-target',
      watchSourcePaths: ['/workspace/watch.ts'],
    });
    const first = await run(firstCandidate);
    const changedPolicy = { ...policy, mode: 'corridor' } as const;
    const secondUncached = await run(secondCandidate, { policy: changedPolicy }, false);
    const second = await run(secondCandidate, { policy: changedPolicy });
    expect(JSON.stringify(second)).toBe(JSON.stringify(secondUncached));
    expect(second.frontier.executionCandidateId).toBe('second');
    expect(second.frontier.identity).not.toBe(first.frontier.identity);
    expect(memo.getClosureStatistics()).toEqual({
      closureComputations: 1,
      closureEntries: 1,
      closureHits: 1,
      closureRequests: 2,
      released: false,
    });
    for (const value of [
      second.frontier,
      second.frontier.summary,
      second.frontier.authenticSourcePaths,
      second.frontier.exactSourcePaths,
      second.frontier.packageDemandSourcePaths,
      second.frontier.projectedEdges,
      second.frontier.sourceKinds,
    ])
      expect(Object.isFrozen(value)).toBe(true);

    await run(candidate('reordered', [...baseCriticalSurfaces].reverse()));
    await run(candidate('shallow-non-pair-change'), {
      plan: {
        ...basePlan,
        shallowVisualPaths: [
          { ...basePlan.shallowVisualPaths?.[0], exportName: 'Target', occurrenceStart: 99 },
        ],
      } as never,
    });
    const misses: Parameters<typeof run>[] = [
      [candidate('workspace'), { workspaceRoot: '/' }],
      [candidate('runtime'), { runtimeCompanionSourcePaths: ['/workspace/runtime-2.ts'] }],
      [
        candidate('critical-path', [
          surface('/workspace/Other.tsx', 'Target', 'selected-export-slice'),
          pageSurface,
        ]),
      ],
      [
        candidate('critical-export', [
          surface(targetPath, 'Other', 'selected-export-slice'),
          pageSurface,
        ]),
      ],
      [
        candidate('critical-strategy', [
          surface(targetPath, 'Target', 'authentic-module-export'),
          pageSurface,
        ]),
      ],
      [
        candidate('critical-local', [
          surface(targetPath, 'Target', 'selected-export-slice', { localName: 'Inner' }),
          pageSurface,
        ]),
      ],
      [
        candidate('critical-wrappers', [
          surface(targetPath, 'Target', 'selected-export-slice', {
            preservedWrapperKinds: ['memo'],
          }),
          pageSurface,
        ]),
      ],
      [
        candidate('optional-path', baseCriticalSurfaces, [
          surface('/workspace/Optional2.tsx', 'Other', 'selected-route-surface'),
        ]),
      ],
      [
        candidate('optional-export', baseCriticalSurfaces, [
          surface(optionalPath, 'Target', 'selected-route-surface'),
        ]),
      ],
      [
        candidate('optional-strategy', baseCriticalSurfaces, [
          surface(optionalPath, 'Other', 'authentic-module-export'),
        ]),
      ],
      [
        candidate('shallow-importer'),
        {
          plan: {
            ...basePlan,
            shallowVisualPaths: [{ ...basePlan.shallowVisualPaths?.[0], importerPath: targetPath }],
          } as never,
        },
      ],
      [
        candidate('shallow-source'),
        {
          plan: {
            ...basePlan,
            shallowVisualPaths: [{ ...basePlan.shallowVisualPaths?.[0], sourcePath: targetPath }],
          } as never,
        },
      ],
      [candidate('critical-multiset', [...baseCriticalSurfaces, pageSurface])],
    ];
    for (const arguments_ of misses) await run(...arguments_);
    expect(memo.getClosureStatistics()).toEqual({
      closureComputations: 14,
      closureEntries: 14,
      closureHits: 3,
      closureRequests: 17,
      released: false,
    });
  });

  it('reuses rooted graphs, blocker-sensitive proposals, nodes, and dynamic resolutions across closure misses', async () => {
    const workspaceRoot = '/workspace';
    const routeAPath = '/workspace/RouteA.tsx';
    const routeCPath = '/workspace/RouteC.tsx';
    const optionalPath = '/workspace/Optional.tsx';
    const leftPath = '/workspace/Left.ts';
    const rightPath = '/workspace/Right.ts';
    const sharedPath = '/workspace/Shared.ts';
    const dynamicPath = '/workspace/Dynamic.tsx';
    const sources = new Map<string, string>([
      [routeAPath, 'export const RouteA = () => null;'],
      [routeCPath, 'export const RouteC = () => null;'],
      [
        optionalPath,
        [
          "import './Left';",
          "import './Right';",
          "void import('./Dynamic');",
          'export const Optional = () => null;',
        ].join('\n'),
      ],
      [leftPath, "import './Shared'; import 'large-package'; export const left = true;"],
      [rightPath, "import './Shared'; export const right = true;"],
      [sharedPath, 'export const shared = true;'],
      [dynamicPath, "import './Shared'; export default function Dynamic() { return null; }"],
    ]);
    const resolutions = new Map<string, string>([
      [`${optionalPath}\0./Left`, leftPath],
      [`${optionalPath}\0./Right`, rightPath],
      [`${optionalPath}\0./Dynamic`, dynamicPath],
      [`${leftPath}\0./Shared`, sharedPath],
      [`${rightPath}\0./Shared`, sharedPath],
      [`${dynamicPath}\0./Shared`, sharedPath],
    ]);
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const memo = createPreviewInspectorBundleSourceInventoryMemo();
    const cachedReads: string[] = [];
    const cachedResolutions: string[] = [];
    const candidate = (
      id: string,
      exactPath: string,
      exportName: string,
    ): PreviewInspectorPageExecutionCandidate =>
      ({
        browserCandidate: { id: 'browser' },
        compositionEdges: [],
        criticalSurfaces: [
          {
            bypassedWrapperNames: [],
            exportName,
            id: `${id}-critical`,
            omittedTopLevelEffectCount: 0,
            sourcePath: exactPath,
            strategy: 'authentic-module-export',
            watchSourcePaths: [exactPath],
          },
        ],
        evidenceSourcePaths: [],
        fidelity: 'target-contextual',
        id,
        optionalSurfaces: [
          {
            bypassedWrapperNames: [],
            exportName: 'Optional',
            id: `${id}-optional`,
            omittedTopLevelEffectCount: 0,
            sourcePath: optionalPath,
            strategy: 'selected-route-surface',
            watchSourcePaths: [optionalPath],
          },
        ],
        watchSourcePaths: [exactPath, optionalPath],
      }) as never;
    const run = (
      id: string,
      exactPath: string,
      exportName: string,
      sourceInventoryMemo: PreviewInspectorBundleSourceInventoryMemo | false,
      bundleDiagnostics?: ReturnType<typeof createPreviewInspectorBundleDiagnosticsCollector>,
    ): ReturnType<typeof preparePreviewInspectorBundleFrontier> =>
      preparePreviewInspectorBundleFrontier({
        executionCandidate: candidate(id, exactPath, exportName),
        plan: {
          edges: [],
          pageCandidates: [],
          root: { exportName, sourcePath: exactPath },
          target: { exportName, sourcePath: exactPath },
        } as never,
        policy,
        readSource: (sourcePath) => {
          if (sourceInventoryMemo !== false) cachedReads.push(sourcePath);
          return Promise.resolve(sources.get(sourcePath));
        },
        resolveModule: (specifier, importer) => {
          if (sourceInventoryMemo !== false) cachedResolutions.push(`${importer}\0${specifier}`);
          return resolutions.get(`${importer}\0${specifier}`);
        },
        ...(bundleDiagnostics === undefined ? {} : { bundleDiagnostics }),
        ...(sourceInventoryMemo === false ? {} : { sourceInventoryMemo }),
        workspaceRoot,
      });
    const routes = [
      ['route-a', routeAPath, 'RouteA'],
      ['route-blocking-shared', sharedPath, 'shared'],
      ['route-c', routeCPath, 'RouteC'],
    ] as const;
    const diagnostics = createPreviewInspectorBundleDiagnosticsCollector(true);
    if (diagnostics === undefined) throw new Error('Expected bundle diagnostics.');
    const cached = [];
    for (const [index, [id, exactPath, exportName]] of routes.entries()) {
      const uncached = await run(id, exactPath, exportName, false);
      const result = await run(
        id,
        exactPath,
        exportName,
        memo,
        index === routes.length - 1 ? diagnostics : undefined,
      );
      expect(JSON.stringify(result)).toBe(JSON.stringify(uncached));
      cached.push(result);
    }
    expect(new Set(cached.map((result) => result.frontier.identity)).size).toBe(3);
    expect(cached[0]?.frontier.sourceKinds?.[sharedPath]).toBe('optional-support');
    expect(cached[1]?.frontier.sourceKinds?.[sharedPath]).toBe('critical-surface');
    expect(cached[2]?.frontier.sourceKinds?.[sharedPath]).toBe('optional-support');
    expect(cached[0]?.frontier.packageDemandSourcePaths).toEqual([leftPath]);
    expect(cachedReads).toEqual([
      routeAPath,
      optionalPath,
      leftPath,
      rightPath,
      sharedPath,
      dynamicPath,
      routeCPath,
    ]);
    expect(cachedResolutions).toHaveLength(7);
    expect(memo.getClosureStatistics()).toEqual({
      closureComputations: 3,
      closureEntries: 3,
      closureHits: 0,
      closureRequests: 3,
      released: false,
    });
    expect(memo.getGraphStatistics()).toEqual({
      dynamicResolutionComputations: 1,
      dynamicResolutionEntries: 1,
      dynamicResolutionHits: 2,
      dynamicResolutionRequests: 3,
      proposalComputations: 3,
      proposalEntries: 3,
      proposalHits: 3,
      proposalRequests: 6,
      released: false,
      resolvedNodeComputations: 7,
      resolvedNodeEntries: 7,
      resolvedNodeHits: 1,
      resolvedNodeRequests: 8,
      rootedGraphComputations: 2,
      rootedGraphEntries: 2,
      rootedGraphHits: 4,
      rootedGraphRequests: 6,
    });
    expect(diagnostics.snapshot()).toMatchObject({
      edgeVisitCount: 0,
      frontierCount: 1,
      inventoryComputationCount: 1,
      inventoryReadRequestCount: 1,
      optionalClosureProbeCount: 2,
      rawSourceReadCount: 1,
      resolveModuleCount: 0,
    });
  });

  it('coalesces and retries every graph cache layer and blocks late publication after release', async () => {
    const memo = createPreviewInspectorBundleSourceInventoryMemo();
    const node = Object.freeze({
      byteLength: 1,
      edges: Object.freeze([]),
      representationKey: 'node-representation',
      sourcePath: '/workspace/Node.ts',
      staticEdges: Object.freeze([]),
    });
    const graph = Object.freeze({
      entries: Object.freeze([
        Object.freeze({
          node,
          representationKey: node.representationKey,
          sourcePath: node.sourcePath,
        }),
      ]),
      identity: 'rooted-graph',
      reachableSourcePaths: Object.freeze([node.sourcePath]),
      rootRepresentationKey: node.representationKey,
      rootSourcePath: node.sourcePath,
    });
    const proposal = Object.freeze({
      authoredEdgeCount: 0,
      packageDemandPaths: Object.freeze([]),
      sourceBytes: 1,
      sourcePaths: Object.freeze([node.sourcePath]),
      supportPaths: Object.freeze([]),
    });
    let continuePending!: () => void;
    const gate = new Promise<void>((resolve) => {
      continuePending = resolve;
    });
    const nodeCompute = vi.fn(async () => {
      await gate;
      return node;
    });
    const firstNode = memo.collectResolvedSourceNode('node', nodeCompute);
    const secondNode = memo.collectResolvedSourceNode('node', nodeCompute);
    const firstGraph = memo.collectRootedOptionalGraph(
      'root',
      'context',
      () => true,
      async () => {
        await gate;
        return graph;
      },
    );
    const secondGraph = memo.collectRootedOptionalGraph(
      'root',
      'context',
      () => true,
      () => Promise.resolve(graph),
    );
    const firstProposal = memo.collectOptionalProposal('proposal', async () => {
      await gate;
      return proposal;
    });
    const secondProposal = memo.collectOptionalProposal('proposal', () =>
      Promise.resolve(proposal),
    );
    continuePending();
    expect(await secondNode).toBe(await firstNode);
    expect(await secondGraph).toBe(await firstGraph);
    expect(await secondProposal).toBe(await firstProposal);
    expect(nodeCompute).toHaveBeenCalledTimes(1);

    await expect(
      memo.collectResolvedSourceNode('retry-node', () =>
        Promise.reject(new Error('node-cancelled')),
      ),
    ).rejects.toThrow('node-cancelled');
    await expect(
      memo.collectResolvedSourceNode('retry-node', () => Promise.resolve(node)),
    ).resolves.toBe(node);
    await expect(
      memo.collectRootedOptionalGraph(
        'retry-root',
        'context',
        () => true,
        () => Promise.reject(new Error('graph-cancelled')),
      ),
    ).rejects.toThrow('graph-cancelled');
    await expect(
      memo.collectRootedOptionalGraph(
        'retry-root',
        'context',
        () => true,
        () => Promise.resolve(graph),
      ),
    ).resolves.toBe(graph);
    await expect(
      memo.collectOptionalProposal('retry-proposal', () =>
        Promise.reject(new Error('proposal-cancelled')),
      ),
    ).rejects.toThrow('proposal-cancelled');
    await expect(
      memo.collectOptionalProposal('retry-proposal', () => Promise.resolve(proposal)),
    ).resolves.toBe(proposal);
    expect(
      memo.collectDynamicResolution('dynamic', () => ({ targetPath: node.sourcePath })),
    ).toEqual({ targetPath: node.sourcePath });
    expect(memo.collectDynamicResolution('dynamic', () => ({}))).toEqual({
      targetPath: node.sourcePath,
    });
    expect(memo.getGraphStatistics()).toEqual({
      dynamicResolutionComputations: 1,
      dynamicResolutionEntries: 1,
      dynamicResolutionHits: 1,
      dynamicResolutionRequests: 2,
      proposalComputations: 3,
      proposalEntries: 2,
      proposalHits: 1,
      proposalRequests: 4,
      released: false,
      resolvedNodeComputations: 3,
      resolvedNodeEntries: 2,
      resolvedNodeHits: 1,
      resolvedNodeRequests: 4,
      rootedGraphComputations: 3,
      rootedGraphEntries: 2,
      rootedGraphHits: 1,
      rootedGraphRequests: 4,
    });

    const releasedMemo = createPreviewInspectorBundleSourceInventoryMemo();
    let finishReleased!: () => void;
    const releasedGate = new Promise<void>((resolve) => {
      finishReleased = resolve;
    });
    const pendingNode = releasedMemo.collectResolvedSourceNode('late-node', async () => {
      await releasedGate;
      return node;
    });
    const pendingGraph = releasedMemo.collectRootedOptionalGraph(
      'late-root',
      'context',
      () => true,
      async () => {
        await releasedGate;
        return graph;
      },
    );
    const pendingProposal = releasedMemo.collectOptionalProposal('late-proposal', async () => {
      await releasedGate;
      return proposal;
    });
    releasedMemo.release();
    releasedMemo.release();
    finishReleased();
    await expect(pendingNode).resolves.toBe(node);
    await expect(pendingGraph).resolves.toBe(graph);
    await expect(pendingProposal).resolves.toBe(proposal);
    expect(releasedMemo.getGraphStatistics()).toMatchObject({
      dynamicResolutionEntries: 0,
      proposalEntries: 0,
      released: true,
      resolvedNodeEntries: 0,
      rootedGraphEntries: 0,
    });
    await expect(
      releasedMemo.collectResolvedSourceNode('after-release', () => Promise.resolve(node)),
    ).rejects.toThrow('memo was already released');
    expect(() => releasedMemo.collectDynamicResolution('after-release', () => ({}))).toThrow(
      'memo was already released',
    );
  });

  it('isolates authentic, selected, local-wrapper, and multi-slice resolved representations', async () => {
    const sourcePath = '/workspace/Page.tsx';
    const sourceText = [
      'const Inner = () => null;',
      'const Other = () => null;',
      'export const Page = Inner;',
      'export const OtherPage = Other;',
    ].join('\n');
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const memo = createPreviewInspectorBundleSourceInventoryMemo();
    let reads = 0;
    const surface = (
      id: string,
      exportName: string,
      strategy: 'authentic-module-export' | 'inner-local-component-slice' | 'selected-export-slice',
      localName?: string,
      preservedWrapperKinds: readonly ('forward-ref' | 'memo' | 'styled')[] = [],
    ): PreviewInspectorPageExecutionCandidate['criticalSurfaces'][number] => ({
      bypassedWrapperNames: [],
      exportName,
      id,
      ...(localName === undefined ? {} : { localName }),
      omittedTopLevelEffectCount: 0,
      preservedWrapperKinds,
      sourcePath,
      strategy,
      watchSourcePaths: [sourcePath],
    });
    const shapes = [
      [surface('authentic', 'Page', 'authentic-module-export')],
      [surface('selected-page', 'Page', 'selected-export-slice')],
      [surface('selected-other', 'OtherPage', 'selected-export-slice')],
      [surface('local', 'Page', 'inner-local-component-slice', 'Inner')],
      [
        surface('local-wrappers', 'Page', 'inner-local-component-slice', 'Inner', [
          'memo',
          'styled',
        ]),
      ],
      [
        surface('local-reordered', 'Page', 'inner-local-component-slice', 'Inner', [
          'styled',
          'memo',
        ]),
      ],
      [
        surface('multi-page', 'Page', 'selected-export-slice'),
        surface('multi-other', 'OtherPage', 'selected-export-slice'),
      ],
    ] as const;
    const results = [];
    for (const [index, criticalSurfaces] of shapes.entries()) {
      results.push(
        await preparePreviewInspectorBundleFrontier({
          executionCandidate: {
            browserCandidate: { id: 'browser' },
            compositionEdges: [],
            criticalSurfaces,
            evidenceSourcePaths: [],
            fidelity: 'page-sliced',
            id: `representation-${index.toString()}`,
            optionalSurfaces: [],
            watchSourcePaths: [sourcePath],
          } as never,
          plan: {
            edges: [],
            pageCandidates: [],
            root: { exportName: 'Page', sourcePath },
            target: { exportName: 'Page', sourcePath },
          } as never,
          policy,
          readSource: () => {
            reads += 1;
            return Promise.resolve(sourceText);
          },
          resolveModule: () => undefined,
          sourceInventoryMemo: memo,
          workspaceRoot: '/workspace',
        }),
      );
    }
    expect(reads).toBe(shapes.length);
    expect(results.slice(0, -1).every((result) => !result.rejected)).toBe(true);
    expect(results.at(-1)).toMatchObject({
      frontier: { summary: { truncationReasons: ['slice-unavailable'] } },
      rejected: true,
    });
    expect(memo.getGraphStatistics()).toMatchObject({
      resolvedNodeComputations: shapes.length,
      resolvedNodeEntries: shapes.length,
      resolvedNodeHits: 0,
      resolvedNodeRequests: shapes.length,
    });
    expect(memo.getSliceStatistics()).toMatchObject({
      sliceComputations: 5,
      sliceEntries: 5,
      sliceHits: 0,
      sliceRequests: 5,
    });
  });

  it('keeps a cached structural failure invisible behind the current relevant blocker', async () => {
    const rootPath = '/workspace/Root.ts';
    const blockerPath = '/workspace/Blocker.ts';
    const failedPath = '/workspace/Failed.ts';
    const edge = (identity: string, targetPath: string): PreviewInspectorBundleResolvedStaticEdge =>
      Object.freeze({ identity, kind: 'authored' as const, targetPath });
    const nodes = new Map<string, PreviewInspectorBundleResolvedSourceNode>([
      [
        rootPath,
        Object.freeze({
          byteLength: 1,
          edges: Object.freeze([]),
          representationKey: rootPath,
          sourcePath: rootPath,
          staticEdges: Object.freeze([edge('root-blocker', blockerPath)]),
        }),
      ],
      [
        blockerPath,
        Object.freeze({
          byteLength: 1,
          edges: Object.freeze([]),
          representationKey: blockerPath,
          sourcePath: blockerPath,
          staticEdges: Object.freeze([edge('blocker-failed', failedPath)]),
        }),
      ],
      [
        failedPath,
        Object.freeze({
          byteLength: 0,
          edges: Object.freeze([]),
          failure: 'exact-source-unreadable' as const,
          representationKey: failedPath,
          sourcePath: failedPath,
          staticEdges: Object.freeze([]),
        }),
      ],
    ]);
    const memo = createPreviewInspectorBundleSourceInventoryMemo();
    const readNode = vi.fn(
      (sourcePath: string): Promise<PreviewInspectorBundleResolvedSourceNode> => {
        const node = nodes.get(sourcePath);
        return node === undefined
          ? Promise.reject(new Error(`Missing node fixture: ${sourcePath}`))
          : Promise.resolve(node);
      },
    );
    const collect = (
      blockedSourcePaths: ReadonlySet<string>,
    ): ReturnType<typeof collectPreviewInspectorBundleOptionalClosure> =>
      collectPreviewInspectorBundleOptionalClosure({
        blockedSourcePaths,
        diagnostics: undefined,
        getRepresentationKey: (sourcePath) => sourcePath,
        memo,
        pendingContextKey: 'context',
        readNode,
        rootPath,
      });
    const blocked = await collect(new Set([blockerPath]));
    expect(blocked.proposal).toEqual({
      authoredEdgeCount: 1,
      packageDemandPaths: [],
      sourceBytes: 1,
      sourcePaths: [rootPath],
      supportPaths: [],
    });
    expect(Object.isFrozen(blocked.graph)).toBe(true);
    expect(Object.isFrozen(blocked.proposal)).toBe(true);
    expect((await collect(new Set())).proposal).toBe('exact-source-unreadable');
    expect((await collect(new Set())).proposal).toBe('exact-source-unreadable');
    expect(readNode).toHaveBeenCalledTimes(3);
    expect(memo.getGraphStatistics()).toMatchObject({
      proposalComputations: 2,
      proposalEntries: 2,
      proposalHits: 1,
      proposalRequests: 3,
      rootedGraphComputations: 1,
      rootedGraphEntries: 1,
      rootedGraphHits: 2,
      rootedGraphRequests: 3,
    });
  });

  it('coalesces pending closure work, retries errors, and cannot publish after release', async () => {
    const memo = createPreviewInspectorBundleSourceInventoryMemo();
    const template = Object.freeze({ marker: 'template' });
    let continuePending!: () => void;
    const gate = new Promise<void>((resolve) => {
      continuePending = resolve;
    });
    let computations = 0;
    const compute = async (): Promise<never> => {
      computations += 1;
      await gate;
      return template as never;
    };
    const first = memo.collectSourceClosure('pending', compute);
    const second = memo.collectSourceClosure('pending', compute);
    expect(computations).toBe(1);
    expect(memo.getClosureStatistics()).toEqual({
      closureComputations: 1,
      closureEntries: 0,
      closureHits: 1,
      closureRequests: 2,
      released: false,
    });
    continuePending();
    expect(await second).toBe(await first);
    expect(memo.getClosureStatistics().closureEntries).toBe(1);

    let attempts = 0;
    await expect(
      memo.collectSourceClosure('retry', () => {
        attempts += 1;
        return Promise.reject(new Error('cancelled computation'));
      }),
    ).rejects.toThrow('cancelled computation');
    await expect(
      memo.collectSourceClosure('retry', () => {
        attempts += 1;
        return Promise.resolve(template as never);
      }),
    ).resolves.toBe(template);
    expect(attempts).toBe(2);
    expect(memo.getClosureStatistics()).toEqual({
      closureComputations: 3,
      closureEntries: 2,
      closureHits: 1,
      closureRequests: 4,
      released: false,
    });

    const releasedMemo = createPreviewInspectorBundleSourceInventoryMemo();
    let finishReleased!: () => void;
    const releasedGate = new Promise<void>((resolve) => {
      finishReleased = resolve;
    });
    const pending = releasedMemo.collectSourceClosure('released', async () => {
      await releasedGate;
      return template as never;
    });
    releasedMemo.release();
    releasedMemo.release();
    finishReleased();
    await expect(pending).resolves.toBe(template);
    expect(releasedMemo.getClosureStatistics()).toEqual({
      closureComputations: 1,
      closureEntries: 0,
      closureHits: 0,
      closureRequests: 1,
      released: true,
    });
    await expect(releasedMemo.collectSourceClosure('released', compute)).rejects.toThrow(
      'memo was already released',
    );
  });

  it('reuses a structural rejection but materializes each current candidate', async () => {
    const sourcePath = '/workspace/Missing.tsx';
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const memo = createPreviewInspectorBundleSourceInventoryMemo();
    let reads = 0;
    const run = (id: string): ReturnType<typeof preparePreviewInspectorBundleFrontier> =>
      preparePreviewInspectorBundleFrontier({
        executionCandidate: {
          browserCandidate: { id: 'browser' },
          compositionEdges: [],
          criticalSurfaces: [
            {
              bypassedWrapperNames: [],
              exportName: 'Missing',
              id: 'surface',
              omittedTopLevelEffectCount: 0,
              sourcePath,
              strategy: 'authentic-module-export',
              watchSourcePaths: [sourcePath],
            },
          ],
          evidenceSourcePaths: [],
          fidelity: 'target-only',
          id,
          optionalSurfaces: [],
          watchSourcePaths: [],
        } as never,
        plan: {
          edges: [],
          pageCandidates: [],
          root: { exportName: 'Missing', sourcePath },
          target: { exportName: 'Missing', sourcePath },
        } as never,
        policy,
        readSource: () => {
          reads += 1;
          return Promise.resolve(undefined);
        },
        resolveModule: () => undefined,
        sourceInventoryMemo: memo,
        workspaceRoot: '/workspace',
      });
    const first = await run('first-rejection');
    const second = await run('second-rejection');
    expect(first.rejected).toBe(true);
    expect(JSON.stringify(first.frontier.summary)).toBe(JSON.stringify(second.frontier.summary));
    expect(second.frontier.executionCandidateId).toBe('second-rejection');
    expect(second.frontier.identity).not.toBe(first.frontier.identity);
    expect(reads).toBe(1);
    expect(memo.getClosureStatistics()).toEqual({
      closureComputations: 1,
      closureEntries: 1,
      closureHits: 1,
      closureRequests: 2,
      released: false,
    });
  });

  it('shares an exact source parse failure without changing its rejection', async () => {
    const sourcePath = '/workspace/Target.tsx';
    const sourceText = 'export const Target = ;';
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const memo = createPreviewInspectorBundleSourceInventoryMemo();
    const run = (): ReturnType<typeof preparePreviewInspectorBundleFrontier> =>
      preparePreviewInspectorBundleFrontier({
        plan: {
          edges: [],
          pageCandidates: [],
          root: { exportName: 'Target', sourcePath },
          target: { exportName: 'Target', sourcePath },
        } as unknown as PreviewInspectorAncestorPlan,
        policy,
        readSource: () => Promise.resolve(sourceText),
        resolveModule: () => undefined,
        sourceInventoryMemo: memo,
        workspaceRoot: '/workspace',
      });

    const first = await run();
    const second = await run();
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first).toMatchObject({
      frontier: { summary: { truncationReasons: ['source-parse-failure'] } },
      rejected: true,
    });
    expect(memo.getStatistics()).toEqual({
      computations: 1,
      entries: 1,
      hits: 1,
      released: false,
      requests: 2,
    });
  });
});

/** Creates the minimal ancestor plan used by authored-representation dominance fixtures. */
function createRepresentationDominancePlan(appPath: string): PreviewInspectorAncestorPlan {
  return {
    edges: [],
    pageCandidates: [],
    root: { exportName: 'SlicedPage', sourcePath: appPath },
    target: { exportName: 'AuthenticTarget', sourcePath: appPath },
  } as unknown as PreviewInspectorAncestorPlan;
}

/** Creates sliced and optionally authored representations of one synthetic page module. */
function createRepresentationDominanceCandidate(
  appPath: string,
  includesAuthenticSurface: boolean,
  includesOptionalSurface = false,
): PreviewInspectorPageExecutionCandidate {
  return {
    browserCandidate: { id: 'selected' },
    compositionEdges: [],
    criticalSurfaces: [
      {
        bypassedWrapperNames: [],
        exportName: 'SlicedPage',
        id: 'sliced-page',
        omittedTopLevelEffectCount: 0,
        sourcePath: appPath,
        strategy: 'selected-export-slice',
        watchSourcePaths: [appPath],
      },
      ...(includesAuthenticSurface
        ? [
            {
              bypassedWrapperNames: [],
              exportName: 'AuthenticTarget',
              id: 'authentic-target',
              omittedTopLevelEffectCount: 0,
              sourcePath: appPath,
              strategy: 'authentic-module-export',
              watchSourcePaths: [appPath],
            },
          ]
        : []),
    ],
    evidenceSourcePaths: [],
    fidelity: 'page-sliced',
    id: 'candidate',
    optionalSurfaces: includesOptionalSurface
      ? [
          {
            bypassedWrapperNames: [],
            exportName: 'OptionalPage',
            id: 'optional-page',
            omittedTopLevelEffectCount: 0,
            sourcePath: appPath,
            strategy: 'selected-route-surface',
            watchSourcePaths: [appPath],
          },
        ]
      : [],
    watchSourcePaths: [appPath],
  } as never;
}
