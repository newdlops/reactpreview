/**
 * Verifies declared GraphQL result shapes for Virtual Backend payloads.
 * A virtual module mirrors codegen output: a `TypedDocumentNode` result type with nullable
 * wrappers, a closed status union, and a document constant handed to a project query helper.
 */
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { collectPreviewTypedDocumentShapes } from '../../../../src/adapters/esbuild/typeOracle/previewTypedDocumentShapes';
import { createPreviewTypedDocumentRegistrations } from '../../../../src/adapters/esbuild/staticResources/previewTypedDocumentRegistrations';
import type { PreviewTypeOracleView } from '../../../../src/adapters/esbuild/typeOracle/previewTypeOracle';

const ENTRY = '/virtual/queries.ts';

const CODEGEN_PRELUDE = [
  "interface DocumentNode { readonly kind: 'Document'; readonly definitions: readonly unknown[] }",
  'interface TypedDocumentNode<Result, Variables> extends DocumentNode {',
  '  __apiType?: (variables: Variables) => Result;',
  '}',
  'declare function gql(strings: TemplateStringsArray): DocumentNode;',
  'declare function createQueryRenderer(document: DocumentNode): void;',
  'type Maybe<T> = T | null;',
  "type TSALES_INTENT_STATUS = 'NOT_WILLING_TO_SELL' | 'WAITING_FOR_OFFERS' | 'UNKNOWN';",
  'type TINVESTMENT_QUERY = {',
  "  __typename?: 'Query';",
  '  investment: Maybe<{',
  "    __typename: 'Investment';",
  '    id: string;',
  '    salesIntentStatus: TSALES_INTENT_STATUS;',
  '    round: number;',
  '    issuedShares: Maybe<number>;',
  '    confirmed: boolean;',
  '    createdAt: Date;',
  '    files: Array<{ name: string; url: string }>;',
  '    onSelect: () => void;',
  '  }>;',
  '};',
  'declare const INVESTMENT_DOCUMENT: TypedDocumentNode<TINVESTMENT_QUERY, { id: string }>;',
].join('\n');

describe('collectPreviewTypedDocumentShapes', () => {
  /** A declared-and-used typed document yields one shape; untyped documents yield none. */
  it('describes a codegen result type as list-aware, literal-preserving payload shape', () => {
    const shapes = collectFromSource(
      [
        CODEGEN_PRELUDE,
        'export const INVESTMENT_QUERY: typeof INVESTMENT_DOCUMENT = gql`query Investment { id }` as never;',
        'export const PLAIN_QUERY = gql`query Plain { id }`;',
        'createQueryRenderer(INVESTMENT_QUERY);',
        'createQueryRenderer(PLAIN_QUERY);',
      ].join('\n'),
    );

    expect(shapes).toEqual([
      {
        identifier: 'INVESTMENT_QUERY',
        shape: {
          fields: {
            __typename: { kind: 'literal', value: 'Query' },
            investment: {
              fields: {
                __typename: { kind: 'literal', value: 'Investment' },
                confirmed: { kind: 'boolean' },
                createdAt: { kind: 'literal', value: '2026-01-15T09:00:00.000Z' },
                files: {
                  items: {
                    fields: { name: { kind: 'string' }, url: { kind: 'string' } },
                    kind: 'object',
                  },
                  kind: 'array',
                },
                id: { kind: 'string' },
                issuedShares: { kind: 'number' },
                round: { kind: 'number' },
                salesIntentStatus: { kind: 'literal', value: 'NOT_WILLING_TO_SELL' },
              },
              kind: 'object',
            },
          },
          kind: 'object',
        },
      },
    ]);
  });

  /** Locals inside functions are not in scope at module end, so they are never registered. */
  it('registers only module-scope bindings', () => {
    const shapes = collectFromSource(
      [
        CODEGEN_PRELUDE,
        'export function Page() {',
        '  const local: typeof INVESTMENT_DOCUMENT = INVESTMENT_DOCUMENT;',
        '  createQueryRenderer(local);',
        '}',
      ].join('\n'),
    );

    expect(shapes).toEqual([]);
  });
});

describe('createPreviewTypedDocumentRegistrations', () => {
  /** Registrations push `[document, shape]` into the shared queue and never throw. */
  it('emits guarded statements that queue the document with its shape', () => {
    const shape = {
      fields: { status: { kind: 'literal', value: 'UNKNOWN' } },
      kind: 'object',
    } as const;
    const oracle: PreviewTypeOracleView = {
      readStatus: () => undefined,
      readTypedCallValue: () => undefined,
      readTypedDocumentShapes: () => [
        { identifier: 'INVESTMENT_QUERY', shape },
        { identifier: 'not valid', shape },
      ],
      readTypedGuardValue: () => undefined,
      readTypedCallResponseShape: () => undefined,
      readTypedComponentProps: () => undefined,
      readTypedResponseShape: () => undefined,
      release: () => undefined,
    };
    const statements = createPreviewTypedDocumentRegistrations(oracle, '/w/queries.ts');
    const context = createContext({});
    runInContext(
      `const INVESTMENT_QUERY = { kind: 'Document' };\n${statements.join('\n')}`,
      context,
    );
    const registry: unknown = runInContext(
      "globalThis[Symbol.for('newdlops.react-file-preview.typed-graphql-documents')]",
      context,
    );

    expect(statements).toHaveLength(1);
    // An uninitialized binding, as in an import cycle, is swallowed instead of failing the module.
    expect(() => {
      runInContext(statements[0]?.replace('INVESTMENT_QUERY', 'UNDECLARED') ?? '', context);
    }).not.toThrow();
    expect(JSON.parse(JSON.stringify(registry))).toEqual([[{ kind: 'Document' }, shape]]);
    expect(createPreviewTypedDocumentRegistrations(undefined, '/w/queries.ts')).toEqual([]);
  });
});

/** Creates a checker over one virtual module and collects its typed document shapes. */
function collectFromSource(source: string): ReturnType<typeof collectPreviewTypedDocumentShapes> {
  const options: ts.CompilerOptions = {
    lib: ['lib.es2022.d.ts'],
    module: ts.ModuleKind.ESNext,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  };
  const host = ts.createCompilerHost(options, true);
  const readDisk = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion) =>
    fileName === ENTRY
      ? ts.createSourceFile(fileName, source, languageVersion, true)
      : readDisk(fileName, languageVersion);
  const program = ts.createProgram({ host, options, rootNames: [ENTRY] });
  const sourceFile = program.getSourceFile(ENTRY);
  if (sourceFile === undefined) throw new Error('The virtual module was not loaded.');
  return collectPreviewTypedDocumentShapes(program.getTypeChecker(), sourceFile);
}
