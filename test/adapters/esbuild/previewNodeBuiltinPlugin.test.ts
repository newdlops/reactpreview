/** Verifies browser-safe neutralization of Node built-ins reached through optional package code. */
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { createPreviewNodeBuiltinPlugin } from '../../../src/adapters/esbuild/previewNodeBuiltinPlugin';

describe('createPreviewNodeBuiltinPlugin', () => {
  /** Supports default, named, and node:-prefixed imports without exposing a real host capability. */
  it('bundles Node built-ins as callable neutral CommonJS values', async () => {
    const result = await build({
      bundle: true,
      format: 'cjs',
      logLevel: 'silent',
      platform: 'browser',
      plugins: [createPreviewNodeBuiltinPlugin()],
      stdin: {
        contents: [
          "import fs, { existsSync, readFileSync } from 'fs';",
          "import promises from 'node:fs/promises';",
          'globalThis.__nodeBuiltinResult = {',
          '  defaultMember: typeof fs.readFileSync,',
          '  namedMember: typeof readFileSync,',
          '  nestedMember: typeof promises.readFile,',
          "  neutralCall: existsSync('/host-secret'),",
          '};',
        ].join('\n'),
        loader: 'js',
      },
      write: false,
    });
    const warning = vi.fn();
    const context: { __nodeBuiltinResult?: Record<string, unknown> } = {};
    runInNewContext(result.outputFiles[0]?.text ?? '', {
      ...context,
      console: { warn: warning },
      globalThis: context,
    });

    expect(context.__nodeBuiltinResult).toEqual({
      defaultMember: 'function',
      namedMember: 'function',
      nestedMember: 'function',
      neutralCall: undefined,
    });
    expect(warning).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('unavailable'));
  });
});
