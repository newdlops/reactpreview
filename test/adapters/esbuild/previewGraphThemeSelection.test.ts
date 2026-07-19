/** Verifies eager exact-theme selection for page roots that remain behind dynamic imports. */
import { describe, expect, it } from 'vitest';
import { selectPreviewGraphThemeImport } from '../../../src/adapters/esbuild/previewGraphThemeSelection';

describe('selectPreviewGraphThemeImport', () => {
  /** Collapses relative and aliased requests that the project resolver proves are one module. */
  it('canonicalizes equivalent page-corridor theme spellings before scoring', async () => {
    const sources = new Map([
      [
        '/workspace/App.tsx',
        "import styled from 'styled-components'; import { theme } from '@theme'; export const App = styled.div``;",
      ],
      [
        '/workspace/Provider.tsx',
        "import { ThemeProvider } from 'styled-components'; import { theme as defaultTheme } from './theme'; export const Provider = ThemeProvider;",
      ],
    ]);
    const selection = await selectPreviewGraphThemeImport({
      dependencyPaths: [...sources.keys()],
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier) =>
        specifier === '@theme' || specifier === '/workspace/theme'
          ? '/workspace/theme.ts'
          : undefined,
    });

    expect(selection).toEqual({ exportName: 'theme', moduleSpecifier: '/workspace/theme.ts' });
  });

  /** Refuses equally supported real themes instead of silently applying the wrong design system. */
  it('keeps distinct tied theme modules ambiguous', async () => {
    const sources = new Map([
      [
        '/workspace/First.tsx',
        "import styled from 'styled-components'; import { theme } from './first-theme'; export const First = styled.div``;",
      ],
      [
        '/workspace/Second.tsx',
        "import styled from 'styled-components'; import { theme } from './second-theme'; export const Second = styled.div``;",
      ],
    ]);
    const selection = await selectPreviewGraphThemeImport({
      dependencyPaths: [...sources.keys()],
      readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
      resolveModule: (specifier) => `${specifier}.tsx`,
    });

    expect(selection).toBeUndefined();
  });
});
