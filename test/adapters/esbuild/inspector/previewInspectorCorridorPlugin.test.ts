/** Verifies that Page Inspector bundles only dynamically imported branches on its proven path. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build, type Plugin } from 'esbuild';
import { describe, expect, it } from 'vitest';
import {
  createPreviewInspectorCorridorPlugin,
  type PreviewInspectorAncestorPlan,
} from '../../../../src/adapters/esbuild/inspector';
import { createPreviewStaticModuleResolver } from '../../../../src/adapters/esbuild/previewStaticModuleResolver';
import { PREVIEW_RESOLVE_GUARD } from '../../../../src/adapters/esbuild/previewPluginProtocol';

/** Keeps a selected lazy page while replacing an unrelated sibling route with an inert module. */
describe('createPreviewInspectorCorridorPlugin', () => {
  it('omits only project dynamic imports outside the proven page corridor', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-corridor-'));
    const entryPath = path.join(workspaceRoot, 'src', 'entry.ts');
    const selectedPath = path.join(workspaceRoot, 'src', 'Selected.ts');
    const unrelatedPath = path.join(workspaceRoot, 'src', 'Unrelated.ts');
    await mkdir(path.dirname(entryPath), { recursive: true });
    await Promise.all([
      writeFile(
        entryPath,
        [
          `export const selected = () => import('./Selected');`,
          `export const unrelated = () => import('./Unrelated');`,
        ].join('\n'),
      ),
      writeFile(selectedPath, `export default 'SELECTED_CORRIDOR_MARKER';`),
      writeFile(unrelatedPath, `export default 'UNRELATED_ROUTE_MARKER';`),
    ]);
    const plan = createCorridorPlan(entryPath, selectedPath);
    const resolver = createPreviewStaticModuleResolver({ workspaceRoot });

    const result = await build({
      absWorkingDir: workspaceRoot,
      bundle: true,
      entryPoints: [entryPath],
      format: 'esm',
      outdir: path.join(workspaceRoot, 'out'),
      plugins: [
        createPreviewInspectorCorridorPlugin({
          plan,
          projectRoot: workspaceRoot,
          resolveModule: resolver.resolve,
          workspaceRoot,
        }),
      ],
      splitting: true,
      write: false,
    });
    const source = result.outputFiles.map((outputFile) => outputFile.text).join('\n');

    expect(source).toContain('SELECTED_CORRIDOR_MARKER');
    expect(source).not.toContain('UNRELATED_ROUTE_MARKER');
    expect(source).toContain('ReactPreviewDeferredCorridorRoute');
    expect(result.outputFiles).toHaveLength(3);
    await expect(readFile(unrelatedPath, 'utf8')).resolves.toContain('UNRELATED_ROUTE_MARKER');
  });

  /** Prunes a deferred route declared in a statically reached manifest outside direct path evidence. */
  it('prunes project lazy branches even when their importer is not a render-chain step', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-corridor-'));
    const entryPath = path.join(workspaceRoot, 'src', 'entry.ts');
    const manifestPath = path.join(workspaceRoot, 'src', 'routes.ts');
    const selectedPath = path.join(workspaceRoot, 'src', 'Selected.ts');
    const unrelatedPath = path.join(workspaceRoot, 'src', 'Unrelated.ts');
    await mkdir(path.dirname(entryPath), { recursive: true });
    await Promise.all([
      writeFile(entryPath, `export { routes } from './routes';`),
      writeFile(
        manifestPath,
        `export const routes = [() => import('./Selected'), () => import('./Unrelated')];`,
      ),
      writeFile(selectedPath, `export default 'SELECTED_CORRIDOR_MARKER';`),
      writeFile(unrelatedPath, `export default 'UNRELATED_ROUTE_MARKER';`),
    ]);

    const result = await build({
      absWorkingDir: workspaceRoot,
      bundle: true,
      entryPoints: [entryPath],
      format: 'esm',
      outdir: path.join(workspaceRoot, 'out'),
      plugins: [
        createPreviewInspectorCorridorPlugin({
          plan: createCorridorPlan(entryPath, selectedPath),
          projectRoot: workspaceRoot,
          resolveModule: createPreviewStaticModuleResolver({ workspaceRoot }).resolve,
          workspaceRoot,
        }),
      ],
      splitting: true,
      write: false,
    });
    const source = result.outputFiles.map((outputFile) => outputFile.text).join('\n');

    expect(source).toContain('SELECTED_CORRIDOR_MARKER');
    expect(source).not.toContain('UNRELATED_ROUTE_MARKER');
    expect(source).toContain('ReactPreviewDeferredCorridorRoute');
  });

  /** Retains a `next/dynamic` component visibly rendered by the selected page, including named loaders. */
  it('keeps page-local rendered next/dynamic modules while pruning registry-only siblings', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-corridor-'));
    const entryPath = path.join(workspaceRoot, 'src', 'entry.ts');
    const pagePath = path.join(workspaceRoot, 'src', 'Page.tsx');
    const welcomePath = path.join(workspaceRoot, 'src', 'Welcome.ts');
    const registryPath = path.join(workspaceRoot, 'src', 'RegistryOnly.ts');
    await mkdir(path.dirname(entryPath), { recursive: true });
    await Promise.all([
      writeFile(entryPath, `export { default } from './Page';`),
      writeFile(
        pagePath,
        [
          `import dynamic from 'next/dynamic';`,
          `const Welcome = dynamic(() => import('./Welcome').then((module) => module.Welcome));`,
          `export const RegistryOnly = dynamic(() => import('./RegistryOnly'));`,
          `export default function Page() { return <Welcome />; }`,
        ].join('\n'),
      ),
      writeFile(welcomePath, `export const Welcome = () => 'RENDERED_DYNAMIC_MARKER';`),
      writeFile(registryPath, `export default 'REGISTRY_ONLY_MARKER';`),
    ]);

    const result = await build({
      absWorkingDir: workspaceRoot,
      bundle: true,
      entryPoints: [entryPath],
      external: ['next/dynamic', 'react/jsx-runtime'],
      format: 'esm',
      jsx: 'automatic',
      outdir: path.join(workspaceRoot, 'out'),
      plugins: [
        createPreviewInspectorCorridorPlugin({
          plan: createCorridorPlan(entryPath, pagePath),
          projectRoot: workspaceRoot,
          resolveModule: createPreviewStaticModuleResolver({ workspaceRoot }).resolve,
          workspaceRoot,
        }),
      ],
      splitting: true,
      write: false,
    });
    const source = result.outputFiles.map((outputFile) => outputFile.text).join('\n');

    expect(source).toContain('RENDERED_DYNAMIC_MARKER');
    expect(source).not.toContain('REGISTRY_ONLY_MARKER');
    expect(source).toContain('ReactPreviewDeferredCorridorRoute');
  });

  /**
   * Preserves a small API loader, then narrows its generated registry to the exact App Router
   * parameter tuple. Every omitted branch shares one module so split output remains bounded.
   */
  it('narrows broad lazy registries with selected Next route parameters', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-corridor-'));
    const sourceRoot = path.join(workspaceRoot, 'src');
    const entryPath = path.join(sourceRoot, 'entry.ts');
    const pagePath = path.join(sourceRoot, 'Page.ts');
    const helperPath = path.join(sourceRoot, 'helper.ts');
    const indexPath = path.join(sourceRoot, 'Index.ts');
    const registryPath = path.join(sourceRoot, 'Registry.ts');
    const selectedPath = path.join(sourceRoot, 'base', 'preview', 'index.ts');
    await Promise.all([
      mkdir(sourceRoot, { recursive: true }),
      mkdir(path.dirname(selectedPath), { recursive: true }),
    ]);
    const unrelatedBranches = Array.from({ length: 30 }, (_, index) => ({
      path: path.join(sourceRoot, `route-${index.toString()}.ts`),
      specifier: `./route-${index.toString()}`,
    }));
    await Promise.all([
      writeFile(entryPath, `export { default } from './Page';`),
      writeFile(
        pagePath,
        [
          `import { loadIndex, loadRegistry } from './helper';`,
          `export const pending = Promise.all([loadIndex(), loadRegistry()]);`,
          `export default 'PAGE_MARKER';`,
        ].join('\n'),
      ),
      writeFile(
        helperPath,
        [
          `export const loadIndex = () => import('./Index');`,
          `export const loadRegistry = () => import('./Registry');`,
        ].join('\n'),
      ),
      writeFile(indexPath, `export const Index = 'SMALL_HELPER_IMPORT_MARKER';`),
      writeFile(
        registryPath,
        `export const routes = [${[
          ...unrelatedBranches.map(({ specifier }) => `() => import('${specifier}')`),
          `() => import('./base/preview/index')`,
        ].join(',')}];`,
      ),
      writeFile(selectedPath, `export default 'ROUTE_SELECTED_MARKER';`),
      ...unrelatedBranches.map(({ path: branchPath }, index) =>
        writeFile(branchPath, `export default 'UNRELATED_ROUTE_${index.toString()}';`),
      ),
    ]);

    const result = await build({
      absWorkingDir: workspaceRoot,
      bundle: true,
      entryPoints: [entryPath],
      format: 'esm',
      outdir: path.join(workspaceRoot, 'out'),
      plugins: [
        createPreviewInspectorCorridorPlugin({
          plan: createCorridorPlan(entryPath, pagePath, { base: 'base', name: 'preview' }),
          projectRoot: workspaceRoot,
          resolveModule: createPreviewStaticModuleResolver({ workspaceRoot }).resolve,
          workspaceRoot,
        }),
      ],
      splitting: true,
      write: false,
    });
    const source = result.outputFiles.map((outputFile) => outputFile.text).join('\n');

    expect(source).toContain('SMALL_HELPER_IMPORT_MARKER');
    expect(source).toContain('ROUTE_SELECTED_MARKER');
    expect(source).not.toContain('UNRELATED_ROUTE_0');
    expect(source.match(/function ReactPreviewDeferredCorridorRoute/g)?.length).toBe(1);
    expect(result.outputFiles.length).toBeLessThanOrEqual(6);
  });

  /** Leaves nested compiler resolver probes untouched so theme/setup bridge resolution stays local. */
  it('does not intercept guarded internal dynamic resolution', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-corridor-'));
    const entryPath = path.join(workspaceRoot, 'src', 'entry.ts');
    const selectedPath = path.join(workspaceRoot, 'src', 'Selected.ts');
    const internalPath = path.join(workspaceRoot, 'src', 'InternalTheme.ts');
    await mkdir(path.dirname(entryPath), { recursive: true });
    await Promise.all([
      writeFile(entryPath, `import value from 'preview:guarded'; globalThis.value = value;`),
      writeFile(selectedPath, `export default 'SELECTED_CORRIDOR_MARKER';`),
      writeFile(internalPath, `export default 'INTERNAL_THEME_MARKER';`),
    ]);
    const guardedResolver: Plugin = {
      name: 'guarded-resolver-fixture',
      setup(buildApi): void {
        buildApi.onResolve({ filter: /^preview:guarded$/ }, async (arguments_) => {
          return await buildApi.resolve('./InternalTheme', {
            importer: arguments_.importer,
            kind: 'dynamic-import',
            pluginData: PREVIEW_RESOLVE_GUARD,
            resolveDir: arguments_.resolveDir,
          });
        });
      },
    };

    const result = await build({
      absWorkingDir: workspaceRoot,
      bundle: true,
      entryPoints: [entryPath],
      format: 'esm',
      outdir: path.join(workspaceRoot, 'out'),
      plugins: [
        guardedResolver,
        createPreviewInspectorCorridorPlugin({
          plan: createCorridorPlan(entryPath, selectedPath),
          projectRoot: workspaceRoot,
          resolveModule: createPreviewStaticModuleResolver({ workspaceRoot }).resolve,
          workspaceRoot,
        }),
      ],
      write: false,
    });

    expect(result.outputFiles.map((outputFile) => outputFile.text).join('\n')).toContain(
      'INTERNAL_THEME_MARKER',
    );
  });

  /** Keeps pruning when a shared-package target is mounted by a sibling application package. */
  it('applies a module page corridor across monorepo package roots', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-corridor-'));
    const projectRoot = path.join(workspaceRoot, 'packages', 'shared');
    const appRoot = path.join(workspaceRoot, 'apps', 'site');
    const entryPath = path.join(appRoot, 'entry.ts');
    const selectedPath = path.join(appRoot, 'Selected.ts');
    const unrelatedPath = path.join(appRoot, 'Unrelated.ts');
    const contextModulePath = path.join(projectRoot, 'registry.ts');
    await Promise.all([
      mkdir(projectRoot, { recursive: true }),
      mkdir(appRoot, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        entryPath,
        [
          `export const selected = () => import('./Selected');`,
          `export const unrelated = () => import('./Unrelated');`,
        ].join('\n'),
      ),
      writeFile(selectedPath, `export default 'CROSS_PACKAGE_SELECTED';`),
      writeFile(unrelatedPath, `export default 'CROSS_PACKAGE_UNRELATED';`),
      writeFile(contextModulePath, `export const registry = {};`),
    ]);
    const ordinaryPlan = createCorridorPlan(entryPath, selectedPath);
    const plan: PreviewInspectorAncestorPlan = {
      ...ordinaryPlan,
      contextModule: {
        evidenceKind: 'import-chain',
        importPath: [entryPath, contextModulePath],
        sourcePath: contextModulePath,
      },
    };

    const result = await build({
      absWorkingDir: workspaceRoot,
      bundle: true,
      entryPoints: [entryPath],
      format: 'esm',
      outdir: path.join(workspaceRoot, 'out'),
      plugins: [
        createPreviewInspectorCorridorPlugin({
          plan,
          projectRoot,
          resolveModule: createPreviewStaticModuleResolver({ workspaceRoot }).resolve,
          workspaceRoot,
        }),
      ],
      splitting: true,
      write: false,
    });
    const source = result.outputFiles.map((outputFile) => outputFile.text).join('\n');

    expect(source).toContain('CROSS_PACKAGE_SELECTED');
    expect(source).not.toContain('CROSS_PACKAGE_UNRELATED');
    expect(source).toContain('ReactPreviewDeferredCorridorRoute');
  });

  /** Coalesces unresolved generated aliases instead of letting a broad registry fail the build. */
  it('omits unresolved branches from a broad generated registry', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-corridor-'));
    const entryPath = path.join(workspaceRoot, 'src', 'entry.ts');
    const selectedPath = path.join(workspaceRoot, 'src', 'Selected.ts');
    await mkdir(path.dirname(entryPath), { recursive: true });
    await Promise.all([
      writeFile(
        entryPath,
        `export const routes = [${Array.from(
          { length: 30 },
          (_, index) => `() => import('@generated/missing-${index.toString()}')`,
        ).join(',')}];`,
      ),
      writeFile(selectedPath, `export default 'SELECTED';`),
    ]);

    const result = await build({
      absWorkingDir: workspaceRoot,
      bundle: true,
      entryPoints: [entryPath],
      format: 'esm',
      outdir: path.join(workspaceRoot, 'out'),
      plugins: [
        createPreviewInspectorCorridorPlugin({
          plan: createCorridorPlan(entryPath, selectedPath),
          projectRoot: workspaceRoot,
          resolveModule: createPreviewStaticModuleResolver({ workspaceRoot }).resolve,
          workspaceRoot,
        }),
      ],
      splitting: true,
      write: false,
    });

    expect(result.outputFiles.map((outputFile) => outputFile.text).join('\n')).toContain(
      'ReactPreviewDeferredCorridorRoute',
    );
  });
});

/** Creates the minimum immutable plan whose entry and selected module form the allowed corridor. */
function createCorridorPlan(
  entryPath: string,
  selectedPath: string,
  routeParams?: Readonly<Record<string, string>>,
): PreviewInspectorAncestorPlan {
  const target = { exportName: 'default', sourcePath: selectedPath };
  const renderPath = {
    entryPoint: {
      kind: 'create-root' as const,
      occurrenceStart: 0,
      sourcePath: entryPath,
      wrapperNames: [],
    },
    id: 'selected-path',
    steps: [
      {
        certainty: 'confirmed' as const,
        kind: 'react-lazy' as const,
        label: 'Selected',
        occurrenceStart: 0,
        sourcePath: selectedPath,
        wrapperNames: [],
      },
      {
        certainty: 'confirmed' as const,
        kind: 'entry-render' as const,
        label: 'entry',
        occurrenceStart: 0,
        sourcePath: entryPath,
        wrapperNames: [],
      },
    ],
  };
  const renderChain = {
    dependencyPaths: [entryPath, selectedPath],
    paths: [renderPath],
    reachability: 'entry-connected' as const,
    target,
    truncated: false,
  };
  const pageCandidate = {
    complete: true,
    dependencyPaths: [entryPath, selectedPath],
    edges: [],
    id: 'candidate-selected',
    renderPath,
    root: target,
    rootAutomaticProps: {},
    rootOwnsRouter: false,
    ...(routeParams === undefined
      ? {}
      : {
          routeLocation: {
            componentName: 'NextAppPage' as const,
            evidenceKind: 'next-app-filesystem' as const,
            params: routeParams,
            pathname: `/${Object.values(routeParams).join('/')}`,
            pattern: `/${Object.keys(routeParams)
              .map((name) => `[${name}]`)
              .join('/')}`,
            searchParams: {},
            sourcePath: selectedPath,
          },
        }),
    stopReason: 'root-reached' as const,
    targetAutomaticProps: {},
  };
  return {
    ...pageCandidate,
    pageCandidates: [pageCandidate],
    renderChain,
    renderChainsByExport: { default: renderChain },
    target,
  };
}
