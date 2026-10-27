/** Checks aggregate provenance at the public factory inventory boundary without executing source. */
import { describe, expect, it } from 'vitest';
import {
  collectPreviewInspectorRouteFactoryChoices,
  createPreviewInspectorRouteFactoryChoiceKey,
  type PreviewInspectorRouteFactoryChoiceInventory,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteFactoryChoices';

const pages = 'const Pages = { ListPage: InitialPage };';

/** Resolves only explicit controlled imports while retaining exact authored choice offsets. */
function collect(
  declarations: string,
  pageExpression = 'Pages',
  moduleExpression = '[]',
): PreviewInspectorRouteFactoryChoiceInventory {
  return collectPreviewInspectorRouteFactoryChoices({
    sourcePath: '/workspace/app.tsx',
    sourceText: `import { InitialPage, ReplacementPage, ManagementApp, AuditApp } from './views';
      ${declarations}
      export const FeatureApp = createAppModule('/feature', ${pageExpression}, ${moduleExpression},
        ({ pageRoutes }) => <Routes>{pageRoutes}<Route path="*" element={<NotFound />} /></Routes>);`,
    targetIdentities: new Set(['FeatureApp']),
    resolveModule: (specifier) => (specifier === './views' ? '/workspace/views.tsx' : undefined),
  });
}

describe('route factory aggregate provenance', () => {
  it.each([
    'delete Pages.ListPage;',
    'Pages.ListPage ||= ReplacementPage;',
    'Object.defineProperty(Pages, "ListPage", { value: ReplacementPage });',
    'configure(Pages);',
    'globalThis.pages = Pages;',
    'const expose = () => Pages;',
    'const Alias = (Pages as unknown); configure(Alias);',
    'const Alias = Pages; const Second = Alias; Second.ListPage = ReplacementPage;',
    'Pages.ListPage();',
    '({ value: Pages.ListPage } = source);',
    'for (Pages.ListPage of source) {}',
  ])('withholds obsolete page references after mutation or opaque escape: %s', (use) => {
    const result = collect(`${pages} ${use}`);
    expect(result.choices).toEqual([
      expect.objectContaining({ componentName: 'ListPage', kind: 'page' }),
    ]);
    expect(result.references.size).toBe(0);
    expect(result.choices[0]?.localName).toBeUndefined();
  });

  it.each([
    'Modules[0] = AuditApp;',
    'Modules.push(AuditApp);',
    'Modules.splice(0, 1, AuditApp);',
    'Modules.length = 0;',
    'delete Modules[0];',
    'const Alias = Modules; Alias.pop();',
    'configure(Modules);',
  ])(
    'keeps mutated submodule labels unresolved rather than selecting their old values: %s',
    (use) => {
      const result = collect(`const Modules = [ManagementApp]; ${use}`, '{}', 'Modules');
      expect(result.choices).toEqual([
        expect.objectContaining({ componentName: 'ManagementApp', kind: 'submodule' }),
      ]);
      expect(result.references.size).toBe(0);
    },
  );

  it.each([
    '',
    'const inspected = Pages.ListPage;',
    'const inspected = Pages["ListPage"];',
    'type Snapshot = typeof Pages;',
    'const unrelated = { Pages: 1 }; console.log(unrelated.Pages);',
    'function inspect(Pages: unknown[]) { Pages.push(1); }',
    'function inspect() { const Pages = []; Pages.push(1); }',
    'const inspect = function Pages() { return Pages; };',
    'const inspect = class Pages { getValue() { return Pages; } };',
    'Pages: for (const item of []) { break Pages; }',
    'const Copy = { ...Pages }; Copy.ListPage = ReplacementPage;',
    "export const OtherApp = createAppModule('/other', Pages, []);",
  ])('retains stable bindings through unrelated syntax and independent copies: %s', (unrelated) => {
    const result = collect(`${pages} ${unrelated}`);
    expect([...result.references.values()]).toEqual([
      { exportName: 'InitialPage', sourcePath: '/workspace/views.tsx' },
    ]);
  });

  it('propagates an earlier mutation through an inert spread copy and alias', () => {
    const result = collect(
      `${pages} Pages.ListPage = ReplacementPage;
      const Alias = Pages; const Copy = { ...Alias };`,
      'Copy',
    );
    expect(result.choices.map((choice) => choice.componentName)).toEqual(['ListPage']);
    expect(result.references.size).toBe(0);
  });

  it.each(['Modules.length', 'Modules[0]'])(
    'retains an own array data read without authorizing mutation methods: %s',
    (read) => {
      const result = collect(
        `const Modules = [ManagementApp]; const count = ${read};`,
        '{}',
        'Modules',
      );
      expect([...result.references.values()]).toEqual([
        { exportName: 'ManagementApp', sourcePath: '/workspace/views.tsx' },
      ]);
    },
  );

  it('preserves stable const aliases and spread copies', () => {
    const result = collect(
      `${pages} const Alias = (Pages satisfies unknown); const Copy = { ...Alias };`,
      'Copy',
    );
    expect([...result.references.values()]).toEqual([
      { exportName: 'InitialPage', sourcePath: '/workspace/views.tsx' },
    ]);
  });

  it('does not erase an independent literal choice beside an unresolved spread', () => {
    const result = collect(
      `${pages} Pages.ListPage = ReplacementPage;`,
      '{ ...Pages, StablePage: ReplacementPage }',
    );
    expect(result.choices.map((choice) => choice.componentName)).toEqual([
      'ListPage',
      'StablePage',
    ]);
    const stable = result.choices.find((choice) => choice.componentName === 'StablePage');
    expect(
      stable && result.references.get(createPreviewInspectorRouteFactoryChoiceKey(stable)),
    ).toEqual({
      exportName: 'ReplacementPage',
      sourcePath: '/workspace/views.tsx',
    });
    expect(result.references.size).toBe(1);
  });
});
