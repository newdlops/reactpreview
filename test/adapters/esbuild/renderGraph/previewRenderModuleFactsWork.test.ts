/** Guards linear syntax work while preserving exact createElement, JSX wrapper and CSS evidence. */
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectPreviewRenderModuleFactsFromSourceFile } from '../../../../src/adapters/esbuild/renderGraph/previewRenderModuleFacts';

vi.mock('typescript', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof ts }>();
  return {
    ...actual,
    default: { ...actual.default, forEachChild: vi.fn(actual.default.forEachChild) },
  };
});
afterEach(() => vi.restoreAllMocks());
const FILE = '/workspace/OwnerPage.tsx';

/** Parses current private source with parent links required by the existing graph collector. */
function parse(source: string): ts.SourceFile {
  return ts.createSourceFile(FILE, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

describe('render module syntax work', () => {
  it('keeps intrinsic wrappers absent without reading their authored tag text', () => {
    const source = parse(
      "import Target from './Target'; export const Owner = () => <div><Target /></div>;",
    );
    let tag: ts.JsxTagNameExpression | undefined;
    const find = (node: ts.Node): void => {
      if (ts.isJsxOpeningElement(node) && node.tagName.getText() === 'div') tag = node.tagName;
      ts.forEachChild(node, find);
    };
    find(source);
    if (tag === undefined) throw Error('Expected intrinsic tag');
    const getText = vi.spyOn(tag, 'getText');
    const facts = collectPreviewRenderModuleFactsFromSourceFile(FILE, source);
    expect(facts.localEdges.find((edge) => edge.childLocalName === 'Target')?.wrapperNames).toEqual(
      [],
    );
    expect(getText).not.toHaveBeenCalled();
  });
  it('reads one shared JSX ancestor label a constant number of times', () => {
    const source = parse(
      `import Layout from './Layout'; import Target from './Target'; export const OwnerPage = () => <Layout>${'<Target />'.repeat(40)}</Layout>;`,
    );
    let tag: ts.JsxTagNameExpression | undefined;
    const find = (node: ts.Node): void => {
      if (ts.isJsxOpeningElement(node) && node.tagName.getText() === 'Layout') tag = node.tagName;
      ts.forEachChild(node, find);
    };
    find(source);
    if (tag === undefined) throw Error('Expected Layout tag');
    const getText = vi.spyOn(tag, 'getText');
    const facts = collectPreviewRenderModuleFactsFromSourceFile(FILE, source);
    const targets = facts.localEdges.filter((edge) => edge.childLocalName === 'Target');
    expect(targets).toHaveLength(40);
    expect(targets.every((edge) => edge.wrapperNames.includes('Layout'))).toBe(true);
    expect(getText.mock.calls.length).toBeLessThanOrEqual(6);
    getText.mockClear();
    expect(collectPreviewRenderModuleFactsFromSourceFile(FILE, source)).toEqual(facts);
    expect(getText.mock.calls.length).toBeGreaterThan(0);
    expect(getText.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it('preserves route-element contribution order and adjacent wrapper deduplication', () => {
    const routes = parse(
      "import Route from './Route'; import Layout from './Layout'; import Target from './Target'; export const OwnerPage = () => <Route element={<Layout />}><Route element={<Layout />}><Target /></Route></Route>;",
    );
    const nested = parse(
      "import Layout from './Layout'; import Target from './Target'; export const Owner = () => <Layout><Layout><Target /></Layout></Layout>;",
    );
    const read = (file: ts.SourceFile): readonly string[] =>
      collectPreviewRenderModuleFactsFromSourceFile(FILE, file).localEdges.find(
        (edge) => edge.childLocalName === 'Target',
      )?.wrapperNames ?? [];
    expect(read(routes)).toEqual(['Layout', 'Route', 'Layout', 'Route']);
    expect(read(nested)).toEqual(['Layout']);
  });

  it('classifies createElement argument references without recursively walking each argument again', () => {
    const properties = Array.from(
      { length: 120 },
      (_, index) => `field${String(index)}: Token`,
    ).join(',');
    const source = parse(
      `import {createElement} from 'react'; import Target from './Target'; import Token from './Token'; export const Owner = () => createElement(Target,{${properties}});`,
    );
    let nodes = 0;
    const count = (node: ts.Node): void => {
      nodes++;
      ts.forEachChild(node, count);
    };
    count(source);
    const walk = vi.mocked(ts.forEachChild);
    walk.mockClear();
    const facts = collectPreviewRenderModuleFactsFromSourceFile(FILE, source);
    const references = facts.localEdges.filter((edge) => edge.childLocalName === 'Token');
    expect(references).toHaveLength(120);
    expect(references.every((edge) => edge.kind === 'create-element')).toBe(true);
    expect(walk.mock.calls.length).toBeLessThan(nodes * 8);
  });

  it('keeps callee reads separate from arguments and finds deep child arguments', () => {
    const source = parse(
      `import * as React from 'react'; import Target from './Target'; import Token from './Token'; export const Owner = () => React.createElement(Target,{data:{nested:[Token]}});`,
    );
    const facts = collectPreviewRenderModuleFactsFromSourceFile(FILE, source);
    expect(facts.localEdges.find((edge) => edge.childLocalName === 'React')?.kind).toBe(
      'value-flow',
    );
    expect(facts.localEdges.find((edge) => edge.childLocalName === 'Token')?.kind).toBe(
      'create-element',
    );
    expect(facts.localEdges.find((edge) => edge.childLocalName === 'Target')?.kind).toBe(
      'create-element',
    );
  });

  it('rebuilds wrapper names for edited source and keeps tagged-template selectors excluded', () => {
    const first = parse(
      "import Target from './Target'; import Layout from './Layout'; export const Owner = () => <Layout><Target /></Layout>;",
    );
    const edited = parse(
      "import Target from './Target'; import Shell from './Shell'; export const Owner = () => <Shell><Target /></Shell>;",
    );
    const read = (file: ts.SourceFile): readonly string[] =>
      collectPreviewRenderModuleFactsFromSourceFile(FILE, file).localEdges.find(
        (edge) => edge.childLocalName === 'Target',
      )?.wrapperNames ?? [];
    expect(read(first)).toEqual(['Layout']);
    expect(read(edited)).toEqual(['Shell']);
    expect(read(first)).toEqual(['Layout']);
    const css = parse(
      "import styled from 'styled-components'; import Target from './Target'; export const Shell = styled.div`color: red; ${Target} { color: blue; }`; ",
    );
    expect(
      collectPreviewRenderModuleFactsFromSourceFile(FILE, css).localEdges.some(
        (edge) => edge.childLocalName === 'Target',
      ),
    ).toBe(false);
  });
});
