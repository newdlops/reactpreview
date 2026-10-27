/** Real-parser regressions for bounded syntax reuse, editor changes and grammar isolation. */
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPreviewAnalysisSourceFileCache,
  readCachedPreviewAnalysisSourceFile,
  readPreviewAnalysisSourceFile,
} from '../../../src/adapters/esbuild/previewAnalysisSourceFile';

// The parser is a nonconfigurable getter; count its real work through the module boundary.
vi.mock('typescript', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof ts }>();
  return {
    ...actual,
    default: { ...actual.default, createSourceFile: vi.fn(actual.default.createSourceFile) },
  };
});

beforeEach(() => {
  clearPreviewAnalysisSourceFileCache();
  vi.mocked(ts.createSourceFile).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const SOURCE = '/* authored */ export const Page = () => <main data-label="화면" />;';
const SOURCE_PATH = '/work/Page.tsx';

describe('read-only analysis source files', () => {
  it('only shares existing exact syntax and leaves every miss unparsed and unevicted', () => {
    expect(
      readCachedPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TSX),
    ).toBeUndefined();
    expect(ts.createSourceFile).not.toHaveBeenCalled();
    const original = readPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TSX);
    expect(readCachedPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TSX)).toBe(
      original,
    );
    expect(
      readCachedPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE + '\n', ts.ScriptKind.TSX),
    ).toBeUndefined();
    expect(
      readCachedPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TS),
    ).toBeUndefined();
    expect(
      readCachedPreviewAnalysisSourceFile('/other/Page.tsx', SOURCE, ts.ScriptKind.TSX),
    ).toBeUndefined();
    expect(readCachedPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TSX)).toBe(
      original,
    );
    expect(ts.createSourceFile).toHaveBeenCalledTimes(1);
  });

  it('does not recreate collected or cleared syntax during a lookup', () => {
    const original = readPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TSX);
    vi.spyOn(WeakRef.prototype, 'deref').mockReturnValueOnce(undefined);
    expect(
      readCachedPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TSX),
    ).toBeUndefined();
    expect(readCachedPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TSX)).toBe(
      original,
    );
    clearPreviewAnalysisSourceFileCache();
    expect(
      readCachedPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TSX),
    ).toBeUndefined();
    expect(ts.createSourceFile).toHaveBeenCalledTimes(1);
  });

  it('parses an unchanged source once for repeated readers', () => {
    const first = readPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TSX);
    expect(readPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TSX)).toBe(first);
    expect(first.text).toBe(SOURCE);
    expect(ts.createSourceFile).toHaveBeenCalledTimes(1);
  });

  it('uses current unsaved source and reparses a later restoration', () => {
    const original = readPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TSX);
    const editedSource = SOURCE.replace('main', 'section');
    const edited = readPreviewAnalysisSourceFile(SOURCE_PATH, editedSource, ts.ScriptKind.TSX);
    expect(edited.text).toBe(editedSource);
    expect(edited).not.toBe(original);
    const restored = readPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TSX);
    expect(restored.text).toBe(SOURCE);
    expect(restored).not.toBe(original);
    expect(ts.createSourceFile).toHaveBeenCalledTimes(3);
  });

  it('keeps exact path spelling and case as separate file identities', () => {
    const first = readPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TSX);
    const lower = readPreviewAnalysisSourceFile('/work/page.tsx', SOURCE, ts.ScriptKind.TSX);
    const alias = readPreviewAnalysisSourceFile('/work/./Page.tsx', SOURCE, ts.ScriptKind.TSX);
    expect(lower).not.toBe(first);
    expect(alias).not.toBe(first);
    expect(first.fileName).toBe('/work/Page.tsx');
    expect(lower.fileName).toBe('/work/page.tsx');
    expect(ts.createSourceFile).toHaveBeenCalledTimes(3);
  });

  it('separates TS and TSX recovery even for the same file name', () => {
    const plain = readPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TS);
    const jsx = readPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TSX);
    expect(diagnostics(plain).length).toBeGreaterThan(0);
    expect(diagnostics(jsx)).toEqual([]);
    expect(readPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TS)).toBe(plain);
    expect(readPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TSX)).toBe(jsx);
    expect(ts.createSourceFile).toHaveBeenCalledTimes(2);
  });

  it('keeps JavaScript and JSX grammar separate from TypeScript', () => {
    const javascript = readPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.JS);
    const jsx = readPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.JSX);
    const typescript = readPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TSX);
    expect(javascript.flags & ts.NodeFlags.JavaScriptFile).toBeTruthy();
    expect(jsx.flags & ts.NodeFlags.JavaScriptFile).toBeTruthy();
    expect(typescript.flags & ts.NodeFlags.JavaScriptFile).toBe(0);
    expect(javascript).not.toBe(jsx);
    expect(readPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.JSX)).toBe(jsx);
    expect(ts.createSourceFile).toHaveBeenCalledTimes(3);
  });

  it('preserves parent pointers, authored positions and malformed-source diagnostics', () => {
    const tree = readPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TSX);
    const statement = tree.statements[0];
    if (statement === undefined) throw new Error('Expected the authored export statement');
    expect(statement.parent).toBe(tree);
    expect(statement.getStart(tree)).toBe(15);
    expect(statement.getFullStart()).toBe(0);
    expect(statement.end).toBe(SOURCE.length);
    const malformed = readPreviewAnalysisSourceFile(
      SOURCE_PATH,
      'export const Page = <main>',
      ts.ScriptKind.TSX,
    );
    expect(diagnostics(malformed).length).toBeGreaterThan(0);
    expect(readPreviewAnalysisSourceFile(SOURCE_PATH, malformed.text, ts.ScriptKind.TSX)).toBe(
      malformed,
    );
    expect(ts.createSourceFile).toHaveBeenCalledTimes(2);
  });

  it('releases reusable syntax on compiler cache clearing', () => {
    const original = readPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TSX);
    clearPreviewAnalysisSourceFileCache();
    const next = readPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TSX);
    expect(next.text).toBe(SOURCE);
    expect(next).not.toBe(original);
    expect(readPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TSX)).toBe(next);
    expect(ts.createSourceFile).toHaveBeenCalledTimes(2);
  });

  it('reparses a collected weak reference without losing source or analysis', () => {
    const original = readPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TSX);
    // Simulates collection deterministically; this does not assert that a real GC occurred.
    vi.spyOn(WeakRef.prototype, 'deref').mockReturnValueOnce(undefined);
    const recreated = readPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TSX);
    expect(recreated).not.toBe(original);
    expect(recreated.text).toBe(SOURCE);
    expect(diagnostics(recreated)).toEqual([]);
    expect(readPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TSX)).toBe(recreated);
    expect(ts.createSourceFile).toHaveBeenCalledTimes(2);
  });

  it('evicts the least recently read source after the entry bound', () => {
    const first = readPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TSX);
    const oldestPath = '/work/oldest.tsx';
    const oldest = readPreviewAnalysisSourceFile(oldestPath, SOURCE, ts.ScriptKind.TSX);
    for (let index = 0; index < 510; index += 1) {
      readPreviewAnalysisSourceFile(
        `/work/entry-${index.toString()}.tsx`,
        SOURCE,
        ts.ScriptKind.TSX,
      );
    }
    expect(readPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TSX)).toBe(first);
    readPreviewAnalysisSourceFile('/work/newest.tsx', SOURCE, ts.ScriptKind.TSX);
    expect(readPreviewAnalysisSourceFile(SOURCE_PATH, SOURCE, ts.ScriptKind.TSX)).toBe(first);
    expect(readPreviewAnalysisSourceFile(oldestPath, SOURCE, ts.ScriptKind.TSX)).not.toBe(oldest);
    expect(ts.createSourceFile).toHaveBeenCalledTimes(514);
  });

  it('bounds retained string payload independently of the entry count', () => {
    const largeSource = `/*${'x'.repeat(120 * 1024)}*/`;
    const first = readPreviewAnalysisSourceFile(SOURCE_PATH, largeSource, ts.ScriptKind.TSX);
    let last = first;
    for (let index = 1; index < 20; index += 1) {
      last = readPreviewAnalysisSourceFile(
        `/work/large-${index.toString()}.tsx`,
        largeSource,
        ts.ScriptKind.TSX,
      );
    }
    expect(
      readPreviewAnalysisSourceFile('/work/large-19.tsx', largeSource, ts.ScriptKind.TSX),
    ).toBe(last);
    expect(readPreviewAnalysisSourceFile(SOURCE_PATH, largeSource, ts.ScriptKind.TSX)).not.toBe(
      first,
    );
    expect(ts.createSourceFile).toHaveBeenCalledTimes(21);
  });

  it('reads oversized sources through and invalidates the previous smaller snapshot', () => {
    const bounded = `/*${'x'.repeat(128 * 1024 - 4)}*/`;
    const original = readPreviewAnalysisSourceFile(SOURCE_PATH, bounded, ts.ScriptKind.TSX);
    expect(readPreviewAnalysisSourceFile(SOURCE_PATH, bounded, ts.ScriptKind.TSX)).toBe(original);
    const oversized = `${bounded}\n`;
    const large = readPreviewAnalysisSourceFile(SOURCE_PATH, oversized, ts.ScriptKind.TSX);
    expect(readPreviewAnalysisSourceFile(SOURCE_PATH, oversized, ts.ScriptKind.TSX)).not.toBe(
      large,
    );
    expect(large.text).toBe(oversized);
    expect(readPreviewAnalysisSourceFile(SOURCE_PATH, bounded, ts.ScriptKind.TSX)).not.toBe(
      original,
    );
    expect(ts.createSourceFile).toHaveBeenCalledTimes(4);
  });
});

/** Reads TypeScript's parser diagnostics without invoking a checker or changing its tree. */
function diagnostics(sourceFile: ts.SourceFile): readonly ts.Diagnostic[] {
  return (sourceFile as ts.SourceFile & { readonly parseDiagnostics: readonly ts.Diagnostic[] })
    .parseDiagnostics;
}
