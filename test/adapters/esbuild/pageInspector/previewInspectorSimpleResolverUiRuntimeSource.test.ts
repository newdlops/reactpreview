/** Verifies the compact resolver projection without mounting React or project application code. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorSimpleResolverUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorSimpleResolverUiRuntimeSource';
import { analyzePreviewReactRenderOutcomes } from '../../../../src/adapters/esbuild/staticResources/previewReactRenderOutcomes';

/** Minimal graph node accepted by the generated pure classifier. */
interface ResolverNode {
  readonly blocker?: Record<string, unknown>;
  readonly blockerId?: string;
  readonly blockerKind?: string;
  readonly children?: readonly ResolverNode[];
  readonly condition?: Record<string, unknown>;
  readonly id: string;
  readonly kind: string;
  readonly name: string;
}

/** One normalized data item retained by the user-facing Data card. */
interface ResolverDataItem {
  readonly id: string;
  readonly kind: string;
  readonly requiredPaths: readonly string[];
}

/** Pure projection returned before any React controls are created. */
interface ResolverModel {
  readonly automatic: {
    readonly diagnostics: readonly { readonly id: string; readonly kind: string }[];
    readonly summary: readonly string[];
  };
  readonly data: {
    readonly actionable: boolean;
    readonly items: readonly ResolverDataItem[];
    readonly kind: 'data';
    readonly policies: {
      readonly dataRequest: boolean;
      readonly runtimeFallback: boolean;
      readonly targetFailure?: ResolverDataItem;
    };
    readonly requiredPaths: readonly string[];
    readonly truncated: boolean;
  };
  readonly renderChoice: {
    readonly actionable: boolean;
    readonly kind: 'render-choice';
    readonly mode: 'automatic' | 'fixed' | 'selectable';
    readonly outcomes: readonly {
      readonly id: string;
      readonly label?: string;
      readonly memberIds?: readonly string[];
    }[];
    readonly switches: readonly {
      readonly conditionId: string;
      readonly enabled: boolean;
      readonly expression: string;
      readonly guardCount?: number;
      readonly guardIndex?: number;
      readonly id: string;
      readonly reached: boolean;
    }[];
  };
  readonly surfaces: readonly { readonly kind: string }[];
}

/** Evaluates the one-click mutation boundary with observable no-op runtime adapters. */
function evaluateSimpleResolverFill(calls: string[]): (model: unknown) => boolean {
  const context = vm.createContext({
    notifyPreviewInspector: () => calls.push('notify'),
    persistPreviewInspectorState: () => calls.push('persist'),
    schedulePreviewInspectorCommitRefresh: () => calls.push('commit'),
    schedulePreviewInspectorHighlight: () => calls.push('highlight'),
    schedulePreviewInspectorTreeRefresh: () => calls.push('tree'),
    setPreviewInspectorDataAutoEnabled: (enabled: boolean, commit: boolean) => {
      calls.push('data:' + String(enabled) + ':' + String(commit));
      return true;
    },
    setPreviewInspectorFallbackValuesEnabled: (enabled: boolean, commit: boolean) => {
      calls.push('fallback:' + String(enabled) + ':' + String(commit));
      return true;
    },
    smartFillPreviewInspectorTargetFailure: (
      failure: { readonly id?: string },
      commit: boolean,
    ) => {
      calls.push('target:' + String(failure.id) + ':' + String(commit));
      return true;
    },
  });
  vm.runInContext(
    `
      ${createPreviewInspectorSimpleResolverUiRuntimeSource()}
      globalThis.__fill = fillPreviewInspectorSimpleResolverData;
    `,
    context,
  );
  return (context as { __fill: (model: unknown) => boolean }).__fill;
}

/** Evaluates only the generated pure model and supplies the condition-node compatibility helper. */
function evaluateSimpleResolverModel(): (
  flow: { readonly graphNodes?: readonly unknown[]; readonly steps?: readonly unknown[] },
  outcomes?: readonly Record<string, unknown>[],
  conditions?: readonly Record<string, unknown>[],
) => ResolverModel {
  const context = vm.createContext({});
  const source = createPreviewInspectorSimpleResolverUiRuntimeSource();
  vm.runInContext(
    `
      const isPreviewInspectorConditionNode = (node) => node?.kind === 'condition';
      ${source}
      globalThis.__createModel = createPreviewInspectorSimpleResolverModel;
    `,
    context,
  );
  return (context as { __createModel: typeof evaluateSimpleResolverModel }).__createModel as never;
}

/** Creates one selectable runtime blocker with the shape used by blocker-flow graph steps. */
function blocker(
  id: string,
  blockerKind: string,
  metadata: Record<string, unknown> = {},
): ResolverNode {
  return {
    blocker: { id, ...metadata },
    blockerId: id,
    blockerKind,
    id: 'node:' + id,
    kind: 'blocker',
    name: blockerKind + ' ' + id,
  };
}

describe('Preview Inspector simple resolver UI runtime source', () => {
  /** Merges duplicate graph/step records and groups evidence-backed values into one card. */
  it('deduplicates all missing values into one Data surface', () => {
    const createModel = evaluateSimpleResolverModel();
    const hook = blocker('session', 'runtime-fallback', { requiredPaths: ['user.id'] });
    const request = blocker('dashboard', 'data-request', { requiredPaths: ['items'] });
    const targetError = blocker('card-error', 'target-error', {
      targetPropRequiredPaths: ['card.title'],
    });
    const reachability = blocker('page-path', 'target-reachability', {
      requiredPaths: ['session.role'],
    });

    const model = createModel({
      graphNodes: [hook, request, targetError, reachability],
      steps: [hook, request, { ...blocker('old-request', 'data-request'), resolution: 'resolved' }],
    });

    expect(model.surfaces.map((surface) => surface.kind)).toEqual(['data', 'render-choice']);
    expect(model.data.actionable).toBe(true);
    expect(model.data.items.map((item) => item.kind)).toEqual([
      'runtime-fallback',
      'data-request',
      'target-error',
    ]);
    expect(model.data.requiredPaths).toEqual(['user.id', 'items', 'card.title']);
    expect(model.automatic.diagnostics.map((diagnostic) => diagnostic.kind)).toContain(
      'target-reachability',
    );
  });

  /** Keeps branches and evidence-free failures visible as diagnostics without fabricating actions. */
  it('does not offer a data action for conditions or code errors without required paths', () => {
    const createModel = evaluateSimpleResolverModel();
    const condition: ResolverNode = {
      condition: { expression: 'ready' },
      id: 'condition:ready',
      kind: 'condition',
      name: 'ready',
    };
    const codeError = blocker('render-crash', 'target-error', {
      headline: 'ReferenceError: implementationBug is not defined',
      requiredPaths: ['implementationBug.value'],
    });
    const unprovenPath = blocker('unproven-path', 'target-reachability');

    const model = createModel({ steps: [condition, codeError, unprovenPath] });

    expect(model.data.actionable).toBe(false);
    expect(model.data.items).toHaveLength(0);
    expect(model.automatic.diagnostics.map((diagnostic) => diagnostic.kind)).toEqual([
      'condition',
      'target-error',
      'target-reachability',
    ]);
  });

  /** Requires prop-specific evidence before a target error can enter the automatic Data action. */
  it('does not treat generic target-error receiver paths as missing props', () => {
    const createModel = evaluateSimpleResolverModel();
    const model = createModel({
      steps: [
        blocker('hook-local-error', 'target-error', {
          requiredPaths: ['context.user.id'],
          targetPropRequiredPaths: [],
        }),
      ],
    });

    expect(model.data.items).toHaveLength(0);
    expect(model.automatic.diagnostics.map((diagnostic) => diagnostic.kind)).toEqual([
      'target-error',
    ]);
  });

  /** Prioritizes actionable blockers even when an oversized diagnostic render graph is retained. */
  it('does not let graph context consume the data-action budget', () => {
    const createModel = evaluateSimpleResolverModel();
    const graphNodes = Array.from({ length: 140 }, (_, index) => ({
      id: 'context:' + String(index),
      kind: 'component',
      name: 'Context' + String(index),
    }));

    const model = createModel({
      graphNodes,
      steps: [blocker('late-data', 'data-request', { requiredPaths: ['items'] })],
    });

    expect(model.data.items.map((item) => item.id)).toEqual(['data-request:late-data']);
  });

  /** Retains global policy detection when compact manual-editor inventory reaches its display cap. */
  it('handles data kinds discovered after the compact item limit', () => {
    const createModel = evaluateSimpleResolverModel();
    const fallbacks = Array.from({ length: 70 }, (_, index) =>
      blocker('hook-' + String(index), 'runtime-fallback'),
    );
    const model = createModel({
      steps: [...fallbacks, blocker('late-request', 'data-request')],
    });

    expect(model.data.items).toHaveLength(64);
    expect(model.data.policies.dataRequest).toBe(true);
    expect(model.data.policies.runtimeFallback).toBe(true);
    expect(model.data.truncated).toBe(true);
  });

  /** Coalesces repeated hook/request evidence and applies only the first exact target-prop repair. */
  it('uses bounded global policies instead of one render transaction per data record', () => {
    const calls: string[] = [];
    const fill = evaluateSimpleResolverFill(calls);

    expect(
      fill({
        data: {
          actionable: true,
          items: [
            { kind: 'runtime-fallback', node: { blocker: { id: 'hook-a' } } },
            { kind: 'runtime-fallback', node: { blocker: { id: 'hook-b' } } },
            { kind: 'data-request', node: { blocker: { id: 'request-a' } } },
            { kind: 'data-request', node: { blocker: { id: 'request-b' } } },
            { kind: 'target-error', node: { blocker: { id: 'target-a' } } },
            { kind: 'target-error', node: { blocker: { id: 'target-b' } } },
          ],
          policies: {
            dataRequest: true,
            runtimeFallback: true,
            targetFailure: {
              kind: 'target-error',
              node: { blocker: { id: 'target-a' } },
            },
          },
        },
      }),
    ).toBe(true);
    expect(calls).toEqual([
      'fallback:true:false',
      'data:true:false',
      'target:target-a:false',
      'persist',
      'notify',
      'highlight',
      'tree',
      'commit',
    ]);
  });

  /** Keeps expensive per-blocker editors unmounted until one manual value is explicitly selected. */
  it('lazy-mounts only one manual data editor', () => {
    const source = createPreviewInspectorSimpleResolverUiRuntimeSource();

    expect(source).toContain('manualOpen && selectedManualItem !== undefined');
    expect(source).toContain('model.data.actionable && showManualEditor');
    expect(source).toContain("'aria-label': 'Preview value to edit'");
    expect(source).toContain('node: selectedManualItem.node');
    expect(source).not.toContain(
      "model.data.items.map((item) => React.createElement(\n            'section'",
    );
  });

  /** Treats a single source-proven JSX return as fixed state rather than asking for a selection. */
  it('does not prompt when the current file has exactly one render outcome', () => {
    const createModel = evaluateSimpleResolverModel();
    const model = createModel({ steps: [] }, [
      { id: 'default:return:1', label: 'return <Dashboard />' },
    ]);

    expect(model.renderChoice.mode).toBe('fixed');
    expect(model.renderChoice.actionable).toBe(false);
    expect(model.renderChoice.outcomes).toHaveLength(1);
    expect(model.automatic.summary).toContain(
      'One source-proven JSX return is fixed automatically',
    );
  });

  /** Exposes one select only when static analysis proves multiple component-return alternatives. */
  it('makes only multiple JSX returns user-selectable', () => {
    const source = createPreviewInspectorSimpleResolverUiRuntimeSource();
    const createModel = evaluateSimpleResolverModel();
    const model = createModel({ steps: [] }, [
      { id: 'loading', label: 'return <Loading />' },
      { id: 'ready', label: 'return <Dashboard />' },
    ]);

    expect(model.renderChoice.mode).toBe('selectable');
    expect(model.renderChoice.actionable).toBe(true);
    expect(source).toContain("React.createElement('option', { value: '' }, 'Use authored result')");
    expect(source).toContain('? clearPreviewInspectorRenderOutcome()');
  });

  /** Collapses logical-AND outcome combinations and exposes each guard as a boolean switch. */
  it('models JSX logical-and guards as switches instead of duplicate return choices', () => {
    const createModel = evaluateSimpleResolverModel();
    const sourceIdentity = {
      column: 9,
      expression: 'showDetails',
      kind: 'logical-and',
      line: 8,
      sourcePath: '/workspace/Page.tsx',
    };
    const model = createModel(
      { steps: [] },
      [
        {
          componentNames: ['Page', 'Details'],
          conditions: [{ ...sourceIdentity, branch: 'truthy' }],
          exportName: 'Page',
          id: 'details-visible',
          label: 'Page and details',
        },
        {
          componentNames: ['Page'],
          conditions: [{ ...sourceIdentity, branch: 'falsy' }],
          exportName: 'Page',
          id: 'details-hidden',
          label: 'Page',
        },
      ],
      [
        {
          ...sourceIdentity,
          authoredEnabled: false,
          effectiveEnabled: true,
          falsyLabel: 'hidden',
          id: 'runtime-details',
          override: true,
          truthyLabel: '<Details>',
        },
      ],
    );

    expect(model.renderChoice.mode).toBe('fixed');
    expect(model.renderChoice.outcomes).toHaveLength(1);
    expect(model.renderChoice.outcomes[0]?.memberIds).toEqual([
      'details-visible',
      'details-hidden',
    ]);
    expect(model.renderChoice.switches).toMatchObject([
      {
        conditionId: 'runtime-details',
        enabled: true,
        expression: 'showDetails',
      },
    ]);
    expect(model.renderChoice.actionable).toBe(true);
  });

  /** Keeps stale same-prefix runtime guards separate until their full fingerprints agree. */
  it('joins logical guards by expression fingerprint before bounded source text', () => {
    const createModel = evaluateSimpleResolverModel();
    const staticCondition = {
      branch: 'truthy',
      column: 9,
      expression: `${'x'.repeat(179)}…`,
      expressionFingerprint: 'a'.repeat(64),
      kind: 'logical-and',
      line: 8,
      logicalAndGroupId: 'static-group',
      logicalAndGuardCount: 1,
      logicalAndGuardIndex: 0,
      sourcePath: '/workspace/Page.tsx',
    };
    const outcomes = [
      {
        componentNames: ['Panel'],
        conditions: [staticCondition],
        exportName: 'Page',
        id: 'panel-visible',
        label: 'Panel',
      },
    ];
    const runtimeCondition = {
      ...staticCondition,
      authoredEnabled: true,
      authoredExpression: staticCondition.expression,
      effectiveEnabled: true,
      expressionFingerprint: 'b'.repeat(64),
      id: 'runtime-stale-guard',
    };

    const staleModel = createModel({ steps: [] }, outcomes, [runtimeCondition]);
    expect(staleModel.renderChoice.switches).toHaveLength(2);
    expect(staleModel.renderChoice.switches.map((item) => item.reached)).toEqual([false, true]);

    const matchingModel = createModel({ steps: [] }, outcomes, [
      { ...runtimeCondition, expressionFingerprint: staticCondition.expressionFingerprint },
    ]);
    expect(matchingModel.renderChoice.switches).toHaveLength(1);
    expect(matchingModel.renderChoice.switches[0]?.reached).toBe(true);
  });

  /** Joins analyzer chain metadata with reached runtime state while retaining later static guards. */
  it('collapses a complete AND chain and shows short-circuited guards as read-only placeholders', () => {
    const createModel = evaluateSimpleResolverModel();
    const outcomes =
      analyzePreviewReactRenderOutcomes(
        '/workspace/Page.tsx',
        'export const Page = ({ allowed, ready }) => allowed && ready && <Panel />;',
      )[0]?.outcomes ?? [];
    const firstGuard = outcomes[0]?.conditions[0];
    expect(firstGuard).toBeDefined();

    const model = createModel(
      { steps: [] },
      outcomes as unknown as readonly Record<string, unknown>[],
      [
        {
          authoredEnabled: false,
          authoredExpression: firstGuard?.expression,
          column: firstGuard?.column,
          effectiveEnabled: false,
          expression: firstGuard?.expression,
          id: 'runtime-allowed',
          kind: 'logical-and',
          line: firstGuard?.line,
          sourcePath: firstGuard?.sourcePath,
          truthyLabel: '<Panel>',
        },
      ],
    );

    expect(model.renderChoice.mode).toBe('fixed');
    expect(model.renderChoice.outcomes).toHaveLength(1);
    expect(model.renderChoice.outcomes[0]?.memberIds).toHaveLength(3);
    expect(model.renderChoice.switches).toMatchObject([
      {
        conditionId: 'runtime-allowed',
        expression: 'allowed',
        guardCount: 2,
        guardIndex: 0,
        reached: true,
      },
      {
        conditionId: undefined,
        enabled: false,
        expression: 'ready',
        guardCount: 2,
        guardIndex: 1,
        reached: false,
      },
    ]);
  });

  /** Drops an outer hidden-only result while preserving inner component choices and switch groups. */
  it('does not expose a downstream-less AND short circuit as a rendered-component choice', () => {
    const createModel = evaluateSimpleResolverModel();
    const outcomes =
      analyzePreviewReactRenderOutcomes(
        '/workspace/NestedPage.tsx',
        'export const Page = ({ a, b, c }) => a && (b ? (c && <X />) : <Y />);',
      )[0]?.outcomes ?? [];

    const model = createModel(
      { steps: [] },
      outcomes as unknown as readonly Record<string, unknown>[],
      [],
    );

    expect(model.renderChoice.mode).toBe('selectable');
    expect(model.renderChoice.outcomes).toHaveLength(2);
    expect(model.renderChoice.outcomes.map((outcome) => outcome.label)).toEqual(
      expect.arrayContaining([expect.stringContaining('X'), expect.stringContaining('Y')]),
    );
    expect(
      model.renderChoice.outcomes.some((outcome) => outcome.label?.includes('Rendered JSX')),
    ).toBe(false);
    expect(model.renderChoice.switches.map((item) => item.expression)).toEqual(['a', 'c']);
    expect(model.renderChoice.switches.every((item) => !item.reached)).toBe(true);
  });

  /** Keeps one explanatory result when logical short circuits prove no non-empty render at all. */
  it('retains a single fixed result when every logical-and outcome is empty', () => {
    const createModel = evaluateSimpleResolverModel();
    const source = {
      branch: 'falsy',
      kind: 'logical-and',
      logicalAndGuardCount: 1,
      logicalAndGuardIndex: 0,
      sourcePath: '/workspace/Empty.tsx',
    };
    const model = createModel({ steps: [] }, [
      {
        componentNames: [],
        conditions: [{ ...source, column: 3, expression: 'a', logicalAndGroupId: 'group-a' }],
        exportName: 'Page',
        id: 'empty-a',
        kind: 'empty',
      },
      {
        componentNames: [],
        conditions: [{ ...source, column: 8, expression: 'b', logicalAndGroupId: 'group-b' }],
        exportName: 'Page',
        id: 'empty-b',
        kind: 'empty',
      },
    ]);

    expect(model.renderChoice.mode).toBe('fixed');
    expect(model.renderChoice.outcomes).toHaveLength(1);
    expect(model.renderChoice.outcomes[0]?.memberIds).toEqual(['empty-a', 'empty-b']);
  });

  /** Does not merge unrelated JSX sites merely because both are controlled only by logical AND. */
  it('keeps distinct logical-and return sites as separate rendered-component choices', () => {
    const createModel = evaluateSimpleResolverModel();
    const model = createModel({ steps: [] }, [
      {
        componentNames: ['FirstPanel'],
        conditions: [
          {
            branch: 'truthy',
            column: 10,
            expression: 'first',
            kind: 'logical-and',
            line: 4,
            sourcePath: '/workspace/Page.tsx',
          },
        ],
        exportName: 'Page',
        id: 'first-panel',
        label: 'return FirstPanel',
      },
      {
        componentNames: ['SecondPanel'],
        conditions: [
          {
            branch: 'truthy',
            column: 10,
            expression: 'second',
            kind: 'logical-and',
            line: 8,
            sourcePath: '/workspace/Page.tsx',
          },
        ],
        exportName: 'Page',
        id: 'second-panel',
        label: 'return SecondPanel',
      },
    ]);

    expect(model.renderChoice.mode).toBe('selectable');
    expect(model.renderChoice.outcomes).toHaveLength(2);
  });

  /** Keeps logical-AND controls out of automatic diagnostics and renders native switch semantics. */
  it('renders logical-and controls as accessible independent boolean switches', () => {
    const source = createPreviewInspectorSimpleResolverUiRuntimeSource();
    const createModel = evaluateSimpleResolverModel();
    const logicalNode: ResolverNode = {
      condition: { expression: 'open', kind: 'logical-and' },
      id: 'condition:open',
      kind: 'condition',
      name: 'open',
    };
    const model = createModel(
      { steps: [logicalNode] },
      [],
      [
        {
          authoredEnabled: false,
          effectiveEnabled: false,
          expression: 'open',
          id: 'open-switch',
          kind: 'logical-and',
          truthyLabel: '<Modal>',
        },
      ],
    );

    expect(model.automatic.diagnostics).toEqual([]);
    expect(source).toContain("role: 'switch'");
    expect(source).toContain("'aria-checked': item.enabled");
    expect(source).toContain('disabled: item.reached !== true');
    expect(source).toContain("'Not reached yet'");
    expect(source).toContain('setPreviewInspectorRenderConditionOverride(');
    expect(source).toContain('resetPreviewInspectorRenderConditionOverride(item.conditionId)');
  });
});
