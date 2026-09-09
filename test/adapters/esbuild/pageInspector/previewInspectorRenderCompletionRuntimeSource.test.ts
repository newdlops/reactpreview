/** Keeps partial output, required-choice markers, recovery and success evidence consistent. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralAssistanceAutomationRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralAssistanceAutomationRuntimeSource';
import { createPreviewInspectorNeuralLearningUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralLearningUiRuntimeSource';
import { createPreviewInspectorNeuralSuccessCheckpointRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralSuccessCheckpointRuntimeSource';
import { createPreviewInspectorPageCandidateUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageCandidateUiRuntimeSource';
import { createPreviewInspectorStructureUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorStructureUiRuntimeSource';

interface CompletionFixture {
  readonly badge: () => string;
  readonly corridor: () => unknown;
  readonly friendly: () => { readonly icon: string; readonly kind: string; readonly title: string };
  readonly icon: (blocking: boolean) => string;
  readonly settled: () => boolean;
  readonly snapshotVisible: () => boolean;
  readonly status: () => { readonly children: unknown[]; readonly props: Record<string, unknown> };
  readonly update: (options: {
    readonly active?: unknown[];
    readonly output?: boolean;
    readonly paused?: boolean;
    readonly phase?: string;
  }) => void;
}

/** Runs production functions over one exact target; active entries are already runtime-filtered. */
function createFixture(): CompletionFixture {
  const context: { fixture?: CompletionFixture } = {};
  vm.runInNewContext(
    `
      const previewEntryRevision = 1;
      const state = { key: 'page:Target', status: 'reached', targetMounted: true,
        targetWasMounted: true, targetHasOutput: true, pageRootCommitted: true,
        targetExportName: 'Target' };
      const condition = { id: 'payment', requiresAuthoredState: true };
      const node = { id: 'required-payment', name: 'Payment choice',
        blockerKind: 'render-condition', kind: 'condition', condition };
      let active = [node], paused = false, phase = 'learned';
      const record = { successCollectionSettled: true };
      const previewInspectorSession = { selectedExportName: 'Target',
        selectedPageCandidateId: 'page', automaticNeuralAssistanceByKey: new Map() };
      const React = { createElement: (type, props, ...children) => ({ type, props, children }) };
      const readPreviewInspectorNeuralLearningStatus = () => ({ phase, updates: 18 });
      const readPreviewInspectorActiveBlockerSummary = () => ({ active, count: active.length, first: active[0] });
      const readPreviewInspectorNeuralAssistanceBlockers = readPreviewInspectorActiveBlockerSummary;
      const readPreviewInspectorNeuralAssistanceReachability = () => state;
      const isPreviewInspectorNeuralAssistancePaused = () => paused;
      const hasPreviewInspectorCompletePageExecutionContext = () => true;
      const hasPreviewInspectorNeuralPageGenerationWork = () => false;
      const previewInspectorNeuralAssistanceBlockerKinds = new Set(['render-condition', 'data-request', 'runtime-fallback', 'target-error']);
      const readPreviewInspectorRenderScenario = () => 'authored-page';
      const findSelectedPreviewInspectorDescriptor = () => ({ inspector: { pageCandidates: [] } });
      const readSelectedPreviewInspectorPageCandidate = () => undefined;
      const selectPreviewInspectorMainComponent = () => undefined;
      ${createPreviewInspectorNeuralAssistanceAutomationRuntimeSource()}
      ${createPreviewInspectorNeuralSuccessCheckpointRuntimeSource()}
      ${createPreviewInspectorStructureUiRuntimeSource()}
      ${createPreviewInspectorPageCandidateUiRuntimeSource()}
      ${createPreviewInspectorNeuralLearningUiRuntimeSource()}
      previewInspectorSession.automaticNeuralAssistanceByKey.set(
        createPreviewInspectorAutomaticNeuralAssistanceKey(state), record);
      const snapshot = createPreviewInspectorNeuralSuccessSnapshot(state);
      globalThis.fixture = {
        badge: () => formatPreviewInspectorPageCorridorStatus(state),
        corridor: readPreviewInspectorAutomaticNeuralAssistanceCorridor,
        friendly: () => readPreviewInspectorFriendlyPageStatus(state),
        icon: blocking => readPreviewInspectorStructureIcon(node, true, blocking, false),
        settled: () => isPreviewInspectorNeuralSuccessCollectionSettled(state),
        snapshotVisible: () => isPreviewInspectorNeuralSuccessSnapshotVisible(state, snapshot),
        status: PreviewInspectorNeuralLearningStatus,
        update: options => {
          if (options.active !== undefined) active = options.active;
          if (options.output !== undefined) state.targetHasOutput = options.output;
          if (options.phase !== undefined) phase = options.phase;
          if (options.paused !== undefined) paused = options.paused;
        },
      };
    `,
    context,
  );
  if (context.fixture === undefined) throw new Error('Completion fixture did not initialize');
  return context.fixture;
}

describe('Preview Inspector render completion', () => {
  it.each(['applied', 'learned', 'unchanged', 'needs-choice'])(
    'does not display %s as success while the preview still requires a choice',
    (phase) => {
      const fixture = createFixture();
      fixture.update({ phase });
      expect(fixture.status().props['data-phase']).toBe('incomplete');
      expect(JSON.stringify(fixture.status())).toContain('Output visible · 1 unresolved step');
      expect(JSON.stringify(fixture.status())).not.toContain('✓');
      expect(fixture.badge()).toBe('PAGE INCOMPLETE');
      expect(fixture.friendly()).toMatchObject({ icon: '?', kind: 'choice' });
    },
  );

  it('reserves the question mark for blocking choices, not optional condition branches', () => {
    const fixture = createFixture();
    expect(fixture.icon(true)).toBe('?');
    expect(fixture.icon(false)).toBe('◇');
    fixture.update({ active: [] });
    expect(fixture.badge()).toBe('PAGE READY');
    expect(fixture.friendly()).toMatchObject({ icon: '✓', kind: 'ready' });
    expect(fixture.status().props['data-phase']).toBe('learned');
  });

  it('keeps recovery open and rejects checkpoint verification until the active choice clears', () => {
    const fixture = createFixture();
    expect(fixture.corridor()).toMatchObject({ targetHasOutput: true });
    expect(fixture.settled()).toBe(false);
    expect(fixture.snapshotVisible()).toBe(false);
    fixture.update({ active: [] });
    expect(fixture.corridor()).toBeUndefined();
    expect(fixture.settled()).toBe(true);
    expect(fixture.snapshotVisible()).toBe(true);
  });

  it.each(['data-request', 'runtime-fallback', 'target-error', 'runtime-global'])(
    'invalidates a settled success when an active %s appears',
    (blockerKind) => {
      const fixture = createFixture();
      fixture.update({ active: [] });
      expect(fixture.snapshotVisible()).toBe(true);
      fixture.update({ active: [{ blockerKind, id: 'new-blocker' }] });
      expect(fixture.settled()).toBe(false);
      expect(fixture.snapshotVisible()).toBe(false);
      expect(fixture.status().props['data-phase']).toBe('incomplete');
    },
  );

  it('retains learning, checking and user pause states without declaring completion', () => {
    const fixture = createFixture();
    for (const phase of ['learning', 'applying', 'paused']) {
      fixture.update({ phase });
      expect(fixture.status().props['data-phase']).toBe(phase);
    }
    fixture.update({ paused: true, phase: 'applied' });
    expect(fixture.status().props['data-phase']).toBe('yielded');
    expect(fixture.corridor()).toBeUndefined();
    expect(fixture.settled()).toBe(false);
  });

  it('does not describe empty output as visible while requiring the same resolution', () => {
    const fixture = createFixture();
    fixture.update({ output: false });
    expect(fixture.status().props['data-phase']).toBe('incomplete');
    expect(JSON.stringify(fixture.status())).not.toContain('Output visible');
    expect(fixture.friendly()).toMatchObject({ title: 'Your choice is needed', kind: 'choice' });
    expect(fixture.snapshotVisible()).toBe(false);
  });
});
