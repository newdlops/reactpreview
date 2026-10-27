/** Reused import scans retain TypeScript's exact order, duplicates, JS imports, and text freshness. */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { PreviewTypeSourceFileCache } from '../../../../src/adapters/esbuild/typeOracle/previewTypeProgram';

describe('admitted type import scans', () => {
  it('matches the original preprocessor and reuses only identical current source text', () => {
    const cache = new PreviewTypeSourceFileCache();
    const text = `import type { First } from './first'; export { value } from './first'; const lazy = import('./lazy'); const helper = require('./helper'); define(['./amd'], () => {});`;
    const expected = ts
      .preProcessFile(text, true, true)
      .importedFiles.map((reference) => reference.fileName);
    const first = cache.readImports('/src/page.ts', text);
    expect(first).toEqual(expected);
    expect(Object.isFrozen(first)).toBe(true);
    expect(cache.readImports('/src/page.ts', text)).toBe(first);
    const edited = text.replaceAll('./first', './later');
    expect(cache.readImports('/src/page.ts', edited)).toEqual(
      ts.preProcessFile(edited, true, true).importedFiles.map((reference) => reference.fileName),
    );
    expect(first).toEqual(expected);
  });

  it('releases import metadata together with admitted parses and cache shutdown', () => {
    const cache = new PreviewTypeSourceFileCache();
    const text = `export { value } from './source';`;
    const first = cache.readImports('/src/page.ts', text);
    cache.retainOnly(new Set(['/src/page.ts']));
    expect(cache.readImports('/src/page.ts', text)).toBe(first);
    cache.retainOnly(new Set());
    const next = cache.readImports('/src/page.ts', text);
    expect(next).not.toBe(first);
    expect(next).toEqual(first);
    cache.clear();
    expect(cache.readImports('/src/page.ts', text)).not.toBe(next);
  });
});
