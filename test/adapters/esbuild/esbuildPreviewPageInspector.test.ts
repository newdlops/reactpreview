/** Proves the compiler mounts a real parent page graph only in Page Inspector mode. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('EsbuildPreviewCompiler Page Inspector', () => {
  /** Retains authored siblings, descendant CSS, Inspector metadata, and all ancestry watch files. */
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

      expect(javascript).toContain('SECTION_SIBLING');
      expect(javascript).toContain('PAGE_SIBLING');
      expect(javascript).toContain('React Page Inspector');
      expect(javascript).toContain('PAGE COMPONENT');
      expect(javascript).toContain('Mounted inside authored page root');
      expect(javascript).toContain('wrapPreviewInspectorTarget');
      expect(javascript).toContain('resolveRenderCondition');
      expect(javascript).toContain('resolveRuntimeHook');
      expect(javascript).toContain('"hookName": "useIsPageReady"');
      expect(javascript).toContain('"fallbackLabel": "generated boolean false"');
      expect(javascript).toContain('previewFetch');
      expect(javascript).toContain('/api/page');
      expect(javascript).toContain('TypeScript: PageData');
      expect(javascript).toContain('Auto payloads');
      expect(javascript).toContain('logical-and');
      expect(javascript).toContain('<Target>');
      expect(javascript).not.toContain('UNUSED_TARGET_MARKER');
      expect(Buffer.from(bundle.stylesheet ?? []).toString('utf8')).toContain('min-height: 100vh');
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

      expect(javascript).toContain('DirectPreviewTarget');
      expect(javascript).toContain('Target');
      const fallbackDiagnostic = bundle.diagnostics.find((diagnostic) =>
        diagnostic.message.includes('direct export fallback remains interactive'),
      );
      expect(fallbackDiagnostic?.severity).toBe('warning');
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  });
});
