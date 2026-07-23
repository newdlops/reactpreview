/** Verifies that incremental Page Inspector entries and their host receive one stable private key. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';

const FIXTURE_PATH = fileURLToPath(new URL('../../fixtures/SamplePreview.tsx', import.meta.url));
const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('EsbuildPreviewCompiler Inspector gesture key', () => {
  /** Retains one unpredictable key across compatible native rebuilds and embeds it in the entry. */
  it('returns the same target-scoped key used by the generated browser signer', async () => {
    const compiler = new EsbuildPreviewCompiler();
    const sourceText = await readFile(FIXTURE_PATH, 'utf8');
    const request = {
      dependencySnapshots: [],
      documentPath: FIXTURE_PATH,
      language: 'tsx' as const,
      preparationMode: 'fast' as const,
      renderMode: 'page-inspector' as const,
      sourceText,
      workspaceRoot: PROJECT_ROOT,
    };
    try {
      const first = await compiler.compile(request);
      const second = await compiler.compile(request);

      expect(first.inspectorSourceGestureSecret).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(second.inspectorSourceGestureSecret).toBe(first.inspectorSourceGestureSecret);
      expect(new TextDecoder().decode(first.javascript)).toContain(
        first.inspectorSourceGestureSecret,
      );
    } finally {
      await compiler.shutdown();
    }
  } /*
   * The complete suite intentionally runs many native esbuild fixtures in parallel. This test
   * performs two real compiler passes, so allow cold CI contention without relaxing production
   * preview watchdogs or the focused test's ordinary ~3 second runtime.
   */, 15_000);
});
