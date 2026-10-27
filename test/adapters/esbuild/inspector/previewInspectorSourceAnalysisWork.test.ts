/** Verifies bounded parsing work while preserving real import and hook-projection decisions. */
import ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as renderAnalysis from '../../../../src/adapters/esbuild/renderGraph/previewRenderSourceAnalysis';
import { collectPreviewInspectorBundleSourceInventory } from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleSourceInventoryMemo';
import { collectPreviewInspectorRuntimeHookProjectionInventory } from '../../../../src/adapters/esbuild/inspector/previewInspectorShallowProjection';

// TypeScript exposes nonconfigurable getters. Wrap its real parser without replacing its work.
vi.mock('typescript', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof ts }>();
  return {
    ...actual,
    default: { ...actual.default, createSourceFile: vi.fn(actual.default.createSourceFile) },
  };
});

beforeEach(() => {
  vi.mocked(ts.createSourceFile).mockClear();
});

describe('source inventory parsing work', () => {
  it.each(['ts', 'tsx', 'jsx', 'mjs'])(
    'validates and inventories one %s source with a single parse',
    (extension) => {
      const source = [
        'import type { Props } from "./types";',
        'import { Widget as 화면 } from "./widget";',
        'export { screen } from "./exported";',
        'const deferred = import("./deferred");',
        'const packageValue = require("package");',
        'export const Page = () => 화면;',
      ].join('\n');
      const parse = vi.mocked(ts.createSourceFile);
      const inventory = collectPreviewInspectorBundleSourceInventory(
        `/work/inventory.${extension}`,
        source,
      );
      if (typeof inventory === 'string') throw new Error(inventory);
      expect(inventory.byteLength).toBe(Buffer.byteLength(source));
      expect(
        inventory.edges.map(({ kind, moduleSpecifier, importedNames }) => ({
          kind,
          moduleSpecifier,
          importedNames,
        })),
      ).toEqual([
        { kind: 'import', moduleSpecifier: './widget', importedNames: ['화면'] },
        { kind: 'export', moduleSpecifier: './exported', importedNames: ['screen'] },
        { kind: 'dynamic-import', moduleSpecifier: './deferred', importedNames: [] },
        { kind: 'require', moduleSpecifier: 'package', importedNames: [] },
      ]);
      expect(inventory.edges.map((edge) => edge.occurrenceStart)).toEqual([
        source.indexOf('"./widget"'),
        source.indexOf('"./exported"'),
        source.indexOf('"./deferred"'),
        source.indexOf('"package"'),
      ]);
      expect(Object.isFrozen(inventory)).toBe(true);
      expect(Object.isFrozen(inventory.edges)).toBe(true);
      expect(parse).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects malformed source using the same single validation parse', () => {
    const parse = vi.mocked(ts.createSourceFile);
    expect(
      collectPreviewInspectorBundleSourceInventory(
        '/work/broken.tsx',
        'import Page from "./page"; export const broken = <main>',
      ),
    ).toBe('source-parse-failure');
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it('keeps extension-specific parser recovery decisions', () => {
    const source = 'import { Page } from "./page"; export const render = () => <Page />;';
    expect(collectPreviewInspectorBundleSourceInventory('/work/grammar.ts', source)).toBe(
      'source-parse-failure',
    );
    expect(collectPreviewInspectorBundleSourceInventory('/work/grammar.tsx', source)).toMatchObject(
      { edges: [expect.objectContaining({ moduleSpecifier: './page' })] },
    );
  });
});

describe('hook projection analysis work', () => {
  it.each([
    ['plain', 'import { Widget } from "./widget"; export const Page = () => <Widget />;'],
    [
      'lazy',
      'import { useLazyQuery } from "./hooks"; export function Page() { const value = useLazyQuery(); return <p>{value.name}</p>; }',
    ],
  ])('skips render-graph analysis when %s source has no admitted hook call', (name, source) => {
    const analyze = vi.spyOn(renderAnalysis, 'analyzePreviewRenderSource');
    const result = collectPreviewInspectorRuntimeHookProjectionInventory(
      `/work/${name}.tsx`,
      source,
    );
    expect([...result.projectionsBySpecifier]).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(analyze).not.toHaveBeenCalled();
  });

  it('analyzes an admitted edit while keeping later hook removal free of render-graph work', () => {
    const analyze = vi.spyOn(renderAnalysis, 'analyzePreviewRenderSource');
    const plain = 'export const Page = () => <p />;';
    const hooked =
      'import { useData } from "./hooks"; export function Page() { const data = useData(); return <p>{data.name}</p>; }';
    const sourcePath = '/work/edited-projection.tsx';
    expect([
      ...collectPreviewInspectorRuntimeHookProjectionInventory(sourcePath, plain)
        .projectionsBySpecifier,
    ]).toEqual([]);
    expect([
      ...collectPreviewInspectorRuntimeHookProjectionInventory(sourcePath, hooked)
        .projectionsBySpecifier,
    ]).toEqual([
      [
        './hooks',
        {
          exportNames: ['useData'],
          moduleSpecifier: './hooks',
          runtimeHookExportNames: ['useData'],
        },
      ],
    ]);
    expect([
      ...collectPreviewInspectorRuntimeHookProjectionInventory(sourcePath, plain)
        .projectionsBySpecifier,
    ]).toEqual([]);
    expect(analyze).toHaveBeenCalledTimes(1);
  });
});
