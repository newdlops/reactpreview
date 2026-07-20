/** Verifies persistent Components/Blockers navigation without mounting project React. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNavigationUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNavigationUiRuntimeSource';

/** Tiny API exposed from the generated navigation source for state-boundary assertions. */
interface NavigationRuntime {
  readonly notifications: () => number;
  readonly persisted: () => number;
  readonly read: () => 'blockers' | 'components';
  readonly select: (tabId: string) => void;
}

describe('Preview Inspector navigation UI runtime source', () => {
  /** Keeps both panels mounted and uses companion-safe data state instead of stripped `hidden`. */
  it('emits accessible primary tabs with bounded panel visibility', () => {
    const source = createPreviewInspectorNavigationUiRuntimeSource();

    expect(() => new vm.Script(source)).not.toThrow();
    expect(source).toContain("['components', 'Components']");
    expect(source).toContain("['blockers', 'Blockers (' + String(flow.unresolvedCount) + ')']");
    expect(source).toContain("role: 'tablist'");
    expect(source).toContain("'data-rpi-active': String(activeTab === 'components')");
    expect(source).toContain("'data-rpi-active': String(activeTab === 'blockers')");
    expect(source).toContain("'data-rpi-scroll-key': 'blocker-flow'");
    expect(source).toContain('React.createElement(PreviewInspectorComponentsPane');
    expect(source).toContain('React.createElement(PreviewInspectorRenderFlowDetail');
    expect(source).not.toContain('hidden: activeTab');
  });

  /** Rejects unknown persisted identities and commits an explicit Blockers selection once. */
  it('normalizes and persists navigation independently from detail/debugger tabs', () => {
    const runtime = evaluateNavigationRuntime('legacy-tab');

    expect(runtime.read()).toBe('components');
    runtime.select('blockers');
    expect(runtime.read()).toBe('blockers');
    expect(runtime.persisted()).toBe(1);
    expect(runtime.notifications()).toBe(1);
    runtime.select('debugger');
    expect(runtime.read()).toBe('blockers');
    expect(runtime.persisted()).toBe(1);
  });
});

/** Evaluates only navigation state helpers with inert UI bindings. */
function evaluateNavigationRuntime(initialTab: string): NavigationRuntime {
  const context: { __navigation?: NavigationRuntime } = {};
  vm.runInNewContext(
    `
      const React = {};
      const previewInspectorDevtoolsSessionState = { navigationTab: ${JSON.stringify(initialTab)} };
      let persistedCount = 0;
      let notificationCount = 0;
      const persistPreviewInspectorState = () => { persistedCount += 1; };
      const notifyPreviewInspector = () => { notificationCount += 1; };
      ${createPreviewInspectorNavigationUiRuntimeSource()}
      globalThis.__navigation = {
        notifications: () => notificationCount,
        persisted: () => persistedCount,
        read: readPreviewInspectorNavigationTab,
        select: selectPreviewInspectorNavigationTab,
      };
    `,
    context,
  );
  if (context.__navigation === undefined) {
    throw new Error('Generated navigation runtime did not initialize.');
  }
  return context.__navigation;
}
