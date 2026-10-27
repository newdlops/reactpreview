/** Exact selected JSX gates can bootstrap without admitting sibling branches or overriding users. */
import { describe, expect, it } from 'vitest';
import { createConditionRuntimeHarness } from './support/previewInspectorConditionRuntimeFixture';

const SOURCE = '/workspace/Recommend.tsx';

/** Creates an inert selected-page registry; no component, handler, setter, or network is executed. */
function createHarness(): ReturnType<typeof createConditionRuntimeHarness> {
  return createConditionRuntimeHarness({}, () => undefined, {
    descriptors: [{ inspector: {} }],
    fallbackValuesEnabled: true,
    selectedPageCandidate: {
      id: 'selected',
      selectedJsxOccurrenceIds: ['selected-site'],
      renderPath: { steps: [{ invocation: { mode: 'jsx', sourcePath: SOURCE } }] },
    },
  });
}

/** Compiler evidence of the selected JSX call, independent from a merely matching display name. */
function metadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'logical-and',
    sourcePath: SOURCE,
    ownerName: 'Page',
    expression: 'phase === "finish"',
    targetBranch: 'truthy',
    targetBranchEvidence: 'selected-target',
    scalarExpression: { kind: 'comparison', operator: '===', path: 'phase', value: 'finish' },
    ...overrides,
  };
}

describe('exact selected JSX initial branch guidance', () => {
  it('opens a proven selected branch and keeps the sibling scalar comparison coherent', () => {
    const harness = createHarness();
    expect(harness.resolveCondition('finish', false, metadata())).toBe(true);
    expect(
      harness.resolveCondition(
        'start',
        true,
        metadata({
          expression: 'phase === "start"',
          targetBranch: undefined,
          targetBranchEvidence: undefined,
          scalarExpression: { kind: 'comparison', operator: '===', path: 'phase', value: 'start' },
        }),
      ),
    ).toBe(false);
  });

  it('preserves manual choices, authored-state requirements, and unrelated modules', () => {
    const harness = createHarness();
    expect(
      harness.resolveCondition('stateful', false, metadata({ requiresAuthoredState: true })),
    ).toBe(false);
    expect(
      harness.resolveCondition('foreign', false, metadata({ sourcePath: '/workspace/Other.tsx' })),
    ).toBe(false);
    expect(
      harness.resolveCondition('unproven', false, metadata({ targetBranchEvidence: undefined })),
    ).toBe(false);
    harness.resolveCondition('manual', false, metadata());
    harness.setCondition('manual', false);
    expect(harness.resolveCondition('manual', true, metadata())).toBe(false);
    harness.setFallbackValuesEnabled(false);
    expect(harness.resolveCondition('disabled', false, metadata())).toBe(false);
  });
});
