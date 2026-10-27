/** Verifies user tab ownership without treating an intentionally hidden target as rendered output. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorPageTabActivationRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageTabActivationRuntimeSource';
import { createPreviewInspectorNeuralAssistanceAutomationRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralAssistanceAutomationRuntimeSource';
import { createPreviewInspectorTargetReachabilityRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetReachabilityRuntimeSource';

/** Models one exact target panel, two sibling tabs, and an independently verified page state. */
const fixture = `
  const targetElement = { closest: () => panel };
  const panel = {
    getAttribute: name => ({ role: 'tabpanel', 'aria-labelledby': 'source' })[name],
    contains: element => element === targetElement,
  };
  const tablist = { isConnected: true, querySelectorAll: () => [sourceTab, nextTab] };
  const createTab = (id, selected) => ({
    id, selected, isConnected: true, disabled: false,
    getAttribute(name) { return ({ role: 'tab', 'aria-selected': String(this.selected), 'aria-controls': 'panel', 'data-rb-event-key': id })[name] ?? null; },
    closest: selector => selector === '[role="tablist"]' ? tablist : null,
  });
  const sourceTab = createTab('source', true), nextTab = createTab('next', false);
  const content = { children: [panel] }; panel.parentElement = content; tablist.nextElementSibling = content;
  const mountNode = { contains: element => element === nextTab || element === sourceTab };
  const document = { getElementById: id => id === 'panel' ? panel : undefined };
  const getComputedStyle = () => ({ display: 'block', visibility: 'visible' });
  const state = {
    key: 'page:Target', neuralStableOutputVerified: true, pageRootCommitted: true,
    targetMounted: true, targetHasOutput: true, targetWasMounted: true,
  };
  const previewInspectorSession = {
    activeTargetReachabilityKey: state.key, targetReachabilityByKey: new Map([[state.key, state]]),
  };
  let targetError = false;
  const event = { type: 'click', isTrusted: true, button: 0, target: { closest: () => nextTab } };
  const selectNext = () => { sourceTab.selected = false; nextTab.selected = true; state.targetMounted = false; state.targetHasOutput = false; };
`;

/** Evaluates bounded generated browser functions against deterministic DOM ownership evidence. */
function run(statements: string, fullRuntime = false): unknown {
  const context: { result?: unknown } = {};
  vm.runInNewContext(
    `${fixture}
     ${fullRuntime ? createPreviewInspectorTargetReachabilityRuntimeSource() : createPreviewInspectorPageTabActivationRuntimeSource()}
     readPreviewInspectorTargetBoundaries = () => new Set([{}]);
     collectPreviewInspectorFiberElements = () => [targetElement];
     hasPreviewInspectorTargetRenderError = () => targetError;
     ${statements}`,
    context,
    { timeout: 2_000 },
  );
  return context.result;
}

describe('verified target page-tab interaction', () => {
  it('yields after a trusted selection while retaining the actual missing-output observation', () => {
    expect(
      run(`
      handlePreviewInspectorPageTabInteraction(event);
      const unchanged = isPreviewInspectorTargetHiddenByPageTabInteraction(state);
      selectNext();
      result = { unchanged, hidden: isPreviewInspectorTargetHiddenByPageTabInteraction(state), output: state.targetHasOutput };
    `),
    ).toEqual({ unchanged: false, hidden: true, output: false });
  });

  it('retains ownership until the source tab returns and releases it for normal verification', () => {
    expect(
      run(`
      handlePreviewInspectorPageTabInteraction(event); selectNext();
      const hidden = isPreviewInspectorTargetHiddenByPageTabInteraction(state);
        sourceTab.selected = true; nextTab.selected = false; state.targetHasOutput = true;
      result = { hidden, restored: isPreviewInspectorTargetHiddenByPageTabInteraction(state), released: state.pageTabInteraction === undefined };
    `),
    ).toEqual({ hidden: true, restored: false, released: true });
  });

  it.each(['ArrowLeft', 'ArrowRight', 'Home', 'End'])(
    'recognizes real %s navigation in the verified target tablist',
    (key) => {
      expect(
        run(`
        event.type = 'keydown'; event.key = ${JSON.stringify(key)};
        handlePreviewInspectorPageTabInteraction(event); selectNext();
        result = isPreviewInspectorTargetHiddenByPageTabInteraction(state);
      `),
      ).toBe(true);
    },
  );

  it.each([
    'event.isTrusted = false;',
    'event.button = 1;',
    'event.ctrlKey = true;',
    'event.defaultPrevented = true;',
    "event.type = 'keydown'; event.key = 'Escape';",
    'state.neuralStableOutputVerified = false;',
    'nextTab.disabled = true;',
    'previewInspectorSession.pickerEnabled = true;',
    'panel.contains = () => false;',
    'tablist.querySelectorAll = () => Array.from({ length: 65 }, () => sourceTab);',
    "panel.getAttribute = () => 'unrelated';",
  ])('does not claim user ownership without complete evidence: %s', (setup) => {
    expect(
      run(`
      ${setup}
      handlePreviewInspectorPageTabInteraction(event); selectNext();
      result = isPreviewInspectorTargetHiddenByPageTabInteraction(state);
    `),
    ).toBe(false);
  });

  it('does not hide target failures or retain detached DOM ownership', () => {
    expect(
      run(`
      handlePreviewInspectorPageTabInteraction(event); selectNext(); targetError = true;
      const failed = isPreviewInspectorTargetHiddenByPageTabInteraction(state);
      targetError = false; tablist.isConnected = false;
      result = { failed, detached: isPreviewInspectorTargetHiddenByPageTabInteraction(state), released: state.pageTabInteraction === undefined };
    `),
    ).toEqual({ failed: false, detached: false, released: true });
  });

  it('keeps separately recorded target errors visible after the panel unmounts', () => {
    expect(
      run(`
      handlePreviewInspectorPageTabInteraction(event); selectNext();
      readPreviewInspectorRuntimeHealthTargetError = () => new Error('late target failure');
      result = isPreviewInspectorTargetHiddenByPageTabInteraction(state);
    `),
    ).toBe(false);
  });

  it.each([true, false])(
    'requires one adjacent visible target panel when IDs are omitted (unique=%s)',
    (unique) => {
      expect(
        run(`
      const read = sourceTab.getAttribute.bind(sourceTab);
      sourceTab.getAttribute = name => name === 'aria-controls' ? null : read(name);
      ${unique ? '' : "content.children.push({ getAttribute: () => 'tabpanel' });"}
      handlePreviewInspectorPageTabInteraction(event); selectNext();
      result = isPreviewInspectorTargetHiddenByPageTabInteraction(state);
    `),
      ).toBe(unique);
    },
  );

  it.each([true, false])(
    'bounds transition reobservation and releases only verified output (returns=%s)',
    (returns) => {
      expect(
        run(`
      const timers = []; let probes = 0;
      globalThis.setTimeout = callback => timers.push(callback);
      state.candidateId = 'candidate';
      findSelectedPreviewInspectorDescriptor = () => ({});
      readSelectedPreviewInspectorPageCandidate = () => ({ id: 'candidate' });
      evaluatePreviewInspectorTargetReachability = () => {
        probes++; state.targetHasOutput = ${JSON.stringify(returns)} && probes >= 3;
        isPreviewInspectorTargetHiddenByPageTabInteraction(state);
      };
      handlePreviewInspectorPageTabInteraction(event); selectNext(); timers.shift()();
      sourceTab.selected = true; nextTab.selected = false;
      event.type = 'keydown'; event.key = 'ArrowLeft';
      handlePreviewInspectorPageTabInteraction(event);
      while (timers.length && probes < 10) timers.shift()();
      result = { probes, pending: timers.length, output: state.targetHasOutput,
        retained: state.pageTabInteraction !== undefined };
    `),
      ).toEqual(
        returns
          ? { probes: 3, pending: 0, output: true, retained: false }
          : { probes: 5, pending: 0, output: false, retained: true },
      );
    },
  );

  it('discards a queued observation when another candidate replaces the target state', () => {
    expect(
      run(`
      const timers = []; let probes = 0;
      globalThis.setTimeout = callback => timers.push(callback);
      evaluatePreviewInspectorTargetReachability = () => { probes++; };
      handlePreviewInspectorPageTabInteraction(event);
      previewInspectorSession.targetReachabilityByKey.set(state.key, {});
      timers.shift()();
      result = probes;
    `),
    ).toBe(0);
  });

  /** A live observer may see the target unmount; that observation must not initiate a branch sweep. */
  it('stops both traversal and automatic learning without manufacturing target success', () => {
    expect(
      run(
        `
      hasMountedPreviewInspectorTarget = () => false;
      hasPreviewInspectorTargetHostOutput = () => false;
      schedulePreviewInspectorTreeRefresh = () => {};
      recordPreviewInspectorNeuralSuccessfulPath = () => { throw new Error('Hidden output is not success'); };
      handlePreviewInspectorPageTabInteraction(event); selectNext();
      evaluatePreviewInspectorTargetReachability({}, {}, state);
      ${createPreviewInspectorNeuralAssistanceAutomationRuntimeSource()}
      isPreviewInspectorNeuralAssistancePaused = () => false;
      readPreviewInspectorNeuralAssistanceReachability = () => state;
      result = { status: state.status, output: state.targetHasOutput,
        automaticWork: readPreviewInspectorAutomaticNeuralAssistanceCorridor() !== undefined };
    `,
        true,
      ),
    ).toEqual({ status: 'target-hidden-by-page-tab', output: false, automaticWork: false });
  });
});
