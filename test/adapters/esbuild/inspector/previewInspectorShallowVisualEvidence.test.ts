/**
 * Verifies exact-owner shallow visual evidence, lazy/HOC transport, and project-first admission.
 */
import { describe, expect, it } from 'vitest';
import { collectPreviewInspectorOneHopContext } from '../../../../src/adapters/esbuild/inspector/previewInspectorOneHopContext';
import { collectPreviewInspectorShallowVisualEvidence } from '../../../../src/adapters/esbuild/inspector/previewInspectorShallowVisualEvidence';

/** Creates a deterministic resolver from authored spelling to absolute fixture identity. */
function createResolver(pathsBySpecifier: Readonly<Record<string, string>>) {
  return (moduleSpecifier: string): string | undefined => pathsBySpecifier[moduleSpecifier];
}

describe('collectPreviewInspectorShallowVisualEvidence', () => {
  it('keeps only siblings from the selected owner export and exact render outcome', () => {
    const importerPath = '/workspace/Page.tsx';
    const sourceText = [
      "import Target from './Target';",
      "import Header from './Header';",
      "import StoryTools from './StoryTools';",
      'export const Story = () => <><StoryTools /><Target /></>;',
      'export default function Page({ ready }) {',
      '  if (!ready) return <p>Waiting</p>;',
      '  return <><Header /><Target /></>;',
      '}',
    ].join('\n');

    const evidence = collectPreviewInspectorShallowVisualEvidence({
      importerPath,
      ownerExportName: 'default',
      resolveModule: createResolver({
        './Header': '/workspace/Header.tsx',
        './StoryTools': '/workspace/StoryTools.tsx',
        './Target': '/workspace/Target.tsx',
      }),
      selectedChildPath: '/workspace/Target.tsx',
      sourceText,
    });

    expect(evidence.paths.map((visualPath) => visualPath.sourcePath)).toEqual([
      '/workspace/Header.tsx',
    ]);
    expect(evidence.paths[0]).toMatchObject({
      exportName: 'default',
      importerPath,
      importKind: 'static',
      moduleSpecifier: './Header',
      relation: 'sibling',
      renderedLocalName: 'Header',
      selectedChildPath: '/workspace/Target.tsx',
    });
  });

  it('resolves React.lazy siblings and bounded memo/styled aliases to import demand', () => {
    const sourceText = [
      "import { lazy, memo } from 'react';",
      "import styled from '@emotion/styled';",
      "import HeaderBase from './Header';",
      "const Target = lazy(() => import('./Target'));",
      "const LazyBadge = lazy(() => import('./Badge'));",
      'const MemoHeader = memo(HeaderBase);',
      'const StyledHeader = styled(MemoHeader);',
      'export default function Page() {',
      '  return <><StyledHeader /><LazyBadge /><Target /></>;',
      '}',
    ].join('\n');

    const evidence = collectPreviewInspectorShallowVisualEvidence({
      importerPath: '/workspace/Page.tsx',
      ownerExportName: 'default',
      resolveModule: createResolver({
        './Badge': '/workspace/Badge.tsx',
        './Header': '/workspace/Header.tsx',
        './Target': '/workspace/Target.tsx',
      }),
      selectedChildPath: '/workspace/Target.tsx',
      sourceText,
    });

    const header = evidence.paths.find(
      (visualPath) => visualPath.sourcePath === '/workspace/Header.tsx',
    );
    const badge = evidence.paths.find(
      (visualPath) => visualPath.sourcePath === '/workspace/Badge.tsx',
    );
    expect(header).toMatchObject({
      importKind: 'static',
      renderedLocalName: 'StyledHeader',
    });
    expect(header?.localEdges.map((edge) => edge.kind)).toEqual(['memo', 'styled']);
    expect(badge).toMatchObject({
      exportName: 'default',
      importKind: 'react-lazy',
      moduleSpecifier: './Badge',
      renderedLocalName: 'LazyBadge',
    });
  });

  it('retains component-valued prop evidence beside a selected component prop', () => {
    const sourceText = [
      "import Frame from './Frame';",
      "import Target from './Target';",
      "import Header from './Header';",
      'export default function Page() {',
      '  return <Frame component={Target} headerComponent={Header} />;',
      '}',
    ].join('\n');

    const evidence = collectPreviewInspectorShallowVisualEvidence({
      importerPath: '/workspace/Page.tsx',
      ownerExportName: 'default',
      resolveModule: createResolver({
        './Frame': '/workspace/Frame.tsx',
        './Header': '/workspace/Header.tsx',
        './Target': '/workspace/Target.tsx',
      }),
      selectedChildPath: '/workspace/Target.tsx',
      sourceText,
    });

    expect(
      evidence.paths.find((visualPath) => visualPath.sourcePath === '/workspace/Header.tsx'),
    ).toMatchObject({
      relation: 'component-prop',
      renderedLocalName: 'Header',
    });
  });

  /**
   * Keeps route calculations executable while projecting only component-shaped route elements.
   *
   * Route factories commonly read path maps beside JSX element declarations. Those data helpers
   * share a render-graph owner with the selected page but must keep returning strings and objects;
   * replacing them with a shallow React placeholder breaks the router before any page can mount.
   */
  it('excludes lowercase route helpers that share a route factory with the selected page', () => {
    const sourceText = [
      "import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider } from 'react-router-dom';",
      "import { getPagePath, pageNamePathMap } from './route-config';",
      "import PageLayout from './PageLayout';",
      "import TargetPage from './TargetPage';",
      'const router = createBrowserRouter(createRoutesFromElements(',
      '  <Route',
      '    path={getPagePath(pageNamePathMap.TargetPage)}',
      '    element={<PageLayout><TargetPage /></PageLayout>}',
      '  />',
      '));',
      'export default function App() { return <RouterProvider router={router} />; }',
    ].join('\n');

    const evidence = collectPreviewInspectorShallowVisualEvidence({
      importerPath: '/workspace/App.tsx',
      ownerExportName: 'default',
      resolveModule: createResolver({
        './PageLayout': '/workspace/PageLayout.tsx',
        './TargetPage': '/workspace/TargetPage.tsx',
        './route-config': '/workspace/route-config.ts',
      }),
      selectedChildPath: '/workspace/TargetPage.tsx',
      sourceText,
    });

    expect(evidence.paths.map((visualPath) => visualPath.sourcePath)).toContain(
      '/workspace/PageLayout.tsx',
    );
    expect(evidence.paths.map((visualPath) => visualPath.sourcePath)).not.toContain(
      '/workspace/route-config.ts',
    );
  });

  it('admits project siblings before applying raw and per-step caps to external JSX imports', async () => {
    const appPath = '/workspace/App.tsx';
    const targetPath = '/workspace/Target.tsx';
    const headerPath = '/workspace/Header.tsx';
    const externalCount = 600;
    const sourceText = [
      ...Array.from(
        { length: externalCount },
        (_, index) => `import External${index.toString()} from 'external-${index.toString()}';`,
      ),
      "import Header from './Header';",
      "import Target from './Target';",
      'export default function App() { return <>',
      ...Array.from({ length: externalCount }, (_, index) => `<External${index.toString()} />`),
      '<Header /><Target />',
      '</>; }',
    ].join('\n');
    const resolver = (moduleSpecifier: string): string | undefined => {
      if (moduleSpecifier === './Header') return headerPath;
      if (moduleSpecifier === './Target') return targetPath;
      return moduleSpecifier.startsWith('external-')
        ? `/workspace/node_modules/${moduleSpecifier}/index.js`
        : undefined;
    };

    const context = await collectPreviewInspectorOneHopContext({
      importPath: [appPath, targetPath],
      maximumFiles: 48,
      readSource: (sourcePath) =>
        Promise.resolve(
          sourcePath === appPath ? sourceText : 'export default function Target() {}',
        ),
      resolveModule: resolver,
      workspaceRoot: '/workspace',
    });

    expect(context.sourcePaths).toContain(headerPath);
    expect(
      context.shallowVisualPaths.some((visualPath) => visualPath.sourcePath === headerPath),
    ).toBe(true);
    expect(context.truncated).toBe(true);
  });
});
