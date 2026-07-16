/**
 * Creates the virtual browser entry that initializes one preview boundary and mounts an export gallery.
 * Project setup and target modules are dynamically imported only after safe global namespaces exist,
 * preserving bootstrap order without executing a development server or project build configuration.
 */
import type { PreviewRenderMode } from '../../domain/preview';
import { createPreviewAutomaticPropsRuntimeSource } from './previewAutomaticPropsRuntimeSource';
import { createPreviewPageInspectorRuntimeSource } from './pageInspector/previewPageInspectorRuntimeSource';
import {
  PREVIEW_APOLLO_SPECIFIER,
  PREVIEW_CONTEXT_SPECIFIER,
  PREVIEW_FORMIK_SPECIFIER,
  PREVIEW_REDUX_SPECIFIER,
  PREVIEW_ROUTER_SPECIFIER,
  PREVIEW_SETUP_SPECIFIER,
  PREVIEW_TARGET_SPECIFIER,
  PREVIEW_THEME_SPECIFIER,
} from './previewPluginProtocol';
import { createPreviewRuntimeErrorSource } from './previewRuntimeErrorSource';

/** Setup environment selected by the compiler's bounded project inspection. */
export type PreviewEntrySetupKind = 'custom' | 'none' | 'storybook';

/** Immutable values encoded into one generated browser entry. */
export interface PreviewEntryOptions {
  /** Workspace-relative title exposed to setup hooks and Storybook decorators. */
  readonly documentName: string;
  /** Safe object namespaces that must exist before any project setup or target import. */
  readonly globalNamespaces: readonly string[];
  /** Static status for lexical project-global module bridges selected by the compiler. */
  readonly globalPackageBridgeStatus?: string;
  /** Component gallery by default, or the opt-in authored-page inspector runtime. */
  readonly renderMode?: PreviewRenderMode;
  /** Determines whether standard Storybook decorators and parameters should be applied. */
  readonly setupKind: PreviewEntrySetupKind;
}

/**
 * Builds a TSX-compatible runtime entry that loads setup before the private ordered-target bridge.
 * Custom setup modules may export initialization, Provider, props, and automatic bridge options.
 * A discovered Storybook preview contributes its global decorators and Apollo `MockedProvider`
 * parameter without loading Storybook's server or addon configuration.
 *
 * @param options Safe environment metadata discovered by the extension host.
 * @returns JavaScript source consumed through esbuild's stdin entry point.
 */
export function createPreviewEntry(options: PreviewEntryOptions): string {
  const encodedDocumentName = JSON.stringify(options.documentName);
  const encodedGlobalNamespaces = JSON.stringify(options.globalNamespaces);
  const encodedGlobalPackageBridgeStatus = JSON.stringify(
    options.globalPackageBridgeStatus ??
      'unavailable: no statically proven application-global module bridge',
  );
  const renderMode = options.renderMode ?? 'component';
  const encodedRenderMode = JSON.stringify(renderMode);
  const encodedSetupKind = JSON.stringify(options.setupKind);
  const encodedApolloSpecifier = JSON.stringify(PREVIEW_APOLLO_SPECIFIER);
  const encodedContextSpecifier = JSON.stringify(PREVIEW_CONTEXT_SPECIFIER);
  const encodedFormikSpecifier = JSON.stringify(PREVIEW_FORMIK_SPECIFIER);
  const encodedReduxSpecifier = JSON.stringify(PREVIEW_REDUX_SPECIFIER);
  const encodedRouterSpecifier = JSON.stringify(PREVIEW_ROUTER_SPECIFIER);
  const encodedSetupSpecifier = JSON.stringify(PREVIEW_SETUP_SPECIFIER);
  const encodedTargetSpecifier = JSON.stringify(PREVIEW_TARGET_SPECIFIER);
  const encodedThemeSpecifier = JSON.stringify(PREVIEW_THEME_SPECIFIER);
  const runtimeErrorSource = createPreviewRuntimeErrorSource(options);
  const automaticPropsRuntimeSource = createPreviewAutomaticPropsRuntimeSource();
  const inspectorImportSource =
    renderMode === 'page-inspector' ? "import * as ReactDOMNamespace from 'react-dom';" : '';
  const inspectorRuntimeSource =
    renderMode === 'page-inspector' ? createPreviewPageInspectorRuntimeSource() : '';
  return `
import * as React from 'react';
import { createRoot } from 'react-dom/client';
${inspectorImportSource}

const mountNode = document.getElementById('react-preview-root');
if (mountNode === null) {
  throw new Error('React Preview could not find its root element.');
}

${runtimeErrorSource}

${automaticPropsRuntimeSource}

registerPreviewRuntimeCapability('Globals', {
  readPreviewRuntimeStatus: () => ${encodedGlobalPackageBridgeStatus},
});

const PREVIEW_HOT_RUNTIME_KEY = Symbol.for('newdlops.react-file-preview.hot-runtime');

/** Creates the one webview-owned runtime that survives cache-busted entry-module imports. */
function createPreviewHotRuntime() {
  let vscodeApi;
  try {
    vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
  } catch {
    vscodeApi = undefined;
  }
  return {
    bootstrapPromise: undefined,
    eventListeners: new Map(),
    reloadQueue: Promise.resolve(),
    root: undefined,
    vscodeApi,
  };
}

const previewHotRuntime =
  globalThis[PREVIEW_HOT_RUNTIME_KEY] ?? createPreviewHotRuntime();
globalThis[PREVIEW_HOT_RUNTIME_KEY] = previewHotRuntime;

${inspectorRuntimeSource}

/** Replaces one module-owned global listener so hot imports cannot accumulate stale closures. */
function replacePreviewRuntimeListener(type, listener) {
  const previousListener = previewHotRuntime.eventListeners.get(type);
  if (typeof previousListener === 'function') {
    window.removeEventListener(type, previousListener);
  }
  window.addEventListener(type, listener);
  previewHotRuntime.eventListeners.set(type, listener);
}

/** Applies an optional generated stylesheet before the replacement component module mounts. */
function replacePreviewStylesheet(stylesheetUri) {
  const currentLink = document.getElementById('react-preview-stylesheet');
  if (typeof stylesheetUri !== 'string' || stylesheetUri.length === 0) {
    currentLink?.remove();
    return Promise.resolve();
  }
  if (currentLink instanceof HTMLLinkElement && currentLink.href === stylesheetUri) {
    return Promise.resolve();
  }
  const nextLink = document.createElement('link');
  nextLink.id = 'react-preview-stylesheet';
  nextLink.rel = 'stylesheet';
  nextLink.href = stylesheetUri;
  const loaded = new Promise((resolve) => {
    nextLink.addEventListener('load', resolve, { once: true });
    nextLink.addEventListener('error', resolve, { once: true });
  });
  if (currentLink === null) {
    document.head.append(nextLink);
  } else {
    currentLink.replaceWith(nextLink);
  }
  return loaded;
}

/** Validates an extension-owned hot revision message before importing another local ESM entry. */
function readHotReloadMessage(value) {
  if (value === null || typeof value !== 'object') {
    return undefined;
  }
  const { scriptUri, stylesheetUri, token, type } = value;
  if (
    type !== 'react-preview-hot-reload' ||
    typeof scriptUri !== 'string' ||
    !scriptUri.endsWith('/entry.js') ||
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > 256 ||
    (stylesheetUri !== undefined && typeof stylesheetUri !== 'string')
  ) {
    return undefined;
  }
  return { scriptUri, stylesheetUri, token };
}

/** Serializes cache-busted module swaps while retaining the surrounding VS Code webview document. */
async function applyHotReloadMessage(message) {
  try {
    if (previewHotRuntime.root !== undefined) {
      previewHotRuntime.root.unmount();
      previewHotRuntime.root = undefined;
    }
    mountNode.replaceChildren();
    await replacePreviewStylesheet(message.stylesheetUri);
    await import(message.scriptUri);
    const bootstrapPromise = previewHotRuntime.bootstrapPromise;
    if (bootstrapPromise !== undefined && typeof bootstrapPromise.then === 'function') {
      await bootstrapPromise;
    }
    previewHotRuntime.vscodeApi?.postMessage({
      token: message.token,
      type: 'react-preview-hot-reload-ready',
    });
  } catch (error) {
    showRuntimeError(error, { phase: 'hot reload module replacement' });
    previewHotRuntime.vscodeApi?.postMessage({
      token: message.token,
      type: 'react-preview-hot-reload-failed',
    });
  }
}

if (!previewHotRuntime.messageListenerInstalled) {
  window.addEventListener('message', (event) => {
    const message = readHotReloadMessage(event.data);
    if (message === undefined) {
      return;
    }
    previewHotRuntime.reloadQueue = previewHotRuntime.reloadQueue.then(
      () => applyHotReloadMessage(message),
      () => applyHotReloadMessage(message),
    );
  });
  previewHotRuntime.messageListenerInstalled = true;
}

let activeRuntimePhase = 'preview bootstrap';
const capturedReactErrors = new WeakSet();

/** Records the next deterministic bootstrap stage without wrapping or replacing the real error. */
function enterRuntimePhase(phase) {
  activeRuntimePhase = phase;
}

/** Marks an object failure already rendered by a React boundary so a global event cannot erase it. */
function rememberCapturedReactError(error) {
  if ((typeof error === 'object' || typeof error === 'function') && error !== null) {
    capturedReactErrors.add(error);
  }
}

/** Reports whether an ErrorEvent repeats a failure already isolated to one gallery export. */
function isCapturedReactError(error) {
  return (typeof error === 'object' || typeof error === 'function') &&
    error !== null &&
    capturedReactErrors.has(error);
}

/** Replaces the preview root with inert text for module and unhandled runtime failures. */
function showRuntimeError(error, runtimeContext = {}) {
  const errorElement = document.createElement('pre');
  errorElement.className = 'react-preview-runtime-error';
  errorElement.textContent = describeRuntimeError(error, {
    phase: activeRuntimePhase,
    ...runtimeContext,
  });
  mountNode.replaceChildren(errorElement);
}

replacePreviewRuntimeListener('error', (event) => {
  if (isCapturedReactError(event.error)) {
    return;
  }
  const location = typeof event.filename === 'string' && event.filename.length > 0
    ? event.filename + ':' + String(event.lineno ?? 0) + ':' + String(event.colno ?? 0)
    : undefined;
  showRuntimeError(event.error ?? event.message, {
    location,
    phase: 'unhandled browser error',
  });
});

replacePreviewRuntimeListener('unhandledrejection', (event) => {
  showRuntimeError(event.reason, { phase: 'unhandled promise rejection' });
});

/** React boundary that keeps provider, render, and lifecycle exceptions visible in the preview. */
class PreviewErrorBoundary extends React.Component {
  /** Creates a boundary with no captured error. */
  constructor(props) {
    super(props);
    this.state = { componentStack: '', error: undefined };
  }

  /** Stores the error that React captured during descendant rendering. */
  static getDerivedStateFromError(error) {
    return { error };
  }

  /** Retains React's logical owner stack, which is more useful than generated bundle offsets. */
  componentDidCatch(error, errorInfo) {
    rememberCapturedReactError(error);
    const componentStack = errorInfo?.componentStack;
    if (typeof componentStack === 'string' && componentStack !== this.state.componentStack) {
      this.setState({ componentStack });
    }
  }

  /** Renders escaped error text or the original component children. */
  render() {
    if (this.state.error !== undefined) {
      return React.createElement(
        'pre',
        { className: 'react-preview-runtime-error' },
        describeRuntimeError(this.state.error, {
          componentStack: this.state.componentStack,
          phase: 'React provider composition or root render',
        }),
      );
    }

    return this.props.children;
  }
}

/** Isolates one export so a broken component cannot remove later gallery entries. */
class PreviewExportErrorBoundary extends React.Component {
  /** Creates an export boundary with no captured error. */
  constructor(props) {
    super(props);
    this.state = { componentStack: '', error: undefined };
  }

  /** Stores the render or lifecycle error captured from this one export. */
  static getDerivedStateFromError(error) {
    return { error };
  }

  /** Stores the component path for the exact gallery export that failed. */
  componentDidCatch(error, errorInfo) {
    rememberCapturedReactError(error);
    const componentStack = errorInfo?.componentStack;
    if (typeof componentStack === 'string' && componentStack !== this.state.componentStack) {
      this.setState({ componentStack });
    }
    console.warn(
      'React Preview isolated one failed export and kept the remaining preview mounted.\\n' +
        describeRuntimeError(error, {
          componentStack,
          exportName: this.props.exportName,
          parentSlice: this.props.parentSlice,
          phase: 'React export render or lifecycle',
        }),
    );
  }

  /** Renders a compact local placeholder; complete diagnostics remain available as a warning. */
  render() {
    if (this.state.error !== undefined) {
      return React.createElement(
        'react-preview-inline-error',
        { className: 'react-preview-export-error', role: 'status' },
        React.createElement('strong', undefined, 'Static preview placeholder'),
        React.createElement(
          'span',
          undefined,
          String(this.props.exportName ?? 'default') + ': ' +
            createRuntimeErrorHeadline(this.state.error),
        ),
      );
    }
    return this.props.children;
  }
}

/** Finds an own or inherited global descriptor without invoking an accessor setter. */
function findGlobalPropertyDescriptor(propertyName) {
  let owner = globalThis;
  while (owner !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, propertyName);
    if (descriptor !== undefined) {
      return descriptor;
    }
    owner = Object.getPrototypeOf(owner);
  }
  return undefined;
}

/** Creates absent discovered objects without replacing primitives, accessors, or read-only globals. */
function initializeGlobalNamespaces() {
  if (${encodedSetupKind} !== 'none' && globalThis.global === undefined) {
    try {
      Object.defineProperty(globalThis, 'global', {
        configurable: true,
        enumerable: false,
        value: globalThis,
        writable: true,
      });
    } catch {
      // A host may reserve the Node-compatible alias; project setup can avoid it in that case.
    }
  }
  for (const namespace of ${encodedGlobalNamespaces}) {
    const descriptor = findGlobalPropertyDescriptor(namespace);
    if (descriptor !== undefined && !('value' in descriptor)) {
      continue;
    }
    const currentValue = globalThis[namespace];
    if (currentValue !== undefined && currentValue !== null) {
      continue;
    }
    if (descriptor !== undefined && descriptor.writable !== true) {
      continue;
    }

    try {
      if (descriptor === undefined) {
        Object.defineProperty(globalThis, namespace, {
          configurable: true,
          enumerable: true,
          value: {},
          writable: true,
        });
      } else {
        globalThis[namespace] = {};
      }
    } catch {
      // A host-owned Window property may reject writes even when its descriptor appears writable.
    }
  }
}

/** Reads a named setup contract from either an ESM named export or a default setup object. */
function readSetupMember(setupModule, memberName) {
  if (setupModule[memberName] !== undefined) {
    return setupModule[memberName];
  }

  const defaultSetup = setupModule.default;
  return defaultSetup !== null && typeof defaultSetup === 'object'
    ? defaultSetup[memberName]
    : undefined;
}

/** Produces serializable component props from the optional project setup contract. */
async function createTargetProps(setupModule, setupContext) {
  const createPreviewProps = readSetupMember(setupModule, 'createPreviewProps');
  const configuredProps = typeof createPreviewProps === 'function'
    ? await createPreviewProps(setupContext)
    : readSetupMember(setupModule, 'previewProps');
  return configuredProps !== null && typeof configuredProps === 'object'
    ? configuredProps
    : {};
}

/** Merges inferred, observed, shared setup, and exact-export props in ascending priority. */
function createExportProps(setupModule, exportName, sharedProps, automaticProps, inferredPropShape) {
  const propsByExport = readSetupMember(setupModule, 'previewPropsByExport');
  const configuredProps = propsByExport !== null && typeof propsByExport === 'object'
    ? propsByExport[exportName]
    : undefined;
  const safeAutomaticProps = automaticProps !== null && typeof automaticProps === 'object'
    ? automaticProps
    : {};
  return createPreviewPropsFromLayers(
    inferredPropShape,
    safeAutomaticProps,
    sharedProps,
    configuredProps,
  );
}

/** Creates a target element while preserving modules that already export a React element. */
function createTargetElement(PreviewTarget, targetProps) {
  if (PreviewTarget === undefined || PreviewTarget === null) {
    throw new Error('The selected preview export is empty at runtime.');
  }

  return React.isValidElement(PreviewTarget)
    ? PreviewTarget
    : React.createElement(PreviewTarget, targetProps);
}

const supportedReactTypeSymbols = new Set([
  Symbol.for('react.forward_ref'),
  Symbol.for('react.lazy'),
  Symbol.for('react.memo'),
]);

/** Rejects PascalCase constants while admitting functions, elements, memo, forwardRef, and lazy. */
function isReactLikePreviewValue(value) {
  if (React.isValidElement(value) || typeof value === 'function') {
    return true;
  }
  return value !== null &&
    typeof value === 'object' &&
    supportedReactTypeSymbols.has(value.$$typeof);
}

/** Merges decorator-supplied Storybook context fields while preserving nested argument objects. */
function mergeStoryContext(baseContext, contextUpdate) {
  if (contextUpdate === null || typeof contextUpdate !== 'object') {
    return baseContext;
  }
  return {
    ...baseContext,
    ...contextUpdate,
    args: { ...baseContext.args, ...contextUpdate.args },
    globals: { ...baseContext.globals, ...contextUpdate.globals },
    parameters: { ...baseContext.parameters, ...contextUpdate.parameters },
  };
}

/** Applies Storybook global decorators so later array entries wrap earlier entries. */
function applyStorybookDecorators(previewElementFactory, previewConfig, storyContext) {
  const decorators = Array.isArray(previewConfig.decorators) ? previewConfig.decorators : [];
  let renderStory = previewElementFactory;
  for (const decorator of decorators) {
    if (typeof decorator !== 'function') {
      continue;
    }

    const renderInnerStory = renderStory;
    renderStory = (contextUpdate) => {
      const nextContext = mergeStoryContext(storyContext, contextUpdate);
      const Story = (storyUpdate) => renderInnerStory(mergeStoryContext(nextContext, storyUpdate));
      return decorator(Story, nextContext);
    };
  }
  return renderStory(storyContext);
}

/** Invokes decorators during React render so decorator-owned hooks receive a valid dispatcher. */
function StorybookPreviewRoot({ PreviewTarget, previewConfig, storyContext, targetProps }) {
  const createElement = (context) =>
    createTargetElement(PreviewTarget, context?.args ?? targetProps);
  return applyStorybookDecorators(createElement, previewConfig, storyContext);
}

/** Renders one descriptor only after its export-specific error boundary has mounted. */
function PreviewExportRenderer({ descriptor, previewConfig, setupModule, sharedProps, storyContext }) {
  if (!isReactLikePreviewValue(descriptor.value)) {
    throw new TypeError(
      'Export "' + descriptor.exportName + '" is not a renderable React component or element.',
    );
  }
  const targetProps = createExportProps(
    setupModule,
    descriptor.exportName,
    sharedProps,
    descriptor.automaticProps,
    descriptor.inferredPropShape,
  );
  const rendered = ${encodedRenderMode} === 'page-inspector'
    ? React.createElement(PreviewPageInspectorRootRenderer, {
        descriptor,
        previewConfig,
        storyContext,
        targetProps,
        useStorybook: ${encodedSetupKind} === 'storybook',
      })
    : ${encodedSetupKind} === 'storybook'
      ? React.createElement(StorybookPreviewRoot, {
          PreviewTarget: descriptor.value,
          previewConfig,
          storyContext: { ...storyContext, args: targetProps },
          targetProps,
        })
      : createTargetElement(descriptor.value, targetProps);
  return React.createElement(React.Suspense, { fallback: null }, rendered);
}

/** Displays every selected export in bridge order with labels that never wrap target DOM. */
function PreviewExportGallery({ descriptors, previewConfig, setupModule, sharedProps, storyContext }) {
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    return React.createElement(
      'p',
      { className: 'react-preview-empty-gallery' },
      'This file has no direct default or PascalCase component exports to preview.',
    );
  }
  if (${encodedRenderMode} === 'page-inspector') {
    return React.createElement(
      React.Fragment,
      undefined,
      descriptors.map((descriptor, index) =>
        React.createElement(
          PreviewPageInspectorExportBoundary,
          {
            descriptor,
            key: descriptor.exportName + ':' + index.toString(),
          },
          React.createElement(PreviewExportRenderer, {
            descriptor,
            previewConfig,
            setupModule,
            sharedProps,
            storyContext: {
              ...storyContext,
              id: 'react-file-preview-' + index.toString(),
              name: descriptor.displayName,
            },
          }),
        ),
      ),
    );
  }
  return React.createElement(
    'div',
    { className: 'react-preview-gallery' },
    descriptors.map((descriptor, index) => {
      const runtimeName = descriptor.parentSlice === undefined
        ? typeof descriptor.value === 'function'
          ? descriptor.value.displayName ?? descriptor.value.name
          : descriptor.value?.displayName
        : undefined;
      const baseLabel = descriptor.displayName === 'default' && runtimeName
        ? 'default · ' + runtimeName
        : descriptor.displayName;
      const inferredValueCount = Array.isArray(descriptor.inferredProps)
        ? descriptor.inferredProps.length
        : 0;
      const label = inferredValueCount > 0
        ? baseLabel + ' · ' + String(inferredValueCount) + ' auto value(s)'
        : baseLabel;
      const exportStoryContext = {
        ...storyContext,
        id: 'react-file-preview-' + index.toString(),
        name: label,
      };
      return React.createElement(
        React.Fragment,
        { key: descriptor.exportName + ':' + index.toString() },
        React.createElement(
          'div',
          { className: 'react-preview-export-label' },
          label,
        ),
        React.createElement(
          PreviewExportErrorBoundary,
          { exportName: descriptor.exportName, parentSlice: descriptor.parentSlice },
          React.createElement(PreviewExportRenderer, {
            descriptor,
            previewConfig,
            setupModule,
            sharedProps,
            storyContext: exportStoryContext,
          }),
        ),
      );
    }),
  );
}

/** Reuses Storybook Apollo addon parameters without loading its manager or server runtime. */
function applyStorybookParameterProviders(previewElement, parameters) {
  const apolloOptions = parameters?.apolloClient;
  const MockedProvider = apolloOptions?.MockedProvider;
  if (MockedProvider === undefined || MockedProvider === null) {
    return previewElement;
  }

  const {
    MockedProvider: _ignoredProvider,
    globalMocks = [],
    mocks = [],
    ...providerProps
  } = apolloOptions;
  const combinedMocks = [
    ...(Array.isArray(globalMocks) ? globalMocks : []),
    ...(Array.isArray(mocks) ? mocks : []),
  ];
  return React.createElement(
    MockedProvider,
    { ...providerProps, mocks: combinedMocks },
    previewElement,
  );
}

/** Runs project bootstrap, imports target descriptors, composes providers, and commits one root. */
async function mountPreview() {
  enterRuntimePhase('initialize safe browser globals');
  initializeGlobalNamespaces();

  enterRuntimePhase('load preview setup module');
  const setupBridge = await import(${encodedSetupSpecifier});
  const setupModule = setupBridge.default ?? {};
  const setupContext = {
    documentName: ${encodedDocumentName},
    renderMode: ${encodedRenderMode},
    setupKind: ${encodedSetupKind},
  };
  const initializePreview = readSetupMember(setupModule, 'initializePreview');
  if (typeof initializePreview === 'function') {
    enterRuntimePhase('run setup initializePreview');
    await initializePreview(setupContext);
  }

  enterRuntimePhase('load automatic runtime bridges');
  const apolloBridge = await import(${encodedApolloSpecifier});
  registerPreviewRuntimeCapability('Apollo', apolloBridge);
  const contextBridge = await import(${encodedContextSpecifier});
  registerPreviewRuntimeCapability('Context', contextBridge);
  const formikBridge = await import(${encodedFormikSpecifier});
  registerPreviewRuntimeCapability('Formik', formikBridge);
  const reduxBridge = await import(${encodedReduxSpecifier});
  registerPreviewRuntimeCapability('Redux', reduxBridge);
  const routerBridge = await import(${encodedRouterSpecifier});
  registerPreviewRuntimeCapability('Router', routerBridge);
  const themeBridge = await import(${encodedThemeSpecifier});
  registerPreviewRuntimeCapability('Theme', themeBridge);
  enterRuntimePhase('create static preview props');
  const targetProps = await createTargetProps(setupModule, setupContext);
  enterRuntimePhase('load and evaluate target module graph');
  const previewModule = await import(${encodedTargetSpecifier});
  const previewTargets = previewModule.default;
  const previewConfig = {
    decorators: readSetupMember(setupModule, 'decorators') ?? [],
    parameters: readSetupMember(setupModule, 'parameters') ?? {},
  };
  const parameters = previewConfig.parameters;
  const storyContext = {
    args: targetProps,
    globals: {},
    id: 'react-file-preview',
    loaded: {},
    name: ${encodedDocumentName},
    parameters,
    title: ${encodedDocumentName},
    viewMode: 'story',
  };
  let previewElement = React.createElement(PreviewExportGallery, {
    descriptors: previewTargets,
    previewConfig,
    setupModule,
    sharedProps: targetProps,
    storyContext,
  });

  if (${encodedRenderMode} === 'page-inspector') {
    previewElement = React.createElement(
      PreviewPageInspectorShell,
      { descriptors: previewTargets },
      previewElement,
    );
  }

  if (${encodedSetupKind} === 'storybook') {
    previewElement = applyStorybookParameterProviders(previewElement, parameters);
  }

  const PreviewProviders = readSetupMember(setupModule, 'PreviewProviders');
  if (PreviewProviders !== undefined && PreviewProviders !== null) {
    enterRuntimePhase('compose project PreviewProviders');
    previewElement = React.createElement(PreviewProviders, setupContext, previewElement);
  }

  enterRuntimePhase('compose static application Context boundaries');
  previewElement = contextBridge.createContextPreviewElement(previewElement);

  enterRuntimePhase('resolve target-reachable theme');
  const discoveredTheme = await themeBridge.resolvePreviewTheme({
    configuration: readSetupMember(setupModule, 'themePreview'),
    discoveredTheme: previewModule.previewTheme,
    ...setupContext,
  });
  enterRuntimePhase('compose styled-components theme boundary');
  previewElement = themeBridge.createThemePreviewElement(previewElement, {
    configuration: readSetupMember(setupModule, 'themePreview'),
    discoveredTheme,
    ...setupContext,
  });

  enterRuntimePhase('compose React Router boundary');
  previewElement = routerBridge.createRouterPreviewElement(previewElement, {
    configuration: readSetupMember(setupModule, 'routerPreview'),
    ...setupContext,
  });

  enterRuntimePhase('compose React Redux boundary');
  previewElement = reduxBridge.createReduxPreviewElement(previewElement, {
    configuration: readSetupMember(setupModule, 'reduxPreview'),
    ...setupContext,
  });

  enterRuntimePhase('compose static Formik boundary');
  previewElement = formikBridge.createFormikPreviewElement(previewElement, {
    configuration: readSetupMember(setupModule, 'formikPreview'),
    ...setupContext,
  });

  enterRuntimePhase('compose static Apollo boundary');
  previewElement = apolloBridge.createApolloPreviewElement(previewElement, {
    configuration: readSetupMember(setupModule, 'apolloPreview'),
    ...setupContext,
  });

  enterRuntimePhase('commit React root');
  const previewRoot = createRoot(mountNode, {
    /** Preserves the last component stack when even the root diagnostic boundary cannot recover. */
    onUncaughtError(error, errorInfo) {
      showRuntimeError(error, {
        componentStack: errorInfo?.componentStack,
        phase: 'uncaught React root render or lifecycle',
      });
    },
    /** Prevents a React 19 root callback from racing the export-specific boundary report. */
    onCaughtError(error) {
      rememberCapturedReactError(error);
    },
    /** Keeps recoverable React work visible while retaining details in the webview console. */
    onRecoverableError(error, errorInfo) {
      console.warn('React Preview recovered from a React runtime error.', error, errorInfo);
    },
  });
  previewHotRuntime.root = previewRoot;
  previewRoot.render(
    React.createElement(PreviewErrorBoundary, undefined, previewElement),
  );
  enterRuntimePhase('React render, lifecycle, or asynchronous effect');
}

const previewBootstrapPromise = mountPreview();
previewHotRuntime.bootstrapPromise = previewBootstrapPromise;
void previewBootstrapPromise.catch((error) => {
  showRuntimeError(error);
});
`;
}
