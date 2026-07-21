/** Verifies condition pseudo nodes and current-file navigation without React or Fiber internals. */
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { createPreviewInspectorConditionUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorConditionUiRuntimeSource';

interface ConditionUiRuntime {
  readonly attachConditions: (snapshot: Record<string, unknown>) => ConditionTreeSnapshot;
  readonly isChoice: (node: ConditionTreeNode) => boolean;
  readonly selectMainComponent: () => void;
}

interface ConditionTreeNode {
  readonly blocksCurrentTarget?: boolean;
  readonly children: readonly ConditionTreeNode[];
  readonly choiceId?: string;
  readonly conditionId?: string;
  readonly condition?: Record<string, unknown>;
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly overlayState?: string;
  readonly props?: Record<string, unknown>;
  readonly role?: string;
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

  /** Places a switch below its component while keeping it outside boolean blocker classification. */
  it('attaches editable switch choices with distinct multi-way tree identity', () => {
    const runtime = createConditionUiRuntime([
      {
        authoredBranchId: 'choice-a:case-0',
        branches: [
          {
            id: 'choice-a:case-0',
            label: 'case summary → <Summary>',
            selectable: true,
            value: 'summary',
          },
          {
            id: 'choice-a:case-1',
            label: 'case resolveMode() → <Dynamic>',
            selectable: false,
          },
        ],
        effectiveBranchId: 'choice-a:case-0',
        expression: 'mode',
        id: 'choice-a',
        kind: 'switch',
        line: 14,
        sourcePath: '/workspace/Page.tsx',
      },
    ]);
    const snapshot = runtime.attachConditions({
      roots: [componentNode('page', 'Page', '/workspace/Page.tsx', 2)],
    });
    const choice = snapshot.roots[0]?.children[0];

    expect(choice).toMatchObject({
      choiceId: 'choice-a',
      kind: 'render-choice',
      name: 'Switch · mode · case summary → <Summary>',
    });
    expect(choice === undefined ? false : runtime.isChoice(choice)).toBe(true);
    const source = createPreviewInspectorConditionUiRuntimeSource();
    expect(source).toContain('setPreviewInspectorRenderChoiceOverride(choice.id, branch.id)');
    expect(source).toContain('Read-only dynamic case');
  });

  /** Labels logical-AND JSX controls as boolean switches in both tree and detail semantics. */
  it('presents logical-and JSX conditions as boolean switches', () => {
    const runtime = createConditionUiRuntime([
      {
        authoredEnabled: false,
        effectiveEnabled: true,
        expression: 'showPanel',
        falsyLabel: 'hidden',
        id: 'panel-switch',
        kind: 'logical-and',
        line: 12,
        override: true,
        sourcePath: '/workspace/Page.tsx',
        truthyLabel: '<Panel>',
      },
    ]);
    const snapshot = runtime.attachConditions({
      roots: [componentNode('page', 'Page', '/workspace/Page.tsx', 2)],
    });
    const source = createPreviewInspectorConditionUiRuntimeSource();

    expect(snapshot.roots[0]?.children[0]).toMatchObject({
      conditionId: 'panel-switch',
      kind: 'condition',
      name: 'JSX switch · showPanel · <Panel>',
    });
    expect(source).toContain("? 'JSX boolean switch'");
    expect(source).toContain("role: 'switch'");
    expect(source).toContain('setPreviewInspectorRenderConditionOverride(condition.id, !enabled)');
  });

  /** Keeps every static chain guard under its owner even before short-circuit evaluation reaches it. */
  it('attaches short-circuited logical guards as stable read-only tree switches', () => {
    const staticConditions = [
      logicalCondition('guard-a', 'session', 'fingerprint-a', 0, 'truthy'),
      logicalCondition('guard-b', 'session.user', 'fingerprint-b', 1, 'truthy'),
    ];
    const outcomes = [
      {
        componentNames: ['Panel'],
        conditions: staticConditions,
        exportName: 'Page',
        id: 'visible',
        kind: 'jsx',
        sourcePath: '/workspace/Page.tsx',
      },
      {
        componentNames: [],
        conditions: [logicalCondition('guard-a', 'session', 'fingerprint-a', 0, 'falsy')],
        exportName: 'Page',
        id: 'hidden-first',
        kind: 'empty',
        sourcePath: '/workspace/Page.tsx',
      },
    ];
    const runtime = createConditionUiRuntime(
      [
        {
          authoredEnabled: false,
          column: 10,
          effectiveEnabled: true,
          expression: 'session',
          expressionFingerprint: 'fingerprint-a',
          falsyLabel: 'hidden',
          id: 'runtime-a',
          kind: 'logical-and',
          line: 15,
          ownerName: 'Page',
          sourcePath: '/workspace/Page.tsx',
          truthyLabel: '<Panel>',
        },
      ],
      { descriptors: [] },
      () => undefined,
      outcomes,
    );
    const snapshot = runtime.attachConditions({
      roots: [
        componentNode('page', 'Page', '/workspace/Page.tsx', 2, [
          componentNode('nearby-child', 'NearbyChild', '/workspace/Page.tsx', 14),
        ]),
      ],
    });
    const pageChildren = snapshot.roots[0]?.children ?? [];
    const first = pageChildren.find((node) => node.name.includes('session ·'));
    const second = pageChildren.find((node) => node.name.includes('session.user'));

    expect(first).toMatchObject({
      conditionId: 'runtime-a',
      id: 'render-condition:logical-and:guard-a:0',
      props: { effective: true, reached: true },
    });
    expect(second).toMatchObject({
      conditionId: undefined,
      id: 'render-condition:logical-and:guard-b:1',
      props: { effective: false, reached: false },
    });
    expect(second?.name).toContain('Not reached yet');
    expect(snapshot.roots[0]?.children[0]?.children).toHaveLength(0);
  });

  /** Preserves a static row identity when the formerly short-circuited runtime guard appears. */
  it('upgrades a not-reached guard in place after its predecessor is enabled', () => {
    const outcome = {
      componentNames: ['Panel'],
      conditions: [logicalCondition('guard-b', 'session.user', 'fingerprint-b', 1, 'truthy')],
      exportName: 'Page',
      id: 'visible',
      kind: 'jsx',
      sourcePath: '/workspace/Page.tsx',
    };
    const initial = createConditionUiRuntime([], { descriptors: [] }, () => undefined, [
      outcome,
    ]).attachConditions({ roots: [componentNode('page', 'Page', '/workspace/Page.tsx', 2)] })
      .roots[0]?.children[0];
    const reached = createConditionUiRuntime(
      [
        {
          authoredEnabled: true,
          column: 10,
          effectiveEnabled: true,
          expression: 'session.user',
          expressionFingerprint: 'fingerprint-b',
          falsyLabel: 'hidden',
          id: 'runtime-b',
          kind: 'logical-and',
          line: 16,
          ownerName: 'Page',
          sourcePath: '/workspace/Page.tsx',
          truthyLabel: '<Panel>',
        },
      ],
      { descriptors: [] },
      () => undefined,
      [outcome],
    ).attachConditions({ roots: [componentNode('page', 'Page', '/workspace/Page.tsx', 2)] })
      .roots[0]?.children[0];

    expect(initial?.id).toBe('render-condition:logical-and:guard-b:1');
    expect(reached).toMatchObject({
      conditionId: 'runtime-b',
      id: initial?.id,
      props: { reached: true },
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

  /** Keeps a hidden controlled modal visible in the tree as a dormant overlay toggle. */
  it('labels overlay visibility controls independently from ordinary JSX branches', () => {
    const runtime = createConditionUiRuntime([
      {
        authoredEnabled: false,
        effectiveEnabled: false,
        expression: '<DeleteModal>.open: open',
        falsyLabel: 'hidden <DeleteModal> overlay',
        id: 'overlay-a',
        kind: 'overlay-visibility',
        line: 12,
        role: 'overlay',
        sourcePath: '/workspace/Page.tsx',
        truthyLabel: 'visible <DeleteModal> overlay',
      },
    ]);
    const snapshot = runtime.attachConditions({
      roots: [componentNode('page', 'Page', '/workspace/Page.tsx', 2)],
    });

    const overlay = snapshot.roots[0]?.children[0];
    expect(overlay?.name).toContain('Overlay · <DeleteModal>.open');
    expect(overlay).toMatchObject({
      overlayState: 'dormant',
      role: 'overlay',
    });
  });

  /** Marks only a target-path overlay as a blocker when its required visible branch is dormant. */
  it('marks a dormant overlay that blocks the current file', () => {
    const runtime = createConditionUiRuntime(
      [
        {
          authoredEnabled: false,
          effectiveEnabled: false,
          expression: '<CompanyRegisterModal>.open: open',
          falsyLabel: 'hidden <CompanyRegisterModal> overlay',
          id: 'overlay-target',
          kind: 'overlay-visibility',
          reachabilityKey: 'page:modal',
          role: 'overlay',
          sourcePath: '/workspace/Page.tsx',
          truthyLabel: 'visible <CompanyRegisterModal> overlay',
        },
      ],
      {
        conditionOnTargetPath: true,
        conditionTargetValue: true,
        descriptors: [],
        selectedCandidate: { id: 'candidate' },
        selectedDescriptor: { exportName: 'CompanyRegisterModal' },
        targetReachabilityByKey: new Map([['page:modal', { key: 'page:modal' }]]),
      },
    );

    const snapshot = runtime.attachConditions({
      roots: [componentNode('page', 'Page', '/workspace/Page.tsx', 2)],
    });

    expect(snapshot.roots[0]?.children[0]).toMatchObject({ blocksCurrentTarget: true });
  });

  /** Marks an ordinary logical gate only when path evidence proves the opposite value is required. */
  it('marks a source-proven target-path logical switch as blocking', () => {
    const runtime = createConditionUiRuntime(
      [
        {
          authoredEnabled: false,
          effectiveEnabled: false,
          expression: 'canRenderTarget',
          falsyLabel: 'hidden',
          id: 'target-gate',
          kind: 'logical-and',
          reachabilityKey: 'page:target',
          sourcePath: '/workspace/Page.tsx',
          truthyLabel: '<CurrentTarget>',
        },
      ],
      {
        conditionOnTargetPath: true,
        conditionTargetValue: true,
        descriptors: [],
        selectedCandidate: { id: 'candidate' },
        selectedDescriptor: { exportName: 'CurrentTarget' },
        targetReachabilityByKey: new Map([['page:target', { key: 'page:target' }]]),
      },
    );

    const snapshot = runtime.attachConditions({
      roots: [componentNode('page', 'Page', '/workspace/Page.tsx', 2)],
    });

    expect(snapshot.roots[0]?.children[0]).toMatchObject({
      blocksCurrentTarget: true,
      conditionId: 'target-gate',
    });
  });
});

/** Creates one analyzer edge for a guard shared by visible and short-circuited outcomes. */
function logicalCondition(
  groupId: string,
  expression: string,
  expressionFingerprint: string,
  guardIndex: number,
  branch: 'falsy' | 'truthy',
): Record<string, unknown> {
  return {
    branch,
    column: 10,
    expression,
    expressionFingerprint,
    id: groupId + ':' + branch,
    kind: 'logical-and',
    label: branch,
    line: 15 + guardIndex,
    logicalAndGroupId: groupId,
    logicalAndGuardCount: 2,
    logicalAndGuardIndex: guardIndex,
    selectable: true,
    sourcePath: '/workspace/Page.tsx',
  };
}

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
  outcomes: readonly Record<string, unknown>[] = [],
): ConditionUiRuntime {
  const context: {
    __conditionUiRuntime?: ConditionUiRuntime;
    conditions: readonly Record<string, unknown>[];
    outcomes: readonly Record<string, unknown>[];
    previewInspectorDevtoolsSessionState: Record<string, unknown>;
    previewInspectorSession: Record<string, unknown>;
    selectPreviewInspectorExport: (name: string) => void;
  } = {
    conditions,
    outcomes,
    previewInspectorDevtoolsSessionState: {},
    previewInspectorSession,
    selectPreviewInspectorExport,
  };
  vm.runInNewContext(
    `
      const readPreviewInspectorRenderConditions = () =>
        conditions.filter((condition) => condition.kind !== 'switch');
      const readPreviewInspectorRenderChoices = () =>
        conditions.filter((condition) => condition.kind === 'switch');
      const readPreviewInspectorStaticRenderOutcomes = () => outcomes;
      const normalizePreviewInspectorUiSource = (source) => source;
      const persistPreviewInspectorState = () => undefined;
      const requestPreviewInspectorTreeReveal = () => undefined;
      const notifyPreviewInspector = () => undefined;
      const schedulePreviewInspectorHighlight = () => undefined;
      const schedulePreviewInspectorTreeRefresh = () => undefined;
      const collectPreviewInspectorUiTreeSnapshot = () => ({ roots: [] });
      const findPreviewInspectorUiNodeByExport = () => undefined;
      const selectPreviewInspectorUiNode = () => undefined;
      const findSelectedPreviewInspectorDescriptor = () => previewInspectorSession.selectedDescriptor;
      const readSelectedPreviewInspectorPageCandidate = () => previewInspectorSession.selectedCandidate;
      const readPreviewInspectorTargetPathEvidence = () => ({});
      const isPreviewInspectorConditionOnTargetPath = () =>
        previewInspectorSession.conditionOnTargetPath === true;
      const readPreviewInspectorTargetConditionValue = () =>
        previewInspectorSession.conditionTargetValue;
      ${createPreviewInspectorConditionUiRuntimeSource()}
      globalThis.__conditionUiRuntime = {
        attachConditions: attachPreviewInspectorConditionsToSnapshot,
        isChoice: isPreviewInspectorRenderChoiceNode,
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
