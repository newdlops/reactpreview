/** Verifies render blockers are placed at their closest source-backed React owner. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorBlockerUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorBlockerUiRuntimeSource';
import { createPreviewInspectorConditionUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorConditionUiRuntimeSource';
import { createPreviewInspectorFailureEvidenceRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorFailureEvidenceRuntimeSource';

/** Data-only node contract needed for blocker ownership assertions. */
interface BlockerTreeNode {
  readonly blocksCurrentTarget?: boolean;
  readonly blockedOwner?: boolean;
  readonly blockerKind?: string;
  readonly children: readonly BlockerTreeNode[];
  readonly conditionId?: string;
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly props?: Record<string, unknown>;
}

/** Generated helper surface exposed only inside the VM fixture. */
interface BlockerRuntime {
  readonly attach: (snapshot: Record<string, unknown>) => { readonly roots: BlockerTreeNode[] };
  readonly createReachabilityNode: (blocker: Record<string, unknown>) => BlockerTreeNode;
  readonly isBlocking: (node: BlockerTreeNode) => boolean;
  readonly renderReachabilityDetail: (node: Record<string, unknown>) => unknown;
  readonly summarizeRequiredPaths: (paths: readonly string[]) => {
    readonly remainingCount: number;
    readonly totalCount: number;
    readonly visiblePaths: readonly string[];
  };
}

describe('Preview Inspector blocker UI runtime source', () => {
  /** Joins hook and backend dependencies into the same tree that owns their source expression. */
  it('attaches editable blockers below the nearest mounted component', () => {
    const runtime = evaluateBlockerRuntime();
    const snapshot = runtime.attach({
      roots: [
        {
          children: [
            {
              children: [],
              id: 'form',
              kind: 'function',
              name: 'FormSection',
              source: { line: 10, path: '/workspace/Page.tsx' },
            },
          ],
          id: 'page',
          kind: 'function',
          name: 'Page',
          exportName: 'Page',
          source: { line: 2, path: '/workspace/Page.tsx' },
        },
      ],
    });

    const form = findNode(snapshot.roots, 'FormSection');
    const page = findNode(snapshot.roots, 'Page');
    expect(form?.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          blockerKind: 'runtime-fallback',
          name: 'Missing hook value · useFormContext',
        }),
      ]),
    );
    const missingOwner = findNode(page?.children ?? [], 'UncollectedDashboardChild');
    expect(missingOwner).toMatchObject({ blockedOwner: true, name: 'UncollectedDashboardChild' });
    expect(missingOwner?.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          blockerKind: 'data-request',
          name: 'Backend data · Get dashboard',
        }),
      ]),
    );
    const brokenChild = findNode(page?.children ?? [], 'BrokenChild');
    expect(brokenChild).toMatchObject({ blockedOwner: true, name: 'BrokenChild' });
    expect(brokenChild?.children[0]).toMatchObject({
      blockerKind: 'target-error',
      props: { requiredPaths: ['value'] },
    });
    expect(findNode(snapshot.roots, 'Unlocated render blockers')).toBeUndefined();
    expect(findNode(snapshot.roots, 'Missing hook value · usePageAnalytics')).toBeUndefined();
    const hookNode = findNode(snapshot.roots, 'Missing hook value · useFormContext');
    const dataNode = findNode(snapshot.roots, 'Backend data · Get dashboard');
    expect(hookNode === undefined ? undefined : runtime.isBlocking(hookNode)).toBe(false);
    expect(dataNode === undefined ? undefined : runtime.isBlocking(dataNode)).toBe(false);
    const renderErrorNode = brokenChild?.children[0];
    if (renderErrorNode === undefined) throw new Error('Expected contained render-error blocker.');
    expect(runtime.isBlocking(renderErrorNode)).toBe(true);
    expect(
      runtime.isBlocking({
        blocksCurrentTarget: true,
        children: [],
        conditionId: 'modal',
        id: 'condition:modal',
        kind: 'condition',
        name: 'Overlay visibility',
      }),
    ).toBe(true);
  });

  /** Keeps manual JSON, minimum Smart fill, and broader Auto inference actions explicit. */
  it('emits manual pass-value, Smart fill, and Auto pass controls', () => {
    const source = createPreviewInspectorBlockerUiRuntimeSource();

    expect(source).toContain("'Apply pass value'");
    expect(source).toContain("'Smart fill minimum'");
    expect(source).toContain("'Smart fill and retry'");
    expect(source).toContain("'Find minimum requirements'");
    expect(source).toContain("'Minimum requirement search: pass '");
    expect(source).toContain('PREVIEW_INSPECTOR_MINIMUM_REQUIREMENT_PASS_LIMIT');
    expect(source).toContain("['cycle-detected', 'limit-reached']");
    expect(source).toContain("resolving ? 'Resolving…' : 'Find minimum requirements'");
    expect(source).toContain("'Auto pass'");
    expect(source).toContain('setPreviewInspectorRuntimeFallbackOverride');
    expect(source).toContain('smartFillPreviewInspectorRuntimeFallback');
    expect(source).toContain('smartFillPreviewInspectorTargetFailure');
    expect(source).toContain('refreshPreviewInspectorExport(failure.exportName)');
    expect(source).toContain('createPreviewInspectorSmartPropsDraft');
    expect(source).toContain('applyPreviewInspectorSmartProps');
    expect(source).toContain('autoPassPreviewInspectorRuntimeFallback');
    expect(source).toContain('creates one item only when a demanded path enters a list');
    expect(source).toContain("blockerKind: 'target-error'");
    expect(source).toContain("blockerKind: 'target-reachability'");
    expect(source).toContain('Payload properties discovered downstream (');
    expect(source).toContain('PREVIEW_INSPECTOR_REQUIRED_PATH_SUMMARY_LIMIT = 10');
    expect(source).toContain("'mounted · no host output'");
    expect(source).toContain('Rendering stops at this point in the component tree.');
    expect(source).toContain(
      'The authored page rendered without mounting this current-file component.',
    );
    expect(source).toContain("helpKind = 'flow-outcome'");
    expect(source).toContain('React Preview supplied a local preview value here.');
    expect(source).toContain('readPreviewInspectorActiveBlockerSummary');
  });

  /** Distinguishes a mounted-but-empty target and bounds its large downstream payload inventory. */
  it('reports mounted target output separately and summarizes required paths', () => {
    const runtime = evaluateBlockerRuntime();
    const paths = Array.from({ length: 14 }, (_, index) => 'usePreview.value' + String(index));
    const summary = runtime.summarizeRequiredPaths(paths);
    const blocker = {
      applicationPath: ['Application', 'Page', 'default'],
      appliedConditions: [],
      directTarget: false,
      id: 'target-reachability:page:default',
      minimumRequirementSearch: {
        cycleLength: 1,
        observedPathCount: paths.length,
        pass: 2,
        status: 'cycle-detected',
      },
      pageRootCommitted: true,
      requiredPaths: paths,
      rootName: 'Application',
      status: 'resolver-cycle-detected',
      targetExportName: 'default',
      targetHasOutput: false,
      targetMounted: true,
    };
    const treeNode = runtime.createReachabilityNode(blocker);
    const text = collectRenderedText(runtime.renderReachabilityDetail({ node: { blocker } })).join(
      ' ',
    );

    expect(treeNode.name).toBe('Target produced no host output · default');
    expect(summary).toMatchObject({ remainingCount: 4, totalCount: 14 });
    expect(summary.visiblePaths).toHaveLength(10);
    expect(text).toContain('mounted · no host output');
    expect(text).toContain('The selected target is mounted, but its authored JSX is still absent.');
    expect(text).toContain('Payload properties discovered downstream (14):');
    expect(text).toContain('· +4 more');
    expect(text).not.toContain('usePreview.value10');

    const wrapperBlocker = { ...blocker, targetHasAnyHostOutput: true };
    const wrapperNode = runtime.createReachabilityNode(wrapperBlocker);
    const wrapperText = collectRenderedText(
      runtime.renderReachabilityDetail({ node: { blocker: wrapperBlocker } }),
    ).join(' ');
    expect(wrapperNode.name).toBe('Target authored JSX absent · default');
    expect(wrapperText).toContain('wrapper/fallback host only · authored JSX absent');

    const deferredBlocker = { ...blocker, targetDeferredCallbackPending: true };
    const deferredNode = runtime.createReachabilityNode(deferredBlocker);
    const deferredText = collectRenderedText(
      runtime.renderReachabilityDetail({ node: { blocker: deferredBlocker } }),
    ).join(' ');
    expect(deferredNode.name).toBe('Render callback not invoked · default');
    expect(deferredText).toContain('mounted · render callback pending');
    expect(deferredText).toContain('receiver has not invoked the authored render callback');
    expect(deferredText).toContain('receiver must obtain its minimum payload');
  });
});

/** Evaluates attachment functions with fixed hook/data registries and no React project runtime. */
function evaluateBlockerRuntime(): BlockerRuntime {
  const context: { __blockers?: BlockerRuntime } = {};
  vm.runInNewContext(
    `
      const React = {
        createElement: (type, props, ...children) => ({ children, props, type }),
      };
      const PreviewInspectorDevtoolsButton = 'button';
      const PREVIEW_INSPECTOR_MINIMUM_REQUIREMENT_PASS_LIMIT = 8;
      const returnPreviewInspectorToPageContext = () => undefined;
      const retryPreviewInspectorTargetApplicationPath = () => undefined;
      const showPreviewInspectorTargetDirectly = () => undefined;
      const smartFillPreviewInspectorTargetApplicationPath = () => undefined;
      const previewInspectorSession = {
        boundariesByExport: new Map([['Page', new Set([{
          state: {
            componentStack: '\\n    at BrokenChild\\n    at Page',
            error: new TypeError("Cannot read properties of undefined (reading 'value')"),
          },
        }])]]),
        descriptors: [{ inspector: {
          target: { exportName: 'Page', sourcePath: '/workspace/Page.tsx' },
        } }],
        selectedExportName: 'Page',
      };
      const readPreviewInspectorRenderConditions = () => [];
      const readPreviewInspectorRenderChoices = () => [];
      const readPreviewInspectorTargetReachabilityBlockers = () => [];
      const readPreviewInspectorRuntimeFallbacks = () => [{
        evidence: 'required form value access',
        error: 'provider missing',
        fallbackPreview: '{"formikProps":{}}',
        generatedPaths: ['formikProps'],
        hookName: 'useFormContext',
        id: 'hook-form',
        line: 12,
        mode: 'auto',
        ownerName: 'FormSection',
        reason: 'threw',
        requiredPaths: ['formikProps.values.name'],
        sourcePath: '/workspace/Page.tsx',
      }, {
        error: 'analytics unavailable',
        fallbackPreview: 'undefined',
        generatedPaths: [],
        hookName: 'usePageAnalytics',
        id: 'hook-analytics',
        line: 4,
        mode: 'auto',
        ownerName: 'Page',
        passive: true,
        reason: 'threw',
        requiredPaths: [],
        sourcePath: '/workspace/Page.tsx',
      }];
      const readPreviewInspectorDataRequests = () => [{
        evidence: 'GraphQL selection',
        id: 'request-dashboard',
        label: 'Get dashboard',
        line: 3,
        mode: 'auto',
        ownerName: 'UncollectedDashboardChild',
        payload: {},
        shape: { fields: { dashboard: { kind: 'string' } }, kind: 'object' },
        sourcePath: '/workspace/Page.tsx',
      }];
      const createRuntimeErrorHeadline = (error) => error.message;
      const readPreviewInspectorFallbackValuesEnabled = () => true;
      const readPreviewInspectorDataShapePaths = () => ['dashboard'];
      const normalizePreviewInspectorUiSource = (source) => ({
        line: source?.line,
        path: source?.path,
      });
      ${createPreviewInspectorFailureEvidenceRuntimeSource()}
      ${createPreviewInspectorConditionUiRuntimeSource()}
      ${createPreviewInspectorBlockerUiRuntimeSource()}
      globalThis.__blockers = {
        attach: attachPreviewInspectorBlockersToSnapshot,
        createReachabilityNode: createPreviewInspectorTargetReachabilityTreeNode,
        isBlocking: isPreviewInspectorBlockingNode,
        renderReachabilityDetail: PreviewInspectorTargetReachabilityDetail,
        summarizeRequiredPaths: summarizePreviewInspectorRequiredPaths,
      };
    `,
    context,
  );
  if (context.__blockers === undefined) throw new Error('Blocker UI fixture did not initialize.');
  return context.__blockers;
}

/** Flattens the inert React fixture tree into user-visible text without interpreting components. */
function collectRenderedText(value: unknown, output: string[] = []): string[] {
  if (typeof value === 'string' || typeof value === 'number') {
    output.push(String(value));
    return output;
  }
  if (value === null || typeof value !== 'object') return output;
  const children = (value as { readonly children?: readonly unknown[] }).children;
  if (!Array.isArray(children)) return output;
  for (const child of children) collectRenderedText(child, output);
  return output;
}

/** Finds one named node recursively without retaining any runtime owner object. */
function findNode(nodes: readonly BlockerTreeNode[], name: string): BlockerTreeNode | undefined {
  for (const node of nodes) {
    if (node.name === name) return node;
    const child = findNode(node.children, name);
    if (child !== undefined) return child;
  }
  return undefined;
}
