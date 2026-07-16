/**
 * Verifies syntax-only style evidence collection independently from esbuild graph traversal.
 * Fixtures model project source strings so tests never execute a theme or styling package.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectPreviewStyleSignals,
  selectPreviewGraphTheme,
  type PreviewStyleSignal,
} from '../../../src/adapters/esbuild/previewStyleInventory';

describe('collectPreviewStyleSignals', () => {
  /** Recognizes the type-only pattern used by reachable styled UI components in real projects. */
  it('collects a bare type-only theme reference from a styled component', () => {
    const sourcePath = '/workspace/src/common/ui/paragraph.tsx';
    const signals = collectPreviewStyleSignals(
      sourcePath,
      [
        "import styled, { css } from 'styled-components';",
        "import type { theme } from 'common/ui/theme/theme';",
        'export const Paragraph = styled.div``;',
      ].join('\n'),
    );

    expect(signals).toEqual([
      {
        confidence: 'type',
        exportName: 'theme',
        importerPath: sourcePath,
        moduleSpecifier: 'common/ui/theme/theme',
      },
    ]);
  });

  /** Normalizes relative paths while retaining project aliases for the caller's module resolver. */
  it('collects relative and bare value themes, including supported aliases', () => {
    const sourcePath = '/workspace/src/components/card.tsx';
    const signals = collectPreviewStyleSignals(
      sourcePath,
      [
        "import * as Styled from 'styled-components';",
        "import theme from '../theme/default-theme.tsx';",
        "import { theme as applicationTheme } from '@/design/theme';",
        "import { applicationTheme as themeAlias } from './unrelated-theme';",
      ].join('\n'),
    );

    expect(signals).toEqual([
      {
        confidence: 'value',
        exportName: 'default',
        importerPath: sourcePath,
        moduleSpecifier: path.normalize('/workspace/src/theme/default-theme'),
      },
      {
        confidence: 'value',
        exportName: 'theme',
        importerPath: sourcePath,
        moduleSpecifier: '@/design/theme',
      },
    ]);
  });

  /** Handles both declaration-wide and specifier-local type modifiers without losing aliases. */
  it('collects aliased named type-only theme imports', () => {
    const sourcePath = '/workspace/src/components/list.tsx';
    const signals = collectPreviewStyleSignals(
      sourcePath,
      [
        "import styled from 'styled-components';",
        "import type { theme as ThemeShape } from '../theme/legacy';",
        "import { type theme as CurrentThemeShape } from '../theme/current.ts';",
      ].join('\n'),
    );

    expect(signals).toEqual([
      expect.objectContaining({
        confidence: 'type',
        exportName: 'theme',
        moduleSpecifier: '/workspace/src/theme/legacy',
      }),
      expect.objectContaining({
        confidence: 'type',
        exportName: 'theme',
        moduleSpecifier: '/workspace/src/theme/current',
      }),
    ]);
  });

  /** Prevents erased styled-components types from authorizing a runtime theme module import. */
  it('requires styled-components to participate at runtime', () => {
    const signals = collectPreviewStyleSignals(
      '/workspace/src/components/typed-card.tsx',
      [
        "import type { DefaultTheme } from 'styled-components';",
        "import { theme } from './theme';",
      ].join('\n'),
    );

    expect(signals).toEqual([]);
  });

  /** Rejects syntax recovery rather than returning a misleading subset from an incomplete editor. */
  it('returns no signals for malformed source', () => {
    const signals = collectPreviewStyleSignals(
      '/workspace/src/components/broken-card.tsx',
      [
        "import styled from 'styled-components';",
        "import { theme from './theme';",
        'export const Broken = styled.div``;',
      ].join('\n'),
    );

    expect(signals).toEqual([]);
  });

  /** Discards an overfull source instead of selecting from a traversal-order-dependent prefix. */
  it('bounds the number of signals emitted by one source', () => {
    const themeImports = Array.from(
      { length: 33 },
      (_, index) =>
        `import { theme as Theme${index.toString()} } from './theme-${index.toString()}';`,
    );
    const signals = collectPreviewStyleSignals(
      '/workspace/src/components/generated-card.tsx',
      ["import styled from 'styled-components';", ...themeImports].join('\n'),
    );

    expect(signals).toEqual([]);
  });
});

describe('selectPreviewGraphTheme', () => {
  /** Repeated type references from distinct reachable children make one candidate unambiguous. */
  it('accumulates repeated type-only evidence by candidate', () => {
    const selection = selectPreviewGraphTheme([
      createSignal('/workspace/src/first.tsx', '@/theme/current', 'theme', 'type'),
      createSignal('/workspace/src/second.tsx', '@/theme/current', 'theme', 'type'),
      createSignal('/workspace/src/legacy.tsx', '@/theme/legacy', 'theme', 'type'),
    ]);

    expect(selection).toEqual({ exportName: 'theme', moduleSpecifier: '@/theme/current' });
  });

  /** Runtime evidence remains authoritative even when another candidate has many erased users. */
  it('ranks one value import above repeated type-only evidence', () => {
    const selection = selectPreviewGraphTheme([
      createSignal('/workspace/src/target.tsx', '@/theme/exact', 'default', 'value'),
      ...Array.from({ length: 12 }, (_, index) =>
        createSignal(
          `/workspace/src/child-${index.toString()}.tsx`,
          '@/theme/types-only',
          'theme',
          'type',
        ),
      ),
    ]);

    expect(selection).toEqual({ exportName: 'default', moduleSpecifier: '@/theme/exact' });
  });

  /** Does not double-count the same module when graph aliases cause duplicate collection callbacks. */
  it('deduplicates repeated evidence from one importer', () => {
    const duplicate = createSignal('/workspace/src/target.tsx', '@/theme/first', 'theme', 'type');
    const selection = selectPreviewGraphTheme([
      duplicate,
      duplicate,
      createSignal('/workspace/src/other.tsx', '@/theme/second', 'theme', 'type'),
    ]);

    expect(selection).toBeUndefined();
  });

  /** Leaves equally supported candidates unresolved instead of choosing based on input order. */
  it('returns undefined for an exact top-score tie', () => {
    const selection = selectPreviewGraphTheme([
      createSignal('/workspace/src/first.tsx', '@/theme/first', 'theme', 'value'),
      createSignal('/workspace/src/second.tsx', '@/theme/second', 'theme', 'value'),
    ]);

    expect(selection).toBeUndefined();
  });

  /** Refuses graph inputs beyond the documented bounded evidence budget. */
  it('returns undefined when graph evidence exceeds its bound', () => {
    const signals = Array.from({ length: 257 }, (_, index) =>
      createSignal(
        `/workspace/src/component-${index.toString()}.tsx`,
        '@/theme/shared',
        'theme',
        'type',
      ),
    );

    expect(selectPreviewGraphTheme(signals)).toBeUndefined();
  });
});

/** Creates concise immutable evidence for graph-ranking tests. */
function createSignal(
  importerPath: string,
  moduleSpecifier: string,
  exportName: PreviewStyleSignal['exportName'],
  confidence: PreviewStyleSignal['confidence'],
): PreviewStyleSignal {
  return { confidence, exportName, importerPath, moduleSpecifier };
}
