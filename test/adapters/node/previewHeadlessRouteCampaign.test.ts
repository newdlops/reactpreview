import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreviewCompiler } from '../../../src/application/previewCompiler';
import {
  PreviewRouteExecutionPlanInvariantError,
  type PreviewBuildRequest,
  type PreviewBundle,
} from '../../../src/domain/preview';
import type { PreviewBuildExecutionContext } from '../../../src/domain/previewBuildExecution';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';
import {
  PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_DIGEST,
  type PreviewInspectorCompleteRouteInventory,
  type PreviewInspectorCompleteRunnableRoute,
} from '../../../src/adapters/esbuild/inspector/previewInspectorCompleteRouteInventory';
import { PREVIEW_ABSENCE_EXECUTION_ROOT_POLICY_DIGEST } from '../../../src/adapters/esbuild/inspector/previewInspectorExecutionRootModuleContract';
import { PREVIEW_METAFILE_DEPENDENCY_RECOVERY_POLICY_DIGEST } from '../../../src/adapters/esbuild/previewBuildResult';
import { PREVIEW_TARGET_FACADE_OWNERSHIP_POLICY_DIGEST } from '../../../src/adapters/esbuild/inspector/previewInspectorTargetModuleContract';
import { PREVIEW_OWNED_NAMESPACE_POLICY_DIGEST } from '../../../src/adapters/esbuild/previewOwnedNamespaceRegistry';
import { PREVIEW_SYNTHETIC_INPUT_POLICY_DIGEST } from '../../../src/adapters/esbuild/previewSyntheticInputRegistry';
import { PREVIEW_ROUTE_EXECUTION_PLAN_POLICY_DIGEST } from '../../../src/adapters/esbuild/previewRouteExecutionPlan';
import {
  deserializePreviewCompilerWorkerError,
  serializePreviewCompilerWorkerError,
} from '../../../src/adapters/worker/previewCompilerWorkerProtocol';
import {
  PREVIEW_INVENTORY_COMPILER_ISOLATION_POLICY_DIGEST,
  PREVIEW_INVENTORY_COMPILER_ISOLATION_POLICY_VERSION,
} from '../../../src/adapters/worker/previewCompilerWorkerIsolation';
import { PREVIEW_MANAGED_CHILD_ENVIRONMENT_POLICY_DIGEST } from '../../../src/adapters/node/previewManagedChildEnvironment';
import type { PreviewHeadlessResult } from '../../../src/adapters/node/previewHeadlessRenderer';
import {
  formatPreviewHeadlessRouteCampaignSummary,
  runPreviewHeadlessRouteCampaign,
  type PreviewHeadlessRouteCampaignCompiler,
  type PreviewHeadlessRouteCampaignIsolatedCompiler,
  type RunPreviewHeadlessRouteCampaignOptions,
} from '../../../src/adapters/node/previewHeadlessRouteCampaign';
import { createRealPreviewCompilerCampaignFixture } from '../../support/realPreviewCompilerCampaignFixture';
import { createPreviewRouteExecutionPlanFixture } from '../../support/previewRouteExecutionPlanFixture';

const temporaryDirectories: string[] = [];
const SYNTHETIC_SCALE_ROUTE_COUNT = 37;
const recoverCancellation = (): Promise<void> => Promise.resolve();

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('headless route campaign v5.5.6', () => {
  it('uses one mode-free analysis request and adds selected-leaf ownership only per route', async () => {
    const directory = await createTemporaryDirectory();
    const inventoryCompiler = createInventoryCompiler(createInventory(1));
    const collectInventory = vi.spyOn(inventoryCompiler, 'collectCompleteRouteInventory');
    const compile = vi.fn((request: PreviewBuildRequest) => {
      void request;
      return Promise.resolve(createBundle());
    });
    const staleSelection = Object.freeze([
      Object.freeze({ componentName: 'Stale', pattern: '/stale' }),
    ]);
    const request = Object.freeze({
      ...createRequest(),
      inspectorRouteSelection: staleSelection,
      inspectorTargetMode: 'selected-route-leaf' as const,
    });
    const options = {
      ...createOptions(directory, inventoryCompiler, {
        compile,
        waitForCancellationRecovery: recoverCancellation,
      }),
      request,
    };
    await runPreviewHeadlessRouteCampaign(options);

    const analysisRequest = collectInventory.mock.calls[0]?.[0];
    expect(analysisRequest).toMatchObject({
      documentPath: request.documentPath,
      renderMode: 'page-inspector',
      sourceText: request.sourceText,
    });
    expect(Object.hasOwn(analysisRequest ?? {}, 'inspectorRouteSelection')).toBe(false);
    expect(Object.hasOwn(analysisRequest ?? {}, 'inspectorTargetMode')).toBe(false);
    expect(Object.hasOwn(analysisRequest ?? {}, 'routeExecutionPlan')).toBe(false);
    expect(Object.isFrozen(analysisRequest)).toBe(true);
    expect(compile).toHaveBeenCalledTimes(1);
    expect(compile.mock.calls[0]?.[0]).toMatchObject({
      inspectorRouteSelection: [{ componentName: 'First', pattern: '/first' }],
      inspectorTargetMode: 'selected-route-leaf',
      renderMode: 'page-inspector',
    });
    expect(compile.mock.calls[0]?.[0].routeExecutionPlan?.routeId).toBe('first');

    const cleanDirectory = await createTemporaryDirectory();
    const aborted = new AbortController();
    aborted.abort();
    const cleanOptions = {
      ...createOptions(
        cleanDirectory,
        createInventoryCompiler(createInventory(1)),
        createReadyCompiler(),
      ),
      signal: aborted.signal,
    };
    await runPreviewHeadlessRouteCampaign(cleanOptions);
    const dirtyHeader = JSON.parse(
      (await readFile(options.ledgerPath, 'utf8')).split('\n')[0] ?? '{}',
    ) as { requestDigest: string };
    const cleanHeader = JSON.parse(
      (await readFile(cleanOptions.ledgerPath, 'utf8')).split('\n')[0] ?? '{}',
    ) as { requestDigest: string };
    expect(dirtyHeader.requestDigest).toBe(cleanHeader.requestDigest);
  });

  it('durably stops after a real compiler planner invariant crosses the worker protocol', async () => {
    const directory = await createTemporaryDirectory();
    const fixture = await createRealPreviewCompilerCampaignFixture();
    temporaryDirectories.push(fixture.projectRoot);
    const realCompiler = new EsbuildPreviewCompiler();
    try {
      const inventory = await realCompiler.collectCompleteRouteInventory(fixture.request);
      const runnableCount = inventory.entries.filter(
        (entry) => entry.disposition === 'runnable',
      ).length;
      expect(runnableCount).toBeGreaterThan(1);
      let realPlannerFailure: PreviewRouteExecutionPlanInvariantError | undefined;
      const compile = vi.fn(
        (request: PreviewBuildRequest, context?: PreviewBuildExecutionContext) =>
          realCompiler
            .compile(
              {
                ...request,
                inspectorRouteSelection: [
                  { componentName: 'UnavailableRoute', pattern: '/unavailable-route' },
                ],
              },
              context,
            )
            .catch((error: unknown) => {
              if (!(error instanceof PreviewRouteExecutionPlanInvariantError)) throw error;
              realPlannerFailure = error;
              throw deserializePreviewCompilerWorkerError(
                serializePreviewCompilerWorkerError(error),
              );
            }),
      );
      const browserCall = vi.fn(() => Promise.resolve(createHeadlessResult('ready')));
      const options = {
        ...createOptions(directory, realCompiler, {
          compile,
          waitForCancellationRecovery: recoverCancellation,
        }),
        renderRoute: async (candidateCompiler: PreviewCompiler, request: PreviewBuildRequest) => {
          await candidateCompiler.compile(request);
          return browserCall();
        },
        request: fixture.request,
      };

      const report = await runPreviewHeadlessRouteCampaign(options);
      expect(realPlannerFailure).toBeInstanceOf(PreviewRouteExecutionPlanInvariantError);
      expect(realPlannerFailure?.evidence).toMatchObject({
        mismatchField: 'routeSelectionResolution',
        requestedResolution: 'exact',
      });
      expect(compile).toHaveBeenCalledTimes(1);
      expect(browserCall).not.toHaveBeenCalled();
      expect(report.results).toEqual([
        expect.objectContaining({
          routeExecutionPlanInvariantEvidence: realPlannerFailure?.evidence,
          status: 'execution-plan-invariant',
        }),
      ]);
      expect(report.results).toHaveLength(1);
      expect(report.summary.pending).toBe(runnableCount - 1);
      expect(report.summary.pending).toBeGreaterThan(0);
      const ledgerLines = (await readFile(options.ledgerPath, 'utf8'))
        .split('\n')
        .filter(Boolean);
      expect(ledgerLines).toHaveLength(2);
      const durableReport = JSON.parse(await readFile(options.reportPath, 'utf8')) as {
        readonly results: readonly { readonly status: string }[];
      };
      expect(
        durableReport.results.filter((record) => record.status === 'execution-plan-invariant'),
      ).toHaveLength(1);
    } finally {
      await realCompiler.shutdown();
    }
  });

  it('stages a fresh synthetic route root without predecessor or retry identity', async () => {
    const directory = await createTemporaryDirectory();
    const aborted = new AbortController();
    aborted.abort();
    const options = {
      ...createOptions(
        directory,
        createInventoryCompiler(createLargeInventory(SYNTHETIC_SCALE_ROUTE_COUNT)),
        createReadyCompiler(),
      ),
      signal: aborted.signal,
    };
    const report = await runPreviewHeadlessRouteCampaign(options);
    const ledgerLines = (await readFile(options.ledgerPath, 'utf8')).split('\n').filter(Boolean);
    const header = JSON.parse(ledgerLines[0] ?? '{}') as Record<string, unknown>;

    expect(report.results).toEqual([]);
    expect(report.routeIds).toEqual([]);
    expect(report.retryRouteIds).toEqual([]);
    expect(report).not.toHaveProperty('predecessorLedgerDigest');
    expect(report.summary).toMatchObject({
      pending: SYNTHETIC_SCALE_ROUTE_COUNT,
      resumed: 0,
      runnable: SYNTHETIC_SCALE_ROUTE_COUNT,
    });
    expect(ledgerLines).toHaveLength(1);
    expect(header).toMatchObject({
      absenceExecutionRootPolicyDigest: PREVIEW_ABSENCE_EXECUTION_ROOT_POLICY_DIGEST,
      kind: 'header',
      managedChildEnvironmentPolicyDigest: PREVIEW_MANAGED_CHILD_ENVIRONMENT_POLICY_DIGEST,
      metafileDependencyRecoveryPolicyDigest: PREVIEW_METAFILE_DEPENDENCY_RECOVERY_POLICY_DIGEST,
      namespaceConfinementPolicyDigest: PREVIEW_OWNED_NAMESPACE_POLICY_DIGEST,
      routeIds: [],
      retryRouteIds: [],
      targetFacadeOwnershipPolicyDigest: PREVIEW_TARGET_FACADE_OWNERSHIP_POLICY_DIGEST,
      executionPlanPolicyDigest: PREVIEW_ROUTE_EXECUTION_PLAN_POLICY_DIGEST,
      inventoryCompilerIsolationPolicyDigest:
        PREVIEW_INVENTORY_COMPILER_ISOLATION_POLICY_DIGEST,
      inventoryCompilerIsolationPolicyVersion:
        PREVIEW_INVENTORY_COMPILER_ISOLATION_POLICY_VERSION,
      version: 7,
    });
    expect(report.namespaceConfinementPolicyDigest).toBe(PREVIEW_OWNED_NAMESPACE_POLICY_DIGEST);
    expect(report.managedChildEnvironmentPolicyDigest).toBe(
      PREVIEW_MANAGED_CHILD_ENVIRONMENT_POLICY_DIGEST,
    );
    expect(report.inventoryCompilerIsolationPolicyDigest).toBe(
      PREVIEW_INVENTORY_COMPILER_ISOLATION_POLICY_DIGEST,
    );
    expect(report.inventoryCompilerIsolationPolicyVersion).toBe(
      PREVIEW_INVENTORY_COMPILER_ISOLATION_POLICY_VERSION,
    );
    expect(header.syntheticInputPolicyDigest).toBe(PREVIEW_SYNTHETIC_INPUT_POLICY_DIGEST);
    expect(report.syntheticInputPolicyDigest).toBe(PREVIEW_SYNTHETIC_INPUT_POLICY_DIGEST);
    expect(report.targetFacadeOwnershipPolicyDigest).toBe(
      PREVIEW_TARGET_FACADE_OWNERSHIP_POLICY_DIGEST,
    );
    expect(report.absenceExecutionRootPolicyDigest).toBe(
      PREVIEW_ABSENCE_EXECUTION_ROOT_POLICY_DIGEST,
    );
    expect(report.metafileDependencyRecoveryPolicyDigest).toBe(
      PREVIEW_METAFILE_DEPENDENCY_RECOVERY_POLICY_DIGEST,
    );
    expect(header).not.toHaveProperty('predecessorLedgerDigest');
  });

  it('stops at maxRoutes without starting another route and preserves full pending math', async () => {
    const directory = await createTemporaryDirectory();
    const compile = vi.fn(() => Promise.resolve(createBundle()));
    const options = {
      ...createOptions(directory, createInventoryCompiler(), {
        compile,
        waitForCancellationRecovery: recoverCancellation,
      }),
      maxRoutes: 2,
    };

    const report = await runPreviewHeadlessRouteCampaign(options);
    const header = JSON.parse(
      (await readFile(options.ledgerPath, 'utf8')).split('\n')[0] ?? '{}',
    ) as Record<string, unknown>;

    expect(compile).toHaveBeenCalledTimes(2);
    expect(report.results.map((record) => record.routeId)).toEqual(['first', 'second']);
    expect(report).toMatchObject({ maxRoutes: 2, routeIds: [] });
    expect(report.summary).toMatchObject({ pending: 1, runnable: 3 });
    expect(header).toMatchObject({ maxRoutes: 2, routeIds: [] });
  });

  it('resumes an interrupted maxRoutes ledger up to the same durable total limit', async () => {
    const directory = await createTemporaryDirectory();
    const controller = new AbortController();
    controller.abort();
    const compile = vi.fn(() => Promise.resolve(createBundle()));
    const staged = {
      ...createOptions(directory, createInventoryCompiler(createLargeInventory(5)), {
        compile,
        waitForCancellationRecovery: recoverCancellation,
      }),
      maxRoutes: 4,
      signal: controller.signal,
    };
    await runPreviewHeadlessRouteCampaign(staged);
    const interruptedRecords = [
      createV7Record('route-0', 'ready'),
      createV7Record('route-1', 'ready'),
    ];
    await writeFile(
      staged.ledgerPath,
      `${await readFile(staged.ledgerPath, 'utf8')}${interruptedRecords
        .map((record) => JSON.stringify(record))
        .join('\n')}\n`,
      'utf8',
    );

    const { signal: interruptedSignal, ...resumeOptions } = staged;
    expect(interruptedSignal).toBe(controller.signal);
    const report = await runPreviewHeadlessRouteCampaign(resumeOptions);

    expect(compile).toHaveBeenCalledTimes(2);
    expect(report.results).toHaveLength(4);
    expect(report.summary).toMatchObject({ pending: 1, resumed: 2, runnable: 5 });
  });

  it('validates a sorted route filter and executes it in frozen inventory order', async () => {
    const directory = await createTemporaryDirectory();
    const selections: string[] = [];
    const options = {
      ...createOptions(directory, createInventoryCompiler(), {
        compile: (request: PreviewBuildRequest) => {
          selections.push(request.inspectorRouteSelection?.[0]?.componentName ?? '');
          return Promise.resolve(createBundle());
        },
        waitForCancellationRecovery: recoverCancellation,
      }),
      routeIds: ['third', 'first'],
    };

    const report = await runPreviewHeadlessRouteCampaign(options);

    expect(selections).toEqual(['First', 'Third']);
    expect(report.routeIds).toEqual(['first', 'third']);
    expect(report.results.map((record) => record.routeId)).toEqual(['first', 'third']);
    expect(report.summary).toMatchObject({ pending: 1, runnable: 3 });
  });

  it('fails closed for invalid limits, route filters, and over-limit resumed ledgers', async () => {
    const directory = await createTemporaryDirectory();
    const base = createOptions(directory, createInventoryCompiler(), createReadyCompiler());

    await expect(runPreviewHeadlessRouteCampaign({ ...base, maxRoutes: 0 })).rejects.toThrow(
      'positive safe integer',
    );
    await expect(
      runPreviewHeadlessRouteCampaign({ ...base, routeIds: ['first', 'first'] }),
    ).rejects.toThrow('unique');
    await expect(
      runPreviewHeadlessRouteCampaign({ ...base, routeIds: ['absent'] }),
    ).rejects.toThrow('runnable inventory');

    const limited = { ...base, maxRoutes: 1 };
    await runPreviewHeadlessRouteCampaign(limited);
    const extraRecord = {
      diagnostics: [],
      durationMs: 1,
      kind: 'route',
      routeId: 'second',
      status: 'ready',
      version: 7,
    };
    await writeFile(
      limited.ledgerPath,
      `${await readFile(limited.ledgerPath, 'utf8')}${JSON.stringify(extraRecord)}\n`,
      'utf8',
    );
    await expect(runPreviewHeadlessRouteCampaign(limited)).rejects.toThrow('exceeding maxRoutes=1');
  });

  it('continues after isolated failures, writes complete totals, and resumes once', async () => {
    const directory = await createTemporaryDirectory();
    const compile = vi.fn((request: PreviewBuildRequest) => {
      if (request.inspectorRouteSelection?.[0]?.componentName === 'Second') {
        return Promise.reject(new Error('synthetic compile failure'));
      }
      return Promise.resolve(createBundle());
    });
    const options = createOptions(directory, createInventoryCompiler(), {
      compile,
      waitForCancellationRecovery: recoverCancellation,
    });
    const first = await runPreviewHeadlessRouteCampaign(options);
    const callsAfterFirstRun = compile.mock.calls.length;
    const second = await runPreviewHeadlessRouteCampaign(options);

    expect(first.results.map((result) => result.status).sort()).toEqual([
      'compile-failed',
      'protocol-error',
      'ready',
    ]);
    expect(first.summary).toMatchObject({ failed: 2, pending: 0, ready: 1, runnable: 3 });
    expect(
      compile.mock.calls.every(([request]) => {
        return (
          request.inspectorTargetMode === 'selected-route-leaf' &&
          Object.isFrozen(request.inspectorRouteSelection) &&
          request.inspectorRouteSelection?.length === 1
        );
      }),
    ).toBe(true);
    expect(second.summary.resumed).toBe(3);
    expect(compile).toHaveBeenCalledTimes(callsAfterFirstRun);
    expect(formatPreviewHeadlessRouteCampaignSummary(second.summary)).toContain('pending=0');
  });

  it('bounds an abort-ignoring compile, confirms retirement, and continues fresh', async () => {
    const directory = await createTemporaryDirectory();
    const events: string[] = [];
    let callCount = 0;
    const routeCompiler: PreviewHeadlessRouteCampaignIsolatedCompiler = {
      compile: async () => {
        callCount += 1;
        events.push(`compile-${callCount.toString()}`);
        if (callCount === 1) return new Promise<PreviewBundle>(() => undefined);
        return createBundle();
      },
      waitForCancellationRecovery: async () => {
        events.push('retire-start');
        await new Promise((resolve) => setTimeout(resolve, 5));
        events.push('retire-complete');
      },
    };
    const report = await runPreviewHeadlessRouteCampaign({
      ...createOptions(directory, createInventoryCompiler(createInventory(2)), routeCompiler),
      compileTimeoutMs: 5,
    });

    expect(report.results.map((record) => record.status)).toEqual(['compile-timeout', 'ready']);
    expect(events).toEqual(['compile-1', 'retire-start', 'retire-complete', 'compile-2']);
    expect(report.summary.pending).toBe(0);
  });

  it('rejects predecessor and retry identities so v5.5 always starts from zero', async () => {
    const directory = await createTemporaryDirectory();
    const predecessorPath = path.join(directory, 'predecessor.jsonl');
    const predecessor = `${JSON.stringify({ kind: 'header', version: 5 })}\n`;
    await writeFile(predecessorPath, predecessor, 'utf8');
    const options = createOptions(directory, createInventoryCompiler(), createReadyCompiler());

    await expect(
      runPreviewHeadlessRouteCampaign({
        ...options,
        ledgerPath: path.join(directory, 'successor.jsonl'),
        predecessorLedgerPath: predecessorPath,
        reportPath: path.join(directory, 'successor.json'),
      }),
    ).rejects.toThrow('requires a fresh ledger');
    await expect(
      runPreviewHeadlessRouteCampaign({
        ...options,
        ledgerPath: path.join(directory, 'retry.jsonl'),
        predecessorLedgerPath: predecessorPath,
        reportPath: path.join(directory, 'retry.json'),
        retryRouteIds: ['third'],
      }),
    ).rejects.toThrow('requires a fresh ledger');
    expect(await readFile(predecessorPath, 'utf8')).toBe(predecessor);
  });

  it('does not append an interruption-induced compiler failure', async () => {
    const directory = await createTemporaryDirectory();
    const controller = new AbortController();
    const routeCompiler: PreviewHeadlessRouteCampaignIsolatedCompiler = {
      compile: (_request, context) =>
        new Promise<PreviewBundle>((_resolve, reject) => {
          context?.signal?.addEventListener('abort', () => { reject(new Error('worker shutdown')); }, {
            once: true,
          });
          setTimeout(() => { controller.abort(); }, 1);
        }),
      waitForCancellationRecovery: recoverCancellation,
    };
    const options = {
      ...createOptions(directory, createInventoryCompiler(createInventory(1)), routeCompiler),
      signal: controller.signal,
    };
    const report = await runPreviewHeadlessRouteCampaign(options);
    const ledgerLines = (await readFile(options.ledgerPath, 'utf8')).split('\n').filter(Boolean);

    expect(report.summary).toMatchObject({ failed: 0, pending: 1, ready: 0 });
    expect(ledgerLines).toHaveLength(1);
  });

  it('keeps request and inventory identity independent from engine policy', async () => {
    const firstDirectory = await createTemporaryDirectory();
    const secondDirectory = await createTemporaryDirectory();
    const aborted = new AbortController();
    aborted.abort();
    const first = {
      ...createOptions(
        firstDirectory,
        createInventoryCompiler(createInventory(1)),
        createReadyCompiler(),
      ),
      compileTimeoutMs: 5,
      signal: aborted.signal,
    };
    const second = {
      ...createOptions(
        secondDirectory,
        createInventoryCompiler(createInventory(1)),
        createReadyCompiler(),
      ),
      compileTimeoutMs: 6,
      signal: aborted.signal,
    };
    await runPreviewHeadlessRouteCampaign(first);
    await runPreviewHeadlessRouteCampaign(second);
    const readHeader = async (
      ledgerPath: string,
    ): Promise<{ engineDigest: string; inventoryDigest: string; requestDigest: string }> =>
      JSON.parse((await readFile(ledgerPath, 'utf8')).split('\n')[0] ?? '{}') as {
        engineDigest: string;
        inventoryDigest: string;
        requestDigest: string;
      };
    const firstHeader = await readHeader(first.ledgerPath);
    const secondHeader = await readHeader(second.ledgerPath);

    expect(firstHeader.engineDigest).not.toBe(secondHeader.engineDigest);
    expect(firstHeader.inventoryDigest).toBe(secondHeader.inventoryDigest);
    expect(firstHeader.requestDigest).toBe(secondHeader.requestDigest);
  });

  it('rejects changed request, inventory, and engine identity before compiling another route', async () => {
    const directory = await createTemporaryDirectory();
    const compile = vi.fn(() => Promise.resolve(createBundle()));
    const routeCompiler = {
      compile,
      waitForCancellationRecovery: recoverCancellation,
    };
    const aborted = new AbortController();
    aborted.abort();
    const options = {
      ...createOptions(directory, createInventoryCompiler(), routeCompiler),
      signal: aborted.signal,
    };
    await runPreviewHeadlessRouteCampaign(options);

    await expect(
      runPreviewHeadlessRouteCampaign({
        ...options,
        request: { ...createRequest(), sourceText: 'export default function Changed() {}' },
      }),
    ).rejects.toThrow('does not match');
    await expect(
      runPreviewHeadlessRouteCampaign({
        ...options,
        compiler: createInventoryCompiler(createInventory(2)),
      }),
    ).rejects.toThrow('does not match');
    await expect(runPreviewHeadlessRouteCampaign({ ...options, maxRoutes: 1 })).rejects.toThrow(
      'does not match',
    );
    await expect(
      runPreviewHeadlessRouteCampaign({ ...options, routeIds: ['first'] }),
    ).rejects.toThrow('does not match');

    const originalLedger = await readFile(options.ledgerPath, 'utf8');
    const [headerLine = '{}', ...recordLines] = originalLedger.split('\n');
    const header = JSON.parse(headerLine) as Record<string, unknown>;
    const legacyHeader = { ...header };
    Reflect.deleteProperty(legacyHeader, 'managedChildEnvironmentPolicyDigest');
    await writeFile(
      options.ledgerPath,
      [JSON.stringify(legacyHeader), ...recordLines].join('\n'),
      'utf8',
    );
    await expect(runPreviewHeadlessRouteCampaign(options)).rejects.toThrow('does not match');
    const legacyIsolationDigestHeader = { ...header };
    Reflect.deleteProperty(
      legacyIsolationDigestHeader,
      'inventoryCompilerIsolationPolicyDigest',
    );
    await writeFile(
      options.ledgerPath,
      [JSON.stringify(legacyIsolationDigestHeader), ...recordLines].join('\n'),
      'utf8',
    );
    await expect(runPreviewHeadlessRouteCampaign(options)).rejects.toThrow('does not match');
    const legacyIsolationVersionHeader = { ...header };
    Reflect.deleteProperty(
      legacyIsolationVersionHeader,
      'inventoryCompilerIsolationPolicyVersion',
    );
    await writeFile(
      options.ledgerPath,
      [JSON.stringify(legacyIsolationVersionHeader), ...recordLines].join('\n'),
      'utf8',
    );
    await expect(runPreviewHeadlessRouteCampaign(options)).rejects.toThrow('does not match');
    const legacySyntheticHeader = { ...header };
    Reflect.deleteProperty(legacySyntheticHeader, 'syntheticInputPolicyDigest');
    await writeFile(
      options.ledgerPath,
      [JSON.stringify(legacySyntheticHeader), ...recordLines].join('\n'),
      'utf8',
    );
    await expect(runPreviewHeadlessRouteCampaign(options)).rejects.toThrow('does not match');
    const legacyOwnershipHeader = { ...header };
    Reflect.deleteProperty(legacyOwnershipHeader, 'targetFacadeOwnershipPolicyDigest');
    await writeFile(
      options.ledgerPath,
      [JSON.stringify(legacyOwnershipHeader), ...recordLines].join('\n'),
      'utf8',
    );
    await expect(runPreviewHeadlessRouteCampaign(options)).rejects.toThrow('does not match');
    const legacyAbsenceRootHeader = { ...header };
    Reflect.deleteProperty(legacyAbsenceRootHeader, 'absenceExecutionRootPolicyDigest');
    await writeFile(
      options.ledgerPath,
      [JSON.stringify(legacyAbsenceRootHeader), ...recordLines].join('\n'),
      'utf8',
    );
    await expect(runPreviewHeadlessRouteCampaign(options)).rejects.toThrow('does not match');
    const legacyDependencyRecoveryHeader = { ...header };
    Reflect.deleteProperty(
      legacyDependencyRecoveryHeader,
      'metafileDependencyRecoveryPolicyDigest',
    );
    await writeFile(
      options.ledgerPath,
      [JSON.stringify(legacyDependencyRecoveryHeader), ...recordLines].join('\n'),
      'utf8',
    );
    await expect(runPreviewHeadlessRouteCampaign(options)).rejects.toThrow('does not match');
    expect(compile).not.toHaveBeenCalled();
  });

  it('persists normalized snapshot confinement identity and rejects changed lineage on resume', async () => {
    const directory = await createTemporaryDirectory();
    const sourceRoot = path.join(directory, 'snapshot', 'source');
    const dependencyRoot = path.join(directory, 'installed', 'node_modules');
    const documentPath = path.join(sourceRoot, 'App.tsx');
    await mkdir(sourceRoot, { recursive: true });
    await mkdir(dependencyRoot, { recursive: true });
    await writeFile(documentPath, 'export default function App() {}');
    const inventory = createInventory(1);
    const confinedInventory = Object.freeze({
      ...inventory,
      dependencyPaths: Object.freeze([documentPath]),
    });
    const aborted = new AbortController();
    aborted.abort();
    const confinement = Object.freeze({
      approvedDependencyRoots: Object.freeze([dependencyRoot]),
      dependencyViewDigest: 'b'.repeat(64),
      policyDigest: 'c'.repeat(64),
      sourceManifestDigest: 'a'.repeat(64),
      sourceRoot,
    });
    const options = {
      ...createOptions(
        directory,
        createInventoryCompiler(confinedInventory),
        createReadyCompiler(),
      ),
      request: Object.freeze({
        ...createRequest(),
        documentPath,
        resolutionConfinement: confinement,
        sourceText: await readFile(documentPath, 'utf8'),
        workspaceRoot: sourceRoot,
      }),
      signal: aborted.signal,
    };

    const report = await runPreviewHeadlessRouteCampaign(options);
    const header = JSON.parse(
      (await readFile(options.ledgerPath, 'utf8')).split('\n')[0] ?? '{}',
    ) as Record<string, unknown>;
    const expectedIdentity = {
      ...confinement,
      approvedDependencyRoots: [await realpath(dependencyRoot)],
      sourceRoot: await realpath(sourceRoot),
    };

    expect(header.resolutionConfinement).toEqual(expectedIdentity);
    expect(report.resolutionConfinement).toEqual(expectedIdentity);
    await expect(
      runPreviewHeadlessRouteCampaign({
        ...options,
        request: {
          ...options.request,
          resolutionConfinement: {
            ...confinement,
            policyDigest: 'd'.repeat(64),
          },
        },
      }),
    ).rejects.toThrow('does not match');
  });
});

/** Creates one campaign request with deterministic test paths and render behavior. */
function createOptions(
  directory: string,
  compiler: PreviewHeadlessRouteCampaignCompiler,
  routeCompiler: PreviewHeadlessRouteCampaignIsolatedCompiler,
): RunPreviewHeadlessRouteCampaignOptions {
  return {
    compiler,
    ledgerPath: path.join(directory, 'routes-v5-5.jsonl'),
    renderRoute: async (candidateCompiler: PreviewCompiler, request: PreviewBuildRequest) => {
      await candidateCompiler.compile(request);
      return createHeadlessResult(
        request.inspectorRouteSelection?.[0]?.componentName === 'Third'
          ? 'protocol-error'
          : 'ready',
      );
    },
    reportPath: path.join(directory, 'routes-v5-5.json'),
    request: createRequest(),
    routeCompiler,
  };
}

/** Creates an inventory-only compiler for a frozen test inventory. */
function createInventoryCompiler(
  inventory = createInventory(3),
): PreviewHeadlessRouteCampaignCompiler {
  return {
    collectCompleteRouteInventory: () => Promise.resolve(inventory),
  };
}

/** Creates an isolated compiler that always produces an empty ready bundle. */
function createReadyCompiler(): PreviewHeadlessRouteCampaignIsolatedCompiler {
  return {
    compile: () => Promise.resolve(createBundle()),
    waitForCancellationRecovery: recoverCancellation,
  };
}

/** Creates a compact three-route inventory fixture. */
function createInventory(runnableCount: number): PreviewInspectorCompleteRouteInventory {
  const runnable = ['First', 'Second', 'Third'].slice(0, runnableCount).map((componentName) => {
    const id = componentName.toLowerCase();
    const owner = Object.freeze({ exportName: 'default', sourcePath: '/workspace/App.tsx' });
    const parameters = Object.freeze({});
    const pathname = `/${id}`;
    const pattern = `/${id}`;
    const selection = Object.freeze([Object.freeze({ componentName, pattern })]);
    const sourcePath = `/workspace/${componentName}.tsx`;
    return Object.freeze({
      componentName,
      disposition: 'runnable' as const,
      exportName: 'default',
      id,
      executionPlan: createPreviewRouteExecutionPlanFixture({
        componentName,
        exportName: 'default',
        pathname,
        pattern,
        routeId: id,
        selection,
        sourcePath,
      }),
      owner,
      parameters,
      pathname,
      pattern,
      replay: createReplay({
        componentName,
        id,
        owner,
        parameters,
        pathname,
        pattern,
        selection,
        sourcePath,
      }),
      selection,
      sourcePath,
    });
  });
  const unresolved = {
    componentName: 'Missing',
    disposition: 'unresolved' as const,
    id: 'missing',
    owner: Object.freeze({ exportName: 'default', sourcePath: '/workspace/App.tsx' }),
    parameters: Object.freeze({}),
    pathname: '/missing',
    pattern: '/missing',
    reason: 'component-unresolved' as const,
    selection: Object.freeze([Object.freeze({ componentName: 'Missing', pattern: '/missing' })]),
  };
  const entries = Object.freeze([...runnable, unresolved]);
  return Object.freeze({
    analysisPasses: 1,
    complete: true,
    counts: Object.freeze({
      duplicate: 0,
      runnable: runnable.length,
      total: entries.length,
      unresolved: 1,
    }),
    dependencyPaths: Object.freeze(['/workspace/App.tsx']),
    entries,
    limits: Object.freeze({
      maximumAnalysisPasses: 4_096,
      maximumBranches: 8_192,
      maximumDepth: 64,
    }),
    owner: Object.freeze({ exportName: 'default', sourcePath: '/workspace/App.tsx' }),
    predecessorVersion: 3,
    replayPasses: runnable.length,
    replayPolicy: createReplayPolicy(),
    truncated: false,
    version: 4,
  });
}

/** Creates the baseline Page Inspector request fixture. */
function createRequest(): PreviewBuildRequest {
  return Object.freeze({
    dependencySnapshots: Object.freeze([]),
    documentPath: '/workspace/App.tsx',
    language: 'tsx',
    preparationMode: 'fast',
    renderMode: 'page-inspector',
    sourceText: 'export default function App() {}',
    workspaceRoot: '/workspace',
  });
}

/** Creates an empty successful bundle fixture. */
function createBundle(): PreviewBundle {
  return {
    chunks: Object.freeze([]),
    dependencies: Object.freeze([]),
    diagnostics: Object.freeze([]),
    javascript: new Uint8Array(),
    watchDirectories: Object.freeze([]),
  };
}

/** Creates a deterministic headless renderer result. */
function createHeadlessResult(status: PreviewHeadlessResult['status']): PreviewHeadlessResult {
  return {
    browserExitCode: 0,
    cleanup: { browserTerminated: true, profileRemoved: true, serverClosed: true },
    diagnostics: Object.freeze([]),
    evidence: {
      consoleFailures: Object.freeze([]),
      extensionMessages: Object.freeze([]),
      loopbackRequests: Object.freeze([]),
      runtimeEvents: Object.freeze([]),
      windowErrors: Object.freeze([]),
    },
    rootHtml: '',
    status,
    ...(status === 'ready' ? { stabilizedOutcome: 'ready' as const } : {}),
  };
}

/** Creates one version-six durable route record fixture. */
function createV7Record(routeId: string, status: string): unknown {
  return {
    diagnostics: [],
    durationMs: 1,
    kind: 'route',
    routeId,
    status,
    version: 7,
  };
}

/** Creates a neutral synthetic inventory of the requested size. */
function createLargeInventory(runnableCount: number): PreviewInspectorCompleteRouteInventory {
  const runnable = Array.from({ length: runnableCount }, (_value, index) => {
    const componentName = `Route${index.toString()}`;
    const id = `route-${index.toString()}`;
    const owner = Object.freeze({ exportName: 'default', sourcePath: '/workspace/App.tsx' });
    const parameters = Object.freeze({});
    const pathname = `/route-${index.toString()}`;
    const pattern = pathname;
    const selection = Object.freeze([Object.freeze({ componentName, pattern })]);
    const sourcePath = `/workspace/${componentName}.tsx`;
    return Object.freeze({
      componentName,
      disposition: 'runnable' as const,
      exportName: 'default',
      id,
      executionPlan: createPreviewRouteExecutionPlanFixture({
        componentName,
        exportName: 'default',
        pathname,
        pattern,
        routeId: id,
        selection,
        sourcePath,
      }),
      owner,
      parameters,
      pathname,
      pattern,
      replay: createReplay({
        componentName,
        id,
        owner,
        parameters,
        pathname,
        pattern,
        selection,
        sourcePath,
      }),
      selection,
      sourcePath,
    });
  });
  return Object.freeze({
    analysisPasses: 1,
    complete: true,
    counts: Object.freeze({
      duplicate: 0,
      runnable: runnable.length,
      total: runnable.length,
      unresolved: 0,
    }),
    dependencyPaths: Object.freeze(['/workspace/App.tsx']),
    entries: Object.freeze(runnable),
    limits: Object.freeze({
      maximumAnalysisPasses: 4_096,
      maximumBranches: 8_192,
      maximumDepth: 64,
    }),
    owner: Object.freeze({ exportName: 'default', sourcePath: '/workspace/App.tsx' }),
    predecessorVersion: 3,
    replayPasses: runnable.length,
    replayPolicy: createReplayPolicy(),
    truncated: false,
    version: 4,
  });
}

/** Creates one exact replay record for an inventory route. */
function createReplay(
  options: Pick<
    PreviewInspectorCompleteRunnableRoute,
    'componentName' | 'id' | 'owner' | 'parameters' | 'pathname' | 'pattern' | 'selection'
  > & { readonly sourcePath: string },
): PreviewInspectorCompleteRunnableRoute['replay'] {
  return Object.freeze({
    branchId: options.id,
    componentName: options.componentName,
    executionRoot: Object.freeze({ ...options.owner, basePattern: '/' }),
    exportName: 'default',
    owner: options.owner,
    ownerChain: Object.freeze([Object.freeze({ ...options.owner, basePattern: '/' })]),
    parameters: options.parameters,
    pathname: options.pathname,
    pattern: options.pattern,
    policyDigest: PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_DIGEST,
    routeSelectionResolution: 'exact' as const,
    runtimeTarget: Object.freeze({ exportName: 'default', sourcePath: options.sourcePath }),
    selection: options.selection,
    sourcePath: options.sourcePath,
    version: 1 as const,
  });
}

/** Creates the current inventory replay policy fixture. */
function createReplayPolicy(): PreviewInspectorCompleteRouteInventory['replayPolicy'] {
  return Object.freeze({
    digest: PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_DIGEST,
    predecessorVersion: 3 as const,
    version: 4 as const,
  });
}

/** Creates and registers a temporary campaign directory for cleanup. */
async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'preview-route-campaign-test-'));
  temporaryDirectories.push(directory);
  return directory;
}
