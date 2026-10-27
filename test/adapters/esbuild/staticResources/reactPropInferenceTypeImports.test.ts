/** Verifies complete imported-type evidence while pruning only already-proven traversal work. */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { collectResolvableObjectTypeImports } from '../../../../src/adapters/esbuild/staticResources/reactPropInferenceTypeResolution';

/** Parses current authored grammar without binding it to a type program. */
function parse(sourceText: string): ts.SourceFile {
  return ts.createSourceFile(
    '/page.tsx',
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

/** Observes an unchanged data subtree to prove it was not traversed after all type evidence exists. */
function observeObjectTraversal(source: ts.SourceFile): () => number {
  let reads = 0;
  let object: ts.ObjectLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (object !== undefined) return;
    if (ts.isObjectLiteralExpression(node)) object = node;
    else ts.forEachChild(node, visit);
  };
  visit(source);
  if (object === undefined) throw new Error('Expected an authored object literal');
  const properties = object.properties;
  Object.defineProperty(object, 'properties', {
    configurable: true,
    get: () => {
      reads += 1;
      return properties;
    },
  });
  return () => reads;
}

describe('imported object type reference discovery', () => {
  it.each(['as', 'satisfies'])(
    'reads %s type arguments before an unrelated JSON document',
    (kind) => {
      const source = parse(
        [
          "import type { DocumentNode, Payload, Variables } from './documents';",
          `export const query = ({ kind: 'Document', definitions: [{ value: 1 }] } ${kind} DocumentNode<Payload, Variables>);`,
        ].join('\n'),
      );
      const reads = observeObjectTraversal(source);
      expect(collectResolvableObjectTypeImports(source).map((item) => item.localName)).toEqual([
        'DocumentNode',
        'Payload',
        'Variables',
      ]);
      expect(reads()).toBe(0);
    },
  );

  it('does not traverse data when the module has no supported object-type imports', () => {
    const source = parse("import './styles.css'; export const data = { values: [1, 2, 3] };");
    const reads = observeObjectTraversal(source);
    expect(collectResolvableObjectTypeImports(source)).toEqual([]);
    expect(reads()).toBe(0);
  });

  it('continues through expressions for missing names and preserves prop-contract priority', () => {
    const source = parse(
      [
        "import Container, { Nested, Unused, BaseProps as Parent } from './contracts';",
        'type PanelProps = Parent & { title: string };',
        'export const data = ({ callback: () => ({} as Nested) } as Container);',
      ].join('\n'),
    );
    const reads = observeObjectTraversal(source);
    expect(collectResolvableObjectTypeImports(source)).toEqual([
      {
        importedName: 'BaseProps',
        localName: 'Parent',
        moduleSpecifier: './contracts',
        order: 3,
        propsContract: true,
        propsDependency: true,
        typeOnly: false,
      },
      {
        importedName: 'default',
        localName: 'Container',
        moduleSpecifier: './contracts',
        order: 0,
        propsContract: false,
        propsDependency: false,
        typeOnly: false,
      },
      {
        importedName: 'Nested',
        localName: 'Nested',
        moduleSpecifier: './contracts',
        order: 1,
        propsContract: false,
        propsDependency: false,
        typeOnly: false,
      },
    ]);
    expect(reads()).toBeGreaterThan(0);
  });

  it('retains heritage, nested callbacks, and call/JSX type arguments without promoting value names', () => {
    const source = parse(
      [
        "import { Base, Argument, Result, Item, Widget, factory, decorator } from './contracts';",
        'interface PanelProps extends Base { callback: (value: Argument) => Result }',
        'factory<Item>();',
        'const view = <Widget<Item> />;',
        'decorator(factory);',
      ].join('\n'),
    );
    expect(
      collectResolvableObjectTypeImports(source).map((item) => [
        item.localName,
        item.propsDependency,
      ]),
    ).toEqual([
      ['Base', true],
      ['Argument', true],
      ['Result', true],
      ['Item', false],
    ]);
  });

  it('reads each new editor snapshot without retaining the previous reference inventory', () => {
    const before = parse("import type { Props } from './types'; const item: Props = {};");
    const after = parse("import type { Props } from './types'; const item = {};");
    expect(collectResolvableObjectTypeImports(before).map((item) => item.localName)).toEqual([
      'Props',
    ]);
    expect(collectResolvableObjectTypeImports(after)).toEqual([]);
  });
});
