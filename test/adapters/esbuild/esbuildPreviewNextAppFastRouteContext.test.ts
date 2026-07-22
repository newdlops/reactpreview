/** Proves cold Next App previews install a single bounded page corridor before bundling begins. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Joins every emitted JavaScript artifact so corridor assertions remain split-mode independent. */
function readBundleJavaScript(
  bundle: Awaited<ReturnType<EsbuildPreviewCompiler['compile']>>,
): string {
  return Buffer.concat([
    Buffer.from(bundle.javascript),
    ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
  ]).toString('utf8');
}

describe('EsbuildPreviewCompiler fast Next App route context', () => {
  /** A direct dynamic page retains its layouts while a broad unrelated lazy registry is omitted. */
  it('prunes deferred branches outside the fast direct-page corridor', async () => {
    const projectRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/next-app-fast-page-'),
    );
    const pageDirectory = path.join(projectRoot, 'app', 'products', '[slug]');
    const branchDirectory = path.join(projectRoot, 'lib', 'branches');
    const pagePath = path.join(pageDirectory, 'page.tsx');
    const pageSource = [
      "import { loaders } from '../../../lib/generated';",
      "import { useParams, usePathname } from 'next/navigation';",
      "export function generateStaticParams() { return [{ slug: 'selected' }]; }",
      'export default function ProductPage() {',
      '  const params = useParams();',
      '  const pathname = usePathname();',
      "  return <main data-page='FAST_DIRECT_PAGE'>{pathname}:{params.slug}:{loaders.length}</main>;",
      '}',
    ].join('\n');
    const compiler = new EsbuildPreviewCompiler();

    try {
      await Promise.all([
        mkdir(pageDirectory, { recursive: true }),
        mkdir(branchDirectory, { recursive: true }),
      ]);
      const branchFiles = Array.from({ length: 30 }, (_, index) =>
        path.join(branchDirectory, `branch-${index.toString()}.tsx`),
      );
      await Promise.all([
        writeFile(
          path.join(projectRoot, 'package.json'),
          '{"private":true,"dependencies":{"next":"15.5.20"}}',
          'utf8',
        ),
        writeFile(
          path.join(projectRoot, 'app', 'layout.tsx'),
          [
            "import { useSearchParams } from 'next/navigation.js';",
            'export default function Layout({ children }) {',
            '  const searchParams = useSearchParams();',
            "  return <div data-layout='FAST_ROOT_LAYOUT' data-query={searchParams.toString()}>{children}</div>;",
            '}',
          ].join('\n'),
          'utf8',
        ),
        writeFile(pagePath, pageSource, 'utf8'),
        writeFile(
          path.join(projectRoot, 'lib', 'generated.ts'),
          [
            'export const loaders = [',
            ...branchFiles.map(
              (_, index) => `  () => import('./branches/branch-${index.toString()}'),`,
            ),
            '];',
          ].join('\n'),
          'utf8',
        ),
        ...branchFiles.map((branchPath, index) =>
          writeFile(
            branchPath,
            `export default function Branch() { return <p>DEFERRED_BRANCH_${index.toString()}</p>; }`,
            'utf8',
          ),
        ),
      ]);

      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: pagePath,
        language: 'tsx',
        preparationMode: 'fast',
        renderMode: 'page-inspector',
        sourceText: pageSource,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const javascript = readBundleJavaScript(bundle);

      expect(javascript).toContain('FAST_DIRECT_PAGE');
      expect(javascript).toContain('FAST_ROOT_LAYOUT');
      expect(javascript).not.toContain('DEFERRED_BRANCH_0');
      expect(javascript).not.toContain('DEFERRED_BRANCH_29');
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** A directly selected layout mounts one closest page instead of bundling every route sibling. */
  it('promotes a fast layout preview to one nearest descendant page', async () => {
    const projectRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/next-app-fast-layout-'),
    );
    const appDirectory = path.join(projectRoot, 'app');
    const nestedDirectory = path.join(appDirectory, 'account');
    const layoutPath = path.join(appDirectory, 'layout.tsx');
    const layoutSource =
      "export default function Layout({ children }) { return <div data-layout='FAST_SELECTED_LAYOUT'>{children}</div>; }";
    const compiler = new EsbuildPreviewCompiler();

    try {
      await mkdir(nestedDirectory, { recursive: true });
      await Promise.all([
        writeFile(
          path.join(projectRoot, 'package.json'),
          '{"private":true,"dependencies":{"next":"15.5.20"}}',
          'utf8',
        ),
        writeFile(
          path.join(projectRoot, 'next-env.d.ts'),
          '/// <reference types="next" />',
          'utf8',
        ),
        writeFile(layoutPath, layoutSource, 'utf8'),
        writeFile(
          path.join(appDirectory, 'page.tsx'),
          "export default function HomePage() { return <main data-page='FAST_NEAREST_PAGE'>home</main>; }",
          'utf8',
        ),
        writeFile(
          path.join(nestedDirectory, 'page.tsx'),
          "export default function AccountPage() { return <main data-page='UNSELECTED_NESTED_PAGE'>account</main>; }",
          'utf8',
        ),
      ]);

      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: layoutPath,
        language: 'tsx',
        preparationMode: 'fast',
        renderMode: 'page-inspector',
        sourceText: layoutSource,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const javascript = readBundleJavaScript(bundle);

      expect(javascript).toContain('FAST_SELECTED_LAYOUT');
      expect(javascript).toContain('FAST_NEAREST_PAGE');
      expect(javascript).not.toContain('UNSELECTED_NESTED_PAGE');

      const enrichedBundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: layoutPath,
        language: 'tsx',
        preparationMode: 'full',
        renderMode: 'page-inspector',
        sourceText: layoutSource,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const enrichedJavaScript = readBundleJavaScript(enrichedBundle);

      expect(enrichedJavaScript).toContain('FAST_NEAREST_PAGE');
      expect(enrichedJavaScript).toContain('UNSELECTED_NESTED_PAGE');
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  });
});
