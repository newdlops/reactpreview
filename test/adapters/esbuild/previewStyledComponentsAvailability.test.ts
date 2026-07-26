import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { discoverPreviewStyledComponentsAvailability } from '../../../src/adapters/esbuild/previewStyledComponentsAvailability';

describe('discoverPreviewStyledComponentsAvailability', () => {
  it('accepts only an exact styled-components package manifest', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'preview-styled-availability-'));
    const entry = path.join(root, 'node_modules/styled-components/dist/index.js');
    try {
      await mkdir(path.dirname(entry), { recursive: true });
      await writeFile(
        path.join(root, 'node_modules/styled-components/package.json'),
        '{"name":"styled-components"}',
      );
      await writeFile(entry, 'export {};');
      const result = await discoverPreviewStyledComponentsAvailability({
        importerPath: path.join(root, 'src/App.tsx'),
        resolveModule: () => entry,
      });
      expect(result).toMatchObject({ available: true, staticResolutionPath: entry });
      expect(result.dependencyPaths).toEqual([
        path.join(root, 'node_modules/styled-components/package.json'),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects declaration/type-package evidence even when resolution succeeds', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'preview-styled-types-'));
    const declaration = path.join(root, 'node_modules/@types/styled-components/index.d.ts');
    try {
      await mkdir(path.dirname(declaration), { recursive: true });
      await writeFile(
        path.join(root, 'node_modules/@types/styled-components/package.json'),
        '{"name":"@types/styled-components"}',
      );
      await writeFile(declaration, 'export {};');
      const result = await discoverPreviewStyledComponentsAvailability({
        importerPath: declaration,
        resolveModule: () => declaration,
      });
      expect(result).toMatchObject({ available: false, staticResolutionPath: declaration });
      expect(result.dependencyPaths).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
