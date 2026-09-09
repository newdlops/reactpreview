/** Verifies evidence-first page/logic diagnoses without executing project React or model inference. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorVisibilityDiagnosisUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorVisibilityDiagnosisUiRuntimeSource';
import { createPreviewInspectorPageCandidateUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageCandidateUiRuntimeSource';

interface Diagnosis {
  readonly action?: string;
  readonly branch?: string;
  readonly description: string;
  readonly kind: string;
  readonly location?: string;
  readonly logic: string;
  readonly path: string;
  readonly title: string;
}

interface Fixture {
  readonly activate: (diagnosis: Diagnosis) => boolean;
  readonly badge: () => string;
  readonly calls: string[];
  readonly friendly: () => { readonly diagnosis?: Diagnosis; readonly title: string };
  readonly read: () => Diagnosis;
  readonly render: () => unknown;
  readonly update: (options: Record<string, unknown>) => void;
}

/** Shares one source-linked target and one reached gate with the presentation factories. */
function createFixture(): Fixture {
  const context: { fixture?: Fixture } = {};
  vm.runInNewContext(
    `
      const calls = [];
      const state = { key: 'page:ResponseBody', candidateId: 'page', rootName: 'RequestPage',
        pageRootCommitted: true, targetMounted: false, targetHasOutput: false,
        targetSourcePath: '/fixture/ResponseBody.tsx', targetExportName: 'ResponseBody', status: 'page-blocked' };
      let candidate = { id: 'page', target: { exportName: 'ResponseBody', sourcePath: '/fixture/ResponseBody.tsx' },
        renderPath: { steps: [{ sourcePath: '/fixture/ResponseBody.tsx', label: 'ResponseBody' }] } };
      let condition = { id: 'responded', reachabilityKey: state.key, reached: true,
        expression: 'hasResponded', effectiveEnabled: false, sourcePath: '/fixture/RequestPage.tsx',
        line: 26, truthyLabel: '<ResponseBody />', falsyLabel: '<RequestBody />' };
      let active = true, blocking = true, observation, execution;
      const previewInspectorSession = { activeTargetReachabilityKey: state.key };
      const findSelectedPreviewInspectorDescriptor = () => ({});
      const readSelectedPreviewInspectorPageCandidate = () => candidate;
      const readSelectedPreviewInspectorPageExecutionCandidate = () => execution;
      const readPreviewInspectorPageExecutionContextObservation = () => observation;
      const readPreviewInspectorRenderScenario = () => 'authored-page';
      const selectPreviewInspectorMainComponent = () => undefined;
      const isPreviewInspectorTargetReachabilityResolving = () => false;
      const readPreviewInspectorActiveBlockerSummary = () => {
        const nodes = active ? [{ id: 'render-condition:responded', blocksCurrentTarget: blocking,
          blockerKind: 'render-condition', condition }] : [];
        return { active: nodes, count: nodes.length, first: nodes[0] };
      };
      const requestPreviewInspectorTreeReveal = id => calls.push('reveal:' + id);
      const selectPreviewInspectorUiNode = node => calls.push('select:' + node.id);
      const revealPreviewInspectorNeuralInferenceEvidence = () => calls.push('path-evidence');
      const PreviewInspectorDevtoolsButton = 'button';
      const React = { createElement: (type, props, ...children) => ({ type, props, children }) };
      ${createPreviewInspectorVisibilityDiagnosisUiRuntimeSource()}
      ${createPreviewInspectorPageCandidateUiRuntimeSource()}
      globalThis.fixture = {
        activate: activatePreviewInspectorVisibilityDiagnosis, calls,
        badge: () => formatPreviewInspectorPageCorridorStatus(state, readPreviewInspectorVisibilityDiagnosis(state)),
        read: () => readPreviewInspectorVisibilityDiagnosis(state),
        friendly: () => readPreviewInspectorFriendlyPageStatus(state),
        render: () => PreviewInspectorVisibilityEvidence({ diagnosis: readPreviewInspectorVisibilityDiagnosis(state), showAction: true }),
        update: options => {
          if (options.state) Object.assign(state, options.state);
          if (options.condition) Object.assign(condition, options.condition);
          if (options.candidate) candidate = options.candidate;
          if (options.observation) observation = options.observation;
          if (options.execution) execution = options.execution;
          if (options.key) previewInspectorSession.activeTargetReachabilityKey = options.key;
          if (typeof options.active === 'boolean') active = options.active;
          if (typeof options.blocking === 'boolean') blocking = options.blocking;
        },
      };
    `,
    context,
  );
  if (context.fixture === undefined) throw new Error('Visibility fixture did not initialize');
  return context.fixture;
}

describe('Inspector visibility diagnosis', () => {
  it('shows an observed condition separately from source-only page proof', () => {
    const fixture = createFixture();
    expect(fixture.read()).toMatchObject({
      kind: 'code-condition',
      action: 'condition',
      branch: '<ResponseBody />',
      location: '/fixture/RequestPage.tsx:26',
      logic: 'hasResponded is OFF; the inferred target branch requires ON.',
      path: 'Source-linked to the target; runtime arrival not verified.',
    });
    expect(fixture.friendly().diagnosis?.kind).toBe('code-condition');
    const text = JSON.stringify(fixture.render());
    expect(text).toContain('Page path: ');
    expect(text).toContain('Render logic: ');
    expect(text).toContain('Inspect blocking condition');
    expect(text).not.toContain('status = pending');
  });

  it('navigates to the exact live condition without changing any application value', () => {
    const fixture = createFixture();
    expect(fixture.activate(fixture.read())).toBe(true);
    expect(fixture.calls).toEqual([
      'reveal:render-condition:responded',
      'select:render-condition:responded',
    ]);
  });

  it.each([
    { condition: { reachabilityKey: 'other:page' } },
    { condition: { reached: false } },
    { condition: { effectiveEnabled: undefined } },
    { blocking: false },
    { active: false },
  ])('does not invent a code cause from unrelated or unobserved evidence: %j', (options) => {
    const fixture = createFixture();
    fixture.update(options);
    expect(fixture.read().kind).toBe('unknown');
    expect(fixture.read().logic).toContain('No blocking condition has been verified');
    expect(fixture.read().description).toContain('cannot distinguish');
  });

  it('does not claim the wrong page was found merely because the target did not mount', () => {
    const fixture = createFixture();
    fixture.update({ active: false, candidate: { id: 'page' } });
    expect(fixture.friendly().title).toBe('Why this file is missing is not yet known');
    expect(fixture.read().path).toContain('Not verified');
    expect(fixture.activate(fixture.read())).toBe(true);
    expect(fixture.calls).toEqual(['path-evidence']);
  });

  it('rejects stale condition navigation after a route change or blocker resolution', () => {
    const fixture = createFixture();
    const diagnosis = fixture.read();
    fixture.update({ active: false });
    expect(fixture.activate(diagnosis)).toBe(false);
    fixture.update({ active: true, key: 'different-page' });
    expect(fixture.activate(diagnosis)).toBe(false);
    expect(fixture.read().kind).toBe('pending');
    expect(fixture.calls).toEqual([]);
  });

  it('does not reuse source proof while another candidate is becoming active', () => {
    const fixture = createFixture();
    fixture.update({ candidate: { id: 'different-page' } });
    expect(fixture.read().kind).toBe('pending');
    expect(fixture.read().description).toContain('earlier path');
  });

  it.each([
    { targetDeferredCallbackPending: true, kind: 'parent-callback' },
    { targetDeferredCallbackPending: false, kind: 'empty-output' },
  ])('distinguishes reached-empty output and an uninvoked callback: %j', (options) => {
    const fixture = createFixture();
    fixture.update({ active: false, state: { targetMounted: true, ...options } });
    expect(fixture.read().kind).toBe(options.kind);
    expect(fixture.read().path).toContain('target boundary was reached');
    expect(fixture.read().action).toBe('details');
  });

  it('identifies a component-only execution as missing page context', () => {
    const fixture = createFixture();
    fixture.update({ active: false, execution: { fidelity: 'target-contextual' } });
    expect(fixture.read()).toMatchObject({ kind: 'page-context', action: 'path' });
    expect(fixture.read().path).toContain('component-level');
    expect(fixture.read().logic).toContain('No blocking condition');
  });

  it('retains missing page context even when a code condition also blocks output', () => {
    const fixture = createFixture();
    fixture.update({ execution: { fidelity: 'target-only' } });
    expect(fixture.read().kind).toBe('code-condition');
    expect(fixture.read().path).toContain('Only a component-level context');
  });

  it('keeps incomplete candidate metadata unverified instead of crashing the Inspector', () => {
    const fixture = createFixture();
    fixture.update({
      active: false,
      candidate: {
        id: 'page',
        target: { exportName: 'ResponseBody', sourcePath: '/fixture/ResponseBody.tsx' },
        renderPath: { steps: {} },
        edges: null,
      },
    });
    expect(fixture.read().kind).toBe('unknown');
    expect(fixture.read().path).toContain('Not verified');
  });

  it('distinguishes real target output from a verified full page context', () => {
    const fixture = createFixture();
    fixture.update({
      active: false,
      state: { targetMounted: true, targetHasOutput: true },
      observation: { contextComplete: false, componentOnly: true },
    });
    expect(fixture.read().kind).toBe('page-context');
    expect(fixture.badge()).toBe('PAGE CONTEXT UNVERIFIED');
    fixture.update({ observation: { contextComplete: true } });
    expect(fixture.read().kind).toBe('visible');
    expect(fixture.read().path).toContain('verified at runtime');
  });

  it('keeps a recorded runtime error distinct from route inference', () => {
    const fixture = createFixture();
    fixture.update({ state: { targetOutputKind: 'fallback-output' } });
    expect(fixture.read()).toMatchObject({ kind: 'render-error', action: 'details' });
  });

  it('does not diagnose a loading or deliberately detached view as the wrong path', () => {
    const fixture = createFixture();
    fixture.update({ state: { pageRootCommitted: false } });
    expect(fixture.read()).toMatchObject({ kind: 'pending', action: undefined });
    fixture.update({ state: { directTarget: true } });
    expect(fixture.read()).toMatchObject({ kind: 'diagnostic', action: undefined });
  });

  it('bounds long source evidence and does not coerce arbitrary condition objects', () => {
    const fixture = createFixture();
    fixture.update({
      condition: { sourcePath: '한글'.repeat(500), truthyLabel: 'Body'.repeat(500) },
    });
    expect(fixture.read().location?.length).toBeLessThan(250);
    expect(fixture.read().branch?.length).toBeLessThan(250);
    fixture.update({
      condition: {
        expression: {
          toString: () => {
            throw new Error('Do not execute');
          },
        },
      },
    });
    expect(fixture.read().logic).toContain('Observed condition');
  });
});
