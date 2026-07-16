/** Verifies reuse and invalidation of bounded package-wide implicit-global evidence. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PreviewImplicitGlobalEvidenceCache } from '../../../src/adapters/esbuild/previewImplicitGlobalEvidenceCache';

describe('PreviewImplicitGlobalEvidenceCache', () => {
  /** Shares one scan while selected source/module metadata and editor overlays remain unchanged. */
  it('reuses selected ambient evidence and invalidates it after a declaration edit', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'preview-global-evidence-cache-'));
    const declarationPath = path.join(projectRoot, 'global.d.ts');
    const firstWrapperPath = path.join(projectRoot, 'first.ts');
    const secondWrapperPath = path.join(projectRoot, 'second.ts');
    const cache = new PreviewImplicitGlobalEvidenceCache();
    try {
      await mkdir(projectRoot, { recursive: true });
      await Promise.all([
        writeFile(declarationPath, createDeclaration('./first'), 'utf8'),
        writeFile(firstWrapperPath, 'export default () => "first";', 'utf8'),
        writeFile(secondWrapperPath, 'export default () => "second";', 'utf8'),
      ]);
      let resolverCalls = 0;
      const resolveModule = (specifier: string): string | undefined => {
        resolverCalls += 1;
        return specifier === './first'
          ? firstWrapperPath
          : specifier === './second'
            ? secondWrapperPath
            : undefined;
      };
      const options = {
        cacheKey: projectRoot,
        resolveModule,
        snapshotSourceByPath: new Map<string, string>(),
        sourcePaths: [declarationPath, firstWrapperPath, secondWrapperPath],
      } as const;

      const first = await cache.discover(options);
      const second = await cache.discover(options);

      expect(first.evidence[0]?.modulePath).toBe(firstWrapperPath);
      expect(second).toBe(first);
      expect(resolverCalls).toBe(1);

      await writeFile(declarationPath, createDeclaration('./second'), 'utf8');
      const refreshed = await cache.discover(options);

      expect(refreshed.evidence[0]?.modulePath).toBe(secondWrapperPath);
      expect(resolverCalls).toBe(2);
    } finally {
      cache.clear();
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Invalidates selected evidence when an unsaved declaration overlay appears or changes. */
  it('tracks current editor snapshot identity for evidence dependencies', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'preview-global-snapshot-cache-'));
    const declarationPath = path.join(projectRoot, 'global.d.ts');
    const wrapperPath = path.join(projectRoot, 'configured.ts');
    const cache = new PreviewImplicitGlobalEvidenceCache();
    try {
      await Promise.all([
        writeFile(declarationPath, createDeclaration('./configured'), 'utf8'),
        writeFile(wrapperPath, 'export default () => "configured";', 'utf8'),
      ]);
      let resolverCalls = 0;
      const baseOptions = {
        cacheKey: projectRoot,
        resolveModule: (): string => {
          resolverCalls += 1;
          return wrapperPath;
        },
        sourcePaths: [declarationPath, wrapperPath],
      } as const;

      await cache.discover({
        ...baseOptions,
        snapshotSourceByPath: new Map<string, string>(),
      });
      const dirtyDeclaration = `${createDeclaration('./configured')}\n// unsaved`;
      const refreshed = await cache.discover({
        ...baseOptions,
        readSource: (sourcePath) => (sourcePath === declarationPath ? dirtyDeclaration : undefined),
        snapshotSourceByPath: new Map([[declarationPath, dirtyDeclaration]]),
      });

      expect(refreshed.evidence[0]?.sourcePath).toBe(declarationPath);
      expect(resolverCalls).toBe(2);
    } finally {
      cache.clear();
      await rm(projectRoot, { force: true, recursive: true });
    }
  });
});

/** Creates one ambient default-export mapping with stable length-sensitive edit variants. */
function createDeclaration(moduleSpecifier: string): string {
  return [
    'declare global {',
    `  var clock: typeof import(${JSON.stringify(moduleSpecifier)}).default;`,
    '}',
    'export {};',
  ].join('\n');
}
