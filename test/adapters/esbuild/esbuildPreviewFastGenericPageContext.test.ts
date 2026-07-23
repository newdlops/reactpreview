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

  /** Renders a hook/factory module through its real consuming page instead of an empty gallery. */
  it('bundles JSX-bearing callable exports as page render contributions', async () => {
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

      expect(bundle.contextCoverage).toBe('complete');
      expect(javascript).toContain('FAST_HOOK_PAGE_MARKER');
      expect(javascript).toContain('FAST_HOOK_JSX_MARKER');
      expect(bundle.dependencies).toContain(path.join(projectRoot, 'src/CompanyPage.tsx'));
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  }, 15_000);
});
