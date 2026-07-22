/** Proves full Page Inspector builds can mount a Next page for a non-component editor module. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('EsbuildPreviewCompiler Next App module context', () => {
  /** Loads the real page and layout while keeping the selected registry as a page dependency. */
  it('previews a lower-camel registry through its consuming authored page', async () => {
    const projectRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/next-app-module-context-'),
    );
    const appDirectory = path.join(projectRoot, 'app');
    const pageDirectory = path.join(appDirectory, 'dashboard');
    const libraryDirectory = path.join(projectRoot, 'lib');
    const layoutPath = path.join(appDirectory, 'layout.tsx');
    const pagePath = path.join(pageDirectory, 'page.tsx');
    const modulePath = path.join(libraryDirectory, 'page-registry.tsx');
    const moduleSource = "export const pageRegistry = { title: 'MODULE_CONTEXT_VALUE' } as const;";
    const compiler = new EsbuildPreviewCompiler();
    try {
      await Promise.all([
        mkdir(pageDirectory, { recursive: true }),
        mkdir(libraryDirectory, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(
          layoutPath,
          "export default function Layout({ children }) { return <div data-shell='ROOT_LAYOUT_MARKER'>{children}</div>; }",
          'utf8',
        ),
        writeFile(
          pagePath,
          [
            "import { pageRegistry } from '../../lib/page-registry';",
            "export default function DashboardPage() { return <main data-page='DASHBOARD_PAGE_MARKER'>{pageRegistry.title}</main>; }",
          ].join('\n'),
          'utf8',
        ),
        writeFile(modulePath, moduleSource, 'utf8'),
      ]);

      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: modulePath,
        language: 'tsx',
        renderMode: 'page-inspector',
        sourceText: moduleSource,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const javascript = Buffer.concat([
        Buffer.from(bundle.javascript),
        ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
      ]).toString('utf8');

      expect(javascript).toContain('ROOT_LAYOUT_MARKER');
      expect(javascript).toContain('DASHBOARD_PAGE_MARKER');
      expect(javascript).toContain('MODULE_CONTEXT_VALUE');
      expect(javascript).toContain('import-chain');
      expect(javascript).toContain('The selected module participates in this authored Next page');
      expect(javascript).not.toContain('direct-target:default');
      expect(bundle.dependencies).toEqual(
        expect.arrayContaining([layoutPath, modulePath, pagePath]),
      );
      expect(
        bundle.diagnostics.some((diagnostic) =>
          diagnostic.message.includes('could not prove an exported ancestor'),
        ),
      ).toBe(false);
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Keeps a proven consuming page when an ALL_CAPS value looks like a legacy component fallback. */
  it('does not replace a low-confidence export context with ordinary ancestor discovery', async () => {
    const projectRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/next-app-module-context-'),
    );
    const appDirectory = path.join(projectRoot, 'app');
    const pageDirectory = path.join(appDirectory, 'settings');
    const modulePath = path.join(projectRoot, 'settings-constants.tsx');
    const moduleSource = "export const SETTINGS_CONFIG = { title: 'SETTINGS_CONTEXT_VALUE' };";
    const compiler = new EsbuildPreviewCompiler();
    try {
      await mkdir(pageDirectory, { recursive: true });
      await Promise.all([
        writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(
          path.join(appDirectory, 'layout.tsx'),
          "export default function Layout({ children }) { return <div data-shell='SETTINGS_LAYOUT'>{children}</div>; }",
          'utf8',
        ),
        writeFile(
          path.join(pageDirectory, 'page.tsx'),
          [
            "import { SETTINGS_CONFIG } from '../../settings-constants';",
            "export default function SettingsPage() { return <main data-page='SETTINGS_PAGE'>{SETTINGS_CONFIG.title}</main>; }",
          ].join('\n'),
          'utf8',
        ),
        writeFile(modulePath, moduleSource, 'utf8'),
      ]);

      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: modulePath,
        language: 'tsx',
        renderMode: 'page-inspector',
        sourceText: moduleSource,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const javascript = Buffer.concat([
        Buffer.from(bundle.javascript),
        ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
      ]).toString('utf8');

      expect(javascript).toContain('SETTINGS_LAYOUT');
      expect(javascript).toContain('SETTINGS_PAGE');
      expect(javascript).toContain('SETTINGS_CONTEXT_VALUE');
      expect(javascript).toContain('The selected module participates in this authored Next page');
      expect(javascript).not.toContain('direct-target:SETTINGS_CONFIG');
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Escalates only after a shared package misses, then mounts the sibling app consuming it. */
  it('finds a consuming Next page across monorepo package boundaries', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/next-app-module-workspace-'),
    );
    const sharedDirectory = path.join(workspaceRoot, 'packages', 'shared');
    const appDirectory = path.join(workspaceRoot, 'apps', 'site', 'app');
    const pageDirectory = path.join(appDirectory, 'dashboard');
    const modulePath = path.join(sharedDirectory, 'registry.tsx');
    const moduleSource =
      "const registry = { title: 'MONOREPO_CONTEXT_VALUE' };\nexport default registry;";
    const compiler = new EsbuildPreviewCompiler();
    try {
      await Promise.all([
        mkdir(sharedDirectory, { recursive: true }),
        mkdir(pageDirectory, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(
          path.join(workspaceRoot, 'package.json'),
          '{"private":true,"workspaces":["apps/*","packages/*"]}',
          'utf8',
        ),
        writeFile(
          path.join(sharedDirectory, 'package.json'),
          '{"name":"@fixture/shared","private":true}',
          'utf8',
        ),
        writeFile(
          path.join(workspaceRoot, 'apps', 'site', 'package.json'),
          '{"name":"fixture-site","private":true}',
          'utf8',
        ),
        writeFile(
          path.join(appDirectory, 'layout.tsx'),
          "export default function Layout({ children }) { return <div data-shell='MONOREPO_LAYOUT'>{children}</div>; }",
          'utf8',
        ),
        writeFile(
          path.join(pageDirectory, 'page.tsx'),
          [
            "import registry from '../../../../packages/shared/registry';",
            "export default function DashboardPage() { return <main data-page='MONOREPO_PAGE'>{registry.title}</main>; }",
          ].join('\n'),
          'utf8',
        ),
        writeFile(modulePath, moduleSource, 'utf8'),
      ]);

      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: modulePath,
        language: 'tsx',
        renderMode: 'page-inspector',
        sourceText: moduleSource,
        useStorybookPreview: false,
        workspaceRoot,
      });
      const javascript = Buffer.concat([
        Buffer.from(bundle.javascript),
        ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
      ]).toString('utf8');

      expect(javascript).toContain('MONOREPO_LAYOUT');
      expect(javascript).toContain('MONOREPO_PAGE');
      expect(javascript).toContain('MONOREPO_CONTEXT_VALUE');
      expect(javascript).toContain('The selected module participates in this authored Next page');
    } finally {
      await compiler.shutdown();
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Shows a Next loading module as a real route state surrounded by its authored layouts. */
  it('previews a conventional loading file at page scale', async () => {
    const projectRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/next-app-route-state-'),
    );
    const appDirectory = path.join(projectRoot, 'app');
    const pageDirectory = path.join(appDirectory, 'dashboard');
    const loadingPath = path.join(pageDirectory, 'loading.tsx');
    const loadingSource =
      "export default function Loading() { return <p data-state='LOADING_STATE_MARKER'>Loading</p>; }";
    const compiler = new EsbuildPreviewCompiler();
    try {
      await mkdir(pageDirectory, { recursive: true });
      await Promise.all([
        writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(
          path.join(appDirectory, 'layout.tsx'),
          "export default function Layout({ children }) { return <div data-shell='LOADING_LAYOUT_MARKER'>{children}</div>; }",
          'utf8',
        ),
        writeFile(
          path.join(pageDirectory, 'page.tsx'),
          "export default function Page() { return <main data-page='AUTHORED_PAGE_MARKER'>Ready</main>; }",
          'utf8',
        ),
        writeFile(loadingPath, loadingSource, 'utf8'),
      ]);

      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: loadingPath,
        language: 'tsx',
        renderMode: 'page-inspector',
        sourceText: loadingSource,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const javascript = Buffer.concat([
        Buffer.from(bundle.javascript),
        ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
      ]).toString('utf8');

      expect(javascript).toContain('LOADING_LAYOUT_MARKER');
      expect(javascript).toContain('LOADING_STATE_MARKER');
      expect(javascript).toContain('direct-target:default');
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  });
});
