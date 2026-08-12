import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorPageTabActivationRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageTabActivationRuntimeSource';

describe('Preview Inspector page tab activation runtime source', () => {
  it('activates only the exact compiler-proven static tab key', () => {
    const context: { __result?: unknown } = {};
    vm.runInNewContext(
      `
        const clicks = [];
        const traces = [];
        const previewInspectorSession = {};
        const recordPreviewInspectorBlockerAutoDecision = (decision) => traces.push(decision);
        const tablist = {
          querySelectorAll: () => tabs,
        };
        const createTab = (eventKey, label, selected) => ({
          click: () => clicks.push(eventKey),
          closest: (selector) => selector === '[role="tablist"]' ? tablist : null,
          disabled: false,
          getAttribute: (name) => ({
            'aria-disabled': 'false',
            'aria-selected': selected ? 'true' : 'false',
            'data-rb-event-key': eventKey,
            role: 'tab',
          })[name] ?? null,
          isConnected: true,
          textContent: label,
        });
        const tabs = [
          createTab('deposited', 'Deposited', true),
          createTab('withdraw', 'Withdraw', false),
          createTab('guideEmail', 'Guide email', false),
        ];
        globalThis.document = { querySelectorAll: () => [tablist] };
        globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible' });
        ${createPreviewInspectorPageTabActivationRuntimeSource()}
        const state = {
          directTarget: false,
          key: 'page:Target',
          pageRootCommitted: true,
          rootName: 'Page',
          targetExportName: 'Target',
          targetMounted: false,
          targetPageTabKeys: ['guideEmail'],
          targetWasMounted: false,
        };
        const exact = autoActivatePreviewInspectorTargetPageTab(state);
        const noEvidence = autoActivatePreviewInspectorTargetPageTab({
          ...state,
          pageTabActivationCount: 0,
          pageTabActivationCountsByKey: new Map(),
          targetPageTabKeys: [],
        });
        const duplicate = createTab('guideEmail', 'Duplicate guide email', false);
        tabs.push(duplicate);
        const ambiguous = autoActivatePreviewInspectorTargetPageTab({
          ...state,
          pageTabActivationCount: 0,
          pageTabActivationCountsByKey: new Map(),
        });
        globalThis.__result = {
          ambiguous,
          clicks,
          exact,
          noEvidence,
          traceActions: traces.map((trace) => trace.action + ':' + trace.mode),
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      ambiguous: undefined,
      clicks: ['guideEmail'],
      exact: { eventKey: 'guideEmail', label: 'Guide email' },
      noEvidence: undefined,
      traceActions: ['Activate exact selected target page tab:target-guided-auto'],
    });
  });
});
