/** Compares authored and compiler-selected colocated factory exports using the real Router. */
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
import {
  createVariableRouteFactoryFixture,
  type VariableRouteFactoryFixture,
} from './previewInspectorVariableRouteFactoryFixture';
import { variableRouteFactorySources } from './previewInspectorVariableRouteFactorySources';
import { renderVariableRouteFactoryCase } from './previewInspectorVariableRouteFactoryRuntime';

type PublicForm = 'direct' | 'renamed' | 'default';
const publicNames = { direct: 'ManagementApp', renamed: 'ManagedArea', default: 'default' };

/** Moves controlled owners into one file while retaining the original real-Router/Provider bodies. */
function colocatedSource(form: PublicForm): string {
  const management = variableRouteFactorySources['src/management/management-app.tsx'];
  const app = variableRouteFactorySources['src/app.tsx'];
  assert.ok(management && app);
  let local = management
    .replace("from './provider'", "from './management/provider'")
    .replace("import { Route, Routes } from 'react-router-dom';\n", '')
    .replace("import { createAppModule } from '../create-app-module';\n", '')
    .replace("from './detail-page'", "from './management/detail-page'")
    .replace("from './settings-page'", "from './management/settings-page'")
    .replace("import { NotFound } from '../not-found';\n", '');
  if (form !== 'direct') {
    local = local.replace('export const ManagementApp', 'const ManagementApp');
    local +=
      form === 'renamed'
        ? '\nexport { ManagementApp as ManagedArea };\n'
        : '\nexport default ManagementApp;\n';
  }
  return local + app.replace("import { ManagementApp } from './management/management-app';\n", '');
}

/** Renders the untouched authored app as a positive control before relying on compiler choices. */
async function renderAuthored(fixture: VariableRouteFactoryFixture): Promise<string> {
  const requireLocal = createRequire(import.meta.url);
  const bundled = await build({
    absWorkingDir: fixture.root,
    stdin: {
      contents: `import React from 'react';
        import { MemoryRouter, Routes, Route } from 'react-router-dom';
        import { FeatureApp } from ${JSON.stringify(fixture.appPath)};
        export default function AuthoredEntry() {
          return <MemoryRouter initialEntries={['/feature/manage/1/detail']}>
            <Routes><Route path="/feature/*" element={<FeatureApp />} /></Routes>
          </MemoryRouter>;
        }`,
      loader: 'tsx',
      resolveDir: fixture.root,
      sourcefile: 'controlled-authored-entry.tsx',
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
  const code = bundled.outputFiles[0]?.text;
  assert.ok(code);
  const warnings: string[] = [];
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
      console: {
        warn(...args: unknown[]) {
          warnings.push(args.join(' '));
        },
        error(...args: unknown[]) {
          throw new Error(args.join(' '));
        },
      },
    },
    { timeout: 5000 },
  );
  const html = renderToStaticMarkup(React.createElement(module.exports.default));
  assert.ok(
    warnings.every((message) => message.includes('React Router Future Flag Warning')),
    warnings.join('\n'),
  );
  return html;
}

describe('colocated route factory runtime', () => {
  let root: string | undefined;
  const fixtures = new Map<PublicForm, VariableRouteFactoryFixture>();

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'colocated-route-factory-'));
    for (const form of ['direct', 'renamed', 'default'] as const) {
      fixtures.set(
        form,
        await createVariableRouteFactoryFixture(path.join(root, form), {
          sourceOverrides: { 'src/app.tsx': colocatedSource(form) },
          wrapCallbacks: false,
        }),
      );
    }
  });

  afterAll(async () => {
    await stop();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('proves every authored source variant renders its real nested Provider and detail page', async () => {
    for (const fixture of fixtures.values()) {
      const html = await renderAuthored(fixture);
      expect(html).toContain('OUTER_LAYOUT_MARKER');
      expect(html).toContain('INNER_LAYOUT_MARKER');
      expect(html).toContain('INNER_PROVIDER_MARKER');
      expect(html).toContain('MANAGEMENT_DETAIL_MARKER:1');
      expect(html).not.toContain('NOT_FOUND_MARKER');
    }
  });

  it.each([
    ['direct', false],
    ['direct', true],
    ['renamed', false],
    ['renamed', true],
    ['default', false],
    ['default', true],
  ] as const)('selects the exact same-file %s export with frozen=%s', async (form, frozen) => {
    const fixture = fixtures.get(form);
    assert.ok(fixture);
    const inventory = await fixture.collect();
    const branch = inventory.branches.find((value) => value.componentName === 'ManagementApp');
    expect(branch).toMatchObject({ selectable: true });
    const result = await renderVariableRouteFactoryCase(fixture, {
      name: `colocated-${form}-${frozen ? 'frozen' : 'legacy'}`,
      selection: 'ManagementApp',
      marker: 'MANAGEMENT_DETAIL_MARKER:1',
      frozen,
    });
    expect(result.html).toContain('OUTER_LAYOUT_MARKER');
    expect(result.html).toContain('INNER_LAYOUT_MARKER');
    expect(result.html).toContain('INNER_PROVIDER_MARKER');
    expect(result.html).toContain('MANAGEMENT_DETAIL_MARKER:1');
    expect(result.html).not.toContain('NOT_FOUND_MARKER');
    expect(result.siblingMarkers).toEqual([]);
    expect(result.branches.some((value) => value.componentName === 'NotFound')).toBe(false);
    expect(result.branches.some((value) => value.componentName === 'DetailPage')).toBe(true);
    const selected = await fixture.collect(fixture.select('ManagementApp'));
    expect(selected.activeLocation?.routeMounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourcePath: fixture.appPath, exportName: publicNames[form] }),
      ]),
    );
  });
});
