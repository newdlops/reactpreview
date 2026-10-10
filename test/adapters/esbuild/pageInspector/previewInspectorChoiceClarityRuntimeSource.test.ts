/** Verifies actionable choice guidance and the difference between unexecuted and unapplied states. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralLearningUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralLearningUiRuntimeSource';
import { createPreviewInspectorJsxScenarioUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorJsxScenarioUiRuntimeSource';
import { createPreviewInspectorPageCandidateUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageCandidateUiRuntimeSource';
import { createPreviewInspectorFlowchartInspectorUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorFlowchartInspectorUiRuntimeSource';

interface Element {
  readonly type: string;
  readonly props: Record<string, unknown>;
  readonly children: readonly unknown[];
}

/** Executes only generated Inspector presentation, with no authored expression evaluation. */
function evaluate(
  source: string,
  expression: string,
  bindings: Record<string, unknown> = {},
): unknown {
  const context = {
    ...bindings,
    result: undefined as unknown,
    React: {
      createElement: (
        type: string,
        props: Record<string, unknown> | null | undefined,
        ...children: unknown[]
      ) => ({
        type,
        props: props ?? {},
        children,
      }),
    },
    PreviewInspectorDevtoolsButton: 'button',
  };
  vm.runInNewContext(`${source}\nglobalThis.result = (${expression});`, context);
  return context.result;
}

/** Flattens generated element trees without depending on React internals. */
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (value === null || typeof value !== 'object') return [];
  const element = value as Element;
  return [element, ...element.children.flatMap(elements)];
}

const learningSource = createPreviewInspectorNeuralLearningUiRuntimeSource();
const scenarioSource = createPreviewInspectorJsxScenarioUiRuntimeSource();

describe('Inspector choice clarity', () => {
  it('names the exact source field and owner, and describes the preview-only effect', () => {
    const choice = {
      choiceKind: 'source-proven-prop',
      exportName: 'PaymentPanel',
      choiceRecords: [{ path: 'paymentStatus', candidates: ['paid', 'unpaid'] }],
    };
    expect(
      evaluate(learningSource, 'describePreviewInspectorNeuralChoiceHeading(choice)', { choice }),
    ).toBe('Choose paymentStatus for PaymentPanel');
    expect(
      evaluate(
        learningSource,
        'describePreviewInspectorNeuralChoiceEffect(choice, choice.choiceRecords[0])',
        { choice },
      ),
    ).toContain('Sets paymentStatus in this preview only. Pick a value, then apply it');
    expect(
      evaluate(learningSource, 'formatPreviewInspectorNeuralChoiceApplyLabel(choice, 1)', {
        choice,
      }),
    ).toBe('Apply paymentStatus');
  });

  it.each([
    ['page-control', 'Choose a page action', 'Activates the selected control'],
    ['boolean', 'Choose a branch for ready', 'Changes which authored JSX branch'],
  ])('distinguishes a %s action from a generated value', (kind, heading, effect) => {
    const choice = {
      choiceKind: 'render-condition',
      choiceRecords: [{ kind, path: 'ready', candidates: [true, false] }],
    };
    expect(
      evaluate(learningSource, 'describePreviewInspectorNeuralChoiceHeading(choice)', { choice }),
    ).toBe(heading);
    expect(
      evaluate(
        learningSource,
        'describePreviewInspectorNeuralChoiceEffect(choice, choice.choiceRecords[0])',
        { choice },
      ),
    ).toContain(effect);
  });

  it('keeps page-path navigation visible without inventing inline candidates', () => {
    let revealed: unknown;
    const choice = {
      surface: 'page-context',
      choiceRecords: [],
      title: 'Choose a consuming page for Panel.',
    };
    const result = evaluate(
      learningSource,
      'PreviewInspectorNeuralChoiceHandoff({ choices: [choice], targetRendered: false })',
      {
        choice,
        revealPreviewInspectorNeuralUserChoice: (value: unknown) => {
          revealed = value;
          return true;
        },
      },
    );
    const button = elements(result).find((element) => element.type === 'button');
    expect(button?.children).toEqual(['Open page paths']);
    expect(elements(result).filter((element) => element.type === 'button')).toHaveLength(1);
    (button?.props.onClick as () => void)();
    expect(revealed).toBe(choice);
  });

  it('provides a conditions handoff when a required choice has no surviving candidates', () => {
    let tab: unknown;
    const result = evaluate(
      learningSource,
      'PreviewInspectorNeuralChoiceHandoff({ choices: [], targetRendered: false })',
      {
        readPreviewInspectorNeuralLearningStatus: () => ({ phase: 'needs-choice' }),
        requestPreviewInspectorWorkbenchTab: (value: unknown) => {
          tab = value;
        },
      },
    );
    expect(JSON.stringify(result)).toContain('No selectable value is available here');
    const button = elements(result).find((element) => element.type === 'button');
    expect(button?.children).toEqual(['Inspect conditions']);
    (button?.props.onClick as () => void)();
    expect(tab).toBe('scenarios');
  });

  it.each(['applied', 'learning', 'unchanged'])(
    'does not ask for an absent decision during %s',
    (phase) => {
      expect(
        evaluate(
          learningSource,
          'PreviewInspectorNeuralChoiceHandoff({ choices: [], targetRendered: false })',
          {
            readPreviewInspectorNeuralLearningStatus: () => ({ phase }),
          },
        ),
      ).toBeNull();
    },
  );

  it('does not reintroduce stale choice guidance after the target renders', () => {
    expect(
      evaluate(
        learningSource,
        'PreviewInspectorNeuralChoiceHandoff({ choices: [], targetRendered: true })',
        {
          readPreviewInspectorNeuralLearningStatus: () => ({ phase: 'needs-choice' }),
        },
      ),
    ).toBeNull();
  });

  it('opens both path disclosures before focus and requests the existing companion reveal', () => {
    const events: string[] = [];
    const options = { open: false };
    const control = {
      focus: () => {
        expect(options.open).toBe(true);
        events.push('focus');
      },
    };
    const querySelector = (selector: string): unknown =>
      selector === '.rpi-page-options'
        ? options
        : selector.includes('accordion-toggle')
          ? {
              getAttribute: () => 'false',
              click: () => events.push('open context'),
            }
          : control;
    evaluate(
      createPreviewInspectorPageCandidateUiRuntimeSource(),
      'focusPreviewInspectorPageChoice()',
      {
        document: { querySelector },
        requestAnimationFrame: (callback: () => void) => {
          events.push('frame');
          callback();
        },
        requestPreviewInspectorCompanionContextReveal: (value: string) => events.push(value),
        schedulePreviewInspectorCompanionSnapshot: () => events.push('snapshot'),
      },
    );
    expect(events).toEqual(['open context', 'frame', 'focus', 'neural-inference', 'snapshot']);
  });

  it('explains a flowchart wait as an unresolved predecessor', () => {
    expect(
      evaluate(
        createPreviewInspectorFlowchartInspectorUiRuntimeSource(),
        "formatPreviewInspectorFlowchartInspectorStatus({status:'waiting'})",
      ),
    ).toBe('RESOLVE EARLIER STEP');
  });
});

describe('Inspector condition state clarity', () => {
  it('does not claim an uninstrumented condition has never executed', () => {
    const result = evaluate(
      scenarioSource,
      'PreviewInspectorJsxScenarioRow({ roots: [], scenario: {reached:false}, scenarios: [] })',
      {
        normalizePreviewInspectorUiSource: () => undefined,
        previewInspectorSourceNavigation: {},
        formatPreviewInspectorUiSource: () => '',
      },
    );
    const state = elements(result).find(
      (element) => element.props.className === 'rpi-scenario-state',
    );
    expect(state?.children).toEqual(['Not tracked']);
    expect(JSON.stringify(result)).not.toContain('This condition has not run');
  });
  it.each([
    [{ id: 'child', reached: false }, 'This condition has not run'],
    [{ id: 'child', reached: false, override: true }, 'Saved, not applied yet'],
    [{ id: 'child', reached: false, override: false }, 'Saved, not applied yet'],
    [{ reached: false }, 'No runtime control registered'],
    [{ id: 'child', override: true }, 'Manual override'],
    [{ id: 'child', autoOverride: false }, 'Automatic preview value'],
    [{ id: 'child' }, 'From page code'],
  ])('explains %j from existing runtime state', (scenario, text) => {
    expect(
      evaluate(scenarioSource, 'describePreviewInspectorJsxScenarioMode(scenario)', { scenario }),
    ).toContain(text);
  });

  /** 'tab === "overview"' turned off by a forced members tab used to read "From page code". */
  it('names the automatic branch whose value a condition follows', () => {
    expect(
      evaluate(scenarioSource, 'describePreviewInspectorJsxScenarioMode(scenario)', {
        readPreviewInspectorConditionFixedBy: () => 'tab === "members" ON',
        scenario: { id: 'overview' },
      }),
    ).toBe('Follows tab === "members" ON (same value)');
  });

  it('shows a known OFF parent requirement without treating it as a timer', () => {
    const scenario = {
      id: 'child',
      reached: false,
      lineageParentExpression: 'loading',
      lineageParentRequiredEnabled: false,
    };
    expect(
      evaluate(scenarioSource, 'describePreviewInspectorJsxScenarioMode(scenario)', { scenario }),
    ).toBe(
      'Requires loading OFF. This condition has not run. On/Off also selects its required parent branches.',
    );
  });

  it('names the actual blocked ancestor without guessing its required Boolean value', () => {
    const scenario = {
      id: 'child',
      reached: false,
      override: true,
      lineageBlockedByExpression: 'sessionReady',
    };
    expect(
      evaluate(scenarioSource, 'describePreviewInspectorJsxScenarioMode(scenario)', { scenario }),
    ).toBe('Blocked by sessionReady. Saved, not applied yet. Applies when this condition runs.');
  });

  it.each([true, false])(
    'shows the saved %s value, not a stale effective value, before execution',
    (override) => {
      const scenario = { id: 'child', reached: false, override, effectiveEnabled: !override };
      const result = evaluate(
        scenarioSource,
        'PreviewInspectorJsxScenarioRow({ roots: [], scenario, scenarios: [] })',
        {
          scenario,
          normalizePreviewInspectorUiSource: () => undefined,
          previewInspectorSourceNavigation: {},
          formatPreviewInspectorUiSource: () => '',
        },
      );
      const state = elements(result).find(
        (element) => element.props.className === 'rpi-scenario-state',
      );
      expect(state?.children).toEqual([override ? 'ON selected' : 'OFF selected']);
      const selectedButton = elements(result).find(
        (element) => element.children[0] === (override ? 'On' : 'Off'),
      );
      expect(selectedButton?.props.pressed).toBe(true);
      expect(elements(result)[0]?.props['data-reached']).toBe(false);
      expect(elements(result)[0]?.props['data-pending']).toBe(true);
    },
  );
});
