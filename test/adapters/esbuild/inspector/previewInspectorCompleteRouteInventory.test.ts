/** Covers enumeration behavior for previewInspectorCompleteRouteInventory. */
/** Verifies authored-source previewInspectorCompleteRouteInventory invariants. */
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CollectPreviewInspectorRouteBranchPlanOptions,
  PreviewInspectorRouteOwnerLocationInventoryMemo,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteBranchPlan';

import {
  collectPreviewInspectorCompleteRouteInventory,
  createPreviewCompleteRouteInventoryTelemetryEmitter,
  replayPreviewInspectorCompleteRouteEntry,
  type CollectPreviewInspectorCompleteRouteInventoryOptions,
  type PreviewInspectorCompleteRouteInventory,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorCompleteRouteInventory';

import {
  collectFixtureInventory,
  createFixtureOptions,
  createOptionsFromSources,
  ROOT,
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
});
