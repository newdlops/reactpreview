/** Verifies demand-driven child analysis preserves eager inference, including classes and item forwarding. */
import { describe, expect, it, vi } from 'vitest';
import {
  collectReactExportPropInference,
  type PreviewChildPropDemandCatalog,
  type PreviewInferredPropShape,
} from '../../../../src/adapters/esbuild/staticResources/reactExportPropInference';

const SOURCE_PATH = '/workspace/Page.tsx';
const row: PreviewInferredPropShape = {
  kind: 'object',
  properties: { title: { kind: 'string' }, items: { kind: 'array', items: { kind: 'number' } } },
};
const catalog: PreviewChildPropDemandCatalog = new Map([['Child', new Map([['row', row]])]]);

describe('lazy prop child demand', () => {
  it.each([
    'import { Child } from "./Child"; export const Page = () => <Child row={{ title: "literal" }} />;',
    'import { Child } from "./Child"; export function Page({ pageRoutes }: any) { return <main>{pageRoutes}<Child row={{ title: "literal" }} /></main>; }',
    'import { Child } from "./Child"; export const Page = createFeature(({ pageRoutes }: any) => <main>{pageRoutes}<Child row={externalData} /></main>);',
  ])('never loads child contracts without a prop-derived attribute: %s', (source) => {
    const readChildren = vi.fn(() => catalog);
    const lazy = collectReactExportPropInference(SOURCE_PATH, source, {
      childPropDemands: readChildren,
    });
    const eager = collectReactExportPropInference(SOURCE_PATH, source, {
      childPropDemands: catalog,
    });
    expect(lazy).toEqual(eager);
    expect(readChildren).not.toHaveBeenCalled();
  });

  it.each([
    'export function Page({ row }: any) { return <Child row={row} />; }',
    'export function Page(props: any) { const { row } = props; const forwarded = row; return <Child row={forwarded} />; }',
    'export class Page extends React.Component<{ row: unknown }> { render() { return <Child row={this.props.row} />; } }',
    'export function Page({ rows }: any) { return rows.map((item: any) => <Child row={item} />); }',
  ])('retains the complete eager contract for exact forwarding: %s', (source) => {
    const readChildren = vi.fn(() => catalog);
    const eager = collectReactExportPropInference(SOURCE_PATH, source, {
      childPropDemands: catalog,
    });
    const lazy = collectReactExportPropInference(SOURCE_PATH, source, {
      childPropDemands: readChildren,
    });
    expect(eager.Page?.provenance.length).toBeGreaterThan(0);
    expect(lazy).toEqual(eager);
    expect(readChildren).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(lazy)).toContain('title');
  });

  it('collects once across multiple exports and keeps shadowed/literal attributes out of prop demand', () => {
    const source = [
      'export function First({ row }: any) { return <><Child row={row} /><Child row={row} /></>; }',
      'export function Second({ row }: any) { return <Child row={row} />; }',
    ].join('\n');
    const readChildren = vi.fn(() => catalog);
    expect(
      collectReactExportPropInference(SOURCE_PATH, source, { childPropDemands: readChildren }),
    ).toEqual(collectReactExportPropInference(SOURCE_PATH, source, { childPropDemands: catalog }));
    expect(readChildren).toHaveBeenCalledTimes(1);
    const shadowed = vi.fn(() => catalog);
    const shadowedSource =
      'export function Page({ row }: any) { const view = (row: any) => <Child row={row} />; return <Child row={42} />; }';
    expect(
      collectReactExportPropInference(SOURCE_PATH, shadowedSource, { childPropDemands: shadowed }),
    ).toEqual(
      collectReactExportPropInference(SOURCE_PATH, shadowedSource, { childPropDemands: catalog }),
    );
    expect(shadowed).not.toHaveBeenCalled();
  });

  it('returns an empty recipe before resolving imports for zero-parameter function exports', () => {
    const resolveImport = vi.fn(() => undefined);
    const result = collectReactExportPropInference(
      SOURCE_PATH,
      'import type { Unused } from "./large-types"; export function Page() { return <main />; }',
      { resolveImport },
    );
    expect(result).toEqual({});
    expect(resolveImport).not.toHaveBeenCalled();
  });
});
