/** Verifies packaged inference, abstention and compatibility without executing user projects. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { previewInspectorRecoveryPriorArtifact } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRecoveryPriorArtifact';
import { createPreviewInspectorNeuralResidualRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';
import type { PreviewInspectorNeuralModel } from '../../../../src/presentation/previewInspectorNeuralModelProtocol';

interface Decision {
  readonly candidateId?: string;
  readonly consecutiveFailures: number;
  readonly featureVector: readonly number[];
  readonly headEvidence: number;
  readonly headKey: string;
  readonly modelUpdates: number;
  readonly outcomeAttempts: number;
  readonly priorScore?: number;
  readonly priorVersion?: string;
  readonly score: number;
  readonly selectionScore: number;
}

interface Selection {
  readonly candidateId: string;
  readonly decision: Decision;
  readonly branchRetained: boolean;
  readonly scoreMargin: number;
}

interface Fixture {
  readonly compare: (left: Partial<Decision>, right: Partial<Decision>) => number;
  readonly encode: (specification: unknown) => Float32Array | undefined;
  readonly inspect: () => {
    readonly layers: number;
    readonly runs: number;
    readonly cache: number;
  };
  readonly rank: (specifications: readonly unknown[]) => unknown;
  readonly setRawScores: (scores: number[]) => void;
  readonly refresh: (decision: Decision) => Decision;
  readonly select: (
    specification: unknown,
    candidates: readonly unknown[],
  ) => Selection | undefined;
  readonly serialize: () => PreviewInspectorNeuralModel;
  readonly setModel: (model: PreviewInspectorNeuralModel) => void;
  readonly exclude: (ids: readonly string[]) => void;
  readonly train: (decision: Decision, label: number) => unknown;
}

/** Runs the actual generated module; a replacement artifact exercises fail-closed load paths. */
function createFixture(artifact: unknown = previewInspectorRecoveryPriorArtifact): Fixture {
  const source = createPreviewInspectorNeuralResidualRuntimeSource().replace(
    JSON.stringify(previewInspectorRecoveryPriorArtifact),
    JSON.stringify(artifact),
  );
  const context = vm.createContext({});
  vm.runInContext(
    `const previewEntryRevision = 1;
     const previewInspectorSession = {};
     ${source}
     let inferenceRuns = 0;
     const originalInference = runPreviewInspectorRecoveryPrior;
     runPreviewInspectorRecoveryPrior = (...args) => { inferenceRuns++; return originalInference(...args); };
     globalThis.fixture = {
       compare: comparePreviewInspectorRecoveryPriorScores,
       encode: encodePreviewInspectorRecoveryPriorFeatures,
       inspect: () => ({ layers: previewInspectorRecoveryPriorNetwork?.length ?? 0,
         runs: inferenceRuns, cache: previewInspectorRecoveryPriorScores.size }),
       rank: rankPreviewInspectorRecoveryPrior,
       setRawScores: (scores) => {
         previewInspectorRecoveryPriorScores.clear();
         runPreviewInspectorRecoveryPrior = () => scores.shift();
       },
       refresh: refreshPreviewInspectorNeuralResidualDecision,
       select: selectPreviewInspectorNeuralResidualCandidate,
       serialize: serializePreviewInspectorNeuralResidualModel,
       setModel: (model) => { previewInspectorSession.neuralResidualModel = model; },
       exclude: (ids) => { previewInspectorSession.neuralAssistanceExplorationPolicy = {
         origin: 'user-neural', mode: 'alternate', excludedCandidateIds: ids,
       }; },
       train: trainPreviewInspectorNeuralResidualDecision,
     };`,
    context,
  );
  return (context as { fixture: Fixture }).fixture;
}

const problem = {
  blockerKind: 'runtime-fallback',
  holeKind: 'rendered-collection-consumer-data',
  numbers: { callableCandidateCount: 2, requiredPathCount: 6 },
  tokens: ['compiler-call-result-candidate', 'role:collection-filter-predicate'],
};
const candidates = [
  {
    id: 'neutral-callable',
    deterministicRank: 0,
    numbers: { retainsData: 0 },
    tokens: ['strategy:neutral-call-result', 'role:collection-filter-predicate'],
  },
  {
    id: 'retain-generated-collection',
    deterministicRank: 1,
    numbers: { retainsData: 1 },
    tokens: ['strategy:data-retaining-call-result', 'role:collection-filter-predicate'],
  },
] as const;

/** Mirrors the production merge without including labels, rank or project values. */
function specification(index: 0 | 1): unknown {
  const candidate = candidates[index];
  return {
    ...problem,
    candidateId: candidate.id,
    numbers: { ...problem.numbers, ...candidate.numbers },
    tokens: [...problem.tokens, ...candidate.tokens],
  };
}

describe('packaged recovery prior', () => {
  it('ships a trained quantized network within the explicit model budget', () => {
    expect(previewInspectorRecoveryPriorArtifact.id).toMatch(/^recovery-prior-v2-[a-f0-9]{12}$/u);
    expect(previewInspectorRecoveryPriorArtifact.parameters).toBeGreaterThan(20_000);
    expect(previewInspectorRecoveryPriorArtifact.parameters).toBeLessThanOrEqual(140_000);
    expect(previewInspectorRecoveryPriorArtifact.weights.length).toBeLessThanOrEqual(200_000);
    expect(previewInspectorRecoveryPriorArtifact.dimensions[0]).toBe(144);
    expect(Object.keys(previewInspectorRecoveryPriorArtifact.domains)).toHaveLength(6);
  });

  it('learns a cold ordering without fabricating verified successes or local model updates', () => {
    const fixture = createFixture();
    const empty = fixture.serialize();
    const chosen = fixture.select(problem, candidates);
    expect(chosen).toMatchObject({
      candidateId: 'retain-generated-collection',
      scoreMargin: 0,
      decision: {
        score: 0.5,
        headEvidence: 0,
        modelUpdates: 0,
        outcomeAttempts: 0,
        priorVersion: previewInspectorRecoveryPriorArtifact.id,
      },
    });
    expect(chosen?.decision.priorScore).toBeGreaterThan(0.8);
    expect(fixture.serialize()).toEqual(empty);
    expect(JSON.stringify(fixture.serialize())).not.toMatch(/prior|weightsSha|featureVector/u);
  });

  it('uses real same-context failure evidence ahead of the packaged prediction', () => {
    const fixture = createFixture();
    const first = fixture.select(problem, candidates);
    expect(first).toBeDefined();
    if (first === undefined) return;
    fixture.train(first.decision, 0);
    const next = fixture.select(problem, candidates);
    expect(next?.candidateId).toBe('neutral-callable');
    expect(next?.decision.priorScore).toBeUndefined();
    expect(fixture.refresh(first.decision)).toMatchObject({
      consecutiveFailures: 1,
      outcomeAttempts: 1,
    });
  });

  it('continues ranking unknown alternatives after a verified failure without retrying it', () => {
    const fixture = createFixture();
    const failed = fixture.select(problem, [candidates[0]]);
    if (failed === undefined) throw new Error('Missing owned candidate');
    fixture.train(failed.decision, 0);
    const alternate = { ...candidates[0], id: 'second-neutral', deterministicRank: -1 };
    const next = fixture.select(problem, [candidates[0], alternate, candidates[1]]);
    expect(next?.candidateId).toBe('retain-generated-collection');
    expect(next?.decision).toMatchObject({
      priorVersion: previewInspectorRecoveryPriorArtifact.id,
      outcomeAttempts: 0,
      consecutiveFailures: 0,
    });
    expect(fixture.refresh(failed.decision).consecutiveFailures).toBe(1);
    expect(fixture.serialize().updates).toBe(1);
  });

  it('does not let excluded predictions suppress a useful remaining portfolio', () => {
    const fixture = createFixture();
    fixture.exclude(['first-retain']);
    const firstRetain = { ...candidates[1], id: 'first-retain', deterministicRank: -1 };
    const next = fixture.select(problem, [firstRetain, ...candidates]);
    expect(next?.candidateId).toBe('retain-generated-collection');
    expect(next?.decision.priorVersion).toBe(previewInspectorRecoveryPriorArtifact.id);
  });

  it('preserves persisted opposite successful learning when a new webview loads the prior', () => {
    const previous = createFixture();
    const first = previous.select(problem, [candidates[0]]);
    if (first === undefined) throw new Error('Missing admitted test candidate');
    for (let index = 0; index < 4; index += 1) previous.train(first.decision, 1);
    const model = previous.serialize();
    const restored = createFixture();
    restored.setModel(model);
    expect(restored.select(problem, candidates)?.candidateId).toBe('neutral-callable');
    expect(restored.inspect()).toEqual({ layers: 0, runs: 0, cache: 0 });
    expect(restored.serialize()).toEqual(model);
  });

  it('keeps an admitted branch stable and respects explicit exploration exclusions', () => {
    const fixture = createFixture();
    fixture.select(problem, candidates);
    expect(fixture.select(problem, [...candidates].reverse())?.branchRetained).toBe(true);
    fixture.exclude(['retain-generated-collection']);
    expect(fixture.select(problem, candidates)?.candidateId).toBe('neutral-callable');
  });

  it('allocates only for supported multi-candidate decisions and reuses exact-vector scores', () => {
    const fixture = createFixture();
    fixture.select({}, candidates);
    fixture.select(problem, [candidates[0]]);
    expect(fixture.inspect()).toEqual({ layers: 0, runs: 0, cache: 0 });
    fixture.select(problem, candidates);
    expect(fixture.inspect()).toEqual({ layers: 3, runs: 2, cache: 2 });
    fixture.select(problem, candidates);
    expect(fixture.inspect()).toEqual({ layers: 3, runs: 2, cache: 2 });
  });

  it('bounds cached vectors and handles eviction without caching user text', () => {
    const fixture = createFixture();
    for (let count = 1; count <= 90; count += 1) {
      fixture.select(
        { ...problem, numbers: { ...problem.numbers, requiredPathCount: count } },
        candidates,
      );
    }
    expect(fixture.inspect().cache).toBe(64);
    expect(fixture.inspect().runs).toBeGreaterThan(64);
  });

  it('abstains for a mixed or partly unsupported portfolio instead of penalizing its unknown option', () => {
    const fixture = createFixture();
    expect(
      fixture.select(problem, [candidates[0], { id: 'unknown', deterministicRank: 1 }]),
    ).toMatchObject({ candidateId: 'neutral-callable' });
    expect(fixture.rank([specification(0), { holeKind: 'page-choice-context' }])).toBeUndefined();
    expect(fixture.inspect()).toEqual({ layers: 0, runs: 0, cache: 0 });
  });

  it('abstains for ambiguous equal options and counts outside the learned domain', () => {
    const fixture = createFixture();
    expect(fixture.rank([specification(1), specification(1)])).toBeUndefined();
    const outside = { ...problem, numbers: { ...problem.numbers, requiredPathCount: 10000 } };
    expect(fixture.select(outside, candidates)?.candidateId).toBe('neutral-callable');
    expect(fixture.select(outside, candidates)?.decision.priorScore).toBeUndefined();
  });

  it('excludes display rank, candidate names, arbitrary source text and unknown context tokens', () => {
    const fixture = createFixture();
    const input = {
      ...problem,
      numbers: { ...problem.numbers, retainsData: 1 },
      tokens: [...problem.tokens, ...candidates[1].tokens],
    };
    const before = fixture.encode(input);
    expect(
      fixture.encode({
        ...input,
        candidateId: '/private/project/Secret.tsx',
        numbers: { ...input.numbers, deterministicRank: 99999, compilerRank: 12345 },
        texts: ['untrusted private source'],
        tokens: [...input.tokens, 'target:Secret', 'required:user.secret'],
      }),
    ).toEqual(before);
    expect(before?.length).toBe(144);
  });

  it('bounds long context while preserving the candidate semantics at the end', () => {
    const fixture = createFixture();
    const input = {
      ...problem,
      numbers: { ...problem.numbers, retainsData: 1 },
      tokens: [...problem.tokens, ...candidates[1].tokens],
    };
    expect(
      fixture.encode({
        ...input,
        tokens: [
          ...problem.tokens,
          ...Array.from({ length: 10000 }, (_, index) => 'context:' + String(index)),
          ...candidates[1].tokens,
        ],
      }),
    ).toEqual(fixture.encode(input));
  });

  it.each([null, undefined, { numbers: [] }, { ...problem, numbers: { retainsData: 2 } }])(
    'rejects malformed specification %j without allocating the model',
    (input) => {
      const fixture = createFixture();
      expect(fixture.encode(input)).toBeUndefined();
      expect(fixture.inspect().layers).toBe(0);
    },
  );

  it.each([
    { format: 0 },
    { format: 1 },
    { dimensions: [128, 999999, 32, 1] },
    { scales: [0, 1, 1] },
    { checksum: 0 },
    { weights: 'bad!' },
    { parameters: 1 },
    { domains: {} },
  ])('fails closed for corrupt artifact metadata %j', (override) => {
    const fixture = createFixture({ ...previewInspectorRecoveryPriorArtifact, ...override });
    expect(fixture.select(problem, candidates)?.candidateId).toBe('neutral-callable');
    expect(fixture.select(problem, candidates)?.decision.priorScore).toBeUndefined();
    expect(fixture.serialize().updates).toBe(0);
  });

  it('lets strong general online learning influence a new context without inventing exact evidence', () => {
    const fixture = createFixture();
    const base = {
      headKey: 'data-collection',
      headEvidence: 1000,
      outcomeAttempts: 0,
      priorVersion: previewInspectorRecoveryPriorArtifact.id,
    };
    const first = { ...base, priorScore: 0.9, selectionScore: 0.1 };
    const second = { ...base, priorScore: 0.1, selectionScore: 0.9 };
    expect(fixture.compare(first, second)).toBeGreaterThan(0);
    expect(
      fixture.compare({ ...first, headEvidence: 0 }, { ...second, headEvidence: 0 }),
    ).toBeLessThan(0);
    expect(fixture.compare({ ...first, outcomeAttempts: 1 }, second)).toBe(0);
  });

  it('prefers cheaper work only between confident alternatives and never turns ambiguity into confidence', () => {
    const fixture = createFixture();
    const execution = {
      blockerKind: 'page-context',
      holeKind: 'page-execution-context',
      numbers: {
        missingOwnerCount: 1,
        authoredOwnerDepth: 2,
        fidelityRank: 0,
        nestedMountCount: 20,
      },
      tokens: ['page-context-missing:true', 'fidelity:route-page-authentic'],
    };
    const cheaper = { ...execution, numbers: { ...execution.numbers, nestedMountCount: 1 } };
    fixture.setRawScores([0.98, 0.98]);
    const result = fixture.rank([execution, cheaper]) as { scores: number[] };
    expect(result.scores[1]).toBeGreaterThan(result.scores[0] ?? 0);
    fixture.setRawScores([0.99, 0.7]);
    const safer = fixture.rank([execution, cheaper]) as { scores: number[] };
    expect(safer.scores[0]).toBeGreaterThan(safer.scores[1] ?? 0);
    fixture.setRawScores([0.81, 0.8]);
    expect(fixture.rank([execution, cheaper])).toBeUndefined();
  });
});
