/**
 * Verifies syntax-only ReactDOM entry discovery. Fixtures exercise every supported mounting API,
 * alias and namespace imports, assigned roots, JSX name extraction, and conservative rejection of
 * shadowed or merely render-shaped application code.
 */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { collectPreviewEntryPointEvidence } from '../../../../src/adapters/esbuild/renderGraph/previewEntryPointEvidence';

const SOURCE_PATH = '/workspace/src/index.tsx';

describe('collectPreviewEntryPointEvidence', () => {
  /** Finds a direct aliased createRoot chain and preserves authored provider order. */
  it('collects direct createRoot render evidence through a named import alias', () => {
    const sourceText = [
      'import { createRoot as mountRoot } from "react-dom/client";',
      'import { StrictMode } from "react";',
      'import App from "./App";',
      'mountRoot(document.getElementById("root")!).render(',
      '  <StrictMode>',
      '    <main><App configuration={runtime.configuration} /></main>',
      '  </StrictMode>,',
      ');',
    ].join('\n');

    expect(collect(sourceText)).toEqual([
      {
        kind: 'create-root',
        occurrenceStart: sourceText.indexOf('mountRoot(document'),
        referencedLocalNames: ['StrictMode', 'App', 'runtime'],
        sourcePath: SOURCE_PATH,
        wrapperNames: ['StrictMode', 'App'],
      },
    ]);
  });

  /** Supports a namespace factory assigned to a const before its render call. */
  it('collects an assigned createRoot const through a client namespace import', () => {
    const sourceText = [
      'import * as Client from "react-dom/client";',
      'const root = Client.createRoot(container);',
      'root.render(<Providers><Router><App /></Router></Providers>);',
    ].join('\n');

    expect(collect(sourceText)).toEqual([
      {
        kind: 'create-root',
        occurrenceStart: sourceText.indexOf('root.render'),
        referencedLocalNames: ['Providers', 'Router', 'App'],
        sourcePath: SOURCE_PATH,
        wrapperNames: ['Providers', 'Router', 'App'],
      },
    ]);
  });

  /** Modern hydrateRoot receives JSX in its second argument and may be locally aliased. */
  it('collects direct hydrateRoot evidence and its second-argument JSX', () => {
    const sourceText = [
      'import { hydrateRoot as resume } from "react-dom/client";',
      'resume(container, <Shell><App boot={bootstrap} /></Shell>);',
    ].join('\n');

    expect(collect(sourceText)).toEqual([
      {
        kind: 'hydrate-root',
        occurrenceStart: sourceText.indexOf('resume(container'),
        referencedLocalNames: ['Shell', 'App', 'bootstrap'],
        sourcePath: SOURCE_PATH,
        wrapperNames: ['Shell', 'App'],
      },
    ]);
  });

  /** Legacy default, namespace, and named aliases retain their API-specific classifications. */
  it('collects legacy render and hydrate calls from every supported import shape', () => {
    const sourceText = [
      'import LegacyDOM from "react-dom";',
      'import * as DOM from "react-dom";',
      'import { render as renderLegacy, hydrate as hydrateLegacy } from "react-dom";',
      'LegacyDOM.render(<First />, firstNode);',
      'DOM.hydrate(<Second />, secondNode);',
      'renderLegacy(<Third />, thirdNode);',
      'hydrateLegacy(<Fourth />, fourthNode);',
    ].join('\n');

    expect(collect(sourceText)).toEqual([
      expectedLegacy(sourceText, 'LegacyDOM.render', 'legacy-render', 'First'),
      expectedLegacy(sourceText, 'DOM.hydrate', 'hydrate-root', 'Second'),
      expectedLegacy(sourceText, 'renderLegacy', 'legacy-render', 'Third'),
      expectedLegacy(sourceText, 'hydrateLegacy', 'hydrate-root', 'Fourth'),
    ]);
  });

  /** Member properties, intrinsic tags, and expression-local parameters are not graph names. */
  it('retains only root value identifiers and component-like JSX tag paths', () => {
    const sourceText = [
      'import { createRoot } from "react-dom/client";',
      'createRoot(container).render(',
      '  <Theme.Provider value={settings.theme}>',
      '    <section data-mode={settings.mode}>',
      '      {items.map((item) => <Row key={item.id} value={{ label: item.label, fallback }} />)}',
      '    </section>',
      '  </Theme.Provider>,',
      ');',
    ].join('\n');

    expect(collect(sourceText)[0]).toMatchObject({
      referencedLocalNames: ['Theme', 'settings', 'items', 'Row', 'fallback'],
      wrapperNames: ['Theme.Provider', 'Row'],
    });
  });

  /** A nested parameter with an imported spelling shadows that import for its complete body. */
  it('rejects locally shadowed imports and mutable assigned roots', () => {
    const sourceText = [
      'import { createRoot, hydrateRoot } from "react-dom/client";',
      'import * as ReactDOM from "react-dom";',
      'function local(createRoot: any, ReactDOM: any) {',
      '  createRoot(container).render(<Shadowed />);',
      '  ReactDOM.render(<AlsoShadowed />, container);',
      '}',
      'let mutableRoot = createRoot(container);',
      'mutableRoot.render(<Mutable />);',
      'const hydrateRootLocal = (_container: unknown, _node: unknown) => undefined;',
      'hydrateRootLocal(container, <Lookalike />);',
      'void hydrateRoot;',
    ].join('\n');

    expect(collect(sourceText)).toEqual([]);
  });

  /** Calls without exact package evidence or a literal JSX argument fail closed. */
  it('rejects wrong packages, local lookalikes, computed members, and non-JSX arguments', () => {
    const sourceText = [
      'import { createRoot } from "not-react-dom/client";',
      'import * as DOM from "react-dom";',
      'const localRoot = createRoot(container);',
      'localRoot.render(<WrongPackage />);',
      'DOM["render"](<Computed />, container);',
      'DOM.render(applicationNode, container);',
      'render(<Local />, container);',
    ].join('\n');

    expect(collect(sourceText)).toEqual([]);
  });

  /** The analyzer does not require TypeScript parent pointers on the supplied SourceFile. */
  it('works with lightweight source files that omit parent-node links', () => {
    const sourceText = [
      'import * as Client from "react-dom/client";',
      'Client.createRoot(container).render(<App />);',
    ].join('\n');
    const sourceFile = ts.createSourceFile(
      SOURCE_PATH,
      sourceText,
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TSX,
    );

    expect(collectPreviewEntryPointEvidence(SOURCE_PATH, sourceFile)).toHaveLength(1);
  });
});

/**
 * Parses one TSX fixture with parent links disabled to exercise the analyzer's range-based scopes.
 *
 * @param sourceText Fixture source.
 * @returns Plain serializable entry evidence.
 */
function collect(sourceText: string): readonly object[] {
  const sourceFile = ts.createSourceFile(
    SOURCE_PATH,
    sourceText,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX,
  );
  return collectPreviewEntryPointEvidence(SOURCE_PATH, sourceFile);
}

/**
 * Creates the repeated expected shape for one legacy mount fixture.
 *
 * @param sourceText Complete source used for occurrence offsets.
 * @param callStart Unique call-prefix spelling.
 * @param kind Expected legacy render or hydration classification.
 * @param component Rendered component name.
 * @returns Expected evidence record.
 */
function expectedLegacy(
  sourceText: string,
  callStart: string,
  kind: 'hydrate-root' | 'legacy-render',
  component: string,
): object {
  return {
    kind,
    occurrenceStart: sourceText.lastIndexOf(callStart),
    referencedLocalNames: [component],
    sourcePath: SOURCE_PATH,
    wrapperNames: [component],
  };
}
