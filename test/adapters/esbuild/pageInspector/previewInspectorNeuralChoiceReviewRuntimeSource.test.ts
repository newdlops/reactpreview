/** Verifies that the review action names actual decisions and options rather than opaque counts. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralChoiceReviewRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralChoiceReviewRuntimeSource';
import { createPreviewInspectorNeuralLearningUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralLearningUiRuntimeSource';
import { createPreviewInspectorDevtoolsUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorDevtoolsUiRuntimeSource';

interface Review {
  /** Whether clicking should focus concrete inline controls instead of external details/paths. */
  readonly hasOptions: boolean;
  /** Specific user action, kept separate from the listed candidate labels. */
  readonly label: string;
  /** Bounded source-derived option previews and explicit remaining counts. */
  readonly lines: readonly string[];
}

/** Reads existing candidates without mounting React, ranking candidates or applying a value. */
function review(choices: unknown[]): Review {
  const sandbox = { choices, result: undefined as Review | undefined };
  vm.runInNewContext(
    `${createPreviewInspectorNeuralChoiceReviewRuntimeSource()}
    result = readPreviewInspectorNeuralChoiceReview(choices, choices[0]);`,
    sandbox,
  );
  if (sandbox.result === undefined) throw new Error('Review summary was not generated');
  return sandbox.result;
}

/** Creates one already-proven prop decision, not an invented runtime inference. */
function prop(path: string, candidates: unknown[] = ['pending', 'responded']): unknown {
  return { choiceKind: 'source-proven-prop', choiceRecords: [{ path, candidates }] };
}

describe('neural choice review summaries', () => {
  it('preserves the review variant through the production shared button and rejects unknown variants', () => {
    const source = createPreviewInspectorDevtoolsUiRuntimeSource();
    const button = source.slice(
      source.indexOf('function PreviewInspectorDevtoolsButton('),
      source.indexOf('/** Handles roving tree focus'),
    );
    const variants: unknown = vm.runInNewContext(`
      const React = { createElement: (type, props) => props };
      ${button}
      ['primary','choice-review','unknown'].map(variant=>PreviewInspectorDevtoolsButton({variant})['data-rpi-variant']);
    `);
    expect(variants).toEqual(['primary', 'choice-review', undefined]);
  });
  it('names the field and actual options without confusing option count with decision count', () => {
    expect(review([prop('status')])).toEqual({
      hasOptions: true,
      label: 'Choose status',
      lines: ['pending / responded'],
    });
  });

  it('counts fields across groups and keeps all manual decisions available behind bounded summaries', () => {
    expect(review([prop('status'), prop('tax'), prop('currency'), prop('region')])).toEqual({
      hasOptions: true,
      label: 'Show 4 decisions',
      lines: [
        'status: pending / responded',
        'tax: pending / responded',
        'currency: pending / responded',
        '+1 more decision in the list',
      ],
    });
  });

  it('reports omitted options rather than implying the preview is the full choice domain', () => {
    expect(review([prop('mode', ['A', 'B', 'C', 'D', 'E'])]).lines).toEqual([
      'A / B / C · +2 more options',
    ]);
  });

  it.each([
    ['page-control', 'Choose a page action'],
    ['branch', 'Choose branch: hasResponded'],
  ])('names a %s choice and keeps authored labels', (kind, label) => {
    expect(
      review([
        {
          choiceKind: 'render-condition',
          choiceRecords: [
            {
              kind,
              path: 'hasResponded',
              candidates: [{ label: 'Show response' }, { label: 'Show request', disabled: true }],
            },
          ],
        },
      ]),
    ).toEqual({
      hasOptions: true,
      label,
      lines: ['Show response / Show request (unavailable)'],
    });
  });

  it('exposes recovery strategy names without calling them original page options', () => {
    expect(
      review([
        {
          choiceKind: 'data-request',
          choiceRecords: [
            {
              path: 'Contact request',
              candidates: [{ label: 'Smart fill minimum' }, { label: 'Auto pass' }],
            },
          ],
        },
      ]),
    ).toEqual({
      hasOptions: true,
      label: 'Choose Contact request',
      lines: ['Smart fill minimum / Auto pass'],
    });
  });

  it('does not invent inline candidates for the separate page-path chooser', () => {
    expect(review([{ surface: 'page-context', choiceRecords: [] }])).toEqual({
      hasOptions: false,
      label: 'Compare page paths',
      lines: ['Choose which consuming page should render the selected file.'],
    });
  });

  it.each([{ choices: [] }, { choices: [{}] }, { choices: [{ choiceRecords: [] }] }])(
    'explains the absence of choices: %j',
    ({ choices }) => {
      const result = review(choices);
      expect(result.hasOptions).toBe(false);
      expect(result.label).toBe('Inspect blocked step');
      expect(result.lines[0]).toContain('No selectable option');
    },
  );

  it('keeps false, zero, null and an empty string visible', () => {
    expect(review([prop('flag', [false, 0, null])]).lines).toEqual(['false / 0 / null']);
    expect(review([prop('text', [''])]).lines).toEqual(['Empty string']);
  });

  it('bounds long CJK/RTL labels and does not invoke authored coercion or serialization', () => {
    const labels = ['응답'.repeat(100), 'الاختيار '.repeat(100)];
    const result = review([prop('field'.repeat(100), labels)]);
    expect(result.label.length).toBeLessThan(80);
    expect(result.lines[0]?.length).toBeLessThan(140);
    expect(result.lines[0]).toContain('…');
    expect(
      review([
        prop('mode', [
          {
            toJSON: () => {
              throw new Error('must not serialize');
            },
          },
        ]),
      ]).lines,
    ).toEqual(['Unlabeled option']);
    expect(
      review([
        prop('mode', [
          {
            get label() {
              throw new Error('must not invoke getter');
            },
          },
        ]),
      ]).lines,
    ).toEqual(['Unlabeled option']);
  });

  it('renders the option summary as visible button content and points to the real list', () => {
    const sandbox = { review: review([prop('status')]), result: undefined as unknown };
    vm.runInNewContext(
      `
      const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) };
      const PreviewInspectorDevtoolsButton = 'button';
      const activatePreviewInspectorNeuralAssistance = () => undefined;
      const readPreviewInspectorNeuralAssistanceAvailability = () => ({actionable:true,mode:'choice',choiceReview:review});
      ${createPreviewInspectorNeuralLearningUiRuntimeSource()}
      result = PreviewInspectorNeuralRequestButton();
    `,
      sandbox,
    );
    expect(sandbox.result).toMatchObject({
      props: { ariaControls: 'rpi-neural-choice-list', disabled: false },
    });
    expect(JSON.stringify(sandbox.result)).toContain('Choose status');
    expect(JSON.stringify(sandbox.result)).toContain('pending / responded');
    expect(JSON.stringify(sandbox.result)).toContain('Open options · no value changes');
    expect(JSON.stringify(sandbox.result)).not.toContain('Review choice');
  });
});
