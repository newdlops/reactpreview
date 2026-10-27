/** Protects immutable syntax reuse while keeping indexed-item inference and shadowing live. */
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { readPreviewRuntimeHookIndexedItemAliasUsages } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookUsageFallback';
import { childPropDemandsBySourceFile } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookModel';
import type { PreviewRuntimeHookChildPropDemandCatalog } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookChildDemandModel';

vi.mock('typescript', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof ts }>();
  return {
    ...actual,
    default: { ...actual.default, forEachChild: vi.fn(actual.default.forEachChild) },
  };
});

/** Parses a private immutable source and returns its direct function and first binding. */
function parse(source: string): {
  file: ts.SourceFile;
  owner: ts.FunctionDeclaration;
  binding: ts.Identifier;
} {
  const file = ts.createSourceFile(
    '/workspace/Rows.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const owner = file.statements.find(ts.isFunctionDeclaration);
  const statement = owner?.body?.statements[0];
  const binding =
    statement !== undefined && ts.isVariableStatement(statement)
      ? statement.declarationList.declarations[0]?.name
      : undefined;
  if (owner === undefined || binding === undefined || !ts.isIdentifier(binding))
    throw Error('Expected direct identifier fixture');
  return { file, owner, binding };
}

describe('indexed hook-item syntax inventory', () => {
  /** Reusing alias syntax cannot freeze a reached child's current prop contract or an empty result. */
  it('recomputes item requirements when child contracts change on the same parser tree', () => {
    const { binding, owner, file } = parse(
      'function Rows() { const rows = useRows(); const item = rows[0]; return <Card value={item.data} />; }',
    );
    const read = (): ReturnType<typeof readPreviewRuntimeHookIndexedItemAliasUsages> =>
      readPreviewRuntimeHookIndexedItemAliasUsages(binding, owner, file, 0);
    const catalog = (name: string): PreviewRuntimeHookChildPropDemandCatalog =>
      new Map([
        [
          'Card',
          new Map([
            [
              'value',
              {
                kind: 'object' as const,
                properties: { [name]: { kind: 'string' as const, renderedText: true as const } },
              },
            ],
          ]),
        ],
      ]);
    const initial = read();
    expect(
      initial[0]?.collectionItemRequiredPaths?.some((name) => name.startsWith('data.title')),
    ).toBe(false);
    childPropDemandsBySourceFile.set(file, catalog('title'));
    const first = read();
    expect(
      first[0]?.collectionItemRequiredPaths?.some((name) => name.startsWith('data.title')),
    ).toBe(true);
    childPropDemandsBySourceFile.set(file, catalog('description'));
    const second = read();
    expect(
      second[0]?.collectionItemRequiredPaths?.some((name) => name.startsWith('data.description')),
    ).toBe(true);
    expect(
      second[0]?.collectionItemRequiredPaths?.some((name) => name.startsWith('data.title')),
    ).toBe(false);
    childPropDemandsBySourceFile.delete(file);
    expect(read()).toEqual(initial);
  });
  /** Repeated field queries must not rescan an immutable owner's declaration tree. */
  it('collects declaration and shadowing syntax once for many hook fields', () => {
    const { file, owner, binding } = parse(
      `function Rows() { const rows = useRows(); ${Array.from({ length: 48 }, (_, index) => `const field${String(index)} = 0;`).join(' ')} return <main />; }`,
    );
    const walk = vi.mocked(ts.forEachChild);
    walk.mockClear();
    expect(readPreviewRuntimeHookIndexedItemAliasUsages(binding, owner, file, 0)).toEqual([]);
    const first = walk.mock.calls.length;
    expect(first).toBeGreaterThan(48);
    const fields: ts.Identifier[] = [];
    for (const statement of owner.body?.statements ?? []) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name !== binding)
          fields.push(declaration.name);
      }
    }
    expect(fields).toHaveLength(48);
    for (const [index, field] of fields.entries()) {
      expect(readPreviewRuntimeHookIndexedItemAliasUsages(field, owner, file, index % 3)).toEqual(
        [],
      );
    }
    expect(walk).toHaveBeenCalledTimes(first);
  });

  /** A fresh editor parse must not inherit stale aliases or nested-name ambiguity from its path. */
  it('rebuilds facts for edits at the same source path', () => {
    const first = parse(
      'function Rows() { const rows = useRows(); const item = rows[0]; return <main>{item.name}</main>; }',
    );
    const edited = parse(
      'function Rows() { const rows = useRows(); const item = rows?.[0]; return <main>{item.name}</main>; }',
    );
    expect(
      readPreviewRuntimeHookIndexedItemAliasUsages(first.binding, first.owner, first.file, 0),
    ).toHaveLength(1);
    expect(
      readPreviewRuntimeHookIndexedItemAliasUsages(edited.binding, edited.owner, edited.file, 0),
    ).toEqual([]);
    expect(
      readPreviewRuntimeHookIndexedItemAliasUsages(first.binding, first.owner, first.file, 0),
    ).toHaveLength(1);
  });

  /** Preserve the original conservative declaration counts, nested parameters, and literal zero rule. */
  it.each([
    'const item = rows[1];',
    'const item = rows[index];',
    'const item = rows?.[0];',
    'let item = rows[0];',
    'const item = rows[0]; function nested(item) { return item; }',
    'const item = rows[0]; const nested = ({ item }) => item;',
    'const item = rows[0]; { const item = 1; }',
    'const item = rows[0]; { const { rows } = other; }',
  ])('keeps ambiguous or unsupported aliases absent: %s', (declaration) => {
    const { binding, owner, file } = parse(
      `function Rows() { const rows = useRows(); ${declaration} return <main>{item.name}</main>; }`,
    );
    expect(readPreviewRuntimeHookIndexedItemAliasUsages(binding, owner, file, 0)).toEqual([]);
    expect(readPreviewRuntimeHookIndexedItemAliasUsages(binding, owner, file, 1)).toEqual([]);
  });
});
