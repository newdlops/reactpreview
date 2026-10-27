/** Exercises source-only factory binding identities, public exports, and inert aggregate aliases. */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { collectPreviewInspectorRouteFactoryEvidence } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteFactory';
import {
  collectPreviewInspectorRouteFactoryChoices,
  createPreviewInspectorRouteFactoryChoiceKey,
  type PreviewInspectorRouteFactoryChoiceInventory,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteFactoryChoices';

const sourcePath = '/workspace/feature-app.tsx';
const outer = `export const FeatureApp = createAppModule('/feature', {}, [ManagementApp],
  ({ subModuleRoutes: routes }) => <Routes>{routes}<Route path="*" element={<NotFound />} /></Routes>);`;

/** Inventories only controlled source strings; resolving an import never evaluates its module. */
function inventory(
  sourceText: string,
  exportName = 'FeatureApp',
): PreviewInspectorRouteFactoryChoiceInventory {
  return collectPreviewInspectorRouteFactoryChoices({
    sourcePath,
    sourceText,
    targetIdentities: new Set([exportName]),
    resolveModule: (specifier) =>
      specifier === './imported-app' ? '/workspace/imported-app.tsx' : undefined,
  });
}

describe('route factory source binding identities', () => {
  it.each([
    `createAppModule('/feature/manage', {}, [])`,
    `(createAppModule('/feature/manage', {}, []) satisfies unknown)`,
    '() => <Routes />',
    'function Module() { return <Routes />; }',
  ])(
    'retains a same-file const submodule value without inspecting its initializer: %s',
    (value) => {
      const result = inventory(`const ManagementApp = ${value};\n${outer}`);
      expect(result.choices).toEqual([
        expect.objectContaining({
          componentName: 'ManagementApp',
          kind: 'submodule',
          localName: 'ManagementApp',
        }),
      ]);
      expect(result.references.size).toBe(0);
    },
  );

  it.each([
    'const Modules = [ManagementApp];',
    'const Original = [ManagementApp]; const Modules = Original;',
    'const Original = [ManagementApp]; const Modules = [...Original];',
  ])('continues expanding prior literal const collections: %s', (declarations) => {
    const result = inventory(
      `import { ManagementApp } from './imported-app';\n${declarations}\n${outer.replace('[ManagementApp]', 'Modules')}`,
    );
    expect(result.choices.map((choice) => choice.componentName)).toEqual(['ManagementApp']);
    const choice = result.choices[0];
    expect(
      choice && result.references.get(createPreviewInspectorRouteFactoryChoiceKey(choice)),
    ).toEqual({ exportName: 'ManagementApp', sourcePath: '/workspace/imported-app.tsx' });
  });

  it('continues expanding page-map aliases without promoting object keys to submodules', () => {
    const result = inventory(`const Original = { ListPage }; const Pages = Original;
      export const FeatureApp = createAppModule('/feature', { ...Pages }, []);`);
    expect(result.choices).toEqual([
      expect.objectContaining({ componentName: 'ListPage', kind: 'page', localName: 'ListPage' }),
    ]);
  });

  it.each([
    [
      'direct',
      `export const ManagementApp = createAppModule('/feature/manage', {}, []);`,
      'ManagementApp',
    ],
    [
      'named clause',
      `const ManagementApp = createAppModule('/feature/manage', {}, []); export { ManagementApp };`,
      'ManagementApp',
    ],
    [
      'renamed clause',
      `const ManagementApp = createAppModule('/feature/manage', {}, []); export { ManagementApp as ManagedSection };`,
      'ManagedSection',
    ],
    [
      'default clause',
      `const ManagementApp = createAppModule('/feature/manage', {}, []); export { ManagementApp as default };`,
      'default',
    ],
    [
      'default assignment',
      `const ManagementApp = createAppModule('/feature/manage', {}, []); export default ManagementApp;`,
      'default',
    ],
  ])(
    'resolves the exact public same-file runtime export: %s',
    (_label, declaration, publicName) => {
      const result = inventory(`${declaration}\n${outer}`);
      expect(result.choices).toHaveLength(1);
      const choice = result.choices[0];
      expect(
        choice && result.references.get(createPreviewInspectorRouteFactoryChoiceKey(choice)),
      ).toEqual({ exportName: publicName, sourcePath });
      const withoutImportResolver = collectPreviewInspectorRouteFactoryChoices({
        sourcePath,
        sourceText: `${declaration}\n${outer}`,
        targetIdentities: new Set(['FeatureApp']),
      });
      const local = withoutImportResolver.choices[0];
      expect(
        local &&
          withoutImportResolver.references.get(createPreviewInspectorRouteFactoryChoiceKey(local)),
      ).toEqual({ exportName: publicName, sourcePath });
    },
  );

  it.each([
    ['ManagedSection', 'export { ManagementApp as ManagedSection };'],
    ['default', 'export { ManagementApp as default };'],
    ['default', 'export default ManagementApp;'],
  ])(
    'keeps the selected public owner identity through an export alias: %s',
    (publicName, declaration) => {
      const result = inventory(
        `const ManagementApp = createAppModule('/feature/manage', { DetailPage }, [],
        ({ pageRoutes: routes }) => <Routes>{routes}<Route path="*" element={<NotFound />} /></Routes>);
       ${declaration}`,
        publicName,
      );
      expect(result.owner).toMatchObject({
        exportName: publicName,
        sourcePath,
        basePath: '/feature/manage',
        routeSlotCount: 1,
        hasWildcardFallback: true,
      });
      expect(result.choices.map((choice) => choice.componentName)).toEqual(['DetailPage']);
    },
  );

  it.each([
    'export type { ManagementApp };',
    'export { type ManagementApp };',
    'export { ManagementApp } from "./other-app";',
    'export * from "./other-app";',
    'namespace Hidden { export const ManagementApp = foreign; }',
  ])('does not invent a public local reference from unrelated export syntax: %s', (unrelated) => {
    const result = inventory(
      `const ManagementApp = createAppModule('/feature/manage', {}, []); ${unrelated}\n${outer}`,
    );
    expect(result.choices).toHaveLength(1);
    expect(result.references.size).toBe(0);
  });

  it.each([
    `export let ManagementApp = createAppModule('/feature/manage', {}, []);\n${outer}`,
    `export var ManagementApp = createAppModule('/feature/manage', {}, []);\n${outer}`,
    `declare const ManagementApp: unknown; export { ManagementApp };\n${outer}`,
    `${outer}\nexport const ManagementApp = createAppModule('/feature/manage', {}, []);`,
    `export default ManagementApp; const ManagementApp = createAppModule('/feature/manage', {}, []);\n${outer}`,
    `const ManagementApp = createAppModule('/first', {}, []); const ManagementApp = createAppModule('/second', {}, []); export { ManagementApp };\n${outer}`,
  ])('leaves mutable, ambient, duplicate and not-yet-initialized values unresolved: %s', (text) => {
    const result = inventory(text);
    expect(result.choices).toHaveLength(1);
    expect(result.references.size).toBe(0);
  });

  it('keeps ordinary imported submodule evidence and its use-site offset', () => {
    const text = `import { ManagementApp } from './imported-app';\n${outer}`;
    const result = inventory(text);
    expect(result.choices[0]?.occurrenceStart).toBe(text.lastIndexOf('[ManagementApp]') + 1);
    const source = ts.createSourceFile(
      sourcePath,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    expect(collectPreviewInspectorRouteFactoryEvidence(source)[0]?.choices).toEqual(result.choices);
  });
});
