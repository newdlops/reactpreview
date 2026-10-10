/** Verifies that compiler-proven target branches outrank runtime label heuristics. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorTargetPathEvidenceRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetPathEvidenceRuntimeSource';

describe('readPreviewInspectorTargetConditionValue', () => {
  /** `if (!token) return <LoginRoutes />` must stay taken although `App` is on the page path. */
  it('keeps a returned branch that renders the selected target', () => {
    const gate = {
      falsyLabel: 'continue <App>',
      kind: 'early-return',
      ownerName: 'App',
      truthyLabel: '<Fragment: ToastHost, Routes>',
    };

    expect(readValue({ ...gate, targetBranch: 'truthy' })).toBe(false);
    expect(
      readValue({ ...gate, targetBranch: 'truthy', targetBranchEvidence: 'selected-target' }),
    ).toBe(true);
  });
});

/** Evaluates the generated runtime with path evidence naming only the page root component. */
function readValue(condition: Readonly<Record<string, unknown>>): unknown {
  const context: { __result?: unknown } = {};
  vm.runInNewContext(
    `
      const previewInspectorSession = { renderConditions: new Map() };
      ${createPreviewInspectorTargetPathEvidenceRuntimeSource()}
      const evidence = {
        componentCorridorNames: new Set(['App']),
        exactTargetNames: new Set(['LoginPage']),
        nameScores: new Map([['App', 2]]),
      };
      globalThis.__result = readPreviewInspectorTargetConditionValue(
        ${JSON.stringify(condition)},
        evidence,
      );
    `,
    context,
  );
  return context.__result;
}
