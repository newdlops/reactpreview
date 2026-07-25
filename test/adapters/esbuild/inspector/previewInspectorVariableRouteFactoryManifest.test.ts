/** Verifies curried variable-route factories become catalog-backed, non-fallback route manifests. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectPreviewInspectorRouteFactoryManifest } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteFactoryManifest';
import { collectPreviewInspectorRouteFactoryCatalog } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteFactoryCatalog';
import { resolvePreviewInspectorRouteFactoryDefinition } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteFactoryDefinition';
import ts from 'typescript';

const root = '/workspace/src';
const readFixtureSource = (candidate: string): Promise<string | undefined> =>
  Promise.resolve(sources[path.normalize(candidate)]);

/** Resolves only fixture-relative module names, mirroring the package-aware production capability. */
function resolveModule(specifier: string, importer: string): string | undefined {
  const candidate = path.normalize(path.resolve(path.dirname(importer), specifier));
  return Object.keys(sources).find(
    (sourcePath) =>
      sourcePath === candidate ||
      sourcePath === `${candidate}.ts` ||
      sourcePath === `${candidate}.tsx` ||
      sourcePath === `${candidate}.json`,
  );
}

/** Small, non-executable source corpus that exercises a curry, a catalog transform, and a fallback. */
const sources: Record<string, string> = {
  [`${root}/section-app.tsx`]: [
    'import { createSectionModule } from "./create-section-module";',
    'import { ListPage } from "./list-page";',
    'import { CreatePage } from "./create-page";',
    'import { ManagementApp } from "./management-app";',
    'export const SectionApp = createSectionModule("/section", { ListPage, CreatePage }, [ManagementApp], ({ generatedPages, generatedModules }) => <Routes>{generatedPages}{generatedModules}<Route path="*" element={<NotFound />} /></Routes>);',
  ].join('\n'),
  [`${root}/create-section-module.ts`]: [
    'import { createSectionModuleBase } from "./create-section-module-base";',
    'import { pageNamePathMap } from "./page-map";',
    'export const createSectionModule = createSectionModuleBase(pageNamePathMap);',
  ].join('\n'),
  [`${root}/create-section-module-base.tsx`]: [
    'export const createSectionModuleBase = (catalog) => (basePath, pages, subModules, Component) =>',
    '  withProps({ generatedPages: Object.entries(pages).map(([name, Page]) => <Route />), generatedModules: subModules.map((App) => <Route /> })(Component);',
  ].join('\n'),
  [`${root}/page-map.ts`]: [
    'import pages from "./pages.json";',
    'export const pageNamePathMap = invert(pages);',
  ].join('\n'),
  [`${root}/pages.json`]: JSON.stringify({ section: { index: 'ListPage', create: 'CreatePage' } }),
  [`${root}/list-page.tsx`]: 'export const ListPage = () => <div />;',
  [`${root}/create-page.tsx`]: 'export const CreatePage = () => <div />;',
  [`${root}/management-app.tsx`]:
    'export const ManagementApp = createSectionModule("/section/:managementId(\\d+)", {}, [], () => <Routes />);',
};

describe('collectPreviewInspectorRouteFactoryManifest', () => {
  it('proves curried generated route slot names', async () => {
    const sourcePath = `${root}/section-app.tsx`;
    const sourceFile = ts.createSourceFile(
      sourcePath,
      sources[sourcePath] ?? '',
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    let call: ts.CallExpression | undefined;
    const find = (node: ts.Node): void => {
      if (call === undefined && ts.isCallExpression(node)) call = node;
      ts.forEachChild(node, find);
    };
    find(sourceFile);
    expect(call).toBeDefined();
    if (call === undefined) throw new Error('Fixture factory call is missing');
    const definition = await resolvePreviewInspectorRouteFactoryDefinition({
      callExpression: call,
      readSource: readFixtureSource,
      resolveModule,
      sourceFile,
      sourcePath,
    });
    expect(definition).toMatchObject({
      catalogBindingName: 'pageNamePathMap',
      pageSlotPropertyName: 'generatedPages',
      submoduleSlotPropertyName: 'generatedModules',
    });
  });

  it('traces a catalog binding through a transform module to its JSON data', async () => {
    const catalog = await collectPreviewInspectorRouteFactoryCatalog({
      catalogBindingName: 'pageNamePathMap',
      expectedComponentNames: new Set(['ListPage', 'CreatePage']),
      readSource: readFixtureSource,
      resolveModule,
      sourcePath: `${root}/create-section-module.ts`,
    });
    expect(catalog.patternsByComponentName.get('ListPage')).toEqual(['/section']);
    expect(catalog.patternsByComponentName.get('CreatePage')).toEqual(['/section/create']);
  });

  it('joins a curried factory catalog and keeps wildcard fallbacks outside routes', async () => {
    const sourcePath = `${root}/section-app.tsx`;
    const manifest = await collectPreviewInspectorRouteFactoryManifest({
      exportName: 'SectionApp',
      readSource: readFixtureSource,
      resolveModule,
      sourcePath,
      sourceText: sources[sourcePath],
    });

    expect(manifest).toMatchObject({ basePattern: '/section', routeSlotCount: 2 });
    expect(manifest?.routes).toEqual([
      expect.objectContaining({
        componentName: 'ListPage',
        absolutePattern: '/section',
        relativeRouterPattern: '',
      }),
      expect.objectContaining({
        componentName: 'CreatePage',
        absolutePattern: '/section/create',
        relativeRouterPattern: 'create',
      }),
      expect.objectContaining({
        componentName: 'ManagementApp',
        kind: 'submodule',
        relativeRouterPattern: ':managementId/*',
      }),
    ]);
    expect(manifest?.fallbacks).toEqual([
      expect.objectContaining({ componentName: 'NotFound', pattern: '*' }),
    ]);
    expect(manifest?.unresolvedChoiceNames).toEqual([]);
  });
});
