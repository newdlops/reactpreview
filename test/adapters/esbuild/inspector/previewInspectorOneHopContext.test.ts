/**
 * Verifies fair one-hop JSX context reservation around the fast entry-to-target corridor.
 *
 * Fixtures deliberately use ordinary `.ts` component modules outside page/layout directories so
 * the legacy filename-oriented subtree walk cannot accidentally satisfy the integration assertion.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectPreviewInspectorFastPageCorridor } from '../../../../src/adapters/esbuild/inspector/previewInspectorFastPageCorridor';
import { collectPreviewInspectorOneHopContext } from '../../../../src/adapters/esbuild/inspector/previewInspectorOneHopContext';

const temporaryRoots: string[] = [];

/** Removes every disk fixture even when an assertion aborts its test early. */
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

/** Resolves exact fixture-relative source imports without package-manager behavior. */
function createFixtureResolver(sourcePaths: readonly string[]) {
  const knownPaths = new Set(sourcePaths.map((sourcePath) => path.normalize(sourcePath)));
  return (specifier: string, importerPath: string): string | undefined => {
    if (!specifier.startsWith('.')) return undefined;
    const candidate = path.resolve(path.dirname(importerPath), specifier);
    return [candidate, `${candidate}.tsx`, `${candidate}.ts`]
      .map((sourcePath) => path.normalize(sourcePath))
      .find((sourcePath) => knownPaths.has(sourcePath));
  };
}

/** Writes one authored fixture and returns its absolute normalized source identity. */
async function writeSource(
  rootPath: string,
  relativePath: string,
  sourceText: string,
): Promise<string> {
  const sourcePath = path.join(rootPath, relativePath);
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, sourceText, 'utf8');
  return path.normalize(sourcePath);
}

describe('collectPreviewInspectorOneHopContext', () => {
  it('reserves one JSX dependency per corridor step before spending a second slot', async () => {
    const appPath = '/workspace/App.tsx';
    const pagePath = '/workspace/Page.tsx';
    const targetPath = '/workspace/Target.tsx';
    const paths = ['/workspace/a1.ts', '/workspace/a2.ts', '/workspace/b1.ts', '/workspace/b2.ts'];
    const sourceByPath = new Map([
      [
        appPath,
        [
          "import A1 from './a1';",
          "import A2 from './a2';",
          "import Page from './Page';",
          'export default function App() { return <><A1 /><A2 /><Page /></>; }',
        ].join('\n'),
      ],
      [
        pagePath,
        [
          "import B1 from './b1';",
          "import B2 from './b2';",
          "import Target from './Target';",
          'export default function Page() { return <><B1 /><B2 /><Target /></>; }',
        ].join('\n'),
      ],
      [targetPath, 'export default function Target() { return null; }'],
    ]);
    const resolver = createFixtureResolver([appPath, pagePath, targetPath, ...paths]);

    const context = await collectPreviewInspectorOneHopContext({
      importPath: [appPath, pagePath, targetPath],
      maximumFiles: 2,
      readSource: (sourcePath) => Promise.resolve(sourceByPath.get(path.normalize(sourcePath))),
      resolveModule: resolver,
      workspaceRoot: '/workspace',
    });

    expect(context.sourcePaths).toEqual(['/workspace/a1.ts', '/workspace/b1.ts']);
    expect(context.truncated).toBe(true);
  });

  it('excludes projectable static route choices while retaining ordinary JSX shell imports', async () => {
    const appPath = '/workspace/App.tsx';
    const pagePath = '/workspace/Page.tsx';
    const shellPath = '/workspace/Shell.ts';
    const alternatePath = '/workspace/Alternate.tsx';
    const sourceText = [
      "import { createBrowserRouter, Route } from 'react-router-dom';",
      "import Page from './Page';",
      "import Shell from './Shell';",
      "import Alternate from './Alternate';",
      'const router = createBrowserRouter([{ path: "alternate", element: <Alternate /> }]);',
      'void router;',
      'export default function App() { return <Shell><Page /></Shell>; }',
    ].join('\n');

    const context = await collectPreviewInspectorOneHopContext({
      importPath: [appPath, pagePath],
      maximumFiles: 8,
      readSource: (sourcePath) =>
        Promise.resolve(path.normalize(sourcePath) === appPath ? sourceText : ''),
      resolveModule: createFixtureResolver([appPath, pagePath, shellPath, alternatePath]),
      workspaceRoot: '/workspace',
    });

    expect(context.sourcePaths).toEqual([shellPath]);
    expect(context.truncated).toBe(false);
  });

  it('adds direct non-page JSX modules from every proven corridor step to source evidence', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'preview-one-hop-corridor-'));
    temporaryRoots.push(projectRoot);
    const mainPath = await writeSource(
      projectRoot,
      'src/main.tsx',
      [
        "import { createRoot } from 'react-dom/client';",
        "import App from './App';",
        'createRoot(document.body).render(<App />);',
      ].join('\n'),
    );
    const appPath = await writeSource(
      projectRoot,
      'src/App.tsx',
      [
        "import AppChrome from './infra/app-chrome';",
        "import Page from './flow/Page';",
        'export default function App() { return <><AppChrome /><Page /></>; }',
      ].join('\n'),
    );
    const pagePath = await writeSource(
      projectRoot,
      'src/flow/Page.tsx',
      [
        "import PageChrome from '../infra/page-chrome';",
        "import Target from './Target';",
        'export default function Page() { return <><PageChrome /><Target /></>; }',
      ].join('\n'),
    );
    const targetPath = await writeSource(
      projectRoot,
      'src/flow/Target.tsx',
      [
        "import TargetChrome from '../infra/target-chrome';",
        'export default function Target() { return <TargetChrome />; }',
      ].join('\n'),
    );
    const contextPaths = await Promise.all(
      ['app-chrome', 'page-chrome', 'target-chrome'].map((name) =>
        writeSource(
          projectRoot,
          `src/infra/${name}.ts`,
          `export default function ${name.replaceAll('-', '_')}() { return null; }`,
        ),
      ),
    );
    const sources = [mainPath, appPath, pagePath, targetPath, ...contextPaths];

    const corridor = await collectPreviewInspectorFastPageCorridor({
      documentPath: targetPath,
      projectRoot,
      readSource: (sourcePath) => readFile(sourcePath, 'utf8').catch(() => undefined),
      resolveModule: createFixtureResolver(sources),
      workspaceRoot: projectRoot,
    });

    expect(corridor?.importPath).toEqual([mainPath, appPath, pagePath, targetPath]);
    expect(corridor?.sourcePaths).toEqual(expect.arrayContaining(contextPaths.slice(0, 2)));
    expect(corridor?.sourcePaths).not.toContain(contextPaths[2]);
  });
});
