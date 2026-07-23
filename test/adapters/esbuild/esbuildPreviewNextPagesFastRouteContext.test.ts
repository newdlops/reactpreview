/** Proves cold Next Pages previews install `_app` before the first bundle is emitted. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Joins every emitted JavaScript artifact so assertions remain split-mode independent. */
function readBundleJavaScript(
  bundle: Awaited<ReturnType<EsbuildPreviewCompiler['compile']>>,
): string {
  return Buffer.concat([
    Buffer.from(bundle.javascript),
    ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
  ]).toString('utf8');
}

describe('EsbuildPreviewCompiler fast Next Pages route context', () => {
  /** Includes the implicit app shell and one proven dynamic pathname without full enrichment. */
  it('bundles a direct page through its nearest Pages Router app', async () => {
    const projectRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/next-pages-fast-page-'),
    );
    const pageDirectory = path.join(projectRoot, 'pages', 'hotels', '[hotelName]');
    const pagePath = path.join(pageDirectory, 'callTada.tsx');
    const pageSource = [
      "import { useRouter } from 'next/router';",
      "import { REGISTERED_HOTELS } from '../../../lib/hotels';",
      'export default function CallTadaPage() {',
      '  const router = useRouter();',
      '  const hotel = REGISTERED_HOTELS[router.query.hotelName];',
      "  return <main data-page='FAST_PAGES_PAGE'>{hotel.name}</main>;",
      '}',
    ].join('\n');
    const compiler = new EsbuildPreviewCompiler();

    try {
      await Promise.all([
        mkdir(pageDirectory, { recursive: true }),
        mkdir(path.join(projectRoot, 'lib'), { recursive: true }),
      ]);
      await Promise.all([
        writeFile(
          path.join(projectRoot, 'package.json'),
          '{"private":true,"dependencies":{"next":"15.5.20"}}',
          'utf8',
        ),
        writeFile(
          path.join(projectRoot, 'pages', '_app.tsx'),
          [
            'export default function App({ Component, pageProps }) {',
            "  return <section data-app='FAST_PAGES_APP'><Component {...pageProps} /></section>;",
            '}',
          ].join('\n'),
          'utf8',
        ),
        writeFile(pagePath, pageSource, 'utf8'),
        writeFile(
          path.join(projectRoot, 'lib', 'hotels.ts'),
          [
            'export const REGISTERED_HOTELS = {',
            "  testHotel: { name: 'Test hotel' },",
            "  secondHotel: { name: 'Second hotel' },",
            '};',
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          path.join(projectRoot, 'pages', 'unrelated.tsx'),
          'export default function Unrelated() { return <main>UNRELATED_PAGES_ROUTE</main>; }',
          'utf8',
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

      expect(bundle.contextCoverage).toBe('complete');
      expect(javascript).toContain('FAST_PAGES_APP');
      expect(javascript).toContain('FAST_PAGES_PAGE');
      expect(javascript).toContain('/hotels/testHotel/callTada');
      expect(javascript).not.toContain('UNRELATED_PAGES_ROUTE');
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  });
});
