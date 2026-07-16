/** Verifies static alias resolution without evaluating project configuration or source modules. */
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPreviewStaticModuleResolver } from '../../../src/adapters/esbuild/previewStaticModuleResolver';

describe('createPreviewStaticModuleResolver', () => {
  /** Resolves a sibling monorepo package through the importing application's nearest tsconfig. */
  it('matches a non-suffix tsconfig alias to its exact target source', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-static-resolver-'));
    const appRoot = path.join(workspaceRoot, 'packages', 'app');
    const appSource = path.join(appRoot, 'src');
    const uiSource = path.join(workspaceRoot, 'packages', 'ui', 'src');
    const consumerPath = path.join(appSource, 'Page.tsx');
    const targetPath = path.join(uiSource, 'Target.tsx');
    try {
      await Promise.all([
        mkdir(appSource, { recursive: true }),
        mkdir(uiSource, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(
          path.join(appRoot, 'tsconfig.json'),
          JSON.stringify({
            compilerOptions: {
              baseUrl: '.',
              jsx: 'react-jsx',
              paths: {
                '@design/*': ['../ui/src/*'],
                '@selected': ['../ui/src/Target.tsx'],
              },
            },
          }),
          'utf8',
        ),
        writeFile(consumerPath, "import { Target } from '@design/Target';", 'utf8'),
        writeFile(targetPath, 'export function Target() { return <button />; }', 'utf8'),
      ]);

      const resolver = createPreviewStaticModuleResolver({ workspaceRoot });

      expect(resolver.resolve('@design/Target', consumerPath)).toBe(await realpath(targetPath));
      expect(resolver.matchesTarget('@design/Target', consumerPath, targetPath)).toBe(true);
      expect(resolver.matchesTarget('@selected', consumerPath, targetPath)).toBe(true);
      expect(resolver.getMatchedSpecifiers(targetPath)).toEqual(['@design/Target', '@selected']);
      expect(resolver.matchesTarget('@design/Missing', consumerPath, targetPath)).toBe(false);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Refuses an explicit config outside the workspace and still resolves ordinary relative files. */
  it('keeps configured resolution inside the trusted workspace', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-static-boundary-'));
    const outsideRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-static-outside-'));
    const sourceRoot = path.join(workspaceRoot, 'src');
    const consumerPath = path.join(sourceRoot, 'Page.tsx');
    const targetPath = path.join(sourceRoot, 'Target.tsx');
    try {
      await mkdir(sourceRoot, { recursive: true });
      await Promise.all([
        writeFile(path.join(outsideRoot, 'tsconfig.json'), '{}', 'utf8'),
        writeFile(consumerPath, "import { Target } from './Target';", 'utf8'),
        writeFile(targetPath, 'export const Target = () => null;', 'utf8'),
      ]);

      const resolver = createPreviewStaticModuleResolver({
        configuredTsconfigPath: path.join(outsideRoot, 'tsconfig.json'),
        workspaceRoot,
      });

      expect(resolver.matchesTarget('./Target', consumerPath, targetPath)).toBe(true);
    } finally {
      await Promise.all([
        rm(workspaceRoot, { force: true, recursive: true }),
        rm(outsideRoot, { force: true, recursive: true }),
      ]);
    }
  });
});
