/** Verifies deferred UI placeholders and activation controls in the Page Inspector component tree. */
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorDeferredUiTriggerUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorDeferredUiTriggerUiRuntimeSource';
import { createPreviewInspectorDevtoolsUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorDevtoolsUiRuntimeSource';
import { createPreviewInspectorTreeNodeUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTreeNodeUiRuntimeSource';
import { createPreviewPageInspectorRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewPageInspectorRuntimeSource';

describe('Preview Inspector deferred UI trigger UI runtime source', () => {
  it('keeps metadata-only triggers as dormant tree placeholders with a disabled action', () => {
    const source = createPreviewInspectorDeferredUiTriggerUiRuntimeSource();

    expect(source).toContain('attachPreviewInspectorDeferredUiTriggersToSnapshot');
    expect(source).toContain("kind: 'deferred-ui-trigger'");
    expect(source).toContain("mountedUnavailable ? 'Unavailable' : 'Dormant'");
    expect(source).toContain('disabled: !available');
    expect(source).toContain('keeps this source-proven path visible but will not activate it');
    expect(source).toContain("? 'Activation unavailable'");
  });

  it('requires an explicit one-shot action and delegates stale safety to the private registry', () => {
    const source = createPreviewInspectorDeferredUiTriggerUiRuntimeSource();

    expect(source).toContain('invokePreviewInspectorDeferredUiTrigger(node.triggerId)');
    expect(source).toContain("'Activate ' + trigger.methodName + '()'");
    expect(source).toContain('calls it once without arguments');
    expect(source).not.toContain('useEffect(() => activatePreviewInspectorDeferredUiTrigger');
  });

  it('composes the placeholder into tree rows, details, and the non-privileged facade API', () => {
    const devtoolsSource = createPreviewInspectorDevtoolsUiRuntimeSource();
    const treeSource = createPreviewInspectorTreeNodeUiRuntimeSource();
    const pageSource = createPreviewPageInspectorRuntimeSource();

    expect(devtoolsSource).toContain('PreviewInspectorDeferredUiTriggerDetail');
    expect(devtoolsSource).toContain("? 'Deferred UI'");
    expect(treeSource).toContain('PreviewInspectorDeferredUiTriggerRowAction');
    expect(pageSource).toContain(
      'registerDeferredUiTrigger: registerPreviewInspectorDeferredUiTrigger',
    );
    expect(pageSource).toContain(
      'registerDeferredUiTriggerMetadata: registerPreviewInspectorDeferredUiTriggerMetadata',
    );
  });
});
