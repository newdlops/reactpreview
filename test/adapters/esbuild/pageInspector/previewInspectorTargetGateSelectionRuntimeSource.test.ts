/** Guards runtime path-search speed, evidence boundaries, and exact outcome learning. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralResidualRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';
import { createPreviewInspectorTargetPathIdentityRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetPathIdentityRuntimeSource';
import { createPreviewInspectorTargetReachabilityRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetReachabilityRuntimeSource';

/** Runs real generated path selection and learning, with synthetic compiler metadata only. */
function scenario(body: string): unknown {
  return vm.runInNewContext(
    `
    const previewEntryRevision = 7;
    const previewInspectorSession = { selectedExportName: 'Target', renderConditions: new Map(), renderConditionOverrides: new Map() };
    const initializePreviewInspectorConditionState = () => undefined;
    const isPreviewInspectorRenderConditionControlledByOutcome = (condition) => condition.controlled === true;
    const isPreviewInspectorTargetGuidedConditionRejected = (id) => id === 'rejected';
    const canPreviewInspectorTargetGuideCondition = (condition) => !condition.unsafe && !condition.requiresAuthoredState;
    ${createPreviewInspectorNeuralResidualRuntimeSource()}
    ${createPreviewInspectorTargetPathIdentityRuntimeSource()}
    ${createPreviewInspectorTargetReachabilityRuntimeSource()}
    const descriptor = { inspector: { target: { exportName: 'Target', sourcePath: '/app/Target.tsx' } } };
    const candidate = { root: { exportName: 'Checkout', sourcePath: '/app/Checkout.tsx' },
      routeLocation: { pattern: '/checkout', pathname: '/checkout' },
      renderPath: { steps: [{ label: 'Target', sourcePath: '/app/Target.tsx' }, { label: 'Checkout', sourcePath: '/app/Checkout.tsx' }] } };
    const state = { key: 'checkout:Target', rootName: 'Checkout', targetExportName: 'Target',
      targetSourcePath: '/app/Target.tsx', applicationPath: ['Checkout', 'Target'], targetHasOutput: false };
    const counters = { validation: 0, inference: 0, ownerScans: 0 };
    const initialize = initializePreviewInspectorNeuralResidualModel, infer = runPreviewInspectorNeuralResidualModel;
    const owners = readPreviewInspectorTargetOwnerSourceKeys;
    initializePreviewInspectorNeuralResidualModel = (...args) => { counters.validation++; return initialize(...args); };
    runPreviewInspectorNeuralResidualModel = (...args) => { counters.inference++; return infer(...args); };
    readPreviewInspectorTargetOwnerSourceKeys = (...args) => { counters.ownerScans++; return owners(...args); };
    function gate(id, overrides = {}) {
      const condition = { id, expression: id, sourcePath: '/app/Target.tsx', ownerName: 'Target',
        reachabilityKey: state.key, reachabilityDiscoveryOrder: previewInspectorSession.renderConditions.size,
        effectiveEnabled: false, authoredEnabled: false, targetBranch: 'truthy', ...overrides };
      previewInspectorSession.renderConditions.set(id, condition); return condition;
    }
    const select = (exact = false) => selectPreviewInspectorNextTargetGate(descriptor, candidate, state, exact);
    ${body}
  `,
    {},
    { timeout: 10_000 },
  );
}

describe('runtime target-gate selection', () => {
  it('admits path-local gates before one batch inference and scans owner ambiguity only once', () => {
    expect(
      scenario(`
      for (let index = 0; index < 120; index++) gate('sibling-' + index, { ownerName: 'Other', sourcePath: '/other/Page.tsx' });
      gate('first'); gate('second'); gate('third');
      ({ selected: select().condition.id, counters });
    `),
    ).toEqual({ selected: 'first', counters: { validation: 1, inference: 3, ownerScans: 1 } });
  });

  it('does no model work for already satisfied or unsafe paths', () => {
    expect(
      scenario(`
      gate('satisfied', { effectiveEnabled: true }); gate('authored', { requiresAuthoredState: true });
      gate('controlled', { controlled: true }); gate('rejected'); gate('unsafe', { unsafe: true });
      gate('manual'); previewInspectorSession.renderConditionOverrides.set('manual', false);
      ({ selected: select()?.condition.id, validation: counters.validation, inference: counters.inference });
    `),
    ).toEqual({ selected: undefined, validation: 0, inference: 0 });
  });

  it('retains candidate failure across changed discovery order without widening the corridor', () => {
    expect(
      scenario(`
      const firstGate = gate('first'); gate('second');
      const first = select(); trainPreviewInspectorNeuralResidualDecision(first.neuralResidualDecision, 0);
      firstGate.reachabilityDiscoveryOrder = -100;
      const second = select();
      previewInspectorSession.renderConditions.delete('second');
      const failed = select();
      ({ selected: second.condition.id, failures: failed.neuralResidualDecision.consecutiveFailures,
        candidate: typeof first.neuralResidualDecision.candidateId === 'string' });
    `),
    ).toEqual({ selected: 'second', failures: 1, candidate: true });
  });

  it('keeps outcomes separate for another authored route and opposite branch direction', () => {
    expect(
      scenario(`
      const condition = gate('gate'); const first = select();
      trainPreviewInspectorNeuralResidualDecision(first.neuralResidualDecision, 0);
      candidate.routeLocation.pattern = '/history'; candidate.routeLocation.pathname = '/history';
      const otherRoute = select();
      condition.targetBranch = 'falsy'; condition.effectiveEnabled = true;
      const opposite = select();
      ({ routeFailures: otherRoute.neuralResidualDecision.consecutiveFailures,
        differentContext: otherRoute.neuralResidualDecision.contextKey !== first.neuralResidualDecision.contextKey,
        differentCandidate: opposite.neuralResidualDecision.candidateId !== first.neuralResidualDecision.candidateId,
        desired: opposite.desiredValue });
    `),
    ).toEqual({
      routeFailures: 0,
      differentContext: true,
      differentCandidate: true,
      desired: false,
    });
  });

  it('does not conflate two absolute paths just because one ends with the other', () => {
    expect(
      scenario(`
      const condition = gate('path', { ownerName: 'Other', sourcePath: '/other/app/Target.tsx' });
      const absolute = select()?.condition.id;
      condition.sourcePath = 'app/Target.tsx';
      ({ absolute, relative: select()?.condition.id });
    `),
    ).toEqual({ absolute: undefined, relative: 'path' });
  });

  it('refreshes model validation and condition scope on every independent lookup', () => {
    expect(
      scenario(`
      const condition = gate('gate'); const first = select();
      const head = first.neuralResidualDecision.headKey;
      previewInspectorSession.neuralResidualModel.heads[head] = { evidence: 4, updates: 4,
        outputBias: 2, outputWeights: Array(16).fill(0) };
      const second = select();
      condition.ownerName = 'Other'; condition.sourcePath = '/other/File.tsx';
      const removed = select();
      ({ first: first.neuralResidualDecision.score, second: second.neuralResidualDecision.score,
        removed: removed?.condition.id, validation: counters.validation });
    `),
    ).toEqual({ first: 0.5, second: 1 / (1 + Math.exp(-2)), removed: undefined, validation: 2 });
  });

  it('keeps exact-target filtering and manual authored-state handoff intact', () => {
    expect(
      scenario(`
      gate('root', { ownerName: 'Checkout', sourcePath: '/unknown/helper.tsx' });
      gate('authored', { requiresAuthoredState: true });
      const exact = select(true); const normal = select();
      const pending = readPreviewInspectorPendingAuthoredStateGate(descriptor, candidate, state);
      ({ exact: exact?.condition.id, normal: normal.condition.id, pending: pending.id });
    `),
    ).toEqual({ exact: undefined, normal: 'root', pending: 'authored' });
  });

  it('shares one owner scan across exact, general, and authored-state checks in the same evaluation', () => {
    expect(
      scenario(`
      gate('authored', { requiresAuthoredState: true });
      const search = createPreviewInspectorTargetGateSearch(descriptor, candidate, state);
      selectPreviewInspectorNextTargetGate(descriptor, candidate, state, true, search);
      selectPreviewInspectorNextTargetGate(descriptor, candidate, state, false, search);
      const pending = readPreviewInspectorPendingAuthoredStateGate(descriptor, candidate, state, search);
      ({ pending: pending.id, counters });
    `),
    ).toEqual({ pending: 'authored', counters: { validation: 0, inference: 0, ownerScans: 1 } });
  });

  it('rereads in-place owner/source changes instead of retaining stale name evidence', () => {
    expect(
      scenario(`
      state.applicationPath.push('SpecialGate');
      gate('first', { ownerName: 'SpecialGate', sourcePath: '/helpers/One.tsx' });
      const before = select()?.condition.id;
      gate('other', { ownerName: 'SpecialGate', sourcePath: '/helpers/Two.tsx', reachabilityKey: 'another-page' });
      const after = select()?.condition.id;
      previewInspectorSession.renderConditions.delete('other');
      ({ before, after, restored: select()?.condition.id });
    `),
    ).toEqual({ before: 'first', after: undefined, restored: 'first' });
  });

  it('preserves JSX token boundaries while rejecting ambiguous wrappers and partial target names', () => {
    expect(
      scenario(`
      const evidence = { nameScores: new Map([['Target', 1000], ['Checkout', 800], ['Wrapper', 100]]),
        exactTargetNames: new Set(['Target']), componentCorridorNames: new Set(['Target', 'Checkout']),
        ambiguousNames: new Set(['Wrapper']) };
      ['<Target />', '<Wrapper><Checkout /></Wrapper>', 'OtherTarget', '', 'Wrapper', '<Target/><Checkout/>']
        .map((label) => [scorePreviewInspectorTargetConditionLabel(label, evidence),
          scorePreviewInspectorTargetComponentConditionLabel(label, evidence),
          labelsPreviewInspectorExactTargetCondition(label, evidence)]);
    `),
    ).toEqual([
      [1000, 1000, true],
      [800, 800, false],
      [0, 0, false],
      [0, 0, false],
      [0, 0, false],
      [1000, 1000, true],
    ]);
  });

  it('does not execute accessors while reading coherent render-state path evidence', () => {
    expect(
      scenario(`
      let accesses = 0;
      const value = { state: {} };
      Object.defineProperty(value.state, 'status', { get() { accesses++; return 'ready'; } });
      const observed = readPreviewInspectorNeuralRenderStatePath(value, 'state.status');
      ({ accesses, found: observed.found });
    `),
    ).toEqual({ accesses: 0, found: false });
  });

  it('keeps deterministic ties stable without letting a failure admit an unrelated alternative', () => {
    expect(
      scenario(`
      gate('first', { reachabilityDiscoveryOrder: 1, line: 4 });
      gate('tie', { reachabilityDiscoveryOrder: 1, line: 4 });
      const before = select();
      trainPreviewInspectorNeuralResidualDecision(before.neuralResidualDecision, 0);
      previewInspectorSession.renderConditions.delete('tie');
      gate('unrelated', { ownerName: 'Other', sourcePath: '/other/File.tsx', reachabilityDiscoveryOrder: 0 });
      ({ before: before.condition.id, after: select().condition.id, output: state.targetHasOutput });
    `),
    ).toEqual({ before: 'first', after: 'first', output: false });
  });

  /** 'focusSku && <div>notice</div>' beside an inbound table must not halt the whole traversal. */
  it('waits for authored state only on a branch proven to lead to the target', () => {
    expect(
      scenario(`
      const notice = gate('notice', { kind: 'logical-and',
        ownerName: 'Checkout',
        sourcePath: '/app/Checkout.tsx', unsafe: true, targetBranch: undefined,
        truthyLabel: '<div>', falsyLabel: 'hidden' });
      const pending = () => readPreviewInspectorPendingAuthoredStateGate(descriptor, candidate, state)?.id;
      const unproven = pending();
      notice.truthyLabel = '<div: Target>';
      const labelled = pending();
      notice.truthyLabel = '<div>';
      notice.requiresAuthoredState = true;
      ({ unproven, labelled, authored: pending() });
    `),
    ).toEqual({ authored: 'notice', labelled: 'notice', unproven: undefined });
  });

  /** The target's own '&&' branches are its content and need no further proof. */
  it('admits the target module branches without label proof', () => {
    expect(
      scenario(`
      gate('promo', { kind: 'logical-and', targetBranch: undefined, truthyLabel: '<span>',
        falsyLabel: 'hidden' });
      select()?.condition.id;
    `),
    ).toBe('promo');
  });

  /** Neural assistance keeps proven path branches and the target's own UI-state branches. */
  it('filters neural condition candidates to proven corridor branches', () => {
    expect(
      scenario(`
      globalThis.findSelectedPreviewInspectorDescriptor = () => descriptor;
      globalThis.readSelectedPreviewInspectorPageCandidate = () => candidate;
      previewInspectorSession.targetReachabilityByKey = new Map([[state.key, state]]);
      const corridorGate = (id, truthyLabel) => gate(id, { kind: 'logical-and', ownerName: 'Checkout',
        sourcePath: '/app/Checkout.tsx', targetBranch: undefined, truthyLabel, falsyLabel: 'hidden' });
      const badge = gate('badge', { kind: 'logical-and', targetBranch: undefined, truthyLabel: '<span>',
        stateBound: true });
      const sibling = corridorGate('modal', '<InboundModal>');
      const path = corridorGate('panel', '<div: Target>');
      const proven = createPreviewInspectorConditionProofFilter();
      ({ badge: proven(badge), path: proven(path), sibling: proven(sibling) });
    `),
    ).toEqual({ badge: true, path: true, sibling: false });
  });

  /** Forcing 'atRiskDelta !== 0' while the data says 0 rendered "−0"; local UI state stays a choice. */
  it('keeps the target data branches out of neural candidates', () => {
    expect(
      scenario(`
      globalThis.findSelectedPreviewInspectorDescriptor = () => descriptor;
      globalThis.readSelectedPreviewInspectorPageCandidate = () => candidate;
      previewInspectorSession.targetReachabilityByKey = new Map([[state.key, state]]);
      const comparison = (path) => ({ kind: 'comparison', operator: '!==', path, value: 0 });
      const delta = gate('delta', { kind: 'logical-and', targetBranch: undefined,
        truthyLabel: '<span>', scalarExpression: comparison('atRiskDelta') });
      const tab = gate('tab', { kind: 'logical-and', targetBranch: undefined, truthyLabel: '<div>',
        scalarExpression: comparison('tab'), stateBound: true });
      const cogs = gate('cogs', { kind: 'logical-and', targetBranch: undefined, truthyLabel: '<div>' });
      const proven = createPreviewInspectorConditionProofFilter();
      ({ cogs: proven(cogs), delta: proven(delta), tab: proven(tab) });
    `),
    ).toEqual({ cogs: false, delta: false, tab: true });
  });

  /** A value a forced sibling fixes is not an independent neural choice. */
  it('keeps coherence-fixed conditions out of neural candidates', () => {
    expect(
      scenario(`
      globalThis.findSelectedPreviewInspectorDescriptor = () => descriptor;
      globalThis.readSelectedPreviewInspectorPageCandidate = () => candidate;
      globalThis.readPreviewInspectorScalarCoherentOverride = (condition) => condition.implied;
      previewInspectorSession.targetReachabilityByKey = new Map([[state.key, state]]);
      const overview = gate('overview', { kind: 'logical-and', stateBound: true, implied: false });
      const billing = gate('billing', { kind: 'logical-and', stateBound: true });
      const proven = createPreviewInspectorConditionProofFilter();
      ({ billing: proven(billing), overview: proven(overview) });
    `),
    ).toEqual({ billing: true, overview: false });
  });

  /** 'form && <InboundModal/>' in a corridor owner is a sibling of the target, not its path. */
  it('opens a corridor owner overlay only when its branch names the target path', () => {
    expect(
      scenario(`
      const modal = gate('form', { kind: 'logical-and', role: 'overlay', ownerName: 'Checkout',
        sourcePath: '/app/Checkout.tsx', targetBranch: undefined, truthyLabel: '<InboundModal>',
        falsyLabel: 'hidden' });
      const sibling = select()?.condition.id;
      modal.truthyLabel = '<InboundModal: Target>';
      ({ sibling, containing: select()?.condition.id });
    `),
    ).toEqual({ containing: 'form', sibling: undefined });
  });

  /** '<SkuFormModal open={createOpen}>' and '<SkuFormModal open={!!editing}>' on one page. */
  it('opens only the source-first owner instance of a repeated overlay target', () => {
    expect(
      scenario(`
      const instance = (id, line) => gate(id, { kind: 'overlay-visibility', role: 'overlay',
        sourcePath: '/app/Checkout.tsx', line, column: 7 });
      // The overlay inside the target module is shared by both instances.
      gate('shared', { kind: 'overlay-visibility', role: 'overlay', ownerName: 'Modal', line: 12 });
      // Discovery order differs from source order; a rejected earlier instance is skipped.
      const edit = instance('edit', 77); const create = instance('create', 75); instance('rejected', 70);
      const evidence = readPreviewInspectorTargetPathEvidence(descriptor, candidate, state);
      const before = { general: select()?.condition.id, exact: select(true)?.condition.id,
        redirected: readPreviewInspectorSourceFirstInstanceOverlay(edit, state, evidence)?.id,
        deferred: isPreviewInspectorOverlayRevealDeferred(state) };
      create.effectiveEnabled = true;
      ({ before, open: { general: select()?.condition.id, exact: select(true)?.condition.id,
        redirected: readPreviewInspectorSourceFirstInstanceOverlay(edit, state, evidence),
        deferred: isPreviewInspectorOverlayRevealDeferred(state) } });
    `),
    ).toEqual({
      before: { deferred: true, exact: 'create', general: 'create', redirected: 'create' },
      open: { deferred: true, exact: undefined, general: undefined, redirected: undefined },
    });
  });
});
