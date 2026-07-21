/** Verifies that wrapper fallback DOM cannot masquerade as the selected file's authored JSX. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorTargetOutputRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetOutputRuntimeSource';

/** Minimal synthetic Fiber used to express component ownership without mounting React. */
interface TestFiber {
  readonly child?: TestFiber;
  readonly kind: string;
  readonly name: string;
  readonly sibling?: TestFiber;
}

/** Evaluates one selected outcome against a live boundary-shaped component tree. */
function hasResolvedOutput(
  componentTree: readonly Record<string, unknown>[],
  liveChild: TestFiber | undefined,
  options: { readonly host?: boolean; readonly includePlan?: boolean } = {},
): boolean {
  const outcome = {
    componentTree,
    exportName: 'default',
    id: 'selected-outcome',
    kind: 'jsx',
  };
  const context: {
    __host: boolean;
    __includePlan: boolean;
    __liveChild: TestFiber | undefined;
    __outcome: typeof outcome;
    __result?: boolean;
  } = {
    __host: options.host !== false,
    __includePlan: options.includePlan !== false,
    __liveChild: liveChild,
    __outcome: outcome,
  };
  vm.runInNewContext(
    `
      const outcome = globalThis.__outcome;
      const liveChild = globalThis.__liveChild;
      const descriptor = { inspector: { renderOutcomesByExport: {
        default: globalThis.__includePlan ? { outcomes: [outcome] } : undefined,
      } } };
      const findSelectedPreviewInspectorDescriptor = () => descriptor;
      const readPreviewInspectorSelectedRenderOutcome = () => outcome;
      const readPreviewInspectorBoundaryFiber = (boundary) => boundary.fiber;
      const readPreviewInspectorFiberLink = (fiber, name) => fiber?.[name];
      const classifyPreviewInspectorFiber = (fiber) => fiber?.kind ?? 'other';
      const namePreviewInspectorFiber = (fiber) => fiber?.name ?? 'Anonymous';
      const isPreviewInspectorOwnedFiber = () => false;
      const collectPreviewInspectorFiberElements = (boundary) => boundary.host ? [{}] : [];
      ${createPreviewInspectorTargetOutputRuntimeSource()}
      globalThis.__result = hasPreviewInspectorResolvedTargetOutput(
        { fiber: { child: liveChild }, host: globalThis.__host },
        { targetExportName: 'default' },
      );
    `,
    context,
  );
  return context.__result === true;
}

describe('Preview Inspector target output runtime source', () => {
  /** A loader host below QueryRenderer is not the Page subtree authored by the current file. */
  it('rejects wrapper fallback DOM when the expected nested page components are absent', () => {
    const expected = [
      {
        children: [
          {
            children: [{ children: [], name: 'PageHeader' }],
            name: 'Page',
          },
        ],
        name: 'QueryRenderer',
      },
    ];
    const live = {
      child: { kind: 'function', name: 'Loader' },
      kind: 'function',
      name: 'QueryRenderer',
    };

    expect(hasResolvedOutput(expected, live)).toBe(false);
  });

  /** The same boundary becomes ready after a nested authored component reaches the live Fiber. */
  it('accepts host output after the expected page descendant mounts', () => {
    const expected = [
      {
        children: [{ children: [{ children: [], name: 'PageHeader' }], name: 'Page' }],
        name: 'QueryRenderer',
      },
    ];
    const live = {
      child: { child: { kind: 'function', name: 'PageHeader' }, kind: 'function', name: 'Page' },
      kind: 'function',
      name: 'QueryRenderer',
    };

    expect(hasResolvedOutput(expected, live)).toBe(true);
  });

  /** Preserves ordinary host semantics when older descriptors contain no outcome evidence. */
  it('falls back to connected host output when no static outcome plan exists', () => {
    expect(hasResolvedOutput([], undefined, { includePlan: false })).toBe(true);
    expect(hasResolvedOutput([], undefined, { host: false, includePlan: false })).toBe(false);
  });
});
