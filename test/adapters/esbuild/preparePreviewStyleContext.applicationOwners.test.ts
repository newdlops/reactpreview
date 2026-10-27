/** Keeps theme, global CSS and fonts when fast page discovery stops below the app provider. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { preparePreviewStyleContext } from '../../../src/adapters/esbuild/preparePreviewStyleContext';
import type { PreviewStaticModuleResolver } from '../../../src/adapters/esbuild/previewStaticModuleResolver';

const ROOT = path.resolve('/workspace/client');
const PAGE = path.join(ROOT, 'src/product/Page.tsx');
const APP = path.join(ROOT, 'src/app.tsx');
const STYLE = path.join(ROOT, 'src/global-style.tsx');
const THEME = path.join(ROOT, 'src/theme.ts');

describe('fast page application style owners', () => {
  it('shares the entry proof across stylesheet, theme and global-style selection', async () => {
    const sourceText = 'export default function Page() { return <main />; }';
    const sources = new Map([
      [
        path.join(ROOT, 'src/index.tsx'),
        "const App = lazy(() => import('./app')); throw new Error('ENTRY_MUST_NOT_EXECUTE');",
      ],
      [
        APP,
        [
          "import Page from './product/Page';",
          "import { GlobalStyle } from './global-style';",
          "import { ThemeProvider } from 'styled-components';",
          "import { theme } from './theme';",
          "import './app.css';",
          'export default function App() { return <ThemeProvider theme={theme}><GlobalStyle /><Page /></ThemeProvider>; }',
        ].join('\n'),
      ],
      [
        STYLE,
        "import {createGlobalStyle} from 'styled-components'; import './reset.scss'; export const GlobalStyle=createGlobalStyle`html {font-size:62.5%}`;",
      ],
      [THEME, 'export const theme = {color:{text:"#123456"}};'],
      [PAGE, sourceText],
    ]);
    const resolve = (specifier: string, importer: string): string | undefined => {
      if (!specifier.startsWith('.') && !path.isAbsolute(specifier)) return undefined;
      const candidate = path.resolve(path.dirname(importer), specifier);
      return ['', '.tsx', '.ts']
        .map((extension) => candidate + extension)
        .find((file) => sources.has(file));
    };
    const resolver: PreviewStaticModuleResolver = {
      getJsxImportSource: () => undefined,
      getMatchedSpecifiers: () => [],
      matchesTarget: () => false,
      resolve,
      resolveMissingPathAliasCandidate: () => undefined,
      usesAlternativeJsxRuntime: () => false,
    };
    const context = await preparePreviewStyleContext({
      projectRoot: ROOT,
      workspaceRoot: ROOT,
      collectTailwindCandidates: false,
      inspectorDependencyPaths: [PAGE],
      portalHostDependencyPaths: [],
      readSource: ({ sourcePath }) => Promise.resolve(sources.get(sourcePath)),
      renderPath: {
        id: 'inner-page',
        steps: [
          {
            kind: 'value-flow',
            certainty: 'confirmed',
            label: 'Page',
            occurrenceStart: 0,
            sourcePath: PAGE,
            wrapperNames: [],
          },
        ],
      },
      request: {
        documentPath: PAGE,
        sourceText,
        workspaceRoot: ROOT,
        language: 'tsx',
        dependencySnapshots: [],
        preparationMode: 'fast',
        renderMode: 'page-inspector',
      },
      staticModuleResolver: resolver,
    });
    expect(context.themeImport).toEqual({ exportName: 'theme', moduleSpecifier: THEME });
    expect(context.applicationStyleDependencyPaths).toEqual([
      path.join(ROOT, 'src/index.tsx'),
      APP,
    ]);
    expect(context.globalStyleImports).toEqual([
      { exportName: 'GlobalStyle', moduleSpecifier: STYLE },
    ]);
    expect(context.applicationStylesheetImports).toEqual([
      { importerPath: APP, moduleSpecifier: './app.css' },
    ]);
  });
});
