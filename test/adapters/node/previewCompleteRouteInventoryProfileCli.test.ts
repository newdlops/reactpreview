import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreviewBuildRequest } from '../../../src/domain/preview';
import {
  PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_MAXIMUM_EVENTS,
  PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_POLICY_DIGEST,
  PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_POLICY_VERSION,
  PreviewCompleteRouteInventoryTelemetryEvent,
  type PreviewInspectorCompleteRouteInventory,
  type PreviewInspectorCompleteRouteInventoryLimits,
} from '../../../src/adapters/esbuild/inspector/previewInspectorCompleteRouteInventory';
import {
  parsePreviewCompleteRouteInventoryProfileArguments,
  PREVIEW_COMPLETE_ROUTE_INVENTORY_PROFILE_CAP_MS,
  runPreviewCompleteRouteInventoryProfileCli,
  type PreviewCompleteRouteInventoryProfileDependencies,
} from '../../../src/adapters/node/previewCompleteRouteInventoryProfileCli';
import { PreviewCompleteRouteInventoryWorkerError } from '../../../src/adapters/worker/previewCompleteRouteInventoryWorkerClient';
import type { PreviewInspectorBundleDiagnostics } from '../../../src/adapters/esbuild/inspector/previewInspectorBundleDiagnostics';

afterEach(() => {
  vi.useRealTimers();
});

describe('complete route inventory profile CLI', () => {
  it('persists one analyzer-only header, progress trace, cleanup terminal, and inventory', async () => {
    const records: string[] = [];
    const makeDirectory = vi.fn(() => Promise.resolve());
    let capturedObserver:
      ((event: PreviewCompleteRouteInventoryTelemetryEvent) => void) | undefined;
    const collectCompleteRouteInventory = vi.fn(
      (
        _request: PreviewBuildRequest,
        _limits: Partial<PreviewInspectorCompleteRouteInventoryLimits> | undefined,
        _signal: AbortSignal | undefined,
      ): Promise<PreviewInspectorCompleteRouteInventory> => {
        void _request;
        void _limits;
        void _signal;
        return Promise.resolve(createInventory());
      },
    );
    const dependencies = createDependencies({
      createClient: (_workerPath, observer) => {
        capturedObserver = observer;
        return {
          collectCompleteRouteInventory: async (request, limits, signal) => {
            observer({
              cpuSystemMicros: 2,
              cpuUserMicros: 1,
              elapsedMs: 3,
              heapUsedBytes: 4,
              phase: 'prepare-source-index',
              rssBytes: 5,
              sequence: 1,
              transition: 'start',
              version: 4,
            });
            observer({
              bundleDiagnostics: createBundleDiagnostics(),
              cpuSystemMicros: 3,
              cpuUserMicros: 2,
              elapsedMs: 4,
              executionPlanCompleted: 0,
              executionPlanTotal: 1,
              heapUsedBytes: 5,
              phase: 'execution-frontier-bundle',
              routeOrdinal: 1,
              rssBytes: 6,
              sequence: 2,
              transition: 'complete',
              version: 4,
            });
            return collectCompleteRouteInventory(request, limits, signal);
          },
        };
      },
      makeDirectory,
      records,
    });

    await expect(
      runPreviewCompleteRouteInventoryProfileCli(
        createArguments(),
        '/worker/compiler-worker.cjs',
        dependencies,
      ),
    ).resolves.toBe(0);

    expect(makeDirectory).toHaveBeenCalledExactlyOnceWith('/profile-v5-5-8-test');
    expect(collectCompleteRouteInventory).toHaveBeenCalledOnce();
    const parsed = records.map((record) => JSON.parse(record) as Record<string, unknown>);
    expect(parsed).toHaveLength(4);
    expect(parsed[0]).toMatchObject({
      isolationPolicyVersion: 3,
      kind: 'header',
      maximumEvents: PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_MAXIMUM_EVENTS,
      noRetry: true,
      probeCapMs: 300_000,
      schemaVersion: 1,
      telemetryPolicyDigest: PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_POLICY_DIGEST,
      telemetryPolicyVersion: PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_POLICY_VERSION,
    });
    expect(parsed[1]).toMatchObject({
      event: { phase: 'prepare-source-index', sequence: 1 },
      kind: 'progress',
      schemaVersion: 1,
    });
    expect(parsed[2]).toMatchObject({
      event: {
        bundleDiagnostics: createBundleDiagnostics(),
        phase: 'execution-frontier-bundle',
        sequence: 2,
      },
      kind: 'progress',
      schemaVersion: 1,
    });
    expect(parsed[3]).toMatchObject({
      cleanupConfirmed: true,
      eventCount: 2,
      finalSequence: 2,
      kind: 'terminal',
      lastCounters: {
        executionPlanCompleted: 0,
        executionPlanTotal: 1,
        routeOrdinal: 1,
      },
      noRetry: true,
      status: 'completed',
    });
    expect(parsed[3]).toHaveProperty('inventory');
    expect(JSON.stringify(parsed[3])).not.toContain('bundleDiagnostics');
    expect(records.join('')).not.toMatch(/chromium|ledger|report|browser/iu);
    if (capturedObserver === undefined) throw new Error('Profile observer was not captured.');
    capturedObserver({
      cpuSystemMicros: 3,
      cpuUserMicros: 2,
      elapsedMs: 4,
      heapUsedBytes: 5,
      phase: 'shutdown',
      rssBytes: 6,
      sequence: 3,
      transition: 'start',
      version: 4,
    });
    expect(records).toHaveLength(4);
  });

  it('persists only the present phase-local prefix counters in canonical order', async () => {
    const cases: readonly {
      readonly event: PreviewCompleteRouteInventoryTelemetryEvent;
      readonly expected: Readonly<Record<string, number>>;
    }[] = [
      {
        event: {
          analysisPasses: 4,
          cpuSystemMicros: 2,
          cpuUserMicros: 1,
          discoveredBranches: 5,
          elapsedMs: 3,
          enumerationPrefixComputationCount: 3,
          enumerationPrefixEntryCount: 2,
          enumerationPrefixHitCount: 4,
          enumerationPrefixRequestCount: 7,
          heapUsedBytes: 4,
          phase: 'enumerate-branches',
          queuedSelections: 6,
          rssBytes: 5,
          sequence: 1,
          transition: 'complete',
          version: 4,
        },
        expected: {
          analysisPasses: 4,
          queuedSelections: 6,
          discoveredBranches: 5,
          enumerationPrefixRequestCount: 7,
          enumerationPrefixComputationCount: 3,
          enumerationPrefixHitCount: 4,
          enumerationPrefixEntryCount: 2,
        },
      },
      {
        event: {
          cpuSystemMicros: 2,
          cpuUserMicros: 1,
          elapsedMs: 3,
          heapUsedBytes: 4,
          phase: 'replay-branches',
          replayCompleted: 5,
          replayPrefixComputationCount: 2,
          replayPrefixEntryCount: 1,
          replayPrefixHitCount: 3,
          replayPrefixRequestCount: 5,
          replayTotal: 5,
          rssBytes: 5,
          sequence: 1,
          transition: 'complete',
          version: 4,
        },
        expected: {
          replayCompleted: 5,
          replayTotal: 5,
          replayPrefixRequestCount: 5,
          replayPrefixComputationCount: 2,
          replayPrefixHitCount: 3,
          replayPrefixEntryCount: 1,
        },
      },
    ];

    for (const scenario of cases) {
      const records: string[] = [];
      const dependencies = createDependencies({
        createClient: (_workerPath, observer) => ({
          collectCompleteRouteInventory: async () => {
            observer(scenario.event);
            return createInventory();
          },
        }),
        records,
      });
      await expect(
        runPreviewCompleteRouteInventoryProfileCli(
          createArguments(),
          '/worker/compiler-worker.cjs',
          dependencies,
        ),
      ).resolves.toBe(0);
      const terminal = JSON.parse(records.at(-1) ?? '{}') as {
        readonly lastCounters?: Readonly<Record<string, number>>;
      };
      expect(terminal.lastCounters).toEqual(scenario.expected);
      expect(Object.keys(terminal.lastCounters ?? {})).toEqual(Object.keys(scenario.expected));
      const serialized = JSON.stringify(terminal.lastCounters);
      expect(serialized).not.toMatch(/"(?:selection|prefixKey|sourcePath|state|error)":/iu);
    }
  });

  it('cancels once at the independent probe cap and persists one clean terminal', async () => {
    vi.useFakeTimers();
    const records: string[] = [];
    const collectCompleteRouteInventory = vi.fn(
      (_request, _limits, signal: AbortSignal | undefined) =>
        new Promise<PreviewInspectorCompleteRouteInventory>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              reject(
                new PreviewCompleteRouteInventoryWorkerError(
                  'preview-inventory-cancelled',
                  'synthetic profile cap',
                ),
              );
            },
            { once: true },
          );
        }),
    );
    const dependencies = createDependencies({
      createClient: () => ({ collectCompleteRouteInventory }),
      records,
    });
    const result = runPreviewCompleteRouteInventoryProfileCli(
      createArguments(),
      '/worker/compiler-worker.cjs',
      dependencies,
    );
    await vi.advanceTimersByTimeAsync(PREVIEW_COMPLETE_ROUTE_INVENTORY_PROFILE_CAP_MS);

    await expect(result).resolves.toBe(2);
    expect(collectCompleteRouteInventory).toHaveBeenCalledOnce();
    const terminals = records
      .map((record) => JSON.parse(record) as Record<string, unknown>)
      .filter((record) => record.kind === 'terminal');
    expect(terminals).toEqual([
      expect.objectContaining({
        cleanupConfirmed: true,
        failureCode: 'preview-inventory-cancelled',
        noRetry: true,
        status: 'probe-cancelled',
      }),
    ]);
  });

  it('treats protocol and persistence failures as terminal without retry', async () => {
    const protocolRecords: string[] = [];
    const protocolClient = vi.fn(() => ({
      collectCompleteRouteInventory: () =>
        Promise.reject(
          new PreviewCompleteRouteInventoryWorkerError(
            'preview-inventory-failed',
            'synthetic invalid progress',
          ),
        ),
    }));
    await expect(
      runPreviewCompleteRouteInventoryProfileCli(
        createArguments(),
        '/worker/compiler-worker.cjs',
        createDependencies({
          createClient: protocolClient,
          records: protocolRecords,
        }),
      ),
    ).resolves.toBe(1);
    expect(protocolClient).toHaveBeenCalledOnce();
    expect(JSON.parse(protocolRecords.at(-1) ?? '{}')).toMatchObject({
      cleanupConfirmed: true,
      failureCode: 'preview-inventory-failed',
      noRetry: true,
      status: 'failed',
    });

    const overflowRecords: string[] = [];
    const overflowClient = vi.fn(() => ({
      collectCompleteRouteInventory: () =>
        Promise.reject(
          new PreviewCompleteRouteInventoryWorkerError(
            'preview-inventory-failed',
            `Complete route inventory telemetry exceeded ${PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_MAXIMUM_EVENTS.toString()} events.`,
          ),
        ),
    }));
    await expect(
      runPreviewCompleteRouteInventoryProfileCli(
        createArguments(),
        '/worker/compiler-worker.cjs',
        createDependencies({
          createClient: overflowClient,
          records: overflowRecords,
        }),
      ),
    ).resolves.toBe(1);
    expect(overflowClient).toHaveBeenCalledOnce();
    expect(JSON.parse(overflowRecords.at(-1) ?? '{}')).toMatchObject({
      cleanupConfirmed: true,
      failureCode: 'telemetry-overflow',
      noRetry: true,
      status: 'failed',
    });

    const persistenceClient = vi.fn(
      (
        _workerPath: string,
        observer: (event: PreviewCompleteRouteInventoryTelemetryEvent) => void,
      ) => ({
        collectCompleteRouteInventory: (
          _request: PreviewBuildRequest,
          _limits: undefined,
          signal: AbortSignal | undefined,
        ) =>
          new Promise<PreviewInspectorCompleteRouteInventory>((_resolve, reject) => {
            signal?.addEventListener(
              'abort',
              () => {
                reject(
                  new PreviewCompleteRouteInventoryWorkerError(
                    'preview-inventory-cancelled',
                    'persistence failed',
                  ),
                );
              },
              { once: true },
            );
            observer({
              cpuSystemMicros: 2,
              cpuUserMicros: 1,
              elapsedMs: 3,
              heapUsedBytes: 4,
              phase: 'prepare-source-index',
              rssBytes: 5,
              sequence: 1,
              transition: 'start',
              version: 4,
            });
          }),
      }),
    );
    let appendCalls = 0;
    await expect(
      runPreviewCompleteRouteInventoryProfileCli(
        createArguments(),
        '/worker/compiler-worker.cjs',
        createDependencies({
          appendRecord: () => {
            appendCalls += 1;
            return appendCalls > 1
              ? Promise.reject(new Error('synthetic persistence failure'))
              : Promise.resolve();
          },
          createClient: persistenceClient,
          records: [],
        }),
      ),
    ).resolves.toBe(1);
    expect(persistenceClient).toHaveBeenCalledOnce();
  });

  it('rejects campaign arguments and requires the full frozen confinement identity', () => {
    expect(() =>
      parsePreviewCompleteRouteInventoryProfileArguments([
        ...createArguments(),
        '--chromium',
        '/Applications/Chromium.app',
      ]),
    ).toThrow('Unknown inventory profile argument: --chromium');
    expect(() =>
      parsePreviewCompleteRouteInventoryProfileArguments(
        createArguments().filter(
          (value) => value !== '--source-root' && value !== '/snapshot/source',
        ),
      ),
    ).toThrow('Missing inventory profile argument: --source-root');
  });
});

/** Creates deterministic I/O and timer seams without touching the filesystem. */
function createDependencies(options: {
  readonly appendRecord?: PreviewCompleteRouteInventoryProfileDependencies['appendRecord'];
  readonly createClient?: PreviewCompleteRouteInventoryProfileDependencies['createClient'];
  readonly makeDirectory?: PreviewCompleteRouteInventoryProfileDependencies['makeDirectory'];
  readonly records: string[];
}): PreviewCompleteRouteInventoryProfileDependencies {
  return {
    appendRecord:
      options.appendRecord ??
      ((_profilePath, record) => {
        options.records.push(record);
        return Promise.resolve();
      }),
    createClient:
      options.createClient ??
      (() => ({
        collectCompleteRouteInventory: () => Promise.resolve(createInventory()),
      })),
    makeDirectory: options.makeDirectory ?? (() => Promise.resolve()),
    readTarget: () => Promise.resolve('export default function App() { return null; }'),
    schedule: (listener, milliseconds) => setTimeout(listener, milliseconds),
    unschedule: (timer) => {
      clearTimeout(timer);
    },
  };
}

/** Supplies the exact analyzer-only frozen argument family. */
function createArguments(): readonly string[] {
  return [
    '--profile-root',
    '/profile-v5-5-8-test',
    '--workspace',
    '/snapshot/source/client',
    '--target',
    '/snapshot/source/client/App.tsx',
    '--source-root',
    '/snapshot/source',
    '--source-manifest-digest',
    'a'.repeat(64),
    '--dependency-view-digest',
    'b'.repeat(64),
    '--confinement-policy-digest',
    'c'.repeat(64),
    '--approved-dependency-root',
    '/approved/node_modules',
    '--production-aggregate',
    'd'.repeat(64),
  ];
}

/** Minimal genuinely complete inventory permitted in a completed terminal record. */
function createInventory(): PreviewInspectorCompleteRouteInventory {
  return {
    analysisPasses: 1,
    complete: true,
    counts: { duplicate: 0, runnable: 0, total: 0, unresolved: 0 },
    dependencyPaths: [],
    entries: [],
    limits: {
      maximumAnalysisPasses: 4_096,
      maximumBranches: 8_192,
      maximumDepth: 64,
    },
    owner: { exportName: 'default', sourcePath: '/snapshot/source/client/App.tsx' },
    predecessorVersion: 3,
    replayPasses: 0,
    replayPolicy: { digest: 'e'.repeat(64), predecessorVersion: 3, version: 4 },
    truncated: false,
    version: 4,
  };
}

/** Exact source-general diagnostics payload persisted only inside one progress record. */
function createBundleDiagnostics(): PreviewInspectorBundleDiagnostics {
  return {
    diagnosticsVersion: 1,
    bundleMeasuredMicros: 7,
    frontierCount: 1,
    rawSourceReadCount: 1,
    rawSourceReadMicros: 2,
    inventoryReadRequestCount: 2,
    inventoryReadPathCacheHitCount: 1,
    sliceRequestCount: 2,
    sliceComputationCount: 1,
    sliceHitCount: 1,
    sliceLookupMicros: 3,
    inventoryRequestCount: 4,
    inventoryComputationCount: 2,
    inventoryHitCount: 2,
    inventoryLookupMicros: 4,
    queueIterationCount: 2,
    queuePeakLength: 3,
    queueSortCount: 2,
    queueSortMicros: 5,
    edgeVisitCount: 6,
    optionalClosureProbeCount: 1,
    optionalClosureMicros: 6,
    resolveModuleCount: 2,
    resolveModuleMicros: 7,
    authoredPathCheckCount: 3,
    authoredPathCheckMicros: 8,
    frontierFinalizeMicros: 9,
    frontierIdentityMicros: 4,
    candidateSelectionSortCount: 1,
    candidateSelectionMicros: 5,
  };
}
