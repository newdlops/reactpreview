/** Verifies when a rejected page gate proves that data filling cannot reveal the target. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorTargetContextualBoundaryRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetContextualBoundaryRuntimeSource';

type Check = (state: unknown) => boolean;

/** Evaluates the generated helper against one inert condition registry. */
function createCheck(conditions: Record<string, Record<string, unknown>>): Check {
  const context: { check?: Check; previewInspectorSession: unknown } = {
    previewInspectorSession: { renderConditions: new Map(Object.entries(conditions)) },
  };
  vm.runInNewContext(
    `${createPreviewInspectorTargetContextualBoundaryRuntimeSource()}
     globalThis.check = hasPreviewInspectorTargetRevealingRejectedCondition;`,
    context,
  );
  if (context.check === undefined) throw new Error('Helper did not initialize.');
  return context.check;
}

describe('hasPreviewInspectorTargetRevealingRejectedCondition', () => {
  const check = createCheck({
    cell: { falsyLabel: 'hidden', truthyLabel: '<td: TrendBars>' },
    early: {
      falsyLabel: 'continue <Panel>',
      targetBranchEvidence: 'selected-target',
      truthyLabel: '<Empty>',
    },
    header: { falsyLabel: 'hidden', truthyLabel: '<th>' },
  });

  /** A header gate beside the row that renders the target says nothing about the rows' data. */
  it('ignores a rejected sibling gate whose branches never render the target', () => {
    expect(check({ rejectedConditions: [{ id: 'header' }], targetExportName: 'TrendBars' })).toBe(
      false,
    );
    expect(check({ rejectedConditions: [], targetExportName: 'TrendBars' })).toBe(false);
  });

  it('accepts a rejected gate whose branch names the target or carries compiler evidence', () => {
    expect(check({ rejectedConditions: [{ id: 'cell' }], targetExportName: 'TrendBars' })).toBe(
      true,
    );
    expect(check({ rejectedConditions: [{ id: 'early' }], targetExportName: 'Other' })).toBe(true);
    // A longer component name containing the target name is not the target.
    expect(check({ rejectedConditions: [{ id: 'cell' }], targetExportName: 'Trend' })).toBe(false);
  });
});
