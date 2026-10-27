/** Verifies one compiler cannot terminate native contexts owned by another caller. */
import { context, stop } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';
import type { PreviewBuildRequest } from '../../../src/domain/preview';
import { decodeBundleJavascript } from './esbuildPreviewCompilerFixtures';

const FIXTURE_PATH = fileURLToPath(new URL('../../fixtures/SamplePreview.tsx', import.meta.url));
const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

// This test module owns the complete native-engine lifetime after every caller has disposed.
afterAll(async () => stop());

describe('EsbuildPreviewCompiler shutdown ownership', () => {
  it('preserves another compiler incremental context when an unused compiler closes', async () => {
    const unused = new EsbuildPreviewCompiler();
    const active = new EsbuildPreviewCompiler();
    const source = await readFile(FIXTURE_PATH, 'utf8');
    const request = (text: string): PreviewBuildRequest => ({
      dependencySnapshots: [],
      documentPath: FIXTURE_PATH,
      language: 'tsx',
      preparationMode: 'fast',
      renderMode: 'component',
      sourceText: source.replace('Saved fixture source', text),
      workspaceRoot: PROJECT_ROOT,
    });
    try {
      await active.compile(request('Before unrelated shutdown'));
      await unused.shutdown();
      const rebuilt = await active.compile(request('After unrelated shutdown'));
      expect(decodeBundleJavascript(rebuilt)).toContain('After unrelated shutdown');
      expect(decodeBundleJavascript(rebuilt)).not.toContain('Before unrelated shutdown');
    } finally {
      await active.shutdown();
      await unused.shutdown();
    }
  }, 30_000);

  it('leaves an independent caller native context usable after compiler shutdown', async () => {
    const compiler = new EsbuildPreviewCompiler();
    const buildContext = await context({
      stdin: { contents: 'export const value = 1;', sourcefile: 'owned-native-context.js' },
      bundle: true,
      write: false,
      format: 'esm',
      logLevel: 'silent',
    });
    try {
      await buildContext.rebuild();
      await compiler.shutdown();
      const rebuilt = await buildContext.rebuild();
      expect(rebuilt.outputFiles[0]?.text).toContain('value');
    } finally {
      await buildContext.dispose();
      await compiler.shutdown();
    }
  });
});
