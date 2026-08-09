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
});
