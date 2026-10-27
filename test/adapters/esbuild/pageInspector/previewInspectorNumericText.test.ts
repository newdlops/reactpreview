/** Numeric string shape hints affect generated samples while preserving intentional user values. */
import { describe, expect, it } from 'vitest';
import { evaluateDataRuntime } from './previewInspectorDataRuntimeSourceFixtures';

const shape = {
  kind: 'object',
  fields: {
    elapsedTime: { kind: 'string', numeric: true },
    pages: { kind: 'string', numeric: true },
    label: { kind: 'string', numeric: 'true' },
  },
};

describe('generated numeric text', () => {
  it('generates finite decimal text before date and name inference', () => {
    const result = evaluateDataRuntime().generate(shape) as Record<string, unknown>;
    expect(result.elapsedTime).toBe('1');
    expect(result.pages).toBe('1');
    expect(result.label).toBe('Label');
  });

  it.each(['custom', 'smart-custom'])('preserves a %s payload exactly', (mode) => {
    const runtime = evaluateDataRuntime();
    const metadata = { id: 'numeric-text', kind: 'graphql', operationName: 'NumericText', shape };
    const payload = { elapsedTime: '12.7500', pages: 'invalid by choice', label: 'authored' };
    runtime.resolve(metadata, {});
    runtime.set(metadata.id, payload, mode);
    expect(runtime.resolve(metadata, {})).toEqual(payload);
  });
});
