/** Covers projections behavior for previewInspectorCorridorPlugin. */
/** Verifies authored-source previewInspectorCorridorPlugin invariants. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';

import os from 'node:os';

import path from 'node:path';

import { build } from 'esbuild';

import { describe, expect, it } from 'vitest';

import {
  createPreviewInspectorCorridorPlugin,
  createPreviewInspectorPageExecutionPlugin,
  createPreviewInspectorPageSurfaceSpecifier,
  type PreviewInspectorAncestorPlan,
} from '../../../../src/adapters/esbuild/inspector';

import { createPreviewStaticModuleResolver } from '../../../../src/adapters/esbuild/previewStaticModuleResolver';

import { createCorridorPlan } from './previewInspectorCorridorPluginFixtures';

describe('createPreviewInspectorCorridorPlugin', () => {
  it('projects a frozen child imported by a virtual local-page slice', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-corridor-'));
    const sourceRoot = path.join(workspaceRoot, 'src');
    const pagePath = path.join(sourceRoot, 'Page.tsx');
    const pageTitlePath = path.join(sourceRoot, 'PageTitle.tsx');
    const pageSource = [
      `import { PageTitle } from './PageTitle';`,
      `const LocalPage = () => <PageTitle />;`,
      `export default withOwnerPagePermission(LocalPage, 'LocalPage');`,
    ].join('\n');
    await mkdir(sourceRoot, { recursive: true });
    await Promise.all([
      writeFile(pagePath, pageSource),
      writeFile(
        pageTitlePath,
        `export const PageTitle = () => <h1>UNEXPECTED_AUTHORED_PAGE_TITLE</h1>;`,
      ),
    ]);
    const surfaceSpecifier = createPreviewInspectorPageSurfaceSpecifier('local-page');
    const resolver = createPreviewStaticModuleResolver({ workspaceRoot });

    const result = await build({
      absWorkingDir: workspaceRoot,
      bundle: true,
      external: ['react', 'react/jsx-runtime'],
      format: 'esm',
      metafile: true,
      plugins: [
        createPreviewInspectorPageExecutionPlugin({
          readSource: (sourcePath) => (sourcePath === pagePath ? pageSource : undefined),
          surfaces: [
            {
              exportName: 'default',
              id: 'local-page',
              localName: 'LocalPage',
              sourcePath: pagePath,
            },
          ],
        }),
        createPreviewInspectorCorridorPlugin({
          frozenAuthenticSourcePaths: [pagePath],
          plan: createCorridorPlan(pagePath, pagePath),
          projectedEdges: [
            {
              exportNames: ['PageTitle'],
              importerPath: pagePath,
              moduleSpecifier: './PageTitle',
              occurrenceStart: 0,
              reason: 'budget-projection',
              runtimeHookExportNames: [],
              targetPath: pageTitlePath,
            },
          ],
          projectRoot: workspaceRoot,
          resolveModule: resolver.resolve,
          workspaceRoot,
        }),
      ],
      stdin: {
        contents: `import LocalPage from ${JSON.stringify(surfaceSpecifier)}; console.log(LocalPage);`,
        loader: 'js',
        resolveDir: workspaceRoot,
      },
      write: false,
    });
    const source = result.outputFiles.map((outputFile) => outputFile.text).join('\n');
    const inputs = Object.keys(result.metafile.inputs).map((key) => key.replaceAll(path.sep, '/'));

    expect(source).toContain('createShallowComponent');
    expect(source).toContain('./PageTitle:PageTitle');
    expect(source).not.toContain('UNEXPECTED_AUTHORED_PAGE_TITLE');
    expect(inputs.some((key) => key.endsWith('/src/PageTitle.tsx'))).toBe(false);
  });

  it('does not let broad candidate evidence override selected frozen membership', async () => {
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
    const selectedPlan = createCorridorPlan(entryPath, selectedPath);
    const alternativePlan = createCorridorPlan(
      entryPath,
      unrelatedPath,
      undefined,
      [],
      'candidate-unrelated',
    );
    const plan: PreviewInspectorAncestorPlan = {
      ...selectedPlan,
      pageCandidates: [...selectedPlan.pageCandidates, ...alternativePlan.pageCandidates],
    };
    const resolver = createPreviewStaticModuleResolver({ workspaceRoot });

    const result = await build({
      absWorkingDir: workspaceRoot,
      bundle: true,
      entryPoints: [entryPath],
      format: 'esm',
      metafile: true,
      outdir: path.join(workspaceRoot, 'out'),
      plugins: [
        createPreviewInspectorCorridorPlugin({
          frozenAuthenticSourcePaths: [entryPath, selectedPath],
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
    const inputs = Object.keys(result.metafile.inputs).map((key) => key.replaceAll(path.sep, '/'));
    expect(inputs.some((key) => key.endsWith('src/Selected.ts'))).toBe(true);
    expect(inputs.some((key) => key.endsWith('src/Unrelated.ts'))).toBe(false);
    await expect(readFile(unrelatedPath, 'utf8')).resolves.toContain('UNRELATED_ROUTE_MARKER');
  });

  /** Keeps wrapper modules that prove a render step even when they are not standalone step nodes. */
  it('preserves render-step wrapper evidence inside a pruned dynamic registry', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-corridor-'));
    const entryPath = path.join(workspaceRoot, 'src', 'entry.ts');
    const selectedPath = path.join(workspaceRoot, 'src', 'Selected.ts');
    const wrapperPath = path.join(workspaceRoot, 'src', 'Wrapper.ts');
    const unrelatedPath = path.join(workspaceRoot, 'src', 'Unrelated.ts');
    await mkdir(path.dirname(entryPath), { recursive: true });
    await Promise.all([
      writeFile(
        entryPath,
        [
          `export const selected = () => import('./Selected');`,
          `export const wrapper = () => import('./Wrapper');`,
          `export const unrelated = () => import('./Unrelated');`,
        ].join('\n'),
      ),
      writeFile(selectedPath, `export default 'SELECTED_CORRIDOR_MARKER';`),
      writeFile(wrapperPath, `export default 'WRAPPER_EVIDENCE_MARKER';`),
      writeFile(unrelatedPath, `export default 'UNRELATED_ROUTE_MARKER';`),
    ]);
    const resolver = createPreviewStaticModuleResolver({ workspaceRoot });

    const result = await build({
      absWorkingDir: workspaceRoot,
      bundle: true,
      entryPoints: [entryPath],
      format: 'esm',
      outdir: path.join(workspaceRoot, 'out'),
      plugins: [
        createPreviewInspectorCorridorPlugin({
          maximumSmallDynamicImports: 0,
          plan: createCorridorPlan(entryPath, selectedPath, undefined, [wrapperPath]),
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
    expect(source).toContain('WRAPPER_EVIDENCE_MARKER');
    expect(source).not.toContain('UNRELATED_ROUTE_MARKER');
  });

  /** Lets first paint classify a medium dormant lazy-choice list without traversing every child. */
  it('accepts a lower generated-registry threshold for bounded fast preparation', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-corridor-'));
    const entryPath = path.join(workspaceRoot, 'src', 'entry.ts');
    await mkdir(path.dirname(entryPath), { recursive: true });
    const branches = Array.from({ length: 10 }, (_, index) => ({
      path: path.join(workspaceRoot, 'src', `Fallback${index.toString()}.ts`),
      specifier: `./Fallback${index.toString()}`,
    }));
    await Promise.all([
      writeFile(
        entryPath,
        `export const fallbacks = [${branches
          .map(({ specifier }) => `() => import('${specifier}')`)
          .join(',')}];`,
      ),
      ...branches.map(({ path: branchPath }, index) =>
        writeFile(branchPath, `export default 'DORMANT_FALLBACK_${index.toString()}';`),
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
          maximumSmallDynamicImports: 8,
          plan: createCorridorPlan(entryPath, entryPath),
          projectRoot: workspaceRoot,
          resolveModule: createPreviewStaticModuleResolver({ workspaceRoot }).resolve,
          workspaceRoot,
        }),
      ],
      splitting: true,
      write: false,
    });
    const source = result.outputFiles.map((outputFile) => outputFile.text).join('\n');

    expect(source).toContain('ReactPreviewDeferredCorridorRoute');
    expect(source).not.toContain('DORMANT_FALLBACK_');
    expect(result.outputFiles).toHaveLength(2);
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
          frozenAuthenticSourcePaths: [entryPath, pagePath, welcomePath],
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

  /** Keeps every statically rendered component authentic below a selected VirtualPage layout. */
  it('expands transitive JSX below a VirtualPage layout', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-corridor-'));
    const sourceRoot = path.join(workspaceRoot, 'src');
    const entryPath = path.join(sourceRoot, 'entry.tsx');
    const pagePath = path.join(sourceRoot, 'Page.tsx');
    const layoutPath = path.join(sourceRoot, 'ApplicationLayout.tsx');
    const navigationPath = path.join(sourceRoot, 'PrimaryTopbar.tsx');
    const deepItemPath = path.join(sourceRoot, 'DeepMenuItem.tsx');
    await mkdir(sourceRoot, { recursive: true });
    await Promise.all([
      writeFile(
        entryPath,
        [
          `import Page from './Page';`,
          `import { ApplicationLayout } from './ApplicationLayout';`,
          `export default () => <ApplicationLayout><Page /></ApplicationLayout>;`,
        ].join('\n'),
      ),
      writeFile(pagePath, `export default () => <main>PAGE_MARKER</main>;`),
      writeFile(
        layoutPath,
        [
          `import { PrimaryTopbar, useTopbarMode } from './PrimaryTopbar';`,
          `export const ApplicationLayout = ({ children }) => {`,
          `  const { visible } = useTopbarMode();`,
          `  return <div>{visible && <PrimaryTopbar />}{children}</div>;`,
          `};`,
        ].join('\n'),
      ),
      writeFile(
        navigationPath,
        [
          `import { DeepMenuItem } from './DeepMenuItem';`,
          `export const useTopbarMode = () => ({ visible: true });`,
          `export const PrimaryTopbar = () => (`,
          `  <header>TOPBAR_DEPTH_MARKER<DeepMenuItem /></header>`,
          `);`,
        ].join('\n'),
      ),
      writeFile(deepItemPath, `export const DeepMenuItem = () => <i>DEEP_ITEM_MARKER</i>;`),
    ]);
    const basePlan = createCorridorPlan(entryPath, pagePath);
    const plan: PreviewInspectorAncestorPlan = {
      ...basePlan,
      shallowVisualPaths: [
        {
          exportName: 'ApplicationLayout',
          importerPath: entryPath,
          importKind: 'static',
          localEdges: [],
          moduleSpecifier: './ApplicationLayout',
          occurrenceStart: 0,
          relation: 'sibling',
          renderedLocalName: 'ApplicationLayout',
          renderBoundaryStart: 0,
          selectedChildPath: pagePath,
          sourcePath: layoutPath,
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

    expect(source).toContain('TOPBAR_DEPTH_MARKER');
    expect(source).toContain('DEEP_ITEM_MARKER');
    expect(source).not.toContain('createShallowComponent("./DeepMenuItem:DeepMenuItem")');
    expect(source).not.toContain(
      'createShallowComponent("./PrimaryTopbar:PrimaryTopbar,useTopbarMode")',
    );
    expect(source).toContain('VirtualPage component isolated');
  });

  /** Keeps authored navigation/tab records while still cutting the data hook's nested runtime edge. */
  it('retains a static render-data hook below a VirtualPage shell', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-corridor-'));
    const sourceRoot = path.join(workspaceRoot, 'src');
    const entryPath = path.join(sourceRoot, 'entry.tsx');
    const pagePath = path.join(sourceRoot, 'Page.tsx');
    const layoutPath = path.join(sourceRoot, 'ApplicationLayout.tsx');
    const navigationPath = path.join(sourceRoot, 'PrimaryNavigation.tsx');
    const navigationDataPath = path.join(sourceRoot, 'useNavigationData.ts');
    const permissionPath = path.join(sourceRoot, 'usePermission.ts');
    await mkdir(sourceRoot, { recursive: true });
    await Promise.all([
      writeFile(
        entryPath,
        [
          `import Page from './Page';`,
          `import { ApplicationLayout } from './ApplicationLayout';`,
          `export default () => <ApplicationLayout><Page /></ApplicationLayout>;`,
        ].join('\n'),
      ),
      writeFile(pagePath, `export default () => <main>PAGE_MARKER</main>;`),
      writeFile(
        layoutPath,
        [
          `import { PrimaryNavigation } from './PrimaryNavigation';`,
          `export const ApplicationLayout = ({ children }) => (`,
          `  <div><PrimaryNavigation />{children}</div>`,
          `);`,
        ].join('\n'),
      ),
      writeFile(
        navigationPath,
        [
          `import { useNavigationData } from './useNavigationData';`,
          `export const PrimaryNavigation = () => {`,
          `  const items = useNavigationData();`,
          `  return <aside>{items.map((item) => <a key={item.name}>{item.label}</a>)}</aside>;`,
          `};`,
        ].join('\n'),
      ),
      writeFile(
        navigationDataPath,
        [
          `import { usePermission } from './usePermission';`,
          `export const useNavigationData = () => {`,
          `  const allowed = usePermission();`,
          `  return [`,
          `    { name: 'home', label: 'NAV_HOME_DETAIL' },`,
          `    { name: 'reports', label: 'NAV_REPORT_DETAIL' },`,
          `    allowed && { name: 'admin', label: 'NAV_ADMIN_DETAIL' },`,
          `  ].filter(Boolean);`,
          `};`,
        ].join('\n'),
      ),
      writeFile(
        permissionPath,
        [
          `export const usePermission = () => {`,
          `  globalThis.permissionMarker = 'EXPENSIVE_PERMISSION_MARKER';`,
          `  return true;`,
          `};`,
        ].join('\n'),
      ),
    ]);
    const basePlan = createCorridorPlan(entryPath, pagePath);
    const permissionPlan = createCorridorPlan(
      entryPath,
      permissionPath,
      undefined,
      [],
      'candidate-off-frontier-permission',
    );
    const plan: PreviewInspectorAncestorPlan = {
      ...basePlan,
      pageCandidates: [...basePlan.pageCandidates, ...permissionPlan.pageCandidates],
      shallowVisualPaths: [
        {
          exportName: 'ApplicationLayout',
          importerPath: entryPath,
          importKind: 'static',
          localEdges: [],
          moduleSpecifier: './ApplicationLayout',
          occurrenceStart: 0,
          relation: 'sibling',
          renderedLocalName: 'ApplicationLayout',
          renderBoundaryStart: 0,
          selectedChildPath: pagePath,
          sourcePath: layoutPath,
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
          frozenAuthenticSourcePaths: [
            entryPath,
            pagePath,
            layoutPath,
            navigationPath,
            navigationDataPath,
          ],
          plan,
          projectRoot: workspaceRoot,
          resolveModule: createPreviewStaticModuleResolver({ workspaceRoot }).resolve,
          workspaceRoot,
        }),
      ],
      write: false,
    });
    const source = result.outputFiles.map((outputFile) => outputFile.text).join('\n');

    expect(source).toContain('NAV_HOME_DETAIL');
    expect(source).toContain('NAV_REPORT_DETAIL');
    expect(source).toContain('NAV_ADMIN_DETAIL');
    expect(source).not.toContain('EXPENSIVE_PERMISSION_MARKER');
    expect(source).toContain('createShallowRuntimeHook("./usePermission:usePermission")');
  });
});
