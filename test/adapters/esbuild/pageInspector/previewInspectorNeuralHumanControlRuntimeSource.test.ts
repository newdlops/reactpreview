/** Reproduces overbroad choices, unsupported recommendations, and queued work after human takeover. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorDeferredUiTriggerRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorDeferredUiTriggerRuntimeSource';
import { createPreviewInspectorNeuralAssistanceRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralAssistanceRuntimeSource';
import { createPreviewInspectorNeuralResidualRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';
import { createPreviewInspectorPageContextExecutionContractRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageContextExecutionContractRuntimeSource';

/** Executes production runtime functions with inert DOM controls and explicitly drained task queues. */
function scenario(body: string): unknown {
  const context: { result?: unknown } = {};
  vm.runInNewContext(
    String.raw`
      const previewEntryRevision = 7;
      const frames = [], timers = [], calls = [];
      let controls = [], now = 1_000;
      let nodes = [{ blockerKind: 'data-request', blocker: { id: 'request', mode: 'auto' } }];
      const previewInspectorSession = {
        selectedExportName: 'Panel', selectedPageCandidateId: 'page',
        activeTargetReachabilityKey: 'page:Panel',
        targetReachabilityByKey: new Map([['page:Panel', { key: 'page:Panel', status: 'page-blocked', targetExportName: 'Panel' }]]),
        resolverPropsByExport: new Map([['Panel', { value: 'keep me' }]]),
      };
      const condition = { id: 'open', ownerName: 'Panel', sourcePath: '/src/Panel.tsx',
        expression: 'open', requiresAuthoredState: true };
      globalThis.Date = { now: () => now };
      globalThis.setTimeout = (task) => timers.push(task);
      globalThis.queueMicrotask = (task) => frames.push(task);
      globalThis.innerHeight = 900;
      globalThis.innerWidth = 1200;
      globalThis.document = {
        visibilityState: 'visible', querySelectorAll: () => controls, elementFromPoint: () => null,
      };
      globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible', pointerEvents: 'auto' });
      const notifyPreviewInspector = () => undefined;
      const readPreviewInspectorActiveBlockerSummary = () => ({ active: nodes, count: nodes.length });
      const readPreviewInspectorNeuralLearningStatus = () => previewInspectorSession.neuralLearningStatus;
      const setPreviewInspectorNeuralLearningStatus = (status) => { previewInspectorSession.neuralLearningStatus = status; };
      const readPreviewInspectorNeuralLearningModelUpdates = () => previewInspectorSession.neuralResidualModel?.updates ?? 0;
      const readPreviewInspectorResolutionKind = (node) => node.blocker?.forceChoice ? 'choice' : 'automatic';
      const readPreviewInspectorTargetFailurePropChoices = (failure) => failure.sourceChoices ?? [];
      const readPreviewInspectorTargetFailurePropChoiceDomains = readPreviewInspectorTargetFailurePropChoices;
      const createPreviewInspectorFinitePropChoiceMutation = () => ({ automatic: true });
      const previewInspectorScheduleRuntimeEffectFrame = (task) => frames.push(task);
      const remountPreviewInspectorExport = () => calls.push('remount');
      const smartFillPreviewInspectorDataPayload = () => (calls.push('data'), true);
      const findSelectedPreviewInspectorDescriptor = () => ({});
      const applyPreviewInspectorSmartPropChoice = (_export, choice, value) => ({ [choice.path]: value });
      const setPreviewInspectorRenderConditionOverride = () => calls.push('branch');
      const recordPreviewInspectorRuntimeHealth = () => undefined;
      ${createPreviewInspectorDeferredUiTriggerRuntimeSource()}
      ${createPreviewInspectorNeuralResidualRuntimeSource()}
      ${createPreviewInspectorNeuralAssistanceRuntimeSource()}
      function control(label, metadata) {
        const index = controls.length;
        const handler = () => calls.push(label);
        if (metadata) registerPreviewInspectorDeferredUiTrigger(handler, {
          id: 'trigger-' + index, eventName: 'onClick', methodName: 'setOpen', stateName: 'open',
          ownerName: 'Panel', sourcePath: '/src/Panel.tsx', kind: 'local-state-transition', invocationSafe: true,
          ...metadata,
        }, () => undefined);
        const element = {
          __reactProps$fixture: { onClick: handler },
          isConnected: true, tagName: 'BUTTON', textContent: label,
          closest: () => null, matches: () => false, contains: () => false,
          getAttribute: (name) => name === 'class' ? 'shared-button' : null,
          getBoundingClientRect: () => ({ top: index * 50, bottom: index * 50 + 40, left: 10, right: 180, width: 170, height: 40 }),
          click: handler,
        };
        controls.push(element);
        return element;
      }
      function drain() {
        for (let index = 0; index < 32 && (frames.length || timers.length); index += 1) {
          frames.splice(0).forEach((task) => task());
          now += 1_000;
          timers.splice(0).forEach((task) => task());
        }
      }
      function choices(count, values = ['A', 'B']) {
        return Array.from({ length: count }, (_, index) => ({ id: 'decision-' + index,
          choiceKind: 'source-proven-prop', choiceRecords: [{ path: 'field-' + index, candidates: values }] }));
      }
      ${body}
    `,
    context,
    { timeout: 5_000 },
  );
  return context.result;
}

describe('Neural choice evidence and human control', () => {
  it('excludes unrelated controls even when all buttons share the same visual family', () => {
    expect(
      scenario(`
      control('Save profile'); control('Sign out'); control('Open payment', {});
      result = readPreviewInspectorNeuralPageChoices(condition).map((choice) => choice.label);
    `),
    ).toEqual(['Open payment']);
  });

  it('requires the exact source, owner, and state binding and does not fall back to page-wide controls', () => {
    expect(
      scenario(`
      control('Wrong file', { sourcePath: '/src/Other.tsx' });
      control('Wrong owner', { ownerName: 'Other' });
      control('Wrong state', { stateName: 'otherOpen', methodName: 'setOtherOpen' });
      result = readPreviewInspectorNeuralPageChoices(condition);
    `),
    ).toEqual([]);
  });

  it('does not treat a substring of a Unicode identifier as a state dependency', () => {
    expect(
      scenario(`
      control('Open', {});
      result = readPreviewInspectorNeuralPageChoices({ ...condition, expression: '결제open상태' });
    `),
    ).toEqual([]);
  });

  it('rejects old-revision metadata and missing source evidence', () => {
    expect(
      scenario(`
      control('Open', {});
      previewInspectorSession.deferredUiTriggerEntryRevision = 6;
      result = [readPreviewInspectorNeuralPageChoices(condition),
        readPreviewInspectorNeuralPageChoices({ requiresAuthoredState: true })];
    `),
    ).toEqual([[], []]);
  });

  it('revalidates handlers at apply time and ignores a stale Fiber when current props disagree', () => {
    expect(
      scenario(`
      const element = control('Open', {});
      const choice = readPreviewInspectorNeuralPageChoices(condition)[0];
      element.__reactFiber$fixture = { memoizedProps: element.__reactProps$fixture };
      element.__reactProps$fixture = { onClick: () => calls.push('unrelated') };
      result = { applied: activatePreviewInspectorNeuralPageChoice(choice.id), calls };
    `),
    ).toEqual({ applied: false, calls: [] });
  });

  it('does not invoke getters while checking handler membership', () => {
    expect(
      scenario(`
      const element = control('Open', {});
      Object.defineProperty(element, '__reactProps$fixture', { get() { calls.push('getter'); throw Error('unsafe'); } });
      result = { choices: readPreviewInspectorNeuralPageChoices(condition), calls };
    `),
    ).toEqual({ choices: [], calls: [] });
  });

  it('keeps independently scoped choices executable after another group is read', () => {
    expect(
      scenario(`
      control('Payment', {}); control('Invoice', { stateName: 'invoiceOpen', methodName: 'setInvoiceOpen' });
      const first = readPreviewInspectorNeuralPageChoices(condition)[0];
      const second = readPreviewInspectorNeuralPageChoices({ ...condition, id: 'invoice', expression: 'invoiceOpen' });
      result = { second: second.map((item) => item.label), applied: activatePreviewInspectorNeuralPageChoice(first.id), calls };
    `),
    ).toEqual({ second: ['Invoice'], applied: true, calls: ['Payment'] });
  });

  it('hands large page-control groups back to the page without exposing a misleading prefix', () => {
    expect(
      scenario(`
      for (let index = 0; index < 25; index += 1) control('Option ' + index, {});
      result = readPreviewInspectorNeuralPageChoices(condition);
    `),
    ).toEqual([]);
  });

  it('abstains for a cold model instead of recommending the first neutral candidate', () => {
    expect(
      scenario(`
      const derived = readPreviewInspectorNeuralDerivedChoicePaths(choices(2));
      result = { count: derived.pathCount, recommended: derived.recommendedPath, reason: derived.recommendationReason };
    `),
    ).toEqual({ count: 4, recommended: undefined, reason: 'insufficient-evidence' });
  });

  it('rejects all partial Cartesian prefixes and preserves every concrete source value', () => {
    expect(
      scenario(`
      const values = ['A', 'B', 'C', 'D', 'E'];
      const inputs = choices(3, values);
      const derived = readPreviewInspectorNeuralDerivedChoicePaths(inputs);
      result = { paths: derived.paths, recommended: derived.recommendedPath, truncated: derived.truncated,
        reason: derived.recommendationReason, lastValues: inputs.map((choice) => choice.choiceRecords[0].candidates[4]) };
    `),
    ).toEqual({
      paths: [],
      recommended: undefined,
      truncated: true,
      reason: 'choice-domain-too-large',
      lastValues: ['E', 'E', 'E'],
    });
  });

  it.each([
    {
      name: 'one cold candidate',
      values: ['A'],
      evidence: 0,
      attempts: 0,
      failures: 0,
      scores: [0.5],
      recommended: false,
    },
    {
      name: 'too few head observations',
      values: ['A', 'B'],
      evidence: 2,
      attempts: 2,
      failures: 0,
      scores: [0.9, 0.6],
      recommended: false,
    },
    {
      name: 'one candidate outcome',
      values: ['A', 'B'],
      evidence: 3,
      attempts: 1,
      failures: 0,
      scores: [0.9, 0.6],
      recommended: false,
    },
    {
      name: 'weak score',
      values: ['A', 'B'],
      evidence: 3,
      attempts: 2,
      failures: 0,
      scores: [0.6, 0.4],
      recommended: false,
    },
    {
      name: 'tied high scores',
      values: ['A', 'B'],
      evidence: 3,
      attempts: 2,
      failures: 0,
      scores: [0.9, 0.9],
      recommended: false,
    },
    {
      name: 'recent failure',
      values: ['A', 'B'],
      evidence: 3,
      attempts: 3,
      failures: 1,
      scores: [0.9, 0.6],
      recommended: false,
    },
    {
      name: 'clear repeated evidence',
      values: ['A', 'B'],
      evidence: 3,
      attempts: 2,
      failures: 0,
      scores: [0.9, 0.6],
      recommended: true,
    },
    {
      name: 'one evidenced candidate',
      values: ['A'],
      evidence: 3,
      attempts: 2,
      failures: 0,
      scores: [0.9],
      recommended: true,
    },
  ])('gates a learned recommendation for $name', (fixture) => {
    expect(
      scenario(`
      const fixture = ${JSON.stringify(fixture)};
      createPreviewInspectorNeuralChoicePathDecision = (_path, _state, rank) => ({
        headEvidence: fixture.evidence, outcomeAttempts: fixture.attempts,
        consecutiveFailures: fixture.failures, selectionScore: fixture.scores[rank],
      });
      comparePreviewInspectorNeuralResidualDecisions = (left, right) => right.selectionScore - left.selectionScore;
      const derived = readPreviewInspectorNeuralDerivedChoicePaths(choices(1, fixture.values));
      result = derived.recommendedPath !== undefined;
    `),
    ).toBe(fixture.recommended);
  });

  it('also refuses candidate and depth truncation before making a recommendation', () => {
    expect(
      scenario(`
      result = [choices(13, ['A']), choices(1, Array.from({ length: 25 }, (_, index) => index))]
        .map((input) => readPreviewInspectorNeuralDerivedChoicePaths(input).paths);
    `),
    ).toEqual([[], []]);
  });

  it('keeps an exact 96-combination domain complete rather than falsely marking it truncated', () => {
    expect(
      scenario(`
      const input = choices(3, ['A', 'B', 'C', 'D']);
      input[2].choiceRecords[0].candidates = ['A', 'B', 'C', 'D', 'E', 'F'];
      const derived = readPreviewInspectorNeuralDerivedChoicePaths(input);
      result = { count: derived.pathCount, truncated: derived.truncated };
    `),
    ).toEqual({ count: 96, truncated: false });
  });

  it('cancels queued request frames and health-triggered retries without deleting current values or learning', () => {
    expect(
      scenario(`
      initializePreviewInspectorNeuralResidualModel();
      const model = previewInspectorSession.neuralResidualModel;
      requestPreviewInspectorNeuralAssistance();
      const canPause = readPreviewInspectorNeuralAssistanceAvailability().canPause;
      activatePreviewInspectorNeuralAssistance();
      const scheduled = schedulePreviewInspectorAutomaticNeuralAssistanceFromHealth('blocker-discovered');
      drain();
      result = { canPause, paused: isPreviewInspectorNeuralAssistancePaused(), scheduled, calls,
        retainedModel: model === previewInspectorSession.neuralResidualModel,
        values: previewInspectorSession.resolverPropsByExport.get('Panel') };
    `),
    ).toEqual({
      canPause: true,
      paused: true,
      scheduled: false,
      calls: [],
      retainedModel: true,
      values: { value: 'keep me' },
    });
  });

  it('resumes only explicitly and never revives a superseded request frame', () => {
    expect(
      scenario(`
      previewInspectorSession.targetReachabilityByKey.get('page:Panel').status = 'reached';
      requestPreviewInspectorNeuralAssistance();
      frames.shift()();
      pausePreviewInspectorNeuralAssistance();
      frames.splice(0).forEach((task) => task());
      const before = [...calls];
      const resumed = resumePreviewInspectorNeuralAssistance();
      frames.shift()(); frames.shift()();
      result = { before, resumed, paused: isPreviewInspectorNeuralAssistancePaused(), calls };
    `),
    ).toEqual({
      before: ['remount'],
      resumed: true,
      paused: false,
      calls: ['remount', 'remount', 'data'],
    });
  });

  it('offers pause only for scheduled work in the current target corridor', () => {
    expect(
      scenario(`
      previewInspectorSession.automaticNeuralAssistanceByKey = new Map([
        ['6:page:Panel', { scheduled: true }], ['7:page:Other', { scheduled: true }],
      ]);
      const unrelated = readPreviewInspectorNeuralAssistanceAvailability().canPause;
      const key = createPreviewInspectorAutomaticNeuralAssistanceKey(readPreviewInspectorNeuralAssistanceReachability());
      previewInspectorSession.automaticNeuralAssistanceByKey.set(key, { scheduled: true });
      result = { unrelated, current: readPreviewInspectorNeuralAssistanceAvailability().canPause };
    `),
    ).toEqual({ unrelated: false, current: true });
  });

  it('reveals actionable manual strategies while paused and keeps valid user choices authoritative', () => {
    expect(
      scenario(`
      pausePreviewInspectorNeuralAssistance();
      const choice = readPreviewInspectorNeuralUserChoices({ explicitOnly: true })[0];
      const applied = applyPreviewInspectorNeuralUserChoices(choice, { 'Backend payload': 0 });
      result = { kind: choice.choiceKind, applied, paused: isPreviewInspectorNeuralAssistancePaused(), calls };
    `),
    ).toEqual({ kind: 'data-request', applied: true, paused: true, calls: ['data'] });
  });

  it('cancels old contract restorations across pause and resume while allowing explicit manual restoration', () => {
    expect(
      scenario(`
      ${createPreviewInspectorPageContextExecutionContractRuntimeSource()}
      const contractRecord = { key: 'context', executionContractByCandidateId: new Map([
        ['page', { snapshot: { fingerprint: 'checkpoint' } }],
      ]) };
      function readPreviewInspectorNeuralPageContextRecord() { return contractRecord; }
      function restorePreviewInspectorNeuralPageGenerationBaseline() { calls.push('restore'); return true; }
      const Promise = { resolve: () => ({ then: (task) => frames.push(task) }) };
      preparePreviewInspectorNeuralPageContextExecutionContract({}, 'page', 'neural');
      schedulePreviewInspectorNeuralPageContextExecutionContractActivation('page');
      pausePreviewInspectorNeuralAssistance();
      const preparedWhilePaused = preparePreviewInspectorNeuralPageContextExecutionContract({}, 'page', 'neural');
      requestPreviewInspectorNeuralAssistance = () => true;
      resumePreviewInspectorNeuralAssistance();
      frames.splice(0).forEach((task) => task());
      const queuedCalls = [...calls];
      const stale = activatePreviewInspectorNeuralPageContextExecutionContract({}, 'page');
      pausePreviewInspectorNeuralAssistance();
      const manualPrepared = preparePreviewInspectorNeuralPageContextExecutionContract({}, 'page', 'user');
      schedulePreviewInspectorNeuralPageContextExecutionContractActivation('page');
      frames.splice(0).forEach((task) => task());
      result = { preparedWhilePaused, queuedCalls, stale, manualPrepared, calls,
        paused: isPreviewInspectorNeuralAssistancePaused() };
    `),
    ).toEqual({
      preparedWhilePaused: false,
      queuedCalls: [],
      stale: false,
      manualPrepared: true,
      calls: ['restore'],
      paused: true,
    });
  });
});
