/** Verifies which declared prop types are generated as real Maps and Sets. */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { collectReactExportPropInference } from '../../../../src/adapters/esbuild/staticResources/reactExportPropInference';
import { readPreviewPropCollectionKind } from '../../../../src/adapters/esbuild/staticResources/reactPropCollectionType';

/** Reads the collection kind of `value`'s declared type inside a small module. */
function kindOf(typeText: string, preamble = ''): string | undefined {
  const sourceFile = ts.createSourceFile(
    '/workspace/Probe.ts',
    `${preamble}\ninterface Props { value?: ${typeText} }`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const props = sourceFile.statements.find(ts.isInterfaceDeclaration);
  const member = props?.members[0];
  return member !== undefined && ts.isPropertySignature(member) && member.type !== undefined
    ? readPreviewPropCollectionKind(member.type, sourceFile)
    : undefined;
}

describe('prop collection types', () => {
  /** Built-in keyed collections are recognized through optional and readonly spellings. */
  it('recognizes global Map and Set declarations only', () => {
    expect(kindOf('Map<number, string>')).toBe('map');
    expect(kindOf('ReadonlyMap<string, number> | undefined')).toBe('map');
    expect(kindOf('(Set<string>) | null')).toBe('set');
    expect(kindOf('WeakSet<object>')).toBe('set');
    expect(kindOf('Record<string, number>')).toBeUndefined();
    expect(kindOf('Map<number, string> | string[]')).toBeUndefined();
    expect(
      kindOf('Map<number, string>', 'interface Map<K, V> { key: K; value: V }'),
    ).toBeUndefined();
    expect(kindOf('Map<number, string>', "import { Map } from 'immutable';")).toBeUndefined();
  });

  /** `promoWeeks.get(week)` alone used to make an object with only a `get` function. */
  it('marks the inferred prop of a component declared with a Map', () => {
    const source = [
      'interface Props { promoWeeks?: Map<number, string>; weeks: number[] }',
      'export function Timeline({ promoWeeks, weeks }: Props) {',
      '  return <div>{weeks.map((week) => promoWeeks?.has(week) ? <span key={week}>{promoWeeks.get(week)}</span> : null)}</div>;',
      '}',
    ].join('\n');

    const inferred = collectReactExportPropInference('/workspace/Timeline.tsx', source);

    expect(inferred.Timeline?.shape.properties?.promoWeeks).toMatchObject({
      collection: 'map',
      kind: 'object',
    });
  });
});
