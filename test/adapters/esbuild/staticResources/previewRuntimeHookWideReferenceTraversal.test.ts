/** Wide syntax must retain exact reference ancestors without re-enumerating unrelated siblings. */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  createPreviewRuntimeHookReferenceTraversal,
  reusePreviewRuntimeHookReferenceTraversal,
} from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookReferenceTraversal';

/** Produces a parent-linked source with enough children to exercise wide statement/property lists. */
function parse(text: string): ts.SourceFile {
  return ts.createSourceFile(
    '/workspace/Wide.tsx',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

/** Records node identities under a caller-owned traversal, retaining duplicate names and preorder. */
function collect(
  owner: ts.Node,
  children: (node: ts.Node, visit: (child: ts.Node) => void) => void,
): ts.Node[] {
  const result: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    result.push(node);
    children(node, visit);
  };
  visit(owner);
  return result;
}

/** Independent full-subtree oracle for the existing exact-spelling pruning contract. */
function expected(owner: ts.Node, names: ReadonlySet<string>): ts.Node[] {
  const contains = (node: ts.Node): boolean => {
    if (ts.isIdentifier(node) && names.has(node.text)) return true;
    return ts.forEachChild(node, (child) => contains(child) || undefined) === true;
  };
  return collect(owner, (node, visit) => {
    ts.forEachChild(node, (child) => {
      if (contains(child)) visit(child);
    });
  });
}

describe('wide runtime hook reference traversal', () => {
  it('indexes deep property chains without using a recursive index-construction stack', () => {
    const source = parse(`function Deep() { return root${'.field'.repeat(4_000)}; }`);
    const children = createPreviewRuntimeHookReferenceTraversal(source, new Set(['root']));
    const pending: ts.Node[] = [source];
    let rootReferences = 0;
    while (pending.length > 0) {
      const node = pending.pop();
      if (node === undefined) break;
      if (ts.isIdentifier(node) && node.text === 'root') rootReferences += 1;
      children(node, (child) => {
        pending.push(child);
      });
    }
    expect(rootReferences).toBe(1);
  });

  it('keeps exact source-order ancestors across wide blocks, arrays, objects and nested functions', () => {
    const statements = Array.from(
      { length: 160 },
      (_, index) => `const value${String(index)} = read${String(index)}();`,
    );
    const properties = Array.from(
      { length: 160 },
      (_, index) => `property${String(index)}: value${String(index)}`,
    );
    const source = parse(
      `function Wide() { ${statements.join('')} const object = {${properties.join(',')}}; const array = [${properties.map((_, index) => `value${String(index)}`).join(',')}]; const nested = (value3) => value3.name + object.property159; return <Child first={value0} last={value159} nested={nested} />; }`,
    );
    for (const names of [
      new Set<string>(),
      new Set(['value0']),
      new Set(['value159', 'value3']),
      new Set(['property159', 'nested', 'missing']),
      new Set(['value', 'VALUE0']),
      new Set(Array.from({ length: 160 }, (_, index) => `value${String(index)}`)),
    ]) {
      const children = createPreviewRuntimeHookReferenceTraversal(source, names);
      expect(collect(source, children)).toEqual(expected(source, names));
    }
  });

  it('reuses wide child positions without rereading every statement for another binding', () => {
    const source = parse(
      `function Wide() { ${Array.from({ length: 200 }, (_, index) => `const value${String(index)} = source${String(index)}.name;`).join('')} return value0 + value199; }`,
    );
    const owner = source.statements.find(ts.isFunctionDeclaration);
    if (owner?.body === undefined) throw new Error('Missing fixture body');
    const body = owner.body;
    const statements = body.statements;
    const wanted = expected(owner, new Set(['value199']));
    let enumerations = 0;
    Object.defineProperty(body, 'statements', {
      get: () => {
        enumerations += 1;
        return statements;
      },
    });
    createPreviewRuntimeHookReferenceTraversal(owner, new Set(['value0']));
    enumerations = 0;
    const children = reusePreviewRuntimeHookReferenceTraversal(owner, new Set(['value199']));
    expect(collect(owner, children)).toEqual(wanted);
    expect(enumerations).toBe(0);
  });

  it('keeps a full child walk for a foreign tree and captures each query independently', () => {
    const source = parse(
      `const values = [${Array.from({ length: 80 }, (_, index) => `name${String(index)}`).join(',')}];`,
    );
    const names = new Set(['name79']);
    const children = createPreviewRuntimeHookReferenceTraversal(source, names);
    names.clear();
    expect(collect(source, children)).toEqual(expected(source, new Set(['name79'])));
    const foreign = parse('function Foreign() { return other.name; }');
    expect(collect(foreign, children)).toEqual(
      collect(foreign, (node, visit) => {
        ts.forEachChild(node, visit);
      }),
    );
  });
});
