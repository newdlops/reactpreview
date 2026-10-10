/**
 * Verifies the post-reach REST collection fill: which requests qualify, which payload profile each
 * request is served with, and the single fill → keep/withdraw cycle per entry revision and export.
 */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorDataRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorDataRuntimeSource';
import { createPreviewInspectorHookGraphqlRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorHookGraphqlRuntimeSource';
import { createPreviewInspectorNeuralResidualRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';
import { createPreviewInspectorRestCollectionFillRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRestCollectionFillRuntimeSource';
import { createPreviewGeneratedListRuntimeSource } from '../../../../src/adapters/esbuild/previewGeneratedListRuntimeSource';

/** Default generated list size (`PREVIEW_GENERATED_LIST_DEFAULT_SAMPLE_COUNT`). */
const DEFAULT_SAMPLE_COUNT = 3;

const ORDER_SHAPE = {
  fields: {
    items: {
      items: {
        fields: {
          id: { kind: 'string' },
          tags: { items: { fields: { name: { kind: 'string' } }, kind: 'object' }, kind: 'array' },
        },
        kind: 'object',
      },
      kind: 'array',
    },
    total: { kind: 'number' },
  },
  kind: 'object',
};
const GUESSED_SHAPE = { fields: { guessed: { kind: 'string' } }, kind: 'object' };
const REACHED = {
  blockerSummary: { active: 0 },
  requirementSearch: { searchStatus: 'settled' },
  targetState: { hasOutput: true, stage: 'target-output', status: 'reached' },
};
const TARGET_ERROR = {
  ...REACHED,
  targetState: { ...REACHED.targetState, errorMessage: 'boom', status: 'target-error' },
};
const LOADING = {
  blockerSummary: { active: 1 },
  requirementSearch: { searchStatus: 'settled' },
  targetState: { hasOutput: false, stage: 'target-mounted-no-output', status: 'reached' },
};

describe('REST collection fill selection and profile', () => {
  /** Only outer arrays with declared object items qualify; nested lists stay corridor-empty. */
  it('lists outermost structured collections', () => {
    const runtime = createRuntime();

    expect(runtime.call('readPreviewInspectorStructuredCollectionPaths', ORDER_SHAPE)).toEqual([
      'items',
    ]);
    expect(
      runtime.call('readPreviewInspectorStructuredCollectionPaths', {
        items: { fields: { id: { kind: 'string' } }, kind: 'object' },
        kind: 'array',
      }),
    ).toEqual(['']);
    expect(
      runtime.call('readPreviewInspectorStructuredCollectionPaths', {
        items: { kind: 'unknown' },
        kind: 'array',
      }),
    ).toEqual([]);
  });

  /** Guesses, user payloads, GraphQL, filled lists, and error scenarios never qualify. */
  it('selects only successful REST requests served with empty declared collections', () => {
    const runtime = createRuntime({
      requests: [
        request('typed', { items: [], total: 0 }),
        request('override', { items: [], total: 0 }),
        request('graphql', { items: [], total: 0 }, { kind: 'graphql' }),
        request('guessed', { guessed: '' }, { shape: GUESSED_SHAPE }),
        request('filled', { items: [{ id: '1', tags: [] }], total: 1 }),
        request('failing', { items: [], total: 0 }),
      ],
      overrides: ['override'],
      scenarios: { failing: 'error' },
    });

    const selected = runtime.call('selectPreviewInspectorRestCollectionFillRequests') as readonly {
      readonly id: string;
    }[];

    expect(selected.map((item) => item.id)).toEqual(['typed']);
  });

  /** Rows are served only to admitted requests of the current revision, and only in a corridor. */
  it('chooses the payload profile per request and fill state', () => {
    const runtime = createRuntime();
    const session = runtime.session;

    session.activeTargetReachabilityKey = undefined;
    expect(runtime.call('readPreviewInspectorAutoPayloadProfile', 'typed', 'file-components')).toBe(
      'auto',
    );
    session.activeTargetReachabilityKey = 'candidate:default';
    expect(runtime.call('readPreviewInspectorAutoPayloadProfile', 'typed', 'authored-page')).toBe(
      'corridor-auto',
    );
    const fill: FillState = {
      reachabilityKey: 'candidate:default',
      requestIds: new Set(['typed']),
      revision: 1,
      status: 'applied',
    };
    session.restCollectionFill = fill;
    expect(runtime.call('readPreviewInspectorAutoPayloadProfile', 'typed', 'authored-page')).toBe(
      'corridor-rows',
    );
    expect(runtime.call('readPreviewInspectorAutoPayloadProfile', 'other', 'authored-page')).toBe(
      'corridor-auto',
    );
    fill.revision = 2;
    expect(runtime.call('readPreviewInspectorAutoPayloadProfile', 'typed', 'authored-page')).toBe(
      'corridor-auto',
    );
  });
});

describe('REST collection fill cycle', () => {
  /** Reach starts one attempt; rows that stay healthy through a quiet window are kept for good. */
  it('keeps rows once the page is quiet and does not start a second attempt', () => {
    const runtime = createRuntime({ requests: [request('typed', { items: [], total: 0 })] });

    expect(runtime.call('observePreviewInspectorRestCollectionFill', REACHED)).toBe(true);
    expect(runtime.commits).toBe(1);
    expect(runtime.decisions[0]).toMatchObject({
      mode: 'rest-collection-auto',
      startsRenderAttempt: true,
    });
    expect(runtime.session.restCollectionFill?.status).toBe('applied');

    // The remount's attempt stays open: the quiet window cannot start.
    runtime.session.blockerTraceActiveAttempt = { traceId: 'trace-1' };
    expect(runtime.call('observePreviewInspectorRestCollectionFill', REACHED)).toBe(false);
    runtime.advance(3_000);
    expect(runtime.session.restCollectionFill?.status).toBe('applied');

    runtime.session.blockerTraceActiveAttempt = { settledAt: 1, traceId: 'trace-1' };
    expect(runtime.call('observePreviewInspectorRestCollectionFill', REACHED)).toBe(false);
    runtime.advance(1_900);
    expect(runtime.session.restCollectionFill?.status).toBe('applied');
    runtime.advance(300);

    expect(runtime.session.restCollectionFill?.status).toBe('kept');
    expect(runtime.call('observePreviewInspectorRestCollectionFill', REACHED)).toBe(false);
    expect(runtime.commits).toBe(1);
  });

  /** A remount's loading state is not a verdict; the latest quiet snapshot decides. */
  it('tolerates transitional snapshots before the page is quiet', () => {
    const runtime = createRuntime({ requests: [request('typed', { items: [], total: 0 })] });
    runtime.call('observePreviewInspectorRestCollectionFill', REACHED);
    runtime.session.blockerTraceActiveAttempt = { settledAt: 1, traceId: 'trace-1' };

    expect(runtime.call('observePreviewInspectorRestCollectionFill', LOADING)).toBe(false);
    runtime.advance(1_000);
    expect(runtime.call('observePreviewInspectorRestCollectionFill', REACHED)).toBe(false);
    runtime.advance(2_500);

    expect(runtime.session.restCollectionFill?.status).toBe('kept');
    expect(runtime.commits).toBe(1);
  });

  /** A target error withdraws the rows at once; the revision and corridor stay final. */
  it('withdraws rows immediately when the target errors', () => {
    const runtime = createRuntime({ requests: [request('typed', { items: [], total: 0 })] });
    runtime.call('observePreviewInspectorRestCollectionFill', REACHED);

    expect(
      runtime.call('observePreviewInspectorRestCollectionFill', {
        ...REACHED,
        targetState: { ...REACHED.targetState, errorMessage: 'boom', status: 'target-error' },
      }),
    ).toBe(true);

    expect(runtime.session.restCollectionFill?.status).toBe('rolled-back');
    expect(runtime.commits).toBe(2);
    expect(runtime.decisions.map((decision) => decision.action)).toEqual([
      'Fill REST collection sample rows',
      'Withdraw REST collection rows',
    ]);
    runtime.advance(20_000);
    expect(runtime.call('observePreviewInspectorRestCollectionFill', REACHED)).toBe(false);
    expect(runtime.commits).toBe(2);
  });

  /** A quiet page without the target's output, or with more blockers, loses the rows. */
  it('withdraws rows that leave the target degraded when the page is quiet', () => {
    const lost = createRuntime({ requests: [request('typed', { items: [], total: 0 })] });
    lost.call('observePreviewInspectorRestCollectionFill', REACHED);
    lost.session.blockerTraceActiveAttempt = { settledAt: 1, traceId: 'trace-1' };
    lost.call('observePreviewInspectorRestCollectionFill', LOADING);
    lost.advance(2_500);
    expect(lost.session.restCollectionFill?.status).toBe('rolled-back');
    expect(lost.decisions[1]?.reason).toBe('Rows left the target without verified output');

    const blocked = createRuntime({ requests: [request('typed', { items: [], total: 0 })] });
    blocked.call('observePreviewInspectorRestCollectionFill', REACHED);
    blocked.session.blockerTraceActiveAttempt = { settledAt: 1, traceId: 'trace-1' };
    blocked.call('observePreviewInspectorRestCollectionFill', {
      ...REACHED,
      blockerSummary: { active: 2 },
    });
    blocked.advance(2_500);
    expect(blocked.session.restCollectionFill?.status).toBe('rolled-back');
    expect(blocked.decisions[1]?.reason).toBe('Rows added Inspector blockers');
    expect(blocked.commits).toBe(2);
  });

  /** An attempt that never settles is judged at the deadline from the latest snapshot. */
  it('decides at the deadline when the page never becomes quiet', () => {
    const runtime = createRuntime({ requests: [request('typed', { items: [], total: 0 })] });
    runtime.call('observePreviewInspectorRestCollectionFill', REACHED);
    runtime.session.blockerTraceActiveAttempt = { traceId: 'open' };
    runtime.call('observePreviewInspectorRestCollectionFill', LOADING);

    runtime.advance(9_500);
    expect(runtime.session.restCollectionFill?.status).toBe('applied');
    runtime.advance(1_000);

    expect(runtime.session.restCollectionFill?.status).toBe('rolled-back');
  });

  /** Only fatal errors first seen after the rows were served withdraw them, after the handler. */
  it('withdraws rows on a new fatal error and ignores errors known before the fill', () => {
    const runtime = createRuntime({
      knownFatalErrors: ['known'],
      requests: [request('typed', { items: [], total: 0 })],
    });
    runtime.call('observePreviewInspectorRestCollectionFill', REACHED);

    expect(runtime.call('withdrawPreviewInspectorRestCollectionFillAfterError', 'known')).toBe(
      false,
    );
    expect(runtime.call('withdrawPreviewInspectorRestCollectionFillAfterError', 'new')).toBe(true);
    expect(runtime.session.restCollectionFill?.status).toBe('rolled-back');
    expect(runtime.call('isPreviewInspectorRestCollectionFillServing')).toBe(false);
    expect(runtime.commits).toBe(1);

    runtime.flushMicrotasks();
    expect(runtime.decisions[1]?.reason).toBe('Rows raised a new fatal error');
    expect(runtime.call('withdrawPreviewInspectorRestCollectionFillAfterError', 'later')).toBe(
      false,
    );
    expect(runtime.commits).toBe(2);
  });

  /** An error bars the corridor for the session; a quiet-verdict withdrawal retries next revision. */
  it('does not refill a corridor whose rows raised an error in later revisions', () => {
    const crashed = createRuntime({ requests: [request('typed', { items: [], total: 0 })] });
    crashed.call('observePreviewInspectorRestCollectionFill', REACHED);
    crashed.call('withdrawPreviewInspectorRestCollectionFillAfterError', 'new');
    crashed.flushMicrotasks();
    crashed.setRevision(2);
    expect(crashed.call('observePreviewInspectorRestCollectionFill', REACHED)).toBe(false);
    expect(crashed.commits).toBe(2);

    const degraded = createRuntime({ requests: [request('typed', { items: [], total: 0 })] });
    degraded.call('observePreviewInspectorRestCollectionFill', REACHED);
    degraded.call('observePreviewInspectorRestCollectionFill', LOADING);
    degraded.advance(2_500);
    expect(degraded.session.restCollectionFill?.status).toBe('rolled-back');
    degraded.setRevision(2);
    expect(degraded.call('observePreviewInspectorRestCollectionFill', REACHED)).toBe(true);
  });

  /** A deferred start re-reads the latest snapshot, so a target lost meanwhile is not filled. */
  it('retries a deferred start with the latest snapshot', () => {
    const runtime = createRuntime({ requests: [request('typed', { items: [], total: 0 })] });
    runtime.session.neuralRestoring = true;
    runtime.call('observePreviewInspectorRestCollectionFill', REACHED);
    runtime.call('observePreviewInspectorRestCollectionFill', LOADING);

    runtime.session.neuralRestoring = false;
    runtime.advance(2_000);

    expect(runtime.session.restCollectionFill).toBeUndefined();
    expect(runtime.commits).toBe(0);
  });

  /** Rows belong to one corridor: leaving it stops serving them and ends the attempt. */
  it('stops serving rows when the target corridor changes', () => {
    const runtime = createRuntime({ requests: [request('typed', { items: [], total: 0 })] });
    runtime.call('observePreviewInspectorRestCollectionFill', REACHED);
    expect(runtime.call('isPreviewInspectorRestCollectionFillServing')).toBe(true);

    runtime.session.activeTargetReachabilityKey = 'other:default';
    expect(runtime.call('isPreviewInspectorRestCollectionFillServing')).toBe(false);
    expect(runtime.call('readPreviewInspectorAutoPayloadProfile', 'typed', 'authored-page')).toBe(
      'corridor-auto',
    );
    runtime.advance(500);

    expect(runtime.session.restCollectionFill?.status).toBe('superseded');
    expect(runtime.commits).toBe(1);
  });

  /** Neural path restoration fingerprints the requests, so the fill waits and then retries alone. */
  it('defers the start during neural restoration and retries without a new snapshot', () => {
    const runtime = createRuntime({ requests: [request('typed', { items: [], total: 0 })] });
    runtime.session.neuralRestoring = true;

    expect(runtime.call('observePreviewInspectorRestCollectionFill', REACHED)).toBe(false);
    runtime.advance(1_000);
    expect(runtime.commits).toBe(0);

    runtime.session.neuralRestoring = false;
    runtime.advance(500);
    expect(runtime.session.restCollectionFill?.status).toBe('applied');
    expect(runtime.commits).toBe(1);
  });

  /** A success sweep samples one path at a time; a fill taken mid-sweep records an alternative. */
  it('defers the start while a neural success sweep is sampling or about to explore', () => {
    const runtime = createRuntime({ requests: [request('typed', { items: [], total: 0 })] });
    runtime.session.neuralCollectionBusy = true;

    expect(runtime.call('observePreviewInspectorRestCollectionFill', REACHED)).toBe(false);
    runtime.advance(1_000);
    expect(runtime.commits).toBe(0);

    runtime.session.neuralCollectionBusy = false;
    runtime.advance(500);
    expect(runtime.session.restCollectionFill?.status).toBe('applied');
    expect(runtime.commits).toBe(1);
  });

  /** A start that stays deferred gives up after its bounded retries. */
  it('bounds deferred start retries', () => {
    const runtime = createRuntime({ requests: [request('typed', { items: [], total: 0 })] });
    runtime.session.neuralAssistancePending = true;

    runtime.call('observePreviewInspectorRestCollectionFill', REACHED);
    runtime.advance(60_000);
    runtime.session.neuralAssistancePending = false;
    runtime.advance(5_000);

    expect(runtime.commits).toBe(0);
    expect(runtime.session.restCollectionFill).toBeUndefined();
  });

  /** Nothing pending, nothing to fill, or an open attempt: no work and no remount. */
  it('waits for reach and settled attempts and skips pages without empty collections', () => {
    const empty = createRuntime({
      requests: [request('filled', { items: [{ id: '1' }], total: 1 })],
    });
    expect(empty.call('observePreviewInspectorRestCollectionFill', REACHED)).toBe(false);

    const pending = createRuntime({ requests: [request('typed', { items: [], total: 0 })] });
    expect(
      pending.call('observePreviewInspectorRestCollectionFill', {
        ...REACHED,
        targetState: { ...REACHED.targetState, status: 'probing' },
      }),
    ).toBe(false);
    pending.session.blockerTraceActiveAttempt = { traceId: 'other' };
    expect(pending.call('observePreviewInspectorRestCollectionFill', REACHED)).toBe(false);
    expect(pending.commits).toBe(0);
  });
});

describe('automatic Smart rows', () => {
  const SMART_ROW = { id: 'smart-1', name: 'guided' };
  const smartOverride = (rows: readonly unknown[], automatic = true): Record<string, unknown> => ({
    ...(automatic ? { automatic: true } : {}),
    mode: 'smart',
    payload: { items: rows, total: rows.length },
  });
  const typedRequest = (): Record<string, unknown> =>
    request('typed', { items: [SMART_ROW], total: 1 });

  /** The Auto requirement minimum is served with sample rows after its own first row. */
  it('serves expanded automatic Smart rows beside the untouched override', () => {
    const original = smartOverride([SMART_ROW]);
    const runtime = createRuntime({
      overrideValues: { typed: original },
      requests: [typedRequest()],
    });

    expect(runtime.call('observePreviewInspectorRestCollectionFill', REACHED)).toBe(true);
    expect(runtime.call('readPreviewInspectorRestCollectionFillPayload', 'typed')).toEqual({
      items: [SMART_ROW, { id: 'preview-2', name: 'name 2' }, { id: 'preview-3', name: 'name 3' }],
      total: 1,
    });
    expect(runtime.session.dataPayloadOverrides.get('typed')).toBe(original);
    expect(runtime.clearedResources).toEqual(['typed']);

    runtime.setRevision(2);
    expect(runtime.call('readPreviewInspectorRestCollectionFillPayload', 'typed')).toBeUndefined();
  });

  /** A withdrawal serves the one-row minimum again; user payloads and colliding keys are skipped. */
  it('withdraws expanded rows and leaves user payloads and colliding identities alone', () => {
    const runtime = createRuntime({
      overrideValues: { typed: smartOverride([SMART_ROW]) },
      requests: [typedRequest()],
    });
    runtime.call('observePreviewInspectorRestCollectionFill', REACHED);
    runtime.call('observePreviewInspectorRestCollectionFill', TARGET_ERROR);
    expect(runtime.call('readPreviewInspectorRestCollectionFillPayload', 'typed')).toBeUndefined();
    expect(runtime.clearedResources).toEqual(['typed', 'typed']);

    const user = createRuntime({
      overrideValues: { typed: smartOverride([SMART_ROW], false) },
      requests: [typedRequest()],
    });
    expect(user.call('observePreviewInspectorRestCollectionFill', REACHED)).toBe(false);

    const colliding = createRuntime({
      overrideValues: { typed: smartOverride([{ id: 'preview-2' }]) },
      requests: [typedRequest()],
    });
    expect(colliding.call('observePreviewInspectorRestCollectionFill', REACHED)).toBe(false);
  });
});

describe('late request rounds', () => {
  const keep = (runtime: FillRuntime): void => {
    runtime.session.blockerTraceActiveAttempt = { settledAt: 1, traceId: 'settled' };
    runtime.call('observePreviewInspectorRestCollectionFill', REACHED);
    runtime.advance(2_500);
  };

  /** Requests registered after a kept round get one more verified round beside the kept rows. */
  it('fills requests registered after a kept round and keeps earlier rows on withdrawal', () => {
    const runtime = createRuntime({ requests: [request('first', { items: [], total: 0 })] });
    runtime.call('observePreviewInspectorRestCollectionFill', REACHED);
    expect(runtime.call('observePreviewInspectorRestCollectionFill', REACHED)).toBe(false);
    keep(runtime);
    expect(runtime.session.restCollectionFill?.status).toBe('kept');

    runtime.session.dataRequests.set('late', request('late', { items: [], total: 0 }));
    expect(runtime.call('observePreviewInspectorRestCollectionFill', REACHED)).toBe(true);
    expect(runtime.decisions[1]?.reason).toContain('round 2');
    const profile = (id: string): unknown =>
      runtime.call('readPreviewInspectorAutoPayloadProfile', id, 'authored-page');
    expect([profile('first'), profile('late')]).toEqual(['corridor-rows', 'corridor-rows']);

    runtime.call('observePreviewInspectorRestCollectionFill', TARGET_ERROR);
    expect([profile('first'), profile('late')]).toEqual(['corridor-rows', 'corridor-auto']);
    expect(runtime.commits).toBe(3);
  });

  /** A late-round crash bars later rounds only; the next revision still fills its first round. */
  it('keeps first rounds eligible after a late-round error', () => {
    const runtime = createRuntime({ requests: [request('first', { items: [], total: 0 })] });
    runtime.call('observePreviewInspectorRestCollectionFill', REACHED);
    keep(runtime);
    runtime.session.dataRequests.set('late', request('late', { items: [], total: 0 }));
    runtime.call('observePreviewInspectorRestCollectionFill', REACHED);
    runtime.call('withdrawPreviewInspectorRestCollectionFillAfterError', 'late crash');
    runtime.flushMicrotasks();

    runtime.setRevision(2);
    expect(runtime.call('observePreviewInspectorRestCollectionFill', REACHED)).toBe(true);
    keep(runtime);
    runtime.session.dataRequests.set('later', request('later', { items: [], total: 0 }));
    expect(runtime.call('observePreviewInspectorRestCollectionFill', REACHED)).toBe(false);
  });

  /** A request registered while a round was still verifying starts the next round once kept. */
  it('starts the next round after the verdict without a new snapshot', () => {
    const runtime = createRuntime({ requests: [request('first', { items: [], total: 0 })] });
    runtime.call('observePreviewInspectorRestCollectionFill', REACHED);
    runtime.session.dataRequests.set('late', request('late', { items: [], total: 0 }));
    runtime.session.blockerTraceActiveAttempt = { settledAt: 1, traceId: 'settled' };
    runtime.call('observePreviewInspectorRestCollectionFill', REACHED);

    runtime.advance(2_100);
    expect(runtime.session.restCollectionFill?.status).toBe('kept');
    runtime.advance(600);

    expect(runtime.session.restCollectionFill?.status).toBe('applied');
    expect(runtime.commits).toBe(2);
    expect(runtime.call('readPreviewInspectorAutoPayloadProfile', 'late', 'authored-page')).toBe(
      'corridor-rows',
    );
  });

  /** Earlier requests are not retried and the rounds stop at the limit. */
  it('admits only newly registered requests and stops after three rounds', () => {
    const runtime = createRuntime({ requests: [request('first', { items: [], total: 0 })] });
    runtime.call('observePreviewInspectorRestCollectionFill', REACHED);
    keep(runtime);
    expect(runtime.call('observePreviewInspectorRestCollectionFill', REACHED)).toBe(false);

    for (const id of ['second', 'third']) {
      runtime.session.dataRequests.set(id, request(id, { items: [], total: 0 }));
      expect(runtime.call('observePreviewInspectorRestCollectionFill', REACHED)).toBe(true);
      keep(runtime);
    }
    runtime.session.dataRequests.set('fourth', request('fourth', { items: [], total: 0 }));

    expect(runtime.call('observePreviewInspectorRestCollectionFill', REACHED)).toBe(false);
    expect(runtime.commits).toBe(3);
  });
});

describe('corridor-rows payload profile', () => {
  /** Outer typed lists get the configured rows while every list inside a row stays empty. */
  it('fills outer lists and keeps nested lists empty', () => {
    const generate = createDataRuntime();

    const payload = generate(ORDER_SHAPE, 'corridor-rows') as {
      readonly items: readonly { readonly tags: readonly unknown[] }[];
    };

    expect(payload.items).toHaveLength(DEFAULT_SAMPLE_COUNT);
    expect(payload.items.every((item) => item.tags.length === 0)).toBe(true);
    expect((generate(ORDER_SHAPE, 'corridor-auto') as { readonly items: unknown[] }).items).toEqual(
      [],
    );
  });
});

describe('fill row values', () => {
  /** Rows added by the fill read as distinct records; other generated lists keep their values. */
  it('suffixes generic strings only in rows of the corridor-rows profile', () => {
    const generate = createDataRuntime();
    const shape = {
      items: { fields: { name: { kind: 'string' } }, kind: 'object' },
      kind: 'array',
    };

    expect(generate(shape, 'corridor-rows')).toEqual([
      { name: 'Name' },
      { name: 'Name 2' },
      { name: 'Name 3' },
    ]);
    expect(generate(shape, 'auto')).toEqual([{ name: 'Name' }, { name: 'Name' }, { name: 'Name' }]);
  });
});

interface FillState {
  readonly reachabilityKey: string;
  readonly requestIds: ReadonlySet<string>;
  revision: number;
  readonly status: string;
}

interface FillSession {
  activeTargetReachabilityKey?: string | undefined;
  blockerTraceActiveAttempt?: { readonly settledAt?: number; readonly traceId: string };
  readonly blockerTraceRecentFatalErrors: ReadonlyMap<string, unknown>;
  readonly dataAutoEnabled: boolean;
  readonly dataPayloadOverrides: Map<string, unknown>;
  readonly dataRequests: Map<string, Record<string, unknown>>;
  neuralAssistancePending?: boolean;
  neuralCollectionBusy?: boolean;
  neuralRestoring?: boolean;
  restCollectionFill?: FillState;
  readonly selectedExportName: string;
}

interface FillRuntime {
  readonly clearedResources: readonly string[];
  readonly commits: number;
  advance(milliseconds: number): void;
  readonly decisions: readonly { readonly action?: unknown; readonly reason?: unknown }[];
  flushMicrotasks(): void;
  readonly session: FillSession;
  setRevision(revision: number): void;
  call(name: string, ...args: unknown[]): unknown;
}

/** Evaluates the fill module against stubbed session, backend, and trace collaborators. */
function createRuntime(
  options: {
    readonly knownFatalErrors?: readonly string[];
    readonly overrideValues?: Readonly<Record<string, unknown>>;
    readonly overrides?: readonly string[];
    readonly requests?: readonly Record<string, unknown>[];
    readonly scenarios?: Readonly<Record<string, string>>;
  } = {},
): FillRuntime {
  const state = {
    clearedResources: [] as string[],
    clock: 10_000,
    commits: 0,
    decisions: [] as Record<string, unknown>[],
  };
  const timers: { readonly callback: () => void; readonly dueAt: number }[] = [];
  const microtasks: (() => void)[] = [];
  const session: FillSession = {
    activeTargetReachabilityKey: 'candidate:default',
    blockerTraceRecentFatalErrors: new Map(
      (options.knownFatalErrors ?? []).map((fingerprint) => [fingerprint, {}]),
    ),
    dataAutoEnabled: true,
    dataPayloadOverrides: new Map<string, unknown>([
      ...(options.overrides ?? []).map((id) => [id, {}] as const),
      ...Object.entries(options.overrideValues ?? {}),
    ]),
    dataRequests: new Map(
      (options.requests ?? []).map((record) => [String(record.id), record] as const),
    ),
    selectedExportName: 'default',
  };
  const context = vm.createContext({
    Date: { now: () => state.clock },
    blockedInspectorPropNames: new Set(['__proto__', 'constructor', 'prototype']),
    commitPreviewInspectorDataChange: () => {
      state.commits += 1;
    },
    inferPreviewInspectorEndpointShape: () => GUESSED_SHAPE,
    isPreviewInspectorNeuralSuccessfulPathRestorationActive: () => session.neuralRestoring === true,
    isPreviewInspectorNeuralSuccessCollectionBusy: () => session.neuralCollectionBusy === true,
    clearPreviewInspectorVirtualBackendResource: (id: string) => {
      state.clearedResources.push(id);
    },
    generatePreviewInspectorDataValue: () =>
      Array.from({ length: DEFAULT_SAMPLE_COUNT }, (_, index) => ({
        id: `preview-${String(index + 1)}`,
        name: `name ${String(index + 1)}`,
      })),
    previewEntryRevision: 1,
    previewInspectorSession: session,
    readPreviewGeneratedListSampleCount: () => DEFAULT_SAMPLE_COUNT,
    queueMicrotask: (callback: () => void) => {
      microtasks.push(callback);
    },
    readPreviewInspectorVirtualBackendScenario: (id: string) => ({
      mode: options.scenarios?.[id] ?? 'success',
    }),
    recordPreviewInspectorBlockerAutoDecision: (candidate: Record<string, unknown>) => {
      state.decisions.push(candidate);
      return `trace-${String(state.decisions.length)}`;
    },
    setTimeout: (callback: () => void, delay: number) => {
      timers.push({ callback, dueAt: state.clock + delay });
    },
    stringifyPreviewInspectorProps: (value: unknown) => JSON.stringify(value),
  });
  vm.runInContext(createPreviewInspectorRestCollectionFillRuntimeSource(), context);
  return {
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
    clearedResources: state.clearedResources,
    get commits() {
      return state.commits;
    },
    decisions: state.decisions,
    flushMicrotasks() {
      for (const callback of microtasks.splice(0)) callback();
    },
    session,
    setRevision(revision) {
      context.previewEntryRevision = revision;
    },
    call: (name, ...args) => (context[name] as (...values: unknown[]) => unknown)(...args),
  };
}

/** Builds one registered request record as the data runtime keeps it. */
function request(
  id: string,
  servedPayload: unknown,
  extra: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    autoPayloadProfile: 'corridor-auto',
    id,
    kind: 'rest',
    label: `GET /api/${id}`,
    lastPayload: servedPayload,
    shape: ORDER_SHAPE,
    url: `/api/${id}`,
    ...extra,
  };
}

/** Evaluates the full data runtime and exposes its payload generator. */
function createDataRuntime(): (shape: unknown, mode: string) => unknown {
  const context = vm.createContext({
    URL,
    URLSearchParams,
    location: { href: 'https://preview.invalid/' },
    queueMicrotask,
    setTimeout,
  });
  vm.runInContext(
    `
const previewHotRuntime = {};
const previewInspectorSession = { resolverPropsByExport: new Map() };
const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);
function readPersistedPreviewInspectorState() { return {}; }
function stringifyPreviewInspectorProps(value) { return JSON.stringify(value, null, 2) ?? '{}'; }
function persistPreviewInspectorState() {}
function notifyPreviewInspector() {}
function schedulePreviewInspectorTreeRefresh() {}
function readPreviewInspectorRenderScenario() { return 'authored-page'; }
function shouldHoldPreviewInspectorNeuralTransientTargetRequest() { return false; }
function resetPreviewInspectorGeneratedRuntimeFallbackValues() {}
${createPreviewInspectorDataRuntimeSourceWithList()}
globalThis.__generate = generatePreviewInspectorDataValue;`,
    context,
  );
  const generate = context.__generate as (
    shape: unknown,
    fieldName: string,
    mode: string,
  ) => unknown;
  return (shape, mode) => generate(shape, '', mode);
}

/** Composes the data runtime with its generated-list and GraphQL collaborators. */
function createPreviewInspectorDataRuntimeSourceWithList(): string {
  return [
    createPreviewGeneratedListRuntimeSource(),
    createPreviewInspectorDataRuntimeSource(),
    createPreviewInspectorNeuralResidualRuntimeSource(),
    createPreviewInspectorHookGraphqlRuntimeSource(),
  ].join('\n');
}
