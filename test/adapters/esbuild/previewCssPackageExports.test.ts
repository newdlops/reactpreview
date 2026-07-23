/** Verifies the pure package-export subset shared by CSS bundling and Tailwind safety preflight. */
import { describe, expect, it } from 'vitest';
import {
  parsePreviewBarePackageSpecifier,
  selectPreviewPackageStyleExport,
} from '../../../src/adapters/esbuild/previewCssPackageExports';

describe('previewCssPackageExports', () => {
  /** Preserves exact root and scoped subpath identities while refusing filesystem-like requests. */
  it('parses only bare npm package specifiers', () => {
    expect(parsePreviewBarePackageSpecifier('tw-animate-css')).toEqual({
      exportSubpath: '.',
      packageName: 'tw-animate-css',
    });
    expect(parsePreviewBarePackageSpecifier('@preview/theme/animations')).toEqual({
      exportSubpath: './animations',
      packageName: '@preview/theme',
    });
    expect(parsePreviewBarePackageSpecifier('../theme.css')).toBeUndefined();
    expect(parsePreviewBarePackageSpecifier('@preview/../package')).toBeUndefined();
    expect(parsePreviewBarePackageSpecifier('https://example.test/theme.css')).toBeUndefined();
  });

  /** Selects CSS-only root and subpath targets when authored condition order activates `style`. */
  it('selects an exact export reached through the style condition', () => {
    expect(
      selectPreviewPackageStyleExport(
        {
          '.': { style: './index.css' },
          './utilities': { style: './utilities.css' },
        },
        '.',
      ),
    ).toBe('./index.css');
    expect(
      selectPreviewPackageStyleExport(
        {
          '.': { style: './index.css' },
          './utilities': { style: './utilities.css' },
        },
        './utilities',
      ),
    ).toBe('./utilities.css');
  });

  /** Leaves direct targets and an earlier active JavaScript/default branch to normal resolution. */
  it('does not override an export that was not selected by style', () => {
    expect(selectPreviewPackageStyleExport('./index.css', '.')).toBeUndefined();
    expect(
      selectPreviewPackageStyleExport(
        {
          default: './index.js',
          style: './index.css',
        },
        '.',
      ),
    ).toBeUndefined();
    expect(
      selectPreviewPackageStyleExport(
        {
          import: './index.js',
          style: './index.css',
        },
        '.',
      ),
    ).toBeUndefined();
  });
});
