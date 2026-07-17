/** Verifies condition pseudo nodes and current-file navigation without React or Fiber internals. */
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { createPreviewInspectorConditionUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorConditionUiRuntimeSource';

interface ConditionUiRuntime {
  readonly attachConditions: (snapshot: Record<string, unknown>) => ConditionTreeSnapshot;
  readonly selectMainComponent: () => void;
}

interface ConditionTreeNode {
  readonly children: readonly ConditionTreeNode[];
  readonly conditionId?: string;
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly source?: { readonly line: number; readonly path: string };
}

interface ConditionTreeSnapshot {
  readonly roots: readonly ConditionTreeNode[];
}

describe('Preview Inspector condition UI runtime source', () => {
  /** Places a condition below the nearest preceding component from the same JSX source file. */
  it('attaches conditional branch controls to their nearest component owner', () => {
    const conditions = [
      {
        authoredEnabled: false,
        effectiveEnabled: true,
        expression: 'loaded',
        falsyLabel: '<LoadingFallback>',
        id: 'condition-a',
        kind: 'ternary',
        line: 24,
        override: true,
        sourcePath: '/workspace/Page.tsx',
        truthyLabel: '<Content>',
      },
    ];
    const runtime = createConditionUiRuntime(conditions);
    const snapshot = runtime.attachConditions({
      roots: [
        componentNode('page', 'Page', '/workspace/Page.tsx', 3, [
          componentNode('section', 'Section', '/workspace/Page.tsx', 20),
        ]),
      ],
    });

    expect(snapshot.roots[0]?.children[0]?.children[0]).toMatchObject({
      conditionId: 'condition-a',
      kind: 'condition',
      name: 'loaded · <Content>',
    });
  });

  /** Selects the descriptor target even after the user inspected a sibling or conditional row. */
  it('returns selection to the current file main component', () => {
    const selectExport = vi.fn();
    const session = {
      descriptors: [{ inspector: { target: { exportName: 'CurrentFileMain' } } }],
      selectedExportName: 'Sibling',
      selectedTreeNodeId: 'render-condition:one',
    };
    const runtime = createConditionUiRuntime([], session, selectExport);

    runtime.selectMainComponent();

    expect(session.selectedTreeNodeId).toBeUndefined();
    expect(selectExport).toHaveBeenCalledWith('CurrentFileMain');
  });
});

/** Creates one component node carrying JSX-dev source evidence used for condition ownership. */
function componentNode(
  id: string,
  name: string,
  sourcePath: string,
  line: number,
  children: readonly ConditionTreeNode[] = [],
): ConditionTreeNode {
  return {
    children,
    id,
    kind: 'function',
    name,
    source: { line, path: sourcePath },
  };
}

/** Evaluates generated UI helpers against serializable test adapters only. */
function createConditionUiRuntime(
  conditions: readonly Record<string, unknown>[],
  previewInspectorSession: Record<string, unknown> = { descriptors: [] },
  selectPreviewInspectorExport: (name: string) => void = () => undefined,
): ConditionUiRuntime {
  const context: {
    __conditionUiRuntime?: ConditionUiRuntime;
    conditions: readonly Record<string, unknown>[];
    previewInspectorSession: Record<string, unknown>;
    selectPreviewInspectorExport: (name: string) => void;
  } = { conditions, previewInspectorSession, selectPreviewInspectorExport };
  vm.runInNewContext(
    `
      const readPreviewInspectorRenderConditions = () => conditions;
      const normalizePreviewInspectorUiSource = (source) => source;
      const persistPreviewInspectorState = () => undefined;
      const notifyPreviewInspector = () => undefined;
      const schedulePreviewInspectorHighlight = () => undefined;
      const schedulePreviewInspectorTreeRefresh = () => undefined;
      ${createPreviewInspectorConditionUiRuntimeSource()}
      globalThis.__conditionUiRuntime = {
        attachConditions: attachPreviewInspectorConditionsToSnapshot,
        selectMainComponent: selectPreviewInspectorMainComponent,
      };
    `,
    context,
  );
  if (context.__conditionUiRuntime === undefined) {
    throw new Error('Condition UI runtime fixture did not initialize.');
  }
  return context.__conditionUiRuntime;
}
