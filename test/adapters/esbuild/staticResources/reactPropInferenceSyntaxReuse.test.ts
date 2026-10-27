/** Reuses inert props syntax while refreshing imported contracts, child demands and budgets. */
import ts from 'typescript';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  clearPreviewAnalysisSourceFileCache,
  readPreviewAnalysisSourceFile,
} from '../../../../src/adapters/esbuild/previewAnalysisSourceFile';
import {
  collectReactExportPropInference,
  collectReactLocalComponentPropInference,
  type PreviewChildPropDemandCatalog,
  type PreviewPropInferenceOptions,
} from '../../../../src/adapters/esbuild/staticResources/reactExportPropInference';
import { collectStaticRegistryDiscriminantHints } from '../../../../src/adapters/esbuild/staticResources/reactPropInferenceRegistry';

vi.mock('typescript', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof ts }>();
  return {
    ...actual,
    default: { ...actual.default, createSourceFile: vi.fn(actual.default.createSourceFile) },
  };
});

beforeEach(() => {
  clearPreviewAnalysisSourceFileCache();
  vi.mocked(ts.createSourceFile).mockClear();
});

const SOURCE_PATH = '/workspace/Page.tsx';

it('shares an unbound parent-linked tree between exported and local component inference', () => {
  const source = [
    'export function Page({ count }: { count: number }) { return <>{count}</>; }',
    'function Local({ count }: { count: number }) { return <>{count}</>; }',
  ].join('\n');
  const tree = readPreviewAnalysisSourceFile(SOURCE_PATH, source, ts.ScriptKind.TSX);
  const positions: { node: ts.Node; parent: ts.Node; pos: number; end: number }[] = [];
  const visit = (node: ts.Node): void => {
    positions.push({ node, parent: node.parent, pos: node.pos, end: node.end });
    ts.forEachChild(node, visit);
  };
  visit(tree);
  const exported = collectReactExportPropInference(SOURCE_PATH, source);
  const local = collectReactLocalComponentPropInference(SOURCE_PATH, source, ['Local']);
  expect(exported.Page?.shape.properties?.count).toEqual({ kind: 'number' });
  expect(local.Local).toEqual(exported.Page);
  for (const saved of positions) {
    expect(saved.node.parent).toBe(saved.parent);
    expect(saved.node.pos).toBe(saved.pos);
    expect(saved.node.end).toBe(saved.end);
    expect(Reflect.get(saved.node, 'symbol')).toBeUndefined();
    expect(Reflect.get(saved.node, 'locals')).toBeUndefined();
  }
  expect(ts.createSourceFile).toHaveBeenCalledTimes(1);
});

it('refreshes resolver results through re-exports and a type closure with unchanged parent syntax', () => {
  const source = [
    'import type { Item } from "./barrel";',
    'export function Page({ items }: { items: Item[] }) { return <>{items.length}</>; }',
    'function Local({ items }: { items: Item[] }) { return <>{items.length}</>; }',
  ].join('\n');
  const tree = readPreviewAnalysisSourceFile(SOURCE_PATH, source, ts.ScriptKind.TSX);
  const barrel = 'export type { Item } from "./types";';
  const types = 'import type { Detail } from "./detail"; export interface Item extends Detail {}';
  const resolver = (detail: string): NonNullable<PreviewPropInferenceOptions['resolveImport']> =>
    vi.fn((specifier) => {
      if (specifier === './barrel')
        return { sourcePath: '/workspace/barrel.ts', sourceText: barrel };
      if (specifier === './types') return { sourcePath: '/workspace/types.ts', sourceText: types };
      if (specifier === './detail')
        return { sourcePath: '/workspace/detail.ts', sourceText: detail };
      return undefined;
    });
  const firstResolver = resolver('export interface Detail { count: number; }');
  const first = collectReactExportPropInference(SOURCE_PATH, source, {
    resolveImport: firstResolver,
  });
  const nextResolver = resolver('export interface Detail { enabled: boolean; }');
  const next = collectReactLocalComponentPropInference(SOURCE_PATH, source, ['Local'], {
    resolveImport: nextResolver,
  });
  const firstItem = first.Page?.shape.properties?.items?.items;
  const nextItem = next.Local?.shape.properties?.items?.items;
  expect(firstItem?.properties).toEqual({ count: { kind: 'number' } });
  expect(nextItem?.properties).toEqual({ enabled: { kind: 'boolean' } });
  expect(firstItem?.properties).toEqual({ count: { kind: 'number' } });
  for (const resolveImport of [firstResolver, nextResolver]) {
    expect(resolveImport).toHaveBeenCalledWith('./barrel', SOURCE_PATH);
    expect(resolveImport).toHaveBeenCalledWith('./types', '/workspace/barrel.ts');
    expect(resolveImport).toHaveBeenCalledWith('./detail', '/workspace/types.ts');
  }
  expect(tree.text).toBe(source);
  expect(ts.createSourceFile).toHaveBeenCalledTimes(5);
});

it('reads each new lazy child catalog instead of retaining the previous inferred result', () => {
  const source = [
    'export function Page({ row }: any) { return <Child row={row} />; }',
    'function Local({ row }: any) { return <Child row={row} />; }',
  ].join('\n');
  const tree = readPreviewAnalysisSourceFile(SOURCE_PATH, source, ts.ScriptKind.TSX);
  const firstCatalog: PreviewChildPropDemandCatalog = new Map([
    ['Child', new Map([['row', { kind: 'object', properties: { count: { kind: 'number' } } }]])],
  ]);
  const nextCatalog: PreviewChildPropDemandCatalog = new Map([
    ['Child', new Map([['row', { kind: 'object', properties: { enabled: { kind: 'boolean' } } }]])],
  ]);
  const readFirst = vi.fn(() => firstCatalog);
  const readNext = vi.fn(() => nextCatalog);
  const first = collectReactExportPropInference(SOURCE_PATH, source, {
    childPropDemands: readFirst,
  });
  const next = collectReactLocalComponentPropInference(SOURCE_PATH, source, ['Local'], {
    childPropDemands: readNext,
  });
  expect(first.Page?.shape.properties?.row?.properties).toEqual({ count: { kind: 'number' } });
  expect(next.Local?.shape.properties?.row?.properties).toEqual({ enabled: { kind: 'boolean' } });
  expect(readFirst).toHaveBeenCalledTimes(1);
  expect(readNext).toHaveBeenCalledTimes(1);
  expect(tree.text).toBe(source);
  expect(ts.createSourceFile).toHaveBeenCalledTimes(1);
});

it('honors current edits, parse failures and the caller grammar before restoring prior source', () => {
  const source = 'export function Page({ count }: { count: number }) { return <>{count}</>; }';
  const edited =
    'export function Page({ enabled }: { enabled: boolean }) { return <>{enabled}</>; }';
  const tree = readPreviewAnalysisSourceFile(SOURCE_PATH, source, ts.ScriptKind.TSX);
  const first = collectReactExportPropInference(SOURCE_PATH, source);
  expect(collectReactExportPropInference(SOURCE_PATH, edited).Page?.shape.properties).toEqual({
    enabled: { kind: 'boolean' },
  });
  expect(collectReactExportPropInference(SOURCE_PATH, 'export function Page(')).toEqual({});
  expect(collectReactExportPropInference(SOURCE_PATH, source)).toEqual(first);
  const wrongGrammar = readPreviewAnalysisSourceFile(
    '/workspace/Page.ts',
    source,
    ts.ScriptKind.TSX,
  );
  expect(collectReactExportPropInference('/workspace/Page.ts', source)).toEqual({});
  expect(wrongGrammar.text).toBe(tree.text);
  expect(ts.createSourceFile).toHaveBeenCalledTimes(6);
});

it('charges the original per-call module budget even for prewarmed imported trees', () => {
  const modules = Array.from({ length: 13 }, (_, index) => ({
    sourcePath: `/workspace/item${index.toString()}.ts`,
    sourceText: `export interface Item${index.toString()} { count: number; }`,
  }));
  const trees = modules.map((module) =>
    readPreviewAnalysisSourceFile(module.sourcePath, module.sourceText, ts.ScriptKind.TS),
  );
  const source = [
    ...modules.map(
      (_, index) => `import type { Item${index.toString()} } from "./item${index.toString()}";`,
    ),
    `export function Page(props: { ${modules.map((_, index) => `items${index.toString()}: Item${index.toString()}[]`).join(';')} }) { return <>{props.items0.length}</>; }`,
  ].join('\n');
  const root = readPreviewAnalysisSourceFile(SOURCE_PATH, source, ts.ScriptKind.TSX);
  const resolveImport = vi.fn((specifier: string) => modules[Number(specifier.slice(6))]);
  const result = collectReactExportPropInference(SOURCE_PATH, source, { resolveImport });
  expect(result.Page?.shape.properties?.items11?.items?.properties).toEqual({
    count: { kind: 'number' },
  });
  expect(result.Page?.shape.properties?.items12).toEqual({ kind: 'array' });
  expect(resolveImport).toHaveBeenCalledTimes(13);
  expect(trees).toHaveLength(13);
  expect(root.text).toBe(source);
  expect(ts.createSourceFile).toHaveBeenCalledTimes(14);
});

it('refreshes imported registry keys and rejects an invalid replacement without caching hints', () => {
  const source =
    'import { StatusCopy } from "./labels"; export function Page({ status }: any) { return <>{StatusCopy[status]}</>; }';
  const tree = readPreviewAnalysisSourceFile(SOURCE_PATH, source, ts.ScriptKind.TSX);
  const firstSource = 'export const StatusCopy = { open: "Open" };';
  const importedTree = readPreviewAnalysisSourceFile(
    '/workspace/labels.ts',
    firstSource,
    ts.ScriptKind.TS,
  );
  const readHints = (
    sourceText: string,
  ): ReturnType<typeof collectStaticRegistryDiscriminantHints> =>
    collectStaticRegistryDiscriminantHints(tree, SOURCE_PATH, {
      resolveImport: () => ({ sourcePath: '/workspace/labels.ts', sourceText }),
    });
  expect([...readHints(firstSource)]).toEqual([['status', 'open']]);
  expect([...readHints('export const StatusCopy = { done: "Done" };')]).toEqual([
    ['status', 'done'],
  ]);
  expect([...readHints('export const StatusCopy = {')]).toEqual([]);
  expect(importedTree.text).toBe(firstSource);
  expect(ts.createSourceFile).toHaveBeenCalledTimes(4);
});
