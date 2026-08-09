/** Verifies active target-path search is presented as progress until it reaches a terminal state. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorBlockerUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorBlockerUiRuntimeSource';

interface RenderedElement {
  readonly children: readonly unknown[];
  readonly props: Record<string, unknown>;
  readonly type: string;
}

interface ProgressUiRuntime {
  readonly badge: (node: Record<string, unknown>) => string;
  readonly createNode: (blocker: Record<string, unknown>) => Record<string, unknown>;
  readonly isResolving: (blocker: Record<string, unknown>) => boolean;
  readonly renderDetail: (node: Record<string, unknown>) => RenderedElement;
  readonly renderGuide: (node: Record<string, unknown>) => RenderedElement;
}

describe('Preview Inspector target reachability progress UI', () => {
  it('shows active automatic search as status instead of a false terminal error', () => {
    const runtime = evaluateProgressUiRuntime();
    const blocker = createReachabilityBlocker({
      minimumRequirementSearch: {
        observedPathCount: 80,
        pass: 0,
        status: 'searching',
      },
      status: 'resuming-new-requirements',
    });
    const node = runtime.createNode(blocker);
    const detail = runtime.renderDetail({ node: { blocker } });
    const guide = runtime.renderGuide({
      node: { blocker, blockerKind: 'target-reachability' },
    });
    const text = collectRenderedText(detail).join(' ');

    expect(runtime.isResolving(blocker)).toBe(true);
    expect(node.name).toBe('Finding current file · default');
    expect(runtime.badge({ blocker, blockerKind: 'target-reachability' })).toBe(
      'searching page path',
    );
    expect(detail.children[0]).toMatchObject({
      props: { className: 'rpi-note', role: 'status' },
    });
    expect(text).toContain(
      'The page loaded. React Preview is still tracing the selected file on this path…',
    );
    expect(text).toContain('Current file: default · searching this page path');
    expect(text).not.toContain('The page loaded, but this path did not use default.');
    expect(collectRenderedText(guide).join(' ')).toContain(
      'React Preview is still tracing this page path.',
    );
    expect(guide.props['data-help-kind']).toBe('assisted');
    const buttons = collectElements(detail, 'button');
    expect(collectRenderedText(buttons[0]).join(' ')).toBe('Searching…');
    expect(buttons[0]?.props.disabled).toBe(true);
  });

  it('retains the error treatment after the bounded path search is exhausted', () => {
    const runtime = evaluateProgressUiRuntime();
    const blocker = createReachabilityBlocker({
      exhausted: true,
      minimumRequirementSearch: {
        observedPathCount: 80,
        pass: 4,
        status: 'settled',
      },
      status: 'page-blocked',
    });
    const node = runtime.createNode(blocker);
    const detail = runtime.renderDetail({ node: { blocker } });
    const guide = runtime.renderGuide({
      node: { blocker, blockerKind: 'target-reachability' },
    });
    const text = collectRenderedText(detail).join(' ');

    expect(runtime.isResolving(blocker)).toBe(false);
    expect(node.name).toBe('Current file not used · default');
    expect(runtime.badge({ blocker, blockerKind: 'target-reachability' })).toBe('page path');
    expect(detail.children[0]).toMatchObject({
      props: { className: 'rpi-error', role: 'alert' },
    });
    expect(text).toContain('The page loaded, but this path did not use default.');
    expect(collectRenderedText(guide).join(' ')).toContain(
      'This page path did not use the current file.',
    );
    expect(guide.props['data-help-kind']).toBe('flow-outcome');
  });

  it('treats the initial probe as progress before requirement evidence arrives', () => {
    const runtime = evaluateProgressUiRuntime();
    const blocker = createReachabilityBlocker({ status: 'probing' });

    expect(runtime.isResolving(blocker)).toBe(true);
    expect(runtime.createNode(blocker).name).toBe('Finding current file · default');
  });
});

/** Creates the common committed-page state used by progress and terminal-state assertions. */
function createReachabilityBlocker(
  overrides: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    applicationPath: ['Application', 'Page', 'default'],
    appliedConditions: [],
    directTarget: false,
    directTargetAvailable: true,
    exhausted: false,
    id: 'target-reachability:page:default',
    pageRootCommitted: true,
    requiredPaths: [],
    rootName: 'Application',
    targetExportName: 'default',
    targetHasOutput: false,
    targetMounted: false,
    ...overrides,
  };
}

/** Evaluates only the inert UI helpers; project React code is never imported or invoked. */
function evaluateProgressUiRuntime(): ProgressUiRuntime {
  const context: { __runtime?: ProgressUiRuntime } = {};
  vm.runInNewContext(
    `
      const React = {
        createElement: (type, props, ...children) => ({ children, props: props ?? {}, type }),
      };
      const PreviewInspectorDevtoolsButton = 'button';
      const PREVIEW_INSPECTOR_MINIMUM_REQUIREMENT_PASS_LIMIT = 8;
      const returnPreviewInspectorToPageContext = () => undefined;
      const retryPreviewInspectorTargetApplicationPath = () => undefined;
      const showPreviewInspectorTargetDirectly = () => undefined;
      const smartFillPreviewInspectorTargetApplicationPath = () => undefined;
      const isPreviewInspectorConditionNode = () => false;
      const normalizePreviewInspectorUiSource = (source) => ({
        line: source?.line,
        path: source?.path,
      });
      ${createPreviewInspectorBlockerUiRuntimeSource()}
      globalThis.__runtime = {
        badge: formatPreviewInspectorBlockerBadge,
        createNode: createPreviewInspectorTargetReachabilityTreeNode,
        isResolving: isPreviewInspectorTargetReachabilityResolving,
        renderDetail: PreviewInspectorTargetReachabilityDetail,
        renderGuide: PreviewInspectorBlockerGuide,
      };
    `,
    context,
  );
  if (context.__runtime === undefined) throw new Error('Progress UI fixture did not initialize.');
  return context.__runtime;
}

/** Flattens inert React fixture children into their user-visible text. */
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

/** Collects inert fixture elements with the requested host type. */
function collectElements(
  value: unknown,
  type: string,
  output: RenderedElement[] = [],
): RenderedElement[] {
  if (value === null || typeof value !== 'object') return output;
  const element = value as Partial<RenderedElement>;
  if (element.type === type && Array.isArray(element.children) && element.props !== undefined) {
    output.push(element as RenderedElement);
  }
  if (Array.isArray(element.children)) {
    for (const child of element.children) collectElements(child, type, output);
  }
  return output;
}
