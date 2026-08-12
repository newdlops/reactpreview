/** Verifies selected-corridor dependency pass-through without invoking the filesystem or esbuild. */
import { describe, expect, it } from 'vitest';
import { canPassThroughPreviewDependency } from '../../../../src/adapters/esbuild/staticResources/previewDependencyPassThroughPolicy';

describe('preview dependency pass-through policy', () => {
  /** Ordinary syntax can use esbuild directly only inside a selected-corridor preparation. */
  it('admits a compatible corridor dependency and rejects workspace-complete preparation', () => {
    const source = 'export const value = 1;';

    expect(
      canPassThroughPreviewDependency('/workspace/src/value.ts', source, {
        selectiveDependencyPassThrough: true,
      }),
    ).toBe(true);
    expect(
      canPassThroughPreviewDependency('/workspace/src/value.ts', source, {
        selectiveDependencyPassThrough: false,
      }),
    ).toBe(false);
  });

  /** The selected editor document always receives scenario registrations and runtime adapters. */
  it('rejects the selected document after normalizing equivalent path spellings', () => {
    expect(
      canPassThroughPreviewDependency(
        '/workspace/src/Card.tsx',
        'export const Card = () => <div />;',
        {
          documentPath: '/workspace/src/./Card.tsx',
          selectiveDependencyPassThrough: true,
        },
      ),
    ).toBe(false);
  });

  /** Framework and resource syntax retains the complete compatibility transform. */
  it('rejects a dependency whose source requires fast compatibility handling', () => {
    expect(
      canPassThroughPreviewDependency(
        '/workspace/src/routes.tsx',
        'const pages = import.meta.glob("./pages/*.tsx");',
        { selectiveDependencyPassThrough: true },
      ),
    ).toBe(false);
  });

  /** Ordinary TSX has no Inspector behavior to preserve and remains a native esbuild input. */
  it('admits a presentational TSX dependency while render instrumentation is enabled', () => {
    expect(
      canPassThroughPreviewDependency(
        '/workspace/src/Panel.tsx',
        'export function Panel() { return <section className="panel">Panel</section>; }',
        { instrumentRenderConditions: true, selectiveDependencyPassThrough: true },
      ),
    ).toBe(true);
  });

  /** Compiler-proven Page Execution surfaces retain their composition transforms. */
  it('rejects an otherwise ordinary TSX dependency when its normalized path is critical', () => {
    const sourcePath = '/workspace/src/shell/Panel.tsx';
    const sourceText =
      'export function Panel() { return <section className="panel">Panel</section>; }';

    expect(
      canPassThroughPreviewDependency(sourcePath, sourceText, {
        instrumentRenderConditions: true,
        selectiveDependencyPassThrough: true,
      }),
    ).toBe(true);
    expect(
      canPassThroughPreviewDependency(sourcePath, sourceText, {
        criticalSurfaceSourcePaths: ['/workspace/src/shell/./Panel.tsx'],
        instrumentRenderConditions: true,
        selectiveDependencyPassThrough: true,
      }),
    ).toBe(false);
  });

  /** Every runtime-instrumentation lexical family remains on the conservative path. */
  it.each([
    ['deferred event', 'export const Panel = () => <button onClick={() => modal.show()}>Open</button>;'],
    ['conditional JSX', 'export const Panel = () => enabled && <section />;'],
    ['async component', 'async function Panel() { return <section />; } export const App = () => <Panel />;'],
    ['React effect', "import { useEffect } from 'react'; export const Panel = () => { useEffect(() => {}); return <section />; };"],
    ['ambiguous syntax', 'export const Panel = () => enabled ? <section /> :'],
  ])('rejects %s source', (_family, sourceText) => {
    expect(
      canPassThroughPreviewDependency('/workspace/src/Panel.tsx', sourceText, {
        instrumentRenderConditions: true,
        selectiveDependencyPassThrough: true,
      }),
    ).toBe(false);
  });
});
