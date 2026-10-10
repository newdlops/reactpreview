/** Verifies inert discovery of the Vite/CRA entry that owns a page root's global stylesheets. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  selectPreviewApplicationEntry,
  type PreviewApplicationEntry,
} from '../../../src/adapters/esbuild/previewApplicationEntrySelection';

const PROJECT_ROOT = path.resolve('/workspace/apps/web');
const APP_PATH = path.join(PROJECT_ROOT, 'src', 'App.tsx');

describe('selectPreviewApplicationEntry', () => {
  /** Follows the `index.html` module script before any conventional file name. */
  it('accepts the HTML module entry that imports the page root', async () => {
    const entryPath = path.join(PROJECT_ROOT, 'src', 'bootstrap.tsx');
    const entry = await selectEntry({
      [path.join(PROJECT_ROOT, 'index.html')]: [
        '<script src="https://cdn.example.com/analytics.js"></script>',
        '<script type="module" src="/src/bootstrap.tsx?v=1"></script>',
      ].join('\n'),
      [entryPath]:
        "import './index.css';\nimport App from './App';\ncreateRoot(root).render(<App />);",
      [path.join(PROJECT_ROOT, 'src', 'main.tsx')]: "import App from './App';",
    });

    expect(entry?.sourcePath).toBe(entryPath);
    expect(entry?.sourceText).toContain("import './index.css';");
  });

  /** Skips an entry of another application and falls back to conventional names. */
  it('rejects a candidate that does not import the page root', async () => {
    const otherEntry = path.join(PROJECT_ROOT, 'src', 'main.tsx');
    const conventionalEntry = path.join(PROJECT_ROOT, 'src', 'index.jsx');
    const entry = await selectEntry({
      [path.join(PROJECT_ROOT, 'index.html')]:
        '<script type="module" src="./src/main.tsx"></script>',
      [otherEntry]: "import './admin.css';\nimport Admin from './Admin';",
      [conventionalEntry]: "import './global.css';\nimport App from './App';",
    });

    expect(entry?.sourcePath).toBe(conventionalEntry);
  });

  /** Never treats the page root itself as its own entry and fails closed without proof. */
  it('returns undefined when no candidate imports the page root', async () => {
    const entry = await selectEntry({
      [path.join(PROJECT_ROOT, 'src', 'main.tsx')]: "import './index.css';",
      [path.join(PROJECT_ROOT, 'index.tsx')]: "import { App } from './lib/App';",
    });

    expect(entry).toBeUndefined();
    expect(
      await selectPreviewApplicationEntry({
        projectRoot: PROJECT_ROOT,
        readSource: () => Promise.resolve("import App from './App';"),
        resolveModule: () => APP_PATH,
        rootSourcePaths: [],
      }),
    ).toBeUndefined();
  });
});

/** Runs one lookup over an in-memory project whose only page root is `src/App.tsx`. */
function selectEntry(
  files: Readonly<Record<string, string>>,
): Promise<PreviewApplicationEntry | undefined> {
  const sourceByPath = new Map(
    Object.entries({ ...files, [APP_PATH]: 'export default function App() {}' }).map(
      ([sourcePath, text]) => [path.normalize(sourcePath), text],
    ),
  );
  return selectPreviewApplicationEntry({
    projectRoot: PROJECT_ROOT,
    readSource: ({ sourcePath }) => Promise.resolve(sourceByPath.get(path.normalize(sourcePath))),
    resolveModule: (moduleSpecifier, consumerPath) => {
      const base = path.resolve(path.dirname(consumerPath), moduleSpecifier);
      return ['', '.tsx', '.ts', '.jsx', '.js']
        .map((extension) => `${base}${extension}`)
        .find((candidate) => sourceByPath.has(candidate));
    },
    rootSourcePaths: [APP_PATH],
  });
}
