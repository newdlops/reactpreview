import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPreviewCompilerFrontierPolicy } from '../../../../src/domain/previewCompilerFrontier';
import { preparePreviewInspectorBundleFrontier } from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleFrontier';
import type { PreviewInspectorAncestorPlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorAncestorPlan';
import type { PreviewInspectorPageExecutionCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionTypes';

describe('preparePreviewInspectorBundleFrontier', () => {
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
    const sources = new Map<string, string>([
      [targetPath, 'export const Target = () => null;'],
      [
        optionalPath,
        "import { helper } from './optional-helper'; export default function Optional() { return helper; }",
      ],
      [helperPath, 'export const helper = null;'],
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
        specifier === './optional-helper' && importer === optionalPath ? helperPath : undefined,
      workspaceRoot,
    });

    expect(result.rejected).toBe(false);
    expect(result.frontier.version).toBe(2);
    expect(result.frontier.sourceKinds?.[optionalPath]).toBe('optional-surface');
    expect(result.frontier.sourceKinds?.[helperPath]).toBe('optional-support');
    expect(result.frontier.summary.optionalComponentCount).toBe(1);
    expect(result.frontier.summary.supportModuleCount).toBe(1);
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
