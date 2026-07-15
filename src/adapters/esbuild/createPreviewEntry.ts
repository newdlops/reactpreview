/**
 * Creates the virtual browser entry that initializes a project preview boundary and mounts a target.
 * Project setup and target modules are dynamically imported only after safe global namespaces exist,
 * preserving application bootstrap order without executing a development server or build config.
 */
import {
  PREVIEW_APOLLO_SPECIFIER,
  PREVIEW_SETUP_SPECIFIER,
  PREVIEW_TARGET_SPECIFIER,
} from './previewPluginProtocol';
import {
  PREVIEW_RUNTIME_DIAGNOSTIC_FALLBACK,
  PREVIEW_RUNTIME_DIAGNOSTIC_RULES,
} from './previewRuntimeDiagnostics';

/** Setup environment selected by the compiler's bounded project inspection. */
export type PreviewEntrySetupKind = 'custom' | 'none' | 'storybook';

/** Immutable values encoded into one generated browser entry. */
export interface PreviewEntryOptions {
  /** Workspace-relative title exposed to setup hooks and Storybook decorators. */
  readonly documentName: string;
  /** Safe object namespaces that must exist before any project setup or target import. */
  readonly globalNamespaces: readonly string[];
  /** Determines whether standard Storybook decorators and parameters should be applied. */
  readonly setupKind: PreviewEntrySetupKind;
}

/**
 * Builds a TSX-compatible runtime entry that loads setup before the private target bridge.
 * Custom setup modules may export `initializePreview`, `PreviewProviders`, `previewProps`, or
 * `createPreviewProps`. A discovered Storybook preview contributes its global decorators and its
 * Apollo `MockedProvider` parameter without loading Storybook's server or addon configuration.
 *
 * @param options Safe environment metadata discovered by the extension host.
 * @returns JavaScript source consumed through esbuild's stdin entry point.
 */
export function createPreviewEntry(options: PreviewEntryOptions): string {
  const encodedDocumentName = JSON.stringify(options.documentName);
  const encodedGlobalNamespaces = JSON.stringify(options.globalNamespaces);
  const encodedSetupKind = JSON.stringify(options.setupKind);
  const encodedApolloSpecifier = JSON.stringify(PREVIEW_APOLLO_SPECIFIER);
  const encodedRuntimeDiagnosticFallback = JSON.stringify(PREVIEW_RUNTIME_DIAGNOSTIC_FALLBACK);
  const encodedRuntimeDiagnosticRules = JSON.stringify(PREVIEW_RUNTIME_DIAGNOSTIC_RULES);
  const encodedSetupSpecifier = JSON.stringify(PREVIEW_SETUP_SPECIFIER);
  const encodedTargetSpecifier = JSON.stringify(PREVIEW_TARGET_SPECIFIER);
  return `
import * as React from 'react';
import { createRoot } from 'react-dom/client';

const mountNode = document.getElementById('react-preview-root');
if (mountNode === null) {
  throw new Error('React Preview could not find its root element.');
}

const runtimeDiagnosticRules = ${encodedRuntimeDiagnosticRules};
const runtimeDiagnosticFallback = ${encodedRuntimeDiagnosticFallback};
const MAX_RUNTIME_ERROR_DETAILS = 12000;

/** Reads only the direct message used for stable, repository-independent classification. */
function readRuntimeErrorMessage(error) {
  try {
    if (error !== null && typeof error === 'object' && typeof error.message === 'string') {
      return error.message;
    }
    return String(error);
  } catch {
    return 'Unknown runtime error';
  }
}

/** Selects a library-branded context diagnostic without examining generated stack paths. */
function classifyRuntimeError(error) {
  const message = readRuntimeErrorMessage(error).toLowerCase();
  return runtimeDiagnosticRules.find((rule) =>
    rule.messageIncludes.some((fragment) => message.includes(fragment)),
  ) ?? runtimeDiagnosticFallback;
}

/** Converts an unknown browser failure into bounded actionable text plus original details. */
function describeRuntimeError(error) {
  const diagnostic = classifyRuntimeError(error);
  let rawDetails;
  try {
    const rawValue = error instanceof Error ? error.stack ?? error.message : error;
    rawDetails = String(rawValue);
  } catch {
    rawDetails = 'Unknown runtime error';
  }
  const setupDescription = ${encodedSetupKind} === 'none'
    ? 'none'
    : ${encodedSetupKind};
  return [
    diagnostic.title,
    '',
    diagnostic.summary,
    diagnostic.recovery,
    '',
    'Target: ' + ${encodedDocumentName},
    'Preview setup: ' + setupDescription,
    '',
    'Original error:',
    rawDetails.slice(0, MAX_RUNTIME_ERROR_DETAILS),
  ].join('\\n');
}

/** Replaces the preview root with inert text for module and unhandled runtime failures. */
function showRuntimeError(error) {
  const errorElement = document.createElement('pre');
  errorElement.className = 'react-preview-runtime-error';
  errorElement.textContent = describeRuntimeError(error);
  mountNode.replaceChildren(errorElement);
}

window.addEventListener('error', (event) => {
  showRuntimeError(event.error ?? event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  showRuntimeError(event.reason);
});

/** React boundary that keeps provider, render, and lifecycle exceptions visible in the preview. */
class PreviewErrorBoundary extends React.Component {
  /** Creates a boundary with no captured error. */
  constructor(props) {
    super(props);
    this.state = { error: undefined };
  }

  /** Stores the error that React captured during descendant rendering. */
  static getDerivedStateFromError(error) {
    return { error };
  }

  /** Renders escaped error text or the original component children. */
  render() {
    if (this.state.error !== undefined) {
      return React.createElement(
        'pre',
        { className: 'react-preview-runtime-error' },
        describeRuntimeError(this.state.error),
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

/** Creates a target element while preserving modules that already export a React element. */
function createTargetElement(PreviewTarget, targetProps) {
  if (PreviewTarget === undefined || PreviewTarget === null) {
    throw new Error('The selected preview export is empty at runtime.');
  }

  return React.isValidElement(PreviewTarget)
    ? PreviewTarget
    : React.createElement(PreviewTarget, targetProps);
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

/** Runs project bootstrap, imports the target, composes providers, and commits one React root. */
async function mountPreview() {
  initializeGlobalNamespaces();

  const setupBridge = await import(${encodedSetupSpecifier});
  const setupModule = setupBridge.default ?? {};
  const setupContext = {
    documentName: ${encodedDocumentName},
    setupKind: ${encodedSetupKind},
  };
  const initializePreview = readSetupMember(setupModule, 'initializePreview');
  if (typeof initializePreview === 'function') {
    await initializePreview(setupContext);
  }

  const apolloBridge = await import(${encodedApolloSpecifier});
  const targetProps = await createTargetProps(setupModule, setupContext);
  const previewModule = await import(${encodedTargetSpecifier});
  const PreviewTarget = previewModule.default;
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
  let previewElement = ${encodedSetupKind} === 'storybook'
    ? React.createElement(StorybookPreviewRoot, {
        PreviewTarget,
        previewConfig,
        storyContext,
        targetProps,
      })
    : createTargetElement(PreviewTarget, targetProps);

  if (${encodedSetupKind} === 'storybook') {
    previewElement = applyStorybookParameterProviders(previewElement, parameters);
  }

  const PreviewProviders = readSetupMember(setupModule, 'PreviewProviders');
  if (PreviewProviders !== undefined && PreviewProviders !== null) {
    previewElement = React.createElement(PreviewProviders, setupContext, previewElement);
  }

  previewElement = apolloBridge.createApolloPreviewElement(previewElement, {
    configuration: readSetupMember(setupModule, 'apolloPreview'),
    ...setupContext,
  });

  createRoot(mountNode).render(
    React.createElement(PreviewErrorBoundary, undefined, previewElement),
  );
}

void mountPreview().catch(showRuntimeError);
`;
}
