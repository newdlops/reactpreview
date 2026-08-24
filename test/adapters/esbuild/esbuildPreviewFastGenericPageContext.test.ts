/** Verifies fast Page Inspector compiles a generic React application shell around the current file. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Writes one nested authored module and returns its absolute source identity. */
async function writeSource(
  rootPath: string,
  relativePath: string,
  sourceText: string,
): Promise<string> {
  const sourcePath = path.join(rootPath, relativePath);
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, sourceText, 'utf8');
  return sourcePath;
}

describe('EsbuildPreviewCompiler fast generic page context', () => {
  it('automatically owns the route leaf when a route choice strips the RouterProvider root', async () => {
    const projectRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/stripped-router-provider-context-'),
    );
    const compiler = new EsbuildPreviewCompiler();
    try {
      await writeFile(
        path.join(projectRoot, 'package.json'),
        '{"private":true,"dependencies":{"react-router-dom":"6.30.1"}}',
        'utf8',
      );
      await Promise.all([
        writeSource(
          projectRoot,
          'node_modules/react-router-dom/package.json',
          '{"name":"react-router-dom","version":"6.30.1","type":"module","exports":"./index.js"}',
        ),
        writeSource(
          projectRoot,
          'node_modules/react-router-dom/index.js',
          [
            'export function createBrowserRouter(routes) { return routes; }',
            'export function createRoutesFromElements(routes) { return routes; }',
            'export function MemoryRouter({ children }) { return children; }',
            'export function Route({ element }) { return element; }',
            'export function RouterProvider({ router }) { return router; }',
            'export function Routes({ children }) { return children; }',
          ].join('\n'),
        ),
        writeSource(
          projectRoot,
          'src/main.tsx',
          [
            "import { createRoot } from 'react-dom/client';",
            "import AppRouter from './App';",
            'createRoot(document.body).render(<AppRouter />);',
          ].join('\n'),
        ),
        writeSource(
          projectRoot,
          'src/CompanyApp.tsx',
          [
            "import { Route, Routes } from 'react-router-dom';",
            "import CompanyListPage from './CompanyListPage';",
            'export default function CompanyApp() {',
            '  return <Routes><Route index element={<CompanyListPage />} /></Routes>;',
            '}',
          ].join('\n'),
        ),
        writeSource(
          projectRoot,
          'src/CompanyListPage.tsx',
          'export default function CompanyListPage() { return <main>COMPANY_LIST_PAGE</main>; }',
        ),
      ]);
      const targetSource = [
        "import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider } from 'react-router-dom';",
        "import CompanyListPage from './CompanyListPage';",
        'const router = createBrowserRouter(createRoutesFromElements(',
        '  <Route path="/company" element={<CompanyListPage />} />,',
        '));',
        'export default function AppRouter() { return <RouterProvider router={router} />; }',
      ].join('\n');
      const targetPath = await writeSource(projectRoot, 'src/App.tsx', targetSource);

      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: targetPath,
        language: 'tsx',
        preparationMode: 'full',
        renderMode: 'page-inspector',
        sourceText: targetSource,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const javascript = Buffer.concat([
        Buffer.from(bundle.javascript),
        ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
      ]).toString('utf8');

      expect(javascript).toContain('COMPANY_LIST_PAGE');
      expect(bundle.dependencies).toContain(path.join(projectRoot, 'src/CompanyListPage.tsx'));
      expect(javascript).toContain('previewInspectorRoutePath = "/company"');
      expect(javascript).toContain('path: "/company"');
      expect(bundle.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual(
        [],
      );
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  }, 15_000);

  it('retains a parent Route context around a nested useRoutes owner', async () => {
    const projectRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/nested-use-routes-context-'),
    );
    const compiler = new EsbuildPreviewCompiler();
    try {
      await writeFile(
        path.join(projectRoot, 'package.json'),
        '{"private":true,"dependencies":{"react-router-dom":"6.30.1"}}',
        'utf8',
      );
      await Promise.all([
        writeSource(
          projectRoot,
          'node_modules/react-router-dom/package.json',
          '{"name":"react-router-dom","version":"6.30.1","type":"module","exports":"./index.js"}',
        ),
        writeSource(
          projectRoot,
          'node_modules/react-router-dom/index.js',
          [
            'export function MemoryRouter({ children }) { return children; }',
            'export function Route({ element }) { return element; }',
            'export function Routes({ children }) { return children; }',
            'export function useRoutes(routes) { return routes[0]?.element ?? null; }',
          ].join('\n'),
        ),
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
            "import { Route, Routes } from 'react-router-dom';",
            "import NestedOwner from './NestedOwner';",
            'export default function App() {',
            '  return <Routes><Route path="/root/*" element={<NestedOwner />} /></Routes>;',
            '}',
          ].join('\n'),
        ),
        writeSource(
          projectRoot,
          'src/NestedOwner.tsx',
          [
            "import { useRoutes } from 'react-router-dom';",
            "import ChildPage from './ChildPage';",
            'export default function NestedOwner() {',
            '  return useRoutes([{ path: "child", element: <ChildPage /> }]);',
            '}',
          ].join('\n'),
        ),
        writeSource(
          projectRoot,
          'src/ChildPage.tsx',
          [
            "import SelectedCard from './SelectedCard';",
            'export default function ChildPage() {',
            '  return <main data-child-page><SelectedCard /></main>;',
            '}',
          ].join('\n'),
        ),
      ]);
      const targetSource =
        'export default function SelectedCard() { return <article>NESTED_ROUTE_TARGET</article>; }';
      const targetPath = await writeSource(projectRoot, 'src/SelectedCard.tsx', targetSource);

      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: targetPath,
        language: 'tsx',
        preparationMode: 'full',
        renderMode: 'page-inspector',
        sourceText: targetSource,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const javascript = Buffer.concat([
        Buffer.from(bundle.javascript),
        ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
      ]).toString('utf8');

      expect(javascript).toContain('NESTED_ROUTE_TARGET');
      expect(javascript).toContain('initialEntries: ["/root/child"]');
      expect(javascript).toContain('path: "/root/*"');
      expect(javascript).not.toContain(
        'path: "/root/child", element: React.createElement(NestedOwner',
      );
      expect(bundle.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual(
        [],
      );
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  }, 15_000);

  it('bundles one fast shell while retaining partial coverage for omitted page candidates', async () => {
    const projectRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/fast-generic-page-context-'),
    );
    const compiler = new EsbuildPreviewCompiler();
    try {
      await writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8');
      await Promise.all([
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
            "import PageLayout from './layout/PageLayout';",
            "import BillingPage from './pages/BillingPage';",
            'export default function App() {',
            '  return <PageLayout><BillingPage /></PageLayout>;',
            '}',
          ].join('\n'),
        ),
        writeSource(
          projectRoot,
          'src/layout/PageLayout.tsx',
          [
            "import Header from './Header';",
            "import Sidebar from './Sidebar';",
            'export default function PageLayout({ children }) {',
            '  return <div><Header /><Sidebar /><main data-page-shell>{children}</main></div>;',
            '}',
          ].join('\n'),
        ),
        writeSource(
          projectRoot,
          'src/layout/Header.tsx',
          'export default function Header() { return <header>FAST_HEADER_MARKER</header>; }',
        ),
        writeSource(
          projectRoot,
          'src/layout/Sidebar.tsx',
          'export default function Sidebar() { return <nav>FAST_SIDEBAR_MARKER</nav>; }',
        ),
        writeSource(
          projectRoot,
          'src/pages/BillingPage.tsx',
          [
            "import SelectedCard from '../components/SelectedCard';",
            'export default function BillingPage() {',
            '  return <section>FAST_PAGE_MARKER<SelectedCard /></section>;',
            '}',
          ].join('\n'),
        ),
      ]);
      const targetSource =
        'export default function SelectedCard() { return <article>FAST_SELECTED_MARKER</article>; }';
      const targetPath = await writeSource(
        projectRoot,
        'src/components/SelectedCard.tsx',
        targetSource,
      );

      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: targetPath,
        language: 'tsx',
        preparationMode: 'fast',
        renderMode: 'page-inspector',
        sourceText: targetSource,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const javascript = Buffer.concat([
        Buffer.from(bundle.javascript),
        ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
      ]).toString('utf8');

      expect(bundle.contextCoverage).toBe('partial');
      expect(javascript).toContain('FAST_HEADER_MARKER');
      expect(javascript).toContain('FAST_SIDEBAR_MARKER');
      expect(javascript).toContain('FAST_PAGE_MARKER');
      expect(javascript).toContain('FAST_SELECTED_MARKER');
      expect(bundle.dependencies).toEqual(
        expect.arrayContaining([
          path.join(projectRoot, 'src/main.tsx'),
          path.join(projectRoot, 'src/App.tsx'),
          path.join(projectRoot, 'src/layout/PageLayout.tsx'),
          targetPath,
        ]),
      );
      expect(bundle.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual(
        [],
      );
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  }, 15_000);

  /**
   * A local consumer is a valid quick first paint, but without entry, route, or layout evidence it
   * must remain provisional so the panel still schedules complete application-context discovery.
   */
  it('keeps a fast local-consumer preview provisional without page-shell evidence', async () => {
    const projectRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/fast-local-consumer-context-'),
    );
    const compiler = new EsbuildPreviewCompiler();
    try {
      await writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8');
      await writeSource(
        projectRoot,
        'src/TargetConsumer.tsx',
        [
          "import TargetCard from './TargetCard';",
          'export default function TargetConsumer() {',
          '  return <section>LOCAL_CONSUMER_MARKER<TargetCard /></section>;',
          '}',
        ].join('\n'),
      );
      const targetSource =
        'export default function TargetCard() { return <article>LOCAL_TARGET_MARKER</article>; }';
      const targetPath = await writeSource(projectRoot, 'src/TargetCard.tsx', targetSource);

      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: targetPath,
        language: 'tsx',
        preparationMode: 'fast',
        renderMode: 'page-inspector',
        sourceText: targetSource,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const javascript = Buffer.concat([
        Buffer.from(bundle.javascript),
        ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
      ]).toString('utf8');

      expect(javascript).toContain('LOCAL_CONSUMER_MARKER');
      expect(javascript).toContain('LOCAL_TARGET_MARKER');
      expect(bundle.contextCoverage).toBe('partial');
      expect(bundle.dependencies).toEqual(
        expect.arrayContaining([path.join(projectRoot, 'src/TargetConsumer.tsx'), targetPath]),
      );
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  }, 15_000);

  /**
   * Renders a hook/factory module through a useful consuming page, but keeps enrichment pending
   * until the application checkpoint above that consumer is the actual mounted root.
   */
  it('keeps a callable-export consumer provisional below its application checkpoint', async () => {
    const projectRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/fast-generic-hook-context-'),
    );
    const compiler = new EsbuildPreviewCompiler();
    try {
      await writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8');
      await Promise.all([
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
            '  return <main>FAST_HOOK_PAGE_MARKER{modal.renderModal()}</main>;',
            '}',
          ].join('\n'),
        ),
      ]);
      const targetSource = [
        'export const useChangePhoneModal = () => ({',
        '  renderModal: () => <aside>FAST_HOOK_JSX_MARKER</aside>,',
        '});',
      ].join('\n');
      const targetPath = await writeSource(
        projectRoot,
        'src/use-change-phone-modal.tsx',
        targetSource,
      );

      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: targetPath,
        language: 'tsx',
        preparationMode: 'fast',
        renderMode: 'page-inspector',
        sourceText: targetSource,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const javascript = Buffer.concat([
        Buffer.from(bundle.javascript),
        ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
      ]).toString('utf8');

      expect(bundle.contextCoverage).toBe('partial');
      expect(javascript).toContain('FAST_HOOK_PAGE_MARKER');
      expect(javascript).toContain('FAST_HOOK_JSX_MARKER');
      expect(bundle.dependencies).toContain(path.join(projectRoot, 'src/CompanyPage.tsx'));
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  }, 15_000);
});
