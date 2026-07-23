/** Proves fast generic Page Inspector prepares an authored app shell without full inventory work. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreviewBuildRequest } from '../../../src/domain/preview';
import { preparePreviewCompilerTarget } from '../../../src/adapters/esbuild/previewImperativeEntryTarget';
import { preparePreviewCompilerUsage } from '../../../src/adapters/esbuild/preparePreviewCompilerUsage';
import type { PreviewProjectUsageCache } from '../../../src/adapters/esbuild/previewProjectUsageCache';
import type { createPreviewStaticModuleResolver } from '../../../src/adapters/esbuild/previewStaticModuleResolver';

const temporaryRoots: string[] = [];

/** Removes every temporary app after each assertion, including an interrupted assertion. */
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

/** Writes one fixture module and returns its normalized absolute path. */
async function writeSource(
  rootPath: string,
  relativePath: string,
  sourceText: string,
): Promise<string> {
  const sourcePath = path.join(rootPath, relativePath);
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, sourceText, 'utf8');
  return path.normalize(sourcePath);
}

/** Creates an exact fixture resolver while preserving the production resolver's public shape. */
function createResolverStub(
  sourcePaths: readonly string[],
): ReturnType<typeof createPreviewStaticModuleResolver> {
  const sourcePathSet = new Set(sourcePaths);
  return {
    getJsxImportSource: () => undefined,
    getMatchedSpecifiers: () => [],
    isSideEffectFree: () => false,
    matchesTarget: () => false,
    resolve: (specifier: string, importerPath: string) => {
      if (!specifier.startsWith('.')) return undefined;
      const candidate = path.resolve(path.dirname(importerPath), specifier);
      return [candidate, `${candidate}.tsx`, `${candidate}.ts`, path.join(candidate, 'index.tsx')]
        .map((sourcePath) => path.normalize(sourcePath))
        .find((sourcePath) => sourcePathSet.has(sourcePath));
    },
    resolveMissingPathAliasCandidate: () => undefined,
    usesAlternativeJsxRuntime: () => false,
  };
}

describe('preparePreviewCompilerUsage fast generic page context', () => {
  it('returns an entry-connected app-to-target plan without enumerating every package source', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'prepare-fast-generic-page-'));
    temporaryRoots.push(projectRoot);
    const sources = await Promise.all([
      writeSource(
        projectRoot,
        'src/main.tsx',
        [
          "import { createRoot } from 'react-dom/client';",
          "import App from './App';",
          'createRoot(document.body).render(<App />);',
        ].join('\n'),
      ),
      writeSource(
        projectRoot,
        'src/App.tsx',
        [
          "import Shell from './layout/Shell';",
          "import Dashboard from './pages/Dashboard';",
          'export default function App() { return <Shell><Dashboard /></Shell>; }',
        ].join('\n'),
      ),
      writeSource(
        projectRoot,
        'src/layout/Shell.tsx',
        'export default function Shell({ children }) { return <div data-shell>{children}</div>; }',
      ),
      writeSource(
        projectRoot,
        'src/pages/Dashboard.tsx',
        [
          "import CurrentCard from '../components/CurrentCard';",
          'export default function Dashboard() { return <main><CurrentCard /></main>; }',
        ].join('\n'),
      ),
      writeSource(
        projectRoot,
        'src/components/CurrentCard.tsx',
        'export default function CurrentCard() { return <article>Current file</article>; }',
      ),
    ]);
    const documentPath = path.join(projectRoot, 'src/components/CurrentCard.tsx');
    const sourceText = await readFile(documentPath, 'utf8');
    const request: PreviewBuildRequest = {
      dependencySnapshots: [],
      documentPath,
      language: 'tsx',
      preparationMode: 'fast',
      renderMode: 'page-inspector',
      sourceText,
      useStorybookPreview: false,
      workspaceRoot: projectRoot,
    };
    const getSourcePaths = vi.fn();
    const cache = {
      discover: vi.fn(),
      getSourcePaths,
      readSourceText: vi.fn(({ sourcePath }: { readonly sourcePath: string }) =>
        readFile(sourcePath, 'utf8').catch(() => undefined),
      ),
    } as unknown as PreviewProjectUsageCache;

    const prepared = await preparePreviewCompilerUsage({
      cache,
      projectRoot,
      projectUsesNextRuntime: false,
      request,
      resolver: createResolverStub(sources),
      setupKind: 'none',
      targetSelection: preparePreviewCompilerTarget(request),
      workspaceRoot: projectRoot,
    });

    const plan = prepared.packageTargetUsageProps.inspectorPlan;
    expect(getSourcePaths).not.toHaveBeenCalled();
    expect(plan?.renderChain.reachability).toBe('entry-connected');
    expect(plan?.renderChain.paths[0]?.entryPoint?.sourcePath).toBe(
      path.join(projectRoot, 'src/main.tsx'),
    );
    expect(plan?.root).toMatchObject({
      exportName: 'default',
      sourcePath: path.join(projectRoot, 'src/App.tsx'),
    });
    expect(plan?.dependencyPaths).toEqual(
      expect.arrayContaining([
        path.join(projectRoot, 'src/layout/Shell.tsx'),
        path.join(projectRoot, 'src/pages/Dashboard.tsx'),
      ]),
    );
  });

  /**
   * A saturated reverse directory must not discard the useful App shell. It marks that shell as
   * provisional so the browser can paint it immediately while full discovery runs afterward.
   */
  it('retains an entry-connected shell while exposing truncated fast discovery', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'prepare-fast-truncated-page-'));
    temporaryRoots.push(projectRoot);
    const sources = await Promise.all([
      writeSource(
        projectRoot,
        'src/main.tsx',
        [
          "import { createRoot } from 'react-dom/client';",
          "import App from './App';",
          'createRoot(document.body).render(<App />);',
        ].join('\n'),
      ),
      writeSource(
        projectRoot,
        'src/App.tsx',
        "import Dashboard from './pages/Dashboard'; export default function App() { return <Dashboard />; }",
      ),
      writeSource(
        projectRoot,
        'src/pages/Dashboard.tsx',
        "import CurrentCard from '../components/CurrentCard'; export default function Dashboard() { return <main><CurrentCard /></main>; }",
      ),
      writeSource(
        projectRoot,
        'src/components/CurrentCard.tsx',
        'export default function CurrentCard() { return <article>Current file</article>; }',
      ),
    ]);
    const documentPath = path.join(projectRoot, 'src/components/CurrentCard.tsx');
    const decoySnapshots: PreviewBuildRequest['dependencySnapshots'] = Object.freeze(
      Array.from({ length: 193 }, (_, index) =>
        Object.freeze({
          documentPath: path.join(projectRoot, `src/components/Decoy${index.toString()}.tsx`),
          language: 'tsx' as const,
          sourceText: `export default function Decoy${index.toString()}() { return null; }`,
        }),
      ),
    );
    const request: PreviewBuildRequest = {
      dependencySnapshots: decoySnapshots,
      documentPath,
      language: 'tsx',
      preparationMode: 'fast',
      renderMode: 'page-inspector',
      sourceText: await readFile(documentPath, 'utf8'),
      useStorybookPreview: false,
      workspaceRoot: projectRoot,
    };
    const getSourcePaths = vi.fn();
    const sourceByPath = new Map(
      decoySnapshots.map((snapshot) => [snapshot.documentPath, snapshot.sourceText] as const),
    );
    const cache = {
      discover: vi.fn(),
      getSourcePaths,
      readSourceText: vi.fn(({ sourcePath }: { readonly sourcePath: string }) =>
        Promise.resolve(sourceByPath.get(sourcePath)).then(
          (snapshot) => snapshot ?? readFile(sourcePath, 'utf8').catch(() => undefined),
        ),
      ),
    } as unknown as PreviewProjectUsageCache;

    const prepared = await preparePreviewCompilerUsage({
      cache,
      projectRoot,
      projectUsesNextRuntime: false,
      request,
      resolver: createResolverStub([...sources, ...sourceByPath.keys()]),
      setupKind: 'none',
      targetSelection: preparePreviewCompilerTarget(request),
      workspaceRoot: projectRoot,
    });

    expect(getSourcePaths).not.toHaveBeenCalled();
    expect(prepared.fastContextTruncated).toBe(true);
    expect(prepared.packageTargetUsageProps.inspectorPlan?.root.sourcePath).toBe(
      path.join(projectRoot, 'src/App.tsx'),
    );
  });

  /** Promotes a JSX-bearing hook's consuming component instead of publishing an empty gallery. */
  it('recovers a callable render contribution during fast preparation', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'prepare-fast-hook-page-'));
    temporaryRoots.push(projectRoot);
    const sources = await Promise.all([
      writeSource(
        projectRoot,
        'src/main.tsx',
        [
          "import { createRoot } from 'react-dom/client';",
          "import App from './App';",
          'createRoot(document.body).render(<App />);',
        ].join('\n'),
      ),
      writeSource(
        projectRoot,
        'src/App.tsx',
        [
          "import CompanyPage from './CompanyPage';",
          'export default function App() { return <CompanyPage />; }',
        ].join('\n'),
      ),
      writeSource(
        projectRoot,
        'src/CompanyPage.tsx',
        [
          "import { useChangePhoneModal } from './use-change-phone-modal';",
          'export default function CompanyPage() {',
          '  const modal = useChangePhoneModal();',
          '  return <main>{modal.renderModal()}</main>;',
          '}',
        ].join('\n'),
      ),
      writeSource(
        projectRoot,
        'src/use-change-phone-modal.tsx',
        [
          "import { default as gql } from 'graphql-tag';",
          'export const PHONE_MUTATION = gql`mutation Phone { editPhone }`;',
          'export const useChangePhoneModal = () => ({',
          '  renderModal: () => <aside>Change phone</aside>,',
          '});',
        ].join('\n'),
      ),
    ]);
    const documentPath = path.join(projectRoot, 'src/use-change-phone-modal.tsx');
    const sourceText = await readFile(documentPath, 'utf8');
    const request: PreviewBuildRequest = {
      dependencySnapshots: [],
      documentPath,
      language: 'tsx',
      preparationMode: 'fast',
      renderMode: 'page-inspector',
      sourceText,
      useStorybookPreview: false,
      workspaceRoot: projectRoot,
    };
    const getSourcePaths = vi.fn();
    const cache = {
      discover: vi.fn(),
      getSourcePaths,
      readSourceText: vi.fn(({ sourcePath }: { readonly sourcePath: string }) =>
        readFile(sourcePath, 'utf8').catch(() => undefined),
      ),
    } as unknown as PreviewProjectUsageCache;

    const prepared = await preparePreviewCompilerUsage({
      cache,
      projectRoot,
      projectUsesNextRuntime: false,
      request,
      resolver: createResolverStub(sources),
      setupKind: 'none',
      targetSelection: preparePreviewCompilerTarget(request),
      workspaceRoot: projectRoot,
    });

    const plan = prepared.packageTargetUsageProps.inspectorPlan;
    expect(getSourcePaths).not.toHaveBeenCalled();
    expect(plan?.contextModule?.sourcePath).toBe(documentPath);
    expect(plan?.target).toEqual({
      exportName: 'default',
      sourcePath: path.join(projectRoot, 'src/CompanyPage.tsx'),
    });
    expect(plan?.root.sourcePath).toBe(path.join(projectRoot, 'src/App.tsx'));
    expect(plan?.renderChain.reachability).toBe('entry-connected');
  });

  /** Connects one selected lazy gallery component without requesting the full package inventory. */
  it('promotes an auxiliary lazy component through its Next App page and implicit layouts', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'prepare-fast-next-example-'));
    temporaryRoots.push(projectRoot);
    const documentPath = await writeSource(
      projectRoot,
      'examples/base/button-demo.tsx',
      'export default function ButtonDemo() { return <button>Example</button>; }',
    );
    const registryPath = await writeSource(
      projectRoot,
      'examples/__components__.tsx',
      [
        ...Array.from(
          { length: 120 },
          (_, index) =>
            `export const choice${index.toString()} = () => import('./base/choice-${index.toString()}');`,
        ),
        "export const selected = () => import('./base/button-demo');",
      ].join('\n'),
    );
    const pagePath = await writeSource(
      projectRoot,
      'app/(view)/examples/[base]/[name]/page.tsx',
      [
        "import { selected } from '../../../../../examples/__components__';",
        'export default function Page() { return <main>{String(selected)}</main>; }',
      ].join('\n'),
    );
    const rootLayoutPath = await writeSource(
      projectRoot,
      'app/layout.tsx',
      'export default function RootLayout({ children }) { return <html><body>{children}</body></html>; }',
    );
    const viewLayoutPath = await writeSource(
      projectRoot,
      'app/(view)/layout.tsx',
      'export default function ViewLayout({ children }) { return <section>{children}</section>; }',
    );
    const decoyPaths = Array.from({ length: 120 }, (_, index) =>
      path.join(projectRoot, `examples/base/choice-${index.toString()}.tsx`),
    );
    const sourcePaths = [
      documentPath,
      registryPath,
      pagePath,
      rootLayoutPath,
      viewLayoutPath,
      ...decoyPaths,
    ];
    const sourceText = await readFile(documentPath, 'utf8');
    const request: PreviewBuildRequest = {
      dependencySnapshots: [],
      documentPath,
      language: 'tsx',
      preparationMode: 'fast',
      renderMode: 'page-inspector',
      sourceText,
      useStorybookPreview: false,
      workspaceRoot: projectRoot,
    };
    const getSourcePaths = vi.fn();
    const cache = {
      discover: vi.fn(),
      getSourcePaths,
      readSourceText: vi.fn(({ sourcePath }: { readonly sourcePath: string }) =>
        readFile(sourcePath, 'utf8').catch(() => undefined),
      ),
    } as unknown as PreviewProjectUsageCache;

    const prepared = await preparePreviewCompilerUsage({
      cache,
      projectRoot,
      projectUsesNextRuntime: true,
      request,
      resolver: createResolverStub(sourcePaths),
      setupKind: 'none',
      targetSelection: preparePreviewCompilerTarget(request),
      workspaceRoot: projectRoot,
    });

    const plan = prepared.packageTargetUsageProps.inspectorPlan;
    expect(getSourcePaths).not.toHaveBeenCalled();
    expect(plan?.root).toEqual({ exportName: 'default', sourcePath: pagePath });
    expect(plan?.target).toEqual({ exportName: 'default', sourcePath: documentPath });
    expect(plan?.contextModule).toBeUndefined();
    expect(plan?.dependencyPaths).toEqual(
      expect.arrayContaining([
        documentPath,
        registryPath,
        pagePath,
        rootLayoutPath,
        viewLayoutPath,
      ]),
    );
    const routeLocation = plan?.pageCandidates[0]?.routeLocation;
    if (routeLocation?.evidenceKind !== 'next-app-filesystem') {
      throw new Error('Expected a Next App Router page for the selected example.');
    }
    expect(routeLocation.pathname).toBe('/examples/base/button-demo');
    expect(routeLocation.params).toEqual({ base: 'base', name: 'button-demo' });
  });
});
