/**
 * Verifies virtual-entry generation independently from the heavier real esbuild integration test.
 */
import { describe, expect, it } from 'vitest';
import { createPreviewEntry } from '../../../src/adapters/esbuild/createPreviewEntry';

describe('createPreviewEntry', () => {
  /** Uses project React and loads setup before the selected module's tree-shaken export. */
  it('creates a browser entry for the selected component', () => {
    const entry = createPreviewEntry({
      documentName: 'src/Preview.tsx',
      globalNamespaces: ['ZUZU'],
      setupKind: 'storybook',
    });

    expect(entry).toContain("import * as React from 'react'");
    expect(entry).toContain("import { createRoot } from 'react-dom/client'");
    expect(entry).toContain('await import("react-preview:setup")');
    expect(entry).toContain('await import("react-preview:apollo")');
    expect(entry).toContain('await import("react-preview:redux")');
    expect(entry).toContain('await import("react-preview:theme")');
    expect(entry).toContain('import("react-preview:target")');
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
    expect(entry).toContain('apolloBridge.createApolloPreviewElement');
    expect(entry).toContain("readSetupMember(setupModule, 'apolloPreview')");
    expect(entry).toContain('themeBridge.createThemePreviewElement');
    expect(entry).toContain("readSetupMember(setupModule, 'themePreview')");
    expect(entry).toContain('reduxBridge.createReduxPreviewElement');
    expect(entry).toContain("readSetupMember(setupModule, 'reduxPreview')");
    expect(entry).toContain("window.addEventListener('unhandledrejection'");
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
