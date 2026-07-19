/** Verifies Yarn PnP virtual paths are decoded without executing a project's runtime loader. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createPreviewYarnVirtualSiblingPath,
  resolvePreviewYarnVirtualPath,
} from '../../../src/adapters/esbuild/previewYarnVirtualPath';

describe('resolvePreviewYarnVirtualPath', () => {
  /** Restores the physical source path emitted for a peer-dependent monorepo workspace package. */
  it('devirtualizes a Yarn workspace source identity', () => {
    const workspaceRoot = path.resolve('/workspace/repository');
    const virtualPath = path.join(
      workspaceRoot,
      '.yarn',
      '__virtual__',
      '@scope-hooks-virtual-49683bb2f7',
      '1',
      'shared',
      'hooks',
      'src',
      'index.ts',
    );

    expect(resolvePreviewYarnVirtualPath(virtualPath, workspaceRoot)).toBe(
      path.join(workspaceRoot, 'shared', 'hooks', 'src', 'index.ts'),
    );
  });

  /** Leaves normal paths intact and rejects malformed or workspace-escaping virtual identities. */
  it('preserves the workspace security boundary', () => {
    const workspaceRoot = path.resolve('/workspace/repository');
    const ordinaryPath = path.join(workspaceRoot, 'src', 'Page.tsx');

    expect(resolvePreviewYarnVirtualPath(ordinaryPath, workspaceRoot)).toBe(ordinaryPath);
    expect(
      resolvePreviewYarnVirtualPath(
        path.join(workspaceRoot, '.yarn', '__virtual__', 'package-hash', 'invalid', 'index.ts'),
        workspaceRoot,
      ),
    ).toBeUndefined();
    expect(
      resolvePreviewYarnVirtualPath(
        path.join(workspaceRoot, '.yarn', '__virtual__', 'package-hash', '4', 'outside.ts'),
        workspaceRoot,
      ),
    ).toBeUndefined();
  });

  /** Preserves one peer-bound virtual package identity across a resolved relative source edge. */
  it('recreates a virtual sibling path for relative workspace imports', () => {
    const workspaceRoot = path.resolve('/workspace/repository');
    const virtualImporter = path.join(
      workspaceRoot,
      '.yarn',
      '__virtual__',
      '@scope-common-virtual-1234567890',
      '1',
      'shared',
      'common',
      'src',
      'index.ts',
    );
    const physicalImporter = path.join(workspaceRoot, 'shared', 'common', 'src', 'index.ts');
    const physicalTarget = path.join(workspaceRoot, 'shared', 'common', 'src', 'PageConfig.ts');

    expect(
      createPreviewYarnVirtualSiblingPath(
        virtualImporter,
        physicalImporter,
        physicalTarget,
        workspaceRoot,
      ),
    ).toBe(
      path.join(
        workspaceRoot,
        '.yarn',
        '__virtual__',
        '@scope-common-virtual-1234567890',
        '1',
        'shared',
        'common',
        'src',
        'PageConfig.ts',
      ),
    );
  });
});
