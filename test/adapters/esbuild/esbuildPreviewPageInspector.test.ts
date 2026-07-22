/** Proves the compiler mounts a real parent page graph only in Page Inspector mode. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';
import { installFakeStyledComponentsPackage } from './support/fakeStyledComponentsPackage';
import { decodePreviewBundleStyles } from './support/previewBundleStyles';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('EsbuildPreviewCompiler Page Inspector', () => {
  /** Retains page context plus lazy current-file exports, CSS, metadata, and ancestry watch files. */
  it('bundles the actual exported ancestor while instrumenting the selected target', async () => {
    const projectRoot = await mkdtemp(path.join(REPOSITORY_ROOT, 'test/fixtures/page-inspector-'));
    const sourceDirectory = path.join(projectRoot, 'src');
    const targetPath = path.join(sourceDirectory, 'Target.tsx');
    const sectionPath = path.join(sourceDirectory, 'Section.tsx');
    const pagePath = path.join(sourceDirectory, 'Page.tsx');
    const targetSource = [
      'export function Target({ enabled = false, label = "target" }) {',
      '  return <button data-enabled={enabled}>{enabled ? label : "off"}</button>;',
      '}',
      'export function UnusedTargetSibling() { return <i>UNUSED_TARGET_MARKER</i>; }',
    ].join('\n');
    const compiler = new EsbuildPreviewCompiler();
    try {
      await mkdir(sourceDirectory, { recursive: true });
      await Promise.all([
        writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(targetPath, targetSource, 'utf8'),
        writeFile(
          sectionPath,
          [
            "import { Target } from './Target';",
            'export function Section({ visible = true }) {',
            '  return <section><h2>SECTION_SIBLING</h2>{visible && <Target enabled label="live" />}</section>;',
            '}',
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          pagePath,
          [
            "import './page.css';",
            "import { Section } from './Section';",
            'interface PageData { id: string; title: string; published: boolean }',
            "async function loadPageData() { const response = await fetch('/api/page');",
            '  return (await response.json()) as PageData; }',
            "function useIsPageReady() { throw new Error('runtime provider unavailable'); }",
            'export function Page({ show = true }) {',
            '  const isPageReady = useIsPageReady();',
            '  return <main data-ready={isPageReady}>{show ? <Section /> : <p>hidden</p>}<aside onClick={loadPageData}>PAGE_SIBLING</aside></main>;',
            '}',
          ].join('\n'),
          'utf8',
        ),
        writeFile(path.join(sourceDirectory, 'page.css'), 'main { min-height: 100vh; }', 'utf8'),
      ]);

      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: targetPath,
        language: 'tsx',
        renderMode: 'page-inspector',
        sourceText: targetSource,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const javascript = Buffer.concat([
        Buffer.from(bundle.javascript),
        ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
      ]).toString('utf8');
      const entryJavascript = Buffer.from(bundle.javascript).toString('utf8');

      expect(javascript).toContain('SECTION_SIBLING');
      expect(javascript).toContain('PAGE_SIBLING');
      expect(javascript).toContain('React Page Inspector');
      expect(javascript).toContain('PAGE COMPONENT');
      expect(javascript).toContain('Mounted inside authored page root');
      expect(javascript).toContain('wrapPreviewInspectorTarget');
      expect(javascript).toContain('resolveRenderCondition');
      expect(javascript).toContain('resolveRenderChoice');
      expect(javascript).toContain('resolveRuntimeHook');
      expect(javascript).toContain('"hookName": "useIsPageReady"');
      expect(javascript).toContain('"fallbackLabel": "generated boolean false"');
      expect(javascript).toContain('previewFetch');
      expect(javascript).toContain('/api/page');
      expect(javascript).toContain('TypeScript: PageData');
      expect(javascript).toContain('Auto payloads');
      expect(javascript).toContain('logical-and');
      expect(javascript).toContain('<Target>');
      // Inspector output is intentionally coalesced before esbuild allocates thousands of files.
      // Dynamic-import initializers remain lazy even though their code shares the entry artifact.
      expect(bundle.chunks).toHaveLength(0);
      expect(entryJavascript).toContain('UNUSED_TARGET_MARKER');
      expect(javascript).toContain('UNUSED_TARGET_MARKER');
      expect(javascript).toContain('selected-direct-target:UnusedTargetSibling');
      expect(decodePreviewBundleStyles(bundle)).toContain('min-height: 100vh');
      expect(bundle.dependencies).toEqual(
        expect.arrayContaining([targetPath, sectionPath, pagePath]),
      );
      expect(
        bundle.dependencies.filter(
          (dependency) =>
            dependency.includes('react-preview-inspector') ||
            dependency.includes('react-preview-page-inspector'),
        ),
      ).toEqual([]);
      expect(bundle.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual(
        [],
      );
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Prevents a nested async server component from creating fresh client suspension promises. */
  it('bundles nested async JSX through a stable one-shot Suspense adapter', async () => {
    const projectRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/page-inspector-async-component-'),
    );
    const sourceDirectory = path.join(projectRoot, 'src');
    const targetPath = path.join(sourceDirectory, 'AsyncTarget.tsx');
    const pagePath = path.join(sourceDirectory, 'Page.tsx');
    const targetSource = [
      'export async function AsyncTarget({ children }) {',
      '  await new Promise(() => undefined);',
      '  return <section>ASYNC_BODY_SHOULD_NOT_REACH_CLIENT{children}</section>;',
      '}',
      'export function LocalOwner() {',
      '  return <AsyncTarget><span>AUTHORED_CHILD</span></AsyncTarget>;',
      '}',
    ].join('\n');
    const compiler = new EsbuildPreviewCompiler();
    try {
      await mkdir(sourceDirectory, { recursive: true });
      await Promise.all([
        writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(targetPath, targetSource, 'utf8'),
        writeFile(
          pagePath,
          [
            "import { LocalOwner } from './AsyncTarget';",
            'export function Page() {',
            '  return <main><h1>PAGE_SHELL</h1><LocalOwner /></main>;',
            '}',
          ].join('\n'),
          'utf8',
        ),
      ]);

      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: targetPath,
        language: 'tsx',
        renderMode: 'page-inspector',
        sourceText: targetSource,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const javascript = Buffer.concat([
        Buffer.from(bundle.javascript),
        ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
      ]).toString('utf8');

      expect(javascript).toContain('PAGE_SHELL');
      expect(javascript).toContain('AUTHORED_CHILD');
      expect(javascript).toContain('data-react-preview-async-component');
      expect(javascript).toContain('AsyncTarget');
      expect(javascript).toContain('ASYNC_BODY_SHOULD_NOT_REACH_CLIENT');
      expect(javascript).toContain('throw record.promise');
      expect(javascript).toContain('Promise.resolve().then(load)');
      expect(bundle.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual(
        [],
      );
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Eagerly carries exact page theme and authored HTML selector attributes across lazy roots. */
  it('preserves the application style context before rendering a lazy page candidate', async () => {
    const projectRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/page-inspector-styles-'),
    );
    const sourceDirectory = path.join(projectRoot, 'src');
    const targetPath = path.join(sourceDirectory, 'Target.tsx');
    const providerPath = path.join(sourceDirectory, 'Provider.tsx');
    const appPath = path.join(sourceDirectory, 'App.tsx');
    const entryPath = path.join(sourceDirectory, 'index.tsx');
    const themePath = path.join(sourceDirectory, 'theme.ts');
    const htmlPath = path.join(projectRoot, 'public', 'index.html');
    const targetSource = 'export function Target() { return <button>STYLED_TARGET</button>; }';
    const compiler = new EsbuildPreviewCompiler();
    try {
      await Promise.all([
        mkdir(sourceDirectory, { recursive: true }),
        mkdir(path.dirname(htmlPath), { recursive: true }),
      ]);
      await installFakeStyledComponentsPackage(projectRoot);
      await Promise.all([
        writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(
          path.join(projectRoot, 'tsconfig.json'),
          JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@theme': ['src/theme'] } } }),
          'utf8',
        ),
        writeFile(targetPath, targetSource, 'utf8'),
        writeFile(
          themePath,
          "export const theme = { marker: 'EXACT_CORRIDOR_THEME', color: { primary: '#123456' } };",
          'utf8',
        ),
        writeFile(
          providerPath,
          [
            "import { ThemeProvider } from 'styled-components';",
            "import { theme as defaultTheme } from './theme';",
            'export function Provider({ children }) {',
            '  return <ThemeProvider theme={defaultTheme}>{children}</ThemeProvider>;',
            '}',
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          appPath,
          [
            "import styled from 'styled-components';",
            "import { theme } from '@theme';",
            "import { Provider } from './Provider';",
            "import { Target } from './Target';",
            'const Header = styled.header`color: ${theme.color.primary};`;',
            'export function App() {',
            '  return <Provider><main><Header>PAGE_HEADER</Header><Target /></main></Provider>;',
            '}',
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          entryPath,
          "import { createRoot } from 'react-dom/client'; import { App } from './App'; createRoot(document.getElementById('root')).render(<App />);",
          'utf8',
        ),
        writeFile(
          htmlPath,
          '<!doctype html><html lang="ko"><body class="body normal"><div id="root" class="application-root"></div></body></html>',
          'utf8',
        ),
      ]);

      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: targetPath,
        language: 'tsx',
        renderMode: 'page-inspector',
        sourceText: targetSource,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const entryJavascript = Buffer.from(bundle.javascript).toString('utf8');
      const allJavascript = Buffer.concat([
        Buffer.from(bundle.javascript),
        ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
      ]).toString('utf8');

      expect(allJavascript).toContain('EXACT_CORRIDOR_THEME');
      expect(allJavascript).toMatch(/previewTheme\s*=\s*theme/u);
      expect(entryJavascript).toContain('body normal');
      expect(entryJavascript).toContain('application-root');
      expect(bundle.dependencies).toEqual(
        expect.arrayContaining([appPath, entryPath, htmlPath, providerPath, targetPath, themePath]),
      );
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Restricts bootstrap-global discovery to the proven page corridor in oversized applications. */
  it('injects an entry-provided global despite unrelated evidence-budget noise', async () => {
    const projectRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/page-inspector-globals-'),
    );
    const sourceDirectory = path.join(projectRoot, 'src');
    const targetPath = path.join(sourceDirectory, 'Target.tsx');
    const appPath = path.join(sourceDirectory, 'App.tsx');
    const entryPath = path.join(sourceDirectory, 'index.tsx');
    const globalModulePath = path.join(sourceDirectory, 'preview-clock.ts');
    const targetSource = [
      'declare const previewClock: () => string;',
      'export function Target() { return <strong>{previewClock()}</strong>; }',
    ].join('\n');
    const noiseSource = [
      "import value from './preview-clock';",
      ...Array.from(
        { length: 513 },
        (_, index) => `globalThis.unrelatedGlobal${index.toString()} = value;`,
      ),
    ].join('\n');
    const compiler = new EsbuildPreviewCompiler();

    try {
      await mkdir(sourceDirectory, { recursive: true });
      await Promise.all([
        writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(targetPath, targetSource, 'utf8'),
        writeFile(
          appPath,
          "import { Target } from './Target'; export function App() { return <main><Target /></main>; }",
          'utf8',
        ),
        writeFile(
          entryPath,
          [
            "import { createRoot } from 'react-dom/client';",
            "import previewClock from './preview-clock';",
            "import { App } from './App';",
            'globalThis.previewClock = previewClock;',
            'createRoot(document.body).render(<App />);',
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          globalModulePath,
          "export default function previewClock() { return 'GLOBAL_CLOCK_VALUE'; }",
          'utf8',
        ),
        writeFile(path.join(sourceDirectory, 'aaa-unrelated.ts'), noiseSource, 'utf8'),
      ]);

      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: targetPath,
        language: 'tsx',
        renderMode: 'page-inspector',
        sourceText: targetSource,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const javascript = Buffer.concat([
        Buffer.from(bundle.javascript),
        ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
      ]).toString('utf8');

      expect(javascript).toContain('GLOBAL_CLOCK_VALUE');
      expect(bundle.dependencies).toEqual(
        expect.arrayContaining([appPath, entryPath, globalModulePath, targetPath]),
      );
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Climbs from a shared package into a sibling app through that app's nearest tsconfig alias. */
  it('finds the authored page root across a monorepo workspace package boundary', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/page-inspector-monorepo-'),
    );
    const uiRoot = path.join(workspaceRoot, 'packages', 'ui');
    const appRoot = path.join(workspaceRoot, 'packages', 'app');
    const targetPath = path.join(uiRoot, 'src', 'Target.tsx');
    const barrelPath = path.join(uiRoot, 'src', 'index.ts');
    const pagePath = path.join(appRoot, 'src', 'App.tsx');
    const targetSource =
      'export function Target({ label = "target" }) { return <button>{label}</button>; }';
    const compiler = new EsbuildPreviewCompiler();
    try {
      await Promise.all([
        mkdir(path.dirname(targetPath), { recursive: true }),
        mkdir(path.dirname(pagePath), { recursive: true }),
      ]);
      await Promise.all([
        writeFile(
          path.join(workspaceRoot, 'package.json'),
          JSON.stringify({ private: true, workspaces: ['packages/*'] }),
          'utf8',
        ),
        writeFile(path.join(uiRoot, 'package.json'), JSON.stringify({ private: true }), 'utf8'),
        writeFile(path.join(appRoot, 'package.json'), JSON.stringify({ private: true }), 'utf8'),
        writeFile(
          path.join(appRoot, 'tsconfig.json'),
          JSON.stringify({
            compilerOptions: { baseUrl: '.', paths: { '@design': ['../ui/src/index.ts'] } },
          }),
          'utf8',
        ),
        writeFile(targetPath, targetSource, 'utf8'),
        writeFile(barrelPath, "export { Target } from './Target';", 'utf8'),
        writeFile(
          pagePath,
          [
            "import { Target } from '@design';",
            'export function App() {',
            '  return <main><Target label="aliased" /><aside>MONOREPO_PAGE_SIBLING</aside></main>;',
            '}',
          ].join('\n'),
          'utf8',
        ),
      ]);

      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: targetPath,
        language: 'tsx',
        renderMode: 'page-inspector',
        sourceText: targetSource,
        useStorybookPreview: false,
        workspaceRoot,
      });
      const javascript = Buffer.concat([
        Buffer.from(bundle.javascript),
        ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
      ]).toString('utf8');

      expect(javascript).toContain('MONOREPO_PAGE_SIBLING');
      expect(javascript).toContain('wrapPreviewInspectorTarget');
      expect(bundle.dependencies).toEqual(
        expect.arrayContaining([barrelPath, targetPath, pagePath]),
      );
    } finally {
      await compiler.shutdown();
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Bundles alternative callers as independently activated roots inside one bounded artifact. */
  it('keeps mount-distinct caller pages selectable in coalesced inspector output', async () => {
    const projectRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/page-inspector-candidates-'),
    );
    const sourceDirectory = path.join(projectRoot, 'src');
    const targetPath = path.join(sourceDirectory, 'Target.tsx');
    const publicPagePath = path.join(sourceDirectory, 'PublicPage.tsx');
    const staffPagePath = path.join(sourceDirectory, 'StaffPage.tsx');
    const targetSource = 'export function Target() { return <button>SHARED_TARGET</button>; }';
    const compiler = new EsbuildPreviewCompiler();
    try {
      await mkdir(sourceDirectory, { recursive: true });
      await Promise.all([
        writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(targetPath, targetSource, 'utf8'),
        writeFile(
          publicPagePath,
          "import { Target } from './Target'; export function PublicPage() { return <main>PUBLIC_PAGE_CONTEXT<Target /></main>; }",
          'utf8',
        ),
        writeFile(
          staffPagePath,
          "import { Target } from './Target'; export function StaffPage() { return <main>STAFF_PAGE_CONTEXT<Target /></main>; }",
          'utf8',
        ),
        writeFile(
          path.join(sourceDirectory, 'public-main.tsx'),
          "import { createRoot } from 'react-dom/client'; import { PublicPage } from './PublicPage'; createRoot(document.body).render(<PublicPage />);",
          'utf8',
        ),
        writeFile(
          path.join(sourceDirectory, 'staff-main.tsx'),
          "import { createRoot } from 'react-dom/client'; import { StaffPage } from './StaffPage'; createRoot(document.body).render(<StaffPage />);",
          'utf8',
        ),
      ]);

      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: targetPath,
        language: 'tsx',
        renderMode: 'page-inspector',
        sourceText: targetSource,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const entryJavascript = Buffer.from(bundle.javascript).toString('utf8');
      const allJavascript = Buffer.concat([
        Buffer.from(bundle.javascript),
        ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
      ]).toString('utf8');

      expect(bundle.chunks).toHaveLength(0);
      expect(entryJavascript).toContain('PUBLIC_PAGE_CONTEXT');
      expect(entryJavascript).toContain('STAFF_PAGE_CONTEXT');
      expect(allJavascript).toContain('PUBLIC_PAGE_CONTEXT');
      expect(allJavascript).toContain('STAFF_PAGE_CONTEXT');
      expect(allJavascript).toContain('Authored page caller path');
      expect(allJavascript).toContain('PublicPage');
      expect(allJavascript).toContain('StaffPage');
      expect(bundle.dependencies).toEqual(
        expect.arrayContaining([targetPath, publicPagePath, staffPagePath]),
      );
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Turns an export-less ReactDOM bootstrap into one safe authored-page Inspector root. */
  it('previews a private App mounted by an imperative createRoot entry', async () => {
    const projectRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/page-inspector-entry-'),
    );
    const sourceDirectory = path.join(projectRoot, 'src');
    const entryPath = path.join(sourceDirectory, 'index.tsx');
    const entrySource = [
      "import * as ReactDOMClient from 'react-dom/client';",
      'const root = ReactDOMClient.createRoot(document.getElementById("root")!);',
      'function App() { return <main><h1>IMPERATIVE_ENTRY_PAGE</h1></main>; }',
      'root.render(<App />);',
    ].join('\n');
    const compiler = new EsbuildPreviewCompiler();
    try {
      await mkdir(sourceDirectory, { recursive: true });
      await Promise.all([
        writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(entryPath, entrySource, 'utf8'),
      ]);

      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: entryPath,
        language: 'tsx',
        renderMode: 'page-inspector',
        sourceText: entrySource,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const javascript = Buffer.concat([
        Buffer.from(bundle.javascript),
        ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
      ]).toString('utf8');

      expect(javascript).toContain('IMPERATIVE_ENTRY_PAGE');
      expect(javascript).toContain('ReactPreviewImperativeEntryRoot');
      expect(javascript).toContain('wrapPreviewInspectorTarget');
      expect(
        bundle.diagnostics.some((diagnostic) =>
          diagnostic.message.includes('could not prove an exported ancestor'),
        ),
      ).toBe(false);
      expect(bundle.dependencies).toContain(entryPath);
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Keeps wildcard-only barrels interactive while clearly reporting missing ancestor evidence. */
  it('uses an actionable direct-root fallback when static export identity is unavailable', async () => {
    const projectRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/page-inspector-wildcard-'),
    );
    const sourceDirectory = path.join(projectRoot, 'src');
    const targetPath = path.join(sourceDirectory, 'Target.tsx');
    const barrelPath = path.join(sourceDirectory, 'index.ts');
    const barrelSource = "export * from './Target';";
    const compiler = new EsbuildPreviewCompiler();
    try {
      await mkdir(sourceDirectory, { recursive: true });
      await Promise.all([
        writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(
          targetPath,
          'export function Target({ active = false }) { return <b>{String(active)}</b>; }',
          'utf8',
        ),
        writeFile(barrelPath, barrelSource, 'utf8'),
      ]);

      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: barrelPath,
        language: 'ts',
        renderMode: 'page-inspector',
        sourceText: barrelSource,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const javascript = Buffer.concat([
        Buffer.from(bundle.javascript),
        ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
      ]).toString('utf8');

      expect(javascript).toContain('PreviewInspectorRoutedDirectTarget');
      expect(javascript).toContain('Target');
      const fallbackDiagnostic = bundle.diagnostics.find((diagnostic) =>
        diagnostic.message.includes('direct export fallback remains interactive'),
      );
      expect(fallbackDiagnostic?.severity).toBe('warning');
      const repeatedBundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: barrelPath,
        language: 'ts',
        renderMode: 'page-inspector',
        sourceText: barrelSource,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      expect(
        repeatedBundle.diagnostics.some((diagnostic) =>
          diagnostic.message.includes('direct export fallback remains interactive'),
        ),
      ).toBe(false);
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  });
});
