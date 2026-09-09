/** Verifies that neural proposals use authored page context before generating any combinations. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralChoiceRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralChoiceRuntimeSource';
import { createPreviewInspectorNeuralResidualRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';
import { createPreviewInspectorNeuralLearningUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralLearningUiRuntimeSource';

/** Real proposal, path, and learning code with a small source-authored checkout descriptor. */
function scenario(body: string): unknown {
  return vm.runInNewContext(
    `
    const previewEntryRevision = 7;
    const page = { id: 'checkout', root: { exportName: 'CheckoutPage', sourcePath: '/src/CheckoutPage.tsx' },
      routeLocation: { pathname: '/checkout/review', pattern: '/checkout/review' } };
    const descriptor = { exportName: 'PaymentPanel', sourcePath: '/src/PaymentPanel.tsx', inspector: {
      target: { exportName: 'PaymentPanel', sourcePath: '/src/PaymentPanel.tsx' }, pageCandidates: [page],
    } };
    const state = { key: 'checkout:PaymentPanel', targetHasOutput: false, status: 'page-blocked' };
    const previewInspectorSession = { selectedExportName: 'PaymentPanel', selectedPageCandidateId: page.id,
      activeTargetReachabilityKey: state.key, descriptors: [descriptor] };
    const findSelectedPreviewInspectorDescriptor = () => descriptor;
    const readSelectedPreviewInspectorPageCandidate = () => page;
    const readPreviewInspectorNeuralAssistanceReachability = () => state;
    const schedulePreviewInspectorNeuralAssistanceFrame = () => undefined;
    const recordPreviewInspectorNeuralSuccessfulPath = () => undefined;
    const recordPreviewInspectorRuntimeHealth = () => undefined;
    globalThis.location = { pathname: '/generated/nonce/preview.html' };
    ${createPreviewInspectorNeuralResidualRuntimeSource()}
    ${createPreviewInspectorNeuralChoiceRuntimeSource()}
    ${createPreviewInspectorNeuralLearningUiRuntimeSource()}
    const applies = [], hooks = [];
    let hookIndex = 0;
    const React = {
      createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
      useEffect: () => undefined,
      useState: (initial) => {
        const index = hookIndex++;
        if (!(index in hooks)) hooks[index] = initial;
        return [hooks[index], (next) => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }];
      },
    };
    const PreviewInspectorDevtoolsButton = 'button';
    const applyPreviewInspectorSmartPropChoice = (name, record, value) => {
      applies.push({ name, path: record.path, value }); return { [record.path]: value };
    };
    const render = () => { hookIndex = 0; return PreviewInspectorNeuralChoiceList(); };
    function elements(tree, type) {
      if (Array.isArray(tree)) return tree.flatMap((child) => elements(child, type));
      if (tree === null || typeof tree !== 'object') return [];
      return [...(tree.type === type ? [tree] : []), ...elements(tree.children, type)];
    }
    const nextButton = (tree) => elements(tree, 'button').find((item) => item.props['aria-label']?.startsWith('Apply next step:'));
    function branch(id, wanted = 'truthy', sourcePath = '/src/CheckoutPage.tsx') {
      return { id, choiceKind: 'render-condition', node: {
        blockerKind: 'render-condition', blocksCurrentTarget: true,
        condition: { id, expression: id, sourcePath, ownerName: 'CheckoutPage',
          effectiveEnabled: wanted === 'falsy', targetBranch: wanted },
      }, choiceRecords: [{ path: id, kind: 'branch', candidates: [false, true].map((value) => ({
        id: String(value), label: value ? 'Continue checkout' : 'Show placeholder', value,
        actionKind: 'condition-override', conditionId: id,
      })) }] };
    }
    function props(requiredPaths = ['props.paymentStatus']) {
      return { id: 'error:PaymentPanel', choiceKind: 'source-proven-prop', exportName: 'PaymentPanel', node: {
        blockerKind: 'target-error', blocker: { exportName: 'PaymentPanel', blockedComponentName: 'PaymentPanel',
          sourcePath: '/src/PaymentPanel.tsx', targetPropRequiredPaths: requiredPaths, headline: 'Unreachable' },
      }, choiceRecords: [
        { path: 'paymentStatus', kind: 'string', currentValue: 'invalid', candidates: ['pending', 'paid'] },
        { path: 'theme', kind: 'string', currentValue: 'invalid', candidates: ['light', 'dark'] },
      ] };
    }
    let choices = [branch('canPay')];
    readPreviewInspectorNeuralUserChoices = () => choices;
    const derive = () => readPreviewInspectorNeuralContextualChoicePaths(choices);
    ${body}
  `,
    {},
    { timeout: 10_000 },
  );
}

describe('page-context-conditioned neural choices', () => {
  it('uses the authored route, source owner, target, and blocked expression instead of the webview URL', () => {
    expect(
      scenario(`
      const result = derive();
      const specification = createPreviewInspectorNeuralChoicePathDecision(result.paths[0], result.currentStateId, 0,
        { createDecision: (value) => value });
      ({ route: result.context.route, goal: result.context.goal, label: result.paths[0].label.includes('canPay'),
        reason: result.paths[0].reason.includes('PaymentPanel'),
        modelRoute: specification.texts.includes('/checkout/review'),
        modelExpression: specification.texts.includes('canPay'),
        webviewAddress: JSON.stringify(specification).includes('/generated/nonce') });
    `),
    ).toEqual({
      route: '/checkout/review',
      goal: 'render-target',
      label: true,
      reason: true,
      modelRoute: true,
      modelExpression: true,
      webviewAddress: false,
    });
  });

  it('generates six relevant next steps rather than 64 unrelated Cartesian combinations', () => {
    expect(
      scenario(`
      choices = Array.from({ length: 6 }, (_, index) => branch('gate' + index));
      const result = derive();
      ({ count: result.pathCount, lengths: result.paths.map((path) => path.steps.length),
        values: result.paths.map((path) => path.steps[0].candidateIndex), recommended: result.recommendedPath });
    `),
    ).toEqual({
      count: 6,
      lengths: [1, 1, 1, 1, 1, 1],
      values: [1, 1, 1, 1, 1, 1],
      recommended: undefined,
    });
  });

  it('generates only the compiler-proven falsy continuation without assuming true means progress', () => {
    expect(
      scenario(`
      choices = [branch('isLoading', 'falsy')];
      const result = derive();
      result.paths.map((path) => path.steps[0].candidateIndex);
    `),
    ).toEqual([0]);
  });

  it('leaves unknown and foreign choices editable but does not turn them into proposals', () => {
    expect(
      scenario(`
      choices = [branch('unknown', undefined, '/src/Other.tsx'), branch('unclear')];
      delete choices[1].node.condition.targetBranch;
      const result = derive();
      ({ count: result.pathCount, reason: result.recommendationReason, manual: choices.length });
    `),
    ).toEqual({ count: 0, reason: 'insufficient-page-context', manual: 2 });
  });

  it('uses the failing prop path and leaves unrelated display options out of the proposal', () => {
    expect(
      scenario(`
      choices = [props()];
      const result = derive();
      ({ count: result.pathCount, fields: result.paths.map((path) => path.steps[0].path),
        manualFields: choices[0].choiceRecords.map((record) => record.path) });
    `),
    ).toEqual({
      count: 2,
      fields: ['paymentStatus', 'paymentStatus'],
      manualFields: ['paymentStatus', 'theme'],
    });
  });

  it('does not recommend a cold neutral model even with a uniquely proven next action', () => {
    expect(
      scenario(`
      const result = derive();
      ({ count: result.pathCount, recommended: result.recommendedPath, reason: result.recommendationReason });
    `),
    ).toEqual({ count: 1, recommended: undefined, reason: 'insufficient-evidence' });
  });

  it('keeps failure learning specific to the actual authored page route', () => {
    expect(
      scenario(`
      choices = [props()];
      const first = derive();
      const decision = createPreviewInspectorNeuralChoicePathDecision(first.paths[0], first.currentStateId, 0);
      trainPreviewInspectorNeuralResidualDecision(decision, 0);
      const samePage = derive();
      page.routeLocation = { pathname: '/billing/history', pattern: '/billing/history' };
      const anotherPage = derive();
      const next = createPreviewInspectorNeuralChoicePathDecision(anotherPage.paths[0], anotherPage.currentStateId, 0);
      ({ reordered: samePage.paths[0].steps[0].candidateIndex === 1,
        separated: anotherPage.currentStateId !== first.currentStateId, failures: next.consecutiveFailures });
    `),
    ).toEqual({ reordered: true, separated: true, failures: 0 });
  });

  it('rejects stale proposals before application when the route or current value changes', () => {
    expect(
      scenario(`
      const proposal = derive().paths[0];
      const current = isPreviewInspectorNeuralContextualChoicePathCurrent(proposal, choices);
      choices[0].node.condition.effectiveEnabled = true;
      const changed = isPreviewInspectorNeuralContextualChoicePathCurrent(proposal, choices);
      choices[0].node.condition.effectiveEnabled = false;
      page.routeLocation.pathname = '/another'; page.routeLocation.pattern = '/another';
      ({ current, changed, otherRoute: isPreviewInspectorNeuralContextualChoicePathCurrent(proposal, choices) });
    `),
    ).toEqual({ current: true, changed: false, otherRoute: false });
  });

  it('keeps proposal inference and actual selection learning on the identical feature context', () => {
    expect(
      scenario(`
      choices = [props()];
      const result = derive(), path = result.paths[0];
      const decision = createPreviewInspectorNeuralChoicePathDecision(path, result.currentStateId, 0);
      const plan = readPreviewInspectorNeuralChoicePathApplyPlans(path, choices)[0];
      recordPreviewInspectorNeuralChoicePathSelection(plan.choice,
        readPreviewInspectorNeuralUserChoiceSelections(plan.choice, plan.selectedForApply),
        { pathId: path.id, choices });
      const pending = previewInspectorSession.neuralChoicePathSearch.pending;
      trainPreviewInspectorNeuralChoicePathDecision(pending, 0, 'test-failed-output');
      ({ sameContext: pending.decision.contextKey === decision.contextKey,
        first: derive().paths[0].steps[0].candidateIndex,
        failed: derive().paths.find((item) => item.id === path.id).failureCount });
    `),
    ).toEqual({ sameContext: true, first: 1, failed: 1 });
  });

  it('applies a contextual field through the actual handler without changing sibling options', () => {
    expect(
      scenario(`
      choices = [props()];
      const applied = nextButton(render()).props.onClick();
      ({ applied, applies, siblings: choices[0].choiceRecords.map((record) => record.path) });
    `),
    ).toEqual({
      applied: true,
      applies: [{ name: 'PaymentPanel', path: 'paymentStatus', value: 'pending' }],
      siblings: ['paymentStatus', 'theme'],
    });
  });

  it('rejects a displayed click after the actual page route changes without mutating or training', () => {
    expect(
      scenario(`
      choices = [props()];
      const button = nextButton(render());
      page.routeLocation = { pathname: '/billing/history' };
      const applied = button.props.onClick();
      ({ applied, applies, pending: previewInspectorSession.neuralChoicePathSearch.pending,
        error: JSON.stringify(render()).includes('page context changed') });
    `),
    ).toEqual({ applied: false, applies: [], pending: undefined, error: true });
  });

  it('opens the first manual decision and preserves other fields beside three reasoned possibilities', () => {
    expect(
      scenario(`
      choices = Array.from({ length: 6 }, (_, index) => branch('gate' + index));
      const tree = render();
      const visible = elements(tree, 'ol').find((item) => item.props.className === 'rpi-neural-context-steps');
      ({ visible: visible.children.flat().length,
        manual: elements(tree, 'details').filter((item) => item.children[0].children[0].startsWith('Choose a branch')).length,
        firstVisible: elements(tree, 'article')[0].children[0].children[0].children[0] === 'Choose a branch for gate0',
        open: elements(tree, 'details').filter((item) => item.props.open === true).length,
        options: elements(tree, 'button').filter((item) => item.props['data-choice-path']).length,
        hasReason: JSON.stringify(tree).includes('truthy continuation of gate0'),
        honest: JSON.stringify(tree).includes('No learned recommendation yet') });
    `),
    ).toEqual({
      visible: 3,
      manual: 5,
      firstVisible: true,
      open: 0,
      options: 12,
      hasReason: true,
      honest: true,
    });
  });

  it('refuses stale or disabled candidate identities without dropping the complete-group manual rule', () => {
    expect(
      scenario(`
      choices = [props()];
      const path = derive().paths[0];
      const contextual = readPreviewInspectorNeuralChoicePathApplyPlans(path, choices).length;
      const legacy = readPreviewInspectorNeuralChoicePathApplyPlans({ ...path, contextual: false }, choices).length;
      choices[0].choiceRecords[0].candidates[0] = 'different';
      const stale = readPreviewInspectorNeuralChoicePathApplyPlans(path, choices).length;
      choices = [branch('canPay')];
      const branchPath = derive().paths[0];
      choices[0].choiceRecords[0].candidates[1].disabled = true;
      ({ contextual, legacy, stale, current: isPreviewInspectorNeuralContextualChoicePathCurrent(branchPath, choices),
        disabled: readPreviewInspectorNeuralChoicePathApplyPlans(branchPath, choices).length });
    `),
    ).toEqual({ contextual: 1, legacy: 0, stale: 0, current: false, disabled: 0 });
  });

  it('omits accessors, query values and hash values from bounded page context', () => {
    expect(
      scenario(`
      let accesses = 0;
      Object.defineProperty(page, 'root', { get() { accesses++; throw new Error('do not execute'); } });
      page.routeLocation = { pathname: '/checkout?token=private#secret' };
      const context = readPreviewInspectorNeuralChoicePageContext();
      ({ accesses, route: context.route, rootName: context.rootName, containsPrivate: JSON.stringify(context).includes('private') });
    `),
    ).toEqual({ accesses: 0, route: '/checkout', rootName: '', containsPrivate: false });
  });

  it('uses typed minimum-value and exact authored-state actions only when their source evidence exists', () => {
    expect(
      scenario(`
      const local = branch('open'); local.node.condition.requiresAuthoredState = true;
      local.choiceRecords[0].candidates = [{ id: 'page:open', label: 'Open payment', actionKind: 'page-control' }];
      const data = { id: 'request:order', choiceKind: 'data-request', node: { blocker: {
        sourcePath: '/src/CheckoutPage.tsx', requiredPaths: ['order.items'] } },
        choiceRecords: [{ path: 'data', candidates: [
          { id: 'smart', label: 'Smart', actionKind: 'data-smart' },
          { id: 'lorem', label: 'Lorem', actionKind: 'data-lorem' } ] }] };
      choices = [local, data];
      const linked = derive().paths.map((path) => path.steps[0].candidateId);
      data.node.blocker.requiredPaths = []; local.node.condition.sourcePath = '/foreign.tsx';
      ({ linked, unproven: derive().pathCount });
    `),
    ).toEqual({ linked: ['page:open', 'smart'], unproven: 0 });
  });

  it('does not expand an observed future decision into the next executable proposal', () => {
    expect(
      scenario(`
      const first = derive();
      choices = [branch('anotherGate')];
      const next = derive();
      const search = previewInspectorSession.neuralChoicePathSearch;
      search.edges.set('observed', { fromStateId: first.currentStateId, toStateId: next.currentStateId,
        steps: first.paths[0].steps, targetReady: false });
      choices = [branch('canPay')];
      const result = derive();
      ({ count: result.pathCount, steps: result.paths[0].steps.map((step) => step.path) });
    `),
    ).toEqual({ count: 1, steps: ['canPay'] });
  });

  it('withholds a partial shortlist when the complete source domain exceeds the safe limit', () => {
    expect(
      scenario(`
      choices = Array.from({ length: 13 }, (_, index) => branch('gate' + index));
      const result = derive();
      ({ count: result.pathCount, truncated: result.truncated, manual: choices.length, recommended: result.recommendedPath });
    `),
    ).toEqual({ count: 0, truncated: true, manual: 13, recommended: undefined });
  });

  it('explains missing source evidence even when no concrete action was admitted', () => {
    expect(
      scenario(`
      choices = [{ id: 'empty', choiceKind: 'render-condition', choiceRecords: [] }];
      const result = derive();
      ({ contextual: result.contextual, route: result.context.route, count: result.pathCount,
        explanation: JSON.stringify(render()).includes('No next step has enough page-context evidence') });
    `),
    ).toEqual({ contextual: true, route: '/checkout/review', count: 0, explanation: true });
  });

  it('withdraws an old verified recommendation after a newer failure in the identical context', () => {
    expect(
      scenario(`
      choices = [props()];
      const first = derive(), path = first.paths[0];
      previewInspectorSession.neuralChoicePathSearch.edges.set('verified', {
        fromStateId: first.currentStateId, toStateId: 'target-ready', steps: path.steps, targetReady: true });
      const before = derive();
      const decision = createPreviewInspectorNeuralChoicePathDecision(path, first.currentStateId, 0);
      trainPreviewInspectorNeuralResidualDecision(decision, 0);
      const after = derive();
      ({ previouslyRecommended: before.recommendedPath.id === path.id,
        next: after.paths[0].steps[0].candidateIndex, recommended: after.recommendedPath,
        verified: after.paths.find((item) => item.id === path.id).verified });
    `),
    ).toEqual({ previouslyRecommended: true, next: 1, recommended: undefined, verified: false });
  });

  it('keeps invalid bigint and cyclic current values out of the UI JSON identity', () => {
    expect(
      scenario(`
      choices = [props()]; choices[0].choiceRecords[0].currentValue = 1n;
      const bigint = nextButton(render()) !== undefined;
      const cyclic = {}; cyclic.self = cyclic;
      choices[0].choiceRecords[0].currentValue = cyclic;
      ({ bigint, cyclic: nextButton(render()) !== undefined });
    `),
    ).toEqual({ bigint: true, cyclic: true });
  });
});
