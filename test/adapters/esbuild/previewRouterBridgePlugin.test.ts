/**
 * Verifies optional project React Router resolution and the bounded static MemoryRouter wrapper.
 * Each behavior runs from a real esbuild bundle in a VM so package identity and generated runtime
 * validation are exercised without installing react-router-dom in the extension itself.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createContext, runInContext, type Context } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewRouterBridgePlugin } from '../../../src/adapters/esbuild/previewRouterBridgePlugin';
import { createPreviewRouterRuntimeSource } from '../../../src/adapters/esbuild/previewRouterRuntimeSource';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PROJECT_ROUTER_MARKER = 'TARGET_PROJECT_MEMORY_ROUTER';

describe('createPreviewRouterBridgePlugin', () => {
  /** Leaves previews unchanged and does not require a package when capability selection is off. */
  it('provides an identity wrapper when automatic router support is disabled', async () => {
    const projectRoot = await createTemporaryProject('router-disabled-preview-');

    try {
      const context = await executeRouterBridgeFixture(
        projectRoot,
        false,
        [
          "import { createNestedRouterPreviewElement, createRouterPreviewElement } from 'react-preview:router';",
          "const child = { marker: 'DISABLED_ROUTER_CHILD' };",
          'globalThis.__routerBridgeResult = {',
          '  candidate: createNestedRouterPreviewElement(child) === child,',
          '  root: createRouterPreviewElement(child, { configuration: undefined }) === child,',
          '};',
        ].join('\n'),
      );

      expect(context.__routerBridgeResult).toEqual({ candidate: true, root: true });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Treats an absent project dependency as a supported no-op capability state. */
  it('provides an identity wrapper when the project has no react-router-dom package', async () => {
    const projectRoot = await createTemporaryProject('router-absent-preview-');

    try {
      const context = await executeRouterBridgeFixture(
        projectRoot,
        true,
        [
          "import { createRouterPreviewElement } from 'react-preview:router';",
          "const child = { marker: 'NO_ROUTER_CHILD' };",
          'globalThis.__routerBridgeResult =',
          '  createRouterPreviewElement(child, { configuration: undefined }) === child;',
        ].join('\n'),
      );

      expect(context.__routerBridgeResult).toBe(true);
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Uses the MemoryRouter exported by the target project's exact package instance. */
  it('uses the MemoryRouter owned by the target project with a root entry by default', async () => {
    const projectRoot = await createTemporaryProject('router-project-package-preview-');

    try {
      await installFakeReactRouterDomPackage(projectRoot, true);
      const context = await executeRouterBridgeFixture(
        projectRoot,
        true,
        [
          "import { createRouterPreviewElement } from 'react-preview:router';",
          "import { MemoryRouter, projectMarker } from 'react-router-dom';",
          "const element = createRouterPreviewElement('target', { configuration: undefined });",
          'globalThis.__routerBridgeResult = {',
          '  child: element.props.children,',
          '  entries: element.props.initialEntries,',
          '  hasIndex: Object.prototype.hasOwnProperty.call(element.props, "initialIndex"),',
          '  marker: element.type.projectMarker,',
          '  sameMarker: element.type.projectMarker === projectMarker,',
          '  sameRouter: element.type === MemoryRouter,',
          '};',
        ].join('\n'),
      );

      expect(context.__routerBridgeResult).toEqual({
        child: 'target',
        entries: ['/'],
        hasIndex: false,
        marker: PROJECT_ROUTER_MARKER,
        sameMarker: true,
        sameRouter: true,
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Copies valid static locations and forwards only an index within the selected history. */
  it('accepts bounded string entries and an in-range integer initialIndex', async () => {
    const projectRoot = await createTemporaryProject('router-static-configuration-preview-');

    try {
      await installFakeReactRouterDomPackage(projectRoot, true);
      const context = await executeRouterBridgeFixture(
        projectRoot,
        true,
        [
          "import { createRouterPreviewElement } from 'react-preview:router';",
          "const entries = ['/contracts/upload?preview=1', '/contracts/complete'];",
          "const element = createRouterPreviewElement('target', {",
          '  configuration: { initialEntries: entries, initialIndex: 1 },',
          '});',
          "entries[0] = '/mutated-after-render';",
          'globalThis.__routerBridgeResult = {',
          '  copied: element.props.initialEntries !== entries,',
          '  entries: element.props.initialEntries,',
          '  initialIndex: element.props.initialIndex,',
          '};',
        ].join('\n'),
      );

      expect(context.__routerBridgeResult).toEqual({
        copied: true,
        entries: ['/contracts/upload?preview=1', '/contracts/complete'],
        initialIndex: 1,
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Rejects location state objects and an out-of-range index instead of passing unsafe values. */
  it('falls back to the root entry for non-static entries and omits an invalid index', async () => {
    const projectRoot = await createTemporaryProject('router-invalid-configuration-preview-');

    try {
      await installFakeReactRouterDomPackage(projectRoot, true);
      const context = await executeRouterBridgeFixture(
        projectRoot,
        true,
        [
          "import { createRouterPreviewElement } from 'react-preview:router';",
          "const element = createRouterPreviewElement('target', {",
          "  configuration: { initialEntries: [{ pathname: '/private', state: { token: 'x' } }], initialIndex: 4 },",
          '});',
          'globalThis.__routerBridgeResult = {',
          '  entries: element.props.initialEntries,',
          '  hasIndex: Object.prototype.hasOwnProperty.call(element.props, "initialIndex"),',
          '};',
        ].join('\n'),
      );

      expect(context.__routerBridgeResult).toEqual({ entries: ['/'], hasIndex: false });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Enforces both history-count and per-location length limits before creating the element. */
  it('bounds oversized initialEntries configuration', async () => {
    const projectRoot = await createTemporaryProject('router-bounded-history-preview-');

    try {
      await installFakeReactRouterDomPackage(projectRoot, true);
      const context = await executeRouterBridgeFixture(
        projectRoot,
        true,
        [
          "import { createRouterPreviewElement } from 'react-preview:router';",
          "const tooMany = Array.from({ length: 33 }, (_, index) => '/route-' + index);",
          "const tooLong = ['/' + 'x'.repeat(2048)];",
          "const manyElement = createRouterPreviewElement('many', {",
          '  configuration: { initialEntries: tooMany },',
          '});',
          "const longElement = createRouterPreviewElement('long', {",
          '  configuration: { initialEntries: tooLong },',
          '});',
          'globalThis.__routerBridgeResult = {',
          '  longEntries: longElement.props.initialEntries,',
          '  manyEntries: manyElement.props.initialEntries,',
          '};',
        ].join('\n'),
      );

      expect(context.__routerBridgeResult).toEqual({ longEntries: ['/'], manyEntries: ['/'] });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Honors explicit setup opt-out even when the project package and capability are available. */
  it('returns the original child when routerPreview configuration is false', async () => {
    const projectRoot = await createTemporaryProject('router-setup-disabled-preview-');

    try {
      await installFakeReactRouterDomPackage(projectRoot, true);
      const context = await executeRouterBridgeFixture(
        projectRoot,
        true,
        [
          "import { createRouterPreviewElement } from 'react-preview:router';",
          "const child = { marker: 'SETUP_DISABLED_ROUTER_CHILD' };",
          'globalThis.__routerBridgeResult =',
          '  createRouterPreviewElement(child, { configuration: false }) === child;',
        ].join('\n'),
      );

      expect(context.__routerBridgeResult).toBe(true);
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Keeps a graph-requested router active when an unrelated custom setup is present. */
  it('does not let setup presence alone suppress a graph-requested router', async () => {
    const projectRoot = await createTemporaryProject('router-custom-setup-preview-');

    try {
      await installFakeReactRouterDomPackage(projectRoot, true);
      const context = await executeRouterBridgeFixture(
        projectRoot,
        true,
        [
          "import { createRouterPreviewElement } from 'react-preview:router';",
          "const child = { marker: 'CUSTOM_SETUP_CHILD' };",
          "const element = createRouterPreviewElement(child, { setupKind: 'custom' });",
          'globalThis.__routerBridgeResult = {',
          '  child: element.props.children.marker,',
          '  entries: element.props.initialEntries,',
          '};',
        ].join('\n'),
      );

      expect(context.__routerBridgeResult).toEqual({
        child: 'CUSTOM_SETUP_CHILD',
        entries: ['/'],
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Defers to graph provider evidence while retaining an explicit setup override. */
  it('skips an automatic nested router but honors explicit static history', async () => {
    const projectRoot = await createTemporaryProject('router-existing-provider-preview-');

    try {
      await installFakeReactRouterDomPackage(projectRoot, true);
      const context = await executeRouterBridgeFixture(
        projectRoot,
        true,
        [
          "import { createRouterPreviewElement, readPreviewRuntimeStatus } from 'react-preview:router';",
          "const child = { marker: 'EXISTING_PROVIDER_CHILD' };",
          'const automatic = createRouterPreviewElement(child, { configuration: undefined });',
          'const automaticStatus = readPreviewRuntimeStatus();',
          'const configured = createRouterPreviewElement(child, {',
          "  configuration: { initialEntries: ['/explicit-preview'] },",
          '});',
          'globalThis.__routerBridgeResult = {',
          '  automaticStatus,',
          '  configuredEntries: configured.props.initialEntries,',
          '  configuredStatus: readPreviewRuntimeStatus(),',
          '  skippedAutomatic: automatic === child,',
          '};',
        ].join('\n'),
        false,
      );

      expect(context.__routerBridgeResult).toEqual({
        automaticStatus: 'not applied: an existing target-reachable Router provider was detected',
        configuredEntries: ['/explicit-preview'],
        configuredStatus:
          'active: explicitly configured MemoryRouter with setup-owned static history',
        skippedAutomatic: true,
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Leaves the tree unchanged when an installed package does not expose MemoryRouter. */
  it('uses the identity behavior when MemoryRouter is unavailable', async () => {
    const projectRoot = await createTemporaryProject('router-api-absent-preview-');

    try {
      await installFakeReactRouterDomPackage(projectRoot, false);
      const context = await executeRouterBridgeFixture(
        projectRoot,
        true,
        [
          "import { createRouterPreviewElement } from 'react-preview:router';",
          "const child = { marker: 'UNSUPPORTED_ROUTER_CHILD' };",
          'globalThis.__routerBridgeResult =',
          '  createRouterPreviewElement(child, { configuration: undefined }) === child;',
        ].join('\n'),
      );

      expect(context.__routerBridgeResult).toBe(true);
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Leaves Page Inspector unwrapped so its selected candidate can own exactly one Router policy. */
  it('delegates Page Inspector routing to the candidate-local boundary', async () => {
    const projectRoot = await createTemporaryProject('router-page-inspector-preview-');

    try {
      await installFakeReactRouterDomPackage(projectRoot, true);
      const context = await executeRouterBridgeFixture(
        projectRoot,
        true,
        [
          "import { createRouterPreviewElement, readPreviewRuntimeStatus } from 'react-preview:router';",
          "const child = { marker: 'PAGE_INSPECTOR_CHILD' };",
          'const rendered = createRouterPreviewElement(child, {',
          "  configuration: { initialEntries: ['/contracts'] },",
          "  renderMode: 'page-inspector',",
          '});',
          'globalThis.__routerBridgeResult = {',
          '  childPreserved: rendered === child,',
          '  status: readPreviewRuntimeStatus(),',
          '};',
        ].join('\n'),
      );

      expect(context.__routerBridgeResult).toEqual({
        childPreserved: true,
        status:
          'available: Page Inspector delegates Router ownership to each selected page candidate',
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Supplies detached page candidates while inheriting setup or graph Router context exactly once. */
  it('adds a non-nesting candidate-local MemoryRouter during React render', async () => {
    const projectRoot = await createTemporaryProject('router-candidate-boundary-preview-');

    try {
      await installFakeReactRouterDomPackage(projectRoot, true);
      const context = await executeRouterBridgeFixture(
        projectRoot,
        true,
        [
          "import * as React from 'react';",
          "import { renderToStaticMarkup } from 'react-dom/server';",
          "import { createNestedRouterPreviewElement } from 'react-preview:router';",
          "import { MemoryRouter, RouterDepthProbe } from 'react-router-dom';",
          'function Candidate() {',
          '  return createNestedRouterPreviewElement(React.createElement(RouterDepthProbe), {});',
          '}',
          'const detached = renderToStaticMarkup(React.createElement(Candidate));',
          'const inherited = renderToStaticMarkup(',
          '  React.createElement(MemoryRouter, null, React.createElement(Candidate)),',
          ');',
          'const owned = renderToStaticMarkup(createNestedRouterPreviewElement(',
          '  React.createElement(MemoryRouter, null, React.createElement(RouterDepthProbe)),',
          '  { ownsRouter: true },',
          '));',
          'globalThis.__routerBridgeResult = { detached, inherited, owned };',
        ].join('\n'),
      );

      expect(context.__routerBridgeResult).toEqual({
        detached: '<span>1</span>',
        inherited: '<span>1</span>',
        owned: '<span>1</span>',
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Keeps generated imports restricted to React and the already-resolved router package entry. */
  it('does not import application routes or browser-history bootstrap modules', () => {
    const modulePath = '/workspace/app/node_modules/react-router-dom/index.js';
    const source = createPreviewRouterRuntimeSource({ reactRouterDomModulePath: modulePath });
    const importedSpecifiers = [...source.matchAll(/^import .* from (.+);$/gmu)].map(
      (match) => match[1],
    );

    expect(importedSpecifiers).toEqual(["'react'", JSON.stringify(modulePath)]);
    expect(source).not.toContain('window.history');
    expect(source).not.toContain('fetch(');
    expect(source).toContain('class PreviewCandidateRouterErrorBoundary');
    expect(source).toContain('candidate-owned Router detected at runtime');
  });
});

/** Creates an isolated nearest-package boundary beneath the repository's React installation. */
async function createTemporaryProject(prefix: string): Promise<string> {
  const projectRoot = await mkdtemp(path.join(PROJECT_ROOT, `test/fixtures/${prefix}`));
  await writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8');
  return projectRoot;
}

/**
 * Installs a tiny ESM package whose exported component exposes a project-identity marker.
 *
 * @param projectRoot Temporary nearest-package boundary used by esbuild resolution.
 * @param includeMemoryRouter Whether the fake package should expose the supported API.
 */
async function installFakeReactRouterDomPackage(
  projectRoot: string,
  includeMemoryRouter: boolean,
): Promise<void> {
  const packageRoot = path.join(projectRoot, 'node_modules/react-router-dom');
  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({ exports: './index.js', name: 'react-router-dom', type: 'module' }),
    'utf8',
  );
  const source = includeMemoryRouter
    ? [
        "import * as React from 'react';",
        `export const projectMarker = '${PROJECT_ROUTER_MARKER}';`,
        'const RouterDepthContext = React.createContext(0);',
        'export function MemoryRouter(properties) {',
        '  const depth = React.useContext(RouterDepthContext);',
        "  if (depth > 0) throw new Error('You cannot render a <Router> inside another <Router>. You should never have more than one in your app.');",
        '  return React.createElement(',
        '    RouterDepthContext.Provider,',
        '    { value: depth + 1 },',
        '    properties.children,',
        '  );',
        '}',
        'export function useInRouterContext() {',
        '  return React.useContext(RouterDepthContext) > 0;',
        '}',
        'export function RouterDepthProbe() {',
        "  return React.createElement('span', null, String(React.useContext(RouterDepthContext)));",
        '}',
        'MemoryRouter.projectMarker = projectMarker;',
      ].join('\n')
    : "export const projectMarker = 'ROUTER_WITHOUT_MEMORY_API';";
  await writeFile(path.join(packageRoot, 'index.js'), source, 'utf8');
}

/**
 * Bundles and executes one private router bridge fixture in a browser-like VM global.
 *
 * @param projectRoot Nearest package root used by the bridge's optional dependency lookup.
 * @param enabled Static capability selection passed to the bridge plugin.
 * @param source JavaScript fixture that records serializable assertions on `globalThis`.
 * @param automaticallyWrap Whether graph evidence permits an implicit outer MemoryRouter.
 * @returns Context containing values committed by the generated fixture.
 */
async function executeRouterBridgeFixture(
  projectRoot: string,
  enabled: boolean,
  source: string,
  automaticallyWrap = true,
): Promise<Context> {
  const result = await build({
    absWorkingDir: projectRoot,
    bundle: true,
    define: { 'process.env.NODE_ENV': '"test"' },
    format: 'iife',
    globalName: 'RouterPreviewFixture',
    logLevel: 'silent',
    platform: 'browser',
    plugins: [createPreviewRouterBridgePlugin({ automaticallyWrap, enabled, projectRoot })],
    stdin: {
      contents: source,
      loader: 'js',
      resolveDir: projectRoot,
      sourcefile: '<router-bridge-fixture>',
    },
    target: 'es2022',
    write: false,
  });
  const javascript = result.outputFiles[0]?.text;
  if (javascript === undefined) {
    throw new Error('The router bridge fixture emitted no JavaScript.');
  }

  const sandbox: Record<string, unknown> = {
    clearTimeout,
    console,
    MessageChannel,
    queueMicrotask,
    ReadableStream,
    setTimeout,
    TextDecoder,
    TextEncoder,
  };
  sandbox.globalThis = sandbox;
  const context = createContext(sandbox);
  runInContext(javascript, context, { timeout: 10_000 });
  return context;
}
