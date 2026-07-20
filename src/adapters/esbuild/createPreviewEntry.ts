/**
 * Creates the virtual browser entry that initializes one preview boundary and mounts an export gallery.
 * Project setup and target modules are dynamically imported only after safe global namespaces exist,
 * preserving bootstrap order without executing a development server or project build configuration.
 */
import type { PreviewRenderMode } from '../../domain/preview';
import { createPreviewAutomaticPropsRuntimeSource } from './previewAutomaticPropsRuntimeSource';
import { createPreviewBrowserProcessRuntimeSource } from './previewBrowserProcessRuntimeSource';
import type { PreviewDocumentShell } from './previewDocumentShell';
import { createPreviewDocumentShellRuntimeSource } from './previewDocumentShellRuntimeSource';
import { PREVIEW_LAZY_STYLE_LOADER_SYMBOL } from './previewLazyStyleOutputs';
import { createPreviewPageInspectorRuntimeSource } from './pageInspector/previewPageInspectorRuntimeSource';
import { createPreviewHotReloadRuntimeSource } from './previewHotReloadRuntimeSource';
import { createPreviewProgressRuntimeSource } from './previewProgressRuntimeSource';
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
  /** Static project HTML attributes needed by body/root selectors before React mounts. */
  readonly documentShell?: PreviewDocumentShell;
  /** Safe object namespaces that must exist before any project setup or target import. */
  readonly globalNamespaces: readonly string[];
  /** Static status for lexical project-global module bridges selected by the compiler. */
  readonly globalPackageBridgeStatus?: string;
  /** Entry-private HMAC key used only by the Page Inspector trusted source-button bridge. */
  readonly inspectorSourceGestureSecret?: string;
  /** Component gallery by default, or the opt-in authored-page inspector runtime. */
  readonly renderMode?: PreviewRenderMode;
  /** Exact DOM IDs required by ReactDOM portals in the statically reached target graph. */
  readonly portalHostIds?: readonly string[];
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
  const browserProcessRuntimeSource = createPreviewBrowserProcessRuntimeSource();
  const documentShellRuntimeSource = createPreviewDocumentShellRuntimeSource(
    options.documentShell,
    options.portalHostIds,
  );
  const progressRuntimeSource = createPreviewProgressRuntimeSource();
  const hotReloadRuntimeSource = createPreviewHotReloadRuntimeSource(progressRuntimeSource);
  const inspectorImportSource =
    renderMode === 'page-inspector' ? "import * as ReactDOMNamespace from 'react-dom';" : '';
  const inspectorRuntimeSource =
    renderMode === 'page-inspector'
      ? createPreviewPageInspectorRuntimeSource(options.inspectorSourceGestureSecret)
      : '';
  return `
import * as React from 'react';
import { createRoot } from 'react-dom/client';
${inspectorImportSource}

${browserProcessRuntimeSource}

${documentShellRuntimeSource}

const previewBrowserProcessStatus = initializePreviewBrowserProcess();

const mountNode = document.querySelector?.('[data-react-preview-mount]') ??
  document.getElementById('react-preview-root');
if (mountNode === null) {
  throw new Error('React Preview could not find its root element.');
}

${runtimeErrorSource}

${automaticPropsRuntimeSource}

registerPreviewRuntimeCapability('Globals', {
  readPreviewRuntimeStatus: () =>
    ${encodedGlobalPackageBridgeStatus} + '; ' + previewBrowserProcessStatus,
});

${hotReloadRuntimeSource}

let activePreviewRouterBridge;
let activePreviewRouterConfiguration;

/**
 * Adds a statically inferred page location only when setup did not choose its own history.
 * The returned object is fresh so a pinned preview never mutates user-owned setup configuration.
 */
function createPreviewCandidateRouterConfiguration(setupConfiguration, inferredEntry) {
  if (
    setupConfiguration === false ||
    typeof inferredEntry !== 'string' ||
    inferredEntry.length === 0 ||
    inferredEntry.length > 2048
  ) {
    return setupConfiguration;
  }
  const setupRecord = setupConfiguration !== null && typeof setupConfiguration === 'object' &&
    !Array.isArray(setupConfiguration)
    ? setupConfiguration
    : undefined;
  if (setupRecord?.initialEntries !== undefined) return setupConfiguration;
  return {
    ...(setupRecord ?? {}),
    initialEntries: [inferredEntry],
    previewRouteSource: 'static-page-graph',
  };
}

/**
 * Delegates one independently mounted Inspector candidate to the exact project Router bridge.
 * The bridge performs its context check during React render, after setup and automatic providers
 * have composed, so this adapter cannot accidentally create a second Router.
 */
function createPreviewCandidateRouterElement(children, options) {
  const createCandidateBoundary = activePreviewRouterBridge?.createNestedRouterPreviewElement;
  return typeof createCandidateBoundary === 'function'
    ? createCandidateBoundary(children, {
        configuration: createPreviewCandidateRouterConfiguration(
          activePreviewRouterConfiguration,
          options?.initialEntry,
        ),
        ownsRouter: options?.ownsRouter === true,
      })
    : children;
}

${inspectorRuntimeSource}

let activeRuntimePhase = 'preview bootstrap';
const capturedReactErrors = new WeakSet();
const runtimePhaseByFailure = new Map();
let resolvePreviewCommit;
const previewCommitPromise = new Promise((resolve) => {
  resolvePreviewCommit = resolve;
});
let previewCommitCompleted = false;
let previewActivationStarted = false;

/** Records the next deterministic bootstrap stage without wrapping or replacing the real error. */
function enterRuntimePhase(phase) {
  activeRuntimePhase = phase;
  updatePreviewProgressRuntimeDetail(phase);
}

/** Preserves the exact concurrent preparation phase without wrapping or replacing its failure. */
function tagPreviewRuntimePhase(promise, phase) {
  return Promise.resolve(promise).catch((error) => {
    runtimePhaseByFailure.set(error, phase);
    throw error;
  });
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

/** Mirrors one runtime failure into Page Inspector when that optional mode owns this webview. */
function recordPreviewInspectorRuntimeConsoleEntry(error, runtimeContext = {}) {
  try {
    globalThis[Symbol.for('newdlops.react-file-preview.page-inspector')]?.recordConsoleEntry?.({
      error,
      level: 'error',
      source: 'preview-runtime',
      ...runtimeContext,
    });
  } catch {
    // Diagnostics are observational and must never replace the original runtime behavior.
  }
}

/** Shows a fatal startup diagnostic without destroying an already committed or retained React tree. */
function showRuntimeError(error, runtimeContext = {}) {
  const { forceReplace = false, ...diagnosticContext } = runtimeContext;
  const description = describeRuntimeError(error, {
    phase: runtimePhaseByFailure.get(error) ?? activeRuntimePhase,
    ...diagnosticContext,
  });
  recordPreviewInspectorRuntimeConsoleEntry(error, {
    ...diagnosticContext,
    details: description,
    phase: diagnosticContext.phase ?? runtimePhaseByFailure.get(error) ?? activeRuntimePhase,
  });
  const retainsMountedRevision =
    !forceReplace &&
    (previewCommitCompleted ||
      (previewEntryRevision > 0 &&
        !previewActivationStarted &&
        previewHotRuntime.root !== undefined));
  if (retainsMountedRevision) {
    console.error(
      'React Preview retained the mounted revision after a runtime error.\\n' + description,
    );
    return;
  }
  const errorElement = document.createElement('pre');
  errorElement.className = 'react-preview-runtime-error';
  errorElement.textContent = description;
  mountNode.replaceChildren(errorElement);
  completePreviewCommit('failed');
}

replacePreviewRuntimeListener('error', (event) => {
  if (isCapturedReactError(event.error)) {
    return;
  }
  // A Page Inspector candidate owns a parent boundary that retries this exact invariant without
  // the inferred MemoryRouter. React still dispatches a development ErrorEvent before that parent
  // commits, so do not prematurely mark the recoverable first attempt as a failed revision.
  if (
    ${JSON.stringify(renderMode === 'page-inspector')} &&
    activePreviewRouterBridge?.isNestedPreviewRouterError?.(event.error ?? event.message) === true
  ) {
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
    completePreviewCommit('failed');
    const componentStack = errorInfo?.componentStack;
    recordPreviewInspectorRuntimeConsoleEntry(error, {
      componentStack,
      phase: 'React provider composition or root render',
      source: 'react-boundary',
    });
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

/** Completes preparation only after React has committed the provider-wrapped preview tree. */
class PreviewRenderedCommitSignal extends React.Component {
  /** Resolves the revision-local readiness gate from React's synchronous commit lifecycle. */
  componentDidMount() {
    completePreviewCommit();
  }

  /** Adds no wrapper or marker to the inspected project's host DOM. */
  render() {
    return null;
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
    const details = describeRuntimeError(error, {
      componentStack,
      exportName: this.props.exportName,
      parentSlice: this.props.parentSlice,
      phase: 'React export render or lifecycle',
    });
    recordPreviewInspectorRuntimeConsoleEntry(error, {
      componentStack,
      details,
      exportName: this.props.exportName,
      phase: 'React export render or lifecycle',
      source: 'react-boundary',
    });
    console.warn(
      'React Preview isolated one failed export and kept the remaining preview mounted.\\n' +
        details,
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

/** Mounts statically proven app-level global styles beside the page under one shared theme. */
function createPreviewGlobalStyleElement(globalStyles, previewElement) {
  if (!Array.isArray(globalStyles) || globalStyles.length === 0) return previewElement;
  return React.createElement(
    React.Fragment,
    undefined,
    ...globalStyles.map((GlobalStyle, index) =>
      React.createElement(GlobalStyle, { key: 'react-preview-global-style-' + index }),
    ),
    previewElement,
  );
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

/** Removes GraphQL documents, enums, and other component-shaped constants before gallery setup. */
function selectReactLikePreviewDescriptors(descriptors) {
  return Array.isArray(descriptors)
    ? descriptors.filter((descriptor) => isReactLikePreviewValue(descriptor?.value))
    : [];
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

/** Renders one descriptor behind a local Suspense fallback so siblings remain independently visible. */
function PreviewExportRenderer({ descriptor, previewConfig, setupModule, sharedProps, storyContext }) {
  if (${encodedRenderMode} === 'page-inspector') {
    usePreviewInspectorStore();
  }
  if (!isReactLikePreviewValue(descriptor.value)) {
    throw new TypeError(
      'Export "' + descriptor.exportName + '" is not a renderable React component or element.',
    );
  }
  const fallbackValuesEnabled = ${encodedRenderMode} !== 'page-inspector' ||
    readPreviewInspectorFallbackValuesEnabled();
  const targetProps = createExportProps(
    setupModule,
    descriptor.exportName,
    sharedProps,
    fallbackValuesEnabled ? descriptor.automaticProps : undefined,
    fallbackValuesEnabled ? descriptor.inferredPropShape : undefined,
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
  const suspenseFallback = React.createElement(
    'div',
    { className: 'react-preview-suspense-placeholder', role: 'status' },
    'Loading ' + String(descriptor.displayName ?? descriptor.exportName) + '…',
  );
  return React.createElement(React.Suspense, { fallback: suspenseFallback }, rendered);
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

/** Runs project bootstrap and prepares a provider-wrapped element without replacing the visible root. */
async function preparePreviewElement() {
  enterRuntimePhase('initialize safe browser globals');
  initializeGlobalNamespaces();
  initializePreviewDocumentShell(mountNode);

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

  enterRuntimePhase('load automatic runtime bridges, props, and target graph');
  const [
    apolloBridge,
    contextBridge,
    formikBridge,
    reduxBridge,
    routerBridge,
    themeBridge,
    targetProps,
    previewModule,
  ] = await Promise.all([
    tagPreviewRuntimePhase(import(${encodedApolloSpecifier}), 'load automatic Apollo bridge'),
    tagPreviewRuntimePhase(import(${encodedContextSpecifier}), 'load automatic Context bridge'),
    tagPreviewRuntimePhase(import(${encodedFormikSpecifier}), 'load automatic Formik bridge'),
    tagPreviewRuntimePhase(import(${encodedReduxSpecifier}), 'load automatic Redux bridge'),
    tagPreviewRuntimePhase(import(${encodedRouterSpecifier}), 'load automatic Router bridge'),
    tagPreviewRuntimePhase(import(${encodedThemeSpecifier}), 'load automatic Theme bridge'),
    tagPreviewRuntimePhase(createTargetProps(setupModule, setupContext), 'create static preview props'),
    tagPreviewRuntimePhase(
      import(${encodedTargetSpecifier}),
      'load and evaluate target module graph',
    ),
  ]);
  activePreviewRouterBridge = routerBridge;
  activePreviewRouterConfiguration = readSetupMember(setupModule, 'routerPreview');
  registerPreviewRuntimeCapability('Apollo', apolloBridge);
  registerPreviewRuntimeCapability('Context', contextBridge);
  registerPreviewRuntimeCapability('Formik', formikBridge);
  registerPreviewRuntimeCapability('Redux', reduxBridge);
  registerPreviewRuntimeCapability('Router', routerBridge);
  registerPreviewRuntimeCapability('Theme', themeBridge);
  const previewTargets = selectReactLikePreviewDescriptors(previewModule.default);
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

  enterRuntimePhase('compose app-level global styles');
  previewElement = createPreviewGlobalStyleElement(
    previewModule.previewGlobalStyles,
    previewElement,
  );

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
    configuration: activePreviewRouterConfiguration,
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

  return previewElement;
}

/** Atomically mounts one fully prepared element and resolves only after React's commit sentinel. */
async function activatePreparedPreview(previewElement) {
  previewActivationStarted = true;
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
  const commitAwarePreviewElement = React.createElement(
    React.Fragment,
    undefined,
    previewElement,
    React.createElement(PreviewRenderedCommitSignal),
  );
  previewRoot.render(
    React.createElement(PreviewErrorBoundary, undefined, commitAwarePreviewElement),
  );
  enterRuntimePhase('React render, lifecycle, or asynchronous effect');
  return previewCommitPromise;
}

/** Resolves one entry revision exactly once and terminally hides its preparation indicator. */
function completePreviewCommit(outcome = 'ready') {
  if (previewCommitCompleted) {
    return;
  }
  previewCommitCompleted = true;
  completePreviewProgress(previewEntryRevision);
  try {
    globalThis[Symbol.for(${JSON.stringify(PREVIEW_LAZY_STYLE_LOADER_SYMBOL)})]?.commit?.();
  } catch (error) {
    console.warn('React Preview could not retire stale lazy stylesheets.', error);
  }
  resolvePreviewCommit(outcome);
  if (previewEntryRevision > 0) {
    return;
  }
  try {
    previewHotRuntime.vscodeApi?.postMessage({
      revision: previewRuntimeRevision,
      ...(typeof previewRuntimeToken === 'string' && previewRuntimeToken.length > 0
        ? { token: previewRuntimeToken }
        : {}),
      type: outcome === 'failed'
        ? 'react-preview-runtime-failed'
        : 'react-preview-runtime-ready',
    });
  } catch (error) {
    console.warn('React Preview could not report browser runtime readiness.', error);
  }
}

const previewPreparationPromise = preparePreviewElement();
let previewActivationPromise;
const preparedPreviewEntry = {
  /** Activates this entry at most once even if a duplicated host message repeats its token. */
  activate() {
    previewActivationPromise ??= previewPreparationPromise.then(activatePreparedPreview);
    return previewActivationPromise;
  },
  preparationPromise: previewPreparationPromise,
  revision: previewEntryRevision,
};
previewHotRuntime.preparedEntry = preparedPreviewEntry;
const previewBootstrapPromise = previewEntryRevision === 0
  ? preparedPreviewEntry.activate()
  : previewPreparationPromise;
previewHotRuntime.bootstrapPromise = previewBootstrapPromise;
void previewBootstrapPromise.catch((error) => {
  if (previewEntryRevision === 0) {
    showRuntimeError(error);
  }
});
`;
}
