/** Verifies that route-factory callback variables are retained as inert Routes evidence. */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { collectPreviewInspectorRouteFactoryEvidence } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteFactory';

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
