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
    expect(entry).toContain('await import("react-preview:apollo")');
    expect(entry).toContain('await import("react-preview:context")');
    expect(entry).toContain('await import("react-preview:formik")');
    expect(entry).toContain('await import("react-preview:redux")');
    expect(entry).toContain('await import("react-preview:router")');
    expect(entry).toContain('await import("react-preview:theme")');
    expect(entry).toContain('import("react-preview:target")');
    expect(entry).toContain(
      'const previewBrowserProcessStatus = initializePreviewBrowserProcess()',
    );
    expect(entry.indexOf('const previewBrowserProcessStatus =')).toBeLessThan(
      entry.indexOf('await import("react-preview:setup")'),
    );
    expect(entry.indexOf('await import("react-preview:setup")')).toBeLessThan(
      entry.indexOf('await import("react-preview:target")'),
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
    expect(entry).toContain("enterRuntimePhase('load and evaluate target module graph')");
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
    expect(entry).toContain('reduxBridge.createReduxPreviewElement');
    expect(entry).toContain("readSetupMember(setupModule, 'reduxPreview')");
    expect(entry).toContain('routerBridge.createRouterPreviewElement');
    expect(entry).toContain("readSetupMember(setupModule, 'routerPreview')");
    expect(entry).toContain('PreviewExportGallery');
    expect(entry).toContain('PreviewExportErrorBoundary');
    expect(entry).toContain('React.createElement(React.Suspense, { fallback: null }, rendered)');
    expect(entry).toContain("readSetupMember(setupModule, 'previewPropsByExport')");
    expect(entry).toContain('createPreviewPropsFromLayers(');
    expect(entry).toContain('descriptor.inferredPropShape');
    expect(entry).toContain('descriptor.automaticProps');
    expect(entry).toContain('descriptor.parentSlice');
    expect(entry).toContain('Parent render slice: ');
    expect(entry).toContain('react-preview-export-label');
    expect(entry).toContain('Export: ');
    expect(entry).toContain("replacePreviewRuntimeListener('unhandledrejection'");
    expect(entry).toContain('await import(message.scriptUri)');
    expect(entry).toContain('await bootstrapPromise');
    expect(entry).toContain('previewHotRuntime.bootstrapPromise = previewBootstrapPromise');
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
