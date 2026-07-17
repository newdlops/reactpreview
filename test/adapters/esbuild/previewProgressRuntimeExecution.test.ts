/**
 * Executes the generated progress protocol and preview entry around revision completion and React
 * commit boundaries. These tests deliberately avoid the controller fixture so retained-webview
 * behavior remains covered without growing its already maximum-sized test file.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewEntry } from '../../../src/adapters/esbuild/createPreviewEntry';
import { createPreviewApolloBridgePlugin } from '../../../src/adapters/esbuild/previewApolloBridgePlugin';
import { createPreviewFormikBridgePlugin } from '../../../src/adapters/esbuild/previewFormikBridgePlugin';
import { PREVIEW_SOURCE_LOADERS } from '../../../src/adapters/esbuild/previewLoaderPolicy';
import { createPreviewProgressRuntimeSource } from '../../../src/adapters/esbuild/previewProgressRuntimeSource';
import { createPreviewReduxBridgePlugin } from '../../../src/adapters/esbuild/previewReduxBridgePlugin';
import { createPreviewRouterBridgePlugin } from '../../../src/adapters/esbuild/previewRouterBridgePlugin';
import { createPreviewSetupBridgePlugin } from '../../../src/adapters/esbuild/previewSetupBridgePlugin';
import { createPreviewTargetBridgePlugin } from '../../../src/adapters/esbuild/previewTargetBridgePlugin';
import { selectPreviewTargetExports } from '../../../src/adapters/esbuild/previewTargetExports';
import { createPreviewThemeBridgePlugin } from '../../../src/adapters/esbuild/previewThemeBridgePlugin';
import { createPreviewProgressMessage } from '../../../src/presentation/previewProgress';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CONTROLLED_DOM_NAMESPACE = 'react-preview-progress-controlled-dom';
const IDENTITY_CONTEXT_NAMESPACE = 'react-preview-progress-identity-context';

/** Minimal extension progress listener installed into the browser VM. */
type ProgressMessageListener = (event: { readonly data: unknown }) => void;

/** Text and accessibility state needed by the isolated progress panel. */
interface ProgressElement {
  /** Last extension-owned text written into this node. */
  textContent: string;
  /** Stores one accessibility attribute without requiring a complete DOM implementation. */
  setAttribute(name: string, value: string): void;
}

/** Existing declarative progress host supplied by the preview HTML document. */
interface ProgressHost {
  /** Mimics the standard hidden property used to retain the overlay between revisions. */
  hidden: boolean;
  /** Existing open shadow root containing extension-owned progress chrome. */
  readonly shadowRoot: ProgressShadowRoot;
}

/** Existing declarative shadow root used by the runtime update path. */
interface ProgressShadowRoot {
  /** Finds a fixed extension-owned progress element. */
  getElementById(identifier: string): ProgressElement | null;
}

/** Root state shared by generated-entry commit and failure tests. */
interface ControlledMountNode {
  /** Markup committed by the controlled React DOM adapter or error renderer. */
  innerHTML: string;
  /** Current accessibility attributes on the React root. */
  readonly attributes: Map<string, string>;
  /** Replaces the root with zero or more inert runtime-error nodes. */
  replaceChildren(...children: ControlledTextElement[]): void;
  /** Records browser accessibility state written by the progress runtime. */
  setAttribute(name: string, value: string): void;
}

/** Minimal DOM element created by the generated runtime error renderer. */
interface ControlledTextElement {
  /** CSS class assigned by the generated entry. */
  className: string;
  /** Inert diagnostic text displayed in the root. */
  textContent: string;
  /** Lowercase tag name used while serializing the fixture. */
  readonly tagName: string;
}

/** Browser state returned with one generated bundle so tests can observe commit ordering. */
interface ControlledBrowserRuntime {
  /** VM global carrying callbacks installed by the controlled React DOM module. */
  readonly sandbox: Record<string, unknown>;
  /** Initial progress host retained across the generated entry bootstrap. */
  readonly progressHost: ProgressHost;
  /** React root receiving normal content or bootstrap failure markup. */
  readonly mountNode: ControlledMountNode;
}

/**
 * React DOM test adapter that separates `root.render` scheduling from its eventual commit. Class
 * `componentDidMount` callbacks execute only after the test explicitly releases the commit, which
 * models the exact lifecycle boundary used by the production progress sentinel.
 */
const CONTROLLED_DOM_CLIENT_SOURCE = String.raw`
/** Escapes fixture content before serializing a host node. */
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Serializes safe host attributes while omitting React-only values. */
function renderAttributes(props) {
  return Object.entries(props)
    .filter(([name, value]) =>
      name !== 'children' &&
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

/** Evaluates one small React tree and queues class mount lifecycles in child-first order. */
function renderNode(node, mountedCallbacks) {
  if (node === undefined || node === null || typeof node === 'boolean') {
    return '';
  }
  if (Array.isArray(node)) {
    return node.map((child) => renderNode(child, mountedCallbacks)).join('');
  }
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'bigint') {
    return escapeHtml(node);
  }
  if (typeof node !== 'object') {
    throw new TypeError('Unsupported controlled React node: ' + typeof node);
  }

  const { type, props = {} } = node;
  if (type === Symbol.for('react.fragment') || type === Symbol.for('react.suspense')) {
    return renderNode(props.children, mountedCallbacks);
  }
  if (typeof type === 'function') {
    if (type.prototype !== undefined && typeof type.prototype.render === 'function') {
      const instance = new type(props);
      const markup = renderNode(instance.render(), mountedCallbacks);
      if (typeof instance.componentDidMount === 'function') {
        mountedCallbacks.push(() => instance.componentDidMount());
      }
      return markup;
    }
    return renderNode(type(props), mountedCallbacks);
  }
  if (typeof type !== 'string') {
    throw new TypeError('Unsupported controlled React element type.');
  }
  return '<' + type + renderAttributes(props) + '>' +
    renderNode(props.children, mountedCallbacks) + '</' + type + '>';
}

/** Schedules a root and exposes an explicit commit release function to the host test. */
export function createRoot(mountNode) {
  return {
    render(element) {
      globalThis.__previewRenderScheduled = true;
      globalThis.__commitPreview = () => {
        const mountedCallbacks = [];
        mountNode.innerHTML = renderNode(element, mountedCallbacks);
        for (const callback of mountedCallbacks) {
          callback();
        }
      };
    },
    unmount() {
      mountNode.innerHTML = '';
    },
  };
}
`;

describe('preview progress runtime execution', () => {
  /**
   * Makes completion terminal for one revision while still allowing the next build revision to
   * reopen the retained overlay. This executes the actual generated message listener and helper.
   */
  it('does not reopen a completed revision from same or older progress messages', () => {
    const fixture = createProgressProtocolFixture();
    fixture.listener({ data: createPreviewProgressMessage('loading-preview', 4) });
    fixture.complete(4);

    expect(fixture.progressHost.hidden).toBe(true);
    expect(fixture.mountAttributes.get('aria-busy')).toBe('false');
    expect(fixture.hotRuntime.progressCompletedRevision).toBe(4);

    fixture.listener({ data: createPreviewProgressMessage('loading-preview', 4) });
    fixture.listener({ data: createPreviewProgressMessage('bundling-modules', 3) });

    expect(fixture.progressHost.hidden).toBe(true);
    expect(fixture.mountAttributes.get('aria-busy')).toBe('false');

    fixture.listener({ data: createPreviewProgressMessage('loading-preview', 5) });

    expect(fixture.progressHost.hidden).toBe(false);
    expect(fixture.mountAttributes.get('aria-busy')).toBe('true');
    expect(fixture.detail.textContent).toContain('Applying styles');
  });

  /**
   * Holds the renderer after `createRoot().render()` and proves bootstrap Promise resolution cannot
   * hide progress; only the class sentinel's actual `componentDidMount` commit may finish it.
   */
  it('keeps initial progress visible until the React commit sentinel mounts', async () => {
    const javascript = await buildControlledPreviewEntry(
      [
        'export function CommitTarget() {',
        '  return <main data-state="committed">COMMIT_TARGET_MARKER</main>;',
        '}',
      ].join('\n'),
      'CommitTarget.tsx',
    );
    const runtime = createControlledBrowserRuntime();

    runInContext(javascript, createContext(runtime.sandbox), { timeout: 10_000 });
    await waitForSandboxFlag(runtime.sandbox, '__previewRenderScheduled');
    await flushEventLoopTurns(3);

    expect(runtime.progressHost.hidden).toBe(false);
    expect(runtime.mountNode.attributes.get('aria-busy')).toBe('true');
    expect(runtime.mountNode.innerHTML).toBe('');

    readSandboxFunction(runtime.sandbox, '__commitPreview')();

    expect(runtime.mountNode.innerHTML).toContain('COMMIT_TARGET_MARKER');
    expect(runtime.progressHost.hidden).toBe(true);
    expect(runtime.mountNode.attributes.get('aria-busy')).toBe('false');
  });

  /**
   * Treats initial module evaluation failure as a completed preparation attempt: diagnostic markup
   * replaces the empty root and the overlay cannot remain permanently busy above that result.
   */
  it('finishes initial progress when bootstrap fails before React can commit', async () => {
    const javascript = await buildControlledPreviewEntry(
      [
        'export function NeverRenderedTarget() { return null; }',
        "throw new Error('INITIAL_BOOTSTRAP_FAILURE_MARKER');",
      ].join('\n'),
      'BootstrapFailureTarget.tsx',
    );
    const runtime = createControlledBrowserRuntime();

    runInContext(javascript, createContext(runtime.sandbox), { timeout: 10_000 });
    await waitForRootMarkup(runtime.mountNode);

    expect(runtime.mountNode.innerHTML).toContain('INITIAL_BOOTSTRAP_FAILURE_MARKER');
    expect(runtime.progressHost.hidden).toBe(true);
    expect(runtime.mountNode.attributes.get('aria-busy')).toBe('false');
  });
});

/** Runtime values returned by the standalone progress-protocol VM fixture. */
interface ProgressProtocolFixture {
  /** Direct completion helper exposed only by the appended test probe. */
  readonly complete: (revision: number) => void;
  /** Current browser-owned hot runtime state. */
  readonly hotRuntime: Record<string, unknown>;
  /** Installed message listener used instead of calling internal apply logic. */
  readonly listener: ProgressMessageListener;
  /** Root accessibility attributes updated by the progress helper. */
  readonly mountAttributes: Map<string, string>;
  /** Retained overlay host. */
  readonly progressHost: ProgressHost;
  /** Detail element proving a newer revision was applied. */
  readonly detail: ProgressElement;
}

/**
 * Evaluates the generated progress runtime with a preexisting declarative shadow root.
 *
 * @returns Direct helper plus observable DOM and hot-runtime state.
 */
function createProgressProtocolFixture(): ProgressProtocolFixture {
  const listeners = new Map<string, ProgressMessageListener>();
  const mountAttributes = new Map<string, string>();
  const elements = new Map<string, ProgressElement>();
  for (const identifier of [
    'react-preview-progress-panel',
    'react-preview-progress-label',
    'react-preview-progress-detail',
    'react-preview-progress-track',
    'react-preview-progress-step',
  ]) {
    elements.set(identifier, createProgressElement());
  }
  const shadowRoot: ProgressShadowRoot = {
    getElementById: (identifier) => elements.get(identifier) ?? null,
  };
  const progressHost: ProgressHost & {
    attachShadow(): ProgressShadowRoot;
    querySelector(): null;
  } = {
    attachShadow: () => shadowRoot,
    hidden: false,
    querySelector: () => null,
    shadowRoot,
  };
  const hotRuntime: Record<string, unknown> = {};
  const mountNode = {
    setAttribute(name: string, value: string): void {
      mountAttributes.set(name, value);
    },
  };
  const document = {
    getElementById(identifier: string): unknown {
      return identifier === 'react-preview-progress-host' ? progressHost : null;
    },
  };
  const sandbox: Record<string, unknown> = {
    __mountNode: mountNode,
    __previewHotRuntime: hotRuntime,
    addEventListener(type: string, listener: ProgressMessageListener): void {
      listeners.set(type, listener);
    },
    console,
    document,
  };
  sandbox.window = sandbox;
  const source = `
const previewHotRuntime = globalThis.__previewHotRuntime;
const mountNode = globalThis.__mountNode;
${createPreviewProgressRuntimeSource()}
globalThis.__completePreviewProgress = completePreviewProgress;
`;
  runInContext(source, createContext(sandbox), { timeout: 10_000 });
  const listener = listeners.get('message');
  const complete = sandbox.__completePreviewProgress;
  if (listener === undefined || typeof complete !== 'function') {
    throw new Error('The generated progress runtime did not expose its expected test controls.');
  }
  const detail = elements.get('react-preview-progress-detail');
  if (detail === undefined) {
    throw new Error('The progress detail fixture was not created.');
  }
  return {
    complete: complete as (revision: number) => void,
    detail,
    hotRuntime,
    listener,
    mountAttributes,
    progressHost,
  };
}

/** Creates one mutable progress element with bounded accessibility state. */
function createProgressElement(): ProgressElement {
  return {
    textContent: '',
    setAttribute: (): void => undefined,
  };
}

/**
 * Builds a self-contained generated entry using a controlled renderer and ordinary production
 * runtime bridges.
 *
 * @param sourceText Target module source evaluated during bootstrap.
 * @param fileName Target file name retained in generated diagnostics.
 * @returns Bundled IIFE safe to execute in the browser VM fixture.
 */
async function buildControlledPreviewEntry(sourceText: string, fileName: string): Promise<string> {
  const projectRoot = await mkdtemp(
    path.join(PROJECT_ROOT, 'test/fixtures/progress-runtime-execution-'),
  );
  const sourceDirectory = path.join(projectRoot, 'src');
  const documentPath = path.join(sourceDirectory, fileName);
  try {
    await mkdir(sourceDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
      writeFile(documentPath, sourceText, 'utf8'),
    ]);
    const result = await build({
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
        createControlledDomClientPlugin(),
        createPreviewApolloBridgePlugin({ projectRoot }),
        createIdentityContextBridgePlugin(),
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
          documentName: `src/${fileName}`,
          globalNamespaces: [],
          setupKind: 'none',
        }),
        loader: 'tsx',
        resolveDir: sourceDirectory,
        sourcefile: '<progress-runtime-execution-entry>',
      },
      target: 'es2022',
      write: false,
    });
    const javascript = result.outputFiles[0]?.text;
    if (javascript === undefined) {
      throw new Error('The controlled progress runtime fixture emitted no JavaScript.');
    }
    return javascript;
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
}

/** Resolves the generated entry's DOM client import to the commit-controlled adapter. */
function createControlledDomClientPlugin(): Plugin {
  return {
    name: 'react-preview-progress-controlled-dom',
    setup(buildContext): void {
      buildContext.onResolve({ filter: /^react-dom\/client$/ }, () => ({
        namespace: CONTROLLED_DOM_NAMESPACE,
        path: 'client',
      }));
      buildContext.onLoad({ filter: /.*/, namespace: CONTROLLED_DOM_NAMESPACE }, () => ({
        contents: CONTROLLED_DOM_CLIENT_SOURCE,
        loader: 'js',
      }));
    },
  };
}

/** Supplies an identity Context bridge because the controlled renderer intentionally has no hooks. */
function createIdentityContextBridgePlugin(): Plugin {
  return {
    name: 'react-preview-progress-identity-context',
    setup(buildContext): void {
      buildContext.onResolve({ filter: /^react-preview:context$/ }, () => ({
        namespace: IDENTITY_CONTEXT_NAMESPACE,
        path: 'context',
      }));
      buildContext.onLoad({ filter: /.*/, namespace: IDENTITY_CONTEXT_NAMESPACE }, () => ({
        contents: [
          'export function createContextPreviewElement(children) { return children; }',
          'export function registerPreviewContextIdentity() {}',
          'export function registerPreviewContextRequirement() {}',
          "export function readPreviewRuntimeStatus() { return 'inactive: test identity boundary'; }",
        ].join('\n'),
        loader: 'js',
      }));
    },
  };
}

/** Creates a browser VM with visible initial progress and a root that records accessibility state. */
function createControlledBrowserRuntime(): ControlledBrowserRuntime {
  const progressHost = createExistingProgressHost();
  const mountNode = createControlledMountNode();
  const listeners = new Map<string, unknown>();
  const sandbox: Record<string, unknown> = {
    addEventListener(type: string, listener: unknown): void {
      listeners.set(type, listener);
    },
    clearTimeout,
    console,
    document: {
      createElement(tagName: string): ControlledTextElement {
        return { className: '', tagName: tagName.toLowerCase(), textContent: '' };
      },
      getElementById(identifier: string): unknown {
        if (identifier === 'react-preview-root') {
          return mountNode;
        }
        if (identifier === 'react-preview-progress-host') {
          return progressHost;
        }
        return null;
      },
    },
    queueMicrotask,
    removeEventListener(type: string): void {
      listeners.delete(type);
    },
    setTimeout,
  };
  sandbox.window = sandbox;
  return { mountNode, progressHost, sandbox };
}

/** Creates the retained progress host that is visible before the first browser entry loads. */
function createExistingProgressHost(): ProgressHost {
  return {
    hidden: false,
    shadowRoot: {
      getElementById: () => null,
    },
  };
}

/** Creates a controlled root matching only the DOM operations used by the generated entry. */
function createControlledMountNode(): ControlledMountNode {
  return {
    attributes: new Map([['aria-busy', 'true']]),
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
    setAttribute(name, value): void {
      this.attributes.set(name, value);
    },
  };
}

/** Reads a no-argument function installed by the controlled browser module. */
function readSandboxFunction(sandbox: Record<string, unknown>, name: string): () => void {
  const candidate = sandbox[name];
  if (typeof candidate !== 'function') {
    throw new Error(`The controlled runtime did not install ${name}.`);
  }
  return candidate as () => void;
}

/** Waits for a generated runtime flag without relying on Promise implementation details. */
async function waitForSandboxFlag(sandbox: Record<string, unknown>, name: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (sandbox[name] === true) {
      return;
    }
    await flushEventLoopTurns(1);
  }
  throw new Error(`The generated runtime did not set ${name}.`);
}

/** Waits for initial bootstrap failure diagnostics to replace the empty root. */
async function waitForRootMarkup(mountNode: ControlledMountNode): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (mountNode.innerHTML.length > 0) {
      return;
    }
    await flushEventLoopTurns(1);
  }
  throw new Error('The initial bootstrap failure did not render diagnostic markup.');
}

/** Advances asynchronous dynamic imports and Promise continuations without a wall-clock sleep. */
async function flushEventLoopTurns(turns: number): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

/** Escapes diagnostic fixture values written by the generated entry outside React. */
function escapeFixtureHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
