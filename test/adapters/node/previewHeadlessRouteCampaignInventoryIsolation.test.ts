import { lstat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreviewBuildRequest } from '../../../src/domain/preview';
import type { PreviewInspectorCompleteRouteInventory } from '../../../src/adapters/esbuild/inspector/previewInspectorCompleteRouteInventory';
import { runPreviewHeadlessRouteCampaign } from '../../../src/adapters/node/previewHeadlessRouteCampaign';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('headless route campaign inventory isolation', () => {
  it('stages only after inventory worker release and never starts a route compiler', async () => {
    const directory = await createTemporaryDirectory();
    const artifactRoot = path.join(directory, 'staged');
    const ledgerPath = path.join(artifactRoot, 'routes.jsonl');
    const reportPath = path.join(artifactRoot, 'routes.json');
    const controller = new AbortController();
    let inventoryReleased = false;
    const collectCompleteRouteInventory = vi.fn(
      async (
        request: PreviewBuildRequest,
        limits: unknown,
        signal: AbortSignal | undefined,
      ) => {
        void request;
        void limits;
        expect(signal).toBe(controller.signal);
        expect(signal?.aborted).toBe(false);
        await expect(lstat(artifactRoot)).rejects.toMatchObject({ code: 'ENOENT' });
        inventoryReleased = true;
        return createInventory();
      },
    );
    const compile = vi.fn(() => Promise.reject(new Error('route worker must remain lazy')));

    const report = await runPreviewHeadlessRouteCampaign({
      compiler: { collectCompleteRouteInventory },
      ledgerPath,
      reportPath,
      request: createRequest(),
      routeCompiler: {
        compile,
        waitForCancellationRecovery: () => Promise.resolve(),
      },
      signal: controller.signal,
      stageOnly: true,
    });

    expect(inventoryReleased).toBe(true);
    expect(compile).not.toHaveBeenCalled();
    expect(report.results).toEqual([]);
    expect(report.summary.pending).toBe(0);
    expect((await lstat(ledgerPath)).isFile()).toBe(true);
    expect((await lstat(reportPath)).isFile()).toBe(true);
  });

  it('leaves the campaign artifact root absent when inventory fails', async () => {
    const directory = await createTemporaryDirectory();
    const artifactRoot = path.join(directory, 'never-created');

    await expect(
      runPreviewHeadlessRouteCampaign({
        compiler: {
          collectCompleteRouteInventory: () =>
            Promise.reject(new Error('stable inventory worker failure')),
        },
        ledgerPath: path.join(artifactRoot, 'routes.jsonl'),
        reportPath: path.join(artifactRoot, 'routes.json'),
        request: createRequest(),
        routeCompiler: {
          compile: () => Promise.reject(new Error('route worker must remain lazy')),
          waitForCancellationRecovery: () => Promise.resolve(),
        },
      }),
    ).rejects.toThrow('stable inventory worker failure');
    await expect(lstat(artifactRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects inherited heap-changing NODE_OPTIONS before inventory or artifact creation', async () => {
    const directory = await createTemporaryDirectory();
    const artifactRoot = path.join(directory, 'rejected-ambient-heap');
    const collectCompleteRouteInventory = vi.fn(() => Promise.resolve(createInventory()));
    vi.stubEnv('NODE_OPTIONS', '--max_old_space_size=4096');

    await expect(
      runPreviewHeadlessRouteCampaign({
        compiler: { collectCompleteRouteInventory },
        ledgerPath: path.join(artifactRoot, 'routes.jsonl'),
        reportPath: path.join(artifactRoot, 'routes.json'),
        request: createRequest(),
        routeCompiler: {
          compile: () => Promise.reject(new Error('route worker must remain lazy')),
          waitForCancellationRecovery: () => Promise.resolve(),
        },
      }),
    ).rejects.toThrow('rejects ambient Node heap overrides');
    expect(collectCompleteRouteInventory).not.toHaveBeenCalled();
    await expect(lstat(artifactRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

/** Creates one source-general immutable inventory request. */
function createRequest(): PreviewBuildRequest {
  return Object.freeze({
    dependencySnapshots: Object.freeze([]),
    documentPath: '/workspace/App.tsx',
    language: 'tsx',
    sourceText: 'export default function App() { return null; }',
    workspaceRoot: '/workspace',
  });
}

/** Creates an empty complete inventory that needs no route execution. */
function createInventory(): PreviewInspectorCompleteRouteInventory {
  return {
    analysisPasses: 1,
    complete: true,
    counts: { duplicate: 0, runnable: 0, total: 0, unresolved: 0 },
    dependencyPaths: [],
    entries: [],
    limits: { maximumAnalysisPasses: 1, maximumBranches: 1, maximumDepth: 1 },
    owner: { exportName: 'default', sourcePath: '/workspace/App.tsx' },
    predecessorVersion: 3,
    replayPasses: 0,
    replayPolicy: { digest: 'a'.repeat(64), predecessorVersion: 3, version: 4 },
    truncated: false,
    version: 4,
  };
}

/** Creates and tracks one disposable campaign directory. */
async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'react-preview-inventory-isolation-'));
  temporaryDirectories.push(directory);
  return directory;
}
