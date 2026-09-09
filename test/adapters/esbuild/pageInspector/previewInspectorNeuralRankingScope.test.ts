/** Guards admission-before-inference, batch-local freshness, and verifier-led retry ordering. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralChoiceRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralChoiceRuntimeSource';
import { createPreviewInspectorNeuralResidualRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';
import { createPreviewInspectorRequirementFrontierRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRequirementFrontierRuntimeSource';

/** Executes actual generated ranking; only host evidence and observation counters are synthetic. */
function scenario(body: string): unknown {
  const context: { result?: unknown } = {};
  vm.runInNewContext(
    `
    const previewEntryRevision = 7;
    const previewInspectorSession = { selectedExportName: 'Panel' };
    const normalizePreviewInspectorReachabilityPath = (value) => String(value ?? '');
    const counters = { inference: 0, validation: 0, errorReads: 0, edgeVisits: 0 };
    const readPreviewInspectorErrorPropertyPaths = (error) => {
      counters.errorReads++;
      return error?.paths ?? [];
    };
    ${createPreviewInspectorNeuralResidualRuntimeSource()}
    ${createPreviewInspectorRequirementFrontierRuntimeSource()}
    ${createPreviewInspectorNeuralChoiceRuntimeSource()}
    const initialize = initializePreviewInspectorNeuralResidualModel;
    const infer = runPreviewInspectorNeuralResidualModel;
    initializePreviewInspectorNeuralResidualModel = (...args) => { counters.validation++; return initialize(...args); };
    runPreviewInspectorNeuralResidualModel = (...args) => { counters.inference++; return infer(...args); };
    const evidence = { nameScores: new Map([['Panel', 1000]]), paths: [], state: {} };
    function record(id, ownerName = 'Panel', overrides = {}) {
      return { id, ownerName, mode: 'auto', requiredPaths: ['data.items'], ...overrides };
    }
    function select(records, options = {}) {
      return selectPreviewInspectorRequirementIds(
        records, evidence, 8, 'runtime-fallback', (item) => item.requiredPaths, options,
      );
    }
    function choices(count) {
      return Array.from({ length: count }, (_, index) => ({ id: 'choice-' + index,
        choiceKind: 'source-proven-prop',
        choiceRecords: [{ path: 'field-' + index, candidates: ['A', 'B'] }],
      }));
    }
    ${body}
  `,
    context,
    { timeout: 10_000 },
  );
  return context.result;
}

describe('neural blocker and path ranking scope', () => {
  it('only infers admitted path-local requirements, with one model and error read per batch', () => {
    expect(
      scenario(`
      const records = [...Array.from({ length: 120 }, (_, index) => record('sibling-' + index, 'Sibling')),
        record('target-a'), record('target-b'), record('target-c')];
      const selected = select(records, { preferNeural: true });
      result = { ids: selected.ids, counters };
    `),
    ).toEqual({
      ids: ['target-a', 'target-b', 'target-c'],
      counters: { inference: 3, validation: 1, errorReads: 1, edgeVisits: 0 },
    });
  });

  it('does not initialize the model for an empty requirement frontier', () => {
    expect(scenario(`select([]); result = counters;`)).toMatchObject({
      inference: 0,
      validation: 0,
    });
  });

  it('prefers a novel admitted exception repair over a rejected stronger heuristic match', () => {
    expect(
      scenario(`
      evidence.state.targetOutputError = { paths: ['status'] };
      const failed = record('failed', 'Panel', {
        requiredPaths: ['state.status'], residualHoleKind: 'nested-generated-shape-mismatch',
        smartPathValues: [{ path: 'state.status', value: 'ready' }],
      });
      const novel = record('novel', 'Panel', { requiredPaths: ['data.status'] });
      result = select([failed, novel], { excludedCandidateIds: ['failed'], preferNeural: true }).ids;
    `),
    ).toEqual(['novel']);
  });

  it('never widens an exception-local pool just to find a nonexcluded candidate', () => {
    expect(
      scenario(`
      evidence.state.targetOutputError = { paths: ['status'] };
      result = select([record('failed', 'Panel', { requiredPaths: ['state.status'] }),
        record('unrelated')], { excludedCandidateIds: ['failed'] }).ids;
    `),
    ).toEqual(['failed']);
  });

  it('refreshes a retained decision once and returns current model evidence without mutating it', () => {
    expect(
      scenario(`
      const retained = createPreviewInspectorNeuralResidualDecision({
        blockerKind: 'runtime-fallback', candidateId: 'retained', holeKind: 'unrendered-runtime-value',
      });
      const model = initialize();
      model.heads[retained.headKey] = { evidence: 4, updates: 4, outputBias: 2, outputWeights: Array(16).fill(0) };
      model.updates = 4;
      previewInspectorSession.runtimeFallbackNeuralDecisions = new Map([['retained', retained]]);
      counters.inference = counters.validation = 0;
      const selected = select([record('retained')], { preferNeural: true });
      result = { score: selected.neuralResidualDecision.score, updates: selected.neuralResidualDecision.modelUpdates,
        oldScore: retained.score, counters };
    `),
    ).toEqual({
      score: 1 / (1 + Math.exp(-2)),
      updates: 4,
      oldScore: 0.5,
      counters: { inference: 1, validation: 1, errorReads: 1, edgeVisits: 0 },
    });
  });

  it('revalidates the next batch after retained model state becomes malformed', () => {
    expect(
      scenario(`
      const first = select([record('target')]);
      const headKey = first.neuralResidualDecision.headKey;
      previewInspectorSession.neuralResidualModel.heads[headKey] = {
        evidence: 10, updates: 10, outputBias: NaN, outputWeights: Array(16).fill(0),
      };
      const second = select([record('target')]);
      result = { score: second.neuralResidualDecision.score, validations: counters.validation };
    `),
    ).toEqual({ score: 0.5, validations: 2 });
  });

  it('replaces an invalid retained decision with current admitted evidence without double inference', () => {
    expect(
      scenario(`
      previewInspectorSession.runtimeFallbackNeuralDecisions = new Map([['target', { score: NaN }]]);
      const selected = select([record('target')]);
      result = { candidateId: selected.neuralResidualDecision.candidateId, counters };
    `),
    ).toEqual({
      candidateId: 'target',
      counters: { inference: 1, validation: 1, errorReads: 1, edgeVisits: 0 },
    });
  });

  it('scores each finite path once with one validated model for the complete derivation', () => {
    expect(
      scenario(`
      const paths = readPreviewInspectorNeuralDerivedChoicePaths(choices(6));
      result = { count: paths.pathCount, recommended: paths.recommendedPath, counters };
    `),
    ).toEqual({
      count: 64,
      recommended: undefined,
      counters: { inference: 64, validation: 1, errorReads: 0, edgeVisits: 0 },
    });
  });

  it('does no inference for a truncated choice domain', () => {
    expect(
      scenario(`
      const paths = readPreviewInspectorNeuralDerivedChoicePaths(choices(7));
      result = { count: paths.pathCount, truncated: paths.truncated, counters };
    `),
    ).toMatchObject({ count: 0, truncated: true, counters: { inference: 0, validation: 0 } });
  });

  it('keeps recent path failure ahead of a generalized neural score when ordering retries', () => {
    expect(
      scenario(`
      createPreviewInspectorNeuralChoicePathDecision = (path, state, rank) => ({
        headKey: 'render-condition', headEvidence: 10, outcomeAttempts: 3,
        consecutiveFailures: rank === 0 ? 1 : 0, selectionScore: rank === 0 ? 0.8 : 0.7,
      });
      comparePreviewInspectorNeuralResidualDecisions = (left, right) => right.selectionScore - left.selectionScore;
      result = readPreviewInspectorNeuralDerivedChoicePaths(choices(1)).paths.map((path) => path.label);
    `),
    ).toEqual(['B', 'A']);
  });

  it('indexes observed edges once instead of scanning the graph for each possible combination', () => {
    expect(
      scenario(`
      const inputs = choices(6);
      const current = createPreviewInspectorNeuralChoicePathState(inputs);
      const search = initializePreviewInspectorNeuralChoicePathSearch();
      for (let index = 0; index < 120; index++) {
        const edge = { steps: [], toStateId: 'unknown' };
        Object.defineProperty(edge, 'fromStateId', { get() { counters.edgeVisits++; return 'unrelated-' + index; } });
        search.edges.set('edge-' + index, edge);
      }
      const enumeration = enumeratePreviewInspectorNeuralChoiceGraph(search, current, []);
      result = { count: enumeration.paths.length, edgeVisits: counters.edgeVisits };
    `),
    ).toEqual({ count: 64, edgeVisits: 120 });
  });

  it('rebuilds the edge index after success, cycle, and removal evidence changes', () => {
    expect(
      scenario(`
      const current = createPreviewInspectorNeuralChoicePathState(choices(1));
      const search = initializePreviewInspectorNeuralChoicePathSearch();
      const first = enumeratePreviewInspectorNeuralChoiceGraph(search, current, []).paths[0];
      const edge = { fromStateId: current.id, steps: first.steps, targetReady: true, toStateId: 'target-ready' };
      search.edges.set('edge', edge);
      const success = enumeratePreviewInspectorNeuralChoiceGraph(search, current, []).paths[0];
      edge.targetReady = false;
      edge.toStateId = current.id;
      const cycle = enumeratePreviewInspectorNeuralChoiceGraph(search, current, []).paths[0];
      search.edges.delete('edge');
      const reopened = enumeratePreviewInspectorNeuralChoiceGraph(search, current, []).paths[0];
      result = { sameIdentity: [success.id, cycle.id, reopened.id].every((id) => id === first.id),
        success: success.verified, cycle: cycle.cyclic, reopened: reopened.verified === undefined && reopened.cyclic === undefined };
    `),
    ).toMatchObject({ sameIdentity: true, success: true, cycle: true, reopened: true });
  });
});
