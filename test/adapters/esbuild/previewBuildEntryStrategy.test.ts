import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import {
  createPreviewBuildEntryStrategy,
  PREVIEW_BUILD_ENTRY_STRATEGY_VERSION,
} from '../../../src/adapters/esbuild/previewBuildEntryStrategy';

describe('createPreviewBuildEntryStrategy', () => {
  it('keeps a no-package preview on the existing one-stdin, non-splitting path', () => {
    const strategy = createPreviewBuildEntryStrategy({
      entrySource: 'export const preview = true;',
      reactDomRootKind: 'client',
      renderMode: 'component',
      resolveDir: '/workspace/src',
      sharedRuntimeChunk: false,
    });

    expect(strategy.kind).toBe('single-entry');
    expect(strategy.version).toBe(PREVIEW_BUILD_ENTRY_STRATEGY_VERSION);
    expect(strategy.buildOptions.splitting).toBe(false);
    expect(strategy.outputSelection.ignoredEntryPoints).toEqual([]);
  });

  it('uses two generated roots and a package-only anchor when the runtime is shareable', async () => {
    const strategy = createPreviewBuildEntryStrategy({
      entrySource: 'export const preview = true;',
      reactDomRootKind: 'legacy',
      renderMode: 'page-inspector',
      resolveDir: process.cwd(),
      sharedRuntimeChunk: true,
    });

    expect(strategy.kind).toBe('shared-styled-runtime');
    expect(strategy.buildOptions.splitting).toBe(true);
    expect(strategy.outputSelection.ignoredEntryPoints).toEqual([
      'react-preview-runtime-anchor:react-preview:runtime-anchor',
    ]);
    expect(strategy.plugins).toHaveLength(1);
    if (!('entryPoints' in strategy.buildOptions)) {
      throw new Error('Shared runtime strategy must use explicit entry points.');
    }
    // Plugin module source stays in-memory; resolving package imports is intentionally left to the
    // consuming project build, so this test only verifies both virtual roots resolve deterministically.
    const result = await build({
      bundle: true,
      entryPoints: strategy.buildOptions.entryPoints,
      format: 'esm',
      logLevel: 'silent',
      outdir: '/tmp/react-preview-entry-strategy-test',
      plugins: [...strategy.plugins],
      splitting: strategy.buildOptions.splitting,
      write: false,
      external: ['react', 'react-dom', 'react-dom/client', 'styled-components'],
    });
    expect(result.outputFiles).toHaveLength(2);
  });
});
