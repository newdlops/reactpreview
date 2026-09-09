/** Ensures positive import reuse stays issuer-specific, bounded, and scoped to one resolver. */
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createPreviewStaticModuleResolver } from '../../../src/adapters/esbuild/previewStaticModuleResolver';

describe('request-owned positive static resolution cache', () => {
  it('eliminates repeat filesystem resolution without mixing importers or later requests', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'preview-resolution-reuse-'));
    try {
      for (const name of ['left', 'right']) {
        await mkdir(path.join(root, name));
        await writeFile(path.join(root, name, 'Target.ts'), 'export const value = 1;');
      }
      const left = path.join(root, 'left', 'Consumer.ts');
      const right = path.join(root, 'right', 'Consumer.ts');
      const leftTarget = await realpath(path.join(root, 'left', 'Target.ts'));
      const rightTarget = await realpath(path.join(root, 'right', 'Target.ts'));
      const alias = path.join(root, 'Alias.ts');
      await symlink(leftTarget, alias);
      const resolver = createPreviewStaticModuleResolver({ workspaceRoot: root });
      expect(resolver.resolve('./Target', left)).toBe(leftTarget);
      const canonicalize = vi.spyOn(realpathSync, 'native');
      try {
        for (let index = 0; index < 40; index += 1) {
          expect(resolver.resolve('./Target', left)).toBe(leftTarget);
        }
        expect(canonicalize).not.toHaveBeenCalled();
        expect(resolver.resolve('./Target', right)).toBe(rightTarget);
        expect(resolver.resolve('../Alias', left)).toBe(leftTarget);
      } finally {
        canonicalize.mockRestore();
      }
      await unlink(alias);
      await symlink(rightTarget, alias);
      const next = createPreviewStaticModuleResolver({ workspaceRoot: root });
      expect(next.resolve('../Alias', left)).toBe(rightTarget);
      expect(next.resolve('./Target', left)).toBe(leftTarget);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('evicts old results at the bound and keeps query identities separate', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'preview-resolution-bound-'));
    try {
      const target = path.join(root, 'Target.ts');
      const consumer = path.join(root, 'Consumer.ts');
      await writeFile(target, 'export const value = 1;');
      const expected = await realpath(target);
      const resolver = createPreviewStaticModuleResolver({ workspaceRoot: root });
      for (let index = 0; index <= 4096; index += 1) {
        expect(resolver.resolve(`./Target?request=${index.toString()}`, consumer)).toBe(expected);
      }
      const canonicalize = vi.spyOn(realpathSync, 'native');
      try {
        expect(resolver.resolve('./Target?request=4096', consumer)).toBe(expected);
        expect(canonicalize).not.toHaveBeenCalled();
        expect(resolver.resolve('./Target?request=0', consumer)).toBe(expected);
        expect(canonicalize).toHaveBeenCalled();
      } finally {
        canonicalize.mockRestore();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
