/** Exercises generated composition with real React SSR and a single-branch Router test double. */
import { createRequire } from 'node:module';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createPreviewInspectorExecutionRootModuleContract } from '../../../../src/adapters/esbuild/inspector/previewInspectorExecutionRootModuleContract';
import { createPreviewInspectorPageExecutionSource } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionSource';
import type { PreviewInspectorPageExecutionCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionTypes';
import type { SelectedRouteMountFixture } from './previewInspectorSelectedRouteMountsFixtures';

// Path matching is already compiler-validated. This Router double renders the sole compiled branch
// and preserves Outlet nesting; it deliberately does not claim to test React Router's matcher.
const routerSource = `
  import React from 'react';
  const Child = React.createContext(null);
  export function MemoryRouter({ children }) { return children; }
  export function Route() { return null; }
  function routeChildren(children) { return React.Children.toArray(children).find(value => React.isValidElement(value) && value.type === Route); }
  function renderRoute(route) {
    if (!route) return null;
    return React.createElement(Child.Provider, { value: renderRoute(routeChildren(route.props.children)) }, route.props.element);
  }
  export function Routes({ children }) { return renderRoute(routeChildren(children)); }
  export function Outlet() { return React.useContext(Child); }
  export function useParams() { return { areaId: '1', id: '1' }; }
  export function useLocation() { return { pathname: '/root/1/detail/1/preview', search: '', hash: '' }; }
  export function useInRouterContext() { return true; }
`;

/** Renders only controlled generic surfaces, never the user project's authored modules. */
export async function renderSelectedRouteMounts(
  fixture: SelectedRouteMountFixture,
  candidate: PreviewInspectorPageExecutionCandidate,
): Promise<string> {
  if (candidate.routeRecipe?.kind !== 'react-router-v6') {
    throw new Error('The source fixture must prove its React Router generation.');
  }
  const root = candidate.executionRootContract;
  const source = createPreviewInspectorPageExecutionSource({
    candidate,
    executionRootModuleContract: createPreviewInspectorExecutionRootModuleContract({
      ...root,
      preparedSourceText: fixture.sourceByPath.get(root.sourcePath) ?? '',
    }),
    target: candidate.runtimeTargetContract,
  });
  const result = await build({
    stdin: {
      contents: source,
      sourcefile: 'generated-page-execution.mjs',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    external: ['react'],
    minifyWhitespace: true,
    legalComments: 'none',
    plugins: [
      {
        name: 'controlled-route-composition-surfaces',
        setup(build_) {
          build_.onResolve({ filter: /^react-router-dom$/ }, () => ({
            path: 'router',
            namespace: 'route-fixture',
          }));
          build_.onResolve({ filter: /^react-preview:inspector-target-facade$/ }, () => ({
            path: 'PreviewPage',
            namespace: 'route-fixture',
          }));
          build_.onResolve(
            { filter: /\/(?:RootApp|AreaApp|DetailApp|RootLayout)\.tsx$/ },
            ({ path: sourcePath }) => ({
              path: path.basename(sourcePath, '.tsx'),
              namespace: 'route-fixture',
            }),
          );
          build_.onResolve(
            { filter: /^fixture:(?:AreaApp|DetailApp|Context)$/ },
            ({ path: specifier }) => ({
              path: specifier.slice('fixture:'.length),
              namespace: 'route-fixture',
            }),
          );
          build_.onLoad({ filter: /.*/, namespace: 'route-fixture' }, ({ path: name }) => {
            if (name === 'router') return { contents: routerSource, loader: 'jsx' };
            if (name === 'Context')
              return {
                contents:
                  "import React from 'react'; export const Context = React.createContext(false);",
                loader: 'jsx',
              };
            // Factory owners render their own selected slots. Ordinary children or an enclosing Outlet
            // must not be used to inject the entire outer application back inside the inner owner.
            const body =
              name === 'RootApp'
                ? 'return <main data-root=""><AreaApp /></main>;'
                : name === 'AreaApp'
                  ? 'return <section data-area=""><DetailApp /></section>;'
                  : name === 'DetailApp'
                    ? 'return <Context.Provider value={true}><article data-detail=""><PreviewPage /></article></Context.Provider>;'
                    : 'if (!React.useContext(Context)) throw new Error("Selected page lost its authored Provider."); return <p data-leaf="">Selected page body</p>;';
            const childImport =
              name === 'RootApp'
                ? "import { AreaApp } from 'fixture:AreaApp';"
                : name === 'AreaApp'
                  ? "import { DetailApp } from 'fixture:DetailApp';"
                  : name === 'DetailApp'
                    ? "import { PreviewPage } from 'react-preview:inspector-target-facade';"
                    : '';
            return {
              loader: 'jsx',
              contents: `import React from 'react'; import { Context } from 'fixture:Context'; ${childImport} export function ${name}() { ${body} }`,
            };
          });
        },
      },
    ],
  });
  const module = { exports: {} as { default?: React.ComponentType } };
  runInNewContext(result.outputFiles[0]?.text ?? '', {
    module,
    exports: module.exports,
    require: createRequire(import.meta.url),
    console,
  });
  const Component = module.exports.default;
  if (Component === undefined) throw new Error('Generated execution did not export its root.');
  return renderToStaticMarkup(React.createElement(Component));
}
