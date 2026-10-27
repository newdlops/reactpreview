/** Compares mutated route registries with authored real-Router output without loading user code. */
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

const mutations = [
  'Pages.ListPage = ReplacementPage;',
  'Pages["ListPage"] = ReplacementPage;',
  'Object.assign(Pages, { ListPage: ReplacementPage });',
  'const Alias = Pages; Alias.ListPage = ReplacementPage;',
  'function update() { Pages.ListPage = ReplacementPage; } update();',
  'literal getter mutates a page',
  'spread getter mutates a page',
] as const;

/** Builds a controlled page map whose catalog key stays fixed while its component changes. */
function sourceFor(mutation: string): string {
  const getter =
    'get CreatePage() { this.ListPage = ReplacementPage; return ReplacementPage; }, ListPage: InitialPage';
  const accessor =
    mutation === 'literal getter mutates a page' || mutation === 'spread getter mutates a page';
  const declaration =
    mutation === 'literal getter mutates a page'
      ? `const Pages = { ${getter} };`
      : mutation === 'spread getter mutates a page'
        ? `const Pages = { ...{ ${getter} } };`
        : 'const Pages = { ListPage: InitialPage };';
  return `import React from 'react';
    import { Route, Routes } from 'react-router-dom';
    import { createAppModule } from './create-app-module';
    import { ListPage as InitialPage } from './pages/list-page';
    import { CreatePage as ReplacementPage } from './pages/create-page';
    import { ManagementProvider } from './management/provider';
    import { NotFound } from './not-found';
    ${declaration}
    ${accessor ? '' : mutation}
    export const FeatureApp = createAppModule('/feature', Pages, [],
      ({ entries }) => <main>OUTER_LAYOUT_MARKER<ManagementProvider><Routes>{entries}<Route path="*" element={<NotFound />} /></Routes></ManagementProvider></main>);`;
}

/** Renders only the controlled authored module with the installed real React Router package. */
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
      sourcefile: 'controlled-mutated-registry.tsx',
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

describe('route factory aggregate mutation', () => {
  let root: string | undefined;
  const fixtures = new Map<string, VariableRouteFactoryFixture>();

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'route-factory-aggregate-mutation-'));
    for (const [index, mutation] of mutations.entries()) {
      fixtures.set(
        mutation,
        await createVariableRouteFactoryFixture(path.join(root, String(index)), {
          sourceOverrides: { 'src/app.tsx': sourceFor(mutation) },
          wrapCallbacks: false,
        }),
      );
    }
  });

  afterAll(async () => {
    await stop();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it.each(mutations)('proves authored replacement behavior: %s', async (mutation) => {
    const fixture = fixtures.get(mutation);
    assert.ok(fixture);
    const html = await renderAuthored(fixture);
    expect(html).toContain('CREATE_PAGE_MARKER');
    expect(html).toContain('INNER_PROVIDER_MARKER');
    expect(html).not.toContain('LIST_PAGE_MARKER');
    expect(html).not.toContain('NOT_FOUND_MARKER');
  });

  it.each(
    mutations.flatMap((mutation) => [
      { mutation, frozen: false },
      { mutation, frozen: true },
    ]),
  )(
    'preserves authored replacement when metadata is unresolved: $mutation, frozen=$frozen',
    async ({ mutation, frozen }) => {
      const fixture = fixtures.get(mutation);
      assert.ok(fixture);
      const result = await renderVariableRouteFactoryCase(fixture, {
        name: `mutated-registry-${String(mutations.indexOf(mutation))}-${String(frozen)}`,
        marker: 'CREATE_PAGE_MARKER',
        frozen,
      });
      expect(result.html).toContain('OUTER_LAYOUT_MARKER');
      expect(result.html).toContain('INNER_PROVIDER_MARKER');
      expect(result.html).toContain('CREATE_PAGE_MARKER');
      expect(result.html).not.toContain('LIST_PAGE_MARKER');
      expect(result.html).not.toContain('NOT_FOUND_MARKER');
      expect(result.branches).toEqual([
        expect.objectContaining({ componentName: 'ListPage', selectable: false }),
      ]);
      if (!frozen) expect(result.fallbackHtml).toContain('NOT_FOUND_MARKER');
    },
  );

  it('does not localize the legacy route using a different owner', async () => {
    const fixture = fixtures.get(mutations[0]);
    assert.ok(fixture);
    const result = await renderVariableRouteFactoryCase(fixture, {
      name: 'unresolved-wrong-owner-legacy',
      marker: 'NOT_FOUND_MARKER',
      wrongOwner: true,
      omitRuntimeBase: true,
    });
    expect(result.html).toContain('NOT_FOUND_MARKER');
    expect(result.html).not.toContain('CREATE_PAGE_MARKER');
  });

  it('rejects a frozen execution-root export that the source does not declare', async () => {
    const fixture = fixtures.get(mutations[0]);
    assert.ok(fixture);
    await expect(
      renderVariableRouteFactoryCase(fixture, {
        name: 'unresolved-wrong-owner-frozen',
        marker: 'NOT_FOUND_MARKER',
        frozen: true,
        wrongOwner: true,
        omitRuntimeBase: true,
      }),
    ).rejects.toThrow('could not prove the execution-root export "DifferentExport"');
  });

  it.each(mutations)(
    'does not promote the obsolete component to a selectable route: %s',
    async (mutation) => {
      const fixture = fixtures.get(mutation);
      assert.ok(fixture);
      const inventory = collectPreviewInspectorRouteFactoryChoices({
        sourcePath: fixture.appPath,
        sourceText: sourceFor(mutation),
        resolveModule: fixture.resolveModule,
        targetIdentities: new Set(['FeatureApp']),
      });
      expect(inventory.owner).toMatchObject({ basePath: '/feature', exportName: 'FeatureApp' });
      expect(inventory.choices).toEqual([
        expect.objectContaining({ componentName: 'ListPage', kind: 'page' }),
      ]);
      expect(inventory.references.size).toBe(0);
      const manifest = await collectPreviewInspectorRouteFactoryManifest({
        exportName: 'FeatureApp',
        readSource: fixture.readSource,
        resolveModule: fixture.resolveModule,
        sourcePath: fixture.appPath,
        sourceText: sourceFor(mutation),
      });
      expect(manifest?.routes).toEqual([]);
      expect(manifest?.options).toEqual([
        expect.objectContaining({
          componentName: 'ListPage',
          availability: 'component-unresolved',
        }),
      ]);
      expect(manifest?.fallbacks).toEqual([
        expect.objectContaining({ componentName: 'NotFound', pattern: '*' }),
      ]);
    },
  );
});
