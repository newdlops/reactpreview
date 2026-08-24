/** Verifies the toolbar status contract without mounting application or Inspector DOM. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralLearningUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralLearningUiRuntimeSource';

interface TestElement {
  readonly children: readonly unknown[];
  readonly props: Record<string, unknown>;
  readonly type: string;
}

/** Renders the presentation-only component through a minimal React element factory. */
function renderLearningStatus(status: unknown, reachability?: unknown): TestElement | null {
  const sandbox: {
    __result?: TestElement | null;
    reachability: unknown;
    status: unknown;
  } = { reachability, status };
  vm.runInNewContext(
    `
      const React = {
        createElement: (type, props, ...children) => ({ children, props: props ?? {}, type }),
      };
      const readPreviewInspectorNeuralLearningStatus = () => status;
      const readPreviewInspectorNeuralAssistanceReachability = () => reachability;
      ${createPreviewInspectorNeuralLearningUiRuntimeSource()}
      globalThis.__result = PreviewInspectorNeuralLearningStatus();
    `,
    sandbox,
  );
  return sandbox.__result ?? null;
}

/** Renders the user request control while retaining its click callback for interaction checks. */
function renderNeuralRequestButton(availability: unknown): {
  readonly element: TestElement;
  readonly requests: () => number;
} {
  const sandbox: {
    __result?: TestElement;
    __requests?: () => number;
    availability: unknown;
  } = { availability };
  vm.runInNewContext(
    `
      let requestCount = 0;
      const React = {
        createElement: (type, props, ...children) => ({ children, props: props ?? {}, type }),
      };
      const PreviewInspectorDevtoolsButton = 'button';
      const readPreviewInspectorNeuralAssistanceAvailability = () => availability;
      const activatePreviewInspectorNeuralAssistance = () => { requestCount += 1; };
      ${createPreviewInspectorNeuralLearningUiRuntimeSource()}
      globalThis.__result = PreviewInspectorNeuralRequestButton();
      globalThis.__requests = () => requestCount;
    `,
    sandbox,
  );
  if (sandbox.__result === undefined || sandbox.__requests === undefined) {
    throw new Error('Neural request button fixture did not initialize.');
  }
  return { element: sandbox.__result, requests: sandbox.__requests };
}

/** Finds every matching host element, including children returned from mapped arrays. */
function findElements(root: unknown, type: string, found: TestElement[] = []): TestElement[] {
  if (root === null || typeof root !== 'object') return found;
  if (Array.isArray(root)) {
    for (const child of root) findElements(child, type, found);
    return found;
  }
  const element = root as TestElement;
  if (element.type === type) found.push(element);
  for (const child of element.children) findElements(child, type, found);
  return found;
}

/** Renders the inline handoff and retains exact candidate/detail callbacks for interaction checks. */
function renderNeuralChoiceList(
  choice: unknown,
  applyResult = true,
  derivation?: unknown,
): {
  readonly applies: () => readonly unknown[];
  readonly element: TestElement | null;
  readonly render: () => TestElement | null;
  readonly reveals: () => number;
} {
  const sandbox: {
    __applies?: () => readonly unknown[];
    __render?: () => TestElement | null;
    __result?: TestElement | null;
    __reveals?: () => number;
    applyResult: boolean;
    choice: unknown;
    derivation: unknown;
  } = { applyResult, choice, derivation };
  vm.runInNewContext(
    `
      const applied = [];
      const hookState = [];
      let hookIndex = 0;
      let revealCount = 0;
      const React = {
        createElement: (type, props, ...children) => ({ children, props: props ?? {}, type }),
        useEffect: () => undefined,
        useState: (initial) => {
          const index = hookIndex;
          hookIndex += 1;
          if (!Object.prototype.hasOwnProperty.call(hookState, index)) {
            hookState[index] = typeof initial === 'function' ? initial() : initial;
          }
          return [hookState[index], (next) => {
            hookState[index] = typeof next === 'function' ? next(hookState[index]) : next;
          }];
        },
      };
      const PreviewInspectorDevtoolsButton = 'detail-button';
      const readPreviewInspectorNeuralUserChoices = () =>
        Array.isArray(choice) ? choice : choice === undefined ? [] : [choice];
      const readPreviewInspectorNeuralUserChoice = () =>
        readPreviewInspectorNeuralUserChoices()[0];
      const readPreviewInspectorNeuralDerivedChoicePaths = () => derivation;
      const applyPreviewInspectorNeuralUserChoices = (_choice, selectedIndexes) => {
        applied.push({ ...selectedIndexes });
        return applyResult;
      };
      const revealPreviewInspectorNeuralUserChoice = () => {
        revealCount += 1;
        return true;
      };
      ${createPreviewInspectorNeuralLearningUiRuntimeSource()}
      const render = () => {
        hookIndex = 0;
        return PreviewInspectorNeuralChoiceList();
      };
      globalThis.__result = render();
      globalThis.__applies = () => applied;
      globalThis.__render = render;
      globalThis.__reveals = () => revealCount;
    `,
    sandbox,
  );
  if (
    sandbox.__applies === undefined ||
    sandbox.__render === undefined ||
    sandbox.__reveals === undefined
  ) {
    throw new Error('Neural choice list fixture did not initialize.');
  }
  return {
    applies: sandbox.__applies,
    element: sandbox.__result ?? null,
    render: sandbox.__render,
    reveals: sandbox.__reveals,
  };
}

describe('Preview Inspector neural learning UI runtime source', () => {
  it('announces active local learning accessibly', () => {
    const element = renderLearningStatus({ phase: 'learning', updates: 2 });

    expect(element?.props).toMatchObject({
      'aria-atomic': 'true',
      'aria-live': 'polite',
      'data-phase': 'learning',
      role: 'status',
    });
    expect((element?.children[1] as TestElement).children).toEqual(['Neural learning…']);
  });

  it('shows the verified update total and stays absent before any learning', () => {
    const learned = renderLearningStatus({ phase: 'learned', updates: 6 });

    expect((learned?.children[1] as TestElement).children).toEqual(['Neural learned · 6']);
    expect(renderLearningStatus(undefined)).toBeNull();
  });

  it('distinguishes an explicit model request from background learning', () => {
    const applying = renderLearningStatus({ phase: 'applying', updates: 6 });
    const finiteChoice = renderLearningStatus({
      choiceAttempt: 2,
      choiceCount: 3,
      phase: 'applying',
      updates: 6,
    });
    const applied = renderLearningStatus({ phase: 'applied', updates: 6 });

    expect((applying?.children[1] as TestElement).children).toEqual(['Neural testing one path…']);
    expect(applying?.props.title).toBe(
      'The local neural model is keeping one admitted path fixed while the verifier checks it.',
    );
    expect((finiteChoice?.children[1] as TestElement).children).toEqual(['Testing choice 2 of 3…']);
    expect(finiteChoice?.props.title).toBe(
      'The viewer is testing source-proven choice 2 of 3 and will keep it only if the selected file renders.',
    );
    expect((applied?.children[1] as TestElement).children).toEqual(['Neural applied · 6']);
  });

  it('shows exhaustive success collection and best-path restoration without warning symbols', () => {
    const verifying = renderLearningStatus(
      { collecting: true, phase: 'applying', updates: 6, verifying: true },
      { status: 'reached', targetHasOutput: true },
    );
    const collecting = renderLearningStatus(
      { collecting: true, phase: 'applying', successCount: 3, updates: 6 },
      { status: 'reached', targetHasOutput: true },
    );
    const restoring = renderLearningStatus({
      phase: 'applying',
      restoring: true,
      successCount: 3,
      updates: 6,
    });
    const applied = renderLearningStatus({ phase: 'applied', successCount: 3, updates: 6 });

    expect(verifying?.props['data-phase']).toBe('applying');
    expect((verifying?.children[1] as TestElement).children).toEqual(['Verifying output…']);
    expect(verifying?.props.title).toBe(
      'Visible target output is being checked across delayed observations before this path is learned or saved.',
    );
    expect(collecting?.props['data-phase']).toBe('applying');
    expect((collecting?.children[0] as TestElement).children).toEqual(['']);
    expect((collecting?.children[1] as TestElement).children).toEqual([
      'Collecting paths · 3 verified',
    ]);
    expect((restoring?.children[1] as TestElement).children).toEqual(['Restoring best path…']);
    expect((applied?.children[1] as TestElement).children).toEqual([
      'Neural applied · 6 · 3 paths',
    ]);
    expect(JSON.stringify([verifying, collecting, restoring])).not.toMatch(/[?↻!]/u);
  });

  it('replaces a stale applying message with success once the target is rendered', () => {
    const rendered = renderLearningStatus(
      { phase: 'applying', updates: 6 },
      { status: 'reached', targetHasOutput: true },
    );
    const staleChoice = renderLearningStatus(
      { phase: 'needs-choice', updates: 6 },
      { status: 'reached', targetHasOutput: true },
    );

    expect(rendered?.props['data-phase']).toBe('applied');
    expect((rendered?.children[1] as TestElement).children).toEqual(['Neural applied · 6']);
    expect(staleChoice?.props['data-phase']).toBe('applied');
    expect((staleChoice?.children[0] as TestElement).children).toEqual(['✓']);
  });

  it('exposes one accessible request action and locks it while inference is pending', () => {
    const ready = renderNeuralRequestButton({
      actionable: true,
      pending: false,
      title: 'Apply the latest local model.',
    });

    expect(ready.element.children).toEqual(['Resolve blockers']);
    expect(ready.element.props).toMatchObject({
      busy: false,
      disabled: false,
      title: 'Apply the latest local model.',
    });
    (ready.element.props.onClick as () => void)();
    expect(ready.requests()).toBe(1);

    const pending = renderNeuralRequestButton({
      actionable: false,
      pending: true,
      title: 'The local neural model is re-evaluating this preview.',
    });
    expect(pending.element.children).toEqual(['Testing one path…']);
    expect(pending.element.props).toMatchObject({ busy: true, disabled: true });

    const finiteChoicePending = renderNeuralRequestButton({
      actionable: false,
      choiceAttempt: 2,
      choiceCount: 3,
      pending: true,
      title: 'Testing the next source-proven choice.',
    });
    expect(finiteChoicePending.element.children).toEqual(['Testing choice 2 of 3…']);

    const resolved = renderNeuralRequestButton({
      actionable: false,
      mode: 'none',
      pending: false,
      rendered: true,
      title: 'This preview is already rendered.',
    });
    expect(resolved.element.children).toEqual(['Page resolved']);
    expect(resolved.element.props).toMatchObject({ disabled: true });
  });

  it('uses calm success and explicit choice symbols instead of a generic exclamation mark', () => {
    const checked = renderLearningStatus({ phase: 'unchanged', updates: 6 });
    const choice = renderLearningStatus({ phase: 'needs-choice', updates: 6 });
    const paused = renderLearningStatus({ phase: 'paused', updates: 6 });

    expect((checked?.children[0] as TestElement).children).toEqual(['✓']);
    expect((checked?.children[1] as TestElement).children).toEqual(['Neural checked · 6']);
    expect((choice?.children[0] as TestElement).children).toEqual(['?']);
    expect((choice?.children[1] as TestElement).children).toEqual(['Your choice is needed']);
    expect((paused?.children[0] as TestElement).children).toEqual(['×']);
    expect(JSON.stringify([checked, choice, paused])).not.toContain('!');
  });

  it('presents a bounded renderer yield as resumable rather than as an error', () => {
    const yielded = renderLearningStatus({
      labelReason: 'renderer-work-budget',
      phase: 'yielded',
      updates: 6,
    });

    expect(yielded?.props).toMatchObject({
      'data-phase': 'yielded',
      role: 'status',
    });
    expect((yielded?.children[0] as TestElement).children).toEqual(['Ⅱ']);
    expect((yielded?.children[1] as TestElement).children).toEqual(['Neural yielded · Continue']);
    expect(yielded?.props.title).toContain('other preview tabs responsive');
    expect(JSON.stringify(yielded)).not.toMatch(/[×?!↻]/u);
  });

  it('turns the neural action into a clear choice handoff when automation is exhausted', () => {
    const choice = renderNeuralRequestButton({
      actionable: true,
      mode: 'choice',
      pending: false,
      title: 'Choose a source-proven value for taxType.',
    });

    expect(choice.element.children).toEqual(['Review choice']);
    expect(choice.element.props).toMatchObject({ disabled: false });
    (choice.element.props.onClick as () => void)();
    expect(choice.requests()).toBe(1);
  });

  it('shows every source-proven candidate in path groups and applies the exact typed index', () => {
    const longValue = 'enterprise_tax_with_a_deliberately_long_authored_branch_name';
    const fixture = renderNeuralChoiceList({
      choiceKind: 'source-proven-prop',
      choiceRecords: [
        {
          candidates: ['heavy_tax', 'normal_tax', longValue],
          currentValue: 'taxType',
          path: 'taxType',
        },
        {
          candidates: [true, false],
          currentValue: undefined,
          path: 'options.compact',
        },
      ],
      exportName: 'TaxTypeBadge',
    });

    expect(fixture.element?.type).toBe('fieldset');
    expect(fixture.element?.props).toMatchObject({
      'aria-label': 'Choices required to continue the preview',
      'data-choice-count': '2',
    });
    const scrollRegion = findElements(fixture.element, 'div').find(
      (element) => element.props.className === 'rpi-neural-choice-scroll',
    );
    expect(scrollRegion?.props).toMatchObject({
      'aria-label': 'Scrollable source-proven choices',
      role: 'region',
      tabIndex: 0,
    });
    const groups = findElements(fixture.element, 'ul');
    expect(groups.map((group) => group.props['aria-label'])).toEqual([
      'Available values for taxType',
      'Available values for options.compact',
    ]);
    const buttons = findElements(fixture.element, 'button');
    expect(buttons.map((button) => button.children[0])).toEqual([
      'heavy_tax',
      'normal_tax',
      longValue,
      'true',
      'false',
    ]);
    expect(buttons.every((button) => button.props.type === 'button')).toBe(true);
    expect(buttons[2]?.props.title).toContain(longValue);

    (buttons[1]?.props.onClick as () => void)();
    let rerendered = fixture.render();
    const secondPassButtons = findElements(rerendered, 'button');
    (secondPassButtons[4]?.props.onClick as () => void)();
    rerendered = fixture.render();
    const actions = findElements(rerendered, 'detail-button');
    const applyButton = actions.find((button) => button.children[0] === 'Apply choices');
    expect(applyButton?.props.disabled).toBe(false);
    (applyButton?.props.onClick as () => void)();
    expect(fixture.applies()).toEqual([{ 'options.compact': 1, taxType: 1 }]);
  });

  it('lists independent page, branch, and data decisions as separate refresh-safe groups', () => {
    const fixture = renderNeuralChoiceList([
      {
        choiceKind: 'render-condition',
        choiceRecords: [
          {
            candidates: [
              {
                actionKind: 'page-control',
                description:
                  'Activate this page option. The viewer will bring it into view if needed.',
                id: 'company',
                label: '기업 등록',
              },
              {
                actionKind: 'page-control',
                description:
                  'Activate this page option. The viewer will bring it into view if needed.',
                id: 'investor',
                label: 'VC/AC/신기사 등록',
              },
            ],
            kind: 'page-control',
            path: 'Page options',
          },
        ],
        id: 'render-condition:target',
        title: 'Choose from 2 page option(s).',
      },
      {
        choiceKind: 'data-request',
        choiceRecords: [
          {
            candidates: [
              { actionKind: 'data-smart', id: 'smart', label: 'Smart fill minimum' },
              { actionKind: 'data-auto', id: 'auto', label: 'Use Auto' },
            ],
            path: 'Investor feed',
          },
        ],
        id: 'data-request:feed',
        title: 'Choose a local payload strategy for this request.',
      },
    ]);

    expect(fixture.element?.props['data-choice-count']).toBe('2');
    expect(findElements(fixture.element, 'article')).toHaveLength(2);
    const choiceButtons = findElements(fixture.element, 'button');
    expect(choiceButtons.map((button) => button.children[0])).toEqual([
      '기업 등록',
      'VC/AC/신기사 등록',
      'Smart fill minimum',
      'Use Auto',
    ]);
    expect(
      findElements(fixture.element, 'span').some(
        (element) =>
          element.children[0] ===
          'These controls were discovered in the rendered page, including options below the viewport.',
      ),
    ).toBe(true);
    (choiceButtons[1]?.props.onClick as () => void)();
    const selected = fixture.render();
    expect(
      findElements(selected, 'span').some(
        (element) => element.children[0] === 'Selected: VC/AC/신기사 등록',
      ),
    ).toBe(true);
  });

  it('shows every finite path and maps the neural suggestion back to current controls', () => {
    const choices = [
      {
        choiceKind: 'render-condition',
        choiceRecords: [
          {
            candidates: [
              { id: 'company', label: '기업 등록' },
              { id: 'investor', label: 'VC/AC/신기사 등록' },
            ],
            path: 'Page options',
          },
        ],
        id: 'render-condition:target',
      },
      {
        choiceKind: 'data-request',
        choiceRecords: [
          {
            candidates: [
              { id: 'smart', label: 'Smart fill minimum' },
              { id: 'auto', label: 'Use Auto' },
            ],
            path: 'Investor feed',
          },
        ],
        id: 'data-request:feed',
      },
    ];
    const recommendedPath = {
      id: 'investor-smart',
      label: 'VC/AC/신기사 등록 → Smart fill minimum',
      steps: [
        {
          candidateIndex: 1,
          choiceId: 'render-condition:target',
          choiceIndex: 0,
          current: true,
          path: 'Page options',
        },
        {
          candidateIndex: 0,
          choiceId: 'data-request:feed',
          choiceIndex: 1,
          current: true,
          path: 'Investor feed',
        },
      ],
    };
    const fixture = renderNeuralChoiceList(choices, true, {
      completedPaths: [{ id: 'verified', label: '기업 등록 → Use Auto' }],
      cycle: { label: '기업 등록 → 뒤로 → 기업 등록' },
      paths: [
        recommendedPath,
        {
          id: 'company-auto',
          label: '기업 등록 → Use Auto',
          steps: [
            {
              candidateIndex: 0,
              choiceId: 'render-condition:target',
              choiceIndex: 0,
              current: true,
              path: 'Page options',
            },
            {
              candidateIndex: 1,
              choiceId: 'data-request:feed',
              choiceIndex: 1,
              current: true,
              path: 'Investor feed',
            },
          ],
        },
      ],
      recommendedPath,
      stateCount: 3,
      truncated: false,
    });

    const pathSummary = findElements(fixture.element, 'section').find(
      (element) => element.props.className === 'rpi-neural-choice-paths',
    );
    expect(pathSummary?.props).toMatchObject({
      'aria-label': 'Derived page choice paths',
      'data-path-count': '2',
    });
    expect(JSON.stringify(pathSummary)).toContain('Derived paths · 2');
    expect(JSON.stringify(pathSummary)).toContain('Finite graph · 3 states');
    expect(JSON.stringify(pathSummary)).toContain('Cycle closed · 기업 등록 → 뒤로 → 기업 등록');
    expect(JSON.stringify(pathSummary)).toContain('Stable target paths · 1');
    expect(JSON.stringify(pathSummary)).toContain('Untested');
    expect(findElements(pathSummary, 'li')).toHaveLength(2);

    const pathButtons = findElements(pathSummary, 'detail-button');
    const suggestionButton = pathButtons.find(
      (button) => button.children[0] === 'Select suggestion',
    );
    const applySuggestionButton = pathButtons.find(
      (button) => button.children[0] === 'Apply suggestion',
    );
    expect(applySuggestionButton?.props.disabled).toBe(false);
    (applySuggestionButton?.props.onClick as () => void)();
    expect(fixture.applies()).toEqual([{ 'Page options': 1 }, { 'Investor feed': 0 }]);

    (suggestionButton?.props.onClick as () => void)();
    let rerendered = fixture.render();
    let selectedLabels = findElements(rerendered, 'span')
      .map((element) => element.children[0])
      .filter((label) => typeof label === 'string' && label.startsWith('Selected:'));
    expect(selectedLabels).toEqual(['Selected: VC/AC/신기사 등록', 'Selected: Smart fill minimum']);

    const rerenderedSummary = findElements(rerendered, 'section').find(
      (element) => element.props.className === 'rpi-neural-choice-paths',
    );
    const alternativeItem = findElements(rerenderedSummary, 'li')[1];
    const alternativeButtons = findElements(alternativeItem, 'detail-button');
    const alternativeSelect = alternativeButtons.find((button) => button.children[0] === 'Select');
    const alternativeApply = alternativeButtons.find((button) => button.children[0] === 'Apply');
    (alternativeSelect?.props.onClick as () => void)();
    rerendered = fixture.render();
    selectedLabels = findElements(rerendered, 'span')
      .map((element) => element.children[0])
      .filter((label) => typeof label === 'string' && label.startsWith('Selected:'));
    expect(selectedLabels).toEqual(['Selected: 기업 등록', 'Selected: Use Auto']);
    const selectedSummary = findElements(rerendered, 'section').find(
      (element) => element.props.className === 'rpi-neural-choice-paths',
    );
    expect(findElements(selectedSummary, 'li')[1]?.props['data-selected']).toBe('true');
    const applySelected = findElements(selectedSummary, 'detail-button').find(
      (button) => button.children[0] === 'Apply selected',
    );
    (applySelected?.props.onClick as () => void)();

    (alternativeApply?.props.onClick as () => void)();
    expect(fixture.applies()).toEqual([
      { 'Page options': 1 },
      { 'Investor feed': 0 },
      { 'Page options': 0 },
      { 'Investor feed': 1 },
      { 'Page options': 0 },
      { 'Investor feed': 1 },
    ]);
  });

  it('keeps a directly applied path selected and reports a stale-page failure inline', () => {
    const choice = {
      choiceKind: 'source-proven-prop',
      choiceRecords: [{ candidates: ['grid', 'list'], path: 'mode' }],
      id: 'source-proven-prop:panel',
    };
    const path = {
      id: 'list-path',
      label: 'list',
      steps: [
        {
          candidateIndex: 1,
          choiceId: 'source-proven-prop:panel',
          choiceIndex: 0,
          current: true,
          path: 'mode',
        },
      ],
    };
    const fixture = renderNeuralChoiceList(choice, false, {
      paths: [path],
      recommendedPath: path,
      stateCount: 1,
    });
    const applySuggestion = findElements(fixture.element, 'detail-button').find(
      (button) => button.children[0] === 'Apply suggestion',
    );

    (applySuggestion?.props.onClick as () => void)();
    const rerendered = fixture.render();
    const alert = findElements(rerendered, 'div').find(
      (element) => element.props.className === 'rpi-error rpi-neural-choice-path-error',
    );
    expect(alert?.props.role).toBe('alert');
    expect(alert?.children).toEqual([
      'The path could not be applied. The page may have changed; choose a refreshed path or open details.',
    ]);
    expect(
      findElements(rerendered, 'span').some((element) => element.children[0] === 'Selected: list'),
    ).toBe(true);
  });

  it('stays absent without concrete candidates and keeps full blocker details reachable', () => {
    expect(renderNeuralChoiceList(undefined).element).toBeNull();
    expect(renderNeuralChoiceList({ choiceKind: 'runtime-fallback' }).element).toBeNull();
    expect(
      renderNeuralChoiceList({
        choiceKind: 'target-reachability',
        choiceRecords: [],
        surface: 'page-context',
      }).element,
    ).toBeNull();

    const fixture = renderNeuralChoiceList({
      choiceKind: 'source-proven-prop',
      choiceRecords: [{ candidates: ['a', 'b'], path: 'mode' }],
    });
    const detailButtons = findElements(fixture.element, 'detail-button');
    const detailButton = detailButtons.find((button) => button.children[0] === 'Open details');
    const applyButton = detailButtons.find((button) => button.children[0] === 'Apply choice');
    expect(detailButton?.children).toEqual(['Open details']);
    expect(applyButton?.props.disabled).toBe(true);
    (detailButton?.props.onClick as () => void)();
    expect(fixture.reveals()).toBe(1);
  });

  it('explains that automatic finite exploration is exhausted before asking for a value', () => {
    const fixture = renderNeuralChoiceList({
      automaticAttemptCount: 3,
      automaticCandidateCount: 3,
      choiceKind: 'source-proven-prop',
      choiceRecords: [{ candidates: ['a', 'b', 'c'], path: 'mode' }],
    });
    const intro = findElements(fixture.element, 'div').find(
      (element) => element.props.className === 'rpi-neural-choice-intro',
    );

    expect(intro?.children).toEqual([
      'The viewer tested all 3 source-proven values. Choose the value to keep or open details.',
    ]);
  });

  it('reports an apply failure without discarding the user selection', () => {
    const fixture = renderNeuralChoiceList(
      {
        choiceKind: 'source-proven-prop',
        choiceRecords: [{ candidates: ['grid', 'list'], path: 'mode' }],
      },
      false,
    );
    const candidate = findElements(fixture.element, 'button')[1];
    (candidate?.props.onClick as () => void)();
    let rerendered = fixture.render();
    const applyButton = findElements(rerendered, 'detail-button').find(
      (button) => button.children[0] === 'Apply choice',
    );
    (applyButton?.props.onClick as () => void)();
    rerendered = fixture.render();

    const alert = findElements(rerendered, 'div').find((element) => element.props.role === 'alert');
    expect(alert?.children).toEqual([
      'The selected option could not be applied. The page may have changed; review the refreshed list or open details.',
    ]);
    const selected = findElements(rerendered, 'button')[1];
    expect(selected?.props['aria-pressed']).toBe(true);
  });
});
