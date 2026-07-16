/**
 * Executes the generated browser entry instead of inspecting bundle text only.
 * A deliberately small DOM client evaluates React elements into HTML, which keeps this test
 * dependency-free while proving bootstrap order, export ordering, props, and providers.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runInContext, createContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewApolloBridgePlugin } from '../../../src/adapters/esbuild/previewApolloBridgePlugin';
import { createPreviewFormikBridgePlugin } from '../../../src/adapters/esbuild/previewFormikBridgePlugin';
import { createPreviewReduxBridgePlugin } from '../../../src/adapters/esbuild/previewReduxBridgePlugin';
import { createPreviewRouterBridgePlugin } from '../../../src/adapters/esbuild/previewRouterBridgePlugin';
import { createPreviewEntry } from '../../../src/adapters/esbuild/createPreviewEntry';
import { PREVIEW_SOURCE_LOADERS } from '../../../src/adapters/esbuild/previewLoaderPolicy';
import { resolvePreviewRuntimeEnvironment } from '../../../src/adapters/esbuild/previewRuntimeEnvironment';
import { createPreviewSetupBridgePlugin } from '../../../src/adapters/esbuild/previewSetupBridgePlugin';
import { createPreviewTargetBridgePlugin } from '../../../src/adapters/esbuild/previewTargetBridgePlugin';
import { selectPreviewTargetExports } from '../../../src/adapters/esbuild/previewTargetExports';
import { createPreviewThemeBridgePlugin } from '../../../src/adapters/esbuild/previewThemeBridgePlugin';
import { installFakeApolloPackage } from './support/fakeApolloPackage';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TEST_DOM_CLIENT_NAMESPACE = 'react-preview-test-dom-client';

/** Minimal root element state exposed by the browser-like execution sandbox. */
interface RuntimeMountNode {
  /** Serialized markup committed by the test DOM client. */
  innerHTML: string;
  /** Replaces the root with a generated runtime-error element. */
  replaceChildren(...children: RuntimeTextElement[]): void;
}

/** Minimal text-bearing element used by the generated runtime's error renderer. */
interface RuntimeTextElement {
  /** CSS class assigned by the generated preview runtime. */
  className: string;
  /** Escaped error text displayed inside the preview root. */
  textContent: string;
  /** Lowercase host tag created through `document.createElement`. */
  readonly tagName: string;
}

/**
 * Browser-side test adapter injected in place of `react-dom/client`.
 * It intentionally supports only the React node forms required by this integration fixture.
 */
const TEST_DOM_CLIENT_SOURCE = String.raw`
/** Escapes text and attribute content before it becomes fixture HTML. */
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Serializes ordinary host attributes and ignores React-only properties. */
function renderAttributes(props) {
  return Object.entries(props)
    .filter(([name, value]) =>
      name !== 'children' &&
      name !== 'dangerouslySetInnerHTML' &&
      value !== undefined &&
      value !== null &&
      value !== false &&
      typeof value !== 'function'
    )
    .map(([name, value]) => {
      const attributeName = name === 'className' ? 'class' : name;
      return value === true
        ? ' ' + attributeName
        : ' ' + attributeName + '="' + escapeHtml(value) + '"';
    })
    .join('');
}

/** Evaluates the small React tree and serializes its resulting host elements. */
function renderNode(node) {
  if (node === undefined || node === null || typeof node === 'boolean') {
    return '';
  }
  if (Array.isArray(node)) {
    return node.map(renderNode).join('');
  }
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'bigint') {
    return escapeHtml(node);
  }
  if (typeof node !== 'object') {
    throw new TypeError('Unsupported React preview test node: ' + typeof node);
  }

  const { type, props = {} } = node;
  if (type === Symbol.for('react.fragment') || type === Symbol.for('react.suspense')) {
    return renderNode(props.children);
  }
  if (typeof type === 'function') {
    if (type.prototype !== undefined && typeof type.prototype.render === 'function') {
      const instance = new type(props);
      try {
        return renderNode(instance.render());
      } catch (error) {
        if (typeof type.getDerivedStateFromError !== 'function') {
          throw error;
        }
        instance.state = { ...instance.state, ...type.getDerivedStateFromError(error) };
        if (typeof instance.componentDidCatch === 'function') {
          instance.setState = (stateUpdate) => {
            const nextState = typeof stateUpdate === 'function'
              ? stateUpdate(instance.state, instance.props)
              : stateUpdate;
            instance.state = { ...instance.state, ...nextState };
          };
          instance.componentDidCatch(error, {
            componentStack: '\n    at RuntimeFixtureComponent (src/RuntimeFixture.tsx:7:3)',
          });
        }
        return renderNode(instance.render());
      }
    }
    return renderNode(type(props));
  }
  if (typeof type !== 'string') {
    throw new TypeError('Unsupported React preview test element type.');
  }

  return '<' + type + renderAttributes(props) + '>' + renderNode(props.children) + '</' + type + '>';
}

/** Commits one React element tree into the lightweight preview root. */
export function createRoot(mountNode) {
  return {
    render(element) {
      mountNode.innerHTML = renderNode(element);
    },
  };
}
`;

describe('generated preview runtime execution', () => {
  /**
   * Creates missing namespaces before setup evaluation, awaits initialization before importing the
   * named targets, and finally applies shared plus per-export props through one provider boundary.
   */
  it('executes globals, setup, target import, and provider rendering in order', async () => {
    const projectRoot = await mkdtemp(
      path.join(PROJECT_ROOT, 'test/fixtures/runtime-execution-preview-'),
    );
    const setupDirectory = path.join(projectRoot, '.react-preview');
    const sourceDirectory = path.join(projectRoot, 'src');
    const documentPath = path.join(sourceDirectory, 'named-runtime-preview.tsx');
    const setupModulePath = path.join(setupDirectory, 'setup.tsx');
    const publicDirectory = path.join(projectRoot, 'public');
    const sourceText = [
      'const service = window.ZUZU.service;',
      "window.__previewExecutionOrder.push('target-module:' + service);",
      'export function NamedRuntimePreview({ label, theme }) {',
      "  window.__previewExecutionOrder.push('target-render');",
      '  return (',
      '    <main data-service={service}>',
      "      {label + '|' + theme.spacing(2) + '|' + service}",
      '    </main>',
      '  );',
      '}',
      'export function SecondRuntimePreview({ label }) {',
      "  window.__previewExecutionOrder.push('second-target-render');",
      '  return <aside>{label}</aside>;',
      '}',
    ].join('\n');

    try {
      await Promise.all([
        mkdir(setupDirectory, { recursive: true }),
        mkdir(sourceDirectory, { recursive: true }),
        mkdir(publicDirectory, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(documentPath, sourceText, 'utf8'),
        writeFile(
          path.join(publicDirectory, 'index.html'),
          '<script>window.ZUZU = window.ZUZU || {};</script>',
          'utf8',
        ),
        writeFile(
          setupModulePath,
          [
            "import React from 'react';",
            "if (window.ZUZU === undefined) throw new Error('ZUZU namespace was not initialized');",
            "window.__previewExecutionOrder.push('setup-module');",
            'export async function initializePreview() {',
            "  window.__previewExecutionOrder.push('initialize-preview');",
            "  window.ZUZU.service = 'staff-partner';",
            '}',
            'export function createPreviewProps() {',
            "  window.__previewExecutionOrder.push('create-preview-props');",
            '  return {',
            "    label: 'props-ready',",
            '    theme: { spacing: (factor) => factor * 8 + "px" },',
            '  };',
            '}',
            'export const previewPropsByExport = {',
            "  SecondRuntimePreview: { label: 'second-ready' },",
            '};',
            'export function PreviewProviders({ children }) {',
            "  window.__previewExecutionOrder.push('preview-provider');",
            '  return <section data-provider="theme">{children}</section>;',
            '}',
          ].join('\n'),
          'utf8',
        ),
      ]);

      const runtimeEnvironment = await resolvePreviewRuntimeEnvironment({
        projectRoot,
        useStorybookPreview: true,
        workspaceRoot: projectRoot,
      });
      const targetExports = selectPreviewTargetExports(documentPath, sourceText);
      const selectedSetupModulePath = runtimeEnvironment.setupModulePath;
      if (selectedSetupModulePath === undefined) {
        throw new Error('The conventional runtime execution setup was not discovered.');
      }
      const bundle = await build({
        absWorkingDir: projectRoot,
        bundle: true,
        define: { 'process.env.NODE_ENV': '"test"' },
        format: 'iife',
        jsx: 'automatic',
        legalComments: 'none',
        loader: PREVIEW_SOURCE_LOADERS,
        logLevel: 'silent',
        platform: 'browser',
        plugins: [
          createTestDomClientPlugin(),
          createPreviewApolloBridgePlugin({ projectRoot }),
          createPreviewFormikBridgePlugin({ projectRoot }),
          createPreviewReduxBridgePlugin({ projectRoot }),
          createPreviewRouterBridgePlugin({ enabled: false, projectRoot }),
          createPreviewThemeBridgePlugin({ projectRoot }),
          createPreviewSetupBridgePlugin({ setupModulePath: selectedSetupModulePath }),
          createPreviewTargetBridgePlugin({
            documentPath,
            exports: targetExports,
          }),
        ],
        stdin: {
          contents: createPreviewEntry({
            documentName: 'src/named-runtime-preview.tsx',
            globalNamespaces: runtimeEnvironment.globalNamespaces,
            setupKind: runtimeEnvironment.setupKind,
          }),
          loader: 'tsx',
          resolveDir: sourceDirectory,
          sourcefile: '<runtime-execution-entry>',
        },
        target: 'es2022',
        write: false,
      });
      const javascript = bundle.outputFiles[0]?.text;
      if (javascript === undefined) {
        throw new Error('The runtime execution fixture did not emit a JavaScript bundle.');
      }

      const executionOrder: string[] = [];
      const mountNode = createRuntimeMountNode();
      const sandbox: Record<string, unknown> = {
        __previewExecutionOrder: executionOrder,
        addEventListener: (): undefined => undefined,
        clearTimeout,
        console,
        document: createRuntimeDocument(mountNode),
        queueMicrotask,
        setTimeout,
      };
      sandbox.window = sandbox;
      const context = createContext(sandbox);

      runInContext(javascript, context, { timeout: 10_000 });
      await waitForRenderedMarkup(mountNode);

      expect(runtimeEnvironment.setupKind).toBe('custom');
      expect(runtimeEnvironment.globalNamespaces).toContain('ZUZU');
      expect(targetExports).toEqual([
        {
          displayName: 'NamedRuntimePreview',
          exportName: 'NamedRuntimePreview',
          kind: 'explicit',
        },
        {
          displayName: 'SecondRuntimePreview',
          exportName: 'SecondRuntimePreview',
          kind: 'explicit',
        },
      ]);
      expect(executionOrder).toEqual([
        'setup-module',
        'initialize-preview',
        'create-preview-props',
        'target-module:staff-partner',
        'preview-provider',
        'target-render',
        'second-target-render',
      ]);
      expect(mountNode.innerHTML).toBe(
        '<section data-provider="theme"><div class="react-preview-gallery">' +
          '<div class="react-preview-export-label">NamedRuntimePreview</div>' +
          '<main data-service="staff-partner">props-ready|16px|staff-partner</main>' +
          '<div class="react-preview-export-label">SecondRuntimePreview</div>' +
          '<aside>second-ready</aside>' +
          '</div></section>',
      );
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /**
   * Reproduces a target that calls useApolloClient during render and proves the automatic outer
   * boundary supplies the same project-owned package instance without starting a transport.
   */
  it('renders a useApolloClient target through the automatic no-network provider', async () => {
    const projectRoot = await mkdtemp(
      path.join(PROJECT_ROOT, 'test/fixtures/runtime-apollo-preview-'),
    );
    const sourceDirectory = path.join(projectRoot, 'src');
    const documentPath = path.join(sourceDirectory, 'ApolloRuntimePreview.tsx');
    const sourceText = [
      "import { useApolloClient } from '@apollo/client';",
      'export default function ApolloRuntimePreview() {',
      '  const client = useApolloClient();',
      '  return (',
      '    <main data-client={client.marker}>static Apollo preview</main>',
      '  );',
      '}',
    ].join('\n');

    try {
      await mkdir(sourceDirectory, { recursive: true });
      await Promise.all([
        writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(documentPath, sourceText, 'utf8'),
        installFakeApolloPackage(projectRoot),
      ]);
      const bundle = await build({
        absWorkingDir: projectRoot,
        bundle: true,
        define: { 'process.env.NODE_ENV': '"test"' },
        format: 'iife',
        jsx: 'automatic',
        legalComments: 'none',
        loader: PREVIEW_SOURCE_LOADERS,
        logLevel: 'silent',
        platform: 'browser',
        plugins: [
          createTestDomClientPlugin(),
          createPreviewApolloBridgePlugin({ projectRoot }),
          createPreviewFormikBridgePlugin({ projectRoot }),
          createPreviewReduxBridgePlugin({ projectRoot }),
          createPreviewRouterBridgePlugin({ enabled: false, projectRoot }),
          createPreviewThemeBridgePlugin({ projectRoot }),
          createPreviewSetupBridgePlugin({}),
          createPreviewTargetBridgePlugin({
            documentPath,
            exports: selectPreviewTargetExports(documentPath, sourceText),
          }),
        ],
        stdin: {
          contents: createPreviewEntry({
            documentName: 'src/ApolloRuntimePreview.tsx',
            globalNamespaces: [],
            setupKind: 'none',
          }),
          loader: 'tsx',
          resolveDir: sourceDirectory,
          sourcefile: '<runtime-apollo-entry>',
        },
        target: 'es2022',
        write: false,
      });
      const javascript = bundle.outputFiles[0]?.text;
      if (javascript === undefined) {
        throw new Error('The Apollo runtime fixture did not emit a JavaScript bundle.');
      }

      let fetchCalls = 0;
      const mountNode = createRuntimeMountNode();
      const sandbox: Record<string, unknown> = {
        addEventListener: (): undefined => undefined,
        clearTimeout,
        console,
        document: createRuntimeDocument(mountNode),
        fetch(): never {
          fetchCalls += 1;
          throw new Error('The automatic Apollo preview must not call fetch.');
        },
        queueMicrotask,
        setTimeout,
      };
      sandbox.window = sandbox;
      const context = createContext(sandbox);

      runInContext(javascript, context, { timeout: 10_000 });
      await waitForRenderedMarkup(mountNode);

      expect(fetchCalls).toBe(0);
      expect(mountNode.innerHTML).toBe(
        '<div class="react-preview-gallery">' +
          '<div class="react-preview-export-label">ApolloRuntimePreview</div>' +
          '<main data-client="PROJECT_OWNED_APOLLO_MARKER">static Apollo preview</main>' +
          '</div>',
      );
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Keeps later exports visible when an earlier PascalCase export throws during rendering. */
  it('isolates one failed export without removing the remaining gallery', async () => {
    const projectRoot = await mkdtemp(
      path.join(PROJECT_ROOT, 'test/fixtures/runtime-export-boundary-preview-'),
    );
    const sourceDirectory = path.join(projectRoot, 'src');
    const documentPath = path.join(sourceDirectory, 'ExportBoundaryPreview.tsx');
    const sourceText = [
      'export function BrokenPreview() {',
      "  throw new Error('BROKEN_EXPORT_MARKER');",
      '}',
      'export function HealthyPreview() {',
      '  return <p>HEALTHY_EXPORT_MARKER</p>;',
      '}',
    ].join('\n');

    try {
      await mkdir(sourceDirectory, { recursive: true });
      await Promise.all([
        writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(documentPath, sourceText, 'utf8'),
      ]);
      const bundle = await build({
        absWorkingDir: projectRoot,
        bundle: true,
        define: { 'process.env.NODE_ENV': '"test"' },
        format: 'iife',
        jsx: 'automatic',
        legalComments: 'none',
        loader: PREVIEW_SOURCE_LOADERS,
        logLevel: 'silent',
        platform: 'browser',
        plugins: [
          createTestDomClientPlugin(),
          createPreviewApolloBridgePlugin({ projectRoot }),
          createPreviewFormikBridgePlugin({ projectRoot }),
          createPreviewReduxBridgePlugin({ projectRoot }),
          createPreviewRouterBridgePlugin({ enabled: false, projectRoot }),
          createPreviewThemeBridgePlugin({ projectRoot }),
          createPreviewSetupBridgePlugin({}),
          createPreviewTargetBridgePlugin({
            documentPath,
            exports: selectPreviewTargetExports(documentPath, sourceText),
          }),
        ],
        stdin: {
          contents: createPreviewEntry({
            documentName: 'src/ExportBoundaryPreview.tsx',
            globalNamespaces: [],
            setupKind: 'none',
          }),
          loader: 'tsx',
          resolveDir: sourceDirectory,
          sourcefile: '<runtime-export-boundary-entry>',
        },
        target: 'es2022',
        write: false,
      });
      const javascript = bundle.outputFiles[0]?.text;
      if (javascript === undefined) {
        throw new Error('The export boundary fixture did not emit a JavaScript bundle.');
      }

      const mountNode = createRuntimeMountNode();
      const sandbox: Record<string, unknown> = {
        addEventListener: (): undefined => undefined,
        clearTimeout,
        console,
        document: createRuntimeDocument(mountNode),
        queueMicrotask,
        setTimeout,
      };
      sandbox.window = sandbox;
      runInContext(javascript, createContext(sandbox), { timeout: 10_000 });
      await waitForRenderedMarkup(mountNode);

      expect(mountNode.innerHTML).toContain('BrokenPreview');
      expect(mountNode.innerHTML).toContain('class="react-preview-export-error"');
      expect(mountNode.innerHTML).toContain('Export: BrokenPreview');
      expect(mountNode.innerHTML).toContain('React component stack:');
      expect(mountNode.innerHTML).toContain('RuntimeFixtureComponent');
      expect(mountNode.innerHTML).toContain('BROKEN_EXPORT_MARKER');
      expect(mountNode.innerHTML).toContain('HealthyPreview');
      expect(mountNode.innerHTML).toContain('<p>HEALTHY_EXPORT_MARKER</p>');
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /**
   * Distinguishes a successful bundle with a missing app-root context from compilation failure and
   * retains the original branded error beneath generic recovery guidance.
   */
  it('renders actionable guidance for a missing React Redux context', async () => {
    const projectRoot = await mkdtemp(
      path.join(PROJECT_ROOT, 'test/fixtures/runtime-redux-diagnostic-preview-'),
    );
    const sourceDirectory = path.join(projectRoot, 'src');
    const documentPath = path.join(sourceDirectory, 'ReduxRuntimePreview.tsx');
    const sourceText = [
      'export default function ReduxRuntimePreview() {',
      "  throw new Error('could not find react-redux context value; please ensure the component is wrapped in a <Provider>');",
      '}',
    ].join('\n');

    try {
      await mkdir(sourceDirectory, { recursive: true });
      await Promise.all([
        writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(documentPath, sourceText, 'utf8'),
      ]);
      const bundle = await build({
        absWorkingDir: projectRoot,
        bundle: true,
        define: { 'process.env.NODE_ENV': '"test"' },
        format: 'iife',
        jsx: 'automatic',
        legalComments: 'none',
        loader: PREVIEW_SOURCE_LOADERS,
        logLevel: 'silent',
        platform: 'browser',
        plugins: [
          createTestDomClientPlugin(),
          createPreviewApolloBridgePlugin({ projectRoot }),
          createPreviewFormikBridgePlugin({ projectRoot }),
          createPreviewReduxBridgePlugin({ projectRoot }),
          createPreviewRouterBridgePlugin({ enabled: false, projectRoot }),
          createPreviewThemeBridgePlugin({ projectRoot }),
          createPreviewSetupBridgePlugin({}),
          createPreviewTargetBridgePlugin({
            documentPath,
            exports: selectPreviewTargetExports(documentPath, sourceText),
          }),
        ],
        stdin: {
          contents: createPreviewEntry({
            documentName: 'src/ReduxRuntimePreview.tsx',
            globalNamespaces: [],
            setupKind: 'none',
          }),
          loader: 'tsx',
          resolveDir: sourceDirectory,
          sourcefile: '<runtime-redux-diagnostic-entry>',
        },
        target: 'es2022',
        write: false,
      });
      const javascript = bundle.outputFiles[0]?.text;
      if (javascript === undefined) {
        throw new Error('The Redux diagnostic fixture did not emit a JavaScript bundle.');
      }

      const mountNode = createRuntimeMountNode();
      const sandbox: Record<string, unknown> = {
        addEventListener: (): undefined => undefined,
        clearTimeout,
        console,
        document: createRuntimeDocument(mountNode),
        queueMicrotask,
        setTimeout,
      };
      sandbox.window = sandbox;
      const context = createContext(sandbox);

      runInContext(javascript, context, { timeout: 10_000 });
      await waitForRenderedMarkup(mountNode);

      expect(mountNode.innerHTML).toContain('React Redux provider required');
      expect(mountNode.innerHTML).toContain('Error: could not find react-redux context value');
      expect(mountNode.innerHTML).toContain('The component bundle loaded');
      expect(mountNode.innerHTML).toContain('Phase: React export render or lifecycle');
      expect(mountNode.innerHTML).toContain('Preview setup: none');
      expect(mountNode.innerHTML).toContain('Automatic runtime boundaries:');
      expect(mountNode.innerHTML).toContain('Redux: unavailable: react-redux was not resolved');
      expect(mountNode.innerHTML).toContain('React component stack:');
      expect(mountNode.innerHTML).toContain('Original error:');
      expect(mountNode.innerHTML).toContain('could not find react-redux context value');
      expect(mountNode.innerHTML).not.toContain('/node_modules/react-redux');
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /**
   * Preserves a module-evaluation cause chain, decodes Apollo invariant metadata locally, and
   * reports the exact bootstrap phase instead of reducing the failure to generic setup guidance.
   */
  it('reports target evaluation causes and decoded Apollo invariant metadata', async () => {
    const projectRoot = await mkdtemp(
      path.join(PROJECT_ROOT, 'test/fixtures/runtime-target-cause-preview-'),
    );
    const sourceDirectory = path.join(projectRoot, 'src');
    const documentPath = path.join(sourceDirectory, 'TargetCausePreview.tsx');
    const apolloPayload = encodeURIComponent(
      JSON.stringify({ args: [], message: 58, version: '3.13.9' }),
    );
    const sourceText = [
      'export default function TargetCausePreview() { return null; }',
      `const cause = new Error('Invariant failure https://go.apollo.dev/c/err#${apolloPayload}');`,
      "const failure = new Error('Target module initialization failed', { cause });",
      "failure.code = 'TARGET_MODULE_EVALUATION';",
      'throw failure;',
    ].join('\n');

    try {
      await mkdir(sourceDirectory, { recursive: true });
      await Promise.all([
        writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(documentPath, sourceText, 'utf8'),
      ]);
      const bundle = await build({
        absWorkingDir: projectRoot,
        bundle: true,
        define: { 'process.env.NODE_ENV': '"test"' },
        format: 'iife',
        jsx: 'automatic',
        legalComments: 'none',
        loader: PREVIEW_SOURCE_LOADERS,
        logLevel: 'silent',
        platform: 'browser',
        plugins: [
          createTestDomClientPlugin(),
          createPreviewApolloBridgePlugin({ projectRoot }),
          createPreviewFormikBridgePlugin({ projectRoot }),
          createPreviewReduxBridgePlugin({ projectRoot }),
          createPreviewRouterBridgePlugin({ enabled: false, projectRoot }),
          createPreviewThemeBridgePlugin({ projectRoot }),
          createPreviewSetupBridgePlugin({}),
          createPreviewTargetBridgePlugin({
            documentPath,
            exports: selectPreviewTargetExports(documentPath, sourceText),
          }),
        ],
        stdin: {
          contents: createPreviewEntry({
            documentName: 'src/TargetCausePreview.tsx',
            globalNamespaces: [],
            setupKind: 'none',
          }),
          loader: 'tsx',
          resolveDir: sourceDirectory,
          sourcefile: '<runtime-target-cause-entry>',
        },
        target: 'es2022',
        write: false,
      });
      const javascript = bundle.outputFiles[0]?.text;
      if (javascript === undefined) {
        throw new Error('The target cause diagnostic fixture did not emit JavaScript.');
      }

      const mountNode = createRuntimeMountNode();
      const sandbox: Record<string, unknown> = {
        addEventListener: (): undefined => undefined,
        clearTimeout,
        console,
        document: createRuntimeDocument(mountNode),
        queueMicrotask,
        setTimeout,
      };
      sandbox.window = sandbox;
      runInContext(javascript, createContext(sandbox), { timeout: 10_000 });
      await waitForRenderedMarkup(mountNode);

      expect(mountNode.innerHTML).toContain('Apollo Client runtime error');
      expect(mountNode.innerHTML).toContain('Target module initialization failed');
      expect(mountNode.innerHTML).toContain('Phase: load and evaluate target module graph');
      expect(mountNode.innerHTML).toContain('Apollo invariant payload (decoded locally):');
      expect(mountNode.innerHTML).toContain('Apollo Client version: 3.13.9');
      expect(mountNode.innerHTML).toContain('Invariant message code: 58');
      expect(mountNode.innerHTML).toContain('Cause 1:');
      expect(mountNode.innerHTML).toContain('code: TARGET_MODULE_EVALUATION');
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });
});

/**
 * Resolves only the generated entry's React DOM client import to the lightweight execution shim.
 * All React, setup, target, and bridge modules continue through esbuild's ordinary browser graph.
 *
 * @returns Esbuild plugin scoped to the runtime execution fixture.
 */
function createTestDomClientPlugin(): Plugin {
  return {
    name: 'react-preview-test-dom-client',
    setup(buildContext): void {
      buildContext.onResolve({ filter: /^react-dom\/client$/ }, () => ({
        namespace: TEST_DOM_CLIENT_NAMESPACE,
        path: 'client',
      }));
      buildContext.onLoad({ filter: /.*/, namespace: TEST_DOM_CLIENT_NAMESPACE }, () => ({
        contents: TEST_DOM_CLIENT_SOURCE,
        loader: 'js',
      }));
    },
  };
}

/**
 * Creates the single root object supported by the runtime execution sandbox.
 *
 * @returns Mutable mount state updated by normal renders or runtime-error replacement.
 */
function createRuntimeMountNode(): RuntimeMountNode {
  return {
    innerHTML: '',
    replaceChildren(...children): void {
      this.innerHTML = children
        .map(
          (child) =>
            `<${child.tagName} class="${escapeFixtureHtml(child.className)}">` +
            `${escapeFixtureHtml(child.textContent)}</${child.tagName}>`,
        )
        .join('');
    },
  };
}

/**
 * Creates the two DOM operations used by the generated browser entry.
 *
 * @param mountNode Root returned for the fixed preview element identifier.
 * @returns Browser-like document object safe to expose inside a VM context.
 */
function createRuntimeDocument(mountNode: RuntimeMountNode): {
  createElement(tagName: string): RuntimeTextElement;
  getElementById(identifier: string): RuntimeMountNode | null;
} {
  return {
    createElement(tagName): RuntimeTextElement {
      return { className: '', tagName: tagName.toLowerCase(), textContent: '' };
    },
    getElementById(identifier): RuntimeMountNode | null {
      return identifier === 'react-preview-root' ? mountNode : null;
    },
  };
}

/**
 * Allows the generated async import and setup chain to complete without introducing wall-clock
 * sleeps or relying on implementation-specific Promise counts.
 *
 * @param mountNode Root whose first commit marks runtime completion.
 * @returns Promise resolved as soon as rendered or error markup is committed.
 */
async function waitForRenderedMarkup(mountNode: RuntimeMountNode): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (mountNode.innerHTML.length > 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }

  throw new Error('The generated preview runtime did not commit markup.');
}

/**
 * Escapes error-renderer fixture text written outside the bundled DOM client.
 *
 * @param value Raw runtime error element content.
 * @returns Safe fixture HTML text.
 */
function escapeFixtureHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
