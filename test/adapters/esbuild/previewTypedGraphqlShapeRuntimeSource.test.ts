/** Verifies declared GraphQL literals in generated data. */
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { PREVIEW_TYPED_GRAPHQL_SHAPE_RUNTIME_SOURCE } from '../../../src/adapters/esbuild/previewTypedGraphqlShapeRuntimeSource';

describe('typed GraphQL shape runtime', () => {
  it('keeps proven numeric strings above name guesses and preserves existing decimal precision', () => {
    const context: { result?: unknown } = {};
    runInNewContext(
      [
        PREVIEW_TYPED_GRAPHQL_SHAPE_RUNTIME_SOURCE,
        "const shape = { kind: 'string', numeric: true };",
        "globalThis.result = [mergePreviewTypedGraphqlShape({ kind: 'literal', value: 'date' }, shape, 0),",
        "applyPreviewTypedGraphqlSeed('12.7500', shape, 0),",
        'applyPreviewTypedGraphqlSeed(2.5, shape, 0),',
        "applyPreviewTypedGraphqlSeed(['Id', 'Id', 'Id'], { kind: 'array', items: shape }, 0),",
        "applyPreviewTypedGraphqlSeed('2026-01-15', { kind: 'string' }, 0)];",
      ].join('\n'),
      context,
    );
    expect(context.result).toEqual([
      { kind: 'string', numeric: true },
      '12.7500',
      '2.5',
      ['1', '2', '3'],
      '2026-01-15',
    ]);
  });

  /** A declared date field carries the canonical sample date; payroll showed "2026-01-15". */
  it('places a declared canonical date literal on the current day', () => {
    const context: { result?: unknown } = {};
    runInNewContext(
      [
        PREVIEW_TYPED_GRAPHQL_SHAPE_RUNTIME_SOURCE,
        'previewTypedGraphqlSampleDates.baseOverride = new Date(2026, 9, 6, 12);',
        'globalThis.result = [',
        "  applyPreviewTypedGraphqlSeed('Contract date', { kind: 'literal', value: '2026-01-15' }, 0),",
        "  applyPreviewTypedGraphqlSeed(undefined, { kind: 'literal', value: 'ACTIVE' }, 0),",
        '];',
      ].join('\n'),
      context,
    );

    expect(context.result).toEqual(['2026-10-06', 'ACTIVE']);
  });
});
