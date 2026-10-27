/** Exercises evidence review and read-only navigation for an earlier, currently unmounted target. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorVisibilityDiagnosisUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorVisibilityDiagnosisUiRuntimeSource';
import { createPreviewInspectorNeuralChoiceReviewRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralChoiceReviewRuntimeSource';
import { createPreviewInspectorNeuralChoiceGuidanceUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralChoiceGuidanceUiRuntimeSource';
import { createPreviewInspectorNeuralLearningUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralLearningUiRuntimeSource';

interface Element {
  /** Controlled React element type; no authored application component is executed. */
  readonly type: string;
  /** Generated control properties exposed to the assertion harness. */
  readonly props: { readonly onClick?: () => void };
  /** Children preserve the real guidance element hierarchy. */
  readonly children: readonly unknown[];
}

interface Fixture {
  readonly calls: string[];
  readonly render: () => Element;
  readonly renderPrimary: () => Element;
  readonly review: () => { readonly label: string; readonly lines: readonly string[] };
  readonly overrides: () => number;
  readonly update: (options: Record<string, unknown>) => void;
}

/** Composes production presenters around one retained observation without mounting project React. */
function createFixture(): Fixture {
  const sandbox: { fixture?: Fixture } = {};
  vm.runInNewContext(
    `
    const calls = [];
    const state = { key: 'page:Target', candidateId: 'page', pageRootCommitted: true,
      targetExportName: 'Target', targetSourcePath: '/Target.tsx',
      targetWasMounted: true, targetMounted: false, targetHasOutput: false };
    const previewInspectorSession = { activeTargetReachabilityKey: state.key,
      renderConditionOverrides: new Map(), targetReachabilityByKey: new Map([[state.key, state]]) };
    let candidate = { id: 'page', target: { exportName: 'Target', sourcePath: '/Target.tsx' } };
    const findSelectedPreviewInspectorDescriptor = () => ({});
    const readSelectedPreviewInspectorPageCandidate = () => candidate;
    const readPreviewInspectorActiveBlockerSummary = () => ({ active: [] });
    const isPreviewInspectorTargetReachabilityResolving = () => false;
    const readPreviewInspectorNeuralLearningStatus = () => ({ phase: 'needs-choice' });
    const revealPreviewInspectorMissingTargetOutput = () => calls.push('target-evidence');
    const revealPreviewInspectorNeuralUserChoice = () => { calls.push('page-paths'); return true; };
    const activatePreviewInspectorNeuralAssistance = () => calls.push('legacy-neural-action');
    const readPreviewInspectorNeuralAssistanceAvailability = () => ({ actionable: true,
      mode: 'choice', choiceReview: readPreviewInspectorNeuralChoiceReview(choices, choices[0]) });
    const PreviewInspectorDevtoolsButton = 'button';
    const React = { createElement: (type, props, ...children) => ({ type, props, children }) };
    const choices = [{ surface: 'page-context', title: 'Choose one of 1 ranked paths' }];
    ${createPreviewInspectorVisibilityDiagnosisUiRuntimeSource()}
    ${createPreviewInspectorNeuralChoiceReviewRuntimeSource()}
    ${createPreviewInspectorNeuralChoiceGuidanceUiRuntimeSource()}
    ${createPreviewInspectorNeuralLearningUiRuntimeSource()}
    globalThis.fixture = {
      calls, render: () => PreviewInspectorNeuralChoiceHandoff({ choices, targetRendered: false }),
      renderPrimary: () => PreviewInspectorNeuralRequestButton(),
      review: () => readPreviewInspectorNeuralChoiceReview(choices, choices[0]),
      overrides: () => previewInspectorSession.renderConditionOverrides.size,
      update: options => {
        if (options.state) Object.assign(state, options.state);
        if (options.key) previewInspectorSession.activeTargetReachabilityKey = options.key;
        if (options.candidate) candidate = options.candidate;
        if (options.removeState) previewInspectorSession.targetReachabilityByKey.clear();
      },
    };
  `,
    sandbox,
  );
  if (sandbox.fixture === undefined) throw new Error('Guidance fixture did not initialize.');
  return sandbox.fixture;
}

/** Finds real generated button callbacks in the controlled element tree. */
function findButton(value: unknown): Element | undefined {
  if (value === null || typeof value !== 'object' || !('type' in value)) return undefined;
  const element = value as Element;
  return element.type === 'button' ? element : element.children.map(findButton).find(Boolean);
}

describe('unmounted target guidance', () => {
  it('opens the recorded evidence from the actual primary request button', () => {
    const fixture = createFixture();
    const button = fixture.renderPrimary();
    expect(JSON.stringify(button)).toContain('Inspect target evidence');
    expect(button.props.onClick).toBeTypeOf('function');
    button.props.onClick?.();
    expect(fixture.calls).toEqual(['target-evidence']);
    expect(fixture.overrides()).toBe(0);
  });

  it.each([
    { key: 'another-path' },
    { candidate: { id: 'another-candidate' } },
    { candidate: { id: 'page', target: { sourcePath: '/OtherTarget.tsx', exportName: 'Target' } } },
    { state: { targetMounted: true, targetHasOutput: true } },
    { removeState: true },
  ])('does not execute a retained primary evidence action after a change: %j', (options) => {
    const fixture = createFixture();
    const button = fixture.renderPrimary();
    expect(button.props.onClick).toBeTypeOf('function');
    fixture.update(options);
    button.props.onClick?.();
    expect(fixture.calls).toEqual([]);
    expect(fixture.overrides()).toBe(0);
  });

  it('preserves the primary page-path action without an earlier mount', () => {
    const fixture = createFixture();
    fixture.update({ state: { targetWasMounted: false } });
    const button = fixture.renderPrimary();
    expect(JSON.stringify(button)).toContain('Compare page paths');
    button.props.onClick?.();
    expect(fixture.calls).toEqual(['legacy-neural-action']);
    expect(fixture.overrides()).toBe(0);
  });

  it('reviews recorded arrival before proposing a different page path', () => {
    const fixture = createFixture();
    expect(fixture.review().label).toBe('Inspect target evidence');
    const rendered = fixture.render();
    const text = JSON.stringify(rendered);
    expect(text).toContain('Review target evidence');
    expect(text).toContain('An earlier mount does not prove');
    expect(text).not.toContain('Choose a page path');
    findButton(rendered)?.props.onClick?.();
    expect(fixture.calls).toEqual(['target-evidence']);
    expect(fixture.overrides()).toBe(0);
  });

  it('does not execute a retained evidence action after the active path changes', () => {
    const fixture = createFixture();
    const button = findButton(fixture.render());
    expect(button?.props.onClick).toBeTypeOf('function');
    fixture.update({ key: 'another-path' });
    button?.props.onClick?.();
    expect(fixture.calls).toEqual([]);
    expect(fixture.overrides()).toBe(0);
  });

  it.each([
    { candidate: { id: 'another-candidate' } },
    { candidate: { id: 'page', target: { sourcePath: '/OtherTarget.tsx', exportName: 'Target' } } },
    { state: { targetWasMounted: false } },
    { state: { targetMounted: true, targetHasOutput: true } },
  ])('rechecks a retained evidence action when the current observation changes: %j', (options) => {
    const fixture = createFixture();
    const button = findButton(fixture.render());
    expect(button?.props.onClick).toBeTypeOf('function');
    fixture.update(options);
    button?.props.onClick?.();
    expect(fixture.calls).toEqual([]);
    expect(fixture.overrides()).toBe(0);
  });

  it.each([
    { state: { targetWasMounted: false } },
    { candidate: { id: 'another-candidate' } },
    { candidate: { id: 'page', target: { sourcePath: '/Target.tsx', exportName: 'OtherTarget' } } },
    { removeState: true },
  ])('keeps ordinary page-path guidance without current arrival proof: %j', (options) => {
    const fixture = createFixture();
    fixture.update(options);
    expect(fixture.review().label).toBe('Compare page paths');
    expect(JSON.stringify(fixture.render())).toContain('Choose a page path');
    expect(fixture.overrides()).toBe(0);
  });
});
