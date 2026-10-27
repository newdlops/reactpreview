/** Keeps returned factory catch-all branches as authored fallbacks, never selectable pages. */
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { collectPreviewInspectorDirectRouteChoicesFromSource } from '../../../../src/adapters/esbuild/inspector/previewInspectorDirectRouteChoices';
import { collectPreviewInspectorRouteFactoryManifest } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteFactoryManifest';
import { collectPreviewInspectorRouteLocationInventory } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteLocation';
import { readRouteFactoryRenderContract } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteFactoryRenderContract';
import { createRenderChain } from './previewInspectorRouteLocationFixtures';

const ROOT = '/workspace/fallback-inventory';
const OWNER = `${ROOT}/feature-app.tsx`;
const FALLBACK = `${ROOT}/fallback-page.tsx`;
const WILDCARDS = [
  '<Route path="*" element={<FallbackPage />} />',
  '<Route path={"*"} element={<FallbackPage />} />',
  '<Route path="/*" element={<FallbackPage />} />',
  '<Router.Route path="*" element={<Boundary><FallbackPage /></Boundary>} />',
  '<Route path="*"><FallbackPage /></Route>',
  '<Route path={"*" as const} Component={FallbackPage} />',
] as const;

/** Source snapshots and bounded module capabilities shared by the inventory assertions. */
interface FactoryFixture {
  /** Returns only a fixture-owned source snapshot. */
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  /** Resolves only authored fixture-relative module names. */
  readonly resolveModule: (specifier: string, importer: string) => string | undefined;
  /** Factory owner snapshot passed directly to manifest collection. */
  readonly sourceText: string;
  /** Complete inert fixture corpus keyed by absolute virtual path. */
  readonly sources: Readonly<Record<string, string>>;
}

/** Builds inert catalog/factory inputs; none of these project strings is imported or evaluated. */
function createFixture(
  fallback: string,
  options: { readonly basePath?: string; readonly noCatalog?: boolean } = {},
): FactoryFixture {
  const sourceText = [
    'import { createFeatureModule } from "./make-module";',
    'import { ListPage } from "./list-page";',
    'import { CreatePage } from "./create-page";',
    'import { FallbackPage } from "./fallback-page";',
    `export const FeatureApp = createFeatureModule(${JSON.stringify(options.basePath ?? '/feature')}, { ListPage, CreatePage }, [],`,
    '  ({ generatedPages: own, generatedModules: nested }) => (',
    '    <Shell><Routes>{own}{nested}',
    '      <Route path="support" element={<FallbackPage />} />',
    `      ${fallback}`,
    '    </Routes></Shell>',
    '  ));',
  ].join('\n');
  const sources: Readonly<Record<string, string>> = {
    [OWNER]: sourceText,
    [FALLBACK]: 'export function FallbackPage() { return <main>AUTHORED_FALLBACK</main>; }',
    [`${ROOT}/list-page.tsx`]: 'export function ListPage() { return <main>LIST</main>; }',
    [`${ROOT}/create-page.tsx`]: 'export function CreatePage() { return <main>CREATE</main>; }',
    [`${ROOT}/make-module.ts`]:
      'import { makeModuleBase } from "./make-module-base"; import { pages } from "./pages-map"; export const createFeatureModule = makeModuleBase(pages);',
    [`${ROOT}/make-module-base.tsx`]:
      'export const makeModuleBase = (catalog) => (basePath, pages, modules, Component) => withProps({ generatedPages: Object.entries(pages).map(([name, Page]) => <Route />), generatedModules: modules.map((App) => <Route />) })(Component);',
    [`${ROOT}/pages-map.ts`]: 'import data from "./pages.json"; export const pages = invert(data);',
    ...(!options.noCatalog
      ? {
          [`${ROOT}/pages.json`]: JSON.stringify({
            feature: { index: 'ListPage', create: 'CreatePage' },
          }),
        }
      : {}),
  };
  const readSource = (sourcePath: string): Promise<string | undefined> =>
    Promise.resolve(sources[sourcePath]);
  const resolveModule = (specifier: string, importer: string): string | undefined => {
    const base = path.resolve(path.dirname(importer), specifier);
    return ['', '.ts', '.tsx', '.json']
      .map((suffix) => base + suffix)
      .find((candidate) => Object.hasOwn(sources, candidate));
  };
  return { readSource, resolveModule, sourceText, sources };
}

/** Selects the authored factory owner using the same public inventory path as the Inspector. */
async function collect(
  fixture: FactoryFixture,
): ReturnType<typeof collectPreviewInspectorRouteLocationInventory> {
  return collectPreviewInspectorRouteLocationInventory({
    documentPath: OWNER,
    exportName: 'FeatureApp',
    readSource: fixture.readSource,
    renderChain: createRenderChain(OWNER, OWNER, 'FeatureApp', 'FeatureApp'),
    resolveModule: fixture.resolveModule,
    sourcePaths: Object.keys(fixture.sources),
  });
}

describe('factory wildcard fallback inventory', () => {
  it.each(WILDCARDS)('excludes exactly the returned fallback occurrence: %s', async (fallback) => {
    const fixture = createFixture(fallback);
    const inventory = await collect(fixture);

    expect(inventory.choices.map((choice) => [choice.componentName, choice.pattern])).toEqual([
      ['ListPage', '/feature'],
      ['CreatePage', '/feature/create'],
      ['FallbackPage', '/feature/support'],
    ]);
    expect(inventory.fallbackCount).toBe(1);
    expect(inventory.choices[0]?.routeMounts?.[0]).toMatchObject({
      hasWildcardFallback: true,
      routeSlotCount: 2,
    });
    expect(inventory.unresolvedFactoryOptions).toBeUndefined();
    expect(fixture.sources[OWNER]).toContain(fallback);
  });

  it('retains unresolved factory pages without offering the fallback as a substitute', async () => {
    const fixture = createFixture(WILDCARDS[0], { noCatalog: true });
    const inventory = await collect(fixture);
    expect(inventory.choices.map((choice) => choice.pattern)).toEqual(['/feature/support']);
    expect(inventory.unresolvedFactoryOptionNames).toEqual(['ListPage', 'CreatePage']);
    expect(inventory.primary?.componentName).toBe('FeatureApp');
    expect(inventory.primary?.pathname).toBe('/feature');
    expect(inventory.fallbackCount).toBe(1);
  });

  it.each(['/feature', '/feature/', '/feature//', '/'])(
    'preserves the exact unresolved owner context for authored base %s',
    async (basePath) => {
      const fixture = createFixture(WILDCARDS[0], { basePath, noCatalog: true });
      const inventory = await collect(fixture);
      expect(inventory.primary).toMatchObject({
        componentName: 'FeatureApp',
        pathname: basePath.replace(/\/+$/u, '') || '/',
        routeMounts: [
          {
            basePath,
            contextOrigin: 'virtual-page-owner',
            contextPattern: `${basePath.replace(/\/+$/u, '')}/*`,
            exportName: 'FeatureApp',
            hasWildcardFallback: true,
            routeSlotCount: 2,
            sourcePath: OWNER,
          },
        ],
      });
      expect(inventory.unresolvedFactoryOptionNames).toEqual(['ListPage', 'CreatePage']);
      expect(inventory.fallbackCount).toBe(1);
      expect(inventory.choices.some((choice) => choice.pattern.endsWith('/*'))).toBe(false);
    },
  );

  it('keeps a wildcard-only factory at its authored base without inventing a page choice', async () => {
    const sourceText = [
      'import { FallbackPage } from "./fallback-page";',
      'export const FeatureApp = createFeatureModule("/feature", {}, [],',
      '  () => <Routes><Route path="*" element={<FallbackPage />} /></Routes>);',
    ].join('\n');
    const fixture = createFixture(WILDCARDS[0]);
    const sources: Readonly<Record<string, string>> = { ...fixture.sources, [OWNER]: sourceText };
    const inventory = await collect({
      ...fixture,
      sourceText,
      sources,
      readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
    });
    expect(inventory.choices).toEqual([]);
    expect(inventory.primary).toMatchObject({ componentName: 'FeatureApp', pathname: '/feature' });
    expect(inventory.fallbackCount).toBe(1);
  });

  it('preserves explicit direct wildcards and prefixed route-owner delegation', () => {
    const sourceText = [
      'export function OrdinaryRouter() { return <Routes><Route path="*" element={<FallbackPage />} /></Routes>; }',
      'export const FeatureApp = createFeatureModule("/feature", {}, [], ({ entries }) =>',
      '  <Routes>{entries}<Route path="children/*" element={<NestedApp />} /><Route path="*" element={<FallbackPage />} /></Routes>);',
    ].join('\n');
    const choices = collectPreviewInspectorDirectRouteChoicesFromSource({
      sourcePath: OWNER,
      sourceText,
    });
    expect(choices.map((choice) => [choice.componentName, choice.pattern])).toEqual([
      ['FallbackPage', '/*'],
      ['NestedApp', '/feature/children/*'],
    ]);
  });

  it('binds fallback diagnostics to returned source occurrences instead of component spelling', async () => {
    const fixture = createFixture(WILDCARDS[0]);
    const sourceText = fixture.sourceText
      .replace(
        '({ generatedPages: own, generatedModules: nested }) => (',
        '({ generatedPages: own, generatedModules: nested }) => { const unused = <Routes><Route path="*" element={<UnusedFallback />} /></Routes>; return (',
      )
      .replace('  ));', '  ); });');
    const manifest = await collectPreviewInspectorRouteFactoryManifest({
      exportName: 'FeatureApp',
      readSource: fixture.readSource,
      resolveModule: fixture.resolveModule,
      sourcePath: OWNER,
      sourceText,
    });
    expect(manifest?.fallbacks.map((item) => item.componentName)).toEqual(['FallbackPage']);
    const sources: Readonly<Record<string, string>> = { ...fixture.sources, [OWNER]: sourceText };
    const inventory = await collect({
      ...fixture,
      sourceText,
      sources,
      readSource: (sourcePath) => Promise.resolve(sources[sourcePath]),
    });
    expect(inventory.choices.some((choice) => choice.componentName === 'UnusedFallback')).toBe(
      false,
    );
    expect(inventory.fallbackCount).toBe(1);
  });

  it('does not classify a computed path or an unreturned JSX local as a factory fallback', () => {
    const sourceFile = ts.createSourceFile(
      OWNER,
      'const FeatureApp = createFeatureModule("/feature", {}, [], ({ entries }) => { const unused = <Routes><Route path="*" element={<Unused />} /></Routes>; return <Routes>{entries}<Route path={computedPath} element={<FallbackPage />} /></Routes>; });',
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const declaration = sourceFile.statements.find(ts.isVariableStatement)?.declarationList
      .declarations[0];
    const call = declaration?.initializer;
    if (call === undefined || !ts.isCallExpression(call))
      throw new Error('Factory fixture is missing');
    expect(readRouteFactoryRenderContract(call, sourceFile).hasWildcardFallback).toBe(false);
  });
});
