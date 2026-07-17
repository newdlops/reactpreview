/** Verifies the cold first-paint build policy independently from full-context compiler coverage. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('EsbuildPreviewCompiler fast path', () => {
  /** Coalesces dynamic modules into one fast artifact so first paint avoids chunk publication. */
  it('emits a single JavaScript file for the fast first-paint pass', async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(PROJECT_ROOT, 'test/fixtures/fast-single-output-preview-'),
    );
    const documentPath = path.join(temporaryDirectory, 'Preview.tsx');
    const lazyPath = path.join(temporaryDirectory, 'Lazy.tsx');
    const sourceText = [
      "const loadLazy = () => import('./Lazy');",
      'export default function Preview() {',
      '  return <button onClick={loadLazy}>FAST_SINGLE_OUTPUT_MARKER</button>;',
      '}',
    ].join('\n');
    const compiler = new EsbuildPreviewCompiler();

    try {
      await Promise.all([
        writeFile(documentPath, sourceText, 'utf8'),
        writeFile(
          lazyPath,
          'export default function Lazy() { return <p>LAZY_INLINE_MARKER</p>; }',
          'utf8',
        ),
      ]);
      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath,
        language: 'tsx',
        preparationMode: 'fast',
        sourceText,
        useStorybookPreview: false,
        workspaceRoot: PROJECT_ROOT,
      });
      const javascript = new TextDecoder().decode(bundle.javascript);

      expect(bundle.chunks).toEqual([]);
      expect(javascript).toContain('FAST_SINGLE_OUTPUT_MARKER');
      expect(javascript).toContain('LAZY_INLINE_MARKER');
      expect(javascript).not.toContain('./chunks/');
    } finally {
      await compiler.shutdown();
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
