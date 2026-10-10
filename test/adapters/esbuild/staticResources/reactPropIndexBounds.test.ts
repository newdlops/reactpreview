/** Verifies which authored element-read indexes have a syntax-proven maximum. */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { readPreviewBoundedIndexMaximum } from '../../../../src/adapters/esbuild/staticResources/reactPropIndexBounds';

/** Reads the bound of the first `receiver[index]` element access in `source`. */
function readBound(source: string): number | undefined {
  const sourceFile = ts.createSourceFile(
    '/workspace/Cell.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const access = ts.forEachChild(sourceFile, function find(node):
    ts.ElementAccessExpression | undefined {
    return ts.isElementAccessExpression(node) ? node : ts.forEachChild(node, find);
  });
  if (access === undefined) throw new Error('no element access');
  return readPreviewBoundedIndexMaximum(access.argumentExpression);
}

describe('readPreviewBoundedIndexMaximum', () => {
  it.each([
    ['an integer literal', 'const v = row.finals[3];', 3],
    [
      'an integer-literal Array callback',
      'const v = ([0, 1, 2, 3, 4] as const).map((k) => row.stocks[k]);',
      4,
    ],
    ['a literal-union parameter', 'const read = (k: 0 | 1 | 2 | 3) => row.finals[k];', 3],
    [
      'an inline props member',
      'export const Cell = ({ row, k }: { row: Row; k: 0 | 1 | 2 | 3 }) => <td>{row.finals[k]}</td>;',
      3,
    ],
    [
      'a renamed member of a same-file props interface',
      'interface Props { week: 0 | 1 }\nexport const Cell = ({ week: k }: Props) => <td>{row.finals[k]}</td>;',
      1,
    ],
  ])('bounds %s', (_label, source, expected) => {
    expect(readBound(source)).toBe(expected);
  });

  /** Ordinary loops, computed and oversized indexes, and shadowing parameters stay unbounded. */
  it.each([
    ['a number-typed parameter', 'const read = (k: number) => row.finals[k];'],
    ['a callback over a non-literal Array', 'const v = weeks.map((week, k) => row.finals[k]);'],
    ['an index past the generated list size', 'const v = row.finals[12];'],
    ['a computed index', 'const v = row.past[row.past.length - 1];'],
    [
      'an inner parameter shadowing a bounded one',
      'const v = [0, 1].map((k) => items.map((k) => row.finals[k]));',
    ],
  ])('does not bound %s', (_label, source) => {
    expect(readBound(source)).toBeUndefined();
  });
});
