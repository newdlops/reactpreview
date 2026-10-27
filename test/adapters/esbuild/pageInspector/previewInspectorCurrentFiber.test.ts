/** Exercises committed boundary selection when React reuses return links across alternate trees. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorFiberRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorFiberRuntimeSource';

/** Minimal own-data Fiber shape, deliberately allowing inconsistent bailout return pointers. */
interface Fiber {
  alternate?: Fiber;
  child?: Fiber;
  return?: Fiber;
  sibling?: Fiber;
  stateNode?: unknown;
  tag: number;
  type?: unknown;
  memoizedState?: unknown;
}

/** Read-only UI output sufficient to verify committed sibling state through the full collector. */
interface TreeNode {
  readonly children: TreeNode[];
  readonly name: string;
  readonly state: unknown;
}

/** Loads the complete collector while keeping all authored execution and host access inert. */
function createCollector(): (boundaries: readonly unknown[]) => { roots: TreeNode[] } {
  const context: { collect?: (boundaries: readonly unknown[]) => { roots: TreeNode[] } } = {};
  vm.runInNewContext(
    `${createPreviewInspectorFiberRuntimeSource()}
function normalizePreviewInspectorHostElement() { return undefined; }
function hasPreviewInspectorOwnedBoundary() { return false; }
function readPreviewInspectorOwnedHosts() { return []; }
globalThis.collect = collectPreviewInspectorFiberTree;`,
    context,
  );
  if (context.collect === undefined) throw new Error('Fiber collector did not initialize.');
  return context.collect;
}

/** Evaluates the real generated adapter without running authored React components. */
function createReader(): (boundary: unknown) => unknown {
  const context: { read?: (boundary: unknown) => unknown } = {};
  vm.runInNewContext(
    `${createPreviewInspectorFiberRuntimeSource()}\nglobalThis.read = readPreviewInspectorBoundaryFiber;`,
    context,
  );
  if (context.read === undefined) throw new Error('Current Fiber reader did not initialize.');
  return context.read;
}

/** Creates paired committed trees whose boundary return links both refer to the old parent. */
function createSharedReturnFixture(): {
  boundary: { _reactInternals: Fiber };
  committed: Fiber;
  committedParent: Fiber;
  committedRoot: Fiber;
  rootState: { current: Fiber };
  stale: Fiber;
  staleParent: Fiber;
  staleRoot: Fiber;
} {
  const staleRoot: Fiber = { tag: 3 };
  const committedRoot: Fiber = { tag: 3 };
  const rootState = { current: committedRoot };
  staleRoot.stateNode = rootState;
  committedRoot.stateNode = rootState;
  staleRoot.alternate = committedRoot;
  committedRoot.alternate = staleRoot;
  const staleParent: Fiber = { tag: 0, return: staleRoot };
  const committedParent: Fiber = { tag: 0, return: committedRoot };
  staleParent.alternate = committedParent;
  committedParent.alternate = staleParent;
  staleRoot.child = staleParent;
  committedRoot.child = committedParent;
  const stale: Fiber = { tag: 1, return: staleParent, child: { tag: 5 } };
  const committed: Fiber = { tag: 1, return: staleParent, child: { tag: 5 } };
  stale.alternate = committed;
  committed.alternate = stale;
  staleParent.child = stale;
  committedParent.child = committed;
  const boundary = { _reactInternals: stale };
  stale.stateNode = boundary;
  committed.stateNode = boundary;
  return {
    boundary,
    committed,
    committedParent,
    committedRoot,
    rootState,
    stale,
    staleParent,
    staleRoot,
  };
}

describe('committed Inspector boundary Fiber', () => {
  it('follows committed child membership when both alternates return through the stale tree', () => {
    const read = createReader();
    const fixture = createSharedReturnFixture();

    expect(read(fixture.boundary)).toBe(fixture.committed);
    fixture.rootState.current = fixture.staleRoot;
    expect(read(fixture.boundary)).toBe(fixture.stale);
    fixture.rootState.current = fixture.committedRoot;
    expect(read(fixture.boundary)).toBe(fixture.committed);
  });

  it('keeps a shared bailout child stable when only the ancestor root alternates', () => {
    const read = createReader();
    const fixture = createSharedReturnFixture();
    fixture.staleParent.child = fixture.committed;
    fixture.committedParent.child = fixture.committed;

    expect(read(fixture.boundary)).toBe(fixture.committed);
    fixture.rootState.current = fixture.staleRoot;
    expect(read(fixture.boundary)).toBe(fixture.committed);
  });

  it('does not report a detached candidate as committed just because its return root is current', () => {
    const read = createReader();
    const fixture = createSharedReturnFixture();
    fixture.rootState.current = fixture.staleRoot;
    fixture.staleParent.child = { tag: 0 };
    fixture.committedParent.child = { tag: 0 };

    expect(read(fixture.boundary)).toBeUndefined();
  });

  it('does not accept a detached boundary through a corrupt HostRoot sibling link', () => {
    const read = createReader();
    const fixture = createSharedReturnFixture();
    fixture.committedRoot.child = { tag: 0 };
    fixture.committedRoot.sibling = fixture.committed;

    expect(read(fixture.boundary)).toBeUndefined();
  });

  it('reaches an early target subtree before inspecting unrelated later siblings', () => {
    const read = createReader();
    const fixture = createSharedReturnFixture();
    const wrapper: Fiber = { tag: 0, child: fixture.committed, return: fixture.committedParent };
    fixture.committed.return = wrapper;
    fixture.committedParent.child = wrapper;
    let previous = wrapper;
    for (let index = 0; index < 4094; index += 1) {
      const sibling: Fiber = { tag: 0, return: fixture.committedParent };
      previous.sibling = sibling;
      previous = sibling;
    }

    expect(read(fixture.boundary) === fixture.committed).toBe(true);
  });

  it('collects current sibling state when a shared boundary still returns through an old export', () => {
    const collect = createCollector();
    const fixture = createSharedReturnFixture();
    const named = (name: string, tag = 0): Fiber => ({ tag, type: { displayName: name } });
    const oldExport = named('PreviewPageInspectorExportBoundary');
    const newExport = named('PreviewPageInspectorExportBoundary');
    const oldPage = named('Page');
    const newPage = named('Page');
    const oldCounter = named('Counter', 1);
    const newCounter = named('Counter', 1);
    oldCounter.memoizedState = { count: 1 };
    newCounter.memoizedState = { count: 2 };
    oldExport.alternate = newExport;
    newExport.alternate = oldExport;
    oldPage.alternate = newPage;
    newPage.alternate = oldPage;
    fixture.staleRoot.child = oldExport;
    fixture.committedRoot.child = newExport;
    oldExport.return = fixture.staleRoot;
    newExport.return = fixture.committedRoot;
    oldExport.child = oldPage;
    newExport.child = newPage;
    oldPage.return = oldExport;
    newPage.return = newExport;
    oldPage.child = fixture.staleParent;
    newPage.child = fixture.committedParent;
    fixture.staleParent.return = oldPage;
    fixture.committedParent.return = newPage;
    fixture.staleParent.sibling = oldCounter;
    fixture.committedParent.sibling = newCounter;
    oldCounter.return = oldPage;
    newCounter.return = newPage;
    fixture.staleParent.child = fixture.committed;
    fixture.committedParent.child = fixture.committed;
    fixture.committed.return = fixture.staleParent;

    const counterState = (): unknown => {
      const pending = [...collect([fixture.boundary]).roots];
      while (pending.length > 0) {
        const node = pending.pop();
        if (node?.name === 'Counter') return node.state;
        if (node !== undefined) pending.push(...node.children);
      }
      return undefined;
    };
    expect(counterState()).toEqual({ count: 2 });
    fixture.rootState.current = fixture.staleRoot;
    expect(counterState()).toEqual({ count: 1 });
    fixture.rootState.current = fixture.committedRoot;
    expect(counterState()).toEqual({ count: 2 });
  });

  it('skips unrelated subtrees and never invokes private-link accessors', () => {
    const read = createReader();
    const fixture = createSharedReturnFixture();
    let getterReads = 0;
    const unrelated: Fiber = { tag: 0, sibling: fixture.committedParent };
    Object.defineProperty(unrelated, 'child', {
      get() {
        getterReads += 1;
        throw new Error('Unrelated authored subtree must not be inspected.');
      },
    });
    fixture.committedRoot.child = unrelated;

    expect(read(fixture.boundary)).toBe(fixture.committed);
    Object.defineProperty(fixture.committedParent, 'child', {
      get() {
        getterReads += 1;
        throw new Error('Private Fiber getters must not execute.');
      },
    });
    expect(read(fixture.boundary)).toBeUndefined();
    expect(getterReads).toBe(0);
  });

  it('terminates on corrupt sibling and ancestry cycles', () => {
    const read = createReader();
    const fixture = createSharedReturnFixture();
    const cycle: Fiber = { tag: 0 };
    cycle.sibling = cycle;
    fixture.committedRoot.child = cycle;

    expect(read(fixture.boundary)).toBeUndefined();
    fixture.stale.return = fixture.stale;
    fixture.committed.return = fixture.committed;
    expect(read(fixture.boundary)).toBe(fixture.stale);
  });

  it('preserves the child-bearing legacy fallback when no supported root is observable', () => {
    const read = createReader();
    const primary: Fiber = { tag: 1 };
    const alternate: Fiber = { tag: 1, child: { tag: 5 } };
    primary.alternate = alternate;
    alternate.alternate = primary;

    expect(read({ _reactInternalFiber: primary })).toBe(alternate);
  });
});
