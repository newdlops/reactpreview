/** Pins exact-source pruning, original traversal order, and scope ownership for hook analysis. */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { createPreviewRuntimeHookReferenceTraversal } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookReferenceTraversal';

/** Parses a fresh authored tree so equal filenames cannot accidentally share an index. */
function parse(source: string): ts.SourceFile {
  return ts.createSourceFile(
    '/workspace/Page.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

/** Returns the first authored function while retaining the real TypeScript child relationships. */
function firstFunction(source: ts.SourceFile): ts.FunctionDeclaration {
  const owner = source.statements.find(ts.isFunctionDeclaration);
  if (owner === undefined) throw new Error('Fixture has no function');
  return owner;
}

describe('runtime hook reference traversal', () => {
  it('visits matching descendant syntax in preorder and excludes unrelated branches', () => {
    const source = parse(
      'function Page() { const ignored = unrelated(); const rows = useRows(); return <div>{rows?.items.map(item => item.name)}</div>; }',
    );
    const owner = firstFunction(source);
    const children = createPreviewRuntimeHookReferenceTraversal(owner, new Set(['rows']));
    const visitedCalls: string[] = [];
    const visitedIdentifiers: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) visitedCalls.push(node.getText(source));
      if (ts.isIdentifier(node)) visitedIdentifiers.push(node.text);
      children(node, visit);
    };
    visit(owner);

    expect(visitedCalls).toEqual(['rows?.items.map(item => item.name)']);
    expect(visitedIdentifiers).toEqual(['rows', 'rows']);
  });

  it('retains ancestors needed to inspect destructures, element reads and JSX spreads', () => {
    const source = parse(
      'function Page() { const { record } = result; const first = result[0]; return <Child {...{ result }} />; }',
    );
    const owner = firstFunction(source);
    const children = createPreviewRuntimeHookReferenceTraversal(owner, new Set(['result']));
    const relevant: string[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) ||
        ts.isElementAccessExpression(node) ||
        ts.isJsxSpreadAttribute(node)
      )
        relevant.push(node.getText(source));
      children(node, visit);
    };
    visit(owner);

    expect(relevant).toEqual([
      '{ record } = result',
      'first = result[0]',
      'result[0]',
      '{...{ result }}',
    ]);
  });

  it('lets callers preserve their existing nested-function shadowing rule', () => {
    const source = parse(
      'function Page() { const rows = useRows(); const nested = () => rows.name; const shadow = (rows) => rows.other; return rows.title; }',
    );
    const owner = firstFunction(source);
    const children = createPreviewRuntimeHookReferenceTraversal(owner, new Set(['rows']));
    const reads: string[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isArrowFunction(node) &&
        node.parameters.some((parameter) => parameter.name.getText(source) === 'rows')
      )
        return;
      if (ts.isPropertyAccessExpression(node)) reads.push(node.getText(source));
      children(node, visit);
    };
    visit(owner);

    expect(reads).toEqual(['rows.name', 'rows.title']);
  });

  it('supports multiple exact alias names without selecting property-name substrings', () => {
    const source = parse(
      'function Page() { const one = first.name; const two = alias.name; const three = firstExtra.name; return one + two + three; }',
    );
    const owner = firstFunction(source);
    const children = createPreviewRuntimeHookReferenceTraversal(owner, new Set(['first', 'alias']));
    const reads: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node)) reads.push(node.getText(source));
      children(node, visit);
    };
    visit(owner);

    expect(reads).toEqual(['first.name', 'alias.name']);
  });

  it('does not read a previously indexed unrelated subtree for another binding query', () => {
    const source = parse(
      'function Page() { const ignored = [unrelated(), other()]; return first.name + second.name; }',
    );
    const owner = firstFunction(source);
    let array: ts.ArrayLiteralExpression | undefined;
    const locate = (node: ts.Node): void => {
      if (ts.isArrayLiteralExpression(node)) array = node;
      ts.forEachChild(node, locate);
    };
    locate(owner);
    if (array === undefined) throw new Error('Fixture has no unrelated Array');
    const elements = array.elements;
    let reads = 0;
    Object.defineProperty(array, 'elements', {
      get: () => {
        reads += 1;
        return elements;
      },
    });
    createPreviewRuntimeHookReferenceTraversal(owner, new Set(['first']));
    reads = 0;
    const children = createPreviewRuntimeHookReferenceTraversal(owner, new Set(['second']));
    const visit = (node: ts.Node): void => {
      children(node, visit);
    };
    visit(owner);

    expect(reads).toBe(0);
  });

  it('does not share an index with an edited parse of the same filename', () => {
    const before = firstFunction(parse('function Page() { return original.name; }'));
    createPreviewRuntimeHookReferenceTraversal(before, new Set(['original']));
    const source = parse('function Page() { return changed.name; }');
    const owner = firstFunction(source);
    const children = createPreviewRuntimeHookReferenceTraversal(owner, new Set(['changed']));
    const identifiers: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) identifiers.push(node.text);
      children(node, visit);
    };
    visit(owner);

    expect(identifiers).toEqual(['changed']);
  });
});
