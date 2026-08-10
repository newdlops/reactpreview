/**
 * Creates the virtual browser entry that initializes one preview boundary and mounts an export gallery.
 * Project setup and target modules are dynamically imported only after safe global namespaces exist,
 * preserving bootstrap order without executing a development server or project build configuration.
 */
import type { PreviewRenderMode } from '../../domain/preview';
import { createPreviewAutomaticPropsRuntimeSource } from './previewAutomaticPropsRuntimeSource';
import { createPreviewBrowserProcessRuntimeSource } from './previewBrowserProcessRuntimeSource';
import type { PreviewDocumentShell } from './previewDocumentShell';
import { createPreviewExportGalleryRuntimeSource } from './previewExportGalleryRuntimeSource';
import { createPreviewDocumentShellRuntimeSource } from './previewDocumentShellRuntimeSource';
import { PREVIEW_LAZY_STYLE_LOADER_SYMBOL } from './previewLazyStyleOutputs';
import { createPreviewPageInspectorRuntimeSource } from './pageInspector/previewPageInspectorRuntimeSource';
import { createPreviewHotReloadRuntimeSource } from './previewHotReloadRuntimeSource';
import { createPreviewProgressRuntimeSource } from './previewProgressRuntimeSource';
import { createPreviewRegeneratorRuntimeGlobalSource } from './previewRegeneratorRuntimeGlobalSource';
import { createPreviewDirectBlockerTraceRuntimeSource } from './staticResources/previewDirectBlockerTraceRuntimeSource';
import { createPreviewRuntimeCorrelationSource } from './staticResources/previewRuntimeCorrelationSource';
import {
  createPreviewReactDomRootRuntimeSource,
  type PreviewReactDomRootKind,
} from './previewReactDomRootRuntimeSource';
import {
  PREVIEW_APOLLO_SPECIFIER,
  PREVIEW_CONTEXT_SPECIFIER,
  PREVIEW_DRAG_DROP_SPECIFIER,
  PREVIEW_FORMIK_SPECIFIER,
  PREVIEW_REDUX_SPECIFIER,
  PREVIEW_ROUTER_SPECIFIER,
  PREVIEW_SETUP_SPECIFIER,
  PREVIEW_STYLE_SHEET_MANAGER_SPECIFIER,
  PREVIEW_TARGET_SPECIFIER,
  PREVIEW_THEME_SPECIFIER,
} from './previewPluginProtocol';
import { createPreviewRuntimeErrorSource } from './previewRuntimeErrorSource';
import { createPreviewStorybookRuntimeSource } from './previewStorybookRuntimeSource';
import { PREVIEW_INSPECTOR_ROUTE_ERROR_PROBE_SYMBOL_KEY } from './inspector/previewInspectorRouteExecutionRuntimeSource';

/** Setup environment selected by the compiler's bounded project inspection. */
export type PreviewEntrySetupKind = 'custom' | 'none' | 'storybook';

export type { PreviewReactDomRootKind } from './previewReactDomRootRuntimeSource';

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
  /** Browser-public dotenv values admitted by the compiler's project-root security boundary. */
  readonly publicEnvironment?: Readonly<Record<string, string>> | undefined;
  /** Uses ReactDOM.render when the project predates the react-dom/client entry point. */
  readonly reactDomRootKind?: PreviewReactDomRootKind;
  /** Determines whether standard Storybook decorators and parameters should be applied. */
  readonly setupKind: PreviewEntrySetupKind;
  /** Enables the compiler-provided virtual StyleSheetManager plan module. */
  readonly styleSheetManagerPlanEnabled?: boolean;
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
  const encodedDragDropSpecifier = JSON.stringify(PREVIEW_DRAG_DROP_SPECIFIER);
  const encodedFormikSpecifier = JSON.stringify(PREVIEW_FORMIK_SPECIFIER);
  const encodedReduxSpecifier = JSON.stringify(PREVIEW_REDUX_SPECIFIER);
  const encodedRouterSpecifier = JSON.stringify(PREVIEW_ROUTER_SPECIFIER);
  const encodedSetupSpecifier = JSON.stringify(PREVIEW_SETUP_SPECIFIER);
  const encodedStyleSheetManagerSpecifier = JSON.stringify(PREVIEW_STYLE_SHEET_MANAGER_SPECIFIER);
  const encodedStyleSheetManagerPlanEnabled = JSON.stringify(
    options.styleSheetManagerPlanEnabled === true,
  );
  const encodedTargetSpecifier = JSON.stringify(PREVIEW_TARGET_SPECIFIER);
  const encodedThemeSpecifier = JSON.stringify(PREVIEW_THEME_SPECIFIER);
  const runtimeErrorSource = createPreviewRuntimeErrorSource(options);
  const automaticPropsRuntimeSource = createPreviewAutomaticPropsRuntimeSource();
  const browserProcessRuntimeSource = createPreviewBrowserProcessRuntimeSource(
    options.publicEnvironment,
  );
  const regeneratorRuntimeGlobalSource = createPreviewRegeneratorRuntimeGlobalSource();
  const documentShellRuntimeSource = createPreviewDocumentShellRuntimeSource(
    options.documentShell,
    options.portalHostIds,
  );
  const progressRuntimeSource = createPreviewProgressRuntimeSource();
  const storybookRuntimeSource = createPreviewStorybookRuntimeSource();
  const exportGalleryRuntimeSource = createPreviewExportGalleryRuntimeSource({
    renderMode,
    setupKind: options.setupKind,
    storybookRuntimeSource,
  });
  const hotReloadRuntimeSource = createPreviewHotReloadRuntimeSource(progressRuntimeSource);
  const runtimeCorrelationSource =
    renderMode === 'page-inspector' ? '' : createPreviewRuntimeCorrelationSource();
  const directBlockerTraceRuntimeSource =
    renderMode === 'component' ? createPreviewDirectBlockerTraceRuntimeSource() : '';
  const reactDomRootSource = createPreviewReactDomRootRuntimeSource({
    requiresReactDomNamespace: renderMode === 'page-inspector',
    rootKind: options.reactDomRootKind ?? 'client',
  });
  const inspectorRuntimeSource =
    renderMode === 'page-inspector'
      ? createPreviewPageInspectorRuntimeSource(options.inspectorSourceGestureSecret)
      : '';
  return `
import * as React from 'react';
${reactDomRootSource.importSource}

${browserProcessRuntimeSource}

${regeneratorRuntimeGlobalSource}

${documentShellRuntimeSource}

${reactDomRootSource.runtimeSource}

const previewBrowserProcessStatus = initializePreviewBrowserProcess();
const previewRegeneratorRuntimeStatus = initializePreviewRegeneratorRuntimeGlobal();

const mountNode = document.querySelector?.('[data-react-preview-mount]') ??
  document.getElementById('react-preview-root');
if (mountNode === null) {
  throw new Error('React Preview could not find its root element.');
}

${runtimeErrorSource}

${automaticPropsRuntimeSource}

registerPreviewRuntimeCapability('Globals', {
  readPreviewRuntimeStatus: () =>
    ${encodedGlobalPackageBridgeStatus} + '; ' + previewBrowserProcessStatus +
      '; ' + previewRegeneratorRuntimeStatus,
});

${hotReloadRuntimeSource}

${runtimeCorrelationSource}

${directBlockerTraceRuntimeSource}

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
const previewInspectorRouteErrorProbeSymbol = Symbol.for(${JSON.stringify(PREVIEW_INSPECTOR_ROUTE_ERROR_PROBE_SYMBOL_KEY)});
const runtimePhaseByFailure = new Map();
let resolvePreviewCommit;
const previewCommitPromise = new Promise((resolve) => {
  resolvePreviewCommit = resolve;
});
let previewCommitCompleted = false;
let previewActivationStarted = false;
/** Holds revision-local descriptors without mutating the mounted Inspector session during prepare. */
let preparedPreviewInspectorTargets = [];

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

/** Distinguishes the compiler-owned data-router probe from an authored unhandled exception. */
function isPreviewInspectorRouteErrorProbe(error) {
  if ((typeof error !== 'object' && typeof error !== 'function') || error === null) return false;
  try { return error[previewInspectorRouteErrorProbeSymbol] === true; } catch { return false; }
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
  completePreviewCommit('failed', description);
}

replacePreviewRuntimeListener('error', (event) => {
  if (isPreviewInspectorRouteErrorProbe(event.error)) {
    event.preventDefault?.();
    return;
  }
  if (isCapturedReactError(event.error)) {
    return;
  }
  // A Page Inspector candidate owns a parent boundary that retries one exact Router invariant.
  // React still dispatches a development ErrorEvent before that parent commits, so do not
  // prematurely mark the recoverable first attempt as a failed revision.
  if (
    ${JSON.stringify(renderMode === 'page-inspector')} &&
    activePreviewRouterBridge?.isPreviewRouterRetryError?.(event.error ?? event.message) === true
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
  /*
   * Some application libraries intentionally reject a cancelled or superseded task without an
   * Error value. There is no stack, component, or payload path that the preview can repair in that
   * case. Treating undefined or null as a fatal bootstrap failure replaced an otherwise valid
   * authored page with the generic runtime diagnostic. Keep the observation in Page Inspector's
   * bounded console, suppress the browser's duplicate unhandled-rejection report, and leave the
   * mounted revision untouched. Non-nullish reasons still follow the existing fatal path below.
   */
  if (event.reason === undefined || event.reason === null) {
    const reasonLabel = event.reason === null ? 'null' : 'undefined';
    event.preventDefault?.();
    recordPreviewInspectorRuntimeConsoleEntry(event.reason, {
      details:
        'A project promise rejected with ' + reasonLabel +
        ' and supplied no actionable Error. React Preview kept the mounted render unchanged.',
      level: 'warn',
      message: 'Ignored nullish unhandled promise rejection (' + reasonLabel + ').',
      phase: 'unhandled promise rejection',
    });
    return;
  }
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
    completePreviewCommit(
      'failed',
      describeRuntimeError(error, {
        componentStack: errorInfo?.componentStack,
        phase: 'React provider composition or root render',
      }),
    );
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
    if (${encodedRenderMode} === 'component' && typeof globalThis.setTimeout === 'function') {
      // Direct previews commonly start memory-only queries from passive effects. Let those effects
      // subscribe and publish their synchronous static result before the host snapshots the first
      // committed branch; otherwise a transient authored loader is misreported as final output.
      this.commitTimer = globalThis.setTimeout(() => {
        this.commitTimer = undefined;
        completePreviewCommit();
      }, 0);
      return;
    }
    completePreviewCommit();
  }

  /** Prevents an abandoned hot revision from publishing a stale delayed terminal. */
  componentWillUnmount() {
    if (this.commitTimer !== undefined && typeof globalThis.clearTimeout === 'function') {
      globalThis.clearTimeout(this.commitTimer);
      this.commitTimer = undefined;
    }
  }

  /** Adds no wrapper or marker to the inspected project's host DOM. */
  render() {
    return null;
  }
}

${exportGalleryRuntimeSource}

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
  // Browserify-era dependencies can read the free global identifier while the target graph is
  // imported. Install the browser alias for every preview kind, but never shadow or invoke an
  // existing host descriptor anywhere on the global object's prototype chain.
  if (findGlobalPropertyDescriptor('global') === undefined) {
    try {
      Object.defineProperty(globalThis, 'global', {
        configurable: true,
        enumerable: false,
        value: globalThis,
        writable: true,
      });
    } catch {
      // A host may reserve the Node-compatible alias between descriptor inspection and definition.
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

/** Reads setup data without invoking a project-owned accessor. */
function readSetupDataMember(setupModule, memberName) {
  const namedDescriptor = Object.getOwnPropertyDescriptor(setupModule, memberName);
  if (namedDescriptor !== undefined) {
    return 'value' in namedDescriptor
      ? { status: 'value', value: namedDescriptor.value }
      : { status: 'unsafe' };
  }
  const defaultDescriptor = Object.getOwnPropertyDescriptor(setupModule, 'default');
  if (defaultDescriptor === undefined) return { status: 'absent' };
  if (!('value' in defaultDescriptor)) return { status: 'unsafe' };
  const defaultSetup = defaultDescriptor.value;
  if (defaultSetup === null || typeof defaultSetup !== 'object') return { status: 'absent' };
  const memberDescriptor = Object.getOwnPropertyDescriptor(defaultSetup, memberName);
  if (memberDescriptor === undefined) return { status: 'absent' };
  return 'value' in memberDescriptor
    ? { status: 'value', value: memberDescriptor.value }
    : { status: 'unsafe' };
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

/** Runs project bootstrap and prepares a provider-wrapped element without replacing the visible root. */
async function preparePreviewElement() {
  enterRuntimePhase('initialize safe browser globals');
  initializeGlobalNamespaces();
  initializePreviewDocumentShell(mountNode);

  enterRuntimePhase('load preview setup module');
  const setupBridge = await import(${encodedSetupSpecifier});
  const styledComponentsSetup = readSetupDataMember(setupBridge, 'styledComponentsPreview');
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
    dragDropBridge,
    formikBridge,
    reduxBridge,
    routerBridge,
    themeBridge,
    styleSheetManagerPlanModule,
    targetProps,
    previewModule,
  ] = await Promise.all([
    tagPreviewRuntimePhase(import(${encodedApolloSpecifier}), 'load automatic Apollo bridge'),
    tagPreviewRuntimePhase(import(${encodedContextSpecifier}), 'load automatic Context bridge'),
    tagPreviewRuntimePhase(import(${encodedDragDropSpecifier}), 'load automatic drag-and-drop bridge'),
    tagPreviewRuntimePhase(import(${encodedFormikSpecifier}), 'load automatic Formik bridge'),
    tagPreviewRuntimePhase(import(${encodedReduxSpecifier}), 'load automatic Redux bridge'),
    tagPreviewRuntimePhase(import(${encodedRouterSpecifier}), 'load automatic Router bridge'),
    tagPreviewRuntimePhase(import(${encodedThemeSpecifier}), 'load automatic Theme bridge'),
    ${encodedStyleSheetManagerPlanEnabled} && styledComponentsSetup.status === 'absent'
      ? tagPreviewRuntimePhase(
          import(${encodedStyleSheetManagerSpecifier}),
          'load StyleSheetManager plan',
        )
      : Promise.resolve(undefined),
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
  registerPreviewRuntimeCapability('Drag and drop', dragDropBridge);
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

  enterRuntimePhase('compose static drag-and-drop boundaries');
  previewElement = dragDropBridge.createDragDropPreviewElement(previewElement);

  enterRuntimePhase('compose static Apollo boundary');
  previewElement = apolloBridge.createApolloPreviewElement(previewElement, {
    configuration: readSetupMember(setupModule, 'apolloPreview'),
    ...setupContext,
  });

  if (${encodedRenderMode} === 'page-inspector') {
    // Keep this boundary outside every project/automatic provider so candidate and export changes
    // cannot retain a provider value produced by the preceding render corridor.
    previewElement = React.createElement(
      PreviewInspectorRuntimeFallbackScopeBoundary,
      undefined,
      previewElement,
    );
  }
  preparedPreviewInspectorTargets = previewTargets;
  enterRuntimePhase('compose styled-components StyleSheetManager boundary');
  const styleSheetBoundary = themeBridge.preparePreviewStyleSheetBoundary({
    configuration: styledComponentsSetup.status === 'value' ? styledComponentsSetup.value : undefined,
    configurationStatus: styledComponentsSetup.status,
    plan: styleSheetManagerPlanModule?.previewStyleSheetManagerPlan,
    renderMode: setupContext.renderMode,
    revision: previewEntryRevision,
  });
  registerPreviewRuntimeCapability('StyleSheetManager', {
    readPreviewRuntimeStatus: () => styleSheetBoundary.readStatus(),
  });
  return Object.freeze({
    previewElement: styleSheetBoundary.createElement(previewElement),
    styleSheetBoundary,
  });
}

/** Atomically mounts one fully prepared element and resolves only after React's commit sentinel. */
async function activatePreparedPreview(preparedPreview) {
  previewActivationStarted = true;
  enterRuntimePhase('commit React root');
  preparedPreview.styleSheetBoundary.activate();
  const previewRoot = createPreviewRoot(mountNode, {
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
  previewHotRuntime.activeStyleSheetBoundary = preparedPreview.styleSheetBoundary;
  const commitAwarePreviewElement = React.createElement(
    React.Fragment,
    undefined,
    preparedPreview.previewElement,
    React.createElement(PreviewRenderedCommitSignal),
  );
  if (${encodedRenderMode} === 'page-inspector') {
    // A prepared hot revision may never be selected for activation. Commit shared Inspector state
    // only for the entry that is about to render, preserving the still-mounted revision otherwise.
    preparePreviewInspectorRuntimeFallbackScope(preparedPreviewInspectorTargets);
  }
  previewRoot.render(
    React.createElement(PreviewErrorBoundary, undefined, commitAwarePreviewElement),
  );
  enterRuntimePhase('React render, lifecycle, or asynchronous effect');
  return previewCommitPromise;
}

/** Resolves one entry revision exactly once and terminally hides its preparation indicator. */
function completePreviewCommit(outcome = 'ready', error) {
  if (previewCommitCompleted) {
    return;
  }
  previewCommitCompleted = true;
  if (${encodedRenderMode} === 'component') {
    postPreviewDirectBlockerTrace(outcome, typeof error === 'string' ? error : undefined);
  }
  completePreviewProgress(previewEntryRevision);
  try {
    previewHotRuntime.activeStyleSheetBoundary?.commit?.();
    globalThis[Symbol.for(${JSON.stringify(PREVIEW_LAZY_STYLE_LOADER_SYMBOL)})]?.commit?.();
  } catch (error) {
    console.warn('React Preview could not retire stale lazy stylesheets.', error);
  }
  resolvePreviewCommit(outcome);
  if (previewEntryRevision > 0) {
    return;
  }
  try {
    const pageExecutionCandidateId = preparedPreviewInspectorTargets.find(
      (descriptor) => typeof descriptor?.inspector?.pageExecutionCandidateId === 'string',
    )?.inspector?.pageExecutionCandidateId;
    previewHotRuntime.vscodeApi?.postMessage({
      ...(pageExecutionCandidateId === undefined
        ? {}
        : { pageExecutionCandidateId }),
      pageApplicationPhase: outcome === 'failed' ? 'page-failed' : 'page-applied',
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
  async dispose() {
    try {
      const preparedPreview = await previewPreparationPromise;
      if (!previewActivationStarted) preparedPreview.styleSheetBoundary.dispose();
    } catch {
      // A rejected preparation owns no completed boundary to dispose.
    }
  },
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
