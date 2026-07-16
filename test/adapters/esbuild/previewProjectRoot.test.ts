/** Verifies that runtime conventions are isolated to the nearest package inside a monorepo. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { findPreviewProjectRoot } from '../../../src/adapters/esbuild/previewProjectRoot';

describe('findPreviewProjectRoot', () => {
  /** Chooses the leaf package instead of applying another workspace package's preview setup. */
  it('selects the nearest package boundary in a nested monorepo', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-monorepo-'));
    const packageRoot = path.join(workspaceRoot, 'apps', 'dashboard');
    const documentPath = path.join(packageRoot, 'src', 'Dashboard.tsx');
    try {
      await mkdir(path.dirname(documentPath), { recursive: true });
      await Promise.all([
        writeFile(path.join(workspaceRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(path.join(packageRoot, 'package.json'), '{"name":"dashboard"}', 'utf8'),
        writeFile(documentPath, 'export const Dashboard = () => null;', 'utf8'),
      ]);

      await expect(findPreviewProjectRoot(documentPath, workspaceRoot)).resolves.toBe(packageRoot);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Keeps the selected VS Code workspace as the package fallback and security boundary. */
  it('falls back to the workspace and never searches an outside target', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-workspace-'));
    const documentPath = path.join(workspaceRoot, 'src', 'Preview.tsx');
    try {
      await mkdir(path.dirname(documentPath), { recursive: true });
      await writeFile(documentPath, 'export default function Preview() { return null; }', 'utf8');

      await expect(findPreviewProjectRoot(documentPath, workspaceRoot)).resolves.toBe(
        workspaceRoot,
      );
      await expect(
        findPreviewProjectRoot(
          path.join(path.dirname(workspaceRoot), 'outside.tsx'),
          workspaceRoot,
        ),
      ).resolves.toBe(workspaceRoot);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});
