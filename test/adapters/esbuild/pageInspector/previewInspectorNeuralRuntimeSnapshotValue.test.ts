/** Protects runtime checkpoint restoration from JSON truncation and native prototype loss. */
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorBlockerValueRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorBlockerValueRuntimeSource';
import { createPreviewInspectorGeneratedValueRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorGeneratedValueRuntimeSource';
import { createPreviewInspectorNeuralSuccessSnapshotRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralSuccessSnapshotRuntimeSource';

/** Evaluates checkpoint copying and restoration with the actual generated-value runtime. */
function createRuntime(): {
  copy(value: unknown): unknown;
  restore(value: unknown): unknown;
  fingerprint(value: unknown): unknown;
} {
  const context = createContext({});
  runInContext(
    "const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);" +
      createPreviewInspectorGeneratedValueRuntimeSource() +
      createPreviewInspectorBlockerValueRuntimeSource() +
      createPreviewInspectorNeuralSuccessSnapshotRuntimeSource() +
      'globalThis.api = { copy: copyPreviewInspectorNeuralRuntimeSnapshotValue,' +
      'restore: restorePreviewInspectorNeuralSuccessRuntimeFallbackValue,' +
      'fingerprint: stringifyPreviewInspectorNeuralSuccessValue };',
    context,
  );
  return runInContext('globalThis.api', context) as ReturnType<typeof createRuntime>;
}

describe('runtime hook checkpoints', () => {
  /** Real navigation routes failed after a page-generation baseline restored JSON records. */
  it('restores independent native route patterns with their flags and matching behavior', () => {
    const runtime = createRuntime();
    const pattern = /company\/\d+/gim;
    pattern.lastIndex = 2;
    const source = [{ pageGroups: [{ pages: [{ activeRoutes: [pattern, '/home'] }] }] }];
    const checkpoint = runtime.copy(source);
    pattern.lastIndex = 0;
    const restored = runtime.restore(checkpoint) as typeof source;
    const route = restored[0]?.pageGroups[0]?.pages[0]?.activeRoutes[0] as RegExp;

    expect(route).not.toBe(pattern);
    expect(route.source).toBe(pattern.source);
    expect(route.flags).toBe('gim');
    expect(route.lastIndex).toBe(2);
    route.lastIndex = 0;
    expect(route.test('/COMPANY/42')).toBe(true);
    expect(pattern.lastIndex).toBe(0);
  });

  /** The editable JSON budget must not silently erase a query's later receipt collection. */
  it('preserves dense query tails and generated callback results through restoration', () => {
    const runtime = createRuntime();
    const source = {
      rows: Array.from({ length: 100 }, (_, id) => ({ id, label: 'Row', active: true })),
      receipts: [{ id: 'receipt-1' }],
      readCount: (): number => 7,
    };
    const checkpoint = runtime.copy(source);
    const receipt = source.receipts[0];
    if (receipt === undefined) throw new Error('Expected receipt fixture');
    receipt.id = 'changed';
    const restored = runtime.restore(checkpoint) as typeof source;

    expect(restored.rows).toHaveLength(100);
    expect(restored.rows[99]?.id).toBe(99);
    expect(restored.receipts[0]?.id).toBe('receipt-1');
    expect(restored.readCount()).toBe(7);
  });

  /** Unsupported inputs decline the checkpoint without invoking project getters or growing forever. */
  it('rejects accessors and oversized graphs instead of restoring corrupted placeholders', () => {
    const runtime = createRuntime();
    let reads = 0;
    const source = {
      get secret(): number {
        reads += 1;
        return 1;
      },
    };

    expect(runtime.copy(source)).toBeUndefined();
    expect(reads).toBe(0);
    expect(runtime.copy(Array.from({ length: 4097 }, () => 1))).toBeUndefined();
    expect(runtime.copy(new Array(1_000_000))).toBeUndefined();
  });

  /** A typed Date uses native internal slots and needs the same in-memory checkpoint boundary. */
  it('restores an independent native date', () => {
    const runtime = createRuntime();
    const source = new Date('2026-10-24T00:00:00.000Z');
    const checkpoint = runtime.copy({ date: source });
    source.setUTCFullYear(2020);
    const restored = runtime.restore(checkpoint) as { date: Date };

    expect(restored.date.toISOString()).toBe('2026-10-24T00:00:00.000Z');
    expect(restored.date).not.toBe(source);
  });

  /** Different native patterns are different restoration recipes, even though JSON encodes both {}. */
  it('includes native matching behavior in the checkpoint fingerprint', () => {
    const runtime = createRuntime();
    const first = runtime.copy({ route: /company/i });
    const second = runtime.copy({ route: /meeting/i });

    expect(runtime.fingerprint(first)).not.toBe(runtime.fingerprint(second));
    expect(runtime.fingerprint(first)).toBe(runtime.fingerprint(runtime.copy(first)));
  });
});
