/** Proves selected Next App routes can execute a bounded generated source above one MiB. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Joins split JavaScript artifacts so source-marker assertions remain build-mode independent. */
function readBundleJavaScript(
  bundle: Awaited<ReturnType<EsbuildPreviewCompiler['compile']>>,
): string {
  return Buffer.concat([
    Buffer.from(bundle.javascript),
    ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
  ]).toString('utf8');
}

describe('EsbuildPreviewCompiler large Next App route source', () => {
  /** Keeps an exact generated registry renderable when it narrowly exceeds the old one-MiB cap. */
  it('admits a required generated registry under the shared route-source ceiling', async () => {
    const projectRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/next-app-large-route-source-'),
    );
    const pageDirectory = path.join(projectRoot, 'app', 'view', '[style]', '[name]');
    const pagePath = path.join(pageDirectory, 'page.tsx');
    const registryPath = path.join(projectRoot, 'registry', '__index__.tsx');
    const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
    const pageSource = [
      "import { getRegistryItem } from '@/lib/registry';",
      "export function generateStaticParams() { return [{ style: 'new-york', name: 'button' }]; }",
      'export default async function Page({ params }) {',
      '  const { style, name } = await params;',
      '  const item = getRegistryItem(name, style);',
      "  return <main data-page='LARGE_ROUTE_PAGE'>{item?.name}:{item?.payload.length}</main>;",
      '}',
    ].join('\n');
    const registrySource = [
      'export const Index = {',
      "  'new-york': {",
      `    button: { name: 'button', payload: '${'x'.repeat(1024 * 1024 + 4096)}' },`,
      '  },',
      '} as const;',
    ].join('\n');
    const compiler = new EsbuildPreviewCompiler();
    const frontierTruncationReasons: string[][] = [];

    expect(Buffer.byteLength(registrySource, 'utf8')).toBeGreaterThan(1024 * 1024);

    try {
      await Promise.all([
        mkdir(pageDirectory, { recursive: true }),
        mkdir(path.join(projectRoot, 'lib'), { recursive: true }),
        mkdir(path.dirname(registryPath), { recursive: true }),
      ]);
      await Promise.all([
        writeFile(
          path.join(projectRoot, 'package.json'),
          '{"private":true,"dependencies":{"next":"15.5.20"}}',
          'utf8',
        ),
        writeFile(
          tsconfigPath,
          '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["./*"]}}}',
          'utf8',
        ),
        writeFile(
          path.join(projectRoot, 'app', 'layout.tsx'),
          "export default function Layout({ children }) { return <body data-layout='LARGE_ROUTE_LAYOUT'>{children}</body>; }",
          'utf8',
        ),
        writeFile(pagePath, pageSource, 'utf8'),
        writeFile(
          path.join(projectRoot, 'lib', 'registry.ts'),
          [
            "import { Index } from '@/registry/__index__';",
            'export function getRegistryItem(name, style) { return Index[style]?.[name]; }',
          ].join('\n'),
          'utf8',
        ),
        writeFile(registryPath, registrySource, 'utf8'),
      ]);

      const bundle = await compiler.compile(
        {
          dependencySnapshots: [],
          documentPath: pagePath,
          language: 'tsx',
          preparationMode: 'fast',
          renderMode: 'page-inspector',
          sourceText: pageSource,
          tsconfigPath,
          useStorybookPreview: false,
          workspaceRoot: projectRoot,
        },
        {
          reportProgress: (stage, activity) => {
            void stage;
            if (activity?.kind === 'bundle-frontier') {
              frontierTruncationReasons.push([...activity.truncationReasons]);
            }
          },
        },
      );
      const javascript = readBundleJavaScript(bundle);

      expect(javascript).toContain('LARGE_ROUTE_PAGE');
      expect(javascript).toContain('LARGE_ROUTE_LAYOUT');
      expect(bundle.dependencies).toContain(registryPath);
      expect(frontierTruncationReasons.at(-1)).not.toContain('exact-source-unreadable');
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  }, 30_000);
});
