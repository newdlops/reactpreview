/** Verifies evidence-owned badges independently of option origin, manual selection and output success. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralLearningUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralLearningUiRuntimeSource';

interface Element {
  /** Retained host tag or inert presentation function. */
  readonly type: string;
  /** Host attributes and original event handlers. */
  readonly props: Record<string, unknown>;
  /** Nested elements and visible text. */
  readonly children: readonly unknown[];
}

/** Flattens host nodes without executing event handlers or changing state. */
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (value === null || typeof value !== 'object') return [];
  const node = value as Element;
  return [node, ...node.children.flatMap(elements)];
}

/** Runs the real list and marker helpers against independently mutable current choices and ranking. */
function fixture(): {
  readonly evaluate: (code: string) => unknown;
  readonly render: () => Element;
} {
  const choices = [
    {
      id: 'status',
      choiceKind: 'source-proven-prop',
      choiceRecords: [
        { path: 'status', currentValue: 'pending', candidates: ['pending', 'responded'] },
      ],
    },
  ];
  const path = {
    id: 'recommended',
    contextual: true,
    contextStateId: 'current',
    label: 'status: responded',
    steps: [
      {
        current: true,
        choiceId: 'status',
        choiceIndex: 0,
        path: 'status',
        candidateIndex: 1,
        candidateId: 'responded:1',
      },
    ],
  };
  const derivation = {
    contextual: true,
    currentStateId: 'current',
    paths: [path],
    recommendedPath: path,
  };
  const context = vm.createContext({ choices, derivation });
  vm.runInContext(
    `
    const hooks = []; let cursor = 0, applied = 0;
    const React = {
      createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
      useEffect: () => undefined,
      useState: initial => {
        const index = cursor++;
        if (!(index in hooks)) hooks[index] = initial;
        return [hooks[index], next => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }];
      },
    };
    const PreviewInspectorDevtoolsButton = 'button';
    const readPreviewInspectorNeuralUserChoices = () => choices;
    const readPreviewInspectorNeuralContextualChoicePaths = () => derivation;
    const createPreviewInspectorNeuralChoicePathCandidateId = (candidate, index) =>
      candidate !== null && typeof candidate === 'object' ? candidate.id : String(candidate) + ':' + index;
    const applyPreviewInspectorNeuralUserChoices = () => { applied++; return true; };
    const revealPreviewInspectorNeuralUserChoice = () => true;
    ${createPreviewInspectorNeuralLearningUiRuntimeSource()}
  `,
    context,
  );
  return {
    evaluate: (code: string): unknown => vm.runInContext(code, context),
    render: (): Element =>
      vm.runInContext('cursor = 0; PreviewInspectorNeuralChoiceList()', context) as Element,
  };
}

/** Returns concrete candidate containers rather than the recommendation's explanatory path row. */
function options(tree: Element): Element[] {
  return elements(tree)
    .filter((node) => node.props.className === 'rpi-neural-choice-options')
    .flatMap((node) => elements(node.children).filter((child) => child.type === 'li'));
}

describe('neural choice recommendation markers', () => {
  it('highlights the exact recommended value and path while preserving origin and current state', () => {
    const view = fixture();
    const tree = view.render();
    const rows = options(tree);
    expect(rows.map((node) => node.props['data-recommended'])).toEqual(['false', 'true']);
    expect(elements(rows[1]).find((node) => node.type === 'button')?.props).toMatchObject({
      'aria-label': 'responded · Code-defined value · Neural choice recommendation',
      'aria-pressed': false,
    });
    expect(
      elements(tree).filter((node) => node.props.className === 'rpi-neural-choice-badge'),
    ).toHaveLength(2);
    expect(JSON.stringify(tree)).toContain('Current: pending');
    expect(JSON.stringify(tree)).toContain('this output is not yet verified');
    expect(view.evaluate('applied')).toBe(0);
  });

  it('keeps a manually selected alternative separate and never auto-applies the recommendation', () => {
    const view = fixture();
    const first = elements(options(view.render())[0]).find((node) => node.type === 'button');
    (first?.props.onClick as () => void)();
    const tree = view.render();
    const rows = options(tree);
    expect(rows.map((node) => node.props['data-recommended'])).toEqual(['false', 'true']);
    expect(
      rows.map(
        (node) => elements(node).find((child) => child.type === 'button')?.props['aria-pressed'],
      ),
    ).toEqual([true, false]);
    expect(JSON.stringify(tree)).toContain('Selected: pending');
    expect(view.evaluate('applied')).toBe(0);
  });

  it.each([
    ['cold start', 'derivation.recommendedPath = undefined'],
    ['truncated domain', 'derivation.truncated = true'],
    ['unlisted recommendation', 'derivation.recommendedPath = { id: "missing" }'],
    ['blocked path', 'derivation.paths[0].blocked = true'],
    ['cycle', 'derivation.paths[0].cyclic = true'],
    ['bounded path', 'derivation.paths[0].bounded = true'],
    ['newer failure', 'derivation.paths[0].failureCount = 1'],
    ['changed page context', 'derivation.currentStateId = "new-page"'],
  ])('does not badge %s or treat list position as a recommendation', (_name, mutation) => {
    const view = fixture();
    view.evaluate(mutation);
    const tree = view.render();
    expect(
      elements(tree).filter((node) => node.props.className === 'rpi-neural-choice-badge'),
    ).toHaveLength(0);
    expect(JSON.stringify(tree)).toContain('No neural recommendation yet');
    expect(options(tree)).toHaveLength(2);
  });

  it.each([
    ['reordered candidates', 'choices[0].choiceRecords[0].candidates.reverse()'],
    ['replacement choice', 'choices[0].id = "other"'],
    ['removed record', 'choices[0].choiceRecords[0].path = "other"'],
    ['removed candidate', 'choices[0].choiceRecords[0].candidates.pop()'],
    [
      'disabled candidate',
      'choices[0].choiceRecords[0].candidates[1] = { id: "responded:1", disabled: true }',
    ],
    ['historical step', 'derivation.paths[0].steps[0].current = false'],
    [
      'partial multi-step mapping',
      'derivation.paths[0].steps.push({ ...derivation.paths[0].steps[0], path: "missing" })',
    ],
  ])('does not attach an option badge to %s', (_name, mutation) => {
    const view = fixture();
    view.evaluate(mutation);
    const tree = view.render();
    expect(options(tree).some((node) => node.props['data-recommended'] === 'true')).toBe(false);
    expect(
      elements(tree).filter((node) => node.props.className === 'rpi-neural-choice-badge'),
    ).toHaveLength(0);
  });

  it('can recommend an original page option without claiming the model created that option', () => {
    const view = fixture();
    view.evaluate(`
      choices[0].choiceKind = 'render-condition';
      choices[0].choiceRecords[0] = { path: 'status', kind: 'page-control', candidates: [
        { id: 'other', actionKind: 'page-control', label: 'Continue' },
        { id: 'responded:1', actionKind: 'page-control', label: 'Continue' },
      ] };
    `);
    const rows = options(view.render());
    expect(rows.map((node) => node.props['data-recommended'])).toEqual(['false', 'true']);
    expect(elements(rows[1]).find((node) => node.type === 'button')?.props['aria-label']).toBe(
      'Continue · Original page option · Neural choice recommendation',
    );
  });

  it('removes the recommendation independently of a retained manual selection', () => {
    const view = fixture();
    (
      elements(options(view.render())[1]).find((node) => node.type === 'button')?.props
        .onClick as () => void
    )();
    view.evaluate('derivation.recommendedPath = undefined');
    const tree = view.render();
    expect(
      elements(tree).filter((node) => node.props.className === 'rpi-neural-choice-badge'),
    ).toHaveLength(0);
    expect(
      elements(options(tree)[1]).find((node) => node.type === 'button')?.props['aria-pressed'],
    ).toBe(true);
    expect(view.evaluate('applied')).toBe(0);
  });

  it('labels an output-verified recommendation without using the recommendation badge as success proof', () => {
    const view = fixture();
    view.evaluate('derivation.paths[0].verified = true');
    const tree = view.render();
    expect(
      elements(tree).filter((node) => node.props.className === 'rpi-neural-choice-badge'),
    ).toHaveLength(2);
    expect(JSON.stringify(tree)).toContain('Stable output verified on this path');
    expect(JSON.stringify(tree)).not.toContain('this output is not yet verified');
  });
});
