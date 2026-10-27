/** Projecting erased JSON must not buy extra record-inference work beyond the original limit. */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { createPreviewRecordKeyReader } from '../../../../src/adapters/esbuild/typeOracle/previewRecordKeyInference';
import {
  createPreviewTypeProgram,
  PreviewTypeSourceFileCache,
} from '../../../../src/adapters/esbuild/typeOracle/previewTypeProgram';
import { readPreviewTypeAnalysisNodeCost } from '../../../../src/adapters/esbuild/typeOracle/previewTypedJsonAnalysis';

const FILE = '/virtual/documents.ts';
const PRELUDE = [
  'interface DocumentNode<R, V> { __apiType?: (variables: V) => R }',
  'interface Response { trend: Record<string, number> }',
  'declare const response: Response;',
].join('\n');
const PADDING = 'p'.repeat(1100);

describe('projected JSON traversal accounting', () => {
  it.each([
    '"x":1,"x":2',
    '"x":1,"\\u0078":2',
    '"numbers":[-0,-12,1e-2,-1.2E+3,0.01,1e400]',
    '"nested":{"yes":true,"no":false,"empty":null,"list":[{},[]]}',
    '"escaped":"\\\"\\\\a\\u2028\\ud83d\\ude00"',
  ])('charges every original syntax node for %s', (extra) => {
    const payload = `{"kind":"Document","definitions":[],"padding":"${PADDING}",${extra}}`;
    const source = `${PRELUDE}\nexport const QUERY = ${payload} as unknown as DocumentNode<Response, {}>;`;
    const projected = new PreviewTypeSourceFileCache().get(FILE, source, ts.ScriptTarget.ES2022);
    const original = ts.createSourceFile(FILE, source, ts.ScriptTarget.ES2022, true);
    expect(count(projected, () => 1)).toBeLessThan(count(original, () => 1));
    expect(count(projected, readPreviewTypeAnalysisNodeCost)).toBe(count(original, () => 1));
  });

  it('retains evidence before a removed subtree and stops at the original inference budget', () => {
    // Repeated keys remain distinct syntax nodes even though JSON.parse decodes one final key.
    const payload = `{"kind":"Document","definitions":[],${'"x":0,'.repeat(70_000)}"last":0}`;
    const source = [
      PRELUDE,
      "response.trend['before'];",
      `export const QUERY = ${payload} as unknown as DocumentNode<Response, {}>;`,
      "response.trend['after'];",
    ].join('\n');
    const analysis = createPreviewTypeProgram(
      {
        rootPaths: [FILE],
        managedNodeModulesPaths: [],
        readSnapshot: (f) => (f === FILE ? source : undefined),
      },
      new PreviewTypeSourceFileCache(),
    );
    const file = analysis.program.getSourceFile(FILE);
    if (file === undefined) throw new Error('Fixture source was not admitted.');
    const response = file.statements.find(
      (node): node is ts.InterfaceDeclaration =>
        ts.isInterfaceDeclaration(node) && node.name.text === 'Response',
    );
    if (response === undefined) throw new Error('Fixture interface was not parsed.');
    const property = analysis.checker.getTypeAtLocation(response).getProperty('trend');
    if (property === undefined) throw new Error('Fixture record type was not checked.');
    expect(count(file, () => 1)).toBeLessThan(100);
    expect(createPreviewRecordKeyReader(analysis.program, analysis.checker)(property)).toEqual([
      'before',
    ]);
    expect(analysis.status).toMatchObject({ projectFiles: 1, refusedBytes: 0, refusedModules: 0 });
    expect(analysis.status.admittedBytes).toBeGreaterThan(source.length);
  });
});

/** Compares TypeScript's original traversal with the analysis reader's explicit logical charges. */
function count(file: ts.SourceFile, charge: (node: ts.Node) => number): number {
  let total = 0;
  const visit = (node: ts.Node): void => {
    total += charge(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return total;
}
