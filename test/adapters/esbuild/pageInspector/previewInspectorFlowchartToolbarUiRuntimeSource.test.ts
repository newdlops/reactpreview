/** Verifies the flowchart camera toolbar and exact current-file locator without mounting React. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorFlowchartToolbarUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorFlowchartToolbarUiRuntimeSource';

/** Minimum graph step shape needed by locator behavior tests. */
interface LocatorStep {
  readonly currentFileTarget?: boolean;
  readonly directCurrentFileBlocker?: boolean;
  readonly graphKind?: string;
  readonly id: string;
  readonly node?: {
    readonly blockerKind?: string;
    readonly contextOnly?: boolean;
    readonly currentFileExport?: boolean;
    readonly exportName?: string;
    readonly mounted?: boolean;
    readonly name?: string;
    readonly source?: { readonly path?: string };
  };
  readonly rank: number;
}

/** Data-only result returned by the generated locator. */
interface LocatorResult {
  readonly status: 'absent' | 'blocked' | 'estimated' | 'located';
  readonly step?: LocatorStep;
}

/** Pure toolbar helpers exposed from generated source to verify identity selection. */
interface ToolbarRuntime {
  readonly findNode: (
    nodes: readonly Record<string, unknown>[],
    exportName: string,
  ) => Record<string, unknown> | undefined;
  readonly locate: (flow: unknown, layout: unknown) => LocatorResult;
}

/** Evaluates only the pure locator with fixed selected-target metadata. */
function evaluateLocator(): (flow: unknown, layout: unknown) => LocatorResult {
  return evaluateToolbarRuntime().locate;
}

/** Evaluates current-file graph/tree identity helpers with deterministic source matching. */
function evaluateToolbarRuntime(): ToolbarRuntime {
  const context: { __toolbar?: ToolbarRuntime } = {};
  vm.runInNewContext(
    `
      const previewInspectorSession = { selectedExportName: 'Target' };
      const findSelectedPreviewInspectorDescriptor = () => ({
        inspector: { target: { exportName: 'Target', sourcePath: '/workspace/Target.tsx' } },
      });
      const isPreviewInspectorRenderFlowDecisionNode = () => false;
      const readPreviewInspectorRenderFlowDecision = () => undefined;
      const matchesPreviewInspectorConditionSourcePath = (left, right) =>
        left === right || left.endsWith('/' + (right.startsWith('./') ? right.slice(2) : right));
      ${createPreviewInspectorFlowchartToolbarUiRuntimeSource()}
      globalThis.__toolbar = {
        findNode: findPreviewInspectorUiNodeByExport,
        locate: locatePreviewInspectorFlowchartCurrentFile,
      };
    `,
    context,
  );
  if (context.__toolbar === undefined)
    throw new Error('Flowchart toolbar fixture did not initialize.');
  return context.__toolbar;
}

describe('Preview Inspector flowchart toolbar runtime source', () => {
  /** Prefers the exact mounted function entry over another same-file return or direct blocker. */
  it('locates the selected current-file function entry using explicit identity evidence', () => {
    const locate = evaluateLocator();
    const directBlocker: LocatorStep = {
      directCurrentFileBlocker: true,
      id: 'blocker',
      node: { blockerKind: 'target-error' },
      rank: 3,
    };
    const currentReturn: LocatorStep = {
      graphKind: 'return',
      id: 'render-return:target',
      node: {
        currentFileExport: true,
        exportName: 'Target',
        name: 'Target',
        source: { path: '/workspace/Target.tsx' },
      },
      rank: 5,
    };
    const currentEntry: LocatorStep = {
      currentFileTarget: true,
      graphKind: 'component',
      id: 'render-entry:target',
      node: {
        currentFileExport: true,
        exportName: 'Target',
        mounted: true,
        name: 'Target',
        source: { path: '/workspace/Target.tsx' },
      },
      rank: 4,
    };

    const result = locate({}, { orderedNodes: [directBlocker, currentReturn, currentEntry] });

    expect(result.status).toBe('located');
    expect(result.step?.id).toBe('render-entry:target');
  });

  /** Points at a proven path blocker instead of fabricating a current-file component node. */
  it('falls back to the nearest target reachability blocker when the file is absent', () => {
    const locate = evaluateLocator();
    const result = locate(
      {},
      {
        orderedNodes: [
          { id: 'root', node: { name: 'Workspace' }, rank: 0 },
          {
            id: 'path-blocker',
            node: { blockerKind: 'target-reachability', name: 'Target not reached' },
            rank: 2,
          },
        ],
      },
    );

    expect(result.status).toBe('blocked');
    expect(result.step?.id).toBe('path-blocker');
  });

  /** Selects the source-matched current-file row instead of the first same-named monorepo export. */
  it('locates the exact current-file tree row across duplicate export names', () => {
    const runtime = evaluateToolbarRuntime();
    const wrong = {
      children: [],
      exportName: 'Target',
      id: 'wrong-package-target',
      mounted: true,
      source: { path: '/workspace/packages/other/Target.tsx' },
    };
    const exact = {
      children: [],
      currentFileExport: true,
      exportName: 'Target',
      id: 'current-file-target',
      mounted: true,
      source: { path: '/workspace/Target.tsx' },
    };

    const result = runtime.findNode([wrong, exact], 'Target');

    expect(result?.id).toBe('current-file-target');
  });

  /** Emits companion-safe camera commands and plain-language graph semantics. */
  it('renders zoom, fit, center, locator, inspector, and legend controls', () => {
    const source = createPreviewInspectorFlowchartToolbarUiRuntimeSource();

    expect(() => new vm.Script(source)).not.toThrow();
    for (const command of [
      'zoom-out',
      'zoom-reset',
      'zoom-in',
      'center-selected',
      'fit',
      'locate-current',
    ]) {
      expect(source).toContain(`'${command}'`);
    }
    expect(source).toContain("'data-rpi-flowchart-command'");
    expect(source).toContain("'data-rpi-flowchart-zoom-label'");
    expect(source).toContain("'data-rpi-flowchart-camera-status'");
    expect(source).toContain("className: 'rpi-button rpi-flowchart-inspector-toggle'");
    expect(source).toContain("'Control & render flow'");
    expect(source).toContain("'Locate current file'");
    expect(source).toContain("'solid · active/proven'");
    expect(source).toContain("'dashed · inferred/dormant'");
    expect(source).not.toContain('style:');
  });
});
