/** Verifies that canonical compiler sample dates land on the preview's current day. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorDataRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorDataRuntimeSource';
import { createPreviewGeneratedListRuntimeSource } from '../../../../src/adapters/esbuild/previewGeneratedListRuntimeSource';

/** Evaluates the payload materializer with a fixed sample-date base. */
function generate(shape: unknown): unknown {
  const source = `
const previewHotRuntime = {};
const previewInspectorSession = { resolverPropsByExport: new Map() };
const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);
function readPersistedPreviewInspectorState() { return {}; }
function stringifyPreviewInspectorProps(value) { return JSON.stringify(value) ?? '{}'; }
function persistPreviewInspectorState() {}
function notifyPreviewInspector() {}
function schedulePreviewInspectorTreeRefresh() {}
function readPreviewInspectorRenderScenario() { return 'file-components'; }
function shouldHoldPreviewInspectorNeuralTransientTargetRequest() { return false; }
function resetPreviewInspectorGeneratedRuntimeFallbackValues() {}
${createPreviewGeneratedListRuntimeSource()}
${createPreviewInspectorDataRuntimeSource()}
previewInspectorSampleDates.baseOverride = new Date(2026, 9, 6, 12);
globalThis.__generate =(value) => JSON.stringify(generatePreviewInspectorDataValue(value, '', 'auto'));`;
  const context = vm.createContext({
    URL,
    URLSearchParams,
    location: { href: 'https://preview.invalid/' },
  });
  vm.runInContext(source, context);
  return JSON.parse((context.__generate as (value: unknown) => string)(shape)) as unknown;
}

describe('sample date rebasing', () => {
  /** An inbound table filtered to the last month used to drop every 2026-01-15 sample row. */
  it('rebases the canonical declared date literals onto the current day', () => {
    const value = generate({
      fields: {
        created_at: { kind: 'literal', value: '2026-01-15T09:00:00.000Z' },
        expected_arrival_date: { kind: 'literal', value: '2026-01-15' },
        period_end: { kind: 'string' },
        status: { kind: 'literal', value: 'IN_TRANSIT' },
        updated_on: { kind: 'literal', value: '2025-12-31' },
      },
      kind: 'object',
    });

    expect(value).toEqual({
      created_at: '2026-10-06T09:00:00.000Z',
      expected_arrival_date: '2026-10-06',
      // A range endpoint holds a day even without "date" in its name.
      period_end: '2026-10-06',
      status: 'IN_TRANSIT',
      // A project's own literal is not a compiler sample and stays as declared.
      updated_on: '2025-12-31',
    });
  });

  /** Untyped date rows count back from the current day, so recent-only lists keep them. */
  it('dates generated rows from the current day backwards', () => {
    const value = generate({
      items: { fields: { date: { kind: 'string' } }, kind: 'object' },
      kind: 'array',
    }) as readonly { readonly date: string }[];

    expect(value[0]?.date).toBe('2026-10-06T09:00:00.000Z');
    expect(value[1]?.date).toBe('2026-10-05T09:00:00.000Z');
  });
});
