/** Verifies bounded app-wrapper traversal used to recover production global style components. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { selectPreviewGlobalStyleImports } from '../../../src/adapters/esbuild/previewGlobalStyleSelection';
import type { PreviewRenderChainCandidate } from '../../../src/adapters/esbuild/renderGraph/previewRenderGraphTypes';

const WORKSPACE_ROOT = path.resolve('/workspace');
const ENTRY_PATH = path.join(WORKSPACE_ROOT, 'src/entry.tsx');
const APP_BASE_PATH = path.join(WORKSPACE_ROOT, 'src/app-base.tsx');
const GLOBAL_STYLE_PATH = path.join(WORKSPACE_ROOT, 'src/global-style.tsx');
const UNRELATED_STYLE_PATH = path.join(WORKSPACE_ROOT, 'src/unrelated-style.tsx');

describe('selectPreviewGlobalStyleImports', () => {
  /** Follows a local wrapper factory into AppBase and its rendered exported GlobalStyle only. */
  it('finds the global style on the selected application render corridor', async () => {
    const sourceByPath = new Map([
      [
        ENTRY_PATH,
        [
          "import { AppBase } from './app-base';",
          "import { UnrelatedStyle } from './unrelated-style';",
          'const Providers = nest(AppBase);',
          'export function RootLayout() { return <Providers><main /></Providers>; }',
          'export function UnrelatedRoute() { return <UnrelatedStyle />; }',
        ].join('\n'),
      ],
      [
        APP_BASE_PATH,
        [
          "import { GlobalStyle } from './global-style';",
          'export const AppBase = ({ children }) => <>',
          '  <GlobalStyle />',
          '  {children}',
          '</>;',
        ].join('\n'),
      ],
      [
        GLOBAL_STYLE_PATH,
        [
          "import { createGlobalStyle } from 'styled-components';",
          'export const GlobalStyle = createGlobalStyle`body { margin: 0; }`;',
        ].join('\n'),
      ],
      [
        UNRELATED_STYLE_PATH,
        [
          "import { createGlobalStyle } from 'styled-components';",
          'export const UnrelatedStyle = createGlobalStyle`body { margin: 4rem; }`;',
        ].join('\n'),
      ],
    ]);

    const selections = await selectPreviewGlobalStyleImports({
      readSource: ({ sourcePath }) => Promise.resolve(sourceByPath.get(path.normalize(sourcePath))),
      renderPath: createRenderPath(),
      resolveModule: (moduleSpecifier, importerPath) =>
        resolveFixtureModule(moduleSpecifier, importerPath, sourceByPath),
    });

    expect(selections).toEqual([{ exportName: 'GlobalStyle', moduleSpecifier: GLOBAL_STYLE_PATH }]);
  });

  /** Returns no speculative style when the selected component path cannot reach the declaration. */
  it('does not scan unrelated project modules', async () => {
    const selections = await selectPreviewGlobalStyleImports({
      readSource: ({ sourcePath }) =>
        Promise.resolve(
          path.normalize(sourcePath) === ENTRY_PATH
            ? 'export function RootLayout() { return <main />; }'
            : undefined,
        ),
      renderPath: createRenderPath(),
      resolveModule: () => undefined,
    });

    expect(selections).toEqual([]);
  });
});

/** Creates the minimal entry-connected render evidence needed by the style selector. */
function createRenderPath(): PreviewRenderChainCandidate {
  return {
    entryPoint: {
      kind: 'create-root',
      occurrenceStart: 100,
      sourcePath: ENTRY_PATH,
      wrapperNames: ['RootLayout'],
    },
    id: 'style-corridor',
    steps: [
      {
        certainty: 'confirmed',
        kind: 'entry-render',
        label: 'RootLayout',
        occurrenceStart: 10,
        sourcePath: ENTRY_PATH,
        wrapperNames: [],
      },
    ],
  };
}

/** Resolves extensionless relative fixture imports without touching the filesystem. */
function resolveFixtureModule(
  moduleSpecifier: string,
  importerPath: string,
  sourceByPath: ReadonlyMap<string, string>,
): string | undefined {
  if (!moduleSpecifier.startsWith('.')) return undefined;
  const candidate = path.resolve(path.dirname(importerPath), `${moduleSpecifier}.tsx`);
  return sourceByPath.has(candidate) ? candidate : undefined;
}
