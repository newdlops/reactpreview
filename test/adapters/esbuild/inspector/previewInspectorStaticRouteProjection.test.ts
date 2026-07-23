/** Verifies syntax-safe eager route pruning while preserving the selected page and application shell. */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import type { PreviewInspectorAncestorPlan } from '../../../../src/adapters/esbuild/inspector';
import { createPreviewInspectorCorridorPlugin } from '../../../../src/adapters/esbuild/inspector/previewInspectorCorridorPlugin';
import { collectPreviewStaticRouteProjectionInventory } from '../../../../src/adapters/esbuild/inspector/previewInspectorStaticRouteProjection';
import { createPreviewStaticModuleResolver } from '../../../../src/adapters/esbuild/previewStaticModuleResolver';

describe('static Page Inspector route projections', () => {
  it('omits eager leaf siblings while retaining the selected route and authored shell', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-static-route-'));
    const sourceRoot = path.join(workspaceRoot, 'src');
    const entryPath = path.join(sourceRoot, 'entry.ts');
    const registryPath = path.join(sourceRoot, 'registry.tsx');
    const selectedPath = path.join(sourceRoot, 'Selected.tsx');
    const siblingPath = path.join(sourceRoot, 'Sibling.tsx');
    const shellPath = path.join(sourceRoot, 'Shell.tsx');
    const headerPath = path.join(sourceRoot, 'Header.tsx');
    await mkdir(sourceRoot, { recursive: true });
    await Promise.all([
      writeFile(entryPath, `export { applicationShell, routes } from './registry';`),
      writeFile(
        registryPath,
        [
          `import Selected from './Selected';`,
          `import Sibling from './Sibling';`,
          `import Shell from './Shell';`,
          `import Header from './Header';`,
          `export const routes = [`,
          `  { path: '/selected', element: <Selected /> },`,
          `  { path: '/sibling', element: <Sibling /> },`,
          `];`,
          `export const applicationShell = <Shell><Header /></Shell>;`,
        ].join('\n'),
      ),
      writeFile(
        selectedPath,
        `export default function Selected() { return 'SELECTED_PAGE_MARKER'; }`,
      ),
      writeFile(
        siblingPath,
        `export default function Sibling() { return 'UNSELECTED_PAGE_MARKER'; }`,
      ),
      writeFile(shellPath, `export default function Shell() { return 'APP_SHELL_MARKER'; }`),
      writeFile(headerPath, `export default function Header() { return 'HEADER_MARKER'; }`),
    ]);

    const result = await build({
      absWorkingDir: workspaceRoot,
      bundle: true,
      entryPoints: [entryPath],
      external: ['react/jsx-runtime'],
      format: 'esm',
      jsx: 'automatic',
      outdir: path.join(workspaceRoot, 'out'),
      plugins: [
        createPreviewInspectorCorridorPlugin({
          plan: createStaticCorridorPlan(entryPath, registryPath, selectedPath),
          projectRoot: workspaceRoot,
          resolveModule: createPreviewStaticModuleResolver({ workspaceRoot }).resolve,
          workspaceRoot,
        }),
      ],
      write: false,
    });
    const source = result.outputFiles.map((outputFile) => outputFile.text).join('\n');

    expect(source).toContain('SELECTED_PAGE_MARKER');
    expect(source).not.toContain('UNSELECTED_PAGE_MARKER');
    expect(source).toContain('APP_SHELL_MARKER');
    expect(source).toContain('HEADER_MARKER');
    expect(source).toContain('ReactPreviewStaticCorridorRoute');
  });

  it('preserves nested layout routes and projects only their independent leaf child', () => {
    const sourcePath = '/workspace/src/routes.tsx';
    const inventory = collectPreviewStaticRouteProjectionInventory(
      sourcePath,
      [
        `import { Route } from 'react-router';`,
        `import Layout from './Layout';`,
        `import Child from './Child';`,
        `export const routes = (`,
        `  <Route path="/" element={<Layout />}>`,
        `    <Route path="child" element={<Child />} />`,
        `  </Route>`,
        `);`,
      ].join('\n'),
    );

    expect([...inventory.routeBranchSpecifiers]).toEqual(['./Child']);
    expect([...inventory.projectionsBySpecifier]).toEqual([
      ['./Child', { exportNames: ['default'], moduleSpecifier: './Child' }],
    ]);
  });

  it('recognizes page maps and neutral submodules while keeping shell callbacks authentic', () => {
    const sourcePath = '/workspace/src/application.tsx';
    const inventory = collectPreviewStaticRouteProjectionInventory(
      sourcePath,
      [
        `import PageOne from './PageOne';`,
        `import { PageTwo } from './PageTwo';`,
        `import GroupedPages from './GroupedPages';`,
        `import SubApplication from './SubApplication';`,
        `import Layout from './Layout';`,
        `import Provider from './Provider';`,
        `import { createApplication } from './factory';`,
        `export const app = createApplication(`,
        `  '/base',`,
        `  { PageOne, second: PageTwo, ...GroupedPages },`,
        `  [SubApplication],`,
        `  ({ pageRoutes }) => <Provider><Layout>{pageRoutes}</Layout></Provider>,`,
        `);`,
      ].join('\n'),
    );

    expect([...inventory.projectionsBySpecifier.keys()]).toEqual([
      './PageOne',
      './PageTwo',
      './GroupedPages',
      './SubApplication',
    ]);
    expect(inventory.projectionsBySpecifier.get('./SubApplication')).toMatchObject({
      neutralRouteBasePath: '/base/__react-preview-omitted__',
    });
    expect(inventory.projectionsBySpecifier.has('./Layout')).toBe(false);
    expect(inventory.projectionsBySpecifier.has('./Provider')).toBe(false);
  });

  it('follows route-only local page groups without retaining every grouped page graph', () => {
    const sourcePath = '/workspace/src/application.tsx';
    const inventory = collectPreviewStaticRouteProjectionInventory(
      sourcePath,
      [
        `import DirectPage from './DirectPage';`,
        `import GroupedPage from './GroupedPage';`,
        `import WrappedPage from './WrappedPage';`,
        `import EscapedPage from './EscapedPage';`,
        `import Layout from './Layout';`,
        `const GroupedPages = {`,
        `  GroupedPage,`,
        `  wrapped: () => <WrappedPage />,`,
        `};`,
        `const EscapedPages = { EscapedPage };`,
        `inspect(EscapedPages);`,
        `export const app = createApplication(`,
        `  '/base',`,
        `  { DirectPage, ...GroupedPages, ...EscapedPages },`,
        `  [],`,
        `  ({ pageRoutes }) => <Layout>{pageRoutes}</Layout>,`,
        `);`,
      ].join('\n'),
    );

    expect([...inventory.projectionsBySpecifier.keys()]).toEqual([
      './DirectPage',
      './GroupedPage',
      './WrappedPage',
    ]);
    expect(inventory.projectionsBySpecifier.has('./EscapedPage')).toBe(false);
    expect(inventory.projectionsBySpecifier.has('./Layout')).toBe(false);
  });

  it('treats a leaf route component basePath read as projectable route metadata', () => {
    const sourcePath = '/workspace/src/application.tsx';
    const inventory = collectPreviewStaticRouteProjectionInventory(
      sourcePath,
      [
        `import SelectedApp from './SelectedApp';`,
        `import SiblingApp from './SiblingApp';`,
        `import SharedLayout from './SharedLayout';`,
        `export const shell = <SharedLayout />;`,
        `export const routes = (`,
        `  <Routes>`,
        '    <Route path={`${SelectedApp.basePath}/*`} element={<SelectedApp />} />',
        '    <Route path={toPath(`${SiblingApp.basePath}/*`)} element={<SiblingApp />} />',
        `    <Route path="/shared" element={<SharedLayout />} />`,
        `  </Routes>`,
        `);`,
      ].join('\n'),
    );

    expect(inventory.projectionsBySpecifier.get('./SelectedApp')).toMatchObject({
      neutralRouteBasePath: '/__react-preview-omitted__',
    });
    expect(inventory.projectionsBySpecifier.get('./SiblingApp')).toMatchObject({
      neutralRouteBasePath: '/__react-preview-omitted__',
    });
    expect(inventory.projectionsBySpecifier.has('./SharedLayout')).toBe(false);
  });

  it('keeps path metadata authentic when it belongs to a different leaf render binding', () => {
    const sourcePath = '/workspace/src/application.tsx';
    const inventory = collectPreviewStaticRouteProjectionInventory(
      sourcePath,
      [
        `import PathOwner from './PathOwner';`,
        `import RenderedPage from './RenderedPage';`,
        `export const route = (`,
        '  <Route path={`${PathOwner.basePath}/*`} element={<RenderedPage />} />',
        `);`,
      ].join('\n'),
    );

    expect(inventory.projectionsBySpecifier.has('./PathOwner')).toBe(false);
    expect(inventory.projectionsBySpecifier.get('./RenderedPage')).toEqual({
      exportNames: ['default'],
      moduleSpecifier: './RenderedPage',
    });
  });

  it('fails open for namespace and mixed-runtime route imports', () => {
    const sourcePath = '/workspace/src/routes.tsx';
    const inventory = collectPreviewStaticRouteProjectionInventory(
      sourcePath,
      [
        `import * as NamespacePage from './NamespacePage';`,
        `import MixedPage from './MixedPage';`,
        `export const routes = [`,
        `  { path: '/namespace', Component: NamespacePage },`,
        `  { path: '/mixed', Component: MixedPage },`,
        `];`,
        `export const version = MixedPage.version;`,
      ].join('\n'),
    );

    expect([...inventory.routeBranchSpecifiers]).toEqual(['./NamespacePage', './MixedPage']);
    expect(inventory.projectionsBySpecifier.size).toBe(0);
  });
});

/** Creates an exact entry → registry → selected-page corridor for the esbuild integration fixture. */
function createStaticCorridorPlan(
  entryPath: string,
  registryPath: string,
  selectedPath: string,
): PreviewInspectorAncestorPlan {
  const target = { exportName: 'default', sourcePath: selectedPath };
  const renderPath = {
    entryPoint: {
      kind: 'create-root' as const,
      occurrenceStart: 0,
      sourcePath: entryPath,
      wrapperNames: [],
    },
    id: 'static-selected-path',
    steps: [
      {
        certainty: 'confirmed' as const,
        kind: 'component-render' as const,
        label: 'Selected',
        occurrenceStart: 0,
        sourcePath: selectedPath,
        wrapperNames: [],
      },
      {
        certainty: 'confirmed' as const,
        kind: 'component-render' as const,
        label: 'registry',
        occurrenceStart: 0,
        sourcePath: registryPath,
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
    dependencyPaths: [entryPath, registryPath, selectedPath],
    paths: [renderPath],
    reachability: 'entry-connected' as const,
    target,
    truncated: false,
  };
  const pageCandidate = {
    complete: true,
    dependencyPaths: [entryPath, registryPath, selectedPath],
    edges: [],
    id: 'static-selected-candidate',
    renderPath,
    root: target,
    rootAutomaticProps: {},
    rootOwnsRouter: false,
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
