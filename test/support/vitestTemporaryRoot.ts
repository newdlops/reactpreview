/**
 * Gives one test run its own temporary root and removes it when the run ends.
 *
 * Many compiler and Inspector tests create workspaces with `mkdtemp(os.tmpdir())`, and a test that
 * fails or times out skips its own cleanup. Pointing `TMPDIR` at a run-scoped directory before the
 * workers start keeps every such workspace (and headless browser profile) inside one directory that
 * is deleted at teardown, so repeated runs no longer accumulate hundreds of megabytes in the
 * system temporary directory.
 *
 * Two leftovers escaped that directory when a loaded machine timed tests out: workspaces that must
 * resolve the repository's own `node_modules` are created as `test/fixtures/<name>-XXXXXX`, and a
 * headless Chromium whose worker was stopped kept running with its profile inside the run root.
 * A stale fixture with TypeScript sources then broke the packaging typecheck. Teardown therefore
 * also removes fixture directories this run created and stops processes started for this run.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository directory where some tests create `mkdtemp` workspaces next to real fixtures. */
const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/', import.meta.url));

/** The six-character suffix `mkdtemp` appends; only names absent before the run are removed. */
const TEMPORARY_FIXTURE_NAME = /-[A-Za-z0-9]{6}$/u;

/** Lists directory entry names, or none when the directory cannot be read. */
export async function readFixtureNames(fixtureRoot: string): Promise<ReadonlySet<string>> {
  try {
    return new Set(await readdir(fixtureRoot));
  } catch {
    return new Set();
  }
}

/** Removes `mkdtemp` fixture directories that appeared since `before` was read. */
export async function removeRunFixtures(
  fixtureRoot: string,
  before: ReadonlySet<string>,
): Promise<void> {
  for (const name of await readFixtureNames(fixtureRoot)) {
    if (before.has(name) || !TEMPORARY_FIXTURE_NAME.test(name)) continue;
    await rm(path.join(fixtureRoot, name), { force: true, maxRetries: 3, recursive: true });
  }
}

/**
 * Stops processes whose command line names this run's root, such as a headless Chromium profile
 * left behind by a timed-out worker. Nothing outside the run-scoped directory can match.
 */
export function stopRunProcesses(root: string): void {
  if (process.platform === 'win32') return;
  let listing: string;
  try {
    listing = execFileSync('ps', ['-Ao', 'pid=,command='], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return;
  }
  for (const line of listing.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/u.exec(line);
    const pid = Number(match?.[1]);
    if (match?.[2]?.includes(root) !== true || !Number.isSafeInteger(pid) || pid === process.pid) {
      continue;
    }
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // The process already exited.
    }
  }
}

/**
 * Creates the run-scoped temporary root.
 *
 * @returns Teardown that stops this run's processes and removes its leftovers.
 */
export async function setup(): Promise<() => Promise<void>> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'react-preview-test-run-'));
  const fixturesBefore = await readFixtureNames(FIXTURE_ROOT);
  process.env.TMPDIR = root;
  return async () => {
    stopRunProcesses(root);
    await removeRunFixtures(FIXTURE_ROOT, fixturesBefore);
    await rm(root, { force: true, maxRetries: 3, recursive: true });
  };
}
