/**
 * Verifies that a broad component-factory registry keeps its authored page shell while projecting
 * unselected page-map branches and metadata-compatible sibling submodules.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import type { PreviewInspectorAncestorPlan } from '../../../../src/adapters/esbuild/inspector';
import { createPreviewInspectorCorridorPlugin } from '../../../../src/adapters/esbuild/inspector/previewInspectorCorridorPlugin';
import { createPreviewStaticModuleResolver } from '../../../../src/adapters/esbuild/previewStaticModuleResolver';

describe('static component-factory route projection', () => {
  /**
   * The selected page, layout, header, and navigation must survive first-paint pruning. Submodules
   * The selected submodule stays authentic. Its sibling receives non-enumerable neutral metadata so
   * factory reads remain valid without traversing the sibling's page graph.
   */
  it('keeps the selected corridor and application contracts while omitting sibling pages', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'react-preview-static-route-factory-'),
    );
    const sourceRoot = path.join(workspaceRoot, 'src');
    const entryPath = path.join(sourceRoot, 'ApplicationRegistry.tsx');
    const selectedPagePath = path.join(sourceRoot, 'pages', 'SelectedPage.tsx');
    const selectedSubAppPath = path.join(sourceRoot, 'subapps', 'SelectedSubApp.tsx');
    const siblingPages = Array.from({ length: 30 }, (_, index) => ({
      importName: `SiblingPage${index.toString()}`,
      sourcePath: path.join(sourceRoot, 'pages', `SiblingPage${index.toString()}.tsx`),
    }));

    try {
      await Promise.all([
        mkdir(path.join(sourceRoot, 'pages'), { recursive: true }),
        mkdir(path.join(sourceRoot, 'shell'), { recursive: true }),
        mkdir(path.join(sourceRoot, 'subapps'), { recursive: true }),
      ]);
      await Promise.all([
        writeFactoryRegistry(entryPath, siblingPages),
        writeFactory(sourceRoot),
        writeFile(
          selectedPagePath,
          'export default function SelectedPage() { return <main>SELECTED_PAGE_MARKER</main>; }',
        ),
        ...siblingPages.map(({ importName, sourcePath }, index) =>
          writeFile(
            sourcePath,
            `export default function ${importName}() { return <main>SIBLING_PAGE_MARKER_${index.toString()}</main>; }`,
          ),
        ),
        writeShellModules(sourceRoot),
        writeSubApplicationModules(sourceRoot),
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
            maximumSmallStaticRouteImports: 8,
            plan: createFactoryCorridorPlan(entryPath, selectedPagePath, selectedSubAppPath),
            projectRoot: workspaceRoot,
            resolveModule: createPreviewStaticModuleResolver({ workspaceRoot }).resolve,
            workspaceRoot,
          }),
        ],
        splitting: true,
        write: false,
      });
      const bundledSource = result.outputFiles.map((outputFile) => outputFile.text).join('\n');

      expect(bundledSource).toContain('SELECTED_PAGE_MARKER');
      expect(bundledSource).toContain('APP_LAYOUT_MARKER');
      expect(bundledSource).toContain('APP_HEADER_MARKER');
      expect(bundledSource).toContain('APP_NAVIGATION_MARKER');
      expect(bundledSource).toContain('SELECTED_SUBAPP_METADATA_MARKER');
      expect(bundledSource).toContain('SELECTED_SUBPAGE_MARKER');
      expect(bundledSource).not.toContain('SIBLING_SUBAPP_METADATA_MARKER');
      expect(bundledSource).not.toContain('SIBLING_SUBPAGE_MARKER');
      expect(bundledSource).toContain('__react-preview-omitted__');
      expect(bundledSource).toContain('ReactPreviewStaticCorridorRoute');
      expect(bundledSource).not.toContain('SIBLING_PAGE_MARKER_');
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});

/** Writes the broad registry whose object page choices are safe to project independently. */
async function writeFactoryRegistry(
  entryPath: string,
  siblingPages: readonly { readonly importName: string }[],
): Promise<void> {
  await writeFile(
    entryPath,
    [
      "import { createSectionApp } from './factory';",
      "import AppLayout from './shell/AppLayout';",
      "import Header from './shell/Header';",
      "import Navigation from './shell/Navigation';",
      "import SelectedPage from './pages/SelectedPage';",
      ...siblingPages.map(({ importName }) => `import ${importName} from './pages/${importName}';`),
      "import SelectedSubApp from './subapps/SelectedSubApp';",
      "import SiblingSubApp from './subapps/SiblingSubApp';",
      'export default createSectionApp(',
      "  '/workspace',",
      `  { SelectedPage, ${siblingPages.map(({ importName }) => importName).join(', ')} },`,
      '  [SelectedSubApp, SiblingSubApp],',
      '  ({ children }) => (',
      '    <AppLayout><Header /><Navigation />{children}</AppLayout>',
      '  ),',
      ');',
    ].join('\n'),
  );
}

/** Writes a generic factory that demonstrates the required runtime submodule metadata contract. */
async function writeFactory(sourceRoot: string): Promise<void> {
  await writeFile(
    path.join(sourceRoot, 'factory.tsx'),
    [
      'export function createSectionApp(parentBasePath, pages, subModules, Shell) {',
      '  const activeSubModule = subModules.find((subModule) =>',
      '    subModule.basePath.startsWith(parentBasePath),',
      '  );',
      '  const ActivePage = pages.SelectedPage;',
      '  const ActiveSubPage = activeSubModule?.allPages[0];',
      '  const pageNames = activeSubModule?.pageNames ?? [];',
      '  return function GeneratedApplication() {',
      '    return (',
      '      <Shell>',
      '        <ActivePage />',
      '        {ActiveSubPage ? <ActiveSubPage /> : null}',
      '        <output data-page-names={pageNames.join(",")} />',
      '      </Shell>',
      '    );',
      '  };',
      '}',
    ].join('\n'),
  );
}

/** Writes the visible application frame that must not be sacrificed by registry pruning. */
async function writeShellModules(sourceRoot: string): Promise<void> {
  await Promise.all([
    writeFile(
      path.join(sourceRoot, 'shell', 'AppLayout.tsx'),
      'export default function AppLayout({ children }) { return <div>APP_LAYOUT_MARKER{children}</div>; }',
    ),
    writeFile(
      path.join(sourceRoot, 'shell', 'Header.tsx'),
      'export default function Header() { return <header>APP_HEADER_MARKER</header>; }',
    ),
    writeFile(
      path.join(sourceRoot, 'shell', 'Navigation.tsx'),
      'export default function Navigation() { return <nav>APP_NAVIGATION_MARKER</nav>; }',
    ),
  ]);
}

/** Writes two metadata-bearing subapplications that must remain authentic rather than projected. */
async function writeSubApplicationModules(sourceRoot: string): Promise<void> {
  await Promise.all([
    writeFile(
      path.join(sourceRoot, 'subapps', 'SelectedSubPage.tsx'),
      'export default function SelectedSubPage() { return <aside>SELECTED_SUBPAGE_MARKER</aside>; }',
    ),
    writeFile(
      path.join(sourceRoot, 'subapps', 'SiblingSubPage.tsx'),
      'export default function SiblingSubPage() { return <aside>SIBLING_SUBPAGE_MARKER</aside>; }',
    ),
    writeFile(
      path.join(sourceRoot, 'subapps', 'SelectedSubApp.tsx'),
      [
        "import SelectedSubPage from './SelectedSubPage';",
        'export default {',
        "  basePath: '/workspace/selected',",
        '  allPages: [SelectedSubPage],',
        "  pageNames: ['SelectedSubPage'],",
        "  marker: 'SELECTED_SUBAPP_METADATA_MARKER',",
        '};',
      ].join('\n'),
    ),
    writeFile(
      path.join(sourceRoot, 'subapps', 'SiblingSubApp.tsx'),
      [
        "import SiblingSubPage from './SiblingSubPage';",
        'export default {',
        "  basePath: '/other',",
        '  allPages: [SiblingSubPage],',
        "  pageNames: ['SiblingSubPage'],",
        "  marker: 'SIBLING_SUBAPP_METADATA_MARKER',",
        '};',
      ].join('\n'),
    ),
  ]);
}

/** Creates complete entry-to-target evidence retaining the selected factory page branch. */
function createFactoryCorridorPlan(
  entryPath: string,
  selectedPath: string,
  selectedSubAppPath: string,
): PreviewInspectorAncestorPlan {
  const target = { exportName: 'default', sourcePath: selectedPath };
  const renderPath = {
    entryPoint: {
      kind: 'create-root' as const,
      occurrenceStart: 0,
      sourcePath: entryPath,
      wrapperNames: [],
    },
    id: 'selected-factory-path',
    steps: [
      {
        certainty: 'confirmed' as const,
        kind: 'component-render' as const,
        label: 'SelectedPage',
        occurrenceStart: 0,
        sourcePath: selectedPath,
        wrapperNames: [],
      },
      {
        certainty: 'confirmed' as const,
        kind: 'component-render' as const,
        label: 'SelectedSubApplication',
        occurrenceStart: 0,
        sourcePath: selectedSubAppPath,
        wrapperNames: [],
      },
      {
        certainty: 'confirmed' as const,
        kind: 'entry-render' as const,
        label: 'ApplicationRegistry',
        occurrenceStart: 0,
        sourcePath: entryPath,
        wrapperNames: [],
      },
    ],
  };
  const renderChain = {
    dependencyPaths: [entryPath, selectedSubAppPath, selectedPath],
    paths: [renderPath],
    reachability: 'entry-connected' as const,
    target,
    truncated: false,
  };
  const pageCandidate = {
    complete: true,
    dependencyPaths: [entryPath, selectedSubAppPath, selectedPath],
    edges: [],
    id: 'factory-page-candidate',
    renderPath,
    root: { exportName: 'default', sourcePath: entryPath },
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
