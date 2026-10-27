/** Covers telemetry behavior for previewInspectorCompleteRouteInventory. */
/** Verifies authored-source previewInspectorCompleteRouteInventory invariants. */
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CollectPreviewInspectorRouteBranchPlanOptions,
  PreviewInspectorRouteOwnerLocationInventoryMemo,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteBranchPlan';

import {
  createPreviewCompleteRouteInventoryTelemetryEmitter,
  isPreviewCompleteRouteInventoryExecutionTelemetryCheckpoint,
  isPreviewCompleteRouteInventoryTelemetryCheckpoint,
  PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_COMPUTED_MAXIMUM_EVENTS,
  PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_MAXIMUM_EVENTS,
  PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_POLICY,
  PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_POLICY_DIGEST,
  type PreviewCompleteRouteInventoryTelemetryEvent,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorCompleteRouteInventory';

import {
  ZERO_BUNDLE_DIAGNOSTICS,
  type OwnerMemoAudit,
  type PrefixProvider,
  type PrefixProviderAudit,
} from './previewInspectorCompleteRouteInventoryFixtures';

const ownerMemoAudit = vi.hoisted(() => ({
  instances: [] as OwnerMemoAudit[],
  prefixInstances: [] as PrefixProviderAudit[],
  providerDisabledOracle: false,
  publicBranchPlans: 0,
}));

vi.mock(
  '../../../../src/adapters/esbuild/inspector/previewInspectorRouteBranchPlan',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../../../../src/adapters/esbuild/inspector/previewInspectorRouteBranchPlan')
      >();
    return {
      ...actual,
      collectPreviewInspectorRouteBranchPlan(
        options: CollectPreviewInspectorRouteBranchPlanOptions,
      ) {
        const audit = ownerMemoAudit.instances.find(
          (candidate) => candidate.provider === options.ownerLocationInventoryMemo,
        );
        if (audit === undefined) {
          ownerMemoAudit.publicBranchPlans += 1;
        } else {
          audit.branchPlans += 1;
        }
        if (!ownerMemoAudit.providerDisabledOracle) {
          return actual.collectPreviewInspectorRouteBranchPlan(options);
        }
        const { selectionPrefixProvider: _selectionPrefixProvider, ...oracleOptions } = options;
        void _selectionPrefixProvider;
        return actual.collectPreviewInspectorRouteBranchPlan(oracleOptions);
      },
      createPreviewInspectorRouteBranchSelectionPrefixProvider() {
        const retained = actual.createPreviewInspectorRouteBranchSelectionPrefixProvider();
        const audit: PrefixProviderAudit = {
          createdAfterPreviousRelease: ownerMemoAudit.prefixInstances.every(
            (candidate) => candidate.releases === 1,
          ),
          releases: 0,
        };
        const provider: PrefixProvider = Object.freeze({
          ...retained,
          release: () => {
            audit.preReleaseStatistics = retained.getStatistics();
            retained.release();
            audit.postReleaseStatistics = retained.getStatistics();
            audit.releases += 1;
          },
        });
        audit.provider = provider;
        ownerMemoAudit.prefixInstances.push(audit);
        return provider;
      },
      createPreviewInspectorRouteOwnerLocationInventoryMemo(
        options: Parameters<typeof actual.createPreviewInspectorRouteOwnerLocationInventoryMemo>[0],
      ) {
        const retained = actual.createPreviewInspectorRouteOwnerLocationInventoryMemo(options);
        const audit: OwnerMemoAudit = {
          branchPlans: 0,
          hits: 0,
          identities: new Set<string>(),
          misses: 0,
          releases: 0,
          requests: 0,
        };
        const provider: PreviewInspectorRouteOwnerLocationInventoryMemo = Object.freeze({
          collect: (documentPath: string, exportName: string) => {
            audit.requests += 1;
            const identity = JSON.stringify([path.normalize(documentPath), exportName]);
            if (audit.identities.has(identity)) {
              audit.hits += 1;
            } else {
              audit.identities.add(identity);
              audit.misses += 1;
            }
            return retained.collect(documentPath, exportName);
          },
          release: () => {
            retained.release();
            audit.releases += 1;
          },
        });
        audit.provider = provider;
        ownerMemoAudit.instances.push(audit);
        return provider;
      },
    };
  },
);

describe('complete Preview Inspector route inventory', () => {
  beforeEach(() => {
    ownerMemoAudit.instances.length = 0;
    ownerMemoAudit.prefixInstances.length = 0;
    ownerMemoAudit.providerDisabledOracle = false;
    ownerMemoAudit.publicBranchPlans = 0;
  });

  it('freezes the source-general telemetry policy and stays below the synthetic bound', () => {
    expect(PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_POLICY).toEqual({
      bundleDiagnostics: {
        diagnosticsVersion: 1,
        durationSemantics: 'inclusive-overlapping-microseconds-not-a-sum-partition',
        fieldNames: Object.keys(ZERO_BUNDLE_DIAGNOSTICS),
        placement: 'execution-frontier-bundle-complete-only',
        relationships: [
          'sliceRequestCount=sliceComputationCount+sliceHitCount',
          'inventoryRequestCount=inventoryComputationCount+inventoryHitCount',
          'inventoryReadRequestCount>=inventoryReadPathCacheHitCount',
          'queueSortCount=queueIterationCount',
          'queueIterationCount=0 iff queuePeakLength=0',
        ],
        required: true,
        scalarContract: 'nonnegative-safe-integer',
      },
      cacheKeyParticipation: false,
      checkpointPolicy: 'ordinal-one-powers-of-two-and-final',
      computedMaximumEvents: 1_600,
      counterFields: [
        'analysisPasses',
        'queuedSelections',
        'discoveredBranches',
        'replayCompleted',
        'replayTotal',
        'executionPlanCompleted',
        'executionPlanTotal',
        'routeOrdinal',
        'enumerationPrefixRequestCount',
        'enumerationPrefixComputationCount',
        'enumerationPrefixHitCount',
        'enumerationPrefixEntryCount',
        'replayPrefixRequestCount',
        'replayPrefixComputationCount',
        'replayPrefixHitCount',
        'replayPrefixEntryCount',
      ],
      denseExecutionOrdinalLimit: 64,
      digestParticipation: false,
      elapsedMs: 'monotonic',
      executionCheckpointPolicy: 'every-ordinal-one-through-64-then-powers-of-two-and-final',
      inventoryParticipation: false,
      maximumEvents: 1_664,
      observationalOnly: true,
      phases: [
        'prepare-source-index',
        'prepare-target-usage',
        'enumerate-branches',
        'replay-branches',
        'execution-shared-context',
        'execution-route-usage',
        'execution-frontier-style',
        'execution-frontier-globals',
        'execution-frontier-plan',
        'execution-frontier-candidates',
        'execution-frontier-bundle',
        'execution-frontier-ownership',
        'execution-frontier-target-contract',
        'execution-frontier-root-contract',
        'execution-frontier-artifact',
        'finalize-inventory',
        'shutdown',
      ],
      payloadExcludes: [
        'application-names',
        'component-export-names',
        'environment-values',
        'errors',
        'filenames',
        'module-specifiers',
        'raw-paths',
        'route-identities',
        'selection-contents',
        'source-text',
      ],
      resourceFields: ['heapUsedBytes', 'rssBytes', 'cpuUserMicros', 'cpuSystemMicros'],
      sequence: 'strictly-monotonic-starting-at-one',
      transitions: ['start', 'checkpoint', 'complete'],
      watchdogExtension: false,
      workerMessages: 'observational-only',
      version: 4,
    });
    expect(PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_POLICY_DIGEST).toBe(
      '5d49da6914ca52b9dd41d0117cf1e2be1434636395a9db7e0afbeb0c50ee338f',
    );
    const events: PreviewCompleteRouteInventoryTelemetryEvent[] = [];
    const telemetry = createPreviewCompleteRouteInventoryTelemetryEmitter((event) => {
      events.push(event);
    });
    for (const phase of ['prepare-source-index', 'prepare-target-usage'] as const) {
      telemetry?.emit({ phase, transition: 'start' });
      telemetry?.emit({ phase, transition: 'complete' });
    }
    telemetry?.emit({
      analysisPasses: 0,
      discoveredBranches: 0,
      enumerationPrefixComputationCount: 0,
      enumerationPrefixEntryCount: 0,
      enumerationPrefixHitCount: 0,
      enumerationPrefixRequestCount: 0,
      phase: 'enumerate-branches',
      queuedSelections: 0,
      transition: 'start',
    });
    for (let ordinal = 1; ordinal <= 4_096; ordinal += 1) {
      if (!isPreviewCompleteRouteInventoryTelemetryCheckpoint(ordinal, 4_096)) continue;
      telemetry?.emit({
        analysisPasses: ordinal,
        discoveredBranches: ordinal,
        enumerationPrefixComputationCount: ordinal,
        enumerationPrefixEntryCount: ordinal,
        enumerationPrefixHitCount: 0,
        enumerationPrefixRequestCount: ordinal,
        phase: 'enumerate-branches',
        queuedSelections: ordinal,
        transition: 'checkpoint',
      });
    }
    telemetry?.emit({
      analysisPasses: 4_096,
      discoveredBranches: 8_192,
      enumerationPrefixComputationCount: 4_096,
      enumerationPrefixEntryCount: 4_096,
      enumerationPrefixHitCount: 0,
      enumerationPrefixRequestCount: 4_096,
      phase: 'enumerate-branches',
      queuedSelections: 4_096,
      transition: 'complete',
    });
    telemetry?.emit({
      phase: 'replay-branches',
      replayCompleted: 0,
      replayPrefixComputationCount: 0,
      replayPrefixEntryCount: 0,
      replayPrefixHitCount: 0,
      replayPrefixRequestCount: 0,
      replayTotal: 8_192,
      transition: 'start',
    });
    for (let ordinal = 1; ordinal <= 8_192; ordinal += 1) {
      if (!isPreviewCompleteRouteInventoryTelemetryCheckpoint(ordinal, 8_192)) continue;
      telemetry?.emit({
        phase: 'replay-branches',
        replayCompleted: ordinal,
        replayPrefixComputationCount: ordinal,
        replayPrefixEntryCount: ordinal,
        replayPrefixHitCount: 0,
        replayPrefixRequestCount: ordinal,
        replayTotal: 8_192,
        transition: 'checkpoint',
      });
    }
    telemetry?.emit({
      phase: 'replay-branches',
      replayCompleted: 8_192,
      replayPrefixComputationCount: 8_192,
      replayPrefixEntryCount: 8_192,
      replayPrefixHitCount: 0,
      replayPrefixRequestCount: 8_192,
      replayTotal: 8_192,
      transition: 'complete',
    });
    const prePlanExecutionPhases = [
      'execution-shared-context',
      'execution-route-usage',
      'execution-frontier-style',
      'execution-frontier-globals',
    ] as const;
    const internalExecutionPhases = [
      'execution-frontier-candidates',
      'execution-frontier-bundle',
      'execution-frontier-ownership',
      'execution-frontier-target-contract',
      'execution-frontier-root-contract',
      'execution-frontier-artifact',
    ] as const;
    for (let ordinal = 1; ordinal <= 8_192; ordinal += 1) {
      if (!isPreviewCompleteRouteInventoryExecutionTelemetryCheckpoint(ordinal, 8_192)) {
        continue;
      }
      for (const phase of prePlanExecutionPhases) {
        telemetry?.emit({
          executionPlanCompleted: ordinal - 1,
          executionPlanTotal: 8_192,
          phase,
          routeOrdinal: ordinal,
          transition: 'start',
        });
        telemetry?.emit({
          executionPlanCompleted: ordinal - 1,
          executionPlanTotal: 8_192,
          phase,
          routeOrdinal: ordinal,
          transition: 'complete',
        });
      }
      telemetry?.emit({
        executionPlanCompleted: ordinal - 1,
        executionPlanTotal: 8_192,
        phase: 'execution-frontier-plan',
        routeOrdinal: ordinal,
        transition: 'start',
      });
      for (const phase of internalExecutionPhases) {
        telemetry?.emit({
          executionPlanCompleted: ordinal - 1,
          executionPlanTotal: 8_192,
          phase,
          routeOrdinal: ordinal,
          transition: 'start',
        });
        if (phase === 'execution-frontier-bundle') {
          telemetry?.emit({
            bundleDiagnostics: ZERO_BUNDLE_DIAGNOSTICS,
            executionPlanCompleted: ordinal - 1,
            executionPlanTotal: 8_192,
            phase,
            routeOrdinal: ordinal,
            transition: 'complete',
          });
        } else {
          telemetry?.emit({
            executionPlanCompleted: ordinal - 1,
            executionPlanTotal: 8_192,
            phase,
            routeOrdinal: ordinal,
            transition: 'complete',
          });
        }
      }
      telemetry?.emit({
        executionPlanCompleted: ordinal,
        executionPlanTotal: 8_192,
        phase: 'execution-frontier-plan',
        routeOrdinal: ordinal,
        transition: 'complete',
      });
    }
    telemetry?.emit({ phase: 'finalize-inventory', transition: 'start' });
    telemetry?.emit({ phase: 'finalize-inventory', transition: 'complete' });
    telemetry?.emit({ phase: 'shutdown', transition: 'start' });

    expect(PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_COMPUTED_MAXIMUM_EVENTS).toBe(1_600);
    expect(events).toHaveLength(PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_COMPUTED_MAXIMUM_EVENTS);
    expect(events.length).toBeLessThanOrEqual(
      PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_MAXIMUM_EVENTS,
    );
    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
    const executionEvents = events.filter((event) => event.phase.startsWith('execution-'));
    expect(
      executionEvents.every((event, index) => {
        const previousCompleted = executionEvents[index - 1]?.executionPlanCompleted;
        return (
          index === 0 ||
          (event.executionPlanCompleted !== undefined &&
            previousCompleted !== undefined &&
            event.executionPlanCompleted >= previousCompleted)
        );
      }),
    ).toBe(true);
  });

  it('rejects event 1,665 as the bounded telemetry overflow terminal', () => {
    const events: PreviewCompleteRouteInventoryTelemetryEvent[] = [];
    const telemetry = createPreviewCompleteRouteInventoryTelemetryEmitter((event) => {
      events.push(event);
    });
    if (telemetry === undefined) throw new Error('Overflow telemetry was not created.');
    for (
      let ordinal = 1;
      ordinal <= PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_MAXIMUM_EVENTS;
      ordinal += 1
    ) {
      telemetry.emit({ phase: 'prepare-source-index', transition: 'start' });
    }
    expect(events).toHaveLength(1_664);
    expect(() => {
      telemetry.emit({ phase: 'prepare-source-index', transition: 'start' });
    }).toThrow('Complete route inventory telemetry exceeded 1664 events.');
  });
});
