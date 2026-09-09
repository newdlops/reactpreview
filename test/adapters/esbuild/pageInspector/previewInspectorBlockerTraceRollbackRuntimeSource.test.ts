/** Verifies fatal-error attribution and mode-specific rollback with a bounded fake clock. */
import { describe, expect, it } from 'vitest';
import {
  createSnapshot,
  createTargetErrorSnapshot,
  createTraceRuntime,
} from './support/previewInspectorBlockerTraceFixture';

describe('Preview Inspector blocker trace rollback', () => {
  it.each(['deterministic-minimum-auto', 'minimum-requirement-dfs'])(
    'rolls back only eligible requirement mode %s',
    (mode) => {
      const runtime = createTraceRuntime();
      runtime.snapshot(createSnapshot('auto'));
      const traceId = runtime.decide({
        action: 'requirements',
        blockerId: 'path',
        blockerKind: 'target-reachability',
        blockerName: 'Path',
        mode,
        startsRenderAttempt: true,
      });
      runtime.error({ level: 'error', message: 'new fatal', source: 'preview-runtime' });
      expect(runtime.requirementRollbackCalls).toEqual([traceId]);
      expect(runtime.rollbackCalls).toEqual([]);
      expect(runtime.rollbacks).toEqual([]);
      expect(
        runtime.messages.filter((message) => message.event.event === 'subsequent-error'),
      ).toHaveLength(1);
      expect(
        runtime.messages.find((message) => message.event.event === 'subsequent-error')?.event
          .traceId,
      ).toBe(traceId);
      const results = runtime.messages.filter((message) => message.event.event === 'render-result');
      expect(results).toHaveLength(1);
      expect(results[0]?.event).toMatchObject({ traceId, result: { outcome: 'rolled-back' } });
      expect(runtime.resumeHandledAtCall).toEqual([true]);
      expect(runtime.resumeEffects).toEqual([]);
    },
  );

  it.each(['target-overlay-auto', 'auto', 'smart', 'smart-props', 'convergence-circuit'])(
    'keeps excluded Auto mode %s diagnostic-only',
    (mode) => {
      const runtime = createTraceRuntime();
      runtime.snapshot(createSnapshot('auto'));
      const traceId = runtime.decide({
        action: 'auto',
        blockerId: 'path',
        blockerKind: 'target-reachability',
        blockerName: 'Path',
        mode,
        startsRenderAttempt: true,
      });
      runtime.error({ level: 'error', message: 'new fatal', source: 'preview-runtime' });
      expect(runtime.requirementRollbackCalls).toEqual([]);
      expect(runtime.rollbackCalls).toEqual([]);
      expect(runtime.rollbacks).toEqual([]);
      expect(
        runtime.messages.filter((message) => message.event.event === 'subsequent-error'),
      ).toHaveLength(1);
      expect(
        runtime.messages.find((message) => message.event.event === 'subsequent-error')?.event
          .traceId,
      ).toBe(traceId);
    },
  );

  it.each(['deterministic-minimum-auto', 'minimum-requirement-dfs'])(
    'does not roll back eligible mode %s for a known baseline error',
    (mode) => {
      const runtime = createTraceRuntime();
      const error = { level: 'error', message: 'known fatal', source: 'preview-runtime' };
      runtime.error(error);
      runtime.decide({
        action: 'requirements',
        blockerId: 'path',
        mode,
        startsRenderAttempt: true,
      });
      runtime.error(error);
      expect(runtime.requirementRollbackCalls).toEqual([]);
      expect(runtime.rollbackCalls).toEqual([]);
      expect(runtime.messages.filter((message) => message.event.event === 'render-result')).toEqual(
        [],
      );
    },
  );

  it.each(['deterministic-minimum-auto', 'minimum-requirement-dfs'])(
    'keeps composing %s requirements when one baseline error crosses transports',
    (mode) => {
      const runtime = createTraceRuntime();
      const message = "TypeError: Cannot read properties of undefined (reading 'some')";
      runtime.error({
        exportName: 'ProfileForm',
        level: 'error',
        location: '/generated/first.js:100:20',
        message,
        phase: 'React export render or lifecycle',
        source: 'target-reachability',
      });
      runtime.snapshot(createTargetErrorSnapshot('PreviewCandidateRouterErrorBoundary', message));
      const traceId = runtime.decide({
        action: 'Fill another page-path requirement',
        blockerId: 'target-reachability:payment:TaxTypeBadge',
        mode,
        startsRenderAttempt: true,
      });
      runtime.error({
        level: 'error',
        location: '/generated/second.js:200:40',
        message,
        phase: 'unhandled browser error',
        source: 'preview-runtime',
      });

      expect(traceId).toBeTypeOf('string');
      expect(runtime.requirementRollbackCalls).toEqual([]);
      expect(runtime.rollbackCalls).toEqual([]);
      expect(runtime.messages.filter((message) => message.event.event === 'render-result')).toEqual(
        [],
      );
    },
  );

  it.each(['deterministic-minimum-auto', 'minimum-requirement-dfs'])(
    'keeps a %s repair when it exposes a deeper missing property',
    (mode) => {
      const runtime = createTraceRuntime();
      runtime.error({
        level: 'error',
        message: "TypeError: Cannot read properties of undefined (reading 'some')",
        source: 'target-reachability',
      });
      runtime.snapshot(
        createTargetErrorSnapshot(
          'ProfileForm',
          "TypeError: Cannot read properties of undefined (reading 'some')",
        ),
      );
      const traceId = runtime.decide({
        action: 'Fill the compiler-admitted collection',
        blockerId: 'target-reachability:profile',
        generatedPaths: ['getFragmentData.warnings.some()'],
        mode,
        startsRenderAttempt: true,
      });
      runtime.error({
        level: 'error',
        message: "TypeError: Cannot read properties of undefined (reading 'isStaffOnly')",
        source: 'preview-runtime',
      });

      expect(traceId).toBeTypeOf('string');
      expect(runtime.requirementRollbackCalls).toEqual([]);
      expect(runtime.rollbackCalls).toEqual([]);
    },
  );

  it('rolls back a successor exception when the generated requirement missed the old hole', () => {
    const runtime = createTraceRuntime();
    runtime.error({
      level: 'error',
      message: "TypeError: Cannot read properties of undefined (reading 'some')",
      source: 'target-reachability',
    });
    runtime.snapshot(
      createTargetErrorSnapshot(
        'ProfileForm',
        "TypeError: Cannot read properties of undefined (reading 'some')",
      ),
    );
    const traceId = runtime.decide({
      action: 'Fill an unrelated compiler value',
      blockerId: 'target-reachability:profile',
      generatedPaths: ['useProfile.loaded'],
      mode: 'deterministic-minimum-auto',
      startsRenderAttempt: true,
    });
    runtime.error({
      level: 'error',
      message: "TypeError: Cannot read properties of undefined (reading 'isStaffOnly')",
      source: 'preview-runtime',
    });

    expect(runtime.requirementRollbackCalls).toEqual([traceId]);
  });

  it('deduplicates eligible requirement rollback across duplicate fatal transports', () => {
    const runtime = createTraceRuntime();
    runtime.snapshot(createSnapshot('auto'));
    const traceId = runtime.decide({
      action: 'requirements',
      blockerId: 'path',
      mode: 'deterministic-minimum-auto',
      startsRenderAttempt: true,
    });
    runtime.error({ level: 'error', message: 'duplicate fatal', source: 'preview-runtime' });
    runtime.error({ level: 'error', message: 'duplicate fatal', source: 'react-boundary' });
    expect(runtime.requirementRollbackCalls).toEqual([traceId]);
    expect(runtime.rollbackCalls).toEqual([]);
    expect(runtime.rollbacks).toEqual([]);
    const errors = runtime.messages.filter((message) => message.event.event === 'subsequent-error');
    const results = runtime.messages.filter((message) => message.event.event === 'render-result');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.event.traceId).toBe(traceId);
    expect(results).toHaveLength(1);
    expect(results[0]?.event).toMatchObject({ traceId, result: { outcome: 'rolled-back' } });
    expect(runtime.resumeHandledAtCall).toEqual([true]);
    expect(runtime.resumeEffects).toEqual([]);
  });

  it('corrects a committed requirement transaction during settled-error grace with a final rollback', () => {
    const runtime = createTraceRuntime();
    runtime.snapshot(createSnapshot('auto'));
    const traceId = runtime.decide({
      action: 'requirements',
      blockerId: 'path',
      mode: 'deterministic-minimum-auto',
      startsRenderAttempt: true,
    });
    runtime.snapshot(createSnapshot('same'));
    runtime.snapshot(createSnapshot('same'));
    runtime.advance(320);
    runtime.error({ level: 'error', message: 'late fatal', source: 'preview-runtime' });
    const results = runtime.messages.filter((message) => message.event.event === 'render-result');
    expect(results).toHaveLength(2);
    expect(results[0]?.event.result?.outcome).toBe('committed');
    expect(results[1]?.event.result?.outcome).toBe('rolled-back');
    expect(results[1]?.event.traceId).toBe(traceId);
    expect(runtime.requirementRollbackCalls).toEqual([traceId]);
    const errors = runtime.messages.filter((message) => message.event.event === 'subsequent-error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.event.traceId).toBe(traceId);
    expect(runtime.resumeHandledAtCall).toEqual([false]);
    expect(runtime.resumeEffects).toEqual([traceId]);
  });

  /** Emits a standalone error trace when no Auto attempt exists, while ignoring ordinary info rows. */
  it('retains fatal boundary errors without tracing unrelated console chatter', () => {
    const runtime = createTraceRuntime();
    runtime.error({ level: 'info', message: 'render started', source: 'console' });
    runtime.error({ level: 'error', message: 'provider missing', source: 'react-boundary' });

    expect(runtime.messages).toHaveLength(1);
    expect(runtime.messages[0]?.event).toMatchObject({
      error: { message: 'provider missing' },
      event: 'subsequent-error',
    });
  });

  /** Coalesces the same failure forwarded by more than one renderer error transport. */
  it('records one standalone trace for an identical cross-transport error', () => {
    const runtime = createTraceRuntime();
    const message = 'PreviewInspectorTreeRow(...): Nothing was returned from render.';
    runtime.error({ details: 'browser stack', level: 'error', message, source: 'preview-runtime' });
    runtime.error({
      details: 'React component stack',
      level: 'error',
      message,
      source: 'react-boundary',
    });
    runtime.error({
      details: 'fallback stack',
      level: 'error',
      message,
      source: 'runtime-fallback',
    });

    expect(
      runtime.messages.filter((entry) => entry.event.event === 'subsequent-error'),
    ).toHaveLength(1);
  });

  /** Does not blame a new JSX decision for the same fatal error already active before it began. */
  it('rolls back only errors that were absent from the attempt baseline', () => {
    const runtime = createTraceRuntime();
    const persistentError = {
      details: 'TypeError: existing provider state is invalid',
      level: 'error',
      message: 'existing provider state is invalid',
      source: 'react-boundary',
    };
    runtime.error(persistentError);
    const traceId = runtime.decide({
      action: 'Advance unrelated overlay',
      blockerId: 'overlay-gate',
      mode: 'target-guided-auto',
      startsRenderAttempt: true,
    });
    runtime.error(persistentError);

    expect(traceId).toBeTypeOf('string');
    expect(runtime.rollbacks).toEqual([]);
    expect(
      runtime.messages.filter((message) => message.event.event === 'subsequent-error'),
    ).toHaveLength(2);
  });

  /** Keeps a sibling gallery boundary in the baseline under its real export, not the selection. */
  it('does not blame a selected gate for a persistent sibling export failure', () => {
    const runtime = createTraceRuntime();
    const siblingError = {
      exportName: 'SiblingPanel',
      level: 'error',
      message: 'persistent sibling provider failure',
      source: 'react-boundary',
    };
    runtime.error(siblingError);
    runtime.snapshot(createTargetErrorSnapshot('SiblingPanel', siblingError.message));
    const traceId = runtime.decide({
      action: 'Advance selected target gate',
      blockerId: 'selected-gate',
      mode: 'target-guided-auto',
      startsRenderAttempt: true,
    });
    runtime.error(siblingError);

    expect(traceId).toBeTypeOf('string');
    expect(runtime.rollbacks).toEqual([]);
  });

  /** Treats a fatal signature as new again after a healthy committed tree removed its boundary. */
  it('rolls back a repeated error after the latest blocker snapshot resolved it', () => {
    const runtime = createTraceRuntime();
    const repeatedError = {
      details: 'TypeError: options.filter is not a function',
      level: 'error',
      message: 'options.filter is not a function',
      source: 'react-boundary',
    };
    runtime.error(repeatedError);
    runtime.snapshot(createSnapshot('healthy'));
    const traceId = runtime.decide({
      action: 'Advance a collection gate',
      blockerId: 'collection-gate',
      mode: 'target-guided-auto',
      startsRenderAttempt: true,
    });
    runtime.error(repeatedError);

    expect(runtime.rollbacks).toEqual([traceId]);
    expect(
      runtime.messages.find(
        (message) => message.event.event === 'render-result' && message.event.traceId === traceId,
      )?.event.result?.outcome,
    ).toBe('rolled-back');
  });

  /** Settles a failed target-guided transaction immediately after its automatic gate is restored. */
  it('publishes a rolled-back result for a newly introduced condition error', () => {
    const runtime = createTraceRuntime();
    const traceId = runtime.decide({
      action: 'Advance target overlay',
      blockerId: 'overlay-gate',
      mode: 'target-guided-auto',
      startsRenderAttempt: true,
    });
    runtime.error({
      level: 'error',
      message: 'options.filter is not a function',
      source: 'react-boundary',
    });

    expect(runtime.rollbackCalls).toEqual([traceId]);
    expect(runtime.rollbacks).toEqual([traceId]);
    expect(runtime.requirementRollbackCalls).toEqual([]);
    expect(
      runtime.messages.filter(
        (message) =>
          message.event.event === 'subsequent-error' && message.event.traceId === traceId,
      ),
    ).toHaveLength(1);
    expect(
      runtime.messages.find(
        (message) => message.event.event === 'render-result' && message.event.traceId === traceId,
      )?.event.result?.outcome,
    ).toBe('rolled-back');
  });

  /** Keeps a revealed modal open when one of its newly visible descendants throws. */
  it('never rolls back an overlay visibility attempt after a descendant error', () => {
    const runtime = createTraceRuntime();
    const traceId = runtime.decide({
      action: 'Reveal selected overlay target',
      blockerId: 'target-overlay:DeleteModal',
      mode: 'target-overlay-auto',
      startsRenderAttempt: true,
    });
    runtime.error({
      level: 'error',
      message: 'visible modal child needs backend data',
      source: 'react-boundary',
    });

    expect(runtime.rollbackCalls).toEqual([]);
    expect(runtime.rollbacks).toEqual([]);
    expect(runtime.messages.at(-1)?.event).toMatchObject({
      event: 'subsequent-error',
      traceId,
    });
  });

  /** Stops attributing later page errors to a modal reveal after its short settle grace expires. */
  it('bounds a settled overlay reveal to the target-attempt error grace', () => {
    const runtime = createTraceRuntime();
    runtime.snapshot(createSnapshot('hidden-overlay'));
    const traceId = runtime.decide({
      action: 'Reveal selected overlay target',
      blockerId: 'target-overlay:DeleteModal',
      mode: 'target-overlay-auto',
      startsRenderAttempt: true,
    });
    runtime.snapshot(createSnapshot('visible-overlay'));
    runtime.snapshot(createSnapshot('visible-overlay'));
    runtime.advance(320);
    runtime.advance(161);
    runtime.error({
      level: 'error',
      message: 'independent page failure',
      source: 'react-boundary',
    });

    const error = runtime.messages.at(-1)?.event;
    expect(error?.event).toBe('subsequent-error');
    expect(error?.traceId).not.toBe(traceId);
    expect(error?.blocker).toBeUndefined();
  });

  /** Ends causal attachment after the bounded settlement and its short late-error grace. */
  it('bounds attempts to one render settlement instead of a long global time window', () => {
    const runtime = createTraceRuntime();
    runtime.snapshot(createSnapshot('auto'));
    const candidate = {
      action: 'Complete route params',
      blockerId: 'route-params',
      blockerKind: 'runtime-fallback',
      blockerName: 'useParams',
      generatedPaths: ['companyId'],
      mode: 'auto',
      selectedValue: { companyId: 'preview-id' },
      startsRenderAttempt: true,
    };
    const traceId = runtime.decide(candidate);
    runtime.snapshot(createSnapshot('settled'));
    runtime.advance(320);
    runtime.advance(1_001);
    runtime.error({
      level: 'error',
      message: 'independent theme failure',
      source: 'react-boundary',
    });

    const error = runtime.messages.at(-1)?.event;
    expect(error?.event).toBe('subsequent-error');
    expect(error?.traceId).not.toBe(traceId);
    expect(error?.blocker).toBeUndefined();
    expect(runtime.decide(candidate)).not.toBeUndefined();
  });
});
