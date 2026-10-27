/** Checks bounded union synthesis costs and deterministic values against a real virtual checker. */
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { synthesizePreviewTypedValue } from '../../../../src/adapters/esbuild/typeOracle/previewTypeValueSynthesizer';

interface UnionFixture {
  /** Checker owning every union used by this isolated case. */
  readonly checker: ts.TypeChecker;
  /** Reuses one declared type while keeping each synthesis demand and budget independent. */
  readonly synthesize: (
    paths?: readonly string[],
  ) => ReturnType<typeof synthesizePreviewTypedValue>;
}

afterEach(() => vi.restoreAllMocks());

describe('preview union synthesis', () => {
  it('keeps nullable single-member values without ordering or type-string work', () => {
    const fixture = createFixture(
      [
        'declare function useCase(): { data: { value: string } | null | undefined;',
        'count: number | null; missing: null | undefined };',
      ].join('\n'),
    );
    const stringify = vi.spyOn(fixture.checker, 'typeToString');
    const fromNode = vi.spyOn(fixture.checker, 'getTypeFromTypeNode');
    expect(fixture.synthesize()).toEqual({
      literals: {},
      nodes: 7,
      value: { data: { value: 'Value' }, count: 0, missing: null },
    });
    expect(stringify.mock.calls.length).toBe(0);
    expect(fromNode.mock.calls.length).toBe(0);
  });

  it('keeps absent-success slots null without inspecting their unused alternatives', () => {
    const fixture = createFixture(
      [
        'interface Failure { message: string; code: number }',
        'declare function useCase(): { error: Failure | string | null;',
        'fallback: Failure | string | null; deletedAt: string | number | null };',
      ].join('\n'),
    );
    const stringify = vi.spyOn(fixture.checker, 'typeToString');
    const fromNode = vi.spyOn(fixture.checker, 'getTypeFromTypeNode');
    expect(fixture.synthesize()?.value).toEqual({ error: null, fallback: null, deletedAt: null });
    expect(stringify.mock.calls.length).toBe(0);
    expect(fromNode.mock.calls.length).toBe(0);
  });

  it('evaluates each wide-union member once before trying the winning shape', () => {
    const fixture = createFixture(
      [
        ...Array.from(
          { length: 8 },
          (_, index) =>
            `interface State${index.toString()} { status: 'state-${index.toString()}'; ${index === 7 ? 'wanted: number;' : ''} }`,
        ),
        'type State = State0 | State1 | State2 | State3 | State4 | State5 | State6 | State7;',
        'declare function useCase(): State;',
      ].join('\n'),
    );
    const properties = vi.spyOn(fixture.checker, 'getPropertiesOfType');
    expect(fixture.synthesize(['wanted'])?.value).toEqual({ status: 'state-7', wanted: 1 });
    const byType = new Map<ts.Type, number>();
    for (const [type] of properties.mock.calls) byType.set(type, (byType.get(type) ?? 0) + 1);
    // One ranking read per alternative, plus the winning shape's real property synthesis.
    expect([...byType.values()].sort()).toEqual([1, 1, 1, 1, 1, 1, 1, 2]);
  });

  it('does not share union rankings between different demands in the same checker', () => {
    const fixture = createFixture(
      [
        'type State = { left: number; tag: "left" } | { right: string; tag: "right" };',
        'declare function useCase(): State;',
      ].join('\n'),
    );
    expect(fixture.synthesize(['left'])?.value).toEqual({ left: 1, tag: 'left' });
    expect(fixture.synthesize(['right'])?.value).toEqual({ right: 'Right', tag: 'right' });
    expect(fixture.synthesize(['left'])?.value).toEqual({ left: 1, tag: 'left' });
  });

  it('computes each fallback type-text key at most once within one union ordering', () => {
    const fixture = createFixture(
      'declare function useCase(): string | number | bigint | symbol | null;',
    );
    const stringify = vi.spyOn(fixture.checker, 'typeToString');
    expect(fixture.synthesize()?.value).toMatchObject({ $previewTyped: 'bigint' });
    const queriedTypes = stringify.mock.calls.map(([type]) => type);
    expect(queriedTypes).toHaveLength(4);
    expect(new Set(queriedTypes).size).toBe(4);
  });

  it('keeps declared literal order and settled status selection after excluding nullish members', () => {
    const fixture = createFixture(
      [
        "type Grade = 'B' | null | 'A' | undefined | 'C';",
        "type Status = 'loading' | 'ready' | null | 'idle' | 'error';",
        'declare function useCase(): { grade: Grade; status: Status };',
      ].join('\n'),
    );
    expect(fixture.synthesize()).toMatchObject({
      literals: { grade: ['B', 'A', 'C'], status: ['loading', 'ready', 'idle', 'error'] },
      value: { grade: 'B', status: 'ready' },
    });
  });

  it('retains deterministic enum and anonymous-member tie breaking', () => {
    const fixture = createFixture(
      [
        'enum Grade { Second = 2, First = 1 }',
        'declare function useCase(): { grade: Grade | null;',
        'state: { a: string } | { b: number } | null };',
      ].join('\n'),
    );
    const result = fixture.synthesize();
    expect(result?.value).toEqual({ grade: 2, state: { a: 'A' } });
    expect(result?.literals.grade).toEqual([2, 1]);
    expect(fixture.synthesize()).toEqual(result);
  });

  it('tries the next equally ranked declared member when an unsupported member is absent', () => {
    const fixture = createFixture('type State = symbol | {}; declare function useCase(): State;');
    expect(fixture.synthesize()).toEqual({ literals: {}, nodes: 3, value: {} });
  });

  it('keeps recursive nullable objects bounded without retaining a previous synthesis budget', () => {
    const fixture = createFixture(
      [
        'interface Branch { value: string; child: Branch | null }',
        'declare function useCase(): Branch;',
      ].join('\n'),
    );
    const result = fixture.synthesize();
    expect(result?.nodes).toBeLessThanOrEqual(1_200);
    expect(result?.value).toMatchObject({ value: 'Value', child: { value: 'Value' } });
    expect(fixture.synthesize()).toEqual(result);
  });
});

/** Creates no project imports or runtime execution; only this module's declared types are read. */
function createFixture(declarations: string): UnionFixture {
  const file = '/virtual/union.ts';
  const options: ts.CompilerOptions = {
    noEmit: true,
    noLib: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    types: [],
  };
  const source = ts.createSourceFile(
    file,
    declarations + '\nconst probe = useCase();',
    options.target ?? ts.ScriptTarget.ES2022,
    true,
  );
  const host = ts.createCompilerHost(options, true);
  host.getSourceFile = (name) => (name === file ? source : undefined);
  host.fileExists = (name) => name === file;
  host.readFile = (name) => (name === file ? source.text : undefined);
  const program = ts.createProgram({ host, options, rootNames: [file] });
  const declaration = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .find((node) => node.name.getText(source) === 'probe');
  const call = declaration?.initializer;
  if (call === undefined || !ts.isCallExpression(call)) throw new Error('Missing virtual probe.');
  const checker = program.getTypeChecker();
  const type = checker.getTypeAtLocation(call);
  return {
    checker,
    synthesize: (paths = []) => synthesizePreviewTypedValue(checker, type, call, paths),
  };
}
