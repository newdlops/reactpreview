/** Verifies Render-flow graph controls layered over the existing blocker DAG. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorBlockerFlowUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorBlockerFlowUiRuntimeSource';

describe('Preview Inspector blocker-flow navigation UI source', () => {
  /** Keeps context read-only while exposing existing blocker editors at their selected graph node. */
  it('renders inline node controls across the complete JSX render sequence', () => {
    const source = createPreviewInspectorBlockerFlowUiRuntimeSource();

    expect(() => new vm.Script(source)).not.toThrow();
    expect(source).toContain('function PreviewInspectorRenderFlowDetail');
    expect(source).toContain('function PreviewInspectorRenderFlowNode');
    expect(source).toContain(
      'JSX function entry → guard / condition → selected return JSX → child render',
    );
    expect(source).toContain("step.kind === 'component' || step.kind === 'return'");
    expect(source).toContain('React.createElement(PreviewInspectorBlockerDetail');
    expect(source).toContain("'Reveal in Components'");
    expect(source).toContain("'After → '");
    expect(source).toContain("return 'Current file function'");
    expect(source).toContain("return 'Entry / route context'");
    expect(source).toContain("return 'Child component'");
    expect(source).toContain('flow.renderTruncated === true');
    expect(source).toContain('Bounded Render flow');
  });

  /** Allows direct branch changes only after the node is proven to be an instrumented condition. */
  it('shows authored/effective condition state and safe branch actions on condition nodes', () => {
    const source = createPreviewInspectorBlockerFlowUiRuntimeSource();

    expect(source).toContain('if (!isPreviewInspectorConditionNode(step.node)');
    expect(source).toContain("'Authored: ' + String(authored) + ' · Effective: '");
    expect(source).toContain(
      'setPreviewInspectorRenderConditionOverride(condition.id, !effective)',
    );
    expect(source).toContain('resetPreviewInspectorRenderConditionOverride(condition.id)');
    expect(source).toContain("effective ? 'Switch false' : 'Switch true'");
  });

  /** Makes direct current-file blockers visually and accessibly distinct from page-path blockers. */
  it('labels direct current-file blockers and reports their bounded graph count', () => {
    const source = createPreviewInspectorBlockerFlowUiRuntimeSource();

    expect(source).toContain(
      'const directCurrentFileBlocker = step.directCurrentFileBlocker === true',
    );
    expect(source).toContain("'data-current-file-blocker': String(directCurrentFileBlocker)");
    expect(source).toContain("? 'Adjust current file blocker: '");
    expect(source).toContain("'rpi-badge rpi-current-file-blocker-badge'");
    expect(source).toContain("'CURRENT FILE BLOCKER'");
    expect(source).toContain('flow.directCurrentFileBlockerCount > 0');
    expect(source).toContain(
      "String(flow.directCurrentFileBlockerCount) + ' direct current-file blocker(s)'",
    );
  });

  /** Preserves component selection until the dedicated Components reveal action is requested. */
  it('separates graph selection from component-tree selection', () => {
    const source = createPreviewInspectorBlockerFlowUiRuntimeSource();
    const selectionStart = source.indexOf('function selectPreviewInspectorBlockerFlowStep');
    const revealStart = source.indexOf(
      'function revealPreviewInspectorBlockerFlowStepInComponents',
    );
    const conditionStart = source.indexOf('function PreviewInspectorRenderFlowConditionSwitch');

    expect(selectionStart).toBeGreaterThan(-1);
    expect(revealStart).toBeGreaterThan(selectionStart);
    expect(source.slice(selectionStart, revealStart)).not.toContain('selectPreviewInspectorUiNode');
    expect(source.slice(revealStart, conditionStart)).toContain(
      'selectPreviewInspectorUiNode(step.node)',
    );
    expect(source.slice(selectionStart, revealStart)).toContain(
      "previewInspectorDevtoolsSessionState.navigationTab = 'blockers'",
    );
  });
});
