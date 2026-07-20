/**
 * Verifies virtual-entry generation independently from the heavier real esbuild integration test.
 */
import { describe, expect, it } from 'vitest';
import { createPreviewEntry } from '../../../src/adapters/esbuild/createPreviewEntry';

describe('createPreviewEntry', () => {
  /** Uses project React and loads setup before the source-ordered component gallery. */
  it('creates a browser entry for sequential component exports', () => {
    const entry = createPreviewEntry({
      documentName: 'src/Preview.tsx',
      globalNamespaces: ['ZUZU'],
      setupKind: 'storybook',
    });

    expect(entry).toContain("import * as React from 'react'");
    expect(entry).toContain("import { createRoot } from 'react-dom/client'");
    expect(entry).toContain('await import("react-preview:setup")');
    expect(entry).toContain('import("react-preview:apollo")');
    expect(entry).toContain('import("react-preview:context")');
    expect(entry).toContain('import("react-preview:formik")');
    expect(entry).toContain('import("react-preview:redux")');
    expect(entry).toContain('import("react-preview:router")');
    expect(entry).toContain('import("react-preview:theme")');
    expect(entry).toContain('] = await Promise.all([');
    expect(entry).toContain('import("react-preview:target")');
    expect(entry).toContain(
      'const previewBrowserProcessStatus = initializePreviewBrowserProcess()',
    );
    expect(entry).toContain("document.querySelector?.('[data-react-preview-mount]')");
    expect(entry).toContain('initializePreviewDocumentShell(mountNode)');
    expect(entry.indexOf('const previewBrowserProcessStatus =')).toBeLessThan(
      entry.indexOf('await import("react-preview:setup")'),
    );
    expect(entry.indexOf('await import("react-preview:setup")')).toBeLessThan(
      entry.indexOf('import("react-preview:target")'),
    );
    expect(entry).toContain('["ZUZU"]');
    expect(entry).toContain('applyStorybookDecorators');
    expect(entry).toContain('applyStorybookParameterProviders');
    expect(entry).toContain('React.createElement(StorybookPreviewRoot');
    expect(entry).toContain("readSetupMember(setupModule, 'decorators')");
    expect(entry).toContain('mergeStoryContext');
    expect(entry).toContain('...(Array.isArray(globalMocks) ? globalMocks : [])');
    expect(entry).toContain('findGlobalPropertyDescriptor');
    expect(entry).toContain('"storybook" !== \'none\' && globalThis.global === undefined');
    expect(entry).toContain('PreviewErrorBoundary');
    expect(entry).toContain('runtimeDiagnosticRules');
    expect(entry).toContain('React Redux provider required');
    expect(entry).toContain('Project runtime setup required');
    expect(entry).toContain('MAX_RUNTIME_ERROR_DETAILS = 12000');
    expect(entry).toContain('Failure context:');
    expect(entry).toContain('Automatic runtime boundaries:');
    expect(entry).toContain('Node I/O remains unavailable');
    expect(entry).toContain('React component stack:');
    expect(entry).toContain('componentDidCatch(error, errorInfo)');
    expect(entry).toContain('onUncaughtError(error, errorInfo)');
    expect(entry).toContain('onCaughtError(error)');
    expect(entry).toContain('onRecoverableError(error, errorInfo)');
    expect(entry).toContain(
      "enterRuntimePhase('load automatic runtime bridges, props, and target graph')",
    );
    expect(entry).toContain('Apollo invariant payload (decoded locally):');
    expect(entry).toContain('apolloBridge.createApolloPreviewElement');
    expect(entry).toContain('contextBridge.createContextPreviewElement');
    expect(entry).toContain("registerPreviewRuntimeCapability('Context', contextBridge)");
    expect(entry).toContain("readSetupMember(setupModule, 'apolloPreview')");
    expect(entry).toContain('formikBridge.createFormikPreviewElement');
    expect(entry).toContain("readSetupMember(setupModule, 'formikPreview')");
    expect(entry).toContain('themeBridge.createThemePreviewElement');
    expect(entry).toContain('await themeBridge.resolvePreviewTheme');
    expect(entry).toContain("readSetupMember(setupModule, 'themePreview')");
    expect(entry).toContain('discoveredTheme: previewModule.previewTheme');
    expect(entry).toContain('createPreviewGlobalStyleElement(');
    expect(entry).toContain('previewModule.previewGlobalStyles');
    expect(entry).toContain('reduxBridge.createReduxPreviewElement');
    expect(entry).toContain("readSetupMember(setupModule, 'reduxPreview')");
    expect(entry).toContain('routerBridge.createRouterPreviewElement');
    expect(entry).toContain("readSetupMember(setupModule, 'routerPreview')");
    expect(entry).toContain('PreviewExportGallery');
    expect(entry).toContain('selectReactLikePreviewDescriptors(previewModule.default)');
    expect(entry).toContain('isReactLikePreviewValue(descriptor?.value)');
    expect(entry).toContain('PreviewExportErrorBoundary');
    expect(entry).toContain('React.createElement(React.Suspense, { fallback: suspenseFallback }');
    expect(entry).toContain("className: 'react-preview-suspense-placeholder'");
    expect(entry).toContain('React.createElement(PreviewRenderedCommitSignal)');
    expect(entry).toContain('const previewPreparationPromise = preparePreviewElement()');
    expect(entry).toContain('React.createElement(\n    React.Fragment,');
    expect(entry).not.toContain(
      'React.createElement(\n    React.Suspense,\n    { fallback: null }',
    );
    expect(entry).toContain("readSetupMember(setupModule, 'previewPropsByExport')");
    expect(entry).toContain('createPreviewPropsFromLayers(');
    expect(entry).toContain('descriptor.inferredPropShape');
    expect(entry).toContain('descriptor.automaticProps');
    expect(entry).toContain('descriptor.parentSlice');
    expect(entry).toContain('Parent render slice: ');
    expect(entry).toContain('react-preview-export-label');
    expect(entry).toContain('Export: ');
    expect(entry).toContain("replacePreviewRuntimeListener('unhandledrejection'");
    expect(entry).toContain('const PREVIEW_PROGRESS_MESSAGE_TYPE = "react-preview-progress"');
    expect(entry).toContain("host.attachShadow({ mode: 'open' })");
    expect(entry).toContain('message.revision < currentRevision');
    expect(entry).toContain('updatePreviewProgressRuntimeDetail(phase)');
    expect(entry).not.toContain('.innerHTML');
    expect(entry).toContain('const importedEntryPromise = import(message.scriptUri)');
    expect(entry).toContain('await preparedEntry.preparationPromise');
    expect(entry).toContain('await preparedEntry.activate()');
    expect(entry).toContain('previewHotRuntime.bootstrapPromise = previewBootstrapPromise');
  });

  /** Preloads replacement resources before unmounting and admits content-addressed root entries. */
  it('creates a low-blank-time content-addressed hot reload path', () => {
    const entry = createPreviewEntry({
      documentName: 'Preview.tsx',
      globalNamespaces: [],
      setupKind: 'none',
    });

    const preparationIndex = entry.indexOf('await preparedEntry.preparationPromise');
    const unmountIndex = entry.indexOf('previewHotRuntime.root.unmount()', preparationIndex);

    expect(preparationIndex).toBeGreaterThan(-1);
    expect(unmountIndex).toBeGreaterThan(preparationIndex);
    expect(entry).toContain("preloadLink.rel = 'modulepreload'");
    expect(entry).toContain("nextLink.media = 'not all'");
    expect(entry).toContain("nextLink.media = 'all'");
    expect(entry).toContain('/^entry-[0-9a-f]{64}\\.js$/');
    expect(entry).toContain('/^styles\\/[0-9a-f]{64}\\.css$/');
    expect(entry).toContain('candidate.origin !== session.origin');
    expect(entry).toContain("candidate.hash !== ''");
    expect(entry).toContain('candidate.pathname.startsWith(session.directory)');
    expect(entry).toContain("getAll('reactPreviewRevision')");
    expect(entry).toContain("getAll('reactPreviewArtifact')");
    expect(entry).toContain('entryIdentity.revision !== revision');
    expect(entry).toContain('React Preview retained the previous render after preparation failed.');
    expect(entry).toContain('retainedPrevious: !replacementStarted');
    expect(entry).toContain('revision: message.revision');
    expect(entry).toContain('applied: outcome.applied');
    expect(entry).not.toContain("scriptUri.endsWith('/entry.js')");
  });

  /** Rejects stylesheet preload failures and preserves committed DOM for later global errors. */
  it('contains style failures and post-commit runtime errors without destroying the mounted tree', () => {
    const entry = createPreviewEntry({
      documentName: 'Preview.tsx',
      globalNamespaces: [],
      setupKind: 'none',
    });

    expect(entry).toContain('could not preload the replacement stylesheet');
    expect(entry).toContain('new Promise((resolve, reject) =>');
    expect(entry).toContain('previewCommitCompleted ||');
    expect(entry).toContain('React Preview retained the mounted revision after a runtime error.');
    expect(entry).toContain("completePreviewCommit('failed')");
    expect(entry).toContain('resolvePreviewCommit(outcome)');
    expect(entry).toContain('could not retire stale lazy stylesheets');
  });

  /** Prevents a recoverable first nested-Router attempt from becoming a failed hot revision. */
  it('defers nested Router browser events to the Inspector candidate retry boundary', () => {
    const entry = createPreviewEntry({
      documentName: 'AppRouter.tsx',
      globalNamespaces: [],
      renderMode: 'page-inspector',
      setupKind: 'none',
    });

    expect(entry).toContain(
      'activePreviewRouterBridge?.isNestedPreviewRouterError?.(event.error ?? event.message) === true',
    );
  });

  /** Drops superseded preparation before it can unmount the currently displayed revision. */
  it('guards asynchronous hot preparation with the latest revision and token', () => {
    const entry = createPreviewEntry({
      documentName: 'Preview.tsx',
      globalNamespaces: [],
      setupKind: 'none',
    });

    const finalGuard = entry.lastIndexOf('if (!isLatestHotReloadRequest(message))');
    const unmount = entry.indexOf('previewHotRuntime.root.unmount()', finalGuard);
    expect(finalGuard).toBeGreaterThan(-1);
    expect(unmount).toBeGreaterThan(finalGuard);
    expect(entry).toContain('latest.token === message.token');
    expect(entry).toContain('latest.requestSequence === message.requestSequence');
    expect(entry).toContain('stale: true');
    expect(entry).toContain('reloadOutcomeByToken');
  });

  /** Keeps filesystem paths out of the runtime entry behind the private target bridge. */
  it('does not expose a workspace path in generated runtime source', () => {
    const entry = createPreviewEntry({
      documentName: 'Preview.tsx',
      globalNamespaces: [],
      setupKind: 'none',
    });

    expect(entry).not.toContain('/workspace/');
    expect(entry).toContain('"none" !== \'none\' && globalThis.global === undefined');
  });

  /** Encodes titles as data and keeps custom initialize, provider, and props hooks optional. */
  it('creates a custom project setup contract without Storybook execution', () => {
    const entry = createPreviewEntry({
      documentName: 'src/Quoted "Preview".tsx',
      globalNamespaces: [],
      setupKind: 'custom',
    });

    expect(entry).toContain('initializePreview');
    expect(entry).toContain('PreviewProviders');
    expect(entry).toContain('createPreviewProps');
    expect(entry).toContain('src/Quoted \\"Preview\\".tsx');
    expect(entry).toContain('"custom" === \'storybook\'');
  });
});
