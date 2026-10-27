/** Shared syntax must never retain dependency decisions or callback-bearing transformer state. */
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearPreviewAnalysisSourceFileCache,
  readPreviewAnalysisSourceFile,
} from '../../../../src/adapters/esbuild/previewAnalysisSourceFile';
import { PreviewRuntimeHookChildPropDemandCatalogBuilder } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookChildPropDemand';
import { createPreviewRuntimeHookReplacements } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookInstrumentation';
import { collectPreviewRuntimeHookProjectionEvidence } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookProjectionEvidence';
import type { PreviewInferredPropShape } from '../../../../src/adapters/esbuild/staticResources/reactExportPropInference';

afterEach(() => {
  clearPreviewAnalysisSourceFileCache();
});

const PARENT_PATH = '/workspace/SyntaxDemandParent.tsx';
const CHILD_PATH = '/workspace/SyntaxDemandChild.tsx';
const PARENT_SOURCE = [
  'import { Child } from "./Child";',
  'import { useItem } from "./hooks";',
  'export function Parent() { const item = useItem(); return <Child item={item} />; }',
].join('\n');

describe('read-only demand syntax reuse', () => {
  it('keeps current imported child snapshots independent across builders', () => {
    readPreviewAnalysisSourceFile(PARENT_PATH, PARENT_SOURCE, ts.ScriptKind.TSX);
    const firstSource =
      'export function Child({ item }: { item: { first: string } }) { return <p>{item.first}</p>; }';
    const nextSource =
      'export function Child({ item }: { item: { count: number } }) { return <p>{item.count}</p>; }';
    const first = childDemand(firstSource);
    const second = childDemand(nextSource);
    expect(first?.properties?.first?.kind).toBe('string');
    expect(first?.properties?.count).toBeUndefined();
    expect(second?.properties?.count?.kind).toBe('number');
    expect(second?.properties?.first).toBeUndefined();
    expect(childDemand(firstSource)).toEqual(first);
    expect(first?.properties?.first?.kind).toBe('string');
  });

  it('keeps a changed resolver independent when the parent syntax is identical', () => {
    const source =
      'export function Child({ item }: { item: { name: string } }) { return <p>{item.name}</p>; }';
    const makeBuilder = (
      resolved: string | undefined,
    ): PreviewRuntimeHookChildPropDemandCatalogBuilder =>
      new PreviewRuntimeHookChildPropDemandCatalogBuilder({
        workspaceRoot: '/workspace',
        resolveModule: () => resolved,
        readSource: (sourcePath) => (sourcePath === CHILD_PATH ? source : undefined),
      });
    expect(makeBuilder(CHILD_PATH).collect(PARENT_PATH, PARENT_SOURCE).has('Child')).toBe(true);
    expect(makeBuilder(undefined).collect(PARENT_PATH, PARENT_SOURCE).has('Child')).toBe(false);
    expect(makeBuilder('/outside/Child.tsx').collect(PARENT_PATH, PARENT_SOURCE).has('Child')).toBe(
      false,
    );
  });

  it('keeps transformation callbacks off an already shared analysis tree', () => {
    const sourcePath = '/workspace/PrivateHookCallbackSyntax.tsx';
    const source =
      'import { useItem } from "./hooks"; export function Page() { return <Child item={useItem()} />; }';
    const shared = readPreviewAnalysisSourceFile(sourcePath, source, ts.ScriptKind.TSX);
    const catalog = new Map([
      [
        'Child',
        new Map([['item', { kind: 'object', properties: { name: { kind: 'string' } } } as const]]),
      ],
    ]);
    const readCatalog = vi.fn(() => catalog);
    const first = createPreviewRuntimeHookReplacements(sourcePath, source, readCatalog);
    const second = createPreviewRuntimeHookReplacements(sourcePath, source, readCatalog);
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
    expect(readCatalog).toHaveBeenCalledTimes(2);
    collectPreviewRuntimeHookProjectionEvidence(sourcePath, source);
    expect(readCatalog).toHaveBeenCalledTimes(2);
    expect(readPreviewAnalysisSourceFile(sourcePath, source, ts.ScriptKind.TSX)).toBe(shared);
    expect(shared.text).toBe(source);
  });
});

/** Resolve the same import identity against one build's current source, without any filesystem IO. */
function childDemand(source: string): PreviewInferredPropShape | undefined {
  const builder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
    workspaceRoot: '/workspace',
    resolveModule: (specifier) => (specifier === './Child' ? CHILD_PATH : undefined),
    readSource: (sourcePath) => (sourcePath === CHILD_PATH ? source : undefined),
  });
  return builder.collect(PARENT_PATH, PARENT_SOURCE).get('Child')?.get('item');
}
