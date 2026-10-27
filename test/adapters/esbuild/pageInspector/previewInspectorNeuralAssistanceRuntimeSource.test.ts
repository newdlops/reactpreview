/** Exercises the explicit neural request without mounting project React or inventing candidates. */
import { describe, expect, it } from 'vitest';
import {
  createAssistanceFixture,
  type AssistanceFixture,
} from './previewInspectorNeuralAssistanceFixture';

describe('Preview Inspector neural assistance runtime source', () => {
  it('re-evaluates persisted learning and delegates exactly one admitted blocker', () => {
    const fixture = createAssistanceFixture();
    expect(fixture.availability()).toMatchObject({
      actionable: true,
      blockerCount: 1,
      modelUpdates: 12,
      pending: false,
    });
    expect(fixture.request()).toBe(true);
    expect(fixture.session.neuralLearningStatus).toMatchObject({
      phase: 'applying',
      updates: 12,
    });
    fixture.flushFrame();
    expect(fixture.calls.remounts).toEqual([]);
    expect(fixture.session.runtimeFallbackDataFlowRecommendations.size).toBe(1);
    expect(fixture.session.runtimeFallbackDataFlowSignals.size).toBe(1);
    expect(fixture.session.runtimeFallbackNeuralDecisions.size).toBe(1);
    expect(fixture.session.runtimeFallbackSemanticValueRecommendations.size).toBe(1);
    expect(fixture.session.runtimeFallbackNeuralRevision).toBe(4);
    expect(fixture.session.runtimeFallbackAuthoredValues.get('user-value')).toEqual({
      status: 'custom',
    });
    expect(fixture.session.runtimeFallbackSharedNeuralRecommendations.has('verified')).toBe(true);
    fixture.flushFrame();
    expect(fixture.calls.paths).toEqual([
      [
        { key: 'page:Panel' },
        {
          excludedCandidateIds: [],
          explorationMode: 'novel-candidate',
          explorationOrdinal: 1,
          origin: 'user-neural',
        },
      ],
    ]);
    expect(fixture.calls.data).toEqual([]);
    expect(fixture.calls.health).toHaveLength(1);
    expect(fixture.request()).toBe(false);
    fixture.flushTimer();
    expect(fixture.session.neuralAssistancePending).toBe(false);
    expect(fixture.session.neuralLearningStatus).toMatchObject({
      phase: 'applying',
      updates: 12,
    });
  });

  it('does not disturb a learned screen after its blockers disappear', () => {
    const fixture = createAssistanceFixture();
    fixture.setBlockers([]);
    fixture.setReachabilityStatus('probing');
    fixture.setReachabilityOutput(true);
    expect(fixture.availability()).toMatchObject({
      actionable: true,
      blockerCount: 0,
      mode: 'review',
      rendered: true,
      title:
        'Review the model-ranked page path and verified evidence without remounting this page.',
    });
    expect(fixture.request()).toBe(false);
    expect(fixture.activate()).toBe(true);
    expect(fixture.calls.reviews).toEqual([
      'expand',
      'open-paths',
      'companion:neural-inference',
      'focus',
      'scroll',
    ]);
    expect(fixture.calls.remounts).toEqual([]);
    expect(fixture.calls.paths).toEqual([]);
    expect(fixture.session.runtimeFallbackDataFlowRecommendations.size).toBe(1);
    expect(fixture.session.runtimeFallbackNeuralDecisions.size).toBe(1);
    expect(fixture.session.neuralLearningStatus).toBeUndefined();
  });

  it('keeps active blockers actionable while only partial target output is visible', () => {
    const fixture = createAssistanceFixture();
    fixture.setReachabilityOutput(true);
    expect(fixture.availability()).toMatchObject({
      actionable: true,
      blockerCount: 1,
      mode: 'resolve',
      rendered: false,
    });
  });

  it('hands a source-proven semantic value to the existing blocker editor', () => {
    const fixture = createAssistanceFixture();
    fixture.setBlockers([
      {
        blocker: {
          blockedComponentName: 'TaxTypeBadge',
          exportName: 'Panel',
          headline: 'Error: Unreachable',
          id: 'tax-type-error',
          sourceChoice: true,
        },
        blockerKind: 'target-error',
      },
    ]);
    fixture.setReachabilityStatus('reached');
    expect(fixture.availability()).toMatchObject({
      actionable: true,
      choiceAvailable: true,
      mode: 'choice',
      title: 'Choose a source-proven value for taxType.',
    });
    const choice = fixture.choice({ explicitOnly: true });
    expect(choice).toMatchObject({
      choiceKind: 'source-proven-prop',
      choiceRecords: [
        {
          candidates: ['heavy_tax', 'normal_tax'],
          currentValue: 'taxType',
          path: 'taxType',
        },
      ],
      exportName: 'Panel',
    });
    expect(fixture.activate()).toBe(true);
    expect(fixture.calls.failures).toEqual([]);
    expect(fixture.calls.reveals).toEqual(['tax-type-error']);
    expect(fixture.calls.selections).toEqual([
      expect.objectContaining({ id: 'tax-type-error', blockerKind: 'target-error' }),
    ]);
    expect(fixture.applyChoices(choice, { taxType: 1 })).toBe(true);
    expect(fixture.calls.choices).toEqual([['Panel', 'taxType', 'normal_tax', true]]);
    expect(fixture.session.neuralLearningStatus).toMatchObject({
      labelReason: 'taxType',
      phase: 'applying',
    });
  });

  it('requires every ambiguous path and commits a multi-choice handoff only on the final value', () => {
    const fixture = createAssistanceFixture();
    fixture.setBlockers([
      {
        blocker: {
          blockedComponentName: 'Panel',
          exportName: 'Panel',
          headline: 'Error: Unreachable',
          id: 'multi-choice-error',
          sourceChoice: true,
          sourceChoices: [
            {
              candidates: ['grid', 'list'],
              currentValue: 'mode',
              kind: 'string',
              path: 'mode',
            },
            {
              candidates: [true, false],
              currentValue: undefined,
              kind: 'boolean',
              path: 'options.compact',
            },
          ],
        },
        blockerKind: 'target-error',
      },
    ]);
    fixture.setReachabilityStatus('reached');
    const choice = fixture.choice({ explicitOnly: true });

    expect(choice).toMatchObject({
      choiceRecords: [
        { candidates: ['grid', 'list'], path: 'mode' },
        { candidates: [true, false], path: 'options.compact' },
      ],
      title: 'Choose values for 2 source-proven component options.',
    });
    expect(fixture.applyChoices(choice, { mode: 1 })).toBe(false);
    expect(fixture.calls.choices).toEqual([]);
    expect(fixture.applyChoices(choice, { mode: 1, 'options.compact': 0 })).toBe(true);
    expect(fixture.calls.choices).toEqual([
      ['Panel', 'mode', 'list', false],
      ['Panel', 'options.compact', true, true],
    ]);
  });

  it('walks A, B, and C once across changing blockers, then hands the choices to the user', () => {
    const fixture = createAssistanceFixture();
    const candidates = ['heavy_tax', 'fixed_tax', 'normal_tax'];
    const createChoiceBlocker = (
      id: string,
      headline: string,
      currentValue: string,
      selectionOrigin?: string,
    ): Readonly<Record<string, unknown>> => ({
      blocker: {
        blockedComponentName: 'TaxTypeBadge',
        exportName: 'Panel',
        finiteChoiceCycle: true,
        headline,
        id,
        sourceChoices: [
          {
            candidates,
            currentValue,
            kind: 'string',
            path: 'taxType',
            selectionOrigin,
            userControlled: false,
          },
        ],
        sourcePath: '/workspace/tax-type-badge.tsx',
        targetPropRequiredPaths: ['taxType'],
      },
      blockerKind: 'target-error',
    });
    fixture.clearReachability();
    fixture.setBlockers([createChoiceBlocker('error-a', 'Error: Unreachable A', 'taxType')]);

    expect(fixture.request()).toBe(true);
    expect(fixture.session.neuralLearningStatus).toMatchObject({
      choiceAttempt: 1,
      choiceCount: 3,
      phase: 'applying',
    });
    fixture.flushFrame();
    fixture.flushFrame();
    fixture.setBlockers([
      createChoiceBlocker('error-b', 'Error: Unexpected value B', 'heavy_tax', 'automatic-repair'),
    ]);
    fixture.flushTimer();

    fixture.flushFrame();
    expect(fixture.session.neuralLearningStatus).toMatchObject({
      choiceAttempt: 2,
      choiceCount: 3,
      phase: 'applying',
    });
    fixture.flushFrame();
    fixture.flushFrame();
    fixture.setBlockers([
      createChoiceBlocker('error-c', 'Error: Unreachable C', 'fixed_tax', 'automatic-repair'),
    ]);
    fixture.flushTimer();

    fixture.flushFrame();
    expect(fixture.session.neuralLearningStatus).toMatchObject({
      choiceAttempt: 3,
      choiceCount: 3,
      phase: 'applying',
    });
    fixture.flushFrame();
    fixture.flushFrame();
    fixture.setBlockers([
      createChoiceBlocker(
        'error-a-again',
        'Error: Unreachable A',
        'normal_tax',
        'automatic-repair',
      ),
    ]);
    fixture.flushTimer();

    expect(fixture.calls.choiceAttempts.map((attempt) => attempt.ordinal)).toEqual([1, 2, 3]);
    expect(new Set(fixture.calls.choiceAttempts.map((attempt) => attempt.candidateId)).size).toBe(
      3,
    );
    expect(new Set(fixture.calls.choiceAttempts.map((attempt) => attempt.signature)).size).toBe(1);
    expect(fixture.availability()).toMatchObject({
      actionable: true,
      choiceAvailable: true,
      mode: 'choice',
      title: 'Every source-proven value for taxType was tested. Choose the value to keep.',
    });
    expect(fixture.choice({ explicitOnly: true })).toMatchObject({
      automaticAttemptCount: 3,
      automaticCandidateCount: 3,
      choiceRecords: [{ candidates, path: 'taxType' }],
    });
    expect(fixture.request()).toBe(false);
    expect(fixture.calls.choiceAttempts).toHaveLength(3);
  });

  it('keeps the first verified render while automatically testing remaining finite choices', () => {
    const fixture = createAssistanceFixture();
    fixture.setReachabilityStatus('reached');
    fixture.setBlockers([
      {
        blocker: {
          blockedComponentName: 'TaxTypeBadge',
          exportName: 'Panel',
          finiteChoiceCycle: true,
          headline: 'Error: Unreachable A',
          id: 'error-a',
          sourceChoices: [
            {
              candidates: ['heavy_tax', 'normal_tax'],
              currentValue: 'taxType',
              kind: 'string',
              path: 'taxType',
              userControlled: false,
            },
          ],
          sourcePath: '/workspace/tax-type-badge.tsx',
          targetPropRequiredPaths: ['taxType'],
        },
        blockerKind: 'target-error',
      },
    ]);

    expect(fixture.request()).toBe(true);
    fixture.flushFrame();
    fixture.flushFrame();
    fixture.setReachabilityOutput(true);
    fixture.setBlockers([]);
    fixture.flushTimer();
    expect(fixture.availability()).toMatchObject({
      actionable: false,
      pending: true,
      rendered: true,
      verifying: true,
    });
    fixture.flushTimer();
    fixture.flushTimer();
    fixture.flushTimer();

    expect(fixture.successfulPathCount()).toBe(1);
    expect(fixture.session.neuralLearningStatus).toMatchObject({
      collecting: true,
      phase: 'applying',
      successCount: 1,
    });
    expect(fixture.calls.choiceAttempts.map((attempt) => attempt.ordinal)).toEqual([1]);
    fixture.flushFrame();
    expect(fixture.session.neuralLearningStatus).toMatchObject({
      choiceAttempt: 2,
      choiceCount: 2,
      phase: 'applying',
    });
    fixture.flushFrame();
    fixture.flushFrame();
    expect(fixture.calls.choiceAttempts.map((attempt) => attempt.ordinal)).toEqual([1, 2]);
  });

  /**
   * Restoring the best checkpoint while a newer success is still being sampled made that sampling
   * measure the restored state, reject the real success, and drop the verified path as well.
   */
  it('waits for a pending success verification before restoring the best checkpoint', () => {
    const fixture = createAssistanceFixture();
    fixture.setReachabilityStatus('reached');
    fixture.setBlockers([
      {
        blocker: {
          blockedComponentName: 'TaxTypeBadge',
          exportName: 'Panel',
          finiteChoiceCycle: true,
          headline: 'Error: Unreachable A',
          id: 'error-a',
          sourceChoices: [
            {
              candidates: ['heavy_tax', 'normal_tax'],
              currentValue: 'taxType',
              kind: 'string',
              path: 'taxType',
              userControlled: false,
            },
          ],
          sourcePath: '/workspace/tax-type-badge.tsx',
          targetPropRequiredPaths: ['taxType'],
        },
        blockerKind: 'target-error',
      },
    ]);
    fixture.request();
    fixture.flushFrame();
    fixture.flushFrame();
    fixture.setReachabilityOutput(true);
    fixture.setBlockers([]);
    for (let index = 0; index < 4; index += 1) fixture.flushTimer();
    expect(fixture.successfulPathCount()).toBe(1);
    for (let index = 0; index < 4; index += 1) fixture.flushFrame();
    expect(fixture.readResolverProps()).toEqual({ taxType: 'normal_tax' });

    // The second choice renders and is now provisional; the first must not be restored yet.
    fixture.flushTimer();
    expect(fixture.availability()).toMatchObject({ verifying: true });
    expect(fixture.readResolverProps()).toEqual({ taxType: 'normal_tax' });
    fixture.flushFrame();
    fixture.flushTimer();
    fixture.flushTimer();
    expect(fixture.readResolverProps()).toEqual({ taxType: 'normal_tax' });

    fixture.flushTimer();
    expect(fixture.successfulPathCount()).toBe(2);
  });

  it('retains the last working inference while refreshing an unresolved hook', () => {
    const fixture = createAssistanceFixture();
    fixture.setBlockers([
      {
        blocker: { id: 'stale' },
        blockerKind: 'runtime-fallback',
      },
    ]);
    fixture.setReachabilityStatus('reached');

    expect(fixture.request()).toBe(true);
    fixture.flushFrame();

    expect(fixture.calls.remounts).toEqual([['Panel', false]]);
    expect(fixture.session.runtimeFallbackDataFlowRecommendations.size).toBe(1);
    expect(fixture.session.runtimeFallbackDataFlowSignals.size).toBe(1);
    expect(fixture.session.runtimeFallbackNeuralDecisions.size).toBe(1);
    expect(fixture.session.runtimeFallbackSemanticValueRecommendations.size).toBe(1);
    expect(fixture.session.runtimeFallbackNeuralRevision).toBe(4);
    expect(fixture.session.runtimeFallbackSharedNeuralRecommendations.has('verified')).toBe(true);
    expect(fixture.session.runtimeFallbackAuthoredValues.has('user-value')).toBe(true);

    fixture.flushFrame();
    expect(fixture.calls.runtime).toEqual(['stale']);
  });

  it('sweeps from contained exceptions through the final Unrendered blocker', () => {
    const fixture = createAssistanceFixture();
    fixture.setBlockers([
      {
        blocker: { key: 'page:Panel' },
        blockerKind: 'target-reachability',
      },
      {
        blocker: { id: 'request-1', requiredPaths: ['rows'] },
        blockerKind: 'data-request',
      },
      {
        blocker: { id: 'hook-1', requiredPaths: ['state.status'] },
        blockerKind: 'runtime-fallback',
      },
      {
        blocker: { exportName: 'Panel', headline: 'Missing runtime', id: 'global-1' },
        blockerKind: 'runtime-global',
      },
      {
        blocker: {
          blockedComponentName: 'Panel',
          headline: "Cannot read properties of undefined (reading 'status')",
          id: 'error-1',
          targetPropRequiredPaths: ['state.status'],
        },
        blockerKind: 'target-error',
      },
    ]);
    fixture.setConditions([
      {
        blocksCurrentTarget: true,
        effectiveEnabled: false,
        expression: 'ready && <Panel />',
        id: 'condition-1',
        reachabilityKey: 'page:Panel',
        requiredValue: true,
      },
    ]);

    expect(fixture.availability()).toMatchObject({ actionable: true, blockerCount: 6 });
    expect(fixture.request()).toBe(true);

    fixture.flushFrame();
    fixture.flushFrame();
    expect(fixture.calls.failures).toEqual(['error-1']);
    fixture.flushTimer();

    for (let step = 0; step < 4; step += 1) {
      fixture.flushFrame();
      fixture.flushFrame();
      fixture.flushFrame();
      fixture.flushTimer();
    }
    expect(fixture.calls.conditions).toEqual(['condition-1']);
    expect(fixture.calls.runtime).toEqual(['hook-1']);
    expect(fixture.calls.data).toEqual(['request-1']);

    fixture.flushFrame();
    fixture.flushFrame();
    fixture.flushFrame();
    expect(fixture.calls.paths).toHaveLength(1);
    fixture.setReachabilityOutput(true);
    fixture.flushTimer();

    expect(
      fixture.calls.health.map(
        (event) => (event as { detail?: { blockerKind?: string } }).detail?.blockerKind,
      ),
    ).toEqual([
      'target-error',
      'runtime-global',
      'render-condition',
      'runtime-fallback',
      'data-request',
      'target-reachability',
    ]);
    expect(fixture.calls.remounts).toEqual([
      ['Panel', false],
      ['Panel', false],
      ['Panel', false],
    ]);
    expect(fixture.session.neuralAssistancePending).toBe(false);
  });

  it('proactively applies a newer verified model without waiting for the button', () => {
    const fixture = createAssistanceFixture();
    fixture.setModelUpdates(13);

    expect(
      fixture.scheduleAutomatic('neural-residual-trained', {
        blockerKind: 'target-reachability',
        candidateId: 'failed-shape',
        label: 0,
        targetOutput: false,
        updates: 13,
      }),
    ).toBe(true);
    fixture.flushFrame();
    expect(fixture.session.neuralAssistancePending).toBe(true);
    expect(fixture.session.neuralLearningStatus).toMatchObject({
      phase: 'applying',
      updates: 13,
    });

    fixture.flushFrame();
    fixture.flushFrame();
    expect(fixture.calls.paths).toEqual([
      [
        { key: 'page:Panel' },
        {
          excludedCandidateIds: ['failed-shape'],
          explorationMode: 'data-first',
          explorationOrdinal: 1,
          origin: 'automatic-neural',
        },
      ],
    ]);
    expect(fixture.calls.health.at(-1)).toMatchObject({
      category: 'neural-residual',
      detail: {
        action: 'page-path-search',
        branchPolicy: 'sticky-until-verified-failure',
        explorationMode: 'data-first',
        explorationOrdinal: 1,
        requestedBy: 'automatic-learning',
      },
      event: 'neural-assistance-requested',
    });

    fixture.flushTimer();
    expect(fixture.scheduleAutomatic('neural-residual-trained', { updates: 13 })).toBe(false);
    fixture.flushFrame();
    fixture.flushFrame();
    fixture.flushFrame();
    fixture.flushTimer();
    fixture.flushFrame();
    fixture.flushFrame();
    fixture.flushFrame();
    fixture.flushTimer();
    fixture.setModelUpdates(14);
    expect(fixture.scheduleAutomatic('neural-residual-trained', { updates: 14 })).toBe(false);
    expect(fixture.calls.paths).toEqual([
      expect.anything(),
      [
        { key: 'page:Panel' },
        {
          excludedCandidateIds: ['failed-shape'],
          explorationMode: 'data-first',
          explorationOrdinal: 2,
          origin: 'automatic-neural',
        },
      ],
      [
        { key: 'page:Panel' },
        {
          excludedCandidateIds: ['failed-shape'],
          explorationMode: 'data-first',
          explorationOrdinal: 3,
          origin: 'automatic-neural',
        },
      ],
    ]);
  });

  /** A page already showing the target is checkpointed before any branch is explored. */
  it('samples visible output on the current path before an automatic exploration', () => {
    const fixture = createAssistanceFixture();
    fixture.setReachabilityStatus('probing');
    fixture.setReachabilityOutput(true);
    fixture.setBlockers([
      {
        blocker: { headline: 'Error: Unreachable', id: 'tab-branch' },
        blockerKind: 'target-error',
      },
    ]);

    expect(fixture.scheduleAutomatic('blocker-discovered')).toBe(true);
    fixture.flushFrame();
    fixture.flushFrame();

    expect(fixture.session.neuralAssistancePending).not.toBe(true);
    expect(fixture.calls.failures).toEqual([]);
    expect(fixture.availability()).toMatchObject({ verifying: true });
    fixture.setBlockers([]);
    for (let index = 0; index < 4; index += 1) fixture.flushTimer();
    expect(fixture.successfulPathCount()).toBe(1);
  });

  it('uses an admitted standalone blocker when no page reachability key exists', () => {
    const fixture = createAssistanceFixture();
    fixture.clearReachability();
    fixture.setBlockers([
      {
        blocker: { headline: 'Error: Unreachable', id: 'standalone-error' },
        blockerKind: 'target-error',
      },
    ]);

    expect(fixture.scheduleAutomatic('blocker-discovered')).toBe(true);
    fixture.flushFrame();
    fixture.flushFrame();
    fixture.flushFrame();

    expect(fixture.calls.failures).toEqual(['standalone-error']);
    expect(fixture.calls.choiceAttempts[0]?.automatic).toBe(true);
    expect(fixture.calls.paths).toEqual([]);
  });

  it('retains explicit Smart fill mode for a user-requested target repair', () => {
    const fixture = createAssistanceFixture();
    fixture.clearReachability();
    fixture.setBlockers([{ blocker: { id: 'manual-error' }, blockerKind: 'target-error' }]);
    expect(fixture.request()).toBe(true);
    fixture.flushFrame();
    fixture.flushFrame();
    expect(fixture.calls.choiceAttempts[0]?.automatic).toBe(false);
  });

  it('does not confuse a generic runtime candidate id with verified neural failure', () => {
    const fixture = createAssistanceFixture();

    expect(
      fixture.scheduleAutomatic('runtime-error-root', {
        candidateId: 'unrelated-runtime-candidate',
        targetOutput: false,
      }),
    ).toBe(true);
    flushAutomaticAssistanceAttempt(fixture);

    expect(fixture.calls.paths).toEqual([
      [{ key: 'page:Panel' }, expect.objectContaining({ excludedCandidateIds: [] })],
    ]);
  });

  it('starts from a neutral cold model and turns the first safe attempt into training evidence', () => {
    const fixture = createAssistanceFixture();
    fixture.setModelUpdates(0);

    expect(fixture.availability()).toMatchObject({
      actionable: true,
      modelUpdates: 0,
      title: 'Run the safe blocker sweep now; verified outcomes will train the local model.',
    });
    expect(fixture.scheduleAutomatic('page-composition-snapshot')).toBe(true);
    flushAutomaticAssistanceAttempt(fixture);

    expect(fixture.calls.paths).toHaveLength(1);
    expect(fixture.calls.health.at(-1)).toMatchObject({
      detail: {
        explorationAttempt: 1,
        explorationAttemptLimit: 12,
        modelUpdates: 0,
        requestedBy: 'automatic-learning',
      },
      event: 'neural-assistance-requested',
    });
  });

  it('keeps revisiting Unrendered with twelve strategies and lets the button extend the pass', () => {
    const fixture = createAssistanceFixture();

    expect(fixture.scheduleAutomatic('page-composition-snapshot')).toBe(true);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      flushAutomaticAssistanceAttempt(fixture);
    }

    expect(fixture.calls.paths).toHaveLength(12);
    expect(
      fixture.calls.paths.map(
        (call) => (call as [unknown, { explorationOrdinal?: number }])[1].explorationOrdinal,
      ),
    ).toEqual(Array.from({ length: 12 }, (_value, index) => index + 1));
    expect(
      fixture.calls.paths.map(
        (call) => (call as [unknown, { explorationMode?: string }])[1].explorationMode,
      ),
    ).toEqual(Array(12).fill('novel-candidate'));
    expect(fixture.scheduleAutomatic('page-composition-snapshot')).toBe(false);

    expect(fixture.request()).toBe(true);
    flushDirectAssistanceAttempt(fixture);
    flushAutomaticAssistanceAttempt(fixture);

    expect(fixture.calls.paths).toHaveLength(14);
    expect(fixture.calls.paths.slice(-2)).toMatchObject([
      [expect.anything(), { explorationOrdinal: 13 }],
      [expect.anything(), { explorationOrdinal: 14 }],
    ]);
    expect(fixture.request()).toBe(true);
  });

  it('pauses a continuous renderer work slice and lets an explicit request resume it', () => {
    const fixture = createAssistanceFixture();

    expect(fixture.scheduleAutomatic('page-composition-snapshot')).toBe(true);
    for (let attempt = 0; attempt < 24; attempt += 1) {
      flushAutomaticAssistanceAttempt(fixture);
      fixture.setBlockers([
        {
          blocker: { key: 'page:Panel', requiredPaths: [`shape.${String(attempt + 1)}`] },
          blockerKind: 'target-reachability',
        },
      ]);
    }

    expect(fixture.calls.paths).toHaveLength(24);
    expect(fixture.session.neuralLearningStatus).toMatchObject({
      labelReason: 'renderer-work-budget',
      phase: 'yielded',
    });
    expect(fixture.scheduleAutomatic('page-composition-snapshot')).toBe(false);

    expect(fixture.request()).toBe(true);
    flushDirectAssistanceAttempt(fixture);
    expect(fixture.calls.paths).toHaveLength(25);
  });

  it('does not run automatic neural work in a retained hidden preview tab', () => {
    const fixture = createAssistanceFixture();
    fixture.setVisible(false);

    expect(fixture.scheduleAutomatic('page-composition-snapshot')).toBe(false);
    expect(fixture.calls.paths).toHaveLength(0);

    fixture.setVisible(true);
    expect(fixture.request()).toBe(true);
    flushDirectAssistanceAttempt(fixture);
    expect(fixture.calls.paths).toHaveLength(1);
  });

  it('cycles fairly across exception, data, and Unrendered blockers before repeating one family', () => {
    const fixture = createAssistanceFixture();
    fixture.setBlockers([
      {
        blocker: { headline: 'Panel crashed', id: 'error-1' },
        blockerKind: 'target-error',
      },
      {
        blocker: { id: 'request-1', requiredPaths: ['rows'] },
        blockerKind: 'data-request',
      },
      {
        blocker: { key: 'page:Panel' },
        blockerKind: 'target-reachability',
      },
    ]);

    expect(fixture.request()).toBe(true);
    flushDirectAssistanceAttempt(fixture);
    for (let attempt = 1; attempt < 6; attempt += 1) {
      flushAutomaticAssistanceAttempt(fixture);
    }

    expect(
      fixture.calls.health.map(
        (event) => (event as { detail?: { blockerKind?: string } }).detail?.blockerKind,
      ),
    ).toEqual([
      'target-error',
      'data-request',
      'target-reachability',
      'target-error',
      'data-request',
      'target-reachability',
    ]);
  });

  it('reopens automatic work when an unresolved blocker reveals new evidence', () => {
    const fixture = createAssistanceFixture();
    expect(fixture.scheduleAutomatic('page-composition-snapshot')).toBe(true);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      flushAutomaticAssistanceAttempt(fixture);
    }
    fixture.setBlockers([
      {
        blocker: { key: 'page:Panel', requiredPaths: ['newly.revealed.rows'] },
        blockerKind: 'target-reachability',
      },
    ]);

    expect(fixture.scheduleAutomatic('page-composition-snapshot')).toBe(true);
    flushAutomaticAssistanceAttempt(fixture);

    expect(fixture.calls.paths).toHaveLength(13);
    expect(fixture.calls.paths.at(-1)).toMatchObject([
      expect.anything(),
      { explorationOrdinal: 1 },
    ]);
  });

  it('starts the learned sweep when a runtime exception appears without a new training update', () => {
    const fixture = createAssistanceFixture();
    fixture.setReachabilityDirectTarget(true);
    fixture.setBlockers([
      {
        blocker: {
          blockedComponentName: 'Panel',
          headline: 'Panel crashed',
          id: 'error-after-load',
          targetPropRequiredPaths: ['panel.state'],
        },
        blockerKind: 'target-error',
      },
      {
        blocker: { directTarget: true, key: 'page:Panel' },
        blockerKind: 'target-reachability',
      },
    ]);

    expect(fixture.scheduleAutomatic('runtime-error-root')).toBe(true);
    fixture.flushFrame();
    fixture.flushFrame();
    fixture.flushFrame();

    expect(fixture.calls.failures).toEqual(['error-after-load']);
    expect(fixture.calls.paths).toEqual([]);
  });

  it('never reopens completed output for automatic learning', () => {
    const fixture = createAssistanceFixture();
    fixture.setBlockers([]);
    fixture.setReachabilityOutput(true);
    fixture.setModelUpdates(13);
    expect(fixture.scheduleAutomatic('neural-residual-data-flow-trained', { updates: 13 })).toBe(
      false,
    );
    expect(fixture.calls.paths).toEqual([]);
  });

  it('does not let the minimum-visible learning label gate resolution work', () => {
    const fixture = createAssistanceFixture();
    fixture.setLearningStatus({ activeCount: 0, phase: 'learning', updates: 12 });

    expect(fixture.availability()).toMatchObject({ actionable: true, learning: false });

    fixture.setLearningStatus({ activeCount: 1, phase: 'learning', updates: 12 });
    expect(fixture.availability()).toMatchObject({ actionable: false, learning: true });
  });
});
/** Completes the first user-started request and its minimum-visible verification window. */
function flushDirectAssistanceAttempt(fixture: AssistanceFixture): void {
  fixture.flushFrame();
  fixture.flushFrame();
  fixture.flushTimer();
}
/** Completes one queued continuation, its two resolver frames, and verification window. */
function flushAutomaticAssistanceAttempt(fixture: AssistanceFixture): void {
  fixture.flushFrame();
  fixture.flushFrame();
  fixture.flushFrame();
  fixture.flushTimer();
}
