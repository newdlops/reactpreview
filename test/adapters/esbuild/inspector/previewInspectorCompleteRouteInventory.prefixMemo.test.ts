/** Covers prefixMemo behavior for previewInspectorCompleteRouteInventory. */
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
  type PreviewCompleteRouteInventoryTelemetryEvent,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorCompleteRouteInventory';

import {
  createFixtureOptions,
  createOptionsFromSources,
  LEAF,
  NESTED,
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
});
