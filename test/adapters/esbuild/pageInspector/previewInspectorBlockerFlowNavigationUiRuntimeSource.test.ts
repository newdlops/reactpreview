/** Verifies Render-flow graph controls layered over the existing blocker DAG. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorBlockerFlowUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorBlockerFlowUiRuntimeSource';

describe('Preview Inspector blocker-flow navigation UI source', () => {
  /** Keeps the complete JSX graph available only after advanced diagnostics is requested. */
  it('retains graph node controls across the complete JSX render sequence', () => {
    const source = createPreviewInspectorBlockerFlowUiRuntimeSource();

    expect(() => new vm.Script(source)).not.toThrow();
    expect(source).toContain('function PreviewInspectorRenderFlowDetail');
    expect(source).toContain('function PreviewInspectorRenderFlowNode');
    expect(source).toContain("step.kind === 'component' || step.kind === 'return'");
    expect(source).toContain('React.createElement(PreviewInspectorBlockerDetail');
    expect(source).toContain("'Reveal in Components'");
    expect(source).toContain("'After → '");
    expect(source).toContain("return 'Current file function'");
    expect(source).toContain("return 'Entry / route context'");
    expect(source).toContain("return 'Child component'");
    expect(source).toContain('React.createElement(PreviewInspectorFlowchart');
    expect(source).toContain('selectedStepId');
  });

  /** Leads with the two-choice resolver and keeps the dense graph behind explicit disclosure. */
  it('uses the simple preview setup before the opt-in advanced graph', () => {
    const source = createPreviewInspectorBlockerFlowUiRuntimeSource();

    expect(source).toContain('function PreviewInspectorBlockerFlowSetup');
    expect(source).toContain('React.createElement(PreviewInspectorSimpleResolver');
    expect(source).toContain("'Advanced diagnostics'");
    expect(source).not.toContain("'Current blocking path'");
    expect(source).not.toContain("'Current blocker'");
    expect(source).not.toContain("'Next action'");
    expect(source).not.toContain("'Blocker resolution progress'");
    expect(source).toContain("className: 'rpi-flowchart-backbar'");
    expect(source).toContain("'← Preview setup'");
    expect(source).toContain("'aria-controls': 'react-preview-blocker-flow-advanced'");
    expect(source).toContain(
      'previewInspectorDevtoolsSessionState.blockerFlowAdvancedOpen === true',
    );
  });

  /** The default view delegates its bounded actions only to the shared simple resolver. */
  it('does not expose the raw active-blocker editor in preview setup', () => {
    const source = createPreviewInspectorBlockerFlowUiRuntimeSource();
    const setupStart = source.indexOf('function PreviewInspectorBlockerFlowSetup');
    const detailStart = source.indexOf('function PreviewInspectorBlockerFlowDetail');
    const setupSource = source.slice(setupStart, detailStart);

    expect(setupStart).toBeGreaterThan(-1);
    expect(setupSource).toContain('React.createElement(PreviewInspectorSimpleResolver');
    expect(setupSource).not.toContain('PreviewInspectorRenderFlowNodeEditor');
    expect(setupSource).not.toContain('PreviewInspectorRenderFlowConditionSwitch');
    expect(setupSource).not.toContain('PreviewInspectorBlockerDetail');
    expect(source).toContain('notifyPreviewInspector();');
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

  /** Makes direct current-file blockers visually and accessibly distinct in advanced diagnostics. */
  it('labels direct current-file blockers in advanced graph nodes', () => {
    const source = createPreviewInspectorBlockerFlowUiRuntimeSource();

    expect(source).toContain(
      'const directCurrentFileBlocker = step.directCurrentFileBlocker === true',
    );
    expect(source).toContain("'data-current-file-blocker': String(directCurrentFileBlocker)");
    expect(source).toContain("? 'Adjust current file blocker: '");
    expect(source).toContain("'rpi-badge rpi-current-file-blocker-badge'");
    expect(source).toContain("'CURRENT FILE BLOCKER'");
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
