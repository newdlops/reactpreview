/** Verifies discovery of web-font links that app-shell wrappers inject at runtime. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectPreviewApplicationStylesheetLinks } from '../../../src/adapters/esbuild/previewApplicationStylesheetLinks';
import { mergePreviewDocumentShellStylesheetLinks } from '../../../src/adapters/esbuild/previewDocumentShell';

const ROOT = path.resolve('/workspace/client/src');
const APP_PATH = path.join(ROOT, 'app', 'app.tsx');
const PROVIDER_PATH = path.join(ROOT, 'theme', 'theme-provider.tsx');
const PRETENDARD =
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css';

describe('collectPreviewApplicationStylesheetLinks', () => {
  /** Follows providers composed through helpers such as recompose `nest`, two imports deep. */
  it('finds a link in a provider composed by an app base module', async () => {
    const appBasePath = path.join(ROOT, 'app', 'app-base.ts');
    const sources = new Map([
      [APP_PATH, "import { AppBase } from './app-base';\nexport const App = AppBase;"],
      [
        appBasePath,
        [
          "import { nest } from 'recompose';",
          "import { ThemeProvider } from '../theme/theme-provider';",
          'export const AppBase = nest(ThemeProvider);',
        ].join('\n'),
      ],
      [
        PROVIDER_PATH,
        `export const ThemeProvider = () => <link rel="stylesheet" href="${PRETENDARD}" />;`,
      ],
    ]);

    const found = await collectPreviewApplicationStylesheetLinks({
      readSource: ({ sourcePath }) => Promise.resolve(sources.get(path.normalize(sourcePath))),
      resolveModule: (moduleSpecifier, consumerPath) => {
        const base = path.resolve(path.dirname(consumerPath), moduleSpecifier);
        return [`${base}.tsx`, `${base}.ts`].find((candidate) => sources.has(candidate));
      },
      rootSourcePaths: [path.join(ROOT, 'pages', 'page.tsx'), APP_PATH],
    });

    expect(found?.links).toEqual([PRETENDARD]);
  });

  /** Follows the provider an app module renders and reads its Helmet link literal. */
  it('collects HTTPS stylesheet links from rendered wrapper components', async () => {
    const sources = new Map([
      [
        APP_PATH,
        [
          "import { ThemeProvider } from '../theme/theme-provider';",
          "import { helper } from '../theme/helper';",
          'export function App() { return <ThemeProvider>{helper()}</ThemeProvider>; }',
        ].join('\n'),
      ],
      [
        PROVIDER_PATH,
        [
          "import { Helmet } from 'react-helmet';",
          'export const ThemeProvider = ({ children }) => (',
          '  <>',
          '    <Helmet>',
          `      <link rel="stylesheet" as="style" crossOrigin="anonymous" href="${PRETENDARD}" />`,
          '      <link rel="icon" href="https://cdn.example.com/favicon.ico" />',
          '      <link rel="stylesheet" href={`https://cdn.example.com/${"x"}.css`} />',
          '    </Helmet>',
          '    {children}',
          '  </>',
          ');',
        ].join('\n'),
      ],
      [
        path.join(ROOT, 'theme', 'helper.ts'),
        '<link rel="stylesheet" href="https://never.test/a.css" />',
      ],
    ]);

    const found = await collectPreviewApplicationStylesheetLinks({
      readSource: ({ sourcePath }) => Promise.resolve(sources.get(path.normalize(sourcePath))),
      resolveModule: (moduleSpecifier, consumerPath) => {
        const base = path.resolve(path.dirname(consumerPath), moduleSpecifier);
        return [`${base}.tsx`, `${base}.ts`].find((candidate) => sources.has(candidate));
      },
      rootSourcePaths: [APP_PATH],
    });

    expect(found).toEqual({ dependencyPath: PROVIDER_PATH, links: [PRETENDARD] });
    expect(
      mergePreviewDocumentShellStylesheetLinks(
        {
          dependencyPath: '/workspace/client/index.html',
          shell: {
            bodyAttributes: [],
            htmlAttributes: [{ name: 'lang', value: 'ko' }],
            rootAttributes: [],
          },
        },
        found,
      ),
    ).toEqual({
      dependencyPath: '/workspace/client/index.html',
      shell: {
        bodyAttributes: [],
        htmlAttributes: [{ name: 'lang', value: 'ko' }],
        rootAttributes: [],
        stylesheetLinks: [PRETENDARD],
      },
    });
  });
});
