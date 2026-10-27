/** Exercises distinct compiler-generated display keys without changing authored or finite values. */
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { createPreviewGeneratedListRuntimeSource } from '../../../../src/adapters/esbuild/previewGeneratedListRuntimeSource';
import { hasPreviewRuntimeHookGeneratedStringIdentity } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookGeneratedStringIdentity';
import { inferPreviewRuntimeArrayItemFallback } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookUsageFallback';
import { createPreviewRuntimeHookUsageTreeFallback } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookUsageTree';

/** Parses one inert source and returns its map callback and inferred compiler-owned item. */
function readItem(
  body: string,
  parameterType = '',
): {
  readonly callback: ts.ArrowFunction;
  readonly item: ReturnType<typeof inferPreviewRuntimeArrayItemFallback>;
} {
  const source = ts.createSourceFile(
    'generated-string.tsx',
    `function Panel() { return items.map((option${parameterType}) => ${body}); }`,
    ts.ScriptTarget.ES2020,
    true,
    ts.ScriptKind.TSX,
  );
  let access: ts.PropertyAccessExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'map') access = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (access === undefined || !ts.isCallExpression(access.parent)) throw new Error('Missing map.');
  const callback = access.parent.arguments[0];
  if (callback === undefined || !ts.isArrowFunction(callback)) throw new Error('Missing callback.');
  return { callback, item: inferPreviewRuntimeArrayItemFallback(access, source) };
}

describe('generated display-string identities', () => {
  it.each([false, true])('numbers keyed generated strings with shared runtime = %s', (runtime) => {
    const { callback, item } = readItem('<span key={option}>{option}</span>');
    expect(item).toMatchObject({ expression: '"Option"', generatedStringIdentity: true });
    expect(hasPreviewRuntimeHookGeneratedStringIdentity(callback, '"Option"')).toBe(true);
    const expression = createPreviewRuntimeHookUsageTreeFallback([
      {
        called: false,
        collectionItemExpression: item?.expression ?? 'undefined',
        collectionItemStringIdentity: true,
        collectionProperty: 'map',
        names: ['displayedOptionsInTop'],
      },
    ]).expression;
    const value = runInNewContext(
      `${runtime ? createPreviewGeneratedListRuntimeSource() : ''}\n(${expression})`,
    ) as { readonly displayedOptionsInTop: readonly string[] };
    expect(value.displayedOptionsInTop).toEqual(['Option', 'Option 2', 'Option 3']);
  });

  it('recognizes display-prop evidence from the keyed item in a child component', () => {
    const { callback } = readItem('<FilterRadioButton key={option} label={option} />');
    expect(hasPreviewRuntimeHookGeneratedStringIdentity(callback, '"Label"')).toBe(true);
  });

  it('does not infer identity from a key without a matching direct display contract', () => {
    const { callback } = readItem('<FilterRadioButton key={option} value={option} />');
    expect(hasPreviewRuntimeHookGeneratedStringIdentity(callback, '"Label"')).toBe(false);
  });

  it('does not number a callback item with a declared finite literal type', () => {
    const { callback } = readItem('<span key={option} label={option}/>', ": 'Label'");
    expect(hasPreviewRuntimeHookGeneratedStringIdentity(callback, '"Label"')).toBe(false);
  });

  it('preserves an authored literal comparison even when its text matches the display sample', () => {
    const { callback, item } = readItem(
      'option === "Label" ? <span key={option} label={option} /> : null',
    );
    expect(hasPreviewRuntimeHookGeneratedStringIdentity(callback, '"Label"')).toBe(false);
    expect(item?.generatedStringIdentity).toBeUndefined();
  });

  it('keeps ordinary generated enums, URLs and application arrays byte-for-byte', () => {
    const value = runInNewContext(
      `${createPreviewGeneratedListRuntimeSource()}
      ({ enumValues: createPreviewGeneratedList(() => 'READY'),
         urls: createPreviewGeneratedList(() => 'https://example.invalid/media.png'),
         authored: ['Label', 'Label'],
         keyed: createPreviewGeneratedList(() => 'Label', 2, true) })`,
    ) as Record<string, unknown>;
    expect(value.enumValues).toEqual(['READY', 'READY', 'READY']);
    expect(value.urls).toEqual(Array(3).fill('https://example.invalid/media.png'));
    expect(value.authored).toEqual(['Label', 'Label']);
    expect(value.keyed).toEqual(['Label', 'Label 2']);
  });
});
