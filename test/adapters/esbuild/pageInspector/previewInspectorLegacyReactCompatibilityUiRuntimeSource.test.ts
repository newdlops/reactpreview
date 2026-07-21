/**
 * Verifies that optional Inspector controls remain valid function components under ReactDOM 16.
 *
 * ReactDOM versions before React 18 reject an `undefined` function-component result even though
 * newer renderers accept it as empty output. These fixtures call only generated React components;
 * ordinary lookup helpers intentionally retain `undefined` as their absence sentinel.
 */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorBlockerFlowUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorBlockerFlowUiRuntimeSource';
import { createPreviewInspectorDeferredUiTriggerUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorDeferredUiTriggerUiRuntimeSource';
import { createPreviewInspectorPageCandidateUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageCandidateUiRuntimeSource';
import { createPreviewInspectorRenderOutcomeUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRenderOutcomeUiRuntimeSource';
import { createPreviewInspectorTreeNodeUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTreeNodeUiRuntimeSource';

/** One optional generated component and the expression that exercises its empty-render branch. */
interface EmptyRenderFixture {
  readonly expression: string;
  readonly prelude?: string;
  readonly source: string;
}

describe('Preview Inspector legacy React empty-render compatibility', () => {
  /** Covers every optional Inspector function component known to render in shared tree controls. */
  it.each<readonly [string, EmptyRenderFixture]>([
    [
      'page candidate selector',
      {
        expression: 'PreviewInspectorPageCandidateSelect({ descriptor: {} })',
        prelude: `
          function readPreviewInspectorPageCandidates() { return []; }
          function readSelectedPreviewInspectorPageCandidate() { return undefined; }
        `,
        source: createPreviewInspectorPageCandidateUiRuntimeSource(),
      },
    ],
    [
      'component-tree condition switch',
      {
        expression: "PreviewInspectorComponentTreeConditionSwitch({ node: { kind: 'component' } })",
        prelude: 'function isPreviewInspectorConditionNode() { return false; }',
        source: createPreviewInspectorTreeNodeUiRuntimeSource(),
      },
    ],
    [
      'deferred UI trigger action',
      {
        expression: "PreviewInspectorDeferredUiTriggerRowAction({ node: { kind: 'component' } })",
        source: createPreviewInspectorDeferredUiTriggerUiRuntimeSource(),
      },
    ],
    [
      'render outcome editor',
      {
        expression: 'PreviewInspectorRenderOutcomeEditor({ step: {} })',
        source: createPreviewInspectorRenderOutcomeUiRuntimeSource(),
      },
    ],
    [
      'render-flow condition switch',
      {
        expression: `PreviewInspectorRenderFlowConditionSwitch({
          step: { current: false, node: { kind: 'component' } },
        })`,
        prelude: 'function isPreviewInspectorConditionNode() { return false; }',
        source: createPreviewInspectorBlockerFlowUiRuntimeSource(),
      },
    ],
  ])('returns null from an absent %s', (_label, fixture) => {
    expect(evaluateEmptyGeneratedComponent(fixture)).toBeNull();
  });
});

/** Evaluates one generated component without mounting React or any project application module. */
function evaluateEmptyGeneratedComponent(fixture: EmptyRenderFixture): unknown {
  const context: { __result?: unknown } = {};
  vm.runInNewContext(
    `
      const React = {
        createElement: (type, props, ...children) => ({ type, props, children }),
        Fragment: Symbol.for('fixture.fragment'),
      };
      ${fixture.prelude ?? ''}
      ${fixture.source}
      globalThis.__result = ${fixture.expression};
    `,
    context,
  );
  return context.__result;
}
