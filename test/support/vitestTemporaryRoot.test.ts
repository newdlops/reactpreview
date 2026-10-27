/** Verifies that a test run removes the fixture directories and processes it leaves behind. */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  readFixtureNames,
  removeRunFixtures,
  selectRunProcessIds,
  stopRunProcesses,
} from './vitestTemporaryRoot';

describe('run process selection', () => {
  const root = path.join(os.tmpdir(), 'react-preview-test-run-AbC123');

  it('retains real path arguments while excluding neighboring root names and inline text', () => {
    const listing = [
      `101 chromium --user-data-dir=${path.join(root, 'profile')}`,
      `102 node ${root}`,
      `103 node ${path.join(root, 'fixture.js')}`,
      `104 node --import=${pathToFileURL(path.join(root, 'fixture.mjs')).href}`,
      `201 chromium --user-data-dir=${root}-neighbor/profile`,
      `202 node ${root}.backup/fixture.js`,
      `203 node -e "console.log('${path.join(root, 'profile')}')"`,
      `204 node --message=prefix${path.join(root, 'profile')}`,
    ].join('\n');

    expect(selectRunProcessIds(root, listing, 999)).toEqual([101, 102, 103, 104]);
  });

  it('rejects unsafe ids, the caller, and malformed listing rows', () => {
    const listing = [
      `0 node ${root}`,
      `1 node ${root}`,
      `42 node ${root}`,
      `9007199254740992 node ${root}`,
      `invalid node ${root}`,
      `101 node ${path.join(root, 'profile')}`,
      `101 node ${path.join(root, 'profile')}`,
    ].join('\n');

    expect(selectRunProcessIds(root, listing, 42)).toEqual([101]);
  });

  it('rejects empty, relative, and filesystem roots', () => {
    const listing = `101 node ${root}`;
    for (const unsafeRoot of [
      '',
      'relative-root',
      path.parse(root).root,
      path.join(path.parse(root).root, 'tmp'),
    ]) {
      expect(selectRunProcessIds(unsafeRoot, listing, 999)).toEqual([]);
    }
  });

  it('treats spaces and pattern characters in a run root literally', () => {
    const unusualRoot = path.join(os.tmpdir(), 'run + [literal]-AbC123');
    const listing = [
      `101 chromium --user-data-dir=${path.join(unusualRoot, 'profile')}`,
      `102 node --import=${pathToFileURL(path.join(unusualRoot, 'fixture.mjs')).href}`,
    ].join('\n');
    expect(selectRunProcessIds(`${unusualRoot}${path.sep}`, listing, 999)).toEqual([101, 102]);
  });
});

describe('vitest temporary root teardown', () => {
  /** A timed-out compiler test left `next-app-fast-generated-XXXXXX` behind and broke packaging. */
  it('removes only mkdtemp fixture directories created during the run', async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'fixture-root-'));
    try {
      await mkdir(path.join(fixtureRoot, 'react-router'));
      await mkdir(path.join(fixtureRoot, 'older-run-AbC123'));
      const before = await readFixtureNames(fixtureRoot);
      await mkdir(path.join(fixtureRoot, 'next-app-fast-generated-1zpAC7'));
      await mkdir(path.join(fixtureRoot, 'hand-made-fixture'));

      await removeRunFixtures(fixtureRoot, before);

      expect((await readdir(fixtureRoot)).sort()).toEqual([
        'hand-made-fixture',
        'older-run-AbC123',
        'react-router',
      ]);
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });

  /** An orphaned headless Chromium kept its profile path inside the run root after its worker stopped. */
  it('stops processes whose command line names the run root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'run-root-'));
    const child = spawn(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 30000)', path.join(root, 'profile')],
      { stdio: 'ignore' },
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const exited = new Promise<NodeJS.Signals | null>((resolve) => {
        child.once('exit', (_code, signal) => {
          resolve(signal);
        });
      });

      stopRunProcesses(root);

      expect(await exited).toBe('SIGKILL');
    } finally {
      child.kill('SIGKILL');
      await rm(root, { force: true, recursive: true });
    }
  });
});
