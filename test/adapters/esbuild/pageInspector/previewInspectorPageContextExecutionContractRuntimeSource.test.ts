/** Exercises candidate-scoped time contracts without importing React or project modules. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorPageContextExecutionContractRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageContextExecutionContractRuntimeSource';

interface TemporalContractFixture {
  readonly activate: (snapshot: unknown) => boolean;
  readonly active: (candidateId?: string) => unknown;
  readonly commitRefreshes: () => number;
  readonly dataRevision: () => number;
  readonly overrides: () => readonly [string, { readonly mode: string }][];
  readonly release: () => boolean;
  readonly released: (candidateId?: string) => unknown;
  readonly releasedRequests: () => readonly string[];
  readonly restoration: () => unknown;
  readonly seedRestoration: (snapshot: unknown) => void;
  readonly shouldHoldRequest: () => boolean;
  readonly setRuntimeStatus: (status: string) => void;
  readonly snapshot: () => {
    readonly backendScenarioEntries: readonly { readonly requestId: string }[];
    readonly conditionEntries: readonly unknown[];
    readonly fingerprint: string;
    readonly holdPolicy: string;
    readonly kind: string;
    readonly observationWindowMs: number;
    readonly observedAt: number;
    readonly released: boolean;
    readonly runtimeStateEntries: readonly { readonly path: string; readonly transient: boolean }[];
    readonly signalCount: number;
  };
}

/** Evaluates the generated contract against exact runtime fallback and request corridor evidence. */
function createTemporalContractFixture(transient: boolean): TemporalContractFixture {
  const context = vm.createContext({ __transient: transient });
  vm.runInContext(
    `
      const previewEntryRevision = 12;
      let commitRefreshes = 0;
      const releasedRequests = [];
      const targetExportName = globalThis.__transient ? 'Skeleton' : 'CompanyCard';
      const state = {
        applicationPath: ['ExplorePage', targetExportName],
        key: 'candidate:target',
        status: 'reached',
        targetExportName,
      };
      const previewInspectorSession = {
        automaticNeuralAssistanceByKey: new Map(),
        dataRequests: new Map(globalThis.__transient ? [[
          'request:cards',
          { id: 'request:cards', kind: 'rest', method: 'GET', reachabilityKey: state.key },
        ]] : []),
        dataRevision: 0,
        neuralAssistancePending: false,
        neuralAssistanceSequence: 0,
        renderConditions: new Map(globalThis.__transient ? [[
          'condition:loading',
          { effectiveEnabled: true, expression: 'query.isLoading', reachabilityKey: state.key },
        ]] : []),
        runtimeFallbackValues: new Map(globalThis.__transient ? [[
          'fallback:query',
          { loading: true, status: 'loading' },
        ]] : []),
        runtimeFallbacks: new Map(globalThis.__transient ? [[
          'fallback:query',
          {
            reachabilityKey: state.key,
            smartPathValues: [
              { path: 'loading', role: 'render-state', value: true },
              { path: 'status', role: 'render-state', value: 'loading' },
            ],
          },
        ]] : []),
        selectedExportName: targetExportName,
        selectedPageCandidateId: 'candidate',
        virtualBackendScenarios: new Map(),
      };
      function initializePreviewInspectorDataState() {}
      function initializePreviewInspectorRuntimeFallbackState() {}
      function initializePreviewInspectorVirtualBackendState() {}
      function parsePreviewInspectorRequiredPath(path) { return { path: path.split('.') }; }
      function readPreviewInspectorRequiredPathSeed(value, path) {
        let current = value;
        for (const key of path) current = current?.[key];
        return current;
      }
      function releasePreviewInspectorVirtualBackendPendingRequests(ids) {
        releasedRequests.push(...ids);
      }
      function notifyPreviewInspector() {}
      function schedulePreviewInspectorCommitRefresh() { commitRefreshes += 1; }
      function schedulePreviewInspectorTreeRefresh() {}
      function setPreviewInspectorNeuralLearningStatus() {}
      ${createPreviewInspectorPageContextExecutionContractRuntimeSource()}
      globalThis.__fixture = {
        activate: activatePreviewInspectorNeuralTemporalStateContract,
        active: readPreviewInspectorActiveNeuralTemporalStateContract,
        commitRefreshes: () => commitRefreshes,
        dataRevision: () => previewInspectorSession.dataRevision,
        overrides: () => [...previewInspectorSession.temporalBackendScenarioOverrides],
        release: releasePreviewInspectorNeuralTemporalStateContract,
        released: readPreviewInspectorReleasedNeuralTemporalStateContract,
        releasedRequests: () => [...releasedRequests],
        restoration: () => previewInspectorSession.automaticNeuralAssistanceByKey.get('time'),
        seedRestoration: (temporalState) => {
          const success = {
            fingerprint: 'success:loading',
            observedAt: 1,
            score: 1,
            temporalState,
          };
          previewInspectorSession.automaticNeuralAssistanceByKey.set('time', {
            bestSuccessfulPath: success,
            restoringSuccessfulPath: true,
            restoringSuccessfulPathFingerprint: success.fingerprint,
            successfulPaths: [success],
          });
          previewInspectorSession.neuralSuccessfulPathRestorationKey = 'time';
        },
        shouldHoldRequest: () => shouldHoldPreviewInspectorNeuralTransientTargetRequest({
          id: 'request:cards',
          kind: 'rest',
          method: 'GET',
          reachabilityKey: state.key,
        }),
        setRuntimeStatus: (status) => {
          previewInspectorSession.runtimeFallbackValues.set('fallback:query', {
            loading: true,
            status,
          });
        },
        snapshot: () => createPreviewInspectorNeuralTemporalStateSnapshot(state),
      };
    `,
    context,
  );
  return context.__fixture as TemporalContractFixture;
}

describe('Preview Inspector page-context execution time contract', () => {
  it('pins exact loading signals and releases viewer-owned pending work on Resume', () => {
    const fixture = createTemporalContractFixture(true);
    const snapshot = fixture.snapshot();

    expect(snapshot).toMatchObject({
      backendScenarioEntries: [{ requestId: 'request:cards' }],
      holdPolicy: 'viewer-pending-until-resume',
      kind: 'transient-checkpoint',
      observationWindowMs: 960,
    });
    expect(snapshot.observedAt).toBeGreaterThan(0);
    expect(snapshot.signalCount).toBeGreaterThanOrEqual(5);
    expect(snapshot.conditionEntries).toHaveLength(1);
    expect(snapshot.runtimeStateEntries).toEqual([
      expect.objectContaining({ path: 'loading', transient: true }),
      expect.objectContaining({ path: 'status', transient: true }),
    ]);

    expect(fixture.shouldHoldRequest()).toBe(true);
    expect(fixture.activate(snapshot)).toBe(true);
    expect(fixture.commitRefreshes()).toBe(0);
    expect(fixture.dataRevision()).toBe(0);
    expect(fixture.active('candidate')).toMatchObject({ fingerprint: snapshot.fingerprint });
    expect(fixture.active('another-candidate')).toBeUndefined();
    expect(fixture.overrides()).toEqual([
      ['request:cards', expect.objectContaining({ mode: 'pending' })],
    ]);
    fixture.seedRestoration(snapshot);

    expect(fixture.release()).toBe(true);
    expect(fixture.active()).toBeUndefined();
    expect(fixture.released('candidate')).toMatchObject({
      fingerprint: snapshot.fingerprint,
      released: true,
    });
    expect(fixture.released('another-candidate')).toBeUndefined();
    expect(fixture.overrides()).toEqual([]);
    expect(fixture.releasedRequests()).toContain('request:cards');
    expect(fixture.restoration()).toMatchObject({
      bestSuccessfulPath: undefined,
      restoringSuccessfulPath: false,
      successCollectionSettled: true,
      successfulPaths: [],
    });
    expect(fixture.dataRevision()).toBe(1);
    expect(fixture.commitRefreshes()).toBe(1);
    expect(fixture.shouldHoldRequest()).toBe(false);
    expect(fixture.activate(snapshot)).toBe(false);
    fixture.setRuntimeStatus('pending');
    const evolvedLoadingSnapshot = fixture.snapshot();
    expect(evolvedLoadingSnapshot.fingerprint).not.toBe(snapshot.fingerprint);
    expect(evolvedLoadingSnapshot.released).toBe(true);
    expect(fixture.activate(evolvedLoadingSnapshot)).toBe(false);
  });

  it('classifies ordinary rendered output as terminal without pausing requests', () => {
    const fixture = createTemporalContractFixture(false);
    const snapshot = fixture.snapshot();

    expect(snapshot).toMatchObject({
      backendScenarioEntries: [],
      conditionEntries: [],
      holdPolicy: 'none',
      kind: 'terminal-stable',
      runtimeStateEntries: [],
    });
    expect(fixture.activate(snapshot)).toBe(false);
    expect(fixture.active()).toBeUndefined();
    expect(fixture.shouldHoldRequest()).toBe(false);
  });
});
