import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createPreviewInspectorRouteSelectionPrefixProvider } from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteSelectionPrefixProvider';

interface FrozenState {
  readonly nested: { readonly value: string };
  readonly value: string;
}

const ROOT = { exportName: 'default', sourcePath: '/workspace/src/App.tsx' };
const PREFIX = [{ componentName: 'Shell', pattern: '/shell/*' }];

/** Copies and deeply freezes the small test state without mutating the caller's object. */
function freezeState(state: FrozenState): FrozenState {
  return Object.freeze({
    nested: Object.freeze({ value: state.nested.value }),
    value: state.value,
  });
}

describe('Preview Inspector route-selection prefix provider', () => {
  it('separates collision-prone exact keys while normalizing only the root source path', () => {
    const provider = createPreviewInspectorRouteSelectionPrefixProvider(freezeState);
    const cases = [
      { prefix: PREFIX, root: ROOT },
      { prefix: PREFIX, root: { ...ROOT, exportName: 'Named' } },
      { prefix: PREFIX, root: { ...ROOT, sourcePath: '/workspace/src/Other.tsx' } },
      {
        prefix: [{ componentName: 'Shell\0"]/,雪', pattern: '/a/[b]{"c"}\0/雪' }],
        root: ROOT,
      },
      {
        prefix: [
          { componentName: 'Shell', pattern: '/shell/*' },
          { componentName: 'Leaf', pattern: '/leaf' },
        ],
        root: ROOT,
      },
      { prefix: [{ componentName: 'Leaf', pattern: '/shell/*' }], root: ROOT },
      { prefix: [{ componentName: 'Shell', pattern: '/shell/../exact' }], root: ROOT },
      { prefix: [], root: ROOT },
    ] as const;

    cases.forEach(({ prefix, root }, index) => {
      expect(provider.lookup(root, prefix)).toBeUndefined();
      provider.retain(root, prefix, {
        nested: { value: `nested-${index.toString()}` },
        value: `state-${index.toString()}`,
      });
    });
    cases.forEach(({ prefix, root }, index) => {
      expect(provider.lookup(root, prefix)?.value).toBe(`state-${index.toString()}`);
    });
    expect(
      provider.lookup(
        { ...ROOT, sourcePath: path.join('/workspace/src/unused', '..', 'App.tsx') },
        PREFIX,
      )?.value,
    ).toBe('state-0');
    expect(provider.getStatistics()).toEqual({
      computations: cases.length,
      entries: cases.length,
      hits: cases.length + 1,
      released: false,
      requests: cases.length * 2 + 1,
    });
  });

  it('retains the first frozen copy, preserves miss accounting, and rejects freezer failures', () => {
    const freezer = vi.fn(freezeState);
    const provider = createPreviewInspectorRouteSelectionPrefixProvider(freezer);
    const input = { nested: { value: 'nested' }, value: 'first' };

    expect(provider.lookup(ROOT, PREFIX)).toBeUndefined();
    const retained = provider.retain(ROOT, PREFIX, input);
    input.nested.value = 'changed';
    input.value = 'changed';
    expect(retained).toEqual({ nested: { value: 'nested' }, value: 'first' });
    expect(Object.isFrozen(retained)).toBe(true);
    expect(Object.isFrozen(retained.nested)).toBe(true);
    expect(provider.retain(ROOT, PREFIX, { nested: { value: 'second' }, value: 'second' })).toBe(
      retained,
    );
    expect(freezer).toHaveBeenCalledOnce();
    expect(provider.lookup(ROOT, PREFIX)).toBe(retained);

    const uncacheable = [{ componentName: 'Missing', pattern: '/missing' }];
    expect(provider.lookup(ROOT, uncacheable)).toBeUndefined();
    expect(provider.lookup(ROOT, uncacheable)).toBeUndefined();
    const thrown = new Error('synthetic computation rejection');
    expect(provider.lookup(ROOT, [{ componentName: 'Throw', pattern: '/throw' }])).toBeUndefined();
    expect(() => {
      throw thrown;
    }).toThrow(thrown);
    expect(provider.lookup(ROOT, [{ componentName: 'Throw', pattern: '/throw' }])).toBeUndefined();

    const freezeFailure = new Error('synthetic freezer rejection');
    const rejecting = createPreviewInspectorRouteSelectionPrefixProvider<FrozenState>(() => {
      throw freezeFailure;
    });
    expect(rejecting.lookup(ROOT, PREFIX)).toBeUndefined();
    expect(() =>
      rejecting.retain(ROOT, PREFIX, { nested: { value: 'nested' }, value: 'value' }),
    ).toThrow(freezeFailure);
    expect(rejecting.getStatistics()).toEqual({
      computations: 1,
      entries: 0,
      hits: 0,
      released: false,
      requests: 1,
    });
    expect(rejecting.lookup(ROOT, PREFIX)).toBeUndefined();

    const statistics = provider.getStatistics();
    expect(statistics.requests).toBe(statistics.computations + statistics.hits);
    expect(statistics.entries).toBeLessThanOrEqual(statistics.computations);
    expect(Object.isFrozen(statistics)).toBe(true);
    expect(provider.getStatistics()).not.toBe(statistics);
  });

  it('releases idempotently and rejects post-release work before counters or freezing change', () => {
    const freezer = vi.fn(freezeState);
    const provider = createPreviewInspectorRouteSelectionPrefixProvider(freezer);
    expect(provider.lookup(ROOT, PREFIX)).toBeUndefined();
    provider.retain(ROOT, PREFIX, { nested: { value: 'nested' }, value: 'value' });
    expect(provider.getStatistics().entries).toBe(1);

    provider.release();
    provider.release();
    const released = provider.getStatistics();
    expect(released).toEqual({
      computations: 1,
      entries: 0,
      hits: 0,
      released: true,
      requests: 1,
    });
    expect(() => provider.lookup(ROOT, PREFIX)).toThrow('already released');
    expect(() =>
      provider.retain(ROOT, PREFIX, { nested: { value: 'other' }, value: 'other' }),
    ).toThrow('already released');
    expect(provider.getStatistics()).toEqual(released);
    expect(freezer).toHaveBeenCalledOnce();
  });
});
