/** Exercises imported render-value dispatch, source proof and fail-closed utility boundaries. */
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { instrumentReactConditionalRendering } from '../../../../src/adapters/esbuild/staticResources/reactConditionalRendering';
import {
  createPreviewSelectedTargetOccurrences,
  readPreviewSelectedTargetNamesForSource,
} from '../../../../src/adapters/esbuild/staticResources/previewSelectedTargetExit';
import { createConditionRuntimeHarness } from '../pageInspector/support/previewInspectorConditionRuntimeFixture';

const sourcePath = '/workspace/steps.ts';
const source = `import { both, selected, other } from './returns';
export const getSteps = (data, mode) => {
  const { first, second } = data;
  if (first && second) return both(data, mode);
  if (second) return selected(data, mode);
  if (first) return other(data);
  throw Error('A step is required');
};`;

describe('selected render-value helper', () => {
  it('joins value-flow child occurrences to their caller rather than the child module', () => {
    const offsets = createPreviewSelectedTargetOccurrences([], {
      steps: [
        { sourcePath: '/workspace/returns.tsx', occurrenceStart: source.indexOf('selected(data') },
        { sourcePath, occurrenceStart: 90 },
      ],
    });
    expect(readPreviewSelectedTargetNamesForSource(offsets, sourcePath, source)).toEqual(
      new Set(['selected']),
    );
    expect(offsets.has('/workspace/returns.tsx')).toBe(false);
  });

  it('takes the selected imported return without replacing a data object or evaluating it twice', () => {
    const instrumented = instrumentReactConditionalRendering(
      sourcePath,
      source,
      undefined,
      new Set(['selected']),
    );
    const resolve = vi.fn((_id: string, value: unknown, metadata: Record<string, unknown>) =>
      metadata.renderValueHelper ? true : value,
    );
    const selected = vi.fn((value: unknown) => ({ value, kind: 'target' }));
    const context = {
      exports: {},
      require: () => ({ selected, both: vi.fn(), other: vi.fn() }),
      Symbol,
    };
    Object.assign(context, {
      [Symbol.for('newdlops.react-file-preview.page-inspector')]: {
        resolveRenderCondition: resolve,
      },
    });
    vm.runInNewContext(
      ts.transpileModule(instrumented, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
        .outputText,
      context,
    );
    const data = { first: false, second: false };
    const result = (
      context.exports as { getSteps: (data: object, mode: boolean) => unknown }
    ).getSteps(data, false);
    expect(result).toEqual({ value: data, kind: 'target' });
    expect(selected).toHaveBeenCalledExactlyOnceWith(data, false);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve.mock.calls[0]?.[2]).toMatchObject({
      ownerName: 'getSteps',
      renderValueHelper: true,
      targetCallName: 'selected',
    });
    expect(instrumentReactConditionalRendering(sourcePath, source)).toBe(source);
  });

  it.each([
    ['unexported', source.replace('export const', 'const')],
    ['asynchronous', source.replace('(data, mode) =>', 'async (data, mode) =>')],
    ['side effect', source.replace('const { first', "fetch('/data'); const { first")],
    ['mutated flag', source.replace('if (second)', 'second = true; if (second)')],
    ['authored default', source.replace('{ first, second }', '{ first, second = true }')],
    ['shadowed import', source.replace('(data, mode)', '(data, selected)')],
    [
      'computed argument',
      source.replace('return selected(data, mode)', 'return selected(load(), mode)'),
    ],
    ['ambiguous return', source.replace('return other(data)', 'return selected(data, mode)')],
    ['compound selected guard', source.replace('if (second)', 'if (first && second)')],
    ['non-invariant throw', source.replace("Error('A step is required')", 'projectError()')],
  ])('leaves %s utility code unchanged', (_label, input) => {
    expect(
      instrumentReactConditionalRendering(sourcePath, input, undefined, new Set(['selected'])),
    ).toBe(input);
  });

  it('bootstraps only a Boolean guard in the exact current helper/callee path', () => {
    const selectedPageCandidate = {
      id: 'path',
      renderPath: {
        steps: [
          { label: 'selected', sourcePath: '/workspace/returns.tsx' },
          { label: 'getSteps', sourcePath },
        ],
      },
    };
    const metadata = {
      kind: 'early-return',
      sourcePath,
      ownerName: 'getSteps',
      renderValueHelper: true,
      targetCallName: 'selected',
      targetBranch: 'truthy',
      targetBranchEvidence: 'selected-target',
    };
    const make = (): ReturnType<typeof createConditionRuntimeHarness> =>
      createConditionRuntimeHarness({}, vi.fn(), {
        descriptors: [{ inspector: {} }],
        fallbackValuesEnabled: true,
        selectedPageCandidate,
      });
    const harness = make();
    expect(harness.resolveCondition('exact', false, metadata)).toBe(true);
    expect(
      harness.resolveCondition('unrelated', false, {
        ...metadata,
        sourcePath: '/workspace/other.ts',
      }),
    ).toBe(false);
    expect(
      harness.resolveCondition('wrong-owner', false, { ...metadata, ownerName: 'other' }),
    ).toBe(false);
    expect(
      harness.resolveCondition('wrong-child', false, { ...metadata, targetCallName: 'other' }),
    ).toBe(false);
    expect(
      harness.resolveCondition('no-evidence', false, {
        ...metadata,
        targetBranchEvidence: undefined,
      }),
    ).toBe(false);
    for (const value of [null, undefined, 0, '', {}, []])
      expect(make().resolveCondition('not-boolean', value, metadata)).toBe(value);
    const manual = make();
    manual.registerDefinitions(sourcePath, [{ id: 'manual', metadata }]);
    manual.setCondition('manual', false);
    expect(manual.resolveCondition('manual', false, metadata)).toBe(false);
    const disabled = make();
    disabled.setFallbackValuesEnabled(false);
    expect(disabled.resolveCondition('disabled', false, metadata)).toBe(false);
    const rows = make();
    rows.session.restCollectionFillServing = true;
    expect(rows.resolveCondition('rows', false, metadata)).toBe(false);
  });
});
