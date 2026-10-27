/** Real resolvers must share lookup facts per build and refresh filesystem evidence next build. */
import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPreviewStaticModuleResolver } from '../../../src/adapters/esbuild/previewStaticModuleResolver';
import {
  createPreviewResolutionFileSystem,
  PREVIEW_RESOLUTION_FILE_SYSTEM_CACHE_LIMIT,
} from '../../../src/adapters/esbuild/previewResolutionFileSystem';
import {
  createPreviewTypeProgram,
  PreviewTypeSourceFileCache,
} from '../../../src/adapters/esbuild/typeOracle/previewTypeProgram';
import { readPreviewTypedComponentProps } from '../../../src/adapters/esbuild/typeOracle/previewTypedComponentProps';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('build-owned resolution filesystem', () => {
  it('reuses the current target identity while runtime files stay independently canonicalized', async () => {
    const fixture = await createFixture();
    const target = path.join(fixture.packageRoot, 'item0.js');
    const canonical = vi.spyOn(realpathSync, 'native');
    const resolver = createPreviewStaticModuleResolver({ workspaceRoot: fixture.root });
    for (const consumer of fixture.consumers) {
      expect(resolver.matchesTarget('payload-kit/item0', consumer, target)).toBe(true);
      expect(resolver.resolve('payload-kit/item0', consumer)).toBe(target);
    }
    // Positive issuer answers share one runtime identity; the target keeps its independent check.
    expect(canonical.mock.calls.filter(([file]) => file === target)).toHaveLength(2);
  });

  it('changes reverse pivots and rechecks a target symlink in the next resolver', async () => {
    const fixture = await createFixture();
    const consumer = fixture.consumers[0];
    if (consumer === undefined) throw new Error('Missing fixture consumer');
    const first = path.join(fixture.packageRoot, 'item0.js');
    const second = path.join(fixture.packageRoot, 'item1.js');
    const target = path.join(fixture.root, 'selected.js');
    await symlink(first, target);
    const resolver = createPreviewStaticModuleResolver({ workspaceRoot: fixture.root });
    expect(resolver.matchesTarget('payload-kit/item0', consumer, target)).toBe(true);
    expect(resolver.matchesTarget('payload-kit/item0', consumer, second)).toBe(false);
    expect(resolver.matchesTarget('payload-kit/item1', consumer, second)).toBe(true);
    expect(resolver.matchesTarget('payload-kit/item0', consumer, target)).toBe(true);
    await rename(target, target + '-before');
    await symlink(second, target);
    const next = createPreviewStaticModuleResolver({ workspaceRoot: fixture.root });
    expect(next.matchesTarget('payload-kit/item0', consumer, target)).toBe(false);
    expect(next.matchesTarget('payload-kit/item1', consumer, target)).toBe(true);
  });

  it('keeps file and directory answers distinct and source reads current', async () => {
    const fixture = await createFixture();
    const filesystem = createPreviewResolutionFileSystem();
    expect(filesystem.fileExists(fixture.root)).toBe(false);
    expect(filesystem.directoryExists(fixture.root)).toBe(true);
    expect(filesystem.readFile(fixture.page)).toContain('export function Page');
    await writeFile(fixture.page, 'export const edited = true;');
    expect(filesystem.readFile(fixture.page)).toBe('export const edited = true;');
  });

  it('retains useful later lookups after an initial scan fills the shared storage cap', async () => {
    const fixture = await createFixture();
    const exists = vi.spyOn(ts.sys, 'directoryExists');
    const filesystem = createPreviewResolutionFileSystem();
    for (let index = 0; index < PREVIEW_RESOLUTION_FILE_SYSTEM_CACHE_LIMIT; index += 1) {
      expect(filesystem.fileExists(path.join(fixture.root, `absent-${String(index)}`))).toBe(false);
    }
    expect(filesystem.directoryExists(fixture.packageRoot)).toBe(true);
    expect(filesystem.directoryExists(fixture.packageRoot)).toBe(true);
    expect(filesystem.fileExists(fixture.page)).toBe(true);
    expect(
      exists.mock.calls.filter(([directory]) => directory === fixture.packageRoot),
    ).toHaveLength(1);
  });

  it('evicts the least recently used fact and retries it through the live host', () => {
    const exists = vi.spyOn(ts.sys, 'fileExists').mockReturnValue(false);
    const filesystem = createPreviewResolutionFileSystem();
    expect(filesystem.fileExists('/hot')).toBe(false);
    expect(filesystem.directoryExists('/missing-directory')).toBe(false);
    for (let index = 0; index < PREVIEW_RESOLUTION_FILE_SYSTEM_CACHE_LIMIT - 2; index += 1) {
      filesystem.fileExists(`/absent-${String(index)}`);
    }
    // A real hit protects hot from eviction; the directory slot is oldest across both kinds.
    expect(filesystem.fileExists('/hot')).toBe(false);
    filesystem.fileExists('/later');
    exists.mockReturnValue(true);
    expect(filesystem.fileExists('/hot')).toBe(false);
    expect(filesystem.fileExists('/absent-0')).toBe(false);
    filesystem.fileExists('/another');
    expect(filesystem.fileExists('/absent-1')).toBe(true);
    expect(exists.mock.calls.filter(([file]) => file === '/hot')).toHaveLength(1);
    expect(exists.mock.calls.filter(([file]) => file === '/absent-1')).toHaveLength(2);
  });

  it('keeps a repeatedly used fact during a one-time scan larger than the entire storage cap', () => {
    const exists = vi.spyOn(ts.sys, 'fileExists').mockReturnValue(false);
    const filesystem = createPreviewResolutionFileSystem();
    expect(filesystem.fileExists('/frequent')).toBe(false);
    expect(filesystem.fileExists('/frequent')).toBe(false);
    for (let index = 0; index < PREVIEW_RESOLUTION_FILE_SYSTEM_CACHE_LIMIT * 2; index += 1) {
      filesystem.fileExists(`/one-time-${String(index)}`);
    }
    exists.mockReturnValue(true);
    expect(filesystem.fileExists('/frequent')).toBe(false);
    expect(exists.mock.calls.filter(([file]) => file === '/frequent')).toHaveLength(1);
    expect(createPreviewResolutionFileSystem().fileExists('/frequent')).toBe(true);
  });

  it('shares nearest-config searches across siblings while preserving nested overrides and next-build discovery', async () => {
    const fixture = await createFixture();
    const directories = ['first/deep', 'second/deep', 'child/deep'].map((name) =>
      path.join(fixture.root, 'src', name),
    );
    for (const directory of directories) await mkdir(directory, { recursive: true });
    await writeFile(
      fixture.config,
      JSON.stringify({ compilerOptions: { jsxImportSource: 'root-jsx' } }),
    );
    await writeFile(
      path.join(fixture.root, 'src/child/tsconfig.json'),
      JSON.stringify({ compilerOptions: { jsxImportSource: 'child-jsx' } }),
    );
    const exists = vi.spyOn(ts.sys, 'fileExists');
    const resolver = createPreviewStaticModuleResolver({ workspaceRoot: fixture.root });
    const [first, second, child] = directories.map((directory) =>
      path.join(directory, 'consumer.tsx'),
    );
    if (first === undefined || second === undefined || child === undefined)
      throw new Error('Missing consumers');
    expect(resolver.getJsxImportSource(first)).toBe('root-jsx');
    expect(resolver.getJsxImportSource(second)).toBe('root-jsx');
    expect(resolver.getJsxImportSource(child)).toBe('child-jsx');
    expect(exists.mock.calls.filter(([file]) => file === fixture.config)).toHaveLength(1);
    await writeFile(
      path.join(fixture.root, 'src/second/tsconfig.json'),
      JSON.stringify({ compilerOptions: { jsxImportSource: 'second-jsx' } }),
    );
    expect(
      createPreviewStaticModuleResolver({ workspaceRoot: fixture.root }).getJsxImportSource(second),
    ).toBe('second-jsx');
  });

  it('retries a transient filesystem exception without remembering it as a missing file', () => {
    const exists = vi
      .spyOn(ts.sys, 'fileExists')
      .mockImplementationOnce(() => {
        throw new Error('transient lookup');
      })
      .mockReturnValue(true);
    const filesystem = createPreviewResolutionFileSystem();
    expect(() => filesystem.fileExists('/transient')).toThrow('transient lookup');
    expect(filesystem.fileExists('/transient')).toBe(true);
    expect(filesystem.fileExists('/transient')).toBe(true);
    expect(exists).toHaveBeenCalledTimes(2);
  });

  it('resolves real package subpaths while probing their shared directory once', async () => {
    const fixture = await createFixture();
    const observed: string[] = [];
    const directoryExists = ts.sys.directoryExists.bind(ts.sys);
    vi.spyOn(ts.sys, 'directoryExists').mockImplementation((directory) => {
      observed.push(directory);
      return directoryExists(directory);
    });
    const resolver = createPreviewStaticModuleResolver({ workspaceRoot: fixture.root });
    for (const [index, consumer] of fixture.consumers.entries()) {
      expect(resolver.resolve(`payload-kit/item${String(index)}`, consumer)).toBe(
        path.join(fixture.packageRoot, `item${String(index)}.js`),
      );
    }
    expect(observed.filter((directory) => directory === fixture.packageRoot)).toHaveLength(1);
  });

  it('preserves actual declared props while probing a package directory once per program', async () => {
    const fixture = await createFixture();
    const observed: string[] = [];
    const directoryExists = ts.sys.directoryExists.bind(ts.sys);
    vi.spyOn(ts.sys, 'directoryExists').mockImplementation((directory) => {
      observed.push(directory);
      return directoryExists(directory);
    });
    const program = createPreviewTypeProgram(
      {
        managedNodeModulesPaths: [],
        readSnapshot: () => undefined,
        rootPaths: [fixture.page],
        tsconfigPath: fixture.config,
      },
      new PreviewTypeSourceFileCache(),
    );
    const source = program.program.getSourceFile(fixture.page);
    if (source === undefined) throw new Error('Fixture page was not admitted');
    expect(readPreviewTypedComponentProps(program.checker, source, 'Page')).toEqual({
      first: 'first',
      second: 'second',
    });
    expect(observed.filter((directory) => directory === fixture.packageRoot)).toHaveLength(1);
  });

  it('observes a previously missing package when a new build resolver is created', async () => {
    const fixture = await createFixture();
    const initial = createPreviewStaticModuleResolver({ workspaceRoot: fixture.root });
    expect(initial.resolve('late-kit', fixture.page)).toBeUndefined();
    const late = path.join(fixture.root, 'node_modules', 'late-kit');
    await mkdir(late);
    await writeFile(path.join(late, 'package.json'), JSON.stringify({ main: 'index.js' }));
    await writeFile(path.join(late, 'index.js'), 'export default "late";');
    const rebuilt = createPreviewStaticModuleResolver({ workspaceRoot: fixture.root });
    expect(rebuilt.resolve('late-kit', fixture.page)).toBe(path.join(late, 'index.js'));
  });

  it('rechecks a package symlink and its runtime sibling for the next build resolver', async () => {
    const fixture = await createFixture();
    const second = path.join(fixture.root, 'packages', 'second');
    await mkdir(second, { recursive: true });
    await writeFile(
      path.join(second, 'package.json'),
      JSON.stringify({ name: 'payload-kit', types: 'item0.d.ts', main: 'item0.js' }),
    );
    await writeFile(path.join(second, 'item0.d.ts'), 'export declare const value: "changed";');
    await writeFile(path.join(second, 'item0.js'), 'export const value = "changed";');
    const logical = fixture.packageRoot;
    const original = logical + '-previous';
    await rename(logical, original);
    await symlink(original, logical);
    const first = createPreviewStaticModuleResolver({ workspaceRoot: fixture.root });
    expect(first.resolve('payload-kit/item0', fixture.page)).toBe(path.join(original, 'item0.js'));
    await rename(logical, logical + '-link-previous');
    await symlink(second, logical);
    const next = createPreviewStaticModuleResolver({ workspaceRoot: fixture.root });
    expect(next.resolve('payload-kit/item0', fixture.page)).toBe(path.join(second, 'item0.js'));
  });
});

/** Creates real package declarations, runtime siblings, and distinct importing directories. */
async function createFixture(): Promise<{
  readonly root: string;
  readonly packageRoot: string;
  readonly consumers: readonly string[];
  readonly page: string;
  readonly config: string;
}> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'preview-resolution-fs-')));
  roots.push(root);
  const packageRoot = path.join(root, 'node_modules', 'payload-kit');
  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({ name: 'payload-kit', type: 'module' }),
  );
  const consumers = [];
  for (const [index, value] of ['first', 'second'].entries()) {
    const consumer = path.join(root, 'src', String(index), 'consumer.ts');
    await mkdir(path.dirname(consumer), { recursive: true });
    await writeFile(consumer, `export { value } from 'payload-kit/item${String(index)}';`);
    await writeFile(
      path.join(packageRoot, `item${String(index)}.d.ts`),
      `export declare const value: '${value}';`,
    );
    await writeFile(
      path.join(packageRoot, `item${String(index)}.js`),
      `export const value = '${value}';`,
    );
    consumers.push(consumer);
  }
  const config = path.join(root, 'tsconfig.json');
  await writeFile(
    config,
    JSON.stringify({
      compilerOptions: { moduleResolution: 'Bundler', module: 'ESNext', strict: true },
    }),
  );
  const page = path.join(root, 'page.ts');
  await writeFile(
    page,
    "import { value as first } from './src/0/consumer'; import { value as second } from './src/1/consumer'; export function Page(props: { first: typeof first; second: typeof second }) { return null; }",
  );
  return { root, packageRoot, consumers, page, config };
}
