/** Guards whitespace-only output against lost React names, development diagnostics, and setup order. */
import { runInNewContext } from 'node:vm';
import { strict as assert } from 'node:assert';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { PREVIEW_BROWSER_OUTPUT_OPTIONS } from '../../../src/adapters/esbuild/previewBrowserOutputOptions';
import { createPreviewBuildEntryStrategy } from '../../../src/adapters/esbuild/previewBuildEntryStrategy';

describe('preview browser output compaction', () => {
  it.each([false, true])('uses only whitespace compaction with shared runtime=%s', (shared) => {
    const strategy = createPreviewBuildEntryStrategy({
      entrySource: 'export default true;',
      reactDomRootKind: 'client',
      renderMode: 'page-inspector',
      resolveDir: process.cwd(),
      sharedRuntimeChunk: shared,
    });
    expect(strategy.buildOptions).toMatchObject({
      minifyIdentifiers: false,
      minifySyntax: false,
      minifyWhitespace: true,
    });
  });

  it('shrinks emitted bytes while preserving names, multiline values, and initialization order', async () => {
    const source = [
      'function AuthoredTarget() { return "  authored text  "; }',
      'class RecoveryBoundary {}',
      'const events = [];',
      'async function setup() { events.push("setup"); await Promise.resolve(); events.push("initialized"); }',
      'async function target() { events.push("target"); return AuthoredTarget(); }',
      'globalThis.result = (async () => {',
      '  await setup();',
      '  const value = await target();',
      '  return { events, value, name: AuthoredTarget.name, boundary: RecoveryBoundary.name, text: `line one\n  line two` };',
      '})();',
    ].join('\n');
    const options = {
      bundle: true,
      logLevel: 'silent' as const,
      stdin: { contents: source, sourcefile: 'owned-output-fixture.js' },
      target: 'es2022',
      write: false as const,
    };
    const [baseline, compact] = await Promise.all([
      build(options),
      build({ ...options, ...PREVIEW_BROWSER_OUTPUT_OPTIONS }),
    ]);
    const [baselineOutput] = baseline.outputFiles;
    const [compactOutput] = compact.outputFiles;
    assert(baselineOutput !== undefined && compactOutput !== undefined);
    expect(compactOutput.contents.byteLength).toBeLessThan(
      baselineOutput.contents.byteLength * 0.9,
    );
    const globals: { result?: Promise<unknown> } = {};
    runInNewContext(compactOutput.text, globals);
    await expect(globals.result).resolves.toEqual({
      events: ['setup', 'initialized', 'target'],
      value: '  authored text  ',
      name: 'AuthoredTarget',
      boundary: 'RecoveryBoundary',
      text: 'line one\n  line two',
    });
  });

  it('retains development diagnostics and exact JSX source metadata', async () => {
    const result = await build({
      ...PREVIEW_BROWSER_OUTPUT_OPTIONS,
      bundle: true,
      define: { 'process.env.NODE_ENV': '"development"' },
      external: ['react/jsx-dev-runtime'],
      format: 'cjs',
      jsx: 'automatic',
      jsxDev: true,
      logLevel: 'silent',
      stdin: {
        contents: [
          'function AuthoredCard() {',
          '  if (process.env.NODE_ENV !== "production") globalThis.diagnostic = "development-kept";',
          '  return <article title="  preserved  ">Authored content</article>;',
          '}',
          'globalThis.card = AuthoredCard();',
        ].join('\n'),
        loader: 'tsx',
        sourcefile: 'owned-card.tsx',
      },
      write: false,
    });
    const globals = {
      card: undefined as unknown,
      diagnostic: undefined as unknown,
      require: (specifier: string) => {
        expect(specifier).toBe('react/jsx-dev-runtime');
        return {
          jsxDEV: (
            type: unknown,
            props: unknown,
            _key: unknown,
            _static: unknown,
            source: unknown,
          ) => ({ type, props, source }),
        };
      },
    };
    const [output] = result.outputFiles;
    assert(output !== undefined);
    runInNewContext(output.text, globals);
    expect(globals.diagnostic).toBe('development-kept');
    expect(globals.card).toMatchObject({
      type: 'article',
      props: { children: 'Authored content', title: '  preserved  ' },
      source: { fileName: 'owned-card.tsx', lineNumber: 3, columnNumber: 10 },
    });
  });
});
