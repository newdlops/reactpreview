/** Verifies evidence-based reuse and invalidation of automatic Storybook setup fallback. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PreviewSetupFailureCache } from '../../../src/adapters/esbuild/previewSetupFailureCache';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('PreviewSetupFailureCache', () => {
  /** Reuses unchanged missing-import evidence and invalidates it when the candidate is created. */
  it('skips only the unchanged optional setup graph', async () => {
    const root = await mkdtemp(path.join(REPOSITORY_ROOT, 'test/fixtures/setup-failure-cache-'));
    const setupPath = path.join(root, 'preview.tsx');
    const missingPath = path.join(root, 'moment.ts');
    const cache = new PreviewSetupFailureCache();
    await writeFile(setupPath, "import './moment';", 'utf8');

    try {
      await cache.write(
        'storybook',
        {
          dependencyPaths: [setupPath, missingPath],
          diagnosticMessage: 'missing moment',
          watchDirectories: [root],
        },
        [],
      );

      await expect(cache.read('storybook', [])).resolves.toMatchObject({
        diagnosticMessage: 'missing moment',
      });
      await writeFile(missingPath, 'export default {};', 'utf8');
      await expect(cache.read('storybook', [])).resolves.toBeUndefined();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  /** Invalidates a fallback when an unsaved setup overlay changes without touching disk metadata. */
  it('tracks dirty setup snapshots by content fingerprint', async () => {
    const root = await mkdtemp(path.join(REPOSITORY_ROOT, 'test/fixtures/setup-snapshot-cache-'));
    const setupPath = path.join(root, 'preview.tsx');
    const cache = new PreviewSetupFailureCache();
    await writeFile(setupPath, 'export default {};', 'utf8');
    const firstSnapshot = {
      documentPath: setupPath,
      language: 'tsx' as const,
      sourceText: "import './missing';",
    };

    try {
      await cache.write(
        'storybook',
        {
          dependencyPaths: [setupPath],
          diagnosticMessage: 'snapshot failure',
          watchDirectories: [],
        },
        [firstSnapshot],
      );
      await expect(cache.read('storybook', [firstSnapshot])).resolves.toBeDefined();
      await expect(
        cache.read('storybook', [{ ...firstSnapshot, sourceText: 'export default {};' }]),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
