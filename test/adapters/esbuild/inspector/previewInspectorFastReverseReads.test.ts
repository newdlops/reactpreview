/** Parallel reverse reads preserve source admission order and settle siblings before failure. */
import type { Dirent } from 'node:fs';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { beforeEach, expect, it, vi } from 'vitest';
import { collectReverseClosure } from '../../../../src/adapters/esbuild/inspector/previewInspectorFastCorridorReverse';

const { readDirectory } = vi.hoisted(() => ({
  readDirectory: vi.fn<(file: string) => Promise<Dirent[]>>(),
}));
vi.mock(
  '../../../../src/adapters/esbuild/inspector/previewInspectorFastCorridorPaths',
  async (original) => ({
    ...(await original<
      typeof import('../../../../src/adapters/esbuild/inspector/previewInspectorFastCorridorPaths')
    >()),
    readDirectory,
  }),
);
const ROOT = '/virtual/preview-reverse-reads';
const DIRECTORY = ROOT + '/src/components';
const TARGET = DIRECTORY + '/Widget.tsx';
const OWNERS = Array.from(
  { length: 8 },
  (_, index) => DIRECTORY + '/Owner' + index.toString() + '.tsx',
);

/** A regular file fact is sufficient; no fixture directories or application modules are created. */
function entry(name: string): Dirent {
  return {
    name,
    parentPath: DIRECTORY,
    path: DIRECTORY,
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  };
}

beforeEach(() => {
  readDirectory.mockReset();
  readDirectory.mockImplementation((file) =>
    Promise.resolve(
      file === DIRECTORY ? OWNERS.map((owner) => entry(owner.slice(DIRECTORY.length + 1))) : [],
    ),
  );
});

for (const rejectFirst of [false, true]) {
  it(`settles eight bounded reads in reverse finish order, rejectFirst=${String(rejectFirst)}`, async () => {
    const pending = new Map<
      string,
      { readonly resolve: (source: string) => void; readonly reject: (error: Error) => void }
    >();
    const reads: string[] = [];
    let active = 0;
    let peak = 0;
    let settled = false;
    const task = collectReverseClosure({
      documentPath: TARGET,
      projectRoot: ROOT,
      workspaceRoot: ROOT,
      selectedPageConsumerPaths: [],
      snapshotPaths: [],
      targetedPagePaths: [],
      targetExportName: 'Widget',
      resolveModule: (specifier) => (specifier === './Widget' ? TARGET : undefined),
      readSource: (file) => {
        if (file === TARGET) return Promise.resolve('export const Widget=()=> <table/>;');
        reads.push(file);
        active += 1;
        peak = Math.max(peak, active);
        return new Promise<string>((resolve, reject) =>
          pending.set(file, { resolve, reject }),
        ).finally(() => {
          active -= 1;
        });
      },
    });
    const outcome = task.then(
      (value) => {
        settled = true;
        return { value };
      },
      (error: unknown) => {
        settled = true;
        return { error };
      },
    );
    await vi.waitFor(() => {
      expect(pending.size).toBe(8);
    });
    expect(reads).toEqual(OWNERS);
    expect(peak).toBe(8);
    const firstError = new Error('first source failed');
    if (rejectFirst) {
      pending.get(DIRECTORY + '/Owner0.tsx')?.reject(firstError);
      await yieldTurn();
      expect(active).toBe(7);
      expect(settled).toBe(false);
    }
    for (const owner of [...OWNERS].reverse()) {
      if (rejectFirst && owner === OWNERS[0]) continue;
      else
        pending
          .get(owner)
          ?.resolve(
            'import {Widget} from "./Widget";export const Owner=()=> <section><Widget/></section>;',
          );
    }
    const result = await outcome;
    expect(active).toBe(0);
    if (rejectFirst) expect(result).toEqual({ error: firstError });
    else {
      expect('value' in result && [...result.value.childByOwner.keys()]).toEqual(OWNERS);
      expect('value' in result && result.value.paths.size).toBe(9);
    }
  });
}

it('retains the existing 640-file ceiling without admitting a later batch', async () => {
  const target = ROOT + '/src/feature/components/Widget.tsx';
  const directories = [
    ROOT + '/src/feature/components',
    ROOT + '/src/feature',
    ROOT + '/src',
    ROOT,
  ];
  const ownersByDirectory = new Map(
    directories.map((directory, group) => [
      directory,
      Array.from(
        { length: group === 3 ? 74 : 192 },
        (_, index) => directory + '/Owner' + index.toString().padStart(3, '0') + '.tsx',
      ),
    ]),
  );
  const owners = [...ownersByDirectory.values()].flat();
  readDirectory.mockImplementation((file) =>
    Promise.resolve(
      (ownersByDirectory.get(file) ?? []).map((owner) => entry(owner.slice(file.length + 1))),
    ),
  );
  const reads: string[] = [];
  const result = await collectReverseClosure({
    documentPath: target,
    projectRoot: ROOT,
    workspaceRoot: ROOT,
    selectedPageConsumerPaths: [],
    snapshotPaths: [],
    targetedPagePaths: [],
    targetExportName: 'Widget',
    resolveModule: (specifier) => (specifier === '@components/Widget' ? target : undefined),
    readSource: (file) => {
      if (file === target) return Promise.resolve('export const Widget=()=> <table/>;');
      reads.push(file);
      return Promise.resolve(
        'import {Widget} from "@components/Widget";export const Owner=()=> <section><Widget/></section>;',
      );
    },
  });
  expect(reads).toEqual(owners.slice(0, 640));
  expect(result.paths.size).toBe(641);
  expect(result.truncated).toBe(true);
});

it('visits a late direct consumer before a deep first branch exhausts the directory ceiling', async () => {
  const target = ROOT + '/src/shared/Widget.tsx';
  const direct = ROOT + '/src/secondary/section.tsx';
  const page = ROOT + '/src/secondary/page.tsx';
  const owners = Array.from(
    { length: 50 },
    (_, index) => ROOT + '/src/primary/' + 'level/'.repeat(index + 1) + 'owner.tsx',
  );
  const sources = new Map([
    [target, 'export const Widget=()=> <table/>;'],
    [
      direct,
      'import {Widget} from "@target";export const Section=()=> <article><Widget/></article>;',
    ],
    [page, 'import {Section} from "@section";export const Page=()=> <main><Section/></main>;'],
    ...owners.map((file, index): [string, string] => [
      file,
      index === 0
        ? 'import {Widget} from "@target";export const Owner0=()=> <Widget/>;'
        : 'import {Owner' +
          (index - 1).toString() +
          '} from "@owner' +
          (index - 1).toString() +
          '";export const Owner' +
          index.toString() +
          '=()=> <Owner' +
          (index - 1).toString() +
          '/>;',
    ]),
  ]);
  const directories: string[] = [];
  readDirectory.mockImplementation((directory) => {
    directories.push(directory);
    return Promise.resolve(directory === ROOT + '/src/secondary' ? [entry('page.tsx')] : []);
  });
  const result = await collectReverseClosure({
    documentPath: target,
    projectRoot: ROOT,
    workspaceRoot: ROOT,
    selectedPageConsumerPaths: [],
    snapshotPaths: [],
    targetedPagePaths: [...owners, direct],
    targetExportName: 'Widget',
    readSource: (file) => Promise.resolve(sources.get(file)),
    resolveModule: (specifier) =>
      specifier === '@target'
        ? target
        : specifier === '@section'
          ? direct
          : /^@owner\d+$/u.test(specifier)
            ? owners[Number(specifier.slice(6))]
            : undefined,
  });
  expect(result.childByOwner.get(page)).toBe(direct);
  expect(result.paths).toContain(page);
  expect(directories.indexOf(ROOT + '/src/secondary')).toBeLessThan(
    directories.indexOf(ROOT + '/src/primary/level/level'),
  );
  expect(directories.length).toBeLessThanOrEqual(48);
  expect(result.truncated).toBe(true);
});
