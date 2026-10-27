/** Exercises exact page-learning ownership and recoverable errors with the production online model. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralPageContextRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralPageContextRuntimeSource';
import { createPreviewInspectorNeuralResidualRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';
import { createPreviewInspectorTargetReachabilityStateRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetReachabilityStateRuntimeSource';

/** Runs one compiler-admitted, committed page; mutations model late callbacks without browser timing. */
function evaluate(body: string): unknown {
  return vm.runInNewContext(
    `
      let previewEntryRevision = 7;
      const previewHotRuntime = { activeReloadRevision: 7 };
      const target = { exportName: 'Target', sourcePath: '/workspace/Target.tsx' };
      const candidate = {
        id: 'page', complete: true, target, root: { exportName: 'Page' },
        renderPath: { steps: [{ label: 'Page' }, { label: 'Target' }] },
      };
      const descriptor = { exportName: 'Target', sourcePath: target.sourcePath,
        inspector: { target, pageCandidates: [candidate], executablePageCandidateId: 'page' } };
      let currentDescriptor = descriptor;
      const previewInspectorSession = {
        selectedPageCandidateId: 'page', selectedExportName: 'Target',
        targetReachabilityByKey: new Map(), verifiedPageCandidateId: '',
        neuralHumanControlRevision: 0,
      };
      let blockers = [], hostOutput = true, complete = true, paused = false, frameworkControl = false;
      function hasPreviewInspectorNextAppControlBlocker() { return frameworkControl; }
      let scans = 0, outputReads = 0, captures = 0, persisted = 0, requests = 0;
      function readPreviewInspectorPageCandidates(value) { return value?.inspector?.pageCandidates ?? []; }
      function findSelectedPreviewInspectorDescriptor() { return currentDescriptor; }
      function readSelectedPreviewInspectorPageCandidate() { return candidate; }
      function readSelectedPreviewInspectorCandidateTarget() { return target; }
      function createPreviewInspectorNeuralPageContextCoverageBaseline() { return {}; }
      function capturePreviewInspectorNeuralPageContextExecutionContract() { captures++; }
      function recordPreviewInspectorRuntimeHealth() {}
      function persistPreviewInspectorState() { persisted++; }
      function hasPreviewInspectorCompletePageExecutionContext() { scans++; return complete; }
      function hasPreviewInspectorTargetHostOutput() { outputReads++; return hostOutput; }
      function readPreviewInspectorActiveBlockerSummary() { return { active: blockers, count: blockers.length }; }
      function readPreviewInspectorNeuralAssistanceBlockers() { return readPreviewInspectorActiveBlockerSummary(); }
      function isPreviewInspectorNeuralAssistancePaused() { return paused; }
      function selectPreviewInspectorPageCandidate() { requests++; return true; }
      ${createPreviewInspectorNeuralResidualRuntimeSource()}
      ${createPreviewInspectorNeuralPageContextRuntimeSource()}
      ${createPreviewInspectorTargetReachabilityStateRuntimeSource()}
      const state = Object.assign(createPreviewInspectorTargetReachabilityState(descriptor, candidate), {
        neuralStableOutputVerified: true, pageRootCommitted: true,
        targetHasOutput: true, targetMounted: true, targetWasMounted: true, status: 'reached',
      });
      previewInspectorSession.activeTargetReachabilityKey = state.key;
      previewInspectorSession.targetReachabilityByKey.set(state.key, state);
      function observe(value = state, selected = candidate, page = descriptor) {
        return observePreviewInspectorNeuralPageContextOutcome(page, selected, value);
      }
      function result(accepted) {
        const model = serializePreviewInspectorNeuralResidualModel();
        return { accepted, updates: model.updates, labels: Object.values(model.candidateOutcomes).map(value => value.lastLabel),
          captures, persisted, requests, scans, outputReads, outcome: state.neuralPageContextOutcome };
      }
      ${body}
    `,
    {},
    { timeout: 5_000 },
  );
}

describe('neural page outcome admission', () => {
  it('never learns a redirect placeholder as a verified page while navigation waits', () => {
    expect(evaluate('frameworkControl = true; result(observe());')).toMatchObject({
      accepted: false,
      updates: 0,
      captures: 0,
      persisted: 0,
      scans: 0,
    });
  });
  it('rejects an absent verifier state without throwing', () => {
    expect(evaluate('result(observe(null));')).toMatchObject({ accepted: false, updates: 0 });
  });

  it.each([
    ['selected page', "previewInspectorSession.selectedPageCandidateId = 'other';"],
    ['selected target', "previewInspectorSession.selectedExportName = 'OtherTarget';"],
    ['candidate identity', "state.candidateId = 'other';"],
    ['target export', "state.targetExportName = 'OtherTarget';"],
    ['target source', "state.targetSourcePath = '/workspace/OtherTarget.tsx';"],
    ['replaced descriptor', 'currentDescriptor = { ...descriptor };'],
    ['removed candidate', 'descriptor.inspector.pageCandidates = [];'],
    ['unbuilt page', "descriptor.inspector.executablePageCandidateId = 'other';"],
    ['active state', "previewInspectorSession.activeTargetReachabilityKey = 'other:Target';"],
    [
      'replaced same-key state',
      'previewInspectorSession.targetReachabilityByKey.set(state.key, { ...state });',
    ],
    ['removed state', 'previewInspectorSession.targetReachabilityByKey.clear();'],
    ['source revision', 'previewEntryRevision = 8; previewHotRuntime.activeReloadRevision = 8;'],
    ['obsolete module callback', 'previewHotRuntime.activeReloadRevision = 8;'],
    ['paused recovery', 'paused = true;'],
  ])('ignores superseded %s without training or scanning the tree', (_reason, mutation) => {
    expect(evaluate(`${mutation} result(observe());`)).toMatchObject({
      accepted: false,
      updates: 0,
      captures: 0,
      persisted: 0,
      requests: 0,
      scans: 0,
      outputReads: 0,
      outcome: undefined,
    });
  });

  it('does not blacklist another page from a stale failure callback', () => {
    expect(
      evaluate(`
        state.neuralStableOutputVerified = false;
        state.exhausted = true; state.targetHasOutput = false; state.status = 'page-blocked';
        previewInspectorSession.targetReachabilityByKey.set(state.key, { ...state });
        result(observe());
      `),
    ).toMatchObject({ accepted: false, updates: 0, requests: 0, outcome: undefined });
  });

  it.each(['probing', 'target-error', 'target-mounted-no-output'])(
    'does not inspect the whole page or punish recoverable %s',
    (status) => {
      expect(
        evaluate(`
          state.neuralStableOutputVerified = false; state.targetHasOutput = false;
          state.status = '${status}'; result(observe());
        `),
      ).toMatchObject({ accepted: false, updates: 0, scans: 0, outputReads: 0 });
    },
  );

  it.each([
    'render-condition',
    'runtime-fallback',
    'data-request',
    'target-error',
    'runtime-global',
  ])('defers a stale success while a %s blocker can still recover', (kind) => {
    expect(evaluate(`blockers = [{ blockerKind: '${kind}' }]; result(observe());`)).toMatchObject({
      accepted: false,
      updates: 0,
      captures: 0,
      persisted: 0,
    });
  });

  it.each([
    "state.targetOutputError = 'late render failure';",
    'state.pendingTargetRepairFailure = {};',
    'state.targetOutputRecoveryPending = true;',
    "state.status = 'runtime-error-output';",
    "state.status = 'target-error';",
    'hostOutput = false;',
    'complete = false;',
  ])('does not teach success for contradictory output: %s', (mutation) => {
    expect(evaluate(`${mutation} result(observe());`)).toMatchObject({
      accepted: false,
      updates: 0,
      captures: 0,
      persisted: 0,
      outcome: undefined,
    });
  });

  it.each([
    "readPreviewInspectorActiveBlockerSummary = () => { throw new Error('registry unavailable'); };",
    'readPreviewInspectorActiveBlockerSummary = () => undefined;',
    "hasPreviewInspectorCompletePageExecutionContext = () => { throw new Error('fiber unavailable'); };",
    "hasPreviewInspectorTargetHostOutput = () => { throw new Error('detached host'); };",
  ])('leaves an unobservable result unlabelled and allows a fresh verification: %s', (mutation) => {
    expect(evaluate(`${mutation} result(observe());`)).toMatchObject({
      accepted: false,
      updates: 0,
      outcome: undefined,
    });
  });

  it('rewards a recovered page once without blacklisting its intermediate exception', () => {
    expect(
      evaluate(`
        blockers = [{ blockerKind: 'runtime-fallback' }];
        const pending = observe();
        blockers = []; const recovered = observe(); const repeated = observe();
        ({ ...result(recovered), pending, repeated });
      `),
    ).toMatchObject({
      accepted: true,
      pending: false,
      repeated: false,
      updates: 1,
      labels: [1],
      captures: 1,
      persisted: 2,
      outcome: 'verified',
    });
  });

  it.each([
    "previewInspectorSession.selectedExportName = '@root:/workspace/Page.tsx:Page';",
    'state.targetSourcePath = String.raw`\\workspace\\Target.tsx`;',
    `previewEntryRevision = 8; previewHotRuntime.activeReloadRevision = 8;
      const next = createPreviewInspectorTargetReachabilityState(descriptor, candidate);
      state.entryRevision = next.entryRevision;`,
  ])('keeps a current root/target/revision verifiable: %s', (mutation) => {
    expect(evaluate(`${mutation} result(observe());`)).toMatchObject({
      accepted: true,
      updates: 1,
      labels: [1],
      outcome: 'verified',
    });
  });

  it('drops a stale provisional checkpoint before creating a page record', () => {
    expect(
      evaluate(`
        previewInspectorSession.targetReachabilityByKey.set(state.key, { ...state });
        const accepted = markPreviewInspectorNeuralPageContextProvisional(state);
        ({ accepted, records: previewInspectorSession.neuralPageContextByKey?.size ?? 0 });
      `),
    ).toEqual({ accepted: false, records: 0 });
  });

  it('makes one live page-context observation per verdict', () => {
    expect(evaluate('result(observe());')).toMatchObject({
      accepted: true,
      updates: 1,
      scans: 1,
      outputReads: 1,
      labels: [1],
    });
  });

  it('does not replay tree verification or duplicate labels for an unchanged success', () => {
    expect(evaluate('observe(); result(observe());')).toMatchObject({
      accepted: false,
      updates: 1,
      scans: 1,
      outputReads: 1,
    });
  });

  it('demotes confirmed regression even if unrelated/partial DOM remains visible', () => {
    expect(
      evaluate(`
        observe(); state.neuralStableOutputRegressed = true;
        blockers = [{ blockerKind: 'target-error' }]; result(observe());
      `),
    ).toMatchObject({ accepted: true, updates: 2, labels: [0], outcome: 'failed' });
  });

  it('does not promote contradictory verified and regressed flags', () => {
    expect(evaluate('state.neuralStableOutputRegressed = true; result(observe());')).toMatchObject({
      accepted: false,
      updates: 0,
      outcome: undefined,
    });
  });

  it('keeps terminal page failure as a bounded negative example', () => {
    expect(
      evaluate(`
        state.neuralStableOutputVerified = false; state.targetHasOutput = false;
        state.status = 'page-blocked'; state.exhausted = true; result(observe());
      `),
    ).toMatchObject({ accepted: true, updates: 1, labels: [0], outcome: 'failed' });
  });
});
