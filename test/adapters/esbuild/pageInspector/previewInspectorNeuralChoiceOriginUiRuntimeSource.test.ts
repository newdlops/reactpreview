/** Verifies option provenance without mistaking source literals or Inspector actions for page UI. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralChoiceOriginUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralChoiceOriginUiRuntimeSource';
import { createPreviewInspectorNeuralLearningUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralLearningUiRuntimeSource';

interface Element {
  /** Original host tag; presentation functions are not executed by this element factory. */
  readonly type: string;
  /** Host properties and exact retained callbacks. */
  readonly props: Record<string, unknown>;
  /** Text and nested element children. */
  readonly children: readonly unknown[];
}

/** Runs only the read-only provenance helper against supplied choice contracts. */
function readOrigin(
  choice: unknown,
  record: unknown,
  candidate: unknown,
): {
  readonly detail: string;
  readonly label: string;
} {
  const context = { choice, record, candidate, result: { detail: '', label: '' } };
  vm.runInNewContext(
    `${createPreviewInspectorNeuralChoiceOriginUiRuntimeSource()}
    result = readPreviewInspectorNeuralChoiceOrigin(choice, record, candidate);`,
    context,
  );
  return context.result;
}

/** Reads current evidence separately, without applying the offered option. */
function readCurrent(choice: unknown, record: unknown, candidate: unknown): string {
  const context = { choice, record, candidate, result: '' };
  vm.runInNewContext(
    `${createPreviewInspectorNeuralChoiceOriginUiRuntimeSource()}
    result = readPreviewInspectorNeuralChoiceCurrentLabel(choice, record, candidate);`,
    context,
  );
  return context.result;
}

/** Finds all rendered host elements through arrays without coercing their text. */
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (value === null || typeof value !== 'object') return [];
  const node = value as Element;
  return [node, ...node.children.flatMap(elements)];
}

/** Keeps local selection state while the production list reads unchanged observed values. */
function createListFixture(choice: unknown): {
  readonly applied: () => number;
  readonly render: () => Element;
} {
  const context: { choice: unknown; fixture?: { applied: () => number; render: () => Element } } = {
    choice,
  };
  vm.runInNewContext(
    `
      const states = []; let index = 0, applied = 0;
      const React = {
        createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
        useEffect: () => undefined,
        useState: initial => {
          const key = index++;
          if (!(key in states)) states[key] = typeof initial === 'function' ? initial() : initial;
          return [states[key], next => { states[key] = typeof next === 'function' ? next(states[key]) : next; }];
        },
      };
      const PreviewInspectorDevtoolsButton = 'button';
      const readPreviewInspectorNeuralUserChoices = () => [choice];
      const applyPreviewInspectorNeuralUserChoices = () => { applied++; return true; };
      const revealPreviewInspectorNeuralUserChoice = () => true;
      ${createPreviewInspectorNeuralLearningUiRuntimeSource()}
      fixture = { applied: () => applied, render: () => { index = 0; return PreviewInspectorNeuralChoiceList(); } };
    `,
    context,
  );
  if (context.fixture === undefined) throw new Error('Choice-origin list did not initialize');
  return context.fixture;
}

describe('Inspector choice origins', () => {
  it('labels only a proven page-control contract as an original page option', () => {
    expect(
      readOrigin(
        { choiceKind: 'render-condition' },
        { kind: 'page-control' },
        { actionKind: 'page-control', label: 'Continue' },
      ),
    ).toMatchObject({ label: 'Original page option' });
    expect(
      readOrigin(
        { choiceKind: 'render-condition' },
        { kind: 'page-control' },
        { label: 'Continue' },
      ).label,
    ).toBe('Source unverified');
    expect(
      readOrigin(
        { choiceKind: 'render-condition' },
        { kind: 'branch' },
        { actionKind: 'page-control' },
      ).label,
    ).toBe('Source unverified');
  });

  it.each(['pending', false, 0, null])(
    'labels source value %j without claiming a page control',
    (candidate) => {
      const origin = readOrigin({ choiceKind: 'source-proven-prop' }, {}, candidate);
      expect(origin.label).toBe('Code-defined value');
      expect(origin.detail).toContain('no page control is implied');
    },
  );

  it('distinguishes authored branch code from an Inspector reset action', () => {
    const choice = { choiceKind: 'render-condition' };
    expect(readOrigin(choice, { kind: 'branch' }, { actionKind: 'condition-override' }).label).toBe(
      'Code-defined branch',
    );
    expect(readOrigin(choice, { kind: 'branch' }, { actionKind: 'condition-authored' }).label).toBe(
      'Inspector reset',
    );
  });

  it.each([
    ['runtime-fallback', 'runtime-smart'],
    ['runtime-fallback', 'runtime-auto'],
    ['data-request', 'data-smart'],
    ['data-request', 'data-auto'],
    ['data-request', 'data-lorem'],
  ])('identifies %s / %s as an Inspector recovery strategy', (choiceKind, actionKind) => {
    const origin = readOrigin({ choiceKind }, {}, { actionKind });
    expect(origin.label).toBe('Inspector recovery');
    expect(origin.detail).toContain('not an original page option');
  });

  it.each([
    [undefined, 'Original page option'],
    [{ choiceKind: 'source-proven-prop' }, { label: 'Original page option' }],
    [{ choiceKind: 'source-proven-prop' }, Number.NaN],
    [{ choiceKind: 'runtime-fallback' }, { actionKind: 'page-control' }],
  ])('does not infer provenance from a label or incomplete contract: %j', (choice, candidate) => {
    expect(readOrigin(choice, {}, candidate).label).toBe('Source unverified');
  });

  it('uses observed selection rather than label equality to mark what is active on the page', () => {
    const choice = { choiceKind: 'render-condition' };
    const record = { kind: 'page-control', currentValue: 'Continue' };
    expect(readCurrent(choice, record, { actionKind: 'page-control', label: 'Continue' })).toBe('');
    expect(readCurrent(choice, record, { actionKind: 'page-control', selected: true })).toBe(
      'On page now',
    );
  });

  it('keeps false, zero and unobserved conditions distinct in current-value badges', () => {
    expect(readCurrent({ choiceKind: 'source-proven-prop' }, { currentValue: false }, false)).toBe(
      'In preview now',
    );
    expect(readCurrent({ choiceKind: 'source-proven-prop' }, { currentValue: false }, 0)).toBe('');
    const candidate = { actionKind: 'condition-override', value: false };
    expect(
      readCurrent(
        {
          choiceKind: 'render-condition',
          node: { condition: { reached: false, effectiveEnabled: false } },
        },
        {},
        candidate,
      ),
    ).toBe('');
    expect(
      readCurrent(
        {
          choiceKind: 'render-condition',
          node: { condition: { reached: true, effectiveEnabled: false } },
        },
        {},
        candidate,
      ),
    ).toBe('In preview now');
  });

  it('keeps option origin and observed current value visible after staging another value', () => {
    const fixture = createListFixture({
      id: 'status',
      choiceKind: 'source-proven-prop',
      choiceRecords: [
        { path: 'status', currentValue: 'pending', candidates: ['pending', 'responded'] },
      ],
    });
    let nodes = elements(fixture.render());
    const candidate = nodes.find((node) => node.props['data-choice-index'] === '1');
    expect(candidate?.props['aria-label']).toBe('responded · Code-defined value');
    expect(
      nodes
        .filter((node) => node.props.className === 'rpi-neural-choice-origin')
        .map((node) => node.children[0]),
    ).toEqual(['Origin: Code-defined value', 'Origin: Code-defined value']);
    (candidate?.props.onClick as () => void)();
    nodes = elements(fixture.render());
    expect(nodes.some((node) => node.children[0] === 'Current: pending')).toBe(true);
    expect(nodes.some((node) => node.children[0] === 'Selected: responded')).toBe(true);
    expect(nodes.find((node) => node.props['data-choice-index'] === '0')?.props['aria-label']).toBe(
      'pending · Code-defined value · In preview now',
    );
    expect(fixture.applied()).toBe(0);
    const apply = nodes.find(
      (node) => node.type === 'button' && node.children[0] === 'Apply status',
    );
    expect(apply?.props.disabled).toBe(false);
    (apply?.props.onClick as () => void)();
    expect(fixture.applied()).toBe(1);
  });

  it('keeps page provenance and disabled behavior together without claiming it is a generated option', () => {
    const fixture = createListFixture({
      id: 'page',
      choiceKind: 'render-condition',
      choiceRecords: [
        {
          kind: 'page-control',
          path: 'Page options',
          candidates: [
            {
              id: 'next',
              actionKind: 'page-control',
              label: 'Continue',
              selected: true,
              disabled: true,
            },
          ],
        },
      ],
    });
    const nodes = elements(fixture.render());
    const option = nodes.find((node) => node.props['data-choice-index'] === '0');
    expect(option?.props.disabled).toBe(true);
    expect(option?.props['aria-label']).toBe('Continue · Original page option · On page now');
    expect(JSON.stringify(nodes)).toContain('Origin: Original page option');
  });
});
