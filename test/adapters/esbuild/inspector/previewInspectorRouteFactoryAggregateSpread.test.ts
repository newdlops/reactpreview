/** Compares ordered aggregate construction with authored real-Router output without user code. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { build, stop } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectPreviewInspectorRouteFactoryChoices } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteFactoryChoices';
import { collectPreviewInspectorRouteFactoryManifest } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteFactoryManifest';
import {
  createVariableRouteFactoryFixture,
  type VariableRouteFactoryFixture,
} from './previewInspectorVariableRouteFactoryFixture';
import { renderVariableRouteFactoryCase } from './previewInspectorVariableRouteFactoryRuntime';

const cases = [
  {
    name: 'stable literal control',
    declarations: '',
    pages: '{ ListPage: ReplacementPage }',
    selectable: true,
  },
  {
    name: 'later inline literal spread',
    declarations: '',
    pages: '{ ListPage: InitialPage, ...{ ListPage: ReplacementPage } }',
    selectable: true,
  },
  {
    name: 'later named literal spread',
    declarations: 'const Override = { ListPage: ReplacementPage };',
    pages: '{ ListPage: InitialPage, ...Override }',
    selectable: true,
  },
  {
    name: 'repeated spread after a different value',
    declarations:
      'const First = { ListPage: ReplacementPage }; const Second = { ListPage: InitialPage };',
    pages: '{ ...First, ...Second, ...First }',
    selectable: true,
  },
  {
    name: 'later opaque call spread',
    declarations: 'function makePages() { return { ListPage: ReplacementPage }; }',
    pages: '{ ListPage: InitialPage, ...makePages() }',
    selectable: false,
  },
  {
    name: 'later opaque identifier spread',
    declarations:
      'function makePages() { return { ListPage: ReplacementPage }; } const Override = makePages();',
    pages: '{ ListPage: InitialPage, ...Override }',
    selectable: false,
  },
  {
    name: 'later computed property',
    declarations: 'const key = "ListPage";',
    pages: '{ ListPage: InitialPage, [key]: ReplacementPage }',
    selectable: false,
  },
  {
    name: 'inline getter mutates a page during enumeration',
    declarations: '',
    pages:
      '{ get CreatePage() { this.ListPage = ReplacementPage; return ReplacementPage; }, ListPage: InitialPage }',
    selectable: false,
  },
  {
    name: 'inline spread getter mutates the source before copying',
    declarations: '',
    pages:
      '{ ...{ get CreatePage() { this.ListPage = ReplacementPage; return ReplacementPage; }, ListPage: InitialPage } }',
    selectable: false,
  },
  {
    name: 'known literal after an opaque spread',
    declarations: 'function makePages() { return { ListPage: InitialPage }; }',
    pages: '{ ...makePages(), ListPage: ReplacementPage }',
    selectable: true,
  },
  {
    name: 'opaque spread leaves the original index page intact',
    declarations: 'function makePages() { return { CreatePage: ReplacementPage }; }',
    pages: '{ ListPage: InitialPage, ...makePages() }',
    selectable: false,
    marker: 'LIST_PAGE_MARKER',
  },
  {
    name: 'inline getter leaves the original index page intact',
    declarations: '',
    pages: '{ get CreatePage() { return ReplacementPage; }, ListPage: InitialPage }',
    selectable: false,
    marker: 'LIST_PAGE_MARKER',
  },
  {
    name: 'opaque imported spread leaves the original index page intact',
    declarations: "import { Pages as ImportedPages } from './opaque-pages';",
    pages: '{ ListPage: InitialPage, ...ImportedPages }',
    selectable: false,
    marker: 'LIST_PAGE_MARKER',
    files: {
      'src/opaque-pages.ts':
        "import { CreatePage } from './pages/create-page'; export const Pages = { CreatePage };",
    },
  },
  {
    name: 'escaped local spread leaves the original index page intact',
    declarations:
      'const Extra = { CreatePage: ReplacementPage }; function expose(value) {} expose(Extra);',
    pages: '{ ListPage: InitialPage, ...Extra }',
    selectable: false,
    marker: 'LIST_PAGE_MARKER',
    labels: ['ListPage', 'CreatePage'],
  },
] as const;

/** Builds a controlled registry whose index page must resolve to the replacement component. */
function sourceFor(variant: (typeof cases)[number]): string {
  return `import React from 'react';
    import { Route, Routes } from 'react-router-dom';
    import { createAppModule } from './create-app-module';
    import { ListPage as InitialPage } from './pages/list-page';
    import { CreatePage as ReplacementPage } from './pages/create-page';
    import { ManagementProvider } from './management/provider';
    import { NotFound } from './not-found';
    ${variant.declarations}
    export const FeatureApp = createAppModule('/feature', ${variant.pages}, [],
      ({ entries }) => <main>OUTER_LAYOUT_MARKER<ManagementProvider><Routes>{entries}<Route path="*" element={<NotFound />} /></Routes></ManagementProvider></main>);`;
}

/** Renders the controlled authored module with real Router matching and no compiler projection. */
async function renderAuthored(fixture: VariableRouteFactoryFixture): Promise<string> {
  const requireLocal = createRequire(import.meta.url);
  const result = await build({
    absWorkingDir: fixture.root,
    stdin: {
      contents: `import React from 'react';
        import { MemoryRouter, Route, Routes } from 'react-router-dom';
        import { FeatureApp } from ${JSON.stringify(fixture.appPath)};
        export default function AuthoredEntry() {
          return <MemoryRouter initialEntries={['/feature']}>
            <Routes><Route path="/feature/*" element={<FeatureApp />} /></Routes>
          </MemoryRouter>;
        }`,
      loader: 'tsx',
      resolveDir: fixture.root,
      sourcefile: 'controlled-aggregate-spread.tsx',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    write: false,
    external: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    plugins: [
      {
        name: 'controlled-real-router',
        setup(builder) {
          builder.onResolve({ filter: /^react-router-dom$/ }, () => ({
            path: requireLocal.resolve('react-router-dom'),
          }));
        },
      },
    ],
  });
  const code = result.outputFiles[0]?.text;
  assert.ok(code);
  const module = { exports: {} as { default: React.ComponentType } };
  runInNewContext(
    code,
    {
      module,
      exports: module.exports,
      require: requireLocal,
      process,
      URL,
      AbortController,
      TextEncoder,
      TextDecoder,
    },
    { timeout: 5000 },
  );
  return renderToStaticMarkup(React.createElement(module.exports.default));
}

describe('route factory aggregate construction order', () => {
  let root: string | undefined;
  const fixtures = new Map<string, VariableRouteFactoryFixture>();

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'route-factory-aggregate-spread-'));
    for (const [index, variant] of cases.entries()) {
      fixtures.set(
        variant.name,
        await createVariableRouteFactoryFixture(path.join(root, String(index)), {
          sourceOverrides: {
            'src/app.tsx': sourceFor(variant),
            ...('files' in variant ? variant.files : {}),
          },
          wrapCallbacks: false,
        }),
      );
    }
  });

  afterAll(async () => {
    await stop();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it.each(cases)('proves authored replacement behavior: $name', async (variant) => {
    const fixture = fixtures.get(variant.name);
    assert.ok(fixture);
    const marker = 'marker' in variant ? variant.marker : 'CREATE_PAGE_MARKER';
    const html = await renderAuthored(fixture);
    expect(html).toContain('OUTER_LAYOUT_MARKER');
    expect(html).toContain('INNER_PROVIDER_MARKER');
    expect(html).toContain(marker);
    expect(html).not.toContain(
      marker === 'CREATE_PAGE_MARKER' ? 'LIST_PAGE_MARKER' : 'CREATE_PAGE_MARKER',
    );
    expect(html).not.toContain('NOT_FOUND_MARKER');
  });

  it.each(
    cases.flatMap((variant) => [
      { ...variant, frozen: false },
      { ...variant, frozen: true },
    ]),
  )('preserves the effective page and Provider: $name, frozen=$frozen', async (variant) => {
    const fixture = fixtures.get(variant.name);
    assert.ok(fixture);
    const marker = 'marker' in variant ? variant.marker : 'CREATE_PAGE_MARKER';
    const offered = (await fixture.collect()).branches.some(
      (branch) => branch.componentName === 'ListPage' && branch.selectable !== false,
    );
    const result = await renderVariableRouteFactoryCase(fixture, {
      name: `aggregate-spread-${String(cases.findIndex((value) => value.name === variant.name))}-${String(variant.frozen)}`,
      ...(offered ? { selection: 'ListPage' as const } : {}),
      marker,
      frozen: variant.frozen,
    });
    expect(result.html).toContain('OUTER_LAYOUT_MARKER');
    expect(result.html).toContain('INNER_PROVIDER_MARKER');
    expect(result.html).toContain(marker);
    expect(result.html).not.toContain(
      marker === 'CREATE_PAGE_MARKER' ? 'LIST_PAGE_MARKER' : 'CREATE_PAGE_MARKER',
    );
    expect(result.html).not.toContain('NOT_FOUND_MARKER');
    expect(result.branches.filter((branch) => branch.componentName === 'ListPage')).toEqual([
      expect.objectContaining({ selectable: variant.selectable }),
    ]);
    if (!variant.frozen) expect(result.fallbackHtml).toContain('NOT_FOUND_MARKER');
  });

  it.each(cases)(
    'offers only the effective static component or an unresolved label: $name',
    async (variant) => {
      const fixture = fixtures.get(variant.name);
      assert.ok(fixture);
      const labels = 'labels' in variant ? variant.labels : ['ListPage'];
      const inventory = collectPreviewInspectorRouteFactoryChoices({
        sourcePath: fixture.appPath,
        sourceText: sourceFor(variant),
        resolveModule: fixture.resolveModule,
        targetIdentities: new Set(['FeatureApp']),
      });
      expect(inventory.owner).toMatchObject({ basePath: '/feature', exportName: 'FeatureApp' });
      expect(inventory.choices.map(({ componentName, kind }) => ({ componentName, kind }))).toEqual(
        labels.map((componentName) => ({ componentName, kind: 'page' })),
      );
      expect([...inventory.references.values()]).toEqual(
        variant.selectable
          ? [
              {
                exportName: 'CreatePage',
                sourcePath: path.join(fixture.root, 'src/pages/create-page.tsx'),
              },
            ]
          : [],
      );
      const manifest = await collectPreviewInspectorRouteFactoryManifest({
        exportName: 'FeatureApp',
        readSource: fixture.readSource,
        resolveModule: fixture.resolveModule,
        sourcePath: fixture.appPath,
        sourceText: sourceFor(variant),
      });
      if (variant.selectable) {
        expect(manifest?.routes).toHaveLength(1);
        expect(manifest?.routes[0]?.componentName).toBe('ListPage');
      } else {
        expect(manifest?.routes).toEqual([]);
        expect(manifest?.options).toHaveLength(labels.length);
        const expectedOptions = labels
          .map((componentName) => ({
            componentName,
            availability: 'component-unresolved',
          }))
          .sort((left, right) => left.componentName.localeCompare(right.componentName));
        const actualOptions = manifest?.options
          .map(({ componentName, availability }) => ({
            componentName,
            availability,
          }))
          .sort((left, right) => left.componentName.localeCompare(right.componentName));
        expect(actualOptions).toEqual(expectedOptions);
      }
      expect(manifest?.fallbacks).toEqual([
        expect.objectContaining({ componentName: 'NotFound', pattern: '*' }),
      ]);
    },
  );
});
