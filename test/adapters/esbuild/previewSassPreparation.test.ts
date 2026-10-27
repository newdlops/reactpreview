/** Ensures initialization follows bounded explicit style evidence and never reads Sass inputs. */
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { selectPreviewSassPreparationPath } from '../../../src/adapters/esbuild/previewSassPreparation';

describe('Sass initialization evidence', () => {
  it('leaves optional initialization lazy when an owner cannot be read', async () => {
    await expect(
      selectPreviewSassPreparationPath({
        applicationImports: [],
        globalImports: [
          {
            moduleSpecifier: '/virtual/missing.tsx',
            exportName: 'Global',
          },
        ],
        readSource: () => Promise.reject(new Error('temporarily unreadable')),
      }),
    ).resolves.toBeUndefined();
  });
  it('selects one explicit side effect in a proven global style module', async () => {
    const moduleSpecifier = path.resolve('/virtual/global-style.tsx');
    const readSource = vi.fn(() => Promise.resolve('import "./reset.css"; import "./theme.scss";'));
    const selected = await selectPreviewSassPreparationPath({
      applicationImports: [],
      globalImports: [{ moduleSpecifier, exportName: 'GlobalStyle' }],
      readSource,
    });
    expect(selected).toBe(path.resolve('/virtual/theme.scss'));
    expect(readSource).toHaveBeenCalledExactlyOnceWith(moduleSpecifier, 128 * 1024);
  });

  it('uses an explicit application stylesheet without reading any source', async () => {
    const readSource = vi.fn(() => Promise.resolve(undefined));
    expect(
      await selectPreviewSassPreparationPath({
        applicationImports: [
          {
            importerPath: '/virtual/app.tsx',
            moduleSpecifier: './theme.sass',
          },
        ],
        globalImports: [],
        readSource,
      }),
    ).toBe(path.resolve('/virtual/theme.sass'));
    expect(readSource).not.toHaveBeenCalled();
  });

  it('keeps named, dynamic, bare, commented, and ordinary CSS imports lazy', async () => {
    const readSource = vi.fn(() =>
      Promise.resolve(
        [
          'import theme from "./module.scss";',
          'void import("./dynamic.scss");',
          'import "package/theme.scss";',
          'import "./plain.css";',
          '// import "./comment.scss";',
        ].join('\n'),
      ),
    );
    expect(
      await selectPreviewSassPreparationPath({
        applicationImports: [],
        globalImports: [{ moduleSpecifier: '/virtual/global.ts', exportName: 'Global' }],
        readSource,
      }),
    ).toBeUndefined();
  });

  it('caps owner reads at eight and ignores oversized snapshots', async () => {
    const readSource = vi.fn(() =>
      Promise.resolve(' '.repeat(128 * 1024) + 'import "./theme.scss";'),
    );
    expect(
      await selectPreviewSassPreparationPath({
        applicationImports: [],
        globalImports: Array.from({ length: 10 }, (_, index) => ({
          moduleSpecifier: '/virtual/global' + String(index) + '.tsx',
          exportName: 'Global',
        })),
        readSource,
      }),
    ).toBeUndefined();
    expect(readSource).toHaveBeenCalledTimes(8);
  });
});
