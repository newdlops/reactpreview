/** Check stylesheet ownership and abort/failure cleanup without mutating the visible revision. */
import vm from 'node:vm';
import { createPreviewStyleSheetManagerRuntimeSource } from '../../../src/adapters/esbuild/previewStyleSheetManagerRuntimeSource';
import { describe, expect, it } from 'vitest';

interface Element {
  readonly children: Element[];
  parentNode: Element | undefined;
  appendChild(child: Element): void;
  removeChild(child: Element): void;
  setAttribute(key: string, value: string): void;
  querySelectorAll(selector: string): readonly Element[];
  readonly sheet?: { readonly cssRules: readonly string[] };
}

interface Boundary {
  activate(): void;
  commit(): void;
  createElement(child: unknown): { props: { target: Element }; child: unknown };
  dispose(): void;
  readStatus(): string;
}

interface Fixture {
  readonly head: Element;
  readonly foreign: Element;
  readonly health: { event: string; detail: Record<string, unknown> }[];
  readonly factory: (options?: unknown) => Boundary;
  readonly setActive: (boundary: unknown) => void;
}

/** A function component capability selects the modern branch without rendering CSS. */
function ModernManager(): null {
  return null;
}

/** Small DOM model: ownership, never CSS rendering, is the only fact established here. */
function element(): Element {
  return {
    children: [],
    parentNode: undefined,
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
    },
    removeChild(child) {
      this.children.splice(this.children.indexOf(child), 1);
      child.parentNode = undefined;
    },
    setAttribute() {
      return undefined;
    },
    querySelectorAll() {
      return this.children;
    },
  };
}

/** Evaluates the generated boundary against an explicit React/DOM capability. */
function fixture(manager: unknown = ModernManager, replacement = true): Fixture {
  const head = element();
  const foreign = element();
  head.appendChild(foreign);
  const health: { event: string; detail: Record<string, unknown> }[] = [];
  const context = vm.createContext({
    StyledComponents: { StyleSheetManager: manager },
    React: {
      createElement: (type: unknown, props: unknown, child: unknown) => ({
        type,
        props,
        child,
      }),
    },
    document: { head, createElement: () => element() },
  });
  context[Symbol.for('newdlops.react-file-preview.page-inspector') as unknown as string] = {
    recordRuntimeHealth: (event: (typeof health)[number]) => health.push(event),
  };
  const setActive = (boundary: unknown): void => {
    context[Symbol.for('newdlops.react-file-preview.hot-runtime') as unknown as string] = {
      activeStyleSheetBoundary: boundary,
    };
  };
  if (replacement) setActive({});
  const create = createPreviewStyleSheetManagerRuntimeSource();
  const factory = vm.runInContext(
    create.replaceAll('export function', 'function') + '\npreparePreviewStyleSheetBoundary',
    context,
  ) as Fixture['factory'];
  return { head, foreign, health, factory, setActive };
}

describe('revision-owned stylesheet lifecycle', () => {
  it('preserves modern document-default cold injection and creates a target only for replacement', () => {
    const { head, foreign, health, factory, setActive } = fixture(ModernManager, false);
    const cold = factory();
    expect(cold.createElement('first').props.target).toBeUndefined();
    cold.activate();
    expect(head.children).toEqual([foreign]);
    expect(health[0]?.detail).toMatchObject({
      targetMode: 'document-default',
      targetOwned: false,
    });
    setActive(cold);
    const hot = factory();
    const target = hot.createElement('second').props.target;
    expect(target).toBeDefined();
    expect(head.children).toEqual([foreign]);
    cold.dispose();
    hot.activate();
    expect(head.children).toEqual([foreign, target]);
    hot.dispose();
    expect(head.children).toEqual([foreign]);
  });
  it('replays authored forwarding and vendor options in their original layer order', () => {
    const { factory } = fixture();
    const forward = (): boolean => true;
    const plugin = (): undefined => undefined;
    const boundary = factory({
      plan: {
        version: 1,
        evidence: 'authored',
        ignoredReasons: [],
        sharedRuntimeChunk: true,
        layers: [
          {
            sourceKind: 'authored',
            shouldForwardProp: forward,
            enableVendorPrefixes: true,
            stylisPlugins: [plugin],
          },
          { sourceKind: 'authored', disableCSSOMInjection: true },
        ],
      },
    });
    const tree = boundary.createElement('page') as unknown as {
      props: Record<string, unknown>;
      child: { props: Record<string, unknown>; child: unknown };
    };
    expect(tree.props).toMatchObject({
      shouldForwardProp: forward,
      enableVendorPrefixes: true,
      stylisPlugins: [plugin],
    });
    expect(tree.props.target).toBeDefined();
    expect(tree.child.props).toEqual({ disableCSSOMInjection: true });
    expect(tree.child.child).toBe('page');
    boundary.dispose();
  });

  it('does not allocate a target when the project has no styled-components manager', () => {
    const { head, foreign, factory } = fixture(null);
    const boundary = factory();
    expect(boundary.createElement('page')).toBe('page');
    boundary.activate();
    boundary.dispose();
    expect(head.children).toEqual([foreign]);
  });
  it('keeps preparation detached and removes only its target after activation', () => {
    const { head, foreign, health, factory } = fixture();
    const boundary = factory();
    const tree = boundary.createElement('page');
    expect(tree.child).toBe('page');
    expect(tree.props.target).toBeDefined();
    expect(head.children).toEqual([foreign]);
    boundary.activate();
    boundary.activate();
    expect(head.children).toEqual([foreign, tree.props.target]);
    boundary.commit();
    boundary.commit();
    expect(health.filter((event) => event.event === 'styled-components-style-commit')).toHaveLength(
      1,
    );
    expect(
      health.find((event) => event.event === 'styled-components-boundary-composed')?.detail,
    ).toMatchObject({ targetMode: 'owned-modern', targetOwned: true });
    boundary.dispose();
    boundary.dispose();
    expect(head.children).toEqual([foreign]);
  });

  it('does not remove the committed styles when a replacement is abandoned', () => {
    const { head, factory } = fixture();
    const committed = factory();
    const first = committed.createElement('old');
    committed.activate();
    const pending = factory();
    const second = pending.createElement('new');
    expect(second.props.target).not.toBe(first.props.target);
    pending.dispose();
    expect(head.children).toContain(first.props.target);
    expect(head.children).not.toContain(second.props.target);
    committed.dispose();
  });

  it('preserves the legacy public target and leaves disabled or absent capabilities inert', () => {
    /** Legacy public context capability selects the existing v4 target branch. */
    class LegacyManager {
      /** Return an inert context because the fixture checks only capability detection. */
      getContext(): Record<string, never> {
        return {};
      }
    }
    const legacy = fixture(LegacyManager);
    const boundary = legacy.factory();
    boundary.createElement('page');
    boundary.activate();
    expect(legacy.health[0]?.detail).toMatchObject({
      targetMode: 'owned-legacy',
      targetOwned: true,
    });
    boundary.dispose();
    for (const manager of [ModernManager, null]) {
      const { head, foreign, factory } = fixture(manager);
      const disabled = factory({ configuration: false, configurationStatus: 'value' });
      expect(disabled.createElement('page')).toBe('page');
      disabled.activate();
      disabled.dispose();
      expect(head.children).toEqual([foreign]);
    }
  });
});
