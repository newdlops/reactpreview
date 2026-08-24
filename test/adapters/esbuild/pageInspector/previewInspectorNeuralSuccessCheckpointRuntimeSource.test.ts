/** Verifies stable success checkpoints independently from project React. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralSuccessCheckpointRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralSuccessCheckpointRuntimeSource';

interface SuccessCheckpointFixture {
  readonly capture: () => boolean;
  readonly collectionSettled: () => boolean;
  readonly continuations: () => number;
  readonly currentProps: () => unknown;
  readonly currentViewerValues: () => unknown;
  readonly failRestoration: () => boolean;
  readonly flushRestorationVerification: () => void;
  readonly record: () => {
    readonly provisionalSuccessfulPath?: unknown;
    readonly restoringSuccessfulPath?: boolean;
    readonly successCollectionSettled?: boolean;
    readonly successfulPaths?: readonly unknown[];
  };
  readonly restorationActive: () => boolean;
  readonly settle: () => unknown;
  readonly setConditions: (entries: readonly (readonly [string, boolean])[]) => void;
  readonly setFatalBlocker: (active: boolean) => void;
  readonly setOutput: (output: boolean, direct?: boolean) => void;
  readonly setRemainingExploration: (remaining: boolean) => void;
  readonly setProps: (props: unknown) => void;
  readonly setViewerValues: (dataMode: string, runtimeStatus: string, smart: boolean) => void;
  readonly status: () => unknown;
}

/** Evaluates the generated runtime with the same mutable maps owned by the viewer session. */
function createSuccessCheckpointFixture(
  seedRecord = true,
  withExplorationPlanner = false,
  withTemporalContract = false,
): SuccessCheckpointFixture {
  const sandbox: {
    __continuations: number;
    __fixture?: SuccessCheckpointFixture;
    __remainingExploration: boolean;
    __seedRecord: boolean;
  } = {
    __continuations: 0,
    __remainingExploration: true,
    __seedRecord: seedRecord,
  };
  vm.runInNewContext(
    `
      const previewEntryRevision = 7;
      const key = '7:page:Panel:candidate:Panel';
      const state = {
        key: 'page:Panel',
        pageRootCommitted: true,
        status: 'reached',
        targetDirectElementOutput: true,
        targetExportName: 'Panel',
        targetHasOutput: true,
        targetOutputKind: 'target-output',
        targetWasMounted: true,
      };
      const previewInspectorSession = {
        automaticNeuralAssistanceByKey: new Map(globalThis.__seedRecord ? [[key, {}]] : []),
        dataAutoEnabled: true,
        dataPayloadOverrides: new Map([[
          'request:feed',
          { mode: 'smart', payload: { rows: [{ id: 'preview-id' }] } },
        ]]),
        dataRequests: new Map([['request:feed', {}]]),
        dataRevision: 0,
        fallbackValuesEnabled: true,
        propsRevisionByExport: new Map([['Panel', 0]]),
        renderConditionAutoAttempts: new Map(),
        renderConditionAutoOverrides: new Map([['condition:a', true]]),
        renderConditionOverrides: new Map(),
        renderConditionRevision: 0,
        renderConditions: new Map([
          ['condition:a', { authoredEnabled: false, effectiveEnabled: true }],
          ['condition:b', { authoredEnabled: false, effectiveEnabled: false }],
        ]),
        resolverPropsByExport: new Map([['Panel', { taxType: 'heavy_tax' }]]),
        runtimeFallbackOverrides: new Map(),
        runtimeFallbackSmartIds: new Set(['fallback:feed']),
        runtimeFallbackSmartPathSignatures: new Map([['fallback:feed', 'rows[].id']]),
        runtimeFallbacks: new Map([['fallback:feed', {}]]),
        runtimeFallbackValues: new Map([['fallback:feed', { status: 'ready' }]]),
        selectedExportName: 'Panel',
        selectedPageCandidateId: 'candidate',
      };
      let learningStatus;
      let fatalBlockers = [];
      const restorationTimers = [];
      const setTimeout = (callback) => restorationTimers.push(callback);
      globalThis.setTimeout = setTimeout;
      const copyPreviewInspectorBlockerValueForJson = (value) =>
        JSON.parse(JSON.stringify(value));
      const createPreviewInspectorAutomaticNeuralAssistanceKey = (reachability) => [
        previewEntryRevision,
        reachability.key,
        previewInspectorSession.selectedPageCandidateId,
        previewInspectorSession.selectedExportName,
      ].join(':');
      const fingerprintPreviewInspectorSmartPropValue = (value) => JSON.stringify(value);
      const hasPreviewInspectorTargetHostOutput = () => state.targetHasOutput === true;
      const initializePreviewInspectorDataState = () => undefined;
      const initializePreviewInspectorConditionState = () => undefined;
      const initializePreviewInspectorRuntimeFallbackState = () => undefined;
      const initializePreviewInspectorAutomaticNeuralAssistanceState = () => {
        previewInspectorSession.automaticNeuralAssistanceByKey ??= new Map();
      };
      const clearPreviewInspectorVirtualBackendResource = () => undefined;
      const normalizePreviewInspectorProps = (value) => value;
      const notifyPreviewInspector = () => undefined;
      const readPreviewInspectorAutomaticNeuralAssistanceRecord = (recordKey) => {
        let record = previewInspectorSession.automaticNeuralAssistanceByKey.get(recordKey);
        if (record === undefined) {
          record = {};
          previewInspectorSession.automaticNeuralAssistanceByKey.set(recordKey, record);
        }
        return record;
      };
      const readPreviewInspectorNeuralAssistanceReachability = () => state;
      const readPreviewInspectorNeuralAssistanceBlockers = () => ({
        active: fatalBlockers,
        count: fatalBlockers.length,
      });
      const readPreviewInspectorNeuralLearningModelUpdates = () => 9;
      const schedulePreviewInspectorCommitRefresh = () => undefined;
      const schedulePreviewInspectorTreeRefresh = () => undefined;
      const setPreviewInspectorNeuralLearningStatus = (status) => { learningStatus = status; };
      ${
        withExplorationPlanner
          ? `
      const createPreviewInspectorNeuralExplorationPlan = () =>
        globalThis.__remainingExploration ? {} : undefined;
      const schedulePreviewInspectorNeuralAssistanceSweepContinuation = () => {
        globalThis.__continuations += 1;
        return true;
      };
      `
          : ''
      }
      ${
        withTemporalContract
          ? `
      const createPreviewInspectorNeuralTemporalStateSnapshot = () => Object.freeze({
        backendScenarioEntries: Object.freeze([]),
        fingerprint: 'time:loading',
        kind: 'transient-checkpoint',
        pageCandidateId: 'candidate',
        released: false,
      });
      const activatePreviewInspectorNeuralTemporalStateContract = () => true;
      const restorePreviewInspectorNeuralTemporalStateSnapshot = () => true;
      const shouldSettlePreviewInspectorNeuralTemporalSuccess = (record) =>
        record?.bestSuccessfulPath?.temporalState?.kind === 'transient-checkpoint';
      const settlePreviewInspectorNeuralTemporalSuccess = (record) => {
        if (!shouldSettlePreviewInspectorNeuralTemporalSuccess(record)) return false;
        record.restoringSuccessfulPath = false;
        record.successCollectionSettled = true;
        return true;
      };
      const promotePreviewInspectorNeuralTemporalSuccessIfObserved =
        (key, record, state, snapshot) => {
          if (record.successfulPaths.some((candidate) =>
            candidate.fingerprint === snapshot.fingerprint)) return false;
          record.provisionalSuccessfulPath = snapshot;
          return promotePreviewInspectorNeuralProvisionalSuccess(
            key,
            record,
            state,
            snapshot,
          );
        };
      `
          : ''
      }
      ${createPreviewInspectorNeuralSuccessCheckpointRuntimeSource()}
      globalThis.__fixture = {
        capture: () => recordPreviewInspectorNeuralSuccessfulPath(state),
        collectionSettled: () => isPreviewInspectorNeuralSuccessCollectionSettled(state),
        continuations: () => globalThis.__continuations,
        currentProps: () => previewInspectorSession.resolverPropsByExport.get('Panel'),
        currentViewerValues: () => ({
          data: previewInspectorSession.dataPayloadOverrides.get('request:feed'),
          runtime: previewInspectorSession.runtimeFallbackValues.get('fallback:feed'),
          smart: previewInspectorSession.runtimeFallbackSmartIds.has('fallback:feed'),
        }),
        failRestoration: () =>
          handlePreviewInspectorNeuralSuccessfulPathRestorationFailure(state),
        flushRestorationVerification: () => {
          const pending = restorationTimers.splice(0);
          for (const callback of pending) callback();
        },
        record: () => previewInspectorSession.automaticNeuralAssistanceByKey.get(key),
        restorationActive: () =>
          isPreviewInspectorNeuralSuccessfulPathRestorationActive(),
        settle: () => settlePreviewInspectorNeuralSuccessfulPaths(key),
        setConditions: (entries) => {
          previewInspectorSession.renderConditionAutoOverrides = new Map(entries);
        },
        setFatalBlocker: (active) => {
          fatalBlockers = active ? [{ blockerKind: 'target-error', blocker: {} }] : [];
        },
        setOutput: (output, direct = false) => {
          state.targetHasOutput = output;
          state.targetDirectElementOutput = direct;
        },
        setRemainingExploration: (remaining) => {
          globalThis.__remainingExploration = remaining;
        },
        setProps: (props) => previewInspectorSession.resolverPropsByExport.set('Panel', props),
        setViewerValues: (dataMode, runtimeStatus, smart) => {
          previewInspectorSession.dataPayloadOverrides.set('request:feed', {
            mode: dataMode,
            payload: { rows: [{ id: dataMode }] },
          });
          previewInspectorSession.runtimeFallbackValues.set(
            'fallback:feed',
            { status: runtimeStatus },
          );
          if (smart) previewInspectorSession.runtimeFallbackSmartIds.add('fallback:feed');
          else previewInspectorSession.runtimeFallbackSmartIds.delete('fallback:feed');
        },
        status: () => learningStatus,
      };
    `,
    sandbox,
  );
  if (sandbox.__fixture === undefined) {
    throw new Error('Success checkpoint fixture did not initialize.');
  }
  return sandbox.__fixture;
}

describe('Preview Inspector neural success checkpoint runtime source', () => {
  it('keeps first output provisional until three delayed observations remain visible', () => {
    const fixture = createSuccessCheckpointFixture(false);

    expect(fixture.capture()).toBe(true);
    expect(fixture.record().provisionalSuccessfulPath).toBeDefined();
    expect(fixture.record()).toMatchObject({
      successCollectionSettled: false,
      successfulPaths: [],
    });
    expect(fixture.collectionSettled()).toBe(false);

    fixture.flushRestorationVerification();
    fixture.flushRestorationVerification();
    expect(fixture.record().successfulPaths).toHaveLength(0);
    fixture.flushRestorationVerification();
    expect(fixture.record()).toMatchObject({
      successCollectionSettled: true,
      successfulPaths: [expect.any(Object)],
    });
    expect(fixture.collectionSettled()).toBe(true);
  });

  it('rejects output that disappears into a blocker-only render before promotion', () => {
    const fixture = createSuccessCheckpointFixture();

    expect(fixture.capture()).toBe(true);
    fixture.setOutput(false);
    fixture.flushRestorationVerification();
    fixture.flushRestorationVerification();

    expect(fixture.record()).toMatchObject({
      successCollectionSettled: false,
      successfulPaths: [],
    });
    expect(fixture.record().provisionalSuccessfulPath).toBeUndefined();
    expect(fixture.collectionSettled()).toBe(false);
  });

  it('keeps a stable checkpoint provisional to the sweep while finite alternatives remain', () => {
    const fixture = createSuccessCheckpointFixture(true, true);

    expect(fixture.capture()).toBe(true);
    fixture.flushRestorationVerification();
    fixture.flushRestorationVerification();
    fixture.flushRestorationVerification();

    expect(fixture.record()).toMatchObject({
      successCollectionSettled: false,
      successfulPaths: [expect.any(Object)],
    });
    expect(fixture.continuations()).toBe(1);
    expect(fixture.collectionSettled()).toBe(false);
    expect(fixture.status()).toMatchObject({
      collecting: true,
      phase: 'applying',
      successCount: 1,
    });
  });

  it('settles a pinned loading checkpoint instead of exploring away from its time state', () => {
    const fixture = createSuccessCheckpointFixture(true, true, true);

    expect(fixture.capture()).toBe(true);

    expect(fixture.continuations()).toBe(0);
    expect(fixture.record()).toMatchObject({
      restoringSuccessfulPath: false,
      successCollectionSettled: true,
    });
    expect(fixture.record().successfulPaths).toHaveLength(1);
    expect(JSON.stringify(fixture.record().successfulPaths)).toContain(
      '"kind":"transient-checkpoint"',
    );
    expect(fixture.status()).toMatchObject({
      collecting: false,
      phase: 'applied',
      restoring: false,
    });
    expect(fixture.restorationActive()).toBe(false);
  });

  it('rejects stale host output while a fatal blocker overlay owns the screen', () => {
    const fixture = createSuccessCheckpointFixture();

    expect(fixture.capture()).toBe(true);
    fixture.setFatalBlocker(true);
    fixture.flushRestorationVerification();
    fixture.flushRestorationVerification();

    expect(fixture.record().successfulPaths).toHaveLength(0);
    expect(fixture.record().provisionalSuccessfulPath).toBeUndefined();
  });

  it('collects distinct successes and restores the highest-scoring verified snapshot', () => {
    const fixture = createSuccessCheckpointFixture();

    expect(fixture.capture()).toBe(true);
    fixture.flushRestorationVerification();
    fixture.flushRestorationVerification();
    fixture.flushRestorationVerification();
    fixture.setConditions([
      ['condition:a', true],
      ['condition:b', true],
    ]);
    fixture.setProps({ taxType: 'normal_tax' });
    fixture.setViewerValues('lorem', 'alternate', false);
    fixture.setOutput(true, false);
    expect(fixture.capture()).toBe(true);
    fixture.flushRestorationVerification();
    fixture.flushRestorationVerification();
    fixture.flushRestorationVerification();
    expect(fixture.record().successfulPaths).toHaveLength(2);

    fixture.setConditions([]);
    fixture.setProps({ taxType: 'broken' });
    fixture.setViewerValues('smart', 'broken', true);
    fixture.setOutput(false);
    expect(fixture.settle()).toEqual({ restoring: true, settled: false, successCount: 2 });
    expect(fixture.currentProps()).toEqual({ taxType: 'heavy_tax' });
    expect(fixture.currentViewerValues()).toEqual({
      data: { mode: 'smart', payload: { rows: [{ id: 'preview-id' }] } },
      runtime: { status: 'ready' },
      smart: true,
    });
    expect(fixture.record()).toMatchObject({
      restoringSuccessfulPath: true,
      successCollectionSettled: true,
    });
    expect(fixture.restorationActive()).toBe(true);

    fixture.setOutput(true, true);
    expect(fixture.capture()).toBe(true);
    fixture.flushRestorationVerification();
    fixture.flushRestorationVerification();
    fixture.flushRestorationVerification();
    expect(fixture.record()).toMatchObject({
      restoringSuccessfulPath: false,
      successCollectionSettled: true,
    });
    expect(fixture.restorationActive()).toBe(false);
    expect(fixture.status()).toMatchObject({
      labelReason: 'best-success-path-restored',
      phase: 'applied',
      successCount: 2,
    });

    expect(fixture.capture()).toBe(false);
    expect(fixture.record()).toMatchObject({
      restoringSuccessfulPath: false,
      successCollectionSettled: true,
    });
    expect(fixture.settle()).toEqual({ restoring: false, settled: true, successCount: 2 });
    expect(fixture.restorationActive()).toBe(false);
    expect(fixture.collectionSettled()).toBe(true);
  });

  it('falls back to the next verified checkpoint after a restored path fails twice', () => {
    const fixture = createSuccessCheckpointFixture();

    expect(fixture.capture()).toBe(true);
    fixture.flushRestorationVerification();
    fixture.flushRestorationVerification();
    fixture.flushRestorationVerification();
    fixture.setConditions([
      ['condition:a', true],
      ['condition:b', true],
    ]);
    fixture.setProps({ taxType: 'normal_tax' });
    fixture.setOutput(true, false);
    expect(fixture.capture()).toBe(true);
    fixture.flushRestorationVerification();
    fixture.flushRestorationVerification();
    fixture.flushRestorationVerification();

    fixture.setProps({ taxType: 'broken' });
    fixture.setOutput(false);
    expect(fixture.settle()).toMatchObject({ restoring: true, successCount: 2 });
    expect(fixture.currentProps()).toEqual({ taxType: 'heavy_tax' });
    expect(fixture.failRestoration()).toBe(true);
    fixture.flushRestorationVerification();
    fixture.flushRestorationVerification();
    expect(fixture.currentProps()).toEqual({ taxType: 'normal_tax' });

    fixture.setOutput(true, false);
    expect(fixture.capture()).toBe(true);
    fixture.flushRestorationVerification();
    fixture.flushRestorationVerification();
    fixture.flushRestorationVerification();
    expect(fixture.record()).toMatchObject({
      restoringSuccessfulPath: false,
      successCollectionSettled: true,
    });
  });

  it('revokes a verified checkpoint after target output regresses twice', () => {
    const fixture = createSuccessCheckpointFixture();

    expect(fixture.capture()).toBe(true);
    fixture.flushRestorationVerification();
    fixture.flushRestorationVerification();
    fixture.flushRestorationVerification();
    expect(fixture.record().successfulPaths).toHaveLength(1);

    fixture.setOutput(false);
    expect(fixture.failRestoration()).toBe(true);
    fixture.flushRestorationVerification();
    fixture.flushRestorationVerification();

    expect(fixture.record()).toMatchObject({
      successCollectionSettled: false,
      successfulPaths: [],
    });
    expect(fixture.collectionSettled()).toBe(false);
  });
});
