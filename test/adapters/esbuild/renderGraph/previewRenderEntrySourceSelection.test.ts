/**
 * Verifies semantic entry-first source selection without executing application modules.
 * The fixtures keep filename hints separate from authoritative ReactDOM mount evidence and cover
 * relative imports, barrels, exact project aliases, multiple entries, and unrelated entry trees.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { selectPreviewRenderEntrySources } from '../../../../src/adapters/esbuild/renderGraph/previewRenderEntrySourceSelection';

const ROOT = '/workspace/apps/web/src';
const TARGET_PATH = `${ROOT}/features/Target.tsx`;

/** Immutable in-memory project fixture with extension- and directory-index-aware resolution. */
interface EntrySelectionFixture {
  /** Authored source paths supplied to the selector's bounded workspace inventory. */
  readonly sourcePaths: readonly string[];
  /** Every source read, retained so tests can prove unrelated modules stayed untouched. */
  readonly readPaths: readonly string[];
  /** Exact module specifiers passed through the project resolver. */
  readonly resolvedSpecifiers: readonly string[];
  /** Snapshot-aware source reader over the immutable fixture. */
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  /** Relative and configured-alias resolver over the immutable fixture. */
  readonly resolveModule: (specifier: string, consumerPath: string) => string | undefined;
}

describe('selectPreviewRenderEntrySources', () => {
  /** Follows a semantic entry through a component owner and an ESM barrel to the target module. */
  it('selects an exact createRoot entry-to-target slice through imports and re-exports', async () => {
    const entryPath = `${ROOT}/main.tsx`;
    const appPath = `${ROOT}/App.tsx`;
    const barrelPath = `${ROOT}/features/index.ts`;
    const decoyPath = `${ROOT}/noise/Unrelated.tsx`;
    const sources = {
      [entryPath]: [
        "import { createRoot } from 'react-dom/client';",
        "import App from './App';",
        'createRoot(document.body).render(<App />);',
      ].join('\n'),
      [appPath]: [
        "import { Target } from './features';",
        'export default function App() { return <Target />; }',
      ].join('\n'),
      [barrelPath]: "export { default as Target } from './Target';",
      [TARGET_PATH]: 'export default function Target() { return <article />; }',
      [decoyPath]: "import Target from '../features/Target';",
    };
    const fixture = createFixture(sources);

    const result = await selectPreviewRenderEntrySources({
      documentPath: TARGET_PATH,
      readSource: fixture.readSource,
      resolveModule: fixture.resolveModule,
      sourcePaths: fixture.sourcePaths,
    });

    expect(result.entrySourcePaths).toEqual([entryPath]);
    expect(result.connectedSourcePaths).toEqual(
      sortPaths([entryPath, appPath, barrelPath, TARGET_PATH]),
    );
    expect(result.truncated).toBe(false);
    expect(fixture.readPaths).not.toContain(decoyPath);
  });

  /** A render-shaped method from a lookalike package must not gain entry authority from its name. */
  it('rejects a fake render call even when its filename and package spelling look entry-like', async () => {
    const fakeEntryPath = `${ROOT}/index.tsx`;
    const sources = {
      [fakeEntryPath]: [
        "import renderer from 'react-dom-lookalike';",
        "import Target from './features/Target';",
        'renderer.render(<Target />, document.body);',
      ].join('\n'),
      [TARGET_PATH]: 'export default function Target() { return <article />; }',
    };
    const fixture = createFixture(sources);

    const result = await selectPreviewRenderEntrySources({
      documentPath: TARGET_PATH,
      readSource: fixture.readSource,
      resolveModule: fixture.resolveModule,
      sourcePaths: fixture.sourcePaths,
    });

    expect(result.connectedSourcePaths).toBeUndefined();
    expect(result.entrySourcePaths).toEqual([]);
    expect(fixture.readPaths).toEqual([fakeEntryPath]);
  });

  /** Retains every semantically proven application entry that independently reaches the target. */
  it('unions target paths from two semantic entries', async () => {
    const mainEntryPath = `${ROOT}/main.tsx`;
    const clientEntryPath = `${ROOT}/client.tsx`;
    const pagePath = `${ROOT}/Page.tsx`;
    const sources = {
      [mainEntryPath]: [
        "import { createRoot } from 'react-dom/client';",
        "import Target from './features/Target';",
        'createRoot(document.body).render(<Target />);',
      ].join('\n'),
      [clientEntryPath]: [
        "import { hydrateRoot } from 'react-dom/client';",
        "import Page from './Page';",
        'hydrateRoot(document.body, <Page />);',
      ].join('\n'),
      [pagePath]: [
        "import Target from './features/Target';",
        'export default function Page() { return <Target />; }',
      ].join('\n'),
      [TARGET_PATH]: 'export default function Target() { return <article />; }',
    };
    const fixture = createFixture(sources);

    const result = await selectPreviewRenderEntrySources({
      documentPath: TARGET_PATH,
      readSource: fixture.readSource,
      resolveModule: fixture.resolveModule,
      sourcePaths: fixture.sourcePaths,
    });

    expect(result.entrySourcePaths).toEqual(sortPaths([clientEntryPath, mainEntryPath]));
    expect(result.connectedSourcePaths).toEqual(
      sortPaths([clientEntryPath, mainEntryPath, pagePath, TARGET_PATH]),
    );
  });

  /** Uses the exact caller resolver for arbitrary monorepo aliases rather than guessing paths. */
  it('follows exact alias resolution across an application root and shared target package', async () => {
    const entryPath = `${ROOT}/main.tsx`;
    const rootPath = `${ROOT}/ApplicationRoot.tsx`;
    const sharedTargetPath = '/workspace/packages/design-system/src/Surface.tsx';
    const sources = {
      [entryPath]: [
        "import { createRoot } from 'react-dom/client';",
        "import ApplicationRoot from '@workspace/application';",
        'createRoot(document.body).render(<ApplicationRoot />);',
      ].join('\n'),
      [rootPath]: [
        "import { Surface } from '@design/surface';",
        'export default function ApplicationRoot() { return <Surface />; }',
      ].join('\n'),
      [sharedTargetPath]: 'export const Surface = () => <article />;',
    };
    const fixture = createFixture(sources, {
      '@design/surface': sharedTargetPath,
      '@workspace/application': rootPath,
    });

    const result = await selectPreviewRenderEntrySources({
      documentPath: sharedTargetPath,
      readSource: fixture.readSource,
      resolveModule: fixture.resolveModule,
      sourcePaths: fixture.sourcePaths,
    });

    expect(result.entrySourcePaths).toEqual([entryPath]);
    expect(result.connectedSourcePaths).toEqual(sortPaths([entryPath, rootPath, sharedTargetPath]));
    expect(fixture.resolvedSpecifiers).toEqual(
      expect.arrayContaining(['@workspace/application', '@design/surface']),
    );
  });

  /** A valid ReactDOM entry remains irrelevant when its complete import tree cannot reach target. */
  it('does not report an unrelated semantic entry as connected', async () => {
    const entryPath = `${ROOT}/main.tsx`;
    const dashboardPath = `${ROOT}/Dashboard.tsx`;
    const sources = {
      [entryPath]: [
        "import { createRoot } from 'react-dom/client';",
        "import Dashboard from './Dashboard';",
        'createRoot(document.body).render(<Dashboard />);',
      ].join('\n'),
      [dashboardPath]: 'export default function Dashboard() { return <main />; }',
      [TARGET_PATH]: 'export default function Target() { return <article />; }',
    };
    const fixture = createFixture(sources);

    const result = await selectPreviewRenderEntrySources({
      documentPath: TARGET_PATH,
      readSource: fixture.readSource,
      resolveModule: fixture.resolveModule,
      sourcePaths: fixture.sourcePaths,
    });

    expect(result.connectedSourcePaths).toBeUndefined();
    expect(result.entrySourcePaths).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(fixture.readPaths).toEqual([entryPath, dashboardPath]);
    expect(result.sourceTextByPath.has(TARGET_PATH)).toBe(false);
  });

  /** Legacy named imports with authored whitespace still receive exact semantic entry proof. */
  it('accepts a legacy render alias after the cheap candidate text gate', async () => {
    const entryPath = `${ROOT}/index.tsx`;
    const sources = {
      [entryPath]: [
        "import { render as mountApplication } from 'react-dom';",
        "import Target from './features/Target';",
        'mountApplication ( <Target />, document.body );',
      ].join('\n'),
      [TARGET_PATH]: 'export default function Target() { return <article />; }',
    };
    const fixture = createFixture(sources);

    const result = await selectPreviewRenderEntrySources({
      documentPath: TARGET_PATH,
      readSource: fixture.readSource,
      resolveModule: fixture.resolveModule,
      sourcePaths: fixture.sourcePaths,
    });

    expect(result.entrySourcePaths).toEqual([entryPath]);
    expect(result.connectedSourcePaths).toEqual(sortPaths([entryPath, TARGET_PATH]));
  });
});

/**
 * Creates one source reader and exact resolver while exposing read/resolution observations.
 *
 * @param sources Immutable absolute-path source fixture.
 * @param aliases Exact configured specifier-to-file mappings.
 * @returns Selector collaborators and their deterministic observation arrays.
 */
function createFixture(
  sources: Readonly<Record<string, string>>,
  aliases: Readonly<Record<string, string>> = {},
): EntrySelectionFixture {
  const sourcePaths = Object.keys(sources);
  const sourcePathByStem = new Map<string, string>();
  const readPaths: string[] = [];
  const resolvedSpecifiers: string[] = [];
  for (const sourcePath of sourcePaths) {
    sourcePathByStem.set(removeSourceExtension(sourcePath), sourcePath);
    if (path.basename(sourcePath).startsWith('index.')) {
      sourcePathByStem.set(path.dirname(sourcePath), sourcePath);
    }
  }
  return {
    sourcePaths,
    readPaths,
    resolvedSpecifiers,
    readSource: (sourcePath) => {
      readPaths.push(sourcePath);
      return Promise.resolve(sources[sourcePath]);
    },
    resolveModule: (specifier, consumerPath) => {
      resolvedSpecifiers.push(specifier);
      const aliasPath = aliases[specifier];
      if (aliasPath !== undefined) {
        return aliasPath;
      }
      if (!specifier.startsWith('.')) {
        return undefined;
      }
      const resolvedStem = removeSourceExtension(
        path.resolve(path.dirname(consumerPath), specifier),
      );
      return sourcePathByStem.get(resolvedStem);
    },
  };
}

/** Removes supported authored JS/TS extensions for fixture resolver comparisons. */
function removeSourceExtension(sourcePath: string): string {
  return sourcePath.replace(/\.[cm]?[jt]sx?$/u, '');
}

/** Returns a lexically sorted copy matching the selector's stable union output. */
function sortPaths(sourcePaths: readonly string[]): readonly string[] {
  return [...sourcePaths].sort();
}
