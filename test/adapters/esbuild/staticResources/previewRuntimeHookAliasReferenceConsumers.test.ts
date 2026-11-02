/** Pins indexed alias/child scans, indirect carriers, fresh callbacks, and parameter shadowing. */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { readPreviewRuntimeHookAliasUsagePaths } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookAliasUsage';
import { readPreviewRuntimeHookChildPropUsages } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookChildUsageDemand';
import type { PreviewRuntimeHookChildPropDemandCatalog } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookChildDemandModel';
import { createPreviewRuntimeHookReferenceTraversal } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookReferenceTraversal';

/** Keeps one real parser owner and its exact hook binding, including an unrelated wide expression. */
function fixture(body: string): {
  readonly owner: ts.FunctionDeclaration;
  readonly binding: ts.Identifier;
  readonly ignored: ts.ArrayLiteralExpression;
} {
  const source = ts.createSourceFile(
    '/workspace/Page.tsx',
    `function Page() { const value = useValue(); const ignored = [other(), another()]; ${body} }`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const owner = source.statements.find(ts.isFunctionDeclaration);
  let binding: ts.Identifier | undefined;
  let ignored: ts.ArrayLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'value')
      binding = node.name;
    if (ts.isArrayLiteralExpression(node)) ignored ??= node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (owner === undefined || binding === undefined || ignored === undefined)
    throw new Error('Alias reference fixture incomplete');
  return { owner, binding, ignored };
}

/** Observes actual parser child enumeration without replacing any production analysis function. */
function countReads(array: ts.ArrayLiteralExpression): () => number {
  const elements = array.elements;
  let reads = 0;
  Object.defineProperty(array, 'elements', {
    get: () => {
      reads += 1;
      return elements;
    },
  });
  return () => reads;
}

/** Different child contracts make accidental inference-result reuse visible. */
function catalog(field: string): PreviewRuntimeHookChildPropDemandCatalog {
  return new Map([
    ['Child', new Map([['item', { kind: 'object', properties: { [field]: { kind: 'string' } } }]])],
  ]);
}

describe('indexed alias and child reference consumers', () => {
  it('keeps a named object helper carrier while removing redundant alias subtree scans', () => {
    const { owner, binding, ignored } = fixture(
      'const alias = value.payload; const carrier = { row: alias }; consume(carrier); return null;',
    );
    const resolve = (): { readonly expression: string; readonly kind: 'function' } => ({
      expression: 'Object.freeze(() => undefined)',
      kind: 'function',
    });
    readPreviewRuntimeHookAliasUsagePaths(binding, owner, undefined, resolve);
    createPreviewRuntimeHookReferenceTraversal(owner, new Set(['value']));
    const reads = countReads(ignored);
    const result = readPreviewRuntimeHookAliasUsagePaths(binding, owner, undefined, resolve);
    expect(result.map(({ names, called }) => ({ names, called }))).toEqual([
      { names: ['payload'], called: true },
    ]);
    // Three existing scalar/control-flow scans remain; the two alias walks must not add more.
    expect(reads()).toBeLessThanOrEqual(3);
  });

  it('retains named JSX spreads and reads the current child catalog for the same AST', () => {
    const { owner, binding, ignored } = fixture(
      'const alias = value.payload; const carrier = { item: alias }; return <Child {...carrier} />;',
    );
    expect(
      readPreviewRuntimeHookChildPropUsages(binding, catalog('title')).map((use) => use.names),
    ).toEqual([['payload', 'title']]);
    createPreviewRuntimeHookReferenceTraversal(owner, new Set(['value']));
    const reads = countReads(ignored);
    expect(
      readPreviewRuntimeHookChildPropUsages(binding, catalog('name')).map((use) => use.names),
    ).toEqual([['payload', 'name']]);
    expect(reads()).toBe(0);
  });

  it('recomputes an imported helper callback rather than caching its earlier value', () => {
    const { owner, binding } = fixture(
      'const alias = value.payload; const carrier = { row: alias }; consume(carrier); return null;',
    );
    createPreviewRuntimeHookReferenceTraversal(owner, new Set(['value']));
    const before = readPreviewRuntimeHookAliasUsagePaths(binding, owner, undefined, () => ({
      expression: '1',
      kind: 'number',
    }));
    const after = readPreviewRuntimeHookAliasUsagePaths(binding, owner, undefined, () => ({
      expression: '2',
      kind: 'number',
    }));
    expect(before.map((use) => use.valueExpression)).toEqual(['1']);
    expect(after.map((use) => use.valueExpression)).toEqual(['2']);
  });

  it.each(['{ alias }', '[alias]', '{ nested: { alias } }'])(
    'excludes a nested %s parameter that shadows the tracked alias',
    (parameter) => {
      const { owner, binding } = fixture(
        `const alias = value.payload; const nested = (${parameter}) => alias.secret; return alias.title;`,
      );
      expect(readPreviewRuntimeHookAliasUsagePaths(binding, owner).map((use) => use.names)).toEqual(
        [['payload', 'title']],
      );
    },
  );

  it('keeps a genuine captured alias and observes an edited parse of the same file', () => {
    const before = fixture(
      'const alias = value.payload; const capture = () => alias.title; return null;',
    );
    createPreviewRuntimeHookReferenceTraversal(before.owner, new Set(['value']));
    expect(
      readPreviewRuntimeHookAliasUsagePaths(before.binding, before.owner).map((use) => use.names),
    ).toEqual([['payload', 'title']]);
    const after = fixture(
      'const alias = value.record; const capture = () => alias.name; return null;',
    );
    expect(
      readPreviewRuntimeHookAliasUsagePaths(after.binding, after.owner).map((use) => use.names),
    ).toEqual([['record', 'name']]);
  });

  it.each(['alias', '{ alias }', '[alias]', '{ nested: { alias } }'])(
    'retains another captured alias when %s shadows only one name',
    (parameter) => {
      const { owner, binding } = fixture(
        `const alias = value.payload; const captured = value.owner; const nested = (${parameter}) => captured.name + alias.secret; return alias.title;`,
      );
      expect(readPreviewRuntimeHookAliasUsagePaths(binding, owner).map((use) => use.names)).toEqual(
        [
          ['owner', 'name'],
          ['payload', 'title'],
        ],
      );
    },
  );

  it('resolves an outer object carrier in its declaration scope despite a shadowing parameter', () => {
    const { owner, binding } = fixture(
      'const alias = value.payload; const carrier = { row: alias }; const nested = ({alias}) => consume(carrier); return alias.title;',
    );
    const result = readPreviewRuntimeHookAliasUsagePaths(binding, owner, undefined, () => ({
      expression: 'Object.freeze(() => undefined)',
      kind: 'function',
    }));
    expect(result.map(({ names, called }) => ({ names, called }))).toEqual([
      { names: ['payload'], called: true },
      { names: ['payload', 'title'], called: false },
    ]);
  });

  it('does not borrow an outer const object when the carrier itself is a parameter', () => {
    const { owner, binding } = fixture(
      'const alias = value.payload; const carrier = { row: alias }; const nested = (carrier) => consume(carrier); return alias.title;',
    );
    const result = readPreviewRuntimeHookAliasUsagePaths(binding, owner, undefined, () => ({
      expression: 'Object.freeze(() => undefined)',
      kind: 'function',
    }));
    expect(result.map((use) => use.names)).toEqual([['payload', 'title']]);
  });

  it.each(['alias', '{ alias }'])(
    'keeps child demand from genuine captures while excluding the %s parameter',
    (parameter) => {
      const { binding } = fixture(
        `const alias = value.payload; const captured = value.owner; const nested = (${parameter}) => <><Child item={captured}/><Child item={alias.foreign}/></>; return <Child item={alias}/>;`,
      );
      expect(
        readPreviewRuntimeHookChildPropUsages(binding, catalog('title')).map((use) => use.names),
      ).toEqual([
        ['owner', 'title'],
        ['payload', 'title'],
      ]);
    },
  );

  it('keeps a captured JSX carrier in its original scope even when its alias name is shadowed', () => {
    const { binding } = fixture(
      'const alias = value.payload; const carrier = { item: alias }; const nested = ({alias}) => <Child {...carrier}/>; return null;',
    );
    expect(
      readPreviewRuntimeHookChildPropUsages(binding, catalog('title')).map((use) => use.names),
    ).toEqual([['payload', 'title']]);
  });

  it('does not borrow a JSX carrier from an outer scope when a parameter replaces it', () => {
    const { binding } = fixture(
      'const alias = value.payload; const carrier = { item: alias }; const nested = (carrier) => <Child {...carrier}/>; return null;',
    );
    expect(readPreviewRuntimeHookChildPropUsages(binding, catalog('title'))).toEqual([]);
  });

  it.each(['const', 'let', 'var'])(
    'does not borrow another outer alias through a callback-local %s binding',
    (kind) => {
      const { owner, binding } = fixture(
        `const alias = value.payload; const captured = value.owner; const nested = (alias) => { ${kind} captured = other; return captured.secret; }; return alias.title;`,
      );
      expect(readPreviewRuntimeHookAliasUsagePaths(binding, owner).map((use) => use.names)).toEqual(
        [['payload', 'title']],
      );
    },
  );

  it('masks an inner block binding without losing the real capture after that block', () => {
    const { owner, binding } = fixture(
      'const alias = value.payload; const captured = value.owner; const nested = ({alias}) => { if (flag) { const captured = other; consume(captured.secret); } return captured.name; }; return alias.title;',
    );
    expect(readPreviewRuntimeHookAliasUsagePaths(binding, owner).map((use) => use.names)).toEqual([
      ['owner', 'name'],
      ['payload', 'title'],
    ]);
  });

  it('masks a hoisted var even when its declaration is inside a branch', () => {
    const { owner, binding } = fixture(
      'const alias = value.payload; const captured = value.owner; const nested = (alias) => { if (flag) { var captured = other; } return captured.secret; }; return alias.title;',
    );
    expect(readPreviewRuntimeHookAliasUsagePaths(binding, owner).map((use) => use.names)).toEqual([
      ['payload', 'title'],
    ]);
  });

  it('keeps catch and loop bindings local while retaining an outer capture afterward', () => {
    const { owner, binding } = fixture(
      'const alias = value.payload; const captured = value.owner; const nested = (alias) => { try {} catch (captured) { consume(captured.secret); } for (const captured of list) consume(captured.hidden); return captured.name; }; return alias.title;',
    );
    expect(readPreviewRuntimeHookAliasUsagePaths(binding, owner).map((use) => use.names)).toEqual([
      ['owner', 'name'],
      ['payload', 'title'],
    ]);
  });

  it('rejects a locally rebound object carrier for helper and JSX demand', () => {
    const { owner, binding } = fixture(
      'const alias = value.payload; const carrier = { item: alias }; const nested = (alias) => { const carrier = other; consume(carrier); return <Child {...carrier}/>; }; return null;',
    );
    expect(
      readPreviewRuntimeHookAliasUsagePaths(binding, owner, undefined, () => ({
        expression: '1',
        kind: 'number',
      })),
    ).toEqual([]);
    expect(readPreviewRuntimeHookChildPropUsages(binding, catalog('title'))).toEqual([]);
  });

  it.each([
    'var captured = other;',
    'let captured = other;',
    'const captured = other;',
    'function captured() {}',
  ])(
    'preserves a default-parameter capture before body binding %s becomes visible',
    (declaration) => {
      const { owner, binding } = fixture(
        `const alias = value.payload; const captured = value.owner; const nested = ({alias}, extra = captured.name) => { ${declaration} return extra; }; return alias.title;`,
      );
      expect(readPreviewRuntimeHookAliasUsagePaths(binding, owner).map((use) => use.names)).toEqual(
        [
          ['owner', 'name'],
          ['payload', 'title'],
        ],
      );
    },
  );
});
