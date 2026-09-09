/** Guards cheap availability checks and current-evidence selection of retained automatic paths. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralChoiceRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralChoiceRuntimeSource';
import { createPreviewInspectorNeuralResidualRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';

/** Runs production generation and learning with synthetic source-proven condition choices. */
function scenario(body: string): unknown {
  const context: { result?: unknown } = {};
  vm.runInNewContext(
    `
    const previewEntryRevision = 7;
    const record = { attemptsByBlocker: new Map() };
    const previewInspectorSession = {
      selectedExportName: 'Panel', automaticNeuralAssistanceByKey: new Map([['panel', record]]),
    };
    const counters = { inference: 0, validation: 0, enumeration: 0, choiceReads: 0 };
    const readPreviewInspectorNeuralAssistanceReachability = () => ({ targetHasOutput: true });
    const createPreviewInspectorAutomaticNeuralAssistanceKey = () => 'panel';
    let paused = false;
    const isPreviewInspectorNeuralAssistancePaused = () => paused;
    ${createPreviewInspectorNeuralResidualRuntimeSource()}
    ${createPreviewInspectorNeuralChoiceRuntimeSource()}
    const initialize = initializePreviewInspectorNeuralResidualModel;
    const infer = runPreviewInspectorNeuralResidualModel;
    const enumerate = enumeratePreviewInspectorNeuralChoiceGraph;
    initializePreviewInspectorNeuralResidualModel = (...args) => { counters.validation++; return initialize(...args); };
    runPreviewInspectorNeuralResidualModel = (...args) => { counters.inference++; return infer(...args); };
    enumeratePreviewInspectorNeuralChoiceGraph = (...args) => { counters.enumeration++; return enumerate(...args); };
    function choices(count) {
      return Array.from({ length: count }, (_, index) => ({
        id: 'choice-' + index, choiceKind: 'render-condition',
        node: { blockerKind: 'render-condition', condition: { id: 'condition-' + index, effectiveEnabled: false } },
        choiceRecords: [{ path: 'field-' + index, candidates: [false, true].map((value) => ({
          id: String(value), label: String(value), value,
          actionKind: 'condition-override', conditionId: 'condition-' + index,
        })) }],
      }));
    }
    let inputs = choices(2);
    readPreviewInspectorNeuralUserChoices = () => { counters.choiceReads++; return inputs; };
    const resetCounters = () => Object.keys(counters).forEach((key) => counters[key] = 0);
    ${body}
  `,
    context,
    { timeout: 10_000 },
  );
  return context.result;
}

describe('automatic page-generation ranking', () => {
  it('collects the finite frontier without model inference for availability alone', () => {
    expect(
      scenario(`
      inputs = choices(6);
      result = { available: hasPreviewInspectorNeuralPageGenerationWork(),
        plans: record.pageGenerationCombinationPlans.length, counters };
    `),
    ).toEqual({
      available: true,
      plans: 63,
      counters: { inference: 0, validation: 0, enumeration: 1, choiceReads: 1 },
    });
  });

  it('does not enumerate or infer the same collected state on progress-only reads', () => {
    expect(
      scenario(`
      inputs = choices(6);
      hasPreviewInspectorNeuralPageGenerationWork();
      resetCounters();
      for (let index = 0; index < 20; index++) hasPreviewInspectorNeuralPageGenerationWork();
      result = counters;
    `),
    ).toEqual({ inference: 0, validation: 0, enumeration: 0, choiceReads: 20 });
  });

  it('scores each unattempted non-baseline path once only when selecting a plan', () => {
    expect(
      scenario(`
      inputs = choices(6);
      const plan = createPreviewInspectorNeuralPageGenerationPlan(record);
      result = { selected: plan.decision.candidateId === plan.pathId, counters };
    `),
    ).toEqual({
      selected: true,
      counters: { inference: 63, validation: 1, enumeration: 1, choiceReads: 1 },
    });
  });

  it('deprioritizes a newly failed retained path without widening its finite domain', () => {
    expect(
      scenario(`
      const first = createPreviewInspectorNeuralPageGenerationPlan(record);
      trainPreviewInspectorNeuralResidualDecision(first.decision, 0);
      const second = createPreviewInspectorNeuralPageGenerationPlan(record);
      result = { changed: first.pathId !== second.pathId,
        failures: second.decision.consecutiveFailures, plans: record.pageGenerationCombinationPlans.length };
    `),
    ).toEqual({ changed: true, failures: 0, plans: 3 });
  });

  it('uses the latest model on each execution while leaving earlier returned decisions unchanged', () => {
    expect(
      scenario(`
      inputs = choices(1);
      const first = createPreviewInspectorNeuralPageGenerationPlan(record);
      const model = initialize();
      model.heads[first.decision.headKey] = { evidence: 4, updates: 4, outputBias: 2, outputWeights: Array(16).fill(0) };
      model.updates = 4;
      resetCounters();
      const second = createPreviewInspectorNeuralPageGenerationPlan(record);
      result = { score: second.decision.score, updates: second.decision.modelUpdates,
        oldScore: first.decision.score, counters };
    `),
    ).toEqual({
      score: 1 / (1 + Math.exp(-2)),
      updates: 4,
      oldScore: 0.5,
      counters: { inference: 1, validation: 1, enumeration: 0, choiceReads: 1 },
    });
  });

  it('keeps all three non-baseline combinations and stops without inference after exhaustion', () => {
    expect(
      scenario(`
      const ids = [];
      for (let index = 0; index < 3; index++) {
        const plan = createPreviewInspectorNeuralPageGenerationPlan(record);
        ids.push(plan.pathId);
        record.attemptsByBlocker.set(plan.attemptIdentity, 1);
      }
      resetCounters();
      result = { unique: new Set(ids).size, available: hasPreviewInspectorNeuralPageGenerationWork(),
        next: createPreviewInspectorNeuralPageGenerationPlan(record), counters };
    `),
    ).toEqual({
      unique: 3,
      available: false,
      next: undefined,
      counters: { inference: 0, validation: 0, enumeration: 0, choiceReads: 2 },
    });
  });

  it('notices a new source-proven state after the previous state was exhausted', () => {
    expect(
      scenario(`
      inputs = choices(1);
      const first = createPreviewInspectorNeuralPageGenerationPlan(record);
      record.attemptsByBlocker.set(first.attemptIdentity, 1);
      inputs = choices(2).slice(1);
      resetCounters();
      result = { available: hasPreviewInspectorNeuralPageGenerationWork(), counters };
    `),
    ).toEqual({
      available: true,
      counters: { inference: 0, validation: 0, enumeration: 1, choiceReads: 1 },
    });
  });

  it('does not train or rank a partial oversized domain', () => {
    expect(
      scenario(`
      inputs = choices(7);
      result = { available: hasPreviewInspectorNeuralPageGenerationWork(), counters };
    `),
    ).toEqual({
      available: false,
      counters: { inference: 0, validation: 0, enumeration: 1, choiceReads: 1 },
    });
  });

  it('does no choice reads or model work after an explicit pause', () => {
    expect(
      scenario(`
      paused = true;
      result = { available: hasPreviewInspectorNeuralPageGenerationWork(),
        next: createPreviewInspectorNeuralPageGenerationPlan(record), counters };
    `),
    ).toEqual({
      available: false,
      next: undefined,
      counters: { inference: 0, validation: 0, enumeration: 0, choiceReads: 0 },
    });
  });

  it('refreshes legacy hot-retained decisions without requiring the new path snapshot', () => {
    expect(
      scenario(`
      inputs = choices(1);
      const first = createPreviewInspectorNeuralPageGenerationPlan(record);
      record.pageGenerationCombinationPlans = [Object.freeze({ ...first, path: undefined })];
      const model = initialize();
      model.heads[first.decision.headKey] = { evidence: 4, updates: 4, outputBias: 2, outputWeights: Array(16).fill(0) };
      model.updates = 4;
      resetCounters();
      const second = createPreviewInspectorNeuralPageGenerationPlan(record);
      result = { score: second.decision.score, oldScore: first.decision.score, counters };
    `),
    ).toEqual({
      score: 1 / (1 + Math.exp(-2)),
      oldScore: 0.5,
      counters: { inference: 1, validation: 1, enumeration: 0, choiceReads: 1 },
    });
  });

  it('revalidates malformed weights before executing a retained plan', () => {
    expect(
      scenario(`
      inputs = choices(1);
      const first = createPreviewInspectorNeuralPageGenerationPlan(record);
      initialize().heads[first.decision.headKey] = {
        evidence: 4, updates: 4, outputBias: NaN, outputWeights: Array(16).fill(0),
      };
      resetCounters();
      result = { score: createPreviewInspectorNeuralPageGenerationPlan(record).decision.score, counters };
    `),
    ).toEqual({
      score: 0.5,
      counters: { inference: 1, validation: 1, enumeration: 0, choiceReads: 1 },
    });
  });

  it('still observes pending transitions when the current domain is already collected', () => {
    expect(
      scenario(`
      const first = createPreviewInspectorNeuralPageGenerationPlan(record);
      const search = initializePreviewInspectorNeuralChoicePathSearch('automatic');
      search.rootStateId = 'preceding-state';
      search.pending = { decision: first.decision, pathId: first.pathId,
        fromStateId: 'preceding-state', steps: first.path.steps };
      resetCounters();
      hasPreviewInspectorNeuralPageGenerationWork();
      result = { updates: previewInspectorSession.neuralResidualModel.updates,
        pending: search.pending, enumerations: counters.enumeration };
    `),
    ).toEqual({ updates: 1, pending: undefined, enumerations: 0 });
  });

  it('never grows a full 96-plan frontier when another semantic state appears', () => {
    expect(
      scenario(`
      const sizes = [];
      for (let state = 0; state < 3; state++) {
        inputs = choices(6).map((choice) => ({ ...choice, id: state + ':' + choice.id }));
        hasPreviewInspectorNeuralPageGenerationWork();
        sizes.push(record.pageGenerationCombinationPlans.length);
      }
      result = sizes;
    `),
    ).toEqual([63, 96, 96]);
  });
});
