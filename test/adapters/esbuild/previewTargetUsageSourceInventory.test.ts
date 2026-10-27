/** Parallel directory reads must preserve lexical admission, package boundaries and cancellation. */
import type { Dirent } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { collectPreviewTargetUsageSourcePaths } from '../../../src/adapters/esbuild/previewTargetUsageProps';

const { readDirectory } = vi.hoisted(() => ({
  readDirectory: vi.fn<(file: string) => Promise<Dirent[]>>(),
}));
vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
  readdir: readDirectory,
}));
const ROOT = '/virtual/preview-source-inventory';
const options = { workspaceRoot: ROOT, projectRoot: ROOT };

/** Supplies only filesystem classification; source files and symlink destinations never execute. */
function entry(name: string, kind: 'file' | 'directory' | 'symlink' = 'file'): Dirent {
  return {
    name,
    parentPath: ROOT,
    path: ROOT,
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'directory',
    isSymbolicLink: () => kind === 'symlink',
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  };
}

/** Defers four real directory promises so completion order and in-flight ownership are observable. */
function createControlledReads(): {
  readonly pending: Map<string, (entries: Dirent[]) => void>;
  readonly active: () => number;
  readonly peak: () => number;
} {
  const pending = new Map<string, (entries: Dirent[]) => void>();
  let active = 0;
  let peak = 0;
  readDirectory.mockImplementation((file) => {
    if (file === ROOT)
      return Promise.resolve(['d', 'b', 'a', 'c'].map((name) => entry(name, 'directory')));
    if (file === ROOT + '/a/inside') return Promise.resolve([entry('nested.tsx')]);
    active += 1;
    peak = Math.max(peak, active);
    return new Promise<Dirent[]>((resolve) => pending.set(file, resolve)).finally(() => {
      active -= 1;
    });
  });
  return { pending, active: () => active, peak: () => peak };
}

beforeEach(() => {
  readDirectory.mockReset();
});

it('overlaps at most four reads while new descendants retain their original lexical position', async () => {
  const reads = createControlledReads();
  const task = collectPreviewTargetUsageSourcePaths(options);
  await vi.waitFor(() => {
    expect(reads.pending.size).toBe(4);
  });
  expect(reads.peak()).toBe(4);
  for (const name of ['d', 'c', 'b'])
    reads.pending.get(ROOT + '/' + name)?.([entry(name + '.tsx')]);
  reads.pending.get(ROOT + '/a')?.([entry('inside', 'directory'), entry('own.tsx')]);
  expect(await task).toEqual([
    ROOT + '/a/inside/nested.tsx',
    ROOT + '/a/own.tsx',
    ROOT + '/b/b.tsx',
    ROOT + '/c/c.tsx',
    ROOT + '/d/d.tsx',
  ]);
  expect(reads.active()).toBe(0);
  expect(new Set(readDirectory.mock.calls.map(([file]) => file)).size).toBe(
    readDirectory.mock.calls.length,
  );
});

it('settles admitted reads on cancellation and never starts newly discovered descendants', async () => {
  const reads = createControlledReads();
  const signal = new AbortController();
  const task = collectPreviewTargetUsageSourcePaths({ ...options, signal: signal.signal });
  const outcome = task.then(
    () => undefined,
    (error: unknown) => error,
  );
  await vi.waitFor(() => {
    expect(reads.pending.size).toBe(4);
  });
  signal.abort();
  reads.pending.get(ROOT + '/a')?.([entry('inside', 'directory')]);
  for (const name of ['b', 'c', 'd']) reads.pending.get(ROOT + '/' + name)?.([]);
  expect(await outcome).toMatchObject({ name: 'PreviewBuildCancelledError' });
  expect(reads.active()).toBe(0);
  expect(readDirectory.mock.calls.map(([file]) => file)).not.toContain(ROOT + '/a/inside');
});

it('keeps the exact 16384-file prefix even when a later directory has already finished', async () => {
  readDirectory.mockImplementation((file) => {
    if (file === ROOT)
      return Promise.resolve([entry('a', 'directory'), entry('b', 'directory'), entry('root.tsx')]);
    if (file === ROOT + '/a')
      return Promise.resolve([
        entry('inside', 'directory'),
        ...Array.from({ length: 16_382 }, (_, index) =>
          entry(index.toString().padStart(5, '0') + '.ts'),
        ),
      ]);
    if (file === ROOT + '/a/inside')
      return Promise.resolve([entry('first.tsx'), entry('second.tsx')]);
    return Promise.resolve([entry('must-not-displace.tsx')]);
  });
  const result = await collectPreviewTargetUsageSourcePaths(options);
  expect(result).toHaveLength(16_384);
  expect(result).toContain(ROOT + '/root.tsx');
  expect(result).toContain(ROOT + '/a/inside/first.tsx');
  expect(result).not.toContain(ROOT + '/a/inside/second.tsx');
  expect(result).not.toContain(ROOT + '/b/must-not-displace.tsx');
});

it('skips unreadable, ignored and symlink directories without broadening the trusted inventory', async () => {
  readDirectory.mockImplementation((file) => {
    if (file === ROOT)
      return Promise.resolve([
        entry('bad', 'directory'),
        entry('src', 'directory'),
        entry('node_modules', 'directory'),
        entry('.tmp', 'directory'),
        entry('outside-link', 'symlink'),
        entry('image.png'),
      ]);
    if (file === ROOT + '/bad') return Promise.reject(new Error('unreadable'));
    if (file === ROOT + '/src') return Promise.resolve([entry('Page.tsx'), entry('code.mts')]);
    throw new Error('An excluded directory was read');
  });
  expect(await collectPreviewTargetUsageSourcePaths(options)).toEqual([
    ROOT + '/src/Page.tsx',
    ROOT + '/src/code.mts',
  ]);
  expect(readDirectory.mock.calls.map(([file]) => file).sort()).toEqual([
    ROOT,
    ROOT + '/bad',
    ROOT + '/src',
  ]);
});
