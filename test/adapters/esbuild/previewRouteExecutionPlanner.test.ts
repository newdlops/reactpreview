import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPreviewCompleteRouteInventoryTelemetryEmitter,
  type PreviewCompleteRouteInventoryTelemetryEvent,
  type PreviewCompleteRouteInventoryTelemetryPhase,
} from '../../../src/adapters/esbuild/inspector/previewInspectorCompleteRouteInventory';
import {
  emitPreviewRouteExecutionBundleCompleteTelemetry,
  emitPreviewRouteExecutionTelemetry,
  preparePreviewRouteExecutionPlanner,
} from '../../../src/adapters/esbuild/preparePreviewRouteExecutionPlanner';
import type { PreviewInspectorBundleDiagnostics } from '../../../src/adapters/esbuild/inspector/previewInspectorBundleDiagnostics';

type InternalStage =
  | 'execution-frontier-artifact'
  | 'execution-frontier-bundle'
  | 'execution-frontier-candidates'
  | 'execution-frontier-ownership'
  | 'execution-frontier-root-contract'
  | 'execution-frontier-target-contract';

const plannerStageAudit = vi.hoisted(() => ({
  calls: [] as string[],
  failAt: undefined as InternalStage | undefined,
}));

const ZERO_BUNDLE_DIAGNOSTICS: PreviewInspectorBundleDiagnostics = Object.freeze({
  diagnosticsVersion: 1,
  bundleMeasuredMicros: 0,
  frontierCount: 0,
  rawSourceReadCount: 0,
  rawSourceReadMicros: 0,
  inventoryReadRequestCount: 0,
  inventoryReadPathCacheHitCount: 0,
  sliceRequestCount: 0,
  sliceComputationCount: 0,
  sliceHitCount: 0,
  sliceLookupMicros: 0,
  inventoryRequestCount: 0,
  inventoryComputationCount: 0,
  inventoryHitCount: 0,
  inventoryLookupMicros: 0,
  queueIterationCount: 0,
  queuePeakLength: 0,
  queueSortCount: 0,
  queueSortMicros: 0,
  edgeVisitCount: 0,
  optionalClosureProbeCount: 0,
  optionalClosureMicros: 0,
  resolveModuleCount: 0,
  resolveModuleMicros: 0,
  authoredPathCheckCount: 0,
  authoredPathCheckMicros: 0,
  frontierFinalizeMicros: 0,
  frontierIdentityMicros: 0,
  candidateSelectionSortCount: 0,
  candidateSelectionMicros: 0,
});

vi.mock('../../../src/adapters/esbuild/inspector', () => {
  const analysisTarget = { exportName: 'default', sourcePath: '/workspace/target.tsx' };
  const candidate = {
    browserCandidate: {
      id: 'browser-candidate',
      target: { sourcePath: '/workspace/leaf.tsx' },
    },
    executionRootContract: {
      exportName: 'default',
      sourcePath: '/workspace/root.tsx',
      surfaceId: 'root-surface',
    },
    id: 'execution-candidate',
  };
  const activePlan = {
    dependencyPaths: [],
    pageCandidates: [],
    renderChainsByExport: { default: [] },
    routeSelectionResolution: 'exact',
    target: analysisTarget,
  };
  return {
    createEligiblePreviewInspectorPageExecutionCandidates: () => {
      plannerStageAudit.calls.push('candidate-generation');
      return [candidate];
    },
    createPreviewInspectorExecutablePlan: () => {
      plannerStageAudit.calls.push('executable-plan');
      if (plannerStageAudit.failAt === 'execution-frontier-candidates') {
        throw new Error('synthetic candidates failure');
      }
      return activePlan;
    },
    createPreviewInspectorExecutionRootModuleContract: () => {
      plannerStageAudit.calls.push('root-contract');
      if (plannerStageAudit.failAt === 'execution-frontier-root-contract') {
        throw new Error('synthetic root-contract failure');
      }
      return { digest: 'root-contract' };
    },
    createPreviewInspectorTargetModuleContract: () => {
      plannerStageAudit.calls.push('target-contract');
      if (plannerStageAudit.failAt === 'execution-frontier-target-contract') {
        throw new Error('synthetic target-contract failure');
      }
      return { digest: 'target-contract' };
    },
    resolvePreviewInspectorRuntimeOwnershipTarget: () => {
      plannerStageAudit.calls.push('ownership');
      if (plannerStageAudit.failAt === 'execution-frontier-ownership') {
        throw new Error('synthetic ownership failure');
      }
      return analysisTarget;
    },
  };
});

vi.mock('../../../src/adapters/esbuild/preparePreviewInspectorBundleExecution', () => ({
  preparePreviewInspectorBundleExecution: () => {
    plannerStageAudit.calls.push('bundle');
    if (plannerStageAudit.failAt === 'execution-frontier-bundle') {
      throw new Error('synthetic bundle failure');
    }
    return Promise.resolve({
      executionCandidate: {
        browserCandidate: {
          id: 'browser-candidate',
          target: { sourcePath: '/workspace/leaf.tsx' },
        },
        executionRootContract: {
          exportName: 'default',
          sourcePath: '/workspace/root.tsx',
          surfaceId: 'root-surface',
        },
        id: 'execution-candidate',
      },
      prepared: { frontier: { identity: 'frontier' } },
      throwIfRejected: () => undefined,
    });
  },
}));

vi.mock('../../../src/adapters/esbuild/previewRouteExecutionPlan', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../../src/adapters/esbuild/previewRouteExecutionPlan')
    >();
  return {
    ...actual,
    createPreviewRouteExecutionPlanArtifact: () => {
      plannerStageAudit.calls.push('artifact');
      if (plannerStageAudit.failAt === 'execution-frontier-artifact') {
        throw new Error('synthetic artifact failure');
      }
      return { digest: 'artifact' };
    },
  };
});

describe('preparePreviewRouteExecutionPlanner telemetry', () => {
  beforeEach(() => {
    plannerStageAudit.calls = [];
    plannerStageAudit.failAt = undefined;
  });

  it('densely exposes all eleven phases through 64, then only powers and final', () => {
    const events: PreviewCompleteRouteInventoryTelemetryEvent[] = [];
    const emitter = createPreviewCompleteRouteInventoryTelemetryEmitter((event) => {
      events.push(event);
    });
    if (emitter === undefined) throw new Error('Synthetic telemetry emitter was not created.');
    let realPlannerCalls = 0;
    const prePlanPhases = [
      'execution-shared-context',
      'execution-route-usage',
      'execution-frontier-style',
      'execution-frontier-globals',
    ] as const;
    const internalPhases = [
      'execution-frontier-candidates',
      'execution-frontier-bundle',
      'execution-frontier-ownership',
      'execution-frontier-target-contract',
      'execution-frontier-root-contract',
      'execution-frontier-artifact',
    ] as const;
    const phases: readonly PreviewCompleteRouteInventoryTelemetryPhase[] = [
      ...prePlanPhases,
      'execution-frontier-plan',
      ...internalPhases,
    ];

    for (let routeOrdinal = 1; routeOrdinal <= 130; routeOrdinal += 1) {
      realPlannerCalls += 1;
      const context = {
        emitter,
        progress: { routeOrdinal, total: 130 },
      };
      for (const phase of prePlanPhases) {
        emitPreviewRouteExecutionTelemetry(context, phase, 'start');
        emitPreviewRouteExecutionTelemetry(context, phase, 'complete');
      }
      emitPreviewRouteExecutionTelemetry(context, 'execution-frontier-plan', 'start');
      for (const phase of internalPhases) {
        emitPreviewRouteExecutionTelemetry(context, phase, 'start');
        if (phase === 'execution-frontier-bundle') {
          emitPreviewRouteExecutionBundleCompleteTelemetry(context, ZERO_BUNDLE_DIAGNOSTICS);
        } else {
          emitPreviewRouteExecutionTelemetry(context, phase, 'complete');
        }
      }
      emitPreviewRouteExecutionTelemetry(context, 'execution-frontier-plan', 'complete');
    }

    const sampledOrdinals = [...Array.from({ length: 64 }, (_, index) => index + 1), 128, 130];
    expect(realPlannerCalls).toBe(130);
    expect(new Set(events.map((event) => event.phase))).toEqual(new Set(phases));
    expect(new Set(events.map((event) => event.routeOrdinal))).toEqual(new Set(sampledOrdinals));
    expect(events).toHaveLength(sampledOrdinals.length * phases.length * 2);
    for (const routeOrdinal of sampledOrdinals) {
      const routeEvents = events.filter((event) => event.routeOrdinal === routeOrdinal);
      expect(routeEvents).toHaveLength(22);
      expect(new Set(routeEvents.map((event) => event.phase))).toEqual(new Set(phases));
      expect(
        routeEvents.filter(
          (event) =>
            event.phase === 'execution-frontier-bundle' && event.transition === 'complete',
        ),
      ).toMatchObject([{ bundleDiagnostics: ZERO_BUNDLE_DIAGNOSTICS }]);
      expect(
        routeEvents
          .filter(
            (event) =>
              event.phase !== 'execution-frontier-bundle' || event.transition !== 'complete',
          )
          .every((event) => event.bundleDiagnostics === undefined),
      ).toBe(true);
      expect(
        routeEvents
          .filter((event) => event.phase.startsWith('execution-frontier-'))
          .every(
            (event) =>
              event.executionPlanCompleted ===
              (event.phase === 'execution-frontier-plan' && event.transition === 'complete'
                ? routeOrdinal
                : routeOrdinal - 1),
          ),
      ).toBe(true);
    }
    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
    expect(events.at(-1)).toMatchObject({
      executionPlanCompleted: 130,
      executionPlanTotal: 130,
      phase: 'execution-frontier-plan',
      routeOrdinal: 130,
      transition: 'complete',
    });
  });

  it('preserves planner work order and emits exact successful internal boundaries', async () => {
    const events: PreviewCompleteRouteInventoryTelemetryEvent[] = [];
    const ticks = [0n, 7_000n];
    let clockReads = 0;
    const result = await preparePreviewRouteExecutionPlanner({
      ...createPlannerOptions(events),
      bundleDiagnosticsClock: () => {
        const tick = ticks[clockReads];
        clockReads += 1;
        if (tick === undefined) throw new Error('Unexpected bundle diagnostics clock read.');
        return tick;
      },
    });

    expect(result.artifact).toEqual({ digest: 'artifact' });
    expect(plannerStageAudit.calls).toEqual([
      'executable-plan',
      'candidate-generation',
      'bundle',
      'read:/workspace/leaf.tsx',
      'ownership',
      'read:/workspace/target.tsx',
      'prepare:/workspace/target.tsx',
      'target-contract',
      'read:/workspace/root.tsx',
      'prepare:/workspace/root.tsx',
      'root-contract',
      'artifact',
    ]);
    expect(events.map((event) => `${event.phase}:${event.transition}`)).toEqual([
      'execution-frontier-plan:start',
      'execution-frontier-candidates:start',
      'execution-frontier-candidates:complete',
      'execution-frontier-bundle:start',
      'execution-frontier-bundle:complete',
      'execution-frontier-ownership:start',
      'execution-frontier-ownership:complete',
      'execution-frontier-target-contract:start',
      'execution-frontier-target-contract:complete',
      'execution-frontier-root-contract:start',
      'execution-frontier-root-contract:complete',
      'execution-frontier-artifact:start',
      'execution-frontier-artifact:complete',
      'execution-frontier-plan:complete',
    ]);
    expect(events.slice(0, -1).every((event) => event.executionPlanCompleted === 0)).toBe(true);
    expect(events.at(-1)?.executionPlanCompleted).toBe(1);
    const bundleComplete = events.find(
      (event) =>
        event.phase === 'execution-frontier-bundle' && event.transition === 'complete',
    );
    expect(bundleComplete?.bundleDiagnostics).toEqual({
      ...ZERO_BUNDLE_DIAGNOSTICS,
      bundleMeasuredMicros: 7,
    });
    expect(Object.isFrozen(bundleComplete?.bundleDiagnostics)).toBe(true);
    expect(clockReads).toBe(2);
  });

  it('reads no diagnostic clock without an observer or at an unsampled ordinal', async () => {
    let clockReads = 0;
    const clock = (): bigint => {
      clockReads += 1;
      return 0n;
    };
    const noObserverOptions = createPlannerOptions([]);
    const { telemetry: omittedTelemetry, ...optionsWithoutObserver } = noObserverOptions;
    void omittedTelemetry;
    await preparePreviewRouteExecutionPlanner({
      ...optionsWithoutObserver,
      bundleDiagnosticsClock: clock,
    });
    const unsampledEvents: PreviewCompleteRouteInventoryTelemetryEvent[] = [];
    const unsampledOptions = createPlannerOptions(unsampledEvents);
    if (unsampledOptions.telemetry === undefined) {
      throw new Error('Expected unsampled telemetry context.');
    }
    await preparePreviewRouteExecutionPlanner({
      ...unsampledOptions,
      bundleDiagnosticsClock: clock,
      telemetry: {
        ...unsampledOptions.telemetry,
        progress: { routeOrdinal: 65, total: 130 },
      },
    });
    expect(clockReads).toBe(0);
    expect(unsampledEvents).toEqual([]);
  });

  it('retains only the failing internal stage start and emits no later stage', async () => {
    const stages: readonly InternalStage[] = [
      'execution-frontier-candidates',
      'execution-frontier-bundle',
      'execution-frontier-ownership',
      'execution-frontier-target-contract',
      'execution-frontier-root-contract',
      'execution-frontier-artifact',
    ];
    const completedStages: InternalStage[] = [];
    for (const stage of stages) {
      const events: PreviewCompleteRouteInventoryTelemetryEvent[] = [];
      plannerStageAudit.calls = [];
      plannerStageAudit.failAt = stage;

      await expect(
        preparePreviewRouteExecutionPlanner(createPlannerOptions(events)),
      ).rejects.toThrow(`synthetic ${stage.replace('execution-frontier-', '')}`);
      const internalEvents = events.filter(
        (event): event is PreviewCompleteRouteInventoryTelemetryEvent =>
          stages.includes(event.phase as InternalStage),
      );
      expect(internalEvents.at(-1)).toMatchObject({ phase: stage, transition: 'start' });
      expect(
        internalEvents.some((event) => event.phase === stage && event.transition === 'complete'),
      ).toBe(false);
      expect(events.at(-1)).toMatchObject({ phase: stage, transition: 'start' });
      completedStages.push(stage);
    }
    expect(completedStages).toEqual(stages);
  });
});

/** Supplies deterministic seams for exact planner-stage ordering and failure boundaries. */
function createPlannerOptions(
  events: PreviewCompleteRouteInventoryTelemetryEvent[],
): Parameters<typeof preparePreviewRouteExecutionPlanner>[0] {
  const emitter = createPreviewCompleteRouteInventoryTelemetryEmitter((event) => {
    events.push(event);
  });
  if (emitter === undefined) throw new Error('Planner telemetry emitter was not created.');
  return {
    contextDiscoveryTruncated: false,
    policy: {} as never,
    projectRoot: '/workspace',
    readSource: (sourcePath) => {
      plannerStageAudit.calls.push(`read:${sourcePath}`);
      return Promise.resolve('export default function Fixture() { return null; }');
    },
    request: {
      dependencySnapshots: [],
      documentPath: '/workspace/root.tsx',
      inspectorTargetMode: 'selected-route-leaf',
      language: 'tsx',
      preparationMode: 'fast',
      renderMode: 'page-inspector',
      sourceText: 'export default function Root() { return null; }',
      workspaceRoot: '/workspace',
    },
    resolveModule: () => undefined,
    routeId: 'route-id',
    runtimeCompanionSourcePaths: [],
    styleSnapshotCount: 0,
    targetSelection: {
      prepareSource: (sourcePath: string, ...sourceTexts: string[]) => {
        plannerStageAudit.calls.push(`prepare:${sourcePath}`);
        return sourceTexts.at(-1) ?? '';
      },
    } as never,
    targetUsageProps: {
      inspectorPlan: {
        pageCandidates: [],
        renderChainsByExport: { default: [] },
        target: { exportName: 'default', sourcePath: '/workspace/target.tsx' },
      },
    } as never,
    telemetry: {
      emitter,
      progress: { routeOrdinal: 1, total: 1 },
    },
    workspaceRoot: '/workspace',
  };
}
