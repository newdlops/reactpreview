/** Verifies strict, bounded parsing for chronological Page Inspector blocker trace messages. */
import { describe, expect, it } from 'vitest';
import {
  readPreviewBlockerTraceMessage,
  PREVIEW_BLOCKER_TRACE_MESSAGE_TYPE,
} from '../../src/presentation/previewBlockerTraceProtocol';

describe('Preview blocker trace protocol', () => {
  /** Retains source evidence, deterministic Auto values, and render-set differences. */
  it('parses one complete Auto-selection event into frozen plain data', () => {
    const message = readPreviewBlockerTraceMessage({
      event: {
        auto: {
          action: 'Smart fill minimum hook value',
          generatedPaths: ['formikProps.values.name'],
          mode: 'smart',
          reason: 'downstream property read',
          selectedValue: { formikProps: { values: { name: 'Preview name' } } },
        },
        blocker: {
          id: 'hook-form',
          kind: 'runtime-fallback',
          name: 'Missing hook value · useFormContext',
          ownerName: 'ProfileForm',
          source: {
            column: 5,
            line: 12,
            occurrenceStart: 220,
            sourcePath: '/workspace/src/ProfileForm.tsx',
          },
          summary: { requiredPaths: ['formikProps.values.name'] },
        },
        event: 'auto-selection',
        sequence: 7,
        target: {
          exportName: 'ProfileForm',
          pageCandidateId: 'app-path',
          renderScenario: 'authored-page',
        },
        timestamp: '2026-07-19T12:00:00.000Z',
        traceId: 'blocker-trace-4',
      },
      type: PREVIEW_BLOCKER_TRACE_MESSAGE_TYPE,
    });

    expect(message).toMatchObject({
      event: {
        auto: {
          generatedPaths: ['formikProps.values.name'],
          mode: 'smart',
          selectedValue: { formikProps: { values: { name: 'Preview name' } } },
        },
        blocker: {
          kind: 'runtime-fallback',
          source: { line: 12, sourcePath: '/workspace/src/ProfileForm.tsx' },
        },
        event: 'auto-selection',
        sequence: 7,
        traceId: 'blocker-trace-4',
      },
    });
    expect(Object.isFrozen(message)).toBe(true);
    expect(Object.isFrozen(message?.event.auto?.selectedValue)).toBe(true);
  });

  /** Rejects path escapes, ambiguous coordinates, unsupported events, and oversized JSON graphs. */
  it.each([
    {
      event: {
        blocker: {
          id: 'one',
          kind: 'target-error',
          name: 'Broken',
          source: { sourcePath: '../Outside.tsx' },
        },
        event: 'blocker-discovered',
        sequence: 1,
        timestamp: 'now',
        traceId: 'trace-1',
      },
      type: PREVIEW_BLOCKER_TRACE_MESSAGE_TYPE,
    },
    {
      event: {
        blocker: {
          id: 'one',
          kind: 'target-error',
          name: 'Broken',
          source: { column: 2, sourcePath: '/workspace/Broken.tsx' },
        },
        event: 'blocker-discovered',
        sequence: 1,
        timestamp: 'now',
        traceId: 'trace-1',
      },
      type: PREVIEW_BLOCKER_TRACE_MESSAGE_TYPE,
    },
    {
      event: {
        event: 'unknown-event',
        sequence: 1,
        timestamp: 'now',
        traceId: 'trace-1',
      },
      type: PREVIEW_BLOCKER_TRACE_MESSAGE_TYPE,
    },
    {
      event: {
        blocker: {
          id: 'one',
          kind: 'data-request',
          name: 'Payload',
          summary: { body: 'x'.repeat(64 * 1024 + 1) },
        },
        event: 'blocker-discovered',
        sequence: 1,
        timestamp: 'now',
        traceId: 'trace-1',
      },
      type: PREVIEW_BLOCKER_TRACE_MESSAGE_TYPE,
    },
  ])('rejects malformed trace input %#', (message) => {
    expect(readPreviewBlockerTraceMessage(message)).toBeUndefined();
  });

  /** Keeps exact result lists so a resolver attempt can explain what changed after remount. */
  it('parses a render-result correlation event', () => {
    expect(
      readPreviewBlockerTraceMessage({
        event: {
          event: 'render-result',
          result: {
            changedBlockerIds: ['request-user'],
            discoveredBlockerIds: ['hook-route'],
            outcome: 'superseded',
            remainingBlockerIds: ['request-user', 'hook-route'],
            resolvedBlockerIds: ['login-gate'],
          },
          sequence: 9,
          timestamp: '2026-07-19T12:00:01.000Z',
          traceId: 'blocker-trace-8',
        },
        type: PREVIEW_BLOCKER_TRACE_MESSAGE_TYPE,
      }),
    ).toMatchObject({
      event: {
        result: {
          discoveredBlockerIds: ['hook-route'],
          outcome: 'superseded',
          resolvedBlockerIds: ['login-gate'],
        },
      },
    });
  });

  /** Accepts the explicit terminal result used when an automatic JSX transaction is restored. */
  it('parses a rolled-back render result', () => {
    const message = readPreviewBlockerTraceMessage({
      event: {
        event: 'render-result',
        result: {
          changedBlockerIds: [],
          discoveredBlockerIds: [],
          outcome: 'rolled-back',
          remainingBlockerIds: ['overlay-gate'],
          resolvedBlockerIds: [],
        },
        sequence: 10,
        timestamp: '2026-07-19T12:00:02.000Z',
        traceId: 'blocker-trace-9',
      },
      type: PREVIEW_BLOCKER_TRACE_MESSAGE_TYPE,
    });

    expect(message?.event.result?.outcome).toBe('rolled-back');
  });
});
