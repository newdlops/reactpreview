/** Verifies bounded component-shape recovery through identifier-based HOC exports. */
import { describe, expect, it } from 'vitest';
import { isPreviewInspectorComponentShapedExport } from '../../../../src/adapters/esbuild/inspector/previewInspectorOwnerShape';

const SOURCE_PATH = '/workspace/src/DecoratedPage.tsx';

/** Creates the public classifier input for one conventional named export. */
function classify(sourceText: string, exportName = 'DecoratedPage'): boolean {
  return isPreviewInspectorComponentShapedExport({
    exportName,
    localName: exportName,
    sourcePath: SOURCE_PATH,
    sourceText,
  });
}

describe('isPreviewInspectorComponentShapedExport', () => {
  /** Follows local identifiers through multiple nested React HOC factories. */
  it('accepts memo and forwardRef around a same-file component identifier', () => {
    expect(
      classify(
        [
          "import { forwardRef, memo } from 'react';",
          'const InnerPage = () => <main />;',
          'export const DecoratedPage = memo(forwardRef(InnerPage));',
        ].join('\n'),
      ),
    ).toBe(true);
  });

  /** Admits a conventional imported component passed through a project-defined HOC. */
  it('accepts an imported PascalCase component wrapped by a project HOC', () => {
    expect(
      classify(
        [
          "import { InnerPage } from './InnerPage';",
          'const withSession = (Component) => Component;',
          'export const DecoratedPage = withSession(InnerPage);',
        ].join('\n'),
      ),
    ).toBe(true);
  });

  /** Keeps configuration factories closed when no component-shaped argument can be proven. */
  it('rejects arbitrary configuration identifiers passed to a factory', () => {
    expect(
      classify(
        [
          'const RouteConfig = { path: "/" };',
          'const createRoute = (config) => config;',
          'export const DecoratedPage = createRoute(RouteConfig);',
        ].join('\n'),
      ),
    ).toBe(false);
  });

  /** Does not promote an imported PascalCase route/data value merely because its name is capitalized. */
  it('rejects an imported configuration identifier passed to a non-HOC factory', () => {
    expect(
      classify(
        [
          "import { RouteConfig } from './routes';",
          'const createRouter = (config) => config;',
          'export const DecoratedPage = createRouter(RouteConfig);',
        ].join('\n'),
      ),
    ).toBe(false);
  });
});
