/** Checks causal input privacy, production route enums, work bounds and persisted-key compatibility. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralResidualRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';

interface Fixture {
  context: (specification: unknown) => Record<string, number>;
  encode: (specification: unknown) => Float32Array;
  prepare: (
    specifications: unknown[],
    decisions: unknown[],
    excluded?: Set<string>,
  ) =>
    | { indices: number[]; specifications: { recoveryContext: Record<string, number> }[] }
    | undefined;
  decide: (specification: unknown) => { contextKey: string; featureVector: number[] };
}

/** Exposes only the real lexical helpers from a disposable, profile-free runtime. */
function createFixture(): Fixture {
  return vm.runInNewContext(`
    const previewInspectorSession = {};
    const previewEntryRevision = 1;
    ${createPreviewInspectorNeuralResidualRuntimeSource()}
    ({ context: readPreviewInspectorRecoveryPriorContext,
       encode: encodePreviewInspectorRecoveryPriorFeatures,
       prepare: preparePreviewInspectorRecoveryPriorPortfolio,
       decide: createPreviewInspectorNeuralResidualDecision });
  `) as Fixture;
}

const page = {
  blockerKind: 'page-context',
  holeKind: 'page-choice-context',
  candidateId: 'owned-route',
  numbers: {
    complete: 1,
    entryConnected: 1,
    targetAffinity: 1,
    pathDepth: 4,
    conditionalCount: 1,
    wrapperCount: 2,
    candidateCount: 3,
  },
  tokens: ['compiler-admitted:true', 'root-owns-router:true', 'route-evidence:route-jsx'],
};

describe('recovery prior causal context', () => {
  it('adds failure context without changing saved online features or candidate-context identity', () => {
    const fixture = createFixture();
    const before = fixture.decide(page);
    const after = fixture.decide({
      ...page,
      recoveryContext: {
        failedCandidateCount: 2,
        verifiedFailureCount: 3,
        remainingCandidateCount: 2,
      },
    });
    expect(after.contextKey).toBe(before.contextKey);
    expect(after.featureVector).toEqual(before.featureVector);
    expect(fixture.encode({ ...page, recoveryContext: { failedCandidateCount: 2 } })).not.toEqual(
      fixture.encode(page),
    );
  });

  it.each(['route-jsx', 'route-catalog', 'next-pages-filesystem', 'next-app-filesystem'])(
    'recognizes the production route evidence enum %s without encoding its path',
    (evidence) => {
      const fixture = createFixture();
      expect(
        fixture.context({ ...page, tokens: ['route-evidence:' + evidence] }).routeEvidencePresent,
      ).toBe(1);
      expect(
        fixture.context({ ...page, tokens: ['route-evidence:/private/secret'] })
          .routeEvidencePresent,
      ).toBe(0);
    },
  );

  it('encodes required receiver categories but never error messages, names or raw values', () => {
    const fixture = createFixture();
    const input = { ...page, recoveryContext: { collectionDemandCount: 2, nestedThrowCount: 1 } };
    expect(
      fixture.encode({
        ...input,
        recoveryContext: {
          ...input.recoveryContext,
          error: 'private stack',
          userValue: { email: 'private@example.test' },
          sourcePath: '/private/app',
        },
      }),
    ).toEqual(fixture.encode(input));
    expect(
      fixture.encode({ ...input, recoveryContext: { stringDemandCount: 2, nestedThrowCount: 1 } }),
    ).not.toEqual(fixture.encode(input));
  });

  it('bounds structural costs, negative counts and non-number inputs without coercion', () => {
    const fixture = createFixture();
    const context = fixture.context({
      ...page,
      numbers: { pathDepth: 1e15, wrapperCount: '200' },
      recoveryContext: {
        failedCandidateCount: Infinity,
        verifiedFailureCount: -1,
        collectionDemandCount: {
          valueOf: () => {
            throw new Error('Must not coerce');
          },
        },
      },
    });
    expect(context.repairCostUnits).toBe(50);
    expect(context.failedCandidateCount).toBe(0);
    expect(context.verifiedFailureCount).toBe(0);
    expect(context.collectionDemandCount).toBe(0);
    expect(Object.values(context).every(Number.isFinite)).toBe(true);
  });

  it('uses only verifier-owned failure counts and never relabels a successful/uncertain attempt', () => {
    const fixture = createFixture();
    const specifications = [page, page, page];
    const decisions = [
      { candidateId: 'failed', outcomeAttempts: 2, consecutiveFailures: 2 },
      { candidateId: 'unknown-a', outcomeAttempts: 0, consecutiveFailures: 0 },
      { candidateId: 'unknown-b', outcomeAttempts: 0, consecutiveFailures: 0 },
    ];
    expect(fixture.prepare(specifications, decisions)).toMatchObject({
      indices: [1, 2],
      specifications: [
        {
          recoveryContext: {
            failedCandidateCount: 1,
            verifiedFailureCount: 2,
            remainingCandidateCount: 2,
          },
        },
        {
          recoveryContext: {
            failedCandidateCount: 1,
            verifiedFailureCount: 2,
            remainingCandidateCount: 2,
          },
        },
        {
          recoveryContext: {
            failedCandidateCount: 1,
            verifiedFailureCount: 2,
            remainingCandidateCount: 2,
          },
        },
      ],
    });
    expect(
      fixture.prepare(specifications, [
        { ...decisions[0], consecutiveFailures: 0 },
        ...decisions.slice(1),
      ]),
    ).toBeUndefined();
    expect(fixture.prepare(specifications, decisions, new Set(['unknown-a']))).toBeUndefined();
    expect(page).not.toHaveProperty('recoveryContext');
  });
});
