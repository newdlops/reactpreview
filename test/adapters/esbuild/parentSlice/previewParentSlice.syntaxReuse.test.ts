/** Parent-slice readers share only exact inert syntax while preserving live edits and ownership. */
import ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  analyzePreviewLocalParentSlices,
  analyzePreviewParentSlices,
} from '../../../../src/adapters/esbuild/parentSlice/previewParentSlice';
import {
  clearPreviewAnalysisSourceFileCache,
  readPreviewAnalysisSourceFile,
} from '../../../../src/adapters/esbuild/previewAnalysisSourceFile';

vi.mock('typescript', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof ts }>();
  return {
    ...actual,
    default: { ...actual.default, createSourceFile: vi.fn(actual.default.createSourceFile) },
  };
});

const consumerPath = '/work/Page.tsx';
const sourceText = [
  'import { memo } from "react";',
  'import Target from "./Target";',
  'import { FormProvider } from "./Form";',
  'const Body = () => <FormProvider name="form"><Target id="first" /><section><Target id="second" /></section></FormProvider>;',
  'const Page = () => <main><Body /></main>;',
  'export { Body };',
  'export default memo(Page);',
].join('\n');

/** Keeps the selected target and source identity explicit across repeated analyses. */
function imported(
  text = sourceText,
  sourcePath = consumerPath,
): ReturnType<typeof analyzePreviewParentSlices> {
  return analyzePreviewParentSlices({
    consumerPath: sourcePath,
    sourceText: text,
    targetPath: '/work/Target.tsx',
    targetExportNames: ['default'],
  });
}

beforeEach(() => {
  clearPreviewAnalysisSourceFileCache();
  vi.mocked(ts.createSourceFile).mockClear();
});

describe('parent-slice read-only syntax reuse', () => {
  it('shares an existing parse across imported and local owners without changing nodes', () => {
    const tree = readPreviewAnalysisSourceFile(consumerPath, sourceText, ts.ScriptKind.TSX);
    const nodes: { node: ts.Node; parent: ts.Node; pos: number; end: number; keys: string[] }[] =
      [];
    const snapshot = (node: ts.Node): void => {
      nodes.push({
        node,
        parent: node.parent,
        pos: node.pos,
        end: node.end,
        keys: Object.keys(node),
      });
      ts.forEachChild(node, snapshot);
    };
    snapshot(tree);
    const first = imported();
    expect(first.status).toBe('ok');
    expect(first.limitReached).toBe(false);
    expect(first.slices.map((slice) => slice.targetProps)).toEqual([
      { id: 'first' },
      { id: 'second' },
    ]);
    expect(first.slices.map((slice) => slice.owner)).toEqual([
      { localName: 'Body', exportNames: ['Body'] },
      { localName: 'Body', exportNames: ['Body'] },
    ]);
    expect(first.slices.map((slice) => slice.occurrenceStart)).toEqual([
      sourceText.indexOf('<Target id="first"'),
      sourceText.indexOf('<Target id="second"'),
    ]);
    const local = analyzePreviewLocalParentSlices({
      consumerPath,
      sourceText,
      localComponentName: 'Body',
    });
    expect(local.slices).toHaveLength(1);
    expect(local.slices[0]?.owner).toEqual({ localName: 'Page', exportNames: ['default'] });
    expect(imported()).toEqual(first);
    for (const saved of nodes) {
      expect(saved.node.parent).toBe(saved.parent);
      expect(saved.node.pos).toBe(saved.pos);
      expect(saved.node.end).toBe(saved.end);
      expect(Object.keys(saved.node)).toEqual(saved.keys);
    }
    expect(readPreviewAnalysisSourceFile(consumerPath, sourceText, ts.ScriptKind.TSX)).toBe(tree);
    expect(ts.createSourceFile).toHaveBeenCalledTimes(1);
  });

  it('reads unsaved edits and parse errors instead of reusing an earlier source snapshot', () => {
    expect(imported().slices[0]?.targetProps).toEqual({ id: 'first' });
    const edited = sourceText.replace('id="first"', 'id="edited"');
    expect(imported(edited).slices[0]?.targetProps).toEqual({ id: 'edited' });
    expect(imported('const Broken = <div').status).toBe('parse-error');
    expect(imported().slices[0]?.targetProps).toEqual({ id: 'first' });
    expect(ts.createSourceFile).toHaveBeenCalledTimes(4);
  });

  it('separates exact parser file names and grammars', () => {
    readPreviewAnalysisSourceFile(consumerPath, sourceText, ts.ScriptKind.JSX);
    expect(imported().slices).toHaveLength(2);
    expect(imported(sourceText, '/work/Other.tsx').slices).toHaveLength(2);
    expect(imported().slices).toHaveLength(2);
    expect(ts.createSourceFile).toHaveBeenCalledTimes(3);
  });

  it('keeps larger source syntax outside the shared retention budget', () => {
    const large = '/*' + ' '.repeat(129 * 1024) + '*/\n' + sourceText;
    const first = imported(large);
    expect(first.status).toBe('ok');
    expect(first.slices).toHaveLength(2);
    expect(imported(large)).toEqual(first);
    expect(ts.createSourceFile).toHaveBeenCalledTimes(2);
  });

  it('reparses after the compiler clears its analysis cache', () => {
    const first = imported();
    clearPreviewAnalysisSourceFileCache();
    expect(imported()).toEqual(first);
    expect(ts.createSourceFile).toHaveBeenCalledTimes(2);
  });
});
