/** Verifies that route-factory callback variables are retained as inert Routes evidence. */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { collectPreviewInspectorRouteFactoryEvidence } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteFactory';
import { collectPreviewInspectorRouteFactoryChoices } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteFactoryChoices';

/** Parses one in-memory TSX fixture without executing its factory or JSX expressions. */
function collect(
  sourceText: string,
): readonly import('../../../../src/adapters/esbuild/inspector/previewInspectorRouteFactory').PreviewInspectorRouteFactoryEvidence[] {
  return collectPreviewInspectorRouteFactoryEvidence(
    ts.createSourceFile(
      '/workspace/feature-app.tsx',
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    ),
  );
}

describe('collectPreviewInspectorRouteFactoryEvidence', () => {
  it.each([
    'function unused() { const App = createAppModule("/foreign", { ForeignPage }, []); }',
    '{ const App = createAppModule("/foreign", { ForeignPage }, []); }',
    'namespace Hidden { export const App = createAppModule("/foreign", { ForeignPage }, []); }',
    'class Unused { render() { const App = createAppModule("/foreign", { ForeignPage }, []); } }',
  ])('keeps a nested same-name factory out of the selected module export: %s', (unrelated) => {
    const sourceText = `${unrelated}\nexport const App = createAppModule('/feature', { ListPage }, [],
      ({ pageRoutes: routes }) => <Routes>{routes}</Routes>);`;
    const inventory = collectPreviewInspectorRouteFactoryChoices({
      sourcePath: '/workspace/feature-app.tsx',
      sourceText,
      targetIdentities: new Set(['App']),
    });
    expect(inventory.owner).toMatchObject({
      basePath: '/feature',
      exportName: 'App',
      routeSlotCount: 1,
    });
    expect(inventory.choices.map((choice) => choice.componentName)).toEqual(['ListPage']);
    expect(
      collect(sourceText).find((factory) => factory.basePath === '/foreign')?.componentName,
    ).toBeUndefined();
  });

  it.each([
    '({ pageRoutes: routes }) => { const unused = <Routes>{routes}<Route path="*" /></Routes>; return <main />; }',
    '({ pageRoutes: routes }) => { const unused = () => <Routes>{routes}<Route path="*" /></Routes>; return <main />; }',
    '({ pageRoutes: routes }) => { function unused() { return <Routes>{routes}<Route path="*" /></Routes>; } return <main />; }',
    '({ pageRoutes: routes }) => <Layout render={() => { const unused = <Routes>{routes}<Route path="*" /></Routes>; return <main />; }} />',
  ])('does not invent a render contract from JSX outside returned expressions: %s', (callback) => {
    const [evidence] = collect(
      `const App = createAppModule('/feature', { ListPage }, [], ${callback});`,
    );
    expect(evidence?.routeSlots).toEqual([]);
    expect(evidence?.hasWildcardFallback).toBe(false);
    expect(evidence?.choices.map((choice) => choice.componentName)).toEqual(['ListPage']);
  });

  it.each([
    '({ pageRoutes: routes }) => <Layout render={(routes) => <Routes>{routes}</Routes>} />',
    '({ pageRoutes: routes }) => <Layout render={({ value: routes }) => <Routes>{routes}</Routes>} />',
    '({ pageRoutes: routes }) => <Layout render={() => { const routes = []; return <Routes>{routes}</Routes>; }} />',
    '({ pageRoutes: routes }) => <Layout render={function routes() { return <Routes>{routes}</Routes>; }} />',
    '({ pageRoutes: routes }) => { try { throw new Error(); } catch (routes) { return <Routes>{routes}</Routes>; } }',
    '({ pageRoutes: routes }) => { for (const routes of groups) { return <Routes>{routes}</Routes>; } return null; }',
    '({ pageRoutes: routes }) => <Layout render={() => { if (false) { var routes; } return <Routes>{routes}</Routes>; }} />',
    '({ ...routes }) => <Routes>{routes}</Routes>',
  ])('does not confuse a different binding with the injected route slot: %s', (callback) => {
    const [evidence] = collect(
      `const App = createAppModule('/feature', { ListPage }, [], ${callback});`,
    );
    expect(evidence?.routeSlots).toEqual([]);
    expect(evidence?.choices.map((choice) => choice.componentName)).toEqual(['ListPage']);
  });

  it.each([
    '({ pageRoutes: routes }) => { if (ready) return <Routes>{routes}</Routes>; return <main />; }',
    '({ pageRoutes: routes }) => <Layout render={() => <Routes>{routes}</Routes>} />',
    '({ pageRoutes: routes }) => <Layout render={() => { return <Routes>{routes}</Routes>; }} />',
    '({ pageRoutes: routes }) => { { const routes = []; } return <Routes>{routes}</Routes>; }',
    '({ pageRoutes: routes }) => { try {} catch (routes) {} return <Routes>{routes}</Routes>; }',
    '({ pageRoutes: routes }) => { for (const routes of groups) {} return <Routes>{routes}</Routes>; }',
    '({ pageRoutes: routes }) => { var routes; return <Routes>{routes}</Routes>; }',
  ])(
    'retains genuine callback bindings through returned JSX and separate scopes: %s',
    (callback) => {
      const [evidence] = collect(
        `const App = createAppModule('/feature', { ListPage }, [], ${callback});`,
      );
      expect(
        evidence?.routeSlots.map(({ localName, propertyName }) => ({ localName, propertyName })),
      ).toEqual([{ localName: 'routes', propertyName: 'pageRoutes' }]);
    },
  );

  it('records aliased page and submodule route slots plus a literal wildcard fallback', () => {
    const evidence = collect(
      [
        'const basePath = "/feature";',
        'export const FeatureApp = createAppModule(',
        '  basePath, { ListPage }, [ManagementApp],',
        '  ({ pageRoutes: own, subModuleRoutes: nested }) => (',
        '    <Layout><Routes>{own}{nested}<Route path="*" element={<NotFound />} /></Routes></Layout>',
        '  ),',
        ');',
      ].join('\n'),
    );

    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ basePath: '/feature', hasWildcardFallback: true });
    expect(
      evidence[0]?.routeSlots.map(({ localName, propertyName }) => ({ localName, propertyName })),
    ).toEqual([
      { localName: 'own', propertyName: 'pageRoutes' },
      { localName: 'nested', propertyName: 'subModuleRoutes' },
    ]);
  });

  it('does not classify expressions outside Routes as route slots', () => {
    const evidence = collect(
      'const App = createAppModule("/feature", {}, [], ({ pageRoutes }) => <Layout>{pageRoutes}</Layout>);',
    );
    expect(evidence[0]?.routeSlots).toEqual([]);
    expect(evidence[0]?.hasWildcardFallback).toBe(false);
  });
});
