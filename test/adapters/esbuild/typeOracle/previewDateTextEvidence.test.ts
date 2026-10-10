/** Verifies which declared string fields are generated as calendar text. */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { readPreviewDateTextEvidence } from '../../../../src/adapters/esbuild/typeOracle/previewDateTextEvidence';

/** Reads the evidence for each member of one interface declared in `source`. */
function evidence(source: string): Readonly<Record<string, string | undefined>> {
  const sourceFile = ts.createSourceFile(
    '/workspace/Types.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = sourceFile.statements.find(ts.isInterfaceDeclaration);
  return Object.fromEntries(
    (declaration?.members ?? []).flatMap((member) => {
      if (!ts.isPropertySignature(member) || !ts.isIdentifier(member.name)) return [];
      const name = member.name.text;
      return [[name, readPreviewDateTextEvidence(name, member.type)]];
    }),
  );
}

describe('date text evidence', () => {
  /** Range endpoints and documented fields hold dates; colors, routes, assignees, and labels stay text. */
  it('reads range endpoint names and date comments', () => {
    expect(
      evidence(
        [
          'interface Fields {',
          '  periodStart: string',
          '  valid_from?: string | null',
          "  start: string // 'YYYY-MM-DD' or ''",
          '  /** W0(이번 주) 월요일 */',
          '  current: string',
          '  stamp: string // ISO 8601',
          '  gradientFrom?: string',
          '  to?: string',
          '  assigned_to: string',
          '  effective_to?: string',
          '  label: string',
          '}',
        ].join('\n'),
      ),
    ).toEqual({
      assigned_to: undefined,
      current: 'date',
      effective_to: 'date',
      gradientFrom: undefined,
      label: undefined,
      periodStart: 'date',
      stamp: 'date-time',
      start: 'date',
      to: undefined,
      valid_from: 'date',
    });
  });
});
