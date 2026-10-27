/** Call ordinals must stay exact while existing walks avoid rescanning their earlier syntax. */
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import {
  collectRuntimeHookCandidates,
  collectRuntimeHookInventory,
} from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookInventory';
import {
  createPreviewRuntimeCallOccurrenceCounter,
  createPreviewRuntimeHookTypedCallResolver,
  readPreviewRuntimeHookCallOccurrence,
} from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookTypedFallback';
import { PreviewTypeOracle } from '../../../../src/adapters/esbuild/typeOracle/previewTypeOracle';

describe('source-order typed call occurrences', () => {
  it('passes exact ordinals through the real inventory, including skipped top-level calls', () => {
    const source = parse(
      `import { usePayload } from './hooks'; usePayload(); function View() { const first = usePayload(); plain(usePayload()); const last = usePayload(); return first; }`,
    );
    const observations: { text: string; ordinal: number | undefined; expected: number }[] = [];
    collectRuntimeHookCandidates(
      source,
      source.text,
      collectRuntimeHookInventory(source),
      (call, file, _paths, ordinal) => {
        observations.push({
          text: call.getText(file),
          ordinal,
          expected: readPreviewRuntimeHookCallOccurrence(file, call),
        });
        return undefined;
      },
    );
    expect(observations.length).toBe(3);
    expect(observations.map((item) => item.ordinal)).toEqual([1, 2, 3]);
    expect(observations.every((item) => item.ordinal === item.expected)).toBe(true);
  });

  it('keeps nested preorder and exact text, and gives each walk an independent counter', () => {
    const source = parse(`outer(usePayload()); usePayload(1); usePayload(); usePayload( 1 );`);
    const counter = createPreviewRuntimeCallOccurrenceCounter();
    for (const call of calls(source)) {
      expect(counter(call.getText(source))).toBe(
        readPreviewRuntimeHookCallOccurrence(source, call),
      );
    }
    expect(createPreviewRuntimeCallOccurrenceCounter()('usePayload()')).toBe(0);
  });

  it('returns the same real declared value without asking earlier unrelated calls for their text', () => {
    const fileName = '/virtual/preview-call-ordinal.ts';
    const source = parse(
      `export function usePayload(): { status: 'ready' } { return { status: 'ready' }; } function plain() {} export function View() { plain(); const result = usePayload(); return result; }`,
      fileName,
    );
    const [plain] = calls(source).filter((call) => call.getText(source) === 'plain()');
    const [target] = calls(source).filter((call) => call.getText(source) === 'usePayload()');
    if (plain === undefined || target === undefined) throw new Error('Fixture calls missing');
    const oracle = new PreviewTypeOracle(undefined, () => ({
      heap_size_limit: 4 * 1024 ** 3,
      used_heap_size: 64 * 1024 ** 2,
    })).createView({
      rootPaths: [fileName],
      managedNodeModulesPaths: [],
      readSnapshot: (file) => (file === fileName ? source.text : undefined),
    });
    try {
      const resolver = createPreviewRuntimeHookTypedCallResolver(oracle, fileName);
      if (resolver === undefined) throw new Error('Typed resolver missing');
      const expected = resolver(target, source, []);
      const textReads = vi.spyOn(plain, 'getText');
      expect(resolver(target, source, [], 0)).toEqual(expected);
      expect(expected?.value).toBeDefined();
      expect(textReads).not.toHaveBeenCalled();
      textReads.mockRestore();
    } finally {
      oracle.release();
    }
  });

  it('falls back to exact scanning after storage is full and keeps tracked ordinals correct', () => {
    const counter = createPreviewRuntimeCallOccurrenceCounter();
    expect(counter('kept()')).toBe(0);
    for (let index = 0; index < 5000; index += 1) counter(`call${String(index)}()`);
    expect(counter('overflow()')).toBeUndefined();
    expect(counter('overflow()')).toBeUndefined();
    expect(counter('kept()')).toBe(1);
    expect(counter('x'.repeat(600_000))).toBeUndefined();
  });
});

/** Parses untouched syntax with stable parent links, like the runtime transformer. */
function parse(text: string, fileName = '/virtual/occurrences.ts'): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** Independent pre-order call inventory used to compare the legacy exact scanner. */
function calls(source: ts.SourceFile): readonly ts.CallExpression[] {
  const result: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) result.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}
