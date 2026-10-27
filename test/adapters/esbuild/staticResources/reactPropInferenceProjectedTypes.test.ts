/** Declaration-only projection preserves prop evidence and original runtime syntax and budgets. */
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { readPreviewAnalysisSourceFile } from '../../../../src/adapters/esbuild/previewAnalysisSourceFile';
import { collectReactExportPropInference } from '../../../../src/adapters/esbuild/staticResources/reactExportPropInference';
import type { LocalObjectType } from '../../../../src/adapters/esbuild/staticResources/reactPropInferenceModel';
import { collectResolvableObjectTypes } from '../../../../src/adapters/esbuild/staticResources/reactPropInferenceTypeResolution';

const PAGE_PATH = '/workspace/Page.tsx';
const PAGE =
  'import type { PanelProps } from "./types"; export function Page(props: PanelProps) { return <>{props.label}</>; }';
const PAYLOAD = JSON.stringify({
  kind: 'Document',
  definitions: [],
  padding: 'x'.repeat(140 * 1024),
});
const TYPES = [
  'interface DocumentNode<R, V> { __apiType?: (variables: V) => R }',
  '/** Panel contract. */',
  'export interface PanelProps { label: string; amount: number; }',
  `export const QUERY = ${PAYLOAD} as unknown as DocumentNode<PanelProps, {}>;`,
].join('\n');

/** Resolves only the supplied imported module, without reading or executing a workspace. */
function resolveTypes(
  sourceText = TYPES,
  sourcePath = '/workspace/types.ts',
): ReadonlyMap<string, LocalObjectType> {
  const root = readPreviewAnalysisSourceFile(PAGE_PATH, PAGE, ts.ScriptKind.TSX);
  return collectResolvableObjectTypes(root, PAGE_PATH, {
    resolveImport: () => ({ sourcePath, sourceText }),
  });
}

/** Fails the test at the missing contract instead of accepting an absent imported declaration. */
function requirePanelProps(types: ReadonlyMap<string, LocalObjectType>): LocalObjectType {
  const declaration = types.get('PanelProps');
  if (declaration === undefined) throw new Error('Missing PanelProps contract');
  return declaration;
}

/** Reads the document initializer after its two declaration-only assertions. */
function documentValue(file: ts.SourceFile): ts.Expression {
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'QUERY') continue;
      let value = declaration.initializer;
      while (value !== undefined && ts.isAsExpression(value)) value = value.expression;
      if (value !== undefined) return value;
    }
  }
  throw new Error('Missing document initializer');
}

it.each(['ts', 'mts', 'cts'])(
  'projects large imported .%s declarations without changing runtime syntax',
  (extension) => {
    const sourcePath = `/workspace/projected-types.${extension}`;
    const declaration = requirePanelProps(resolveTypes(TYPES, sourcePath));
    const projected = declaration.getSourceFile();
    expect(projected.text).toBe(TYPES);
    expect(documentValue(projected).kind).toBe(ts.SyntaxKind.NullKeyword);
    expect(ts.getJSDocCommentsAndTags(declaration).map((comment) => comment.getText())).toEqual([
      '/** Panel contract. */',
    ]);
    expect(Reflect.get(declaration, 'symbol')).toBeUndefined();
    const runtime = readPreviewAnalysisSourceFile(sourcePath, TYPES, ts.ScriptKind.TS);
    expect(ts.isObjectLiteralExpression(documentValue(runtime))).toBe(true);
    expect(runtime).not.toBe(projected);
    expect(runtime.text).toBe(TYPES);
  },
);

it('retains the complete inferred props returned by the unprojected parser', () => {
  const infer = (sourcePath: string): ReturnType<typeof collectReactExportPropInference> =>
    collectReactExportPropInference(PAGE_PATH, PAGE, {
      resolveImport: () => ({ sourcePath, sourceText: TYPES }),
    });
  const projected = infer('/workspace/types.ts');
  expect(projected).toEqual(infer('/workspace/types.tsx'));
  expect(projected.Page?.shape.properties).toEqual({
    label: { kind: 'string', renderedText: true },
    amount: { kind: 'number' },
  });
});

it('retains re-export and transitive object declarations alongside the projected value', () => {
  const source =
    TYPES.replace('label: string;', 'label: string; row: Row;') +
    '\nexport interface Row { count: number; }';
  const root = readPreviewAnalysisSourceFile(PAGE_PATH, PAGE, ts.ScriptKind.TSX);
  const types = collectResolvableObjectTypes(root, PAGE_PATH, {
    resolveImport: (specifier) =>
      specifier === './types'
        ? {
            sourcePath: '/workspace/barrel.ts',
            sourceText: 'export type { PanelProps } from "./generated";',
          }
        : { sourcePath: '/workspace/generated.ts', sourceText: source },
  });
  expect([...types.keys()].sort()).toEqual(['PanelProps', 'Row']);
  expect(documentValue(requirePanelProps(types).getSourceFile()).kind).toBe(
    ts.SyntaxKind.NullKeyword,
  );
});

it('keeps unsupported JSON expressions and TSX grammar on the original parse', () => {
  const commented = TYPES.replace('"kind":', '/* retained TypeScript comment */ "kind":');
  expect(
    ts.isObjectLiteralExpression(
      documentValue(requirePanelProps(resolveTypes(commented)).getSourceFile()),
    ),
  ).toBe(true);
  const tsx = TYPES + '\nexport const child = <div />;';
  const file = requirePanelProps(resolveTypes(tsx, '/workspace/types.tsx')).getSourceFile();
  expect(file.text).toBe(tsx);
  expect(ts.isObjectLiteralExpression(documentValue(file))).toBe(true);
});

it('charges the entire original module byte budget before attempting JSON projection', () => {
  const oversized = TYPES + '\n/*' + 'x'.repeat(2 * 1024 * 1024) + '*/';
  const parse = vi.spyOn(JSON, 'parse');
  try {
    expect(resolveTypes(oversized).has('PanelProps')).toBe(false);
    expect(parse).not.toHaveBeenCalled();
  } finally {
    parse.mockRestore();
  }
});
