/** Verifies that a test run removes the fixture directories and processes it leaves behind. */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFixtureNames, removeRunFixtures, stopRunProcesses } from './vitestTemporaryRoot';

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
