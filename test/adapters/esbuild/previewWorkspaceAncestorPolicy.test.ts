/** Verifies package-first Page Inspector escalation decisions for monorepo layouts. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { shouldEscalatePreviewAncestorSearch } from '../../../src/adapters/esbuild/previewWorkspaceAncestorPolicy';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('shouldEscalatePreviewAncestorSearch', () => {
  /** Avoids a workspace-wide scan when the selected app is the only declared workspace package. */
  it('keeps a sole nested application package-local', async () => {
    const root = await createWorkspace('single-workspace-policy-');
    const projectRoot = path.join(root, 'apps', 'web');
    try {
      await mkdir(projectRoot, { recursive: true });
      await Promise.all([
        writeFile(
          path.join(root, 'package.json'),
          JSON.stringify({ private: true, workspaces: ['apps/web'] }),
          'utf8',
        ),
        writeFile(
          path.join(projectRoot, 'package.json'),
          JSON.stringify({ name: '@example/web' }),
          'utf8',
        ),
      ]);

      await expect(shouldEscalatePreviewAncestorSearch(projectRoot, root)).resolves.toBe(false);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  /** Preserves cross-package discovery when a workspace pattern can contain sibling consumers. */
  it('escalates a multi-package workspace pattern', async () => {
    const root = await createWorkspace('multi-workspace-policy-');
    const projectRoot = path.join(root, 'packages', 'ui');
    try {
      await mkdir(projectRoot, { recursive: true });
      await Promise.all([
        writeFile(
          path.join(root, 'package.json'),
          JSON.stringify({ private: true, workspaces: ['packages/*'] }),
          'utf8',
        ),
        writeFile(
          path.join(projectRoot, 'package.json'),
          JSON.stringify({ name: '@example/ui' }),
          'utf8',
        ),
      ]);

      await expect(shouldEscalatePreviewAncestorSearch(projectRoot, root)).resolves.toBe(true);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

/** Creates one isolated fixture root below the repository test boundary. */
function createWorkspace(prefix: string): Promise<string> {
  return mkdtemp(path.join(REPOSITORY_ROOT, `test/fixtures/${prefix}`));
}
