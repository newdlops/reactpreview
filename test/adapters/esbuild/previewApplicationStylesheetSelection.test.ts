/** Verifies bounded application-root CSS recovery without evaluating framework entry modules. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { selectPreviewApplicationStylesheetImports } from '../../../src/adapters/esbuild/previewApplicationStylesheetSelection';

const PROJECT_ROOT = path.resolve('/workspace/apps/web');

describe('selectPreviewApplicationStylesheetImports', () => {
  /** Keeps authored cascade order and ignores value-bearing or unsupported style imports. */
  it('selects side-effect CSS and Sass from the first conventional Next application root', async () => {
    const appLayoutPath = path.join(PROJECT_ROOT, 'app', 'layout.tsx');
    const pagesAppPath = path.join(PROJECT_ROOT, 'pages', '_app.tsx');
    const sourceByPath = new Map([
      [
        appLayoutPath,
        [
          "import type { Metadata } from 'next';",
          "import '@/app/globals.css';",
          "import './tokens.scss';",
          "import styles from './layout.module.css';",
          "import './legacy.less';",
          'export default function Layout({ children }) { return children; }',
        ].join('\n'),
      ],
      [pagesAppPath, "import './pages-only.css'; export default function App() {}"],
    ]);

    const selections = await selectPreviewApplicationStylesheetImports({
      projectRoot: PROJECT_ROOT,
      readSource: ({ sourcePath }) => Promise.resolve(sourceByPath.get(path.normalize(sourcePath))),
    });

    expect(selections).toEqual([
      { importerPath: appLayoutPath, moduleSpecifier: '@/app/globals.css' },
      { importerPath: appLayoutPath, moduleSpecifier: './tokens.scss' },
    ]);
  });

  /** Fails closed while a root layout contains parser-recovered incomplete source. */
  it('does not select partial imports from a malformed application root', async () => {
    const appLayoutPath = path.join(PROJECT_ROOT, 'src', 'app', 'layout.jsx');

    const selections = await selectPreviewApplicationStylesheetImports({
      projectRoot: PROJECT_ROOT,
      readSource: ({ sourcePath }) =>
        Promise.resolve(
          path.normalize(sourcePath) === appLayoutPath
            ? "import './globals.css'; export default function Layout("
            : undefined,
        ),
    });

    expect(selections).toEqual([]);
  });

  /** Recovers global font CSS from an exact non-Next React application wrapper. */
  it('selects side-effect CSS from a proven target-to-entry render path', async () => {
    const entryPath = path.join(PROJECT_ROOT, 'src', 'index.jsx');
    const appPath = path.join(PROJECT_ROOT, 'src', 'App', 'index.jsx');
    const boardPath = path.join(PROJECT_ROOT, 'src', 'Board', 'index.jsx');
    const sourceByPath = new Map([
      [entryPath, "import App from './App'; render(<App />);"],
      [
        appPath,
        [
          "import Routes from './Routes';",
          "import './fontStyles.css';",
          'export default function App() { return <Routes />; }',
        ].join('\n'),
      ],
      [boardPath, 'export default function Board() { return <main />; }'],
    ]);

    const selections = await selectPreviewApplicationStylesheetImports({
      projectRoot: PROJECT_ROOT,
      readSource: ({ sourcePath }) => Promise.resolve(sourceByPath.get(path.normalize(sourcePath))),
      renderPath: {
        entryPoint: {
          kind: 'legacy-render',
          occurrenceStart: 24,
          sourcePath: entryPath,
          wrapperNames: [],
        },
        id: 'board-to-entry',
        steps: [
          {
            certainty: 'confirmed',
            kind: 'component-render',
            label: 'Board',
            occurrenceStart: 0,
            sourcePath: boardPath,
            wrapperNames: [],
          },
          {
            certainty: 'confirmed',
            kind: 'entry-render',
            label: 'App',
            occurrenceStart: 42,
            sourcePath: appPath,
            wrapperNames: ['App'],
          },
        ],
      },
    });

    expect(selections).toEqual([{ importerPath: appPath, moduleSpecifier: './fontStyles.css' }]);
  });

  /** Loads Vite entry CSS (Tailwind layers, tokens) ahead of the page-root wrapper CSS. */
  it('selects entry CSS first when the render path ends at an unexecuted Vite entry', async () => {
    const htmlPath = path.join(PROJECT_ROOT, 'index.html');
    const entryPath = path.join(PROJECT_ROOT, 'src', 'main.tsx');
    const appPath = path.join(PROJECT_ROOT, 'src', 'App.tsx');
    const pagePath = path.join(PROJECT_ROOT, 'src', 'pages', 'Dashboard.tsx');
    const sourceByPath = new Map([
      [htmlPath, '<script type="module" src="/src/main.tsx"></script>'],
      [entryPath, "import './index.css';\nimport App from './App';\nrender(<App />);"],
      [appPath, "import './app.css';\nexport default function App() { return <Dashboard />; }"],
      [pagePath, 'export default function Dashboard() { return <main />; }'],
    ]);

    const selections = await selectPreviewApplicationStylesheetImports({
      projectRoot: PROJECT_ROOT,
      readSource: ({ sourcePath }) => Promise.resolve(sourceByPath.get(path.normalize(sourcePath))),
      renderPath: {
        id: 'dashboard-to-app',
        steps: [
          {
            certainty: 'confirmed',
            kind: 'component-render',
            label: 'Dashboard',
            occurrenceStart: 0,
            sourcePath: pagePath,
            wrapperNames: [],
          },
          {
            certainty: 'confirmed',
            kind: 'component-render',
            label: 'App',
            occurrenceStart: 0,
            sourcePath: appPath,
            wrapperNames: ['App'],
          },
        ],
      },
      resolveModule: (moduleSpecifier, consumerPath) =>
        moduleSpecifier === './App' && consumerPath === entryPath ? appPath : undefined,
    });

    expect(selections).toEqual([
      { importerPath: entryPath, moduleSpecifier: './index.css' },
      { importerPath: appPath, moduleSpecifier: './app.css' },
    ]);
  });
});
