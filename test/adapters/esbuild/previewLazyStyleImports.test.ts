/** Verifies import expressions keep their authored options and cannot borrow shadowed call-site globals. */
import { transformSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import {
  instrumentPreviewLazyStyleImports,
  PREVIEW_LAZY_STYLE_CHUNK_NAMES,
} from '../../../src/adapters/esbuild/previewLazyStyleImports';

/** Instruments one original output while retaining literal source offsets for assertion messages. */
function rewrite(source: string): string {
  return new TextDecoder().decode(
    instrumentPreviewLazyStyleImports(new TextEncoder().encode(source), 'chunks/source.js'),
  );
}

describe('instrumentPreviewLazyStyleImports', () => {
  it('keeps imports native and carries import options through the wrapper', () => {
    const native = 'import("./page.js", { with: { type: "json" } })';
    const result = rewrite('export const open = () => ' + native + ';');
    expect(result).toContain('"./page.js", ' + native);
    expect(() => transformSync(result, { format: 'esm', target: 'esnext' })).not.toThrow();
  });

  it('does not rewrite text in comments, strings, static imports, bare packages or nonliteral requests', () => {
    const source = [
      'import React from "react";',
      'const text = `import("./text.js")`;',
      '// import("./comment.js")',
      'export const a = () => import("external-package");',
      'export const b = value => import(value);',
    ].join('\n');
    expect(rewrite(source)).toBe(source);
  });

  it('uses import.meta at the call site even when native global names are function parameters', () => {
    const result = rewrite(
      'export const open = (globalThis, Symbol, URL, Promise) => import("./editor.js");',
    );
    expect(result).toContain(
      '=> import.meta["__reactPreviewStyledImport_v2"]("./editor.js", import("./editor.js"))',
    );
    expect(() => transformSync(result, { format: 'esm', target: 'esnext' })).not.toThrow();
  });

  it('avoids an import.meta property already spelled by authored output', () => {
    const result = rewrite(
      'import.meta.__reactPreviewStyledImport_v2 = "authored"; export const open = () => import("../editor.js");',
    );
    expect(result).toContain('import.meta["__reactPreviewStyledImport_v2_"] =');
    expect(result).toContain('import.meta.__reactPreviewStyledImport_v2 = "authored"');
  });

  it('preserves nested native expressions inside dynamic import options', () => {
    const result = rewrite(
      'export const open = async () => import("./page.js", { with: await import("./options.js") });',
    );
    expect(result).toContain('"./page.js", import("./page.js"');
    expect(result).toContain('"./options.js", import("./options.js")');
    expect(() => transformSync(result, { format: 'esm', target: 'esnext' })).not.toThrow();
  });

  it('keeps generated overhead bounded when authored text contains a very long suffix', () => {
    const authored = '__reactPreviewStyledImport_v2' + '_'.repeat(4096);
    const source =
      'export const label = ' +
      JSON.stringify(authored) +
      '; export const open = () => import("./page.js");';
    const result = rewrite(source);
    expect(result.length - source.length).toBeLessThan(2_000);
    expect(result).toContain('import.meta["__reactPreviewStyledImport_v2"]');
    expect(() => transformSync(result, { format: 'esm', target: 'esnext' })).not.toThrow();
  });

  it('preserves UTF-8 spans around nested imports without truncating multibyte text', () => {
    const source =
      'export const before = "가😀"; export const open = async () => import("./한글😀.js", { with: await import("./설정.js") }); export const after = "끝😀";';
    const result = rewrite(source);
    expect(result).toContain('export const before = "가😀";');
    expect(result).toContain('import("./한글😀.js", { with: await import.meta[');
    expect(result).toContain('import("./설정.js")');
    expect(result.endsWith('export const after = "끝😀";')).toBe(true);
    expect(() => transformSync(result, { format: 'esm', target: 'esnext' })).not.toThrow();
  });

  it('keeps module bytes stable when the diagnostic output path changes', () => {
    const source = new TextEncoder().encode('export const open = () => import("./page.js");');
    expect(instrumentPreviewLazyStyleImports(source, 'chunks/source.js')).toEqual(
      instrumentPreviewLazyStyleImports(source, 'chunks/another-revision.js'),
    );
    expect(PREVIEW_LAZY_STYLE_CHUNK_NAMES).toBe('chunks/styles-v2/[hash]');
  });
});
