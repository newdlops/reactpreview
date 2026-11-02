/** Pins bounded syntax only during owned compiler work, including nested/cancelled jobs. */
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPreviewAnalysisSourceFileCache,
  readCachedPreviewAnalysisSourceFile,
  readPreviewAnalysisSourceFile,
  withPreviewAnalysisSourceFileRetention,
} from '../../../src/adapters/esbuild/previewAnalysisSourceFile';

const TEXT = 'export const Page = () => <main />;';
const FILE = '/workspace/Page.tsx';

beforeEach(clearPreviewAnalysisSourceFileCache);
afterEach(() => {
  vi.restoreAllMocks();
  clearPreviewAnalysisSourceFileCache();
});

/** Models collection without making a claim that a real V8 collection occurred. */
function hideWeakTrees(): void {
  vi.spyOn(WeakRef.prototype, 'deref').mockReturnValue(undefined);
}

/** A gate lets concurrent retention jobs finish in a deliberately different order. */
function gate(): { readonly promise: Promise<void>; readonly finish: () => void } {
  let finish = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { promise, finish };
}

describe('compiler-owned read-only syntax retention', () => {
  it('keeps exact trees through asynchronous stages and releases them before returning', async () => {
    const result = await withPreviewAnalysisSourceFileRetention(async () => {
      await Promise.resolve();
      const tree = readPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX);
      hideWeakTrees();
      await Promise.resolve();
      expect(readCachedPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX)).toBe(tree);
      expect(readPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX)).toBe(tree);
      return 42;
    });
    expect(result).toBe(42);
    expect(readCachedPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX)).toBeUndefined();
  });

  it('pins an existing cache-only hit without making a fresh parse', async () => {
    const tree = readPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX);
    await withPreviewAnalysisSourceFileRetention(async () => {
      await Promise.resolve();
      expect(readCachedPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX)).toBe(tree);
      hideWeakTrees();
      expect(readCachedPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX)).toBe(tree);
    });
    expect(readCachedPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX)).toBeUndefined();
  });

  it('releases trees after a synchronous failure or an aborted asynchronous job', async () => {
    await expect(
      withPreviewAnalysisSourceFileRetention(() => {
        readPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX);
        hideWeakTrees();
        throw new Error('cancelled');
      }),
    ).rejects.toThrow('cancelled');
    expect(readCachedPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX)).toBeUndefined();
    await expect(
      withPreviewAnalysisSourceFileRetention(async () => {
        readPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX);
        await Promise.resolve();
        throw new Error('aborted');
      }),
    ).rejects.toThrow('aborted');
    expect(readCachedPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX)).toBeUndefined();
  });

  it('keeps an outer job alive after a nested job fails', async () => {
    await withPreviewAnalysisSourceFileRetention(async () => {
      await Promise.resolve();
      const tree = readPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX);
      hideWeakTrees();
      await expect(
        withPreviewAnalysisSourceFileRetention(() => Promise.reject(new Error('inner'))),
      ).rejects.toThrow('inner');
      expect(readCachedPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX)).toBe(tree);
    });
    expect(readCachedPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX)).toBeUndefined();
  });

  it('releases shared trees only after the last overlapping job finishes', async () => {
    const firstGate = gate();
    const secondGate = gate();
    const tree = readPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX);
    const first = withPreviewAnalysisSourceFileRetention(async () => {
      readCachedPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX);
      await firstGate.promise;
    });
    const second = withPreviewAnalysisSourceFileRetention(async () => secondGate.promise);
    try {
      hideWeakTrees();
      firstGate.finish();
      await first;
      expect(readCachedPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX)).toBe(tree);
      secondGate.finish();
      await second;
      expect(readCachedPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX)).toBeUndefined();
    } finally {
      firstGate.finish();
      secondGate.finish();
      await Promise.allSettled([first, second]);
    }
  });

  it('keeps current editor contents, path spelling and grammar separate while retained', async () => {
    await withPreviewAnalysisSourceFileRetention(async () => {
      await Promise.resolve();
      const original = readPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX);
      const editedText = TEXT.replace('main', 'section');
      const edited = readPreviewAnalysisSourceFile(FILE, editedText, ts.ScriptKind.TSX);
      const plain = readPreviewAnalysisSourceFile(FILE, editedText, ts.ScriptKind.TS);
      const alias = readPreviewAnalysisSourceFile('/workspace/./Page.tsx', TEXT, ts.ScriptKind.TSX);
      hideWeakTrees();
      expect(edited).not.toBe(original);
      expect(plain).not.toBe(edited);
      expect(alias).not.toBe(original);
      expect(readCachedPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX)).toBeUndefined();
      expect(readCachedPreviewAnalysisSourceFile(FILE, editedText, ts.ScriptKind.TSX)).toBe(edited);
      expect(readPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX)).not.toBe(original);
    });
  });

  it('temporarily admits more entries and restores the idle entry bound', async () => {
    const first = readPreviewAnalysisSourceFile('/workspace/first.tsx', TEXT, ts.ScriptKind.TSX);
    const second = readPreviewAnalysisSourceFile('/workspace/second.tsx', TEXT, ts.ScriptKind.TSX);
    await withPreviewAnalysisSourceFileRetention(async () => {
      await Promise.resolve();
      for (let index = 0; index < 600; index += 1)
        readPreviewAnalysisSourceFile(
          `/workspace/f${index.toString()}.tsx`,
          TEXT,
          ts.ScriptKind.TSX,
        );
      expect(
        readCachedPreviewAnalysisSourceFile('/workspace/first.tsx', TEXT, ts.ScriptKind.TSX),
      ).toBe(first);
    });
    // Keeping the object alive here distinguishes entry eviction from weak-reference collection.
    expect(second.text).toBe(TEXT);
    expect(
      readCachedPreviewAnalysisSourceFile('/workspace/second.tsx', TEXT, ts.ScriptKind.TSX),
    ).toBeUndefined();
  });

  it('keeps active entry and text budgets bounded', async () => {
    await withPreviewAnalysisSourceFileRetention(async () => {
      await Promise.resolve();
      const first = readPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX);
      for (let index = 0; index < 1024; index += 1)
        readPreviewAnalysisSourceFile(
          `/workspace/b${index.toString()}.tsx`,
          TEXT,
          ts.ScriptKind.TSX,
        );
      expect(first.text).toBe(TEXT);
      expect(readCachedPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX)).toBeUndefined();
      clearPreviewAnalysisSourceFileCache();
      const large = `/*${'x'.repeat(120 * 1024)}*/`;
      const held = readPreviewAnalysisSourceFile(FILE, large, ts.ScriptKind.TSX);
      for (let index = 0; index < 39; index += 1)
        readPreviewAnalysisSourceFile(
          `/workspace/l${index.toString()}.tsx`,
          large,
          ts.ScriptKind.TSX,
        );
      expect(held.text).toBe(large);
      expect(readCachedPreviewAnalysisSourceFile(FILE, large, ts.ScriptKind.TSX)).toBeUndefined();
    });
  });

  it('clears retained entries without ending another active job', async () => {
    await withPreviewAnalysisSourceFileRetention(async () => {
      await Promise.resolve();
      const old = readPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX);
      clearPreviewAnalysisSourceFileCache();
      expect(readCachedPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX)).toBeUndefined();
      const next = readPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX);
      expect(next).not.toBe(old);
      hideWeakTrees();
      expect(readCachedPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX)).toBe(next);
    });
    expect(readCachedPreviewAnalysisSourceFile(FILE, TEXT, ts.ScriptKind.TSX)).toBeUndefined();
  });

  it('restores the idle string budget even when the active entry count is small', async () => {
    const large = `/*${'x'.repeat(120 * 1024)}*/`;
    const held: ts.SourceFile[] = [];
    await withPreviewAnalysisSourceFileRetention(async () => {
      await Promise.resolve();
      for (let index = 0; index < 20; index += 1)
        held.push(
          readPreviewAnalysisSourceFile(
            `/workspace/s${index.toString()}.tsx`,
            large,
            ts.ScriptKind.TSX,
          ),
        );
      expect(
        readCachedPreviewAnalysisSourceFile('/workspace/s0.tsx', large, ts.ScriptKind.TSX),
      ).toBe(held[0]);
    });
    expect(held[1]?.text).toBe(large);
    expect(
      readCachedPreviewAnalysisSourceFile('/workspace/s1.tsx', large, ts.ScriptKind.TSX),
    ).toBeUndefined();
    expect(readCachedPreviewAnalysisSourceFile('/workspace/s0.tsx', large, ts.ScriptKind.TSX)).toBe(
      held[0],
    );
  });

  it('keeps oversized individual sources uncached during active work', async () => {
    const large = `/*${'x'.repeat(128 * 1024)}*/`;
    await withPreviewAnalysisSourceFileRetention(async () => {
      await Promise.resolve();
      const first = readPreviewAnalysisSourceFile(FILE, large, ts.ScriptKind.TSX);
      expect(readCachedPreviewAnalysisSourceFile(FILE, large, ts.ScriptKind.TSX)).toBeUndefined();
      expect(readPreviewAnalysisSourceFile(FILE, large, ts.ScriptKind.TSX)).not.toBe(first);
    });
  });
});
