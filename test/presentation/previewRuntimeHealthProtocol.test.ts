/** Verifies strict parsing for live renderer-health webview messages. */
import { describe, expect, it } from 'vitest';
import {
  PREVIEW_RUNTIME_HEALTH_MESSAGE_TYPE,
  readPreviewRuntimeHealthMessage,
} from '../../src/presentation/previewRuntimeHealthProtocol';

describe('Preview runtime health protocol', () => {
  /** Accepts the informational page-shell and static-route selection event. */
  it('parses page context selection diagnostics', () => {
    const message = readPreviewRuntimeHealthMessage({
      artifactId: '0123456789abcdef',
      event: {
        category: 'page-context',
        detail: { pathname: '/company/1/analysis', rootExport: 'CompanyOwnerApp' },
        event: 'page-context-selected',
        eventId: 'runtime-health-1',
        revision: 1,
        sequence: 1,
        severity: 'info',
        source: { sourcePath: '/workspace/pages.json' },
        timestamp: '2026-07-19T13:00:00.000Z',
      },
      runtimeRevision: 1,
      runtimeSessionId: 'rp-0123456789abcdef01234567',
      type: PREVIEW_RUNTIME_HEALTH_MESSAGE_TYPE,
    });

    expect(message?.event).toMatchObject({
      event: 'page-context-selected',
      source: { sourcePath: '/workspace/pages.json' },
    });
    expect(message).toMatchObject({
      artifactId: '0123456789abcdef',
      runtimeRevision: 1,
      runtimeSessionId: 'rp-0123456789abcdef01234567',
    });
  });

  /** Accepts the bounded page composition shape used by human-readable Output formatting. */
  it('parses page composition snapshots', () => {
    const message = readPreviewRuntimeHealthMessage({
      event: {
        category: 'page-composition',
        detail: {
          applicationPath: ['Application', 'Page', 'Target'],
          blockerSummary: { active: 0, items: [], total: 0 },
          candidate: { complete: true, id: 'application-page', rootExport: 'Application' },
          missingShellNames: [],
          statusCounts: { hostOutput: 4, mounted: 6 },
          targetState: { hasOutput: true, mounted: true, stage: 'target-output' },
          treeRows: [
            {
              blocker: false,
              currentFile: true,
              depth: 2,
              kind: 'target',
              mounted: true,
              name: 'Target',
              state: 'mounted-output',
            },
          ],
        },
        event: 'page-composition-snapshot',
        eventId: 'runtime-health-2',
        revision: 1,
        sequence: 2,
        severity: 'info',
        timestamp: '2026-07-23T00:00:00.000Z',
      },
      type: PREVIEW_RUNTIME_HEALTH_MESSAGE_TYPE,
    });

    expect(message?.event).toMatchObject({
      detail: {
        targetState: { stage: 'target-output' },
        treeRows: [{ currentFile: true, name: 'Target' }],
      },
      event: 'page-composition-snapshot',
      severity: 'info',
    });
  });

  /** Accepts one source-backed circular GraphQL interpolation recovery warning. */
  it('parses GraphQL document recovery diagnostics', () => {
    const message = readPreviewRuntimeHealthMessage({
      event: {
        category: 'module-initialization',
        detail: {
          bindingName: 'COMPANY_REGISTER_MODAL_FRAGMENT',
          fragmentNames: ['CompanyRegisterModal'],
        },
        event: 'graphql-interpolation-repaired',
        eventId: 'runtime-health-2',
        revision: 1,
        sequence: 2,
        severity: 'warn',
        source: { column: 5, line: 17, sourcePath: '/workspace/query.ts' },
        timestamp: '2026-07-19T13:00:01.000Z',
      },
      type: PREVIEW_RUNTIME_HEALTH_MESSAGE_TYPE,
    });

    expect(message?.event).toMatchObject({
      event: 'graphql-interpolation-repaired',
      severity: 'warn',
    });
  });

  /** Preserves effect-isolation warnings emitted when preview-only side effects are neutralized. */
  it('parses runtime effect isolation diagnostics', () => {
    const message = readPreviewRuntimeHealthMessage({
      event: {
        category: 'render-isolation',
        detail: { hookName: 'usePollingEffect', reason: 'repeating-preview-side-effect' },
        event: 'runtime-effect-isolated',
        eventId: 'runtime-health-3',
        revision: 1,
        sequence: 3,
        severity: 'warn',
        timestamp: '2026-07-23T00:00:02.000Z',
      },
      type: PREVIEW_RUNTIME_HEALTH_MESSAGE_TYPE,
    });

    expect(message?.event.event).toBe('runtime-effect-isolated');
  });

  /** Retains revision, parent error ancestry, and exact compiler-authored source evidence. */
  it('parses one complete fallback health event', () => {
    const message = readPreviewRuntimeHealthMessage({
      event: {
        category: 'runtime-error',
        detail: {
          confidence: 'stack-evidenced',
          message: "Cannot read properties of undefined (reading 'black')",
        },
        event: 'runtime-error-fallback',
        eventId: 'runtime-health-3',
        parentEventId: 'runtime-health-2',
        revision: 4,
        sequence: 3,
        severity: 'error',
        source: { column: 21, line: 54, sourcePath: '/workspace/ErrorStatus.tsx' },
        target: { exportName: 'CreditPage', pageCandidateId: 'app-path' },
        timestamp: '2026-07-19T13:00:00.000Z',
      },
      type: PREVIEW_RUNTIME_HEALTH_MESSAGE_TYPE,
    });

    expect(message).toMatchObject({
      event: {
        event: 'runtime-error-fallback',
        parentEventId: 'runtime-health-2',
        revision: 4,
        source: { line: 54, sourcePath: '/workspace/ErrorStatus.tsx' },
      },
    });
    expect(Object.isFrozen(message?.event.detail)).toBe(true);
  });

  /** Rejects unsupported event kinds, relative sources, malformed revisions, and cyclic detail. */
  it.each([
    { event: 'unknown-event', revision: 1, sourcePath: '/workspace/Page.tsx' },
    { event: 'theme-token-repaired', revision: -1, sourcePath: '/workspace/Page.tsx' },
    { event: 'theme-token-repaired', revision: 1, sourcePath: '../Page.tsx' },
  ])('rejects malformed health input %#', ({ event, revision, sourcePath }) => {
    expect(
      readPreviewRuntimeHealthMessage({
        event: {
          category: 'theme',
          detail: {},
          event,
          eventId: 'health-1',
          revision,
          sequence: 1,
          severity: 'warn',
          source: { line: 1, sourcePath },
          timestamp: 'now',
        },
        type: PREVIEW_RUNTIME_HEALTH_MESSAGE_TYPE,
      }),
    ).toBeUndefined();
  });

  /** Rejects correlation fields that omit the exact revision owning the browser event. */
  it('rejects partial runtime correlation while accepting old complete health events', () => {
    const event = {
      category: 'theme',
      detail: {},
      event: 'theme-token-repaired',
      eventId: 'health-1',
      revision: 1,
      sequence: 1,
      severity: 'warn',
      timestamp: 'now',
    };
    expect(
      readPreviewRuntimeHealthMessage({
        event,
        runtimeSessionId: 'rp-0123456789abcdef01234567',
        type: PREVIEW_RUNTIME_HEALTH_MESSAGE_TYPE,
      }),
    ).toBeUndefined();
    expect(
      readPreviewRuntimeHealthMessage({ event, type: PREVIEW_RUNTIME_HEALTH_MESSAGE_TYPE }),
    ).toBeDefined();
  });
});
