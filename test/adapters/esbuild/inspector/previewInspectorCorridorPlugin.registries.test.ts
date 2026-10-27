/** Covers registries behavior for previewInspectorCorridorPlugin. */
/** Verifies authored-source previewInspectorCorridorPlugin invariants. */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';

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

import { createCorridorPlan } from './previewInspectorCorridorPluginFixtures';

describe('createPreviewInspectorCorridorPlugin', () => {
  /** Uses module/export cycle identity rather than a fixed hop count for deep component trees. */
  it('retains a selected JSX chain deeper than the former twelve-component limit', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-corridor-'));
    const sourceRoot = path.join(workspaceRoot, 'src');
    const entryPath = path.join(sourceRoot, 'entry.tsx');
    const pagePath = path.join(sourceRoot, 'Page.tsx');
    const componentPaths = Array.from({ length: 18 }, (_, index) =>
      path.join(sourceRoot, `Layer${index.toString()}.tsx`),
    );
    await mkdir(sourceRoot, { recursive: true });
    await Promise.all([
      writeFile(
        entryPath,
        [
          `import Page from './Page';`,
          `import { Layer0 } from './Layer0';`,
          `export default () => <Layer0><Page /></Layer0>;`,
        ].join('\n'),
      ),
      writeFile(pagePath, `export default () => <main>PAGE_MARKER</main>;`),
      ...componentPaths.map((componentPath, index) => {
        const nextIndex = index + 1;
        return writeFile(
          componentPath,
          nextIndex < componentPaths.length
            ? [
                `import { Layer${nextIndex.toString()} } from './Layer${nextIndex.toString()}';`,
                `export const Layer${index.toString()} = ({ children }) => (`,
                `  <section data-layer="${index.toString()}">`,
                `    <Layer${nextIndex.toString()}>{children}</Layer${nextIndex.toString()}>`,
                `  </section>`,
                `);`,
              ].join('\n')
            : `export const Layer${index.toString()} = ({ children }) => <article>DEEPEST_VIRTUAL_PAGE_MARKER{children}</article>;`,
        );
      }),
    ]);
    const basePlan = createCorridorPlan(entryPath, pagePath);
    const plan: PreviewInspectorAncestorPlan = {
      ...basePlan,
      shallowVisualPaths: [
        {
          exportName: 'Layer0',
          importerPath: entryPath,
          importKind: 'static',
          localEdges: [],
          moduleSpecifier: './Layer0',
          occurrenceStart: 0,
          relation: 'sibling',
          renderedLocalName: 'Layer0',
          renderBoundaryStart: 0,
          selectedChildPath: pagePath,
          sourcePath: componentPaths[0] ?? '',
        },
      ],
    };

    const result = await build({
      absWorkingDir: workspaceRoot,
      bundle: true,
      entryPoints: [entryPath],
      external: ['react', 'react/jsx-runtime'],
      format: 'esm',
      jsx: 'automatic',
      outdir: path.join(workspaceRoot, 'out'),
      plugins: [
        createPreviewInspectorCorridorPlugin({
          plan,
          projectRoot: workspaceRoot,
          resolveModule: createPreviewStaticModuleResolver({ workspaceRoot }).resolve,
          workspaceRoot,
        }),
      ],
      write: false,
    });
    const source = result.outputFiles.map((outputFile) => outputFile.text).join('\n');

    expect(source).toContain('DEEPEST_VIRTUAL_PAGE_MARKER');
    expect(source).toContain('data-layer');
    expect(source).not.toContain('createShallowComponent("./Layer');
  });

  /** Preserves a small API loader, then narrows its generated registry to the exact App Router parameter tuple. Every omitted branch shares one module so split output remains bounded. */
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
          frozenAuthenticSourcePaths: [
            entryPath,
            pagePath,
            helperPath,
            indexPath,
            registryPath,
            selectedPath,
          ],
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

    const staticResolver = createPreviewStaticModuleResolver({ workspaceRoot });
    let resolvedBranchCount = 0;
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
          resolveModule: (specifier, importerPath) => {
            resolvedBranchCount += 1;
            return staticResolver.resolve(specifier, importerPath);
          },
          workspaceRoot,
        }),
      ],
      splitting: true,
      write: false,
    });

    expect(result.outputFiles.map((outputFile) => outputFile.text).join('\n')).toContain(
      'ReactPreviewDeferredCorridorRoute',
    );
    expect(resolvedBranchCount).toBe(0);
  });

  /** A direct target hidden in a broad non-route registry is retained through one lexical hint. */
  it('resolves only a selected module stem in a broad registry without route params', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-corridor-'));
    const entryPath = path.join(workspaceRoot, 'src', 'entry.ts');
    const selectedPath = path.join(workspaceRoot, 'src', 'selected', 'index.ts');
    await mkdir(path.dirname(selectedPath), { recursive: true });
    await Promise.all([
      writeFile(
        entryPath,
        `export const routes = [${[
          ...Array.from(
            { length: 30 },
            (_, index) => `() => import('./unrelated-${index.toString()}/index')`,
          ),
          `() => import('./selected')`,
        ].join(',')}];`,
      ),
      writeFile(selectedPath, `export default 'BROAD_SELECTED_MARKER';`),
    ]);
    const staticResolver = createPreviewStaticModuleResolver({ workspaceRoot });
    let resolvedBranchCount = 0;

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
          resolveModule: (specifier, importerPath) => {
            resolvedBranchCount += 1;
            return staticResolver.resolve(specifier, importerPath);
          },
          workspaceRoot,
        }),
      ],
      splitting: true,
      write: false,
    });

    expect(result.outputFiles.map((outputFile) => outputFile.text).join('\n')).toContain(
      'BROAD_SELECTED_MARKER',
    );
    expect(resolvedBranchCount).toBe(1);
  });

  /** An unreadable-size authored loader is not treated as generated-registry pruning evidence. */
  it('fails open when an importer exceeds the bounded registry evidence size', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-corridor-'));
    const sourceRoot = path.join(workspaceRoot, 'src');
    const entryPath = path.join(sourceRoot, 'entry.ts');
    const selectedPath = path.join(sourceRoot, 'Selected.ts');
    await mkdir(sourceRoot, { recursive: true });
    await Promise.all([
      writeFile(
        entryPath,
        `/*${'x'.repeat(1024 * 1024)}*/\nexport const routes = [() => import('./Selected'), () => import('./Sibling')];`,
      ),
      writeFile(selectedPath, `export default 'OVERSIZED_SELECTED_MARKER';`),
    ]);

    await expect(
      build({
        absWorkingDir: workspaceRoot,
        bundle: true,
        entryPoints: [entryPath],
        format: 'esm',
        logLevel: 'silent',
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
      }),
    ).rejects.toThrow('Could not resolve "./Sibling"');
  });

  it('rejects an authored static import that is absent from a frozen bundle frontier', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-corridor-'));
    const entryPath = path.join(workspaceRoot, 'src', 'entry.ts');
    const unexpectedPath = path.join(workspaceRoot, 'src', 'Unexpected.ts');
    await mkdir(path.dirname(entryPath), { recursive: true });
    await Promise.all([
      writeFile(entryPath, `import { unexpected } from './Unexpected'; export default unexpected;`),
      writeFile(unexpectedPath, `export const unexpected = 'UNPLANNED_AUTHORED_MARKER';`),
    ]);

    await expect(
      build({
        absWorkingDir: workspaceRoot,
        bundle: true,
        entryPoints: [entryPath],
        format: 'esm',
        logLevel: 'silent',
        outdir: path.join(workspaceRoot, 'out'),
        plugins: [
          createPreviewInspectorCorridorPlugin({
            frozenAuthenticSourcePaths: [entryPath],
            plan: createCorridorPlan(entryPath, entryPath),
            projectRoot: workspaceRoot,
            resolveModule: createPreviewStaticModuleResolver({ workspaceRoot }).resolve,
            workspaceRoot,
          }),
        ],
        write: false,
      }),
    ).rejects.toThrow(
      'React Preview frontier mismatch: ./Unexpected escaped the planned authored bundle.',
    );
  });
});
