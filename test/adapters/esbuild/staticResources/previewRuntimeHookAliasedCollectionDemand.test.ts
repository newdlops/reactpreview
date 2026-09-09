/** Reproduces missing nested item fields after a hook collection is filtered before helper calls. */
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { PreviewRuntimeHookChildPropDemandCatalogBuilder } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookChildPropDemand';
import { createPreviewRuntimeHookReplacements } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookInstrumentation';
import { PreviewSourceTransformer } from '../../../../src/adapters/esbuild/staticResources/previewSourceTransformer';

/** Compiles syntax-only fixture modules, then executes only their generated fallback and readers. */
async function createFixture(
  collection: string,
  extraReads = '',
  mutable = false,
  pipeline = false,
): Promise<{
  readonly run: () => unknown[] | undefined;
  readonly metadata: readonly { requiredPaths?: string[] }[];
  readonly transformed: string;
}> {
  const sourcePath = '/workspace/List.tsx';
  const helperPath = '/workspace/card.ts';
  const source = `
    import { useQueryContext } from './query';
    import { buildCard } from './card';
    export function List() {
      const { data } = useQueryContext();
      ${mutable ? 'let' : 'const'} visible = ${collection};
      ${extraReads}
      return visible.map(item => buildCard({ item }));
    }
  `;
  const helper = `
    export const buildCard = ({ item }) => ({
      id: item.id, name: item.fund.name, manager: item.fund.gp.name,
      requestor: item.requestor.fullName,
    });
  `;
  const readSource = (file: string): string | undefined =>
    file === helperPath ? helper : undefined;
  const resolveModule = (specifier: string, consumer: string): string | undefined =>
    consumer === sourcePath && specifier === './card' ? helperPath : undefined;
  const builder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
    readSource,
    resolveModule,
    workspaceRoot: '/workspace',
  });
  const replacements = createPreviewRuntimeHookReplacements(
    sourcePath,
    source,
    builder.collect(sourcePath, source),
    builder.inferLocalTypeFallback.bind(builder, sourcePath, source),
    builder.inferImportedHelperArrayItemFallback.bind(builder, sourcePath, source),
    builder.inferImportedHelperParameterPropertyFallback.bind(builder, sourcePath, source),
    builder.inferImportedCollectionCallbackItemFallback.bind(builder, sourcePath, source),
  );
  let transformed = source;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    transformed =
      transformed.slice(0, replacement.start) +
      replacement.replacement +
      transformed.slice(replacement.end);
  }
  if (pipeline) {
    const transformer = new PreviewSourceTransformer({
      graphqlModuleResolver: { resolve: resolveModule },
      instrumentRuntimeHookFallbacks: true,
      projectRoot: '/workspace',
      readGraphqlSource: readSource,
      workspaceRoot: '/workspace',
    });
    transformed = (await transformer.transform(sourcePath, source)).contents;
  }
  const compile = (text: string): string =>
    ts.transpileModule(text, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
  const helperExports: Record<string, unknown> = {};
  vm.runInNewContext(compile(helper), { exports: helperExports }, { timeout: 2_000 });
  const exports: { List?: () => unknown[] } = {};
  const metadata: { requiredPaths?: string[] }[] = [];
  const context = {
    exports,
    require: (name: string) => {
      if (name === './card') return helperExports;
      if (name === 'react-preview:context') {
        return { registerPreviewContextRequirement: () => undefined };
      }
      return { useQueryContext: () => undefined };
    },
    [Symbol.for('newdlops.react-file-preview.page-inspector')]: {
      resolveRuntimeHook: (
        _run: unknown,
        fallback: () => unknown,
        record: (typeof metadata)[number],
      ) => {
        metadata.push(record);
        return fallback();
      },
    },
  };
  vm.runInNewContext(compile(transformed), context, { timeout: 2_000 });
  return { run: () => exports.List?.(), metadata, transformed };
}

describe.each([false, true])(
  'hook collection item demand across aliases (pipeline=%s)',
  (pipeline) => {
    it.each([
      'data.invitations',
      'data.invitations.filter(item => item.status !== "rejected")',
      'data.invitations.slice(0, 3)',
      'data.invitations.filter(item => item.status !== "rejected").slice(0, 3)',
    ])('preserves imported helper fields through %s', async (collection) => {
      const fixture = await createFixture(collection, '', false, pipeline);
      const rows = fixture.run();
      expect(rows?.length).toBeGreaterThan(0);
      expect(rows?.[0]).toMatchObject({ name: 'name', manager: 'name', requestor: 'fullName' });
      expect(fixture.metadata[0]?.requiredPaths?.join(' ')).toContain('fund.gp.name');
    });

    it('retains fields from multiple readers of the same aliased collection', async () => {
      const fixture = await createFixture(
        'data.invitations.filter(item => item.status !== "rejected")',
        'visible.map(item => item.createdAt.slice(0, 10));',
        false,
        pipeline,
      );
      expect(fixture.run()?.length).toBeGreaterThan(0);
      const paths = fixture.metadata[0]?.requiredPaths?.join(' ');
      expect(paths).toContain('createdAt');
      expect(paths).toContain('fund.gp.name');
    });

    it.each([
      { collection: 'data.invitations.map(item => ({ id: item.id }))', mutable: false },
      { collection: 'data.invitations', mutable: true },
    ])(
      'does not transfer helper fields through an unproven origin: $collection / mutable=$mutable',
      async ({ collection, mutable }) => {
        const fixture = await createFixture(collection, '', mutable, pipeline);
        try {
          fixture.run();
        } catch {
          /* Opaque paths may remain unresolved; they must not claim false evidence. */
        }
        expect(fixture.metadata.length).toBeGreaterThan(0);
        expect(fixture.metadata[0]?.requiredPaths?.join(' ')).not.toContain('fund.gp.name');
      },
    );
  },
);
