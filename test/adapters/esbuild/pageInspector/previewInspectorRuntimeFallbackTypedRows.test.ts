/** Verifies that declared literal members vary across generated sample rows. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorRuntimeFallbackTypedValueRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRuntimeFallbackTypedValueRuntimeSource';

/** Runs the generated merge in an isolated realm with the shared plain-record predicate. */
function merge(fallback: unknown, metadata: Record<string, unknown>): unknown {
  const sandbox: { __merge?: (value: unknown, data: unknown) => unknown } = {};
  vm.runInNewContext(
    `
      // Same cross-realm rule as the runtime: plain object literals only, never Dates or Maps.
      function isPreviewInspectorGeneratedPlainRecord(value) {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
        const prototype = Object.getPrototypeOf(value);
        return prototype === null || (Object.getPrototypeOf(prototype) === null &&
          prototype.constructor?.name === 'Object');
      }
      ${createPreviewInspectorRuntimeFallbackTypedValueRuntimeSource()}
      previewInspectorTypedSampleDates.baseOverride = new Date(2026, 9, 6, 12);
      globalThis.__merge = (value, data) => JSON.parse(JSON.stringify(
        mergePreviewInspectorTypedRuntimeFallback(value, data)));
    `,
    sandbox,
  );
  if (sandbox.__merge === undefined) throw new Error('The typed merge did not initialize.');
  return sandbox.__merge(fallback, metadata);
}

describe('typed runtime fallback merge', () => {
  /** Three generated toasts used to share the first kind; they now show each declared kind. */
  it('varies an invalid generated literal across sample rows in declared order', () => {
    const rows = [1, 2, 3, 4].map((id) => ({ id, kind: 'kind', text: 'text' }));

    expect(
      merge(rows, {
        typedLiterals: { '[].kind': ['info', 'warn', 'error'] },
        typedValue: [{ id: 0, kind: 'info', text: 'text' }],
      }),
    ).toEqual([
      { id: 1, kind: 'info', text: 'text' },
      { id: 2, kind: 'warn', text: 'text' },
      { id: 3, kind: 'error', text: 'text' },
      { id: 4, kind: 'info', text: 'text' },
    ]);
  });

  /** The typed default leads; a literal the code compared or authored is never replaced. */
  it('starts from the typed default and keeps valid authored literals', () => {
    expect(
      merge([{ state: 'state' }, { state: 'failed' }, { state: 'state' }], {
        typedLiterals: { '[].state': ['idle', 'syncing', 'failed', 'done'] },
        typedValue: [{ state: 'done' }],
      }),
    ).toEqual([{ state: 'done' }, { state: 'failed' }, { state: 'syncing' }]);
    // A single object keeps the typed default.
    expect(
      merge(
        { state: 'state' },
        {
          typedLiterals: { state: ['idle', 'done'] },
          typedValue: { state: 'done' },
        },
      ),
    ).toEqual({ state: 'done' });
  });

  /** Declared date fields land on the preview's current day, like generated payload dates. */
  it('rebases canonical typed dates onto the current day', () => {
    expect(
      merge(
        { arrival: {}, at: {}, label: 'label' },
        {
          typedValue: {
            arrival: '2026-01-15',
            at: { $previewTyped: 'date', iso: '2026-01-15T09:00:00.000Z' },
            label: '2026-01-15',
          },
        },
      ),
    ).toEqual({ arrival: '2026-10-06', at: '2026-10-06T09:00:00.000Z', label: 'label' });
  });
});
