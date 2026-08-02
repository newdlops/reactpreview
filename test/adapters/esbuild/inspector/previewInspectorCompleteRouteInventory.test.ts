/* eslint-disable max-lines -- Complete-inventory invariants share one source-general fixture. */
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CollectPreviewInspectorRouteBranchPlanOptions,
  PreviewInspectorRouteOwnerLocationInventoryMemo,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteBranchPlan';
import {
  collectPreviewInspectorCompleteRouteInventory,
  createPreviewCompleteRouteInventoryTelemetryEmitter,
  isPreviewCompleteRouteInventoryExecutionTelemetryCheckpoint,
  isPreviewCompleteRouteInventoryTelemetryCheckpoint,
  PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_COMPUTED_MAXIMUM_EVENTS,
  PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_MAXIMUM_EVENTS,
  PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_POLICY,
  PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_POLICY_DIGEST,
  replayPreviewInspectorCompleteRouteEntry,
  type CollectPreviewInspectorCompleteRouteInventoryOptions,
  type PreviewCompleteRouteInventoryTelemetryEvent,
  type PreviewInspectorCompleteRouteInventory,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorCompleteRouteInventory';
import { createPreviewRouteExecutionPlanFixture } from '../../../support/previewRouteExecutionPlanFixture';
import type { PreviewInspectorBundleDiagnostics } from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleDiagnostics';

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

interface OwnerMemoAudit {
  branchPlans: number;
  hits: number;
  identities: Set<string>;
  misses: number;
  provider?: PreviewInspectorRouteOwnerLocationInventoryMemo;
  releases: number;
  requests: number;
}

type PrefixProvider = NonNullable<
  CollectPreviewInspectorRouteBranchPlanOptions['selectionPrefixProvider']
>;

interface PrefixProviderAudit {
  createdAfterPreviousRelease: boolean;
  postReleaseStatistics?: ReturnType<PrefixProvider['getStatistics']>;
  preReleaseStatistics?: ReturnType<PrefixProvider['getStatistics']>;
  provider?: PrefixProvider;
  releases: number;
}

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

const ROOT = path.join(path.sep, 'workspace', 'src', 'App.tsx');
const NESTED = path.join(path.sep, 'workspace', 'src', 'Nested.tsx');
const LEAF = path.join(path.sep, 'workspace', 'src', 'Leaf.tsx');

describe('complete Preview Inspector route inventory', () => {
  beforeEach(() => {
    ownerMemoAudit.instances.length = 0;
    ownerMemoAudit.prefixInstances.length = 0;
    ownerMemoAudit.providerDisabledOracle = false;
    ownerMemoAudit.publicBranchPlans = 0;
  });

  it('materializes every terminal branch and accounts for expanded nested owners', async () => {
    const inventory = await collectFixtureInventory();
    const runnable = inventory.entries.filter((entry) => entry.disposition === 'runnable');
    const constrained = runnable.find((entry) => entry.pattern.includes(':itemId'));
    const nested = runnable.find((entry) => entry.pattern.endsWith('/details/*'));
    const ownerAlias = inventory.entries.find(
      (entry) => entry.disposition === 'duplicate' && entry.componentName === 'Nested',
    );

    expect(inventory.complete).toBe(true);
    expect(constrained?.pathname).toBe('/items/1');
    expect(constrained?.parameters).toEqual({ itemId: '1' });
    expect(nested?.pathname).toBe('/section/details');
    expect(nested?.selection).toHaveLength(2);
    expect(ownerAlias).toMatchObject({
      disposition: 'duplicate',
      reason: 'expanded-owner',
    });
    const duplicateOf =
      ownerAlias?.disposition === 'duplicate' ? ownerAlias.duplicateOf : undefined;
    expect(
      runnable.some((entry) => entry.id === duplicateOf && entry.replay.branchId === duplicateOf),
    ).toBe(true);
    expect(inventory.counts.total).toBe(
      inventory.counts.runnable + inventory.counts.unresolved + inventory.counts.duplicate,
    );
    expect(new Set(inventory.entries.map((entry) => entry.id)).size).toBe(inventory.entries.length);
    expect(inventory.replayPasses).toBe(inventory.counts.runnable + inventory.counts.duplicate);
    expect(inventory.predecessorVersion).toBe(3);
    expect(inventory.version).toBe(4);
    expect(inventory.replayPolicy).toMatchObject({ predecessorVersion: 3, version: 4 });
    expect(runnable.every((entry) => entry.executionPlan.routeId === entry.id)).toBe(true);
  });

  it('round-trips every runnable identity exactly with the same inert replay contract', async () => {
    const fixtureOptions = createFixtureOptions();
    let rootReads = 0;
    const options: CollectPreviewInspectorCompleteRouteInventoryOptions = {
      ...fixtureOptions,
      readSource: (sourcePath) => {
        if (path.normalize(sourcePath) === ROOT) rootReads += 1;
        return fixtureOptions.readSource(sourcePath);
      },
    };
    const inventory = await collectPreviewInspectorCompleteRouteInventory(options);
    rootReads = 0;
    const oracleEntries: (typeof inventory.entries)[number][] = [];
    for (const entry of inventory.entries) {
      if (entry.disposition === 'unresolved') {
        oracleEntries.push(entry);
        continue;
      }
      const replayTarget =
        entry.disposition === 'runnable'
          ? entry
          : inventory.entries.find(
              (candidate) =>
                candidate.disposition === 'runnable' && candidate.id === entry.duplicateOf,
            );
      if (replayTarget?.disposition !== 'runnable') {
        throw new Error('Fixture duplicate did not retain its exact runnable target.');
      }
      const result = await replayPreviewInspectorCompleteRouteEntry(options, replayTarget);
      expect(result.exact).toBe(true);
      if (!result.exact) throw new Error('Uncached exact replay oracle rejected a frozen entry.');
      expect(result.replay).toEqual(entry.replay);
      oracleEntries.push(Object.freeze({ ...entry, replay: result.replay }));
    }
    const uncachedReplayOracle = Object.freeze({
      ...inventory,
      entries: Object.freeze(oracleEntries),
    });

    expect(JSON.stringify(uncachedReplayOracle)).toBe(JSON.stringify(inventory));
    expect(uncachedReplayOracle).toEqual(inventory);
    expect(ownerMemoAudit.publicBranchPlans).toBe(inventory.replayPasses);
    expect(rootReads).toBe(inventory.replayPasses);
  });

  it('fails closed for a missing level and every corrupted compiler-owned identity field', async () => {
    const options = createFixtureOptions();
    const inventory = await collectPreviewInspectorCompleteRouteInventory(options);
    const entry = inventory.entries.find(
      (candidate) => candidate.disposition === 'runnable' && candidate.selection.length > 1,
    );
    expect(entry?.disposition).toBe('runnable');
    if (entry?.disposition !== 'runnable') throw new Error('Fixture did not produce nested route.');
    const missingLevel = Object.freeze({
      ...entry,
      selection: Object.freeze([
        ...entry.selection,
        Object.freeze({ componentName: 'Absent', pattern: '/absent' }),
      ]),
    });
    await expect(replayPreviewInspectorCompleteRouteEntry(options, missingLevel)).resolves.toEqual({
      exact: false,
      reason: 'exact-replay-non-exact-selection',
    });
    for (const corrupted of [
      Object.freeze({ ...entry, id: `${entry.id}-changed` }),
      Object.freeze({ ...entry, owner: { ...entry.owner, exportName: 'changed' } }),
      Object.freeze({ ...entry, sourcePath: `${entry.sourcePath ?? ''}.changed` }),
      Object.freeze({ ...entry, exportName: 'changed' }),
      Object.freeze({ ...entry, pattern: `${entry.pattern}/changed` }),
      Object.freeze({ ...entry, pathname: `${entry.pathname}/changed` }),
    ]) {
      await expect(replayPreviewInspectorCompleteRouteEntry(options, corrupted)).resolves.toEqual({
        exact: false,
        reason: 'exact-replay-identity-mismatch',
      });
    }
  });

  it('keeps traversal ceilings explicit instead of guessing uninspected nested routes', async () => {
    const inventory = await collectFixtureInventory({ maximumAnalysisPasses: 1 });

    expect(inventory.complete).toBe(false);
    expect(inventory.truncated).toBe(true);
    expect(
      inventory.entries.some(
        (entry) => entry.disposition === 'unresolved' && entry.reason === 'analysis-limit',
      ),
    ).toBe(true);
  });

  it('preserves branch, depth, and cyclic-owner accounting under telemetry', async () => {
    const branchLimited = await collectFixtureInventory({ maximumBranches: 1 });
    const depthLimited = await collectFixtureInventory({ maximumDepth: 1 });
    const cyclicSources = new Map<string, string>([
      [
        ROOT,
        `
          import { Route, Routes } from 'react-router-dom';
          import App from './App';
          export default function App() {
            return <Routes><Route path="/self/*" element={<App />} /></Routes>;
          }
        `,
      ],
    ]);
    const cyclic = await collectPreviewInspectorCompleteRouteInventory(
      createOptionsFromSources(cyclicSources),
    );

    expect(branchLimited).toMatchObject({ complete: false, truncated: true });
    expect(branchLimited.counts.total).toBeLessThanOrEqual(1);
    expect(depthLimited).toMatchObject({ complete: false, truncated: true });
    expect(
      depthLimited.entries.some(
        (entry) => entry.disposition === 'unresolved' && entry.reason === 'analysis-limit',
      ),
    ).toBe(true);
    expect(
      cyclic.entries.some(
        (entry) => entry.disposition === 'unresolved' && entry.reason === 'cyclic-owner',
      ),
    ).toBe(true);
    for (const inventory of [branchLimited, depthLimited, cyclic]) {
      expect(inventory.counts.total).toBe(
        inventory.counts.runnable + inventory.counts.duplicate + inventory.counts.unresolved,
      );
    }
  });

  it('keeps observer results and deterministic work counts byte-identical', async () => {
    const events: Parameters<
      NonNullable<Parameters<typeof createPreviewCompleteRouteInventoryTelemetryEmitter>[0]>
    >[0][] = [];
    let observedPlannerCalls = 0;
    const observedOptions = createFixtureOptions();
    const observedTelemetry = createPreviewCompleteRouteInventoryTelemetryEmitter((event) => {
      events.push(event);
    });
    if (observedTelemetry === undefined) throw new Error('Observed telemetry was not created.');
    const observed = await collectPreviewInspectorCompleteRouteInventory({
      ...observedOptions,
      prepareExecutionPlan: async (entry, progress) => {
        observedPlannerCalls += 1;
        return observedOptions.prepareExecutionPlan(entry, progress);
      },
      telemetry: observedTelemetry,
    });
    let plainPlannerCalls = 0;
    const plainOptions = createFixtureOptions();
    const plain = await collectPreviewInspectorCompleteRouteInventory({
      ...plainOptions,
      prepareExecutionPlan: async (entry, progress) => {
        plainPlannerCalls += 1;
        return plainOptions.prepareExecutionPlan(entry, progress);
      },
    });

    expect(observed).toEqual(plain);
    expect(JSON.stringify(observed)).toBe(JSON.stringify(plain));
    expect(observed.analysisPasses).toBe(plain.analysisPasses);
    expect(observed.replayPasses).toBe(plain.replayPasses);
    expect(observedPlannerCalls).toBe(plainPlannerCalls);
    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
    expect(
      events.every((event, index) => {
        const previous = events[index - 1];
        return index === 0 || (previous !== undefined && event.elapsedMs >= previous.elapsedMs);
      }),
    ).toBe(true);
    expect(
      events.every(
        (event) =>
          Object.isFrozen(event) &&
          event.heapUsedBytes >= 0 &&
          event.rssBytes >= 0 &&
          event.cpuUserMicros >= 0 &&
          event.cpuSystemMicros >= 0,
      ),
    ).toBe(true);

    const throwingTelemetry = createPreviewCompleteRouteInventoryTelemetryEmitter(() => {
      throw new Error('synthetic observer failure');
    });
    if (throwingTelemetry === undefined) throw new Error('Throwing telemetry was not created.');
    const throwing = await collectPreviewInspectorCompleteRouteInventory({
      ...createFixtureOptions(),
      telemetry: throwingTelemetry,
    });
    expect(throwing).toEqual(plain);
  });

  it('matches a real provider-disabled full-plan oracle across generic fanout and limits', async () => {
    const cycleSources = new Map<string, string>([
      [
        ROOT,
        `
          import { Route, Routes } from 'react-router-dom';
          import App from './App';
          export default function App() {
            return <Routes><Route path="/self/*" element={<App />} /></Routes>;
          }
        `,
      ],
    ]);
    const ownersPath = path.join(path.sep, 'workspace', 'src', 'Owners.tsx');
    const sharedLeafPath = path.join(path.sep, 'workspace', 'src', 'SharedLeaf.tsx');
    const samePathExportSources = new Map<string, string>([
      [
        ROOT,
        `
          import { Route, Routes } from 'react-router-dom';
          import DefaultOwner, { NamedOwner } from './Owners';
          export default function App() {
            return <Routes>
              <Route path="/default/*" element={<DefaultOwner />} />
              <Route path="/named/*" element={<NamedOwner />} />
            </Routes>;
          }
        `,
      ],
      [
        ownersPath,
        `
          import { Route, Routes } from 'react-router-dom';
          import SharedLeaf from './SharedLeaf';
          export default function DefaultOwner() {
            return <Routes><Route path="leaf" element={<SharedLeaf />} /></Routes>;
          }
          export function NamedOwner() {
            return <Routes><Route path="leaf" element={<SharedLeaf />} /></Routes>;
          }
        `,
      ],
      [sharedLeafPath, 'export default function SharedLeaf() { return <main>leaf</main>; }'],
    ]);
    const scenarios: readonly (() => CollectPreviewInspectorCompleteRouteInventoryOptions)[] = [
      () => createFixtureOptions(),
      () => createFixtureOptions({ maximumAnalysisPasses: 2 }),
      () => createFixtureOptions({ maximumBranches: 2 }),
      () => createFixtureOptions({ maximumDepth: 1 }),
      () => createOptionsFromSources(cycleSources),
      () => createOptionsFromSources(samePathExportSources),
    ];

    for (const createOptions of scenarios) {
      const productionInputs: string[] = [];
      const productionOptions = createOptions();
      const productionPrefixStart = ownerMemoAudit.prefixInstances.length;
      const production = await collectPreviewInspectorCompleteRouteInventory({
        ...productionOptions,
        prepareExecutionPlan: async (entry, progress) => {
          productionInputs.push(JSON.stringify({ entry, progress }));
          return productionOptions.prepareExecutionPlan(entry, progress);
        },
      });
      const productionPrefixAudits = ownerMemoAudit.prefixInstances.slice(productionPrefixStart);
      const oracleInputs: string[] = [];
      const oracleOptions = createOptions();
      const oraclePrefixStart = ownerMemoAudit.prefixInstances.length;
      ownerMemoAudit.providerDisabledOracle = true;
      let oracle: PreviewInspectorCompleteRouteInventory;
      try {
        oracle = await collectPreviewInspectorCompleteRouteInventory({
          ...oracleOptions,
          prepareExecutionPlan: async (entry, progress) => {
            oracleInputs.push(JSON.stringify({ entry, progress }));
            return oracleOptions.prepareExecutionPlan(entry, progress);
          },
        });
      } finally {
        ownerMemoAudit.providerDisabledOracle = false;
      }
      const oraclePrefixAudits = ownerMemoAudit.prefixInstances.slice(oraclePrefixStart);

      expect(oracle).toEqual(production);
      expect(JSON.stringify(oracle)).toBe(JSON.stringify(production));
      expect(oracle.entries).toEqual(production.entries);
      expect(oracle.entries.map((entry) => entry.id)).toEqual(
        production.entries.map((entry) => entry.id),
      );
      expect(oracle.entries.map((entry) => entry.disposition)).toEqual(
        production.entries.map((entry) => entry.disposition),
      );
      expect(oracle.counts).toEqual(production.counts);
      expect(oracle.dependencyPaths).toEqual(production.dependencyPaths);
      expect(oracle.analysisPasses).toBe(production.analysisPasses);
      expect(oracle.replayPasses).toBe(production.replayPasses);
      expect(oracle.complete).toBe(production.complete);
      expect(oracle.truncated).toBe(production.truncated);
      expect(oracleInputs).toEqual(productionInputs);
      expect(productionPrefixAudits).toHaveLength(2);
      expect(oraclePrefixAudits).toHaveLength(2);
      expect(
        oraclePrefixAudits.every(
          (audit) =>
            audit.preReleaseStatistics?.requests === 0 &&
            audit.preReleaseStatistics.computations === 0 &&
            audit.preReleaseStatistics.hits === 0 &&
            audit.preReleaseStatistics.entries === 0 &&
            audit.postReleaseStatistics?.released === true,
        ),
      ).toBe(true);
    }
  });

  it('reduces shared-prefix enumeration work without entering exact replay', async () => {
    const enumerationReads = new Map<string, number>();
    const replayReads = new Map<string, number>();
    let phase: 'enumeration' | 'idle' | 'replay' = 'idle';
    let plannerCalls = 0;
    const fixtureOptions = createFixtureOptions();
    const prefixEvents: PreviewCompleteRouteInventoryTelemetryEvent[] = [];
    const telemetry = createPreviewCompleteRouteInventoryTelemetryEmitter((event) => {
      if (event.phase === 'enumerate-branches' || event.phase === 'replay-branches') {
        prefixEvents.push(event);
      }
      if (event.phase === 'enumerate-branches' && event.transition === 'start') {
        phase = 'enumeration';
      } else if (event.phase === 'enumerate-branches' && event.transition === 'complete') {
        phase = 'idle';
      } else if (event.phase === 'replay-branches' && event.transition === 'start') {
        phase = 'replay';
      } else if (event.phase === 'replay-branches' && event.transition === 'complete') {
        phase = 'idle';
      }
    });
    if (telemetry === undefined) throw new Error('Work-count telemetry was not created.');
    const inventory = await collectPreviewInspectorCompleteRouteInventory({
      ...fixtureOptions,
      prepareExecutionPlan: async (entry, progress) => {
        plannerCalls += 1;
        return fixtureOptions.prepareExecutionPlan(entry, progress);
      },
      readSource: async (sourcePath) => {
        const normalized = path.normalize(sourcePath);
        const counts =
          phase === 'enumeration' ? enumerationReads : phase === 'replay' ? replayReads : undefined;
        if (counts !== undefined && [ROOT, NESTED, LEAF].includes(normalized)) {
          counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
        }
        return fixtureOptions.readSource(sourcePath);
      },
      telemetry,
    });
    const selectionPasses = 6;
    const uncachedOwnerPrefixVisits = 2 + 2 + 2 + 3 + 3 + 3;
    const uniqueOwnerIdentities = 3;
    const cachedOwnerRequests = uncachedOwnerPrefixVisits - 1;
    const cachedOwnerMisses = [...enumerationReads.values()].reduce(
      (total, count) => total + count,
      0,
    );
    const cachedOwnerHits = cachedOwnerRequests - cachedOwnerMisses;
    const replayOwnerRequests = 2 + 2 + 3 + 3 + 3 - 1;

    expect(inventory).toMatchObject({
      analysisPasses: selectionPasses,
      complete: true,
      replayPasses: 5,
      truncated: false,
    });
    expect(inventory.counts).toEqual({ duplicate: 1, runnable: 4, total: 5, unresolved: 0 });
    expect(inventory.counts.total).toBe(
      inventory.counts.runnable + inventory.counts.duplicate + inventory.counts.unresolved,
    );
    expect(plannerCalls).toBe(inventory.counts.runnable);
    expect(cachedOwnerMisses).toBe(uniqueOwnerIdentities);
    expect(cachedOwnerRequests).toBe(cachedOwnerHits + cachedOwnerMisses);
    expect(cachedOwnerMisses).toBeLessThan(uncachedOwnerPrefixVisits);
    expect(enumerationReads).toEqual(
      new Map([
        [ROOT, 1],
        [LEAF, 1],
        [NESTED, 1],
      ]),
    );
    expect([...replayReads.values()].reduce((total, count) => total + count, 0)).toBe(
      uniqueOwnerIdentities,
    );
    expect(replayReads).toEqual(
      new Map([
        [ROOT, 1],
        [LEAF, 1],
        [NESTED, 1],
      ]),
    );
    expect(replayReads.get(ROOT)).toBe(1);
    expect(inventory.dependencyPaths).toEqual(expect.arrayContaining([ROOT, NESTED, LEAF]));
    expect(ownerMemoAudit.instances).toHaveLength(2);
    const enumerationMemo = ownerMemoAudit.instances[0];
    const replayMemo = ownerMemoAudit.instances[1];
    expect(enumerationMemo?.provider).not.toBe(replayMemo?.provider);
    expect(enumerationMemo).toMatchObject({
      branchPlans: selectionPasses,
      hits: 11,
      misses: uniqueOwnerIdentities,
      releases: 1,
      requests: cachedOwnerRequests,
    });
    expect(replayMemo).toMatchObject({
      branchPlans: inventory.replayPasses,
      hits: 9,
      misses: uniqueOwnerIdentities,
      releases: 1,
      requests: replayOwnerRequests,
    });
    expect(replayMemo?.requests).toBe((replayMemo?.hits ?? 0) + (replayMemo?.misses ?? 0));
    expect(replayMemo?.misses).toBe(replayMemo?.identities.size);
    expect(replayMemo?.identities).toContain(JSON.stringify([ROOT, 'default']));
    expect(enumerationMemo?.identities).toContain(JSON.stringify([ROOT, 'default']));
    const replayDispositionCount = inventory.counts.runnable + inventory.counts.duplicate;
    expect(replayDispositionCount).toBe(inventory.replayPasses);
    expect(replayMemo?.branchPlans).toBe(replayDispositionCount);
    expect(ownerMemoAudit.prefixInstances).toHaveLength(2);
    const enumerationPrefix = ownerMemoAudit.prefixInstances[0];
    const replayPrefix = ownerMemoAudit.prefixInstances[1];
    expect(enumerationPrefix?.provider).not.toBe(replayPrefix?.provider);
    expect(enumerationPrefix).toMatchObject({
      createdAfterPreviousRelease: true,
      postReleaseStatistics: { entries: 0, released: true },
      releases: 1,
    });
    expect(replayPrefix).toMatchObject({
      createdAfterPreviousRelease: true,
      postReleaseStatistics: { entries: 0, released: true },
      releases: 1,
    });
    expect(enumerationPrefix?.preReleaseStatistics?.entries).toBeGreaterThan(0);
    expect(replayPrefix?.preReleaseStatistics?.entries).toBeGreaterThan(0);
    const enumerationStart = prefixEvents.find(
      (event) => event.phase === 'enumerate-branches' && event.transition === 'start',
    );
    const enumerationComplete = prefixEvents.find(
      (event) => event.phase === 'enumerate-branches' && event.transition === 'complete',
    );
    const replayStart = prefixEvents.find(
      (event) => event.phase === 'replay-branches' && event.transition === 'start',
    );
    const replayComplete = prefixEvents.find(
      (event) => event.phase === 'replay-branches' && event.transition === 'complete',
    );
    expect(enumerationStart).toMatchObject({
      enumerationPrefixComputationCount: 0,
      enumerationPrefixEntryCount: 0,
      enumerationPrefixHitCount: 0,
      enumerationPrefixRequestCount: 0,
    });
    expect(replayStart).toMatchObject({
      replayPrefixComputationCount: 0,
      replayPrefixEntryCount: 0,
      replayPrefixHitCount: 0,
      replayPrefixRequestCount: 0,
    });
    expect(enumerationComplete).toMatchObject({
      enumerationPrefixComputationCount: enumerationPrefix?.preReleaseStatistics?.computations,
      enumerationPrefixEntryCount: enumerationPrefix?.preReleaseStatistics?.entries,
      enumerationPrefixHitCount: enumerationPrefix?.preReleaseStatistics?.hits,
      enumerationPrefixRequestCount: enumerationPrefix?.preReleaseStatistics?.requests,
    });
    expect(replayComplete).toMatchObject({
      replayPrefixComputationCount: replayPrefix?.preReleaseStatistics?.computations,
      replayPrefixEntryCount: replayPrefix?.preReleaseStatistics?.entries,
      replayPrefixHitCount: replayPrefix?.preReleaseStatistics?.hits,
      replayPrefixRequestCount: replayPrefix?.preReleaseStatistics?.requests,
    });
    expect(enumerationComplete).toMatchObject({
      enumerationPrefixComputationCount: 1,
      enumerationPrefixEntryCount: 1,
      enumerationPrefixHitCount: 1,
      enumerationPrefixRequestCount: 2,
    });
    expect(replayComplete).toMatchObject({
      replayPrefixComputationCount: 1,
      replayPrefixEntryCount: 1,
      replayPrefixHitCount: 1,
      replayPrefixRequestCount: 2,
    });
    expect(enumerationComplete?.enumerationPrefixComputationCount).toBeLessThan(
      enumerationComplete?.enumerationPrefixRequestCount ?? 0,
    );
    expect(replayComplete?.replayPrefixComputationCount).toBeLessThan(
      replayComplete?.replayPrefixRequestCount ?? 0,
    );
    expect(enumerationComplete?.enumerationPrefixRequestCount).toBe(
      (enumerationComplete?.enumerationPrefixComputationCount ?? 0) +
        (enumerationComplete?.enumerationPrefixHitCount ?? 0),
    );
    expect(replayComplete?.replayPrefixRequestCount).toBe(
      (replayComplete?.replayPrefixComputationCount ?? 0) +
        (replayComplete?.replayPrefixHitCount ?? 0),
    );
    if (replayMemo?.provider === undefined) throw new Error('Replay memo audit was not retained.');
    await expect(replayMemo.provider.collect(ROOT, 'default')).rejects.toThrow(
      'owner-location inventory memo was already released',
    );
  });

  it('keeps same-path exports distinct inside the replay request', async () => {
    const ownersPath = path.join(path.sep, 'workspace', 'src', 'Owners.tsx');
    const leafPath = path.join(path.sep, 'workspace', 'src', 'SharedLeaf.tsx');
    const sources = new Map<string, string>([
      [
        ROOT,
        `
          import { Route, Routes } from 'react-router-dom';
          import DefaultOwner, { NamedOwner } from './Owners';
          export default function App() {
            return <Routes>
              <Route path="/default/*" element={<DefaultOwner />} />
              <Route path="/named/*" element={<NamedOwner />} />
            </Routes>;
          }
        `,
      ],
      [
        ownersPath,
        `
          import { Route, Routes } from 'react-router-dom';
          import SharedLeaf from './SharedLeaf';
          export default function DefaultOwner() {
            return <Routes><Route path="leaf" element={<SharedLeaf />} /></Routes>;
          }
          export function NamedOwner() {
            return <Routes><Route path="leaf" element={<SharedLeaf />} /></Routes>;
          }
        `,
      ],
      [leafPath, 'export default function SharedLeaf() { return <main>leaf</main>; }'],
    ]);
    const inventory = await collectPreviewInspectorCompleteRouteInventory(
      createOptionsFromSources(sources),
    );
    const replayMemo = ownerMemoAudit.instances[1];
    const defaultIdentity = JSON.stringify([ownersPath, 'default']);
    const namedIdentity = JSON.stringify([ownersPath, 'NamedOwner']);

    expect(inventory.complete).toBe(true);
    expect(replayMemo?.identities).toContain(defaultIdentity);
    expect(replayMemo?.identities).toContain(namedIdentity);
    expect(replayMemo?.misses).toBe(replayMemo?.identities.size);
    expect(defaultIdentity).not.toBe(namedIdentity);
  });

  it('releases enumeration providers and preserves rejection identity before replay creation', async () => {
    const fixtureOptions = createFixtureOptions();
    const rejection = new Error('synthetic enumeration owner rejection');

    await expect(
      collectPreviewInspectorCompleteRouteInventory({
        ...fixtureOptions,
        readSource: (sourcePath) =>
          path.normalize(sourcePath) === ROOT
            ? Promise.reject(rejection)
            : fixtureOptions.readSource(sourcePath),
      }),
    ).rejects.toBe(rejection);

    expect(ownerMemoAudit.instances).toHaveLength(1);
    expect(ownerMemoAudit.instances[0]).toMatchObject({
      branchPlans: 1,
      hits: 0,
      misses: 1,
      releases: 1,
      requests: 1,
    });
    expect(ownerMemoAudit.prefixInstances).toHaveLength(1);
    expect(ownerMemoAudit.prefixInstances[0]).toMatchObject({
      postReleaseStatistics: {
        computations: 0,
        entries: 0,
        hits: 0,
        released: true,
        requests: 0,
      },
      preReleaseStatistics: {
        computations: 0,
        entries: 0,
        hits: 0,
        released: false,
        requests: 0,
      },
      releases: 1,
    });
  });

  it('releases replay state on owner-analysis rejection before execution planning', async () => {
    const fixtureOptions = createFixtureOptions();
    let phase: 'enumeration' | 'idle' | 'replay' = 'idle';
    let plannerCalls = 0;
    const telemetry = createPreviewCompleteRouteInventoryTelemetryEmitter((event) => {
      if (event.phase === 'enumerate-branches' && event.transition === 'start') {
        phase = 'enumeration';
      } else if (event.phase === 'enumerate-branches' && event.transition === 'complete') {
        phase = 'idle';
      } else if (event.phase === 'replay-branches' && event.transition === 'start') {
        phase = 'replay';
      }
    });
    if (telemetry === undefined) throw new Error('Rejection telemetry was not created.');

    await expect(
      collectPreviewInspectorCompleteRouteInventory({
        ...fixtureOptions,
        prepareExecutionPlan: async (entry, progress) => {
          plannerCalls += 1;
          return fixtureOptions.prepareExecutionPlan(entry, progress);
        },
        readSource: (sourcePath) =>
          phase === 'replay' && path.normalize(sourcePath) === ROOT
            ? Promise.reject(new Error('synthetic replay owner rejection'))
            : fixtureOptions.readSource(sourcePath),
        telemetry,
      }),
    ).rejects.toThrow('synthetic replay owner rejection');

    expect(plannerCalls).toBe(0);
    expect(ownerMemoAudit.instances).toHaveLength(2);
    const replayMemo = ownerMemoAudit.instances[1];
    expect(replayMemo).toMatchObject({
      branchPlans: 1,
      hits: 0,
      misses: 1,
      releases: 1,
      requests: 1,
    });
    expect(ownerMemoAudit.prefixInstances).toHaveLength(2);
    expect(ownerMemoAudit.prefixInstances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Vitest matcher type.
          postReleaseStatistics: expect.objectContaining({ entries: 0, released: true }),
          releases: 1,
        }),
      ]),
    );
    expect(ownerMemoAudit.prefixInstances.every((audit) => audit.releases === 1)).toBe(true);
    if (replayMemo?.provider === undefined)
      throw new Error('Rejected replay memo was not retained.');
    await expect(replayMemo.provider.collect(ROOT, 'default')).rejects.toThrow(
      'owner-location inventory memo was already released',
    );
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

  it('demotes inert exact routes when the real fast planner cannot reproduce them', async () => {
    const inventory = await collectPreviewInspectorCompleteRouteInventory({
      ...createFixtureOptions(),
      prepareExecutionPlan: () => Promise.resolve(undefined),
    });

    expect(inventory.counts.runnable).toBe(0);
    expect(
      inventory.entries.some(
        (entry) =>
          entry.disposition === 'unresolved' && entry.reason === 'execution-plan-unavailable',
      ),
    ).toBe(true);
  });

  it('accounts an unprovable dynamic direct route as unresolved instead of dropping it', async () => {
    const dynamicLeaf = path.join(path.sep, 'workspace', 'src', 'DynamicLeaf.tsx');
    const sources = new Map<string, string>([
      [
        ROOT,
        `
          import { Route, Routes } from 'react-router-dom';
          import DynamicLeaf from './DynamicLeaf';
          export default function App() {
            return <Routes><Route path={readPath()} element={<DynamicLeaf />} /></Routes>;
          }
        `,
      ],
      [dynamicLeaf, 'export default function DynamicLeaf() { return <main />; }'],
    ]);
    const options = createOptionsFromSources(sources);
    const inventory = await collectPreviewInspectorCompleteRouteInventory(options);

    expect(inventory.complete).toBe(true);
    expect(inventory.entries).toEqual([
      expect.objectContaining({
        componentName: 'DynamicLeaf',
        disposition: 'unresolved',
        reason: 'catalog-unresolved',
      }),
    ]);
    expect(inventory.counts.total).toBe(
      inventory.counts.runnable + inventory.counts.unresolved + inventory.counts.duplicate,
    );
  });

  it('expands an exact component-base owner through factory pages and a nested submodule', async () => {
    const sectionApp = path.join(path.sep, 'workspace', 'src', 'SectionApp.tsx');
    const managementApp = path.join(path.sep, 'workspace', 'src', 'ManagementApp.tsx');
    const listPage = path.join(path.sep, 'workspace', 'src', 'ListPage.tsx');
    const detailsPage = path.join(path.sep, 'workspace', 'src', 'DetailsPage.tsx');
    const createModule = path.join(path.sep, 'workspace', 'src', 'create-section-module.ts');
    const createModuleBase = path.join(
      path.sep,
      'workspace',
      'src',
      'create-section-module-base.tsx',
    );
    const registry = path.join(path.sep, 'workspace', 'src', 'route-registry.ts');
    const catalog = path.join(path.sep, 'workspace', 'src', 'routes.json');
    const sources = new Map<string, string>([
      [
        ROOT,
        `
          import { Route, Routes } from 'react-router-dom';
          import { SectionApp } from './SectionApp';
          export default function App() {
            return <Routes>
              <Route path={normalize(\`\${SectionApp.basePath}/*\`)} element={<SectionApp />} />
            </Routes>;
          }
        `,
      ],
      [
        sectionApp,
        `
          import { createSectionModule } from './create-section-module';
          import { ListPage } from './ListPage';
          import { ManagementApp } from './ManagementApp';
          export const SectionApp = createSectionModule(
            '/section',
            { ListPage },
            [ManagementApp],
            ({ generatedPages, generatedModules }) =>
              <Routes>{generatedPages}{generatedModules}</Routes>,
          );
        `,
      ],
      [
        managementApp,
        `
          import { createSectionModule } from './create-section-module';
          import { DetailsPage } from './DetailsPage';
          export const ManagementApp = createSectionModule(
            '/section/manage',
            { DetailsPage },
            [],
            ({ generatedPages, generatedModules }) =>
              <Routes>{generatedPages}{generatedModules}</Routes>,
          );
        `,
      ],
      [
        createModule,
        `
          import { createSectionModuleBase } from './create-section-module-base';
          import { routeNamePathMap } from './route-registry';
          export const createSectionModule = createSectionModuleBase(routeNamePathMap);
        `,
      ],
      [
        createModuleBase,
        `
          export const createSectionModuleBase = (catalog) =>
            (basePath, pages, subModules, Component) =>
              withProps({
                generatedPages: Object.entries(pages).map(([name, Page]) => <Route />),
                generatedModules: subModules.map((App) => <Route />),
              })(Component);
        `,
      ],
      [
        registry,
        `
          import routeData from './routes.json';
          const pathNameMap = normalizeCatalog(routeData);
          export const routeNamePathMap = invert(pathNameMap);
        `,
      ],
      [
        catalog,
        JSON.stringify({
          section: {
            index: 'ListPage',
            manage: { details: 'DetailsPage' },
          },
        }),
      ],
      [listPage, 'export function ListPage() { return <main />; }'],
      [detailsPage, 'export function DetailsPage() { return <main />; }'],
    ]);
    const options = createOptionsFromSources(sources);
    const inventory = await collectPreviewInspectorCompleteRouteInventory(options);
    const runnable = inventory.entries.filter((entry) => entry.disposition === 'runnable');
    const nested = runnable.find((entry) => entry.componentName === 'DetailsPage');

    expect(runnable.map((entry) => entry.pattern)).toEqual(
      expect.arrayContaining(['/section', '/section/manage/details']),
    );
    expect(nested?.selection).toHaveLength(3);
    expect(
      inventory.entries.some(
        (entry) =>
          entry.disposition === 'duplicate' &&
          entry.componentName === 'SectionApp' &&
          entry.reason === 'expanded-owner',
      ),
    ).toBe(true);
    expect(
      inventory.entries.some(
        (entry) =>
          entry.disposition === 'duplicate' &&
          entry.componentName === 'ManagementApp' &&
          entry.reason === 'expanded-owner',
      ),
    ).toBe(true);
    expect(inventory.counts.total).toBe(
      inventory.counts.runnable + inventory.counts.unresolved + inventory.counts.duplicate,
    );
    expect(nested?.disposition).toBe('runnable');
    if (nested?.disposition !== 'runnable') {
      throw new Error('Factory fixture did not produce its nested page.');
    }
    await expect(replayPreviewInspectorCompleteRouteEntry(options, nested)).resolves.toEqual({
      exact: true,
      replay: nested.replay,
    });
    expect(nested.executionPlan.routeId).toBe(nested.id);
  });
});

/** Collects the reusable nested-route fixture under optional explicit traversal bounds. */
async function collectFixtureInventory(
  limits?: Parameters<typeof collectPreviewInspectorCompleteRouteInventory>[0]['limits'],
): Promise<PreviewInspectorCompleteRouteInventory> {
  return collectPreviewInspectorCompleteRouteInventory(createFixtureOptions(limits));
}

/** Creates inert inventory inputs plus deterministic execution-plan artifacts. */
function createFixtureOptions(
  limits?: CollectPreviewInspectorCompleteRouteInventoryOptions['limits'],
): CollectPreviewInspectorCompleteRouteInventoryOptions {
  const sources = new Map<string, string>([
    [
      ROOT,
      `
        import { Route, Routes } from 'react-router-dom';
        import Leaf from './Leaf';
        import Nested from './Nested';
        export default function App() {
          return <Routes>
            <Route index element={<Leaf />} />
            <Route path="/items/:itemId(\\\\d+)?" element={<Leaf />} />
            <Route path="/section/*" element={<Nested />} />
          </Routes>;
        }
      `,
    ],
    [
      NESTED,
      `
        import { Route, Routes } from 'react-router-dom';
        import Leaf from './Leaf';
        export default function Nested() {
          return <Routes>
            <Route index element={<Leaf />} />
            <Route path="details/*" element={<Leaf />} />
          </Routes>;
        }
      `,
    ],
    [LEAF, 'export default function Leaf() { return <main>leaf</main>; }'],
  ]);
  return {
    documentPath: ROOT,
    exportName: 'default',
    ...(limits === undefined ? {} : { limits }),
    prepareExecutionPlan: (entry) =>
      Promise.resolve(
        createPreviewRouteExecutionPlanFixture({
          componentName: entry.componentName,
          ...(entry.exportName === undefined ? {} : { exportName: entry.exportName }),
          pathname: entry.pathname,
          pattern: entry.pattern,
          routeId: entry.id,
          selection: entry.selection,
          sourcePath: entry.sourcePath ?? ROOT,
        }),
      ),
    readSource: (sourcePath) => Promise.resolve(sources.get(path.normalize(sourcePath))),
    renderChain: Object.freeze({
      dependencyPaths: Object.freeze([ROOT]),
      paths: Object.freeze([]),
      reachability: 'entry-unreachable',
      stopReason: 'entry-not-found',
      target: Object.freeze({ exportName: 'default', sourcePath: ROOT }),
      truncated: false,
    }),
    resolveModule: (specifier, importer) => {
      if (!specifier.startsWith('.')) return undefined;
      const candidate = path.resolve(path.dirname(importer), `${specifier}.tsx`);
      return sources.has(candidate) ? candidate : undefined;
    },
    sourcePaths: Object.freeze([...sources.keys()]),
  };
}

/** Creates complete-inventory options for one self-contained immutable virtual source graph. */
function createOptionsFromSources(
  sources: ReadonlyMap<string, string>,
): CollectPreviewInspectorCompleteRouteInventoryOptions {
  return {
    documentPath: ROOT,
    exportName: 'default',
    prepareExecutionPlan: (entry) =>
      Promise.resolve(
        createPreviewRouteExecutionPlanFixture({
          componentName: entry.componentName,
          ...(entry.exportName === undefined ? {} : { exportName: entry.exportName }),
          pathname: entry.pathname,
          pattern: entry.pattern,
          routeId: entry.id,
          selection: entry.selection,
          sourcePath: entry.sourcePath ?? ROOT,
        }),
      ),
    readSource: (sourcePath) => Promise.resolve(sources.get(path.normalize(sourcePath))),
    renderChain: Object.freeze({
      dependencyPaths: Object.freeze([ROOT]),
      paths: Object.freeze([]),
      reachability: 'entry-unreachable',
      stopReason: 'entry-not-found',
      target: Object.freeze({ exportName: 'default', sourcePath: ROOT }),
      truncated: false,
    }),
    resolveModule: (specifier, importer) => {
      if (!specifier.startsWith('.')) return undefined;
      const candidate = path.resolve(path.dirname(importer), specifier);
      return [candidate, `${candidate}.ts`, `${candidate}.tsx`, `${candidate}.json`].find(
        (sourcePath) => sources.has(sourcePath),
      );
    },
    sourcePaths: Object.freeze(
      [...sources.keys()].filter((sourcePath) => !sourcePath.endsWith('.json')),
    ),
  };
}
