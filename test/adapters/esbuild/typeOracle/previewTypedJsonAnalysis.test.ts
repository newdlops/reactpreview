/** Real analysis trees must avoid materializing erased document JSON without losing type evidence. */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  createPreviewTypeProgram,
  PreviewTypeSourceFileCache,
  type PreviewTypeProgram,
} from '../../../../src/adapters/esbuild/typeOracle/previewTypeProgram';
import { collectPreviewTypedDocumentShapes } from '../../../../src/adapters/esbuild/typeOracle/previewTypedDocumentShapes';
import { PreviewTypeOracle } from '../../../../src/adapters/esbuild/typeOracle/previewTypeOracle';

const FILE = '/virtual/generated-documents.ts';
const PRELUDE = [
  'interface TypedDocumentNode<R, V> { __apiType?: (variables: V) => R }',
  'type DocumentNode<R, V> = TypedDocumentNode<R, V>;',
  "type Result = { status: 'READY'; count: number };",
  'type Variables = { id: string };',
].join('\n');
const PAYLOAD = JSON.stringify({
  kind: 'Document',
  definitions: Array.from({ length: 40 }, () => ({
    kind: 'Field',
    name: { kind: 'Name', value: 'status' },
  })),
});
const DOCUMENT = `export const QUERY = ${PAYLOAD} as unknown as DocumentNode<Result, Variables>;`;
const SOURCE = `${PRELUDE}\n${DOCUMENT}\nexport type Returned = typeof QUERY;\n`;

describe('typed JSON analysis', () => {
  it('bounds discovery for unsupported lines containing many fake assertion suffixes', () => {
    const payload = JSON.stringify({
      kind: 'Document',
      definitions: [],
      text: '} as unknown as DocumentNode<'.repeat(10_000),
    });
    const source = `${PRELUDE}\nexport const QUERY = ${payload} as unknown as DocumentNode<Result, Variables>; // retained comment`;
    const started = performance.now();
    const file = new PreviewTypeSourceFileCache().get(FILE, source, ts.ScriptTarget.ES2022);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(file.text).toBe(source);
  });

  it('avoids allocating the erased payload tree while retaining asserted result shapes', () => {
    const cache = new PreviewTypeSourceFileCache();
    const file = cache.get(FILE, SOURCE, ts.ScriptTarget.ES2022);
    expect(countNodes(file)).toBeLessThan(100);
    expect(file.text).toBe(SOURCE);
    expect(cache.get(FILE, SOURCE, ts.ScriptTarget.ES2022)).toBe(file);
    const analysis = createAnalysis(SOURCE, cache);
    expect(collectPreviewTypedDocumentShapes(analysis.checker, requireSource(analysis))).toEqual([
      {
        identifier: 'QUERY',
        shape: {
          kind: 'object',
          fields: { count: { kind: 'number' }, status: { kind: 'literal', value: 'READY' } },
        },
      },
    ]);
    expect(file.statements.map((statement) => statement.getText(file))).toEqual(
      ts
        .createSourceFile(FILE, SOURCE, ts.ScriptTarget.ES2022, true)
        .statements.map((s) => s.getText()),
    );
  });

  it('refreshes dirty types and restored text without mutating an earlier program', () => {
    const cache = new PreviewTypeSourceFileCache();
    const first = createAnalysis(SOURCE, cache);
    const changed = SOURCE.replace("'READY'", "'EDITED'");
    const next = createAnalysis(changed, cache);
    const restored = createAnalysis(SOURCE, cache);
    for (const [analysis, status] of [
      [first, 'READY'],
      [next, 'EDITED'],
      [restored, 'READY'],
    ] as const) {
      const file = requireSource(analysis);
      expect(file.text).toBe(status === 'EDITED' ? changed : SOURCE);
      expect(collectPreviewTypedDocumentShapes(analysis.checker, file)[0]?.shape).toEqual({
        kind: 'object',
        fields: { count: { kind: 'number' }, status: { kind: 'literal', value: status } },
      });
    }
    expect(next.status.admittedBytes).toBe(first.status.admittedBytes + 1);
    expect(restored.status.admittedBytes).toBe(first.status.admittedBytes);
  });

  it('keeps indexed calls, downstream typeof types and exported values', () => {
    const source = [
      SOURCE,
      "type Payload = ReturnType<NonNullable<typeof QUERY['__apiType']>>;",
      'declare function execute<R, V>(document: DocumentNode<R, V>): R;',
      'export const result = execute(QUERY);',
      'export const again = execute(QUERY);',
      'export declare const copied: Payload;',
    ].join('\n');
    const view = new PreviewTypeOracle().createView({
      rootPaths: [FILE],
      managedNodeModulesPaths: [],
      readSnapshot: (file) => (file === FILE ? source : undefined),
    });
    for (const occurrence of [0, 1]) {
      expect(
        view.readTypedCallValue({
          sourcePath: FILE,
          callText: 'execute(QUERY)',
          occurrence,
          requiredPaths: [],
        })?.value,
      ).toEqual({ count: 0, status: 'READY' });
    }
    expect(
      view.readTypedExportValue({ sourcePath: FILE, exportName: 'copied', requiredPaths: [] })
        ?.value,
    ).toEqual({ count: 0, status: 'READY' });
    view.release();
  });

  it.each([
    ['comment', `${PRELUDE}\n/*\n${DOCUMENT}\n*/\n`],
    ['template', `${PRELUDE}\nconst text = \`\n${DOCUMENT}\n\`;\n`],
    ['nested declaration', `${PRELUDE}\nnamespace Nested {\n${DOCUMENT}\n}\n`],
    ['missing semicolon', `${PRELUDE}\n${DOCUMENT.slice(0, -1)}\n[0];\n`],
    ['single assertion', SOURCE.replace(' as unknown', '')],
    ['non-JSON expression', SOURCE.replace(PAYLOAD, '{"kind":"Document","definitions":factory()}')],
    ['malformed JSON', SOURCE.replace(PAYLOAD, '{"kind":"Document","definitions":[],}')],
    ['parse error elsewhere', `${SOURCE}\nexport const broken = ;`],
    ['mixed real and lookalike', `${SOURCE}\n/*\n${DOCUMENT.replace('QUERY', 'FAKE')}\n*/`],
  ])('retains original syntax for %s', (_label, source) => {
    const actual = new PreviewTypeSourceFileCache().get(FILE, source, ts.ScriptTarget.ES2022);
    const original = ts.createSourceFile(FILE, source, ts.ScriptTarget.ES2022, true);
    expect(nodeInventory(actual)).toEqual(nodeInventory(original));
    expect(actual.text).toBe(source);
  });

  it.each(['generated.tsx', 'generated.jsx', 'generated.js', 'generated.d.ts'])(
    'keeps unsupported %s grammar on the normal parser',
    (name) => {
      const actual = new PreviewTypeSourceFileCache().get(name, SOURCE, ts.ScriptTarget.ES2022);
      expect(nodeInventory(actual)).toEqual(
        nodeInventory(ts.createSourceFile(name, SOURCE, ts.ScriptTarget.ES2022, true)),
      );
    },
  );
});

/** Supplies virtual source snapshots to the actual budgeted compiler host. */
function createAnalysis(source: string, cache: PreviewTypeSourceFileCache): PreviewTypeProgram {
  return createPreviewTypeProgram(
    {
      rootPaths: [FILE],
      managedNodeModulesPaths: [],
      readSnapshot: (f) => (f === FILE ? source : undefined),
    },
    cache,
  );
}

/** Fixture failures must explain missing admission rather than erase nullability checks. */
function requireSource(analysis: PreviewTypeProgram): ts.SourceFile {
  const file = analysis.program.getSourceFile(FILE);
  if (file === undefined) throw new Error('Fixture source was not admitted.');
  return file;
}

/** Counts the same child relation used by inference, rather than text size or a mock parser. */
function countNodes(file: ts.SourceFile): number {
  return nodeInventory(file).length;
}

/** Captures syntax and exact UTF-16 boundaries to detect accidental transformations on fallback. */
function nodeInventory(file: ts.SourceFile): readonly (readonly number[])[] {
  const result: number[][] = [];
  const visit = (node: ts.Node): void => {
    result.push([node.kind, node.pos, node.end]);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return result;
}
