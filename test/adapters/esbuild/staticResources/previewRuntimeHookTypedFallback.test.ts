/**
 * Verifies that declared-type values reach hook instrumentation metadata without replacing syntax
 * evidence, and that hooks with no syntax evidence become typed-only sites.
 */
import { describe, expect, it } from 'vitest';
import { createPreviewRuntimeHookReplacements } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookInstrumentation';
import {
  createPreviewRuntimeHookTypedMetadata,
  type PreviewRuntimeHookTypedCallResolver,
} from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookTypedFallback';

describe('runtime hook declared-type metadata', () => {
  /** A hook with no destructuring, comparison, or semantic name is instrumented only by its type. */
  it('instruments a hook without syntax evidence as a typed-only site', () => {
    const source = [
      "import { useCalendar } from 'calendar-kit';",
      'export function Planner() {',
      '  const calendar = useCalendar();',
      '  return <section>{String(calendar)}</section>;',
      '}',
    ].join('\n');
    const requests: string[] = [];
    const resolver: PreviewRuntimeHookTypedCallResolver = (call, sourceFile) => {
      requests.push(call.getText(sourceFile));
      return { literals: {}, nodes: 2, typeText: 'Calendar', value: { day: 'Monday' } };
    };

    const replacements = createPreviewRuntimeHookReplacements(
      '/workspace/src/Planner.tsx',
      source,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      resolver,
    );
    const replacement = replacements.map((item) => item.replacement).join('\n');

    expect(requests).toEqual(['useCalendar()']);
    expect(replacement).toContain('"typedOnly":true');
    expect(replacement).toContain('"typedValue":{"day":"Monday"}');
    expect(replacement).toContain('"preserveNullish":true');
  });

  /** Without a resolver the same hook stays uninstrumented, preserving syntax-only behavior. */
  it('keeps syntax-only behavior when no declared type is available', () => {
    const source = [
      "import { useCalendar } from 'calendar-kit';",
      'export function Planner() {',
      '  const calendar = useCalendar();',
      '  return <section>{String(calendar)}</section>;',
      '}',
    ].join('\n');

    expect(createPreviewRuntimeHookReplacements('/workspace/src/Planner.tsx', source)).toEqual([]);
  });

  /** Oversized declared values are dropped instead of inflating every instrumented module. */
  it('prunes oversized typed metadata to the authored paths before omitting it', () => {
    const large = {
      client: Object.fromEntries(
        Array.from({ length: 2_000 }, (_, index) => [`field${index.toString()}`, 'value']),
      ),
      data: { investment: { id: 'preview-id', salesIntent: { status: 'NOT_WILLING_TO_SELL' } } },
    };
    const typed = {
      literals: {
        'client.mode': ['a', 'b'],
        'data.investment.salesIntent.status': ['NOT_WILLING_TO_SELL', 'UNKNOWN'],
      },
      nodes: 2_004,
      typeText: 'QueryResult',
      value: large,
    };

    expect(createPreviewRuntimeHookTypedMetadata(typed, false)).toEqual({});
    // Context analyzers spell list items as a `.[]` segment; the synthesizer appends `[]`.
    expect(
      createPreviewRuntimeHookTypedMetadata(
        {
          ...typed,
          literals: { 'data.rows[].status': ['OPEN', 'CLOSED'] },
          value: { ...large, data: { rows: [{ status: 'OPEN' }] } },
        },
        false,
        ['data.rows.[].status'],
      ),
    ).toEqual({
      typedLiterals: { 'data.rows[].status': ['OPEN', 'CLOSED'] },
      typedValue: { data: { rows: [{ status: 'OPEN' }] } },
    });
    expect(
      createPreviewRuntimeHookTypedMetadata(typed, false, ['data.investment.salesIntent']),
    ).toEqual({
      typedLiterals: {
        'data.investment.salesIntent.status': ['NOT_WILLING_TO_SELL', 'UNKNOWN'],
      },
      typedValue: { data: { investment: { salesIntent: { status: 'NOT_WILLING_TO_SELL' } } } },
    });
    expect(
      createPreviewRuntimeHookTypedMetadata(
        { literals: { grade: ['S'] }, nodes: 1, typeText: 'Grade', value: 'S' },
        true,
      ),
    ).toEqual({ typedLiterals: { grade: ['S'] }, typedOnly: true, typedValue: 'S' });
  });
});
