/**
 * Verifies the GraphQL hook part of the collection fill: which generated hook values qualify, how
 * sample rows are added beside the cached value, and how a round serves and withdraws them.
 */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorRestCollectionFillRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRestCollectionFillRuntimeSource';

/** Default generated list size (`PREVIEW_GENERATED_LIST_DEFAULT_SAMPLE_COUNT`). */
const SAMPLE_COUNT = 3;
const KEY = 'candidate:default';
const LIST_PATH = 'data.viewer.projects.edges';

const PROJECTS_SHAPE = {
  fields: {
    viewer: {
      fields: {
        id: { kind: 'string' },
        projects: {
          fields: {
            edges: {
              items: {
                fields: {
                  node: {
                    fields: { id: { kind: 'string' }, name: { kind: 'string' } },
                    kind: 'object',
                  },
                },
                kind: 'object',
              },
              kind: 'array',
            },
          },
          kind: 'object',
        },
      },
      kind: 'object',
    },
  },
  kind: 'object',
};
const REACHED = {
  blockerSummary: { active: 0 },
  requirementSearch: { searchStatus: 'settled' },
  targetState: { hasOutput: true, stage: 'target-output', status: 'reached' },
};
const TARGET_ERROR = {
  ...REACHED,
  targetState: { ...REACHED.targetState, errorMessage: 'boom', status: 'target-error' },
};

interface Edge {
  readonly node: { readonly id: string; readonly name: string };
}

interface HookValue {
  readonly data: { readonly viewer: { readonly projects: { readonly edges: readonly Edge[] } } };
  readonly refetch: () => unknown;
}

describe('GraphQL hook collection selection', () => {
  /**
   * Only Auto values of this corridor whose rendered part holds a short list qualify: the list or
   * an ancestor came from the generated value, or whole generated items were added to an empty
   * authored list. A completed field inside an authored row does not qualify.
   */
  it('admits rendered one-row hook collections only', () => {
    const runtime = createRuntime([
      hook('child'),
      hook('threw', { generatedPaths: [], reason: 'threw' }),
      hook('mapped', { generatedPaths: ['loading', 'data.viewer.projects.edges.map()'] }),
      hook('listed', { generatedPaths: ['data.viewer.projects.edges[]'] }),
      hook('item', { generatedPaths: ['data.viewer.projects.edges.0', 'fallback'] }),
      hook('field', { generatedPaths: ['data.viewer.projects.edges.0.node.name'] }),
      hook('override'),
      hook('smart'),
      hook('elsewhere', { reachabilityKey: 'other:default' }),
      hook('authored', { generatedPaths: ['data.viewer.id'] }),
      hook('rows', { generatedPaths: ['data.viewer.projects.edges[].node.name'] }),
      hook('candidate', { reason: 'smart-candidate' }),
      hook('full', {}, [edge(1), edge(2), edge(3)]),
      hook('untracked', {}, [edge(1)], false),
    ]);
    runtime.session.runtimeFallbackOverrides.add('override');
    runtime.session.runtimeFallbackSmartIds.add('smart');

    const selected = runtime.call('selectPreviewInspectorHookCollectionFills') as readonly {
      readonly id: string;
      readonly paths: readonly string[];
    }[];

    expect(selected.map((item) => [item.id, item.paths])).toEqual([
      ['child', [LIST_PATH]],
      ['threw', [LIST_PATH]],
      ['mapped', [LIST_PATH]],
      ['listed', [LIST_PATH]],
      ['item', [LIST_PATH]],
    ]);
  });

  /** The cached value stays intact; only the list path is copied and identities never repeat. */
  it('copies only along the list path and skips colliding identities', () => {
    const runtime = createRuntime([hook('child'), hook('colliding', {}, [edge(2)])]);
    const base = runtime.values.get('child') as HookValue;

    const selected = runtime.call('selectPreviewInspectorHookCollectionFills') as readonly {
      readonly id: string;
      readonly value: HookValue;
    }[];
    const expanded = selected[0]?.value;

    expect(selected.map((item) => item.id)).toEqual(['child']);
    expect(expanded?.data.viewer.projects.edges.map((row) => row.node.id)).toEqual([
      'preview-1',
      'preview-2',
      'preview-3',
    ]);
    expect(expanded?.refetch).toBe(base.refetch);
    expect(expanded?.data.viewer.projects.edges[0]).toBe(base.data.viewer.projects.edges[0]);
    expect(Object.isFrozen(expanded)).toBe(true);
    expect(Object.isFrozen(expanded?.data.viewer)).toBe(true);
    expect(base.data.viewer.projects.edges).toHaveLength(1);
    expect(runtime.marked).toContain(expanded);
  });
});

describe('GraphQL hook collection rounds', () => {
  /** A round serves one stable copy, notifies hook consumers, and never changes REST profiles. */
  it('serves rows for the live round and withdraws them on a target error', () => {
    const runtime = createRuntime([hook('child')]);
    const base = runtime.values.get('child');
    const read = (id: string, value: unknown): unknown =>
      runtime.call('readPreviewInspectorCollectionFillHookValue', id, value);

    expect(runtime.call('observePreviewInspectorRestCollectionFill', REACHED)).toBe(true);
    expect(runtime.commits).toBe(1);
    expect(runtime.notifications).toBe(1);
    expect(runtime.decisions[0]?.generatedPaths).toEqual([
      'useQuery · Projects.' + LIST_PATH + '[]',
    ]);
    const served = read('child', base) as HookValue;
    expect(served.data.viewer.projects.edges).toHaveLength(SAMPLE_COUNT);
    expect(read('child', base)).toBe(served);
    expect(read('child', { recreated: true })).toEqual({ recreated: true });
    expect(read('other', base)).toBe(base);
    expect(runtime.call('readPreviewInspectorAutoPayloadProfile', 'child', 'authored-page')).toBe(
      'corridor-auto',
    );
    expect(runtime.call('isPreviewInspectorRestCollectionFillServing')).toBe(true);

    runtime.call('observePreviewInspectorRestCollectionFill', TARGET_ERROR);

    expect(read('child', base)).toBe(base);
    expect(runtime.notifications).toBe(2);
    expect(runtime.decisions[1]?.action).toBe('Withdraw REST collection rows');
  });

  /** Kept rows stay served for later rounds; a value turned Smart returns to its own rows. */
  it('keeps earlier hook rows when a late round is withdrawn', () => {
    const runtime = createRuntime([hook('child')]);
    const base = runtime.values.get('child');
    const rowCount = (id: string, value: unknown): number =>
      (runtime.call('readPreviewInspectorCollectionFillHookValue', id, value) as HookValue).data
        .viewer.projects.edges.length;
    runtime.call('observePreviewInspectorRestCollectionFill', REACHED);
    runtime.session.blockerTraceActiveAttempt = { settledAt: 1, traceId: 'settled' };
    runtime.advance(2_500);
    expect(runtime.session.restCollectionFill?.status).toBe('kept');

    runtime.addHook(hook('late'));
    const lateBase = runtime.values.get('late');
    expect(runtime.call('observePreviewInspectorRestCollectionFill', REACHED)).toBe(true);
    expect(rowCount('late', lateBase)).toBe(SAMPLE_COUNT);
    runtime.call('observePreviewInspectorRestCollectionFill', TARGET_ERROR);

    expect([rowCount('child', base), rowCount('late', lateBase)]).toEqual([SAMPLE_COUNT, 1]);
    runtime.session.runtimeFallbackSmartIds.add('child');
    expect(rowCount('child', base)).toBe(1);
  });
});

interface HookEntry {
  readonly evidence: boolean;
  readonly record: Record<string, unknown>;
  readonly value: HookValue;
}

interface HookSession {
  activeTargetReachabilityKey: string;
  blockerTraceActiveAttempt?: { readonly settledAt?: number; readonly traceId: string };
  restCollectionFill?: { readonly status: string };
  readonly runtimeFallbackOverrides: Set<string>;
  readonly runtimeFallbackSmartIds: Set<string>;
}

interface HookRuntime {
  addHook(entry: HookEntry): void;
  advance(milliseconds: number): void;
  call(name: string, ...args: unknown[]): unknown;
  readonly commits: number;
  readonly decisions: readonly Record<string, unknown>[];
  readonly marked: readonly unknown[];
  readonly notifications: number;
  readonly session: HookSession;
  readonly values: ReadonlyMap<string, unknown>;
}

/** Builds one generated edge as the Smart generator and the stubbed row generator create it. */
function edge(index: number): Edge {
  return Object.freeze({
    node: Object.freeze({
      id: `preview-${String(index)}`,
      name: index === 1 ? 'name' : `name ${String(index)}`,
    }),
  });
}

/** Builds one hook record (the page received `data.viewer.projects`) and its cached value. */
function hook(
  id: string,
  record: Readonly<Record<string, unknown>> = {},
  rows: readonly Edge[] = [edge(1)],
  evidence = true,
): HookEntry {
  const refetch = (): undefined => undefined;
  return {
    evidence,
    record: {
      generatedPaths: ['data.viewer.projects', 'fallback', 'error'],
      hookName: 'useQuery',
      id,
      mode: 'auto',
      reachabilityKey: KEY,
      reason: 'partial',
      ...record,
    },
    value: Object.freeze({
      data: Object.freeze({
        viewer: Object.freeze({
          id: 'preview-1',
          projects: Object.freeze({ edges: Object.freeze([...rows]) }),
        }),
      }),
      loading: false,
      refetch,
    }),
  };
}

/** Evaluates the fill module against stubbed hook records, values, and trace collaborators. */
function createRuntime(entries: readonly HookEntry[]): HookRuntime {
  const state = { clock: 10_000, commits: 0, notifications: 0 };
  const decisions: Record<string, unknown>[] = [];
  const marked: unknown[] = [];
  const timers: { readonly callback: () => void; readonly dueAt: number }[] = [];
  const evidence = new WeakMap<object, unknown>();
  const records = new Map<string, Record<string, unknown>>();
  const values = new Map<string, unknown>();
  const addHook = (entry: HookEntry): void => {
    const id = String(entry.record.id);
    records.set(id, entry.record);
    values.set(id, entry.value);
    if (entry.evidence) {
      evidence.set(entry.value, { operationName: 'Projects', shape: PROJECTS_SHAPE, typed: false });
    }
  };
  entries.forEach(addHook);
  const session = {
    activeTargetReachabilityKey: KEY,
    blockerTraceRecentFatalErrors: new Map(),
    dataAutoEnabled: true,
    dataPayloadOverrides: new Map(),
    dataRequests: new Map(),
    runtimeFallbackDataFlowRecommendations: new Map(),
    runtimeFallbackOverrides: new Set<string>(),
    runtimeFallbackSmartIds: new Set<string>(),
    runtimeFallbackValues: values,
    runtimeFallbacks: records,
  };
  const context = vm.createContext({
    Date: { now: () => state.clock },
    blockedInspectorPropNames: new Set(['__proto__', 'constructor', 'prototype']),
    commitPreviewInspectorDataChange: () => {
      state.commits += 1;
    },
    generatePreviewInspectorDataValue: () => [edge(1), edge(2), edge(3)],
    markPreviewInspectorGeneratedValue: (value: unknown) => {
      marked.push(value);
    },
    notifyPreviewInspectorRuntimeFallbackNeuralSubscribers: () => {
      state.notifications += 1;
      return 1;
    },
    previewEntryRevision: 1,
    previewInspectorSession: session,
    queueMicrotask: (callback: () => void) => {
      callback();
    },
    readPreviewGeneratedListSampleCount: () => SAMPLE_COUNT,
    readPreviewInspectorHookGraphqlRowEvidence: (value: unknown) =>
      typeof value === 'object' && value !== null ? evidence.get(value) : undefined,
    recordPreviewInspectorBlockerAutoDecision: (candidate: Record<string, unknown>) => {
      decisions.push(candidate);
      return `trace-${String(decisions.length)}`;
    },
    setTimeout: (callback: () => void, delay: number) => {
      timers.push({ callback, dueAt: state.clock + delay });
    },
    stringifyPreviewInspectorProps: (value: unknown) => JSON.stringify(value),
  });
  vm.runInContext(createPreviewInspectorRestCollectionFillRuntimeSource(), context);
  return {
    addHook,
    advance(milliseconds) {
      const until = state.clock + milliseconds;
      for (;;) {
        timers.sort((left, right) => left.dueAt - right.dueAt);
        const next = timers[0];
        if (next === undefined || next.dueAt > until) break;
        timers.shift();
        state.clock = next.dueAt;
        next.callback();
      }
      state.clock = until;
    },
    call: (name, ...args) => (context[name] as (...values: unknown[]) => unknown)(...args),
    get commits() {
      return state.commits;
    },
    decisions,
    marked,
    get notifications() {
      return state.notifications;
    },
    session,
    values,
  };
}
