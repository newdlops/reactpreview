/**
 * Verifies the preemptive oversized-graph path with a low test-only split threshold.
 * Real esbuild output proves that dynamic imports are retained as deferred initializers while the
 * artifact planner receives a bounded number of local files.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('EsbuildPreviewCompiler output coalescing', () => {
  /** Avoids fragmented output allocation and preserves deferred initialization in one entry. */
  it('coalesces excessive split outputs without eagerly invoking dynamic modules', async () => {
    const projectRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/output-coalescing-preview-'),
    );
    const sourceDirectory = path.join(projectRoot, 'src');
    const documentPath = path.join(sourceDirectory, 'Preview.tsx');
    const sourceText = [
      "const loaders = [() => import('./LazyA'), () => import('./LazyB'), () => import('./LazyC')];",
      'export default function Preview() {',
      '  return <button onClick={() => Promise.all(loaders.map((load) => load()))}>COALESCED_ENTRY</button>;',
      '}',
    ].join('\n');
    const compiler = new EsbuildPreviewCompiler({ maximumSplitOutputFiles: 2 });

    try {
      await mkdir(sourceDirectory, { recursive: true });
      await Promise.all([
        writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(documentPath, sourceText, 'utf8'),
        ...['A', 'B', 'C'].map((suffix) =>
          writeFile(
            path.join(sourceDirectory, `Lazy${suffix}.tsx`),
            `globalThis.__lazyEvents?.push(${JSON.stringify(suffix)}); export const value = ${JSON.stringify(suffix)};`,
            'utf8',
          ),
        ),
      ]);

      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath,
        language: 'tsx',
        preparationMode: 'full',
        sourceText,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const javascript = new TextDecoder().decode(bundle.javascript);

      expect(bundle.chunks).toEqual([]);
      expect(javascript).toContain('COALESCED_ENTRY');
      expect(javascript).toContain('Promise.resolve().then');
      expect(
        bundle.diagnostics.some((diagnostic) =>
          diagnostic.message.includes('automatically coalesced'),
        ),
      ).toBe(false);
      const cachedBundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath,
        language: 'tsx',
        preparationMode: 'full',
        sourceText,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      expect(cachedBundle.chunks).toEqual([]);
      expect(
        cachedBundle.diagnostics.some((diagnostic) =>
          diagnostic.message.includes('automatically coalesced'),
        ),
      ).toBe(false);
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  });
});
