/** Creates the bounded direct-preview lifecycle trace producer. */
export function createPreviewDirectBlockerTraceRuntimeSource(): string {
  return String.raw`
let previewDirectBlockerTraceSequence = 0;

/** Emits only an observed direct entry terminal lifecycle through the existing webview channel. */
function postPreviewDirectBlockerTrace(outcome, error) {
  const postMessage = previewHotRuntime.vscodeApi?.postMessage;
  if (typeof postMessage !== 'function') return;
  previewDirectBlockerTraceSequence += 1;
  const failed = outcome === 'failed';
  const message = {
    ...readPreviewRuntimeCorrelation(),
    event: {
      ...(failed
        ? {
            blocker: {
              category: 'runtime',
              id: 'direct-preview-terminal-failure',
              kind: 'runtime-fallback',
              name: 'Direct preview terminal failure',
              outcome: 'report-only',
              summary: { phase: activeRuntimePhase },
            },
            error: {
              level: 'error',
              message: 'Direct preview entry failed before a committed render.',
              phase: activeRuntimePhase,
              source: 'direct-preview-runtime',
              ...(typeof error === 'string' && error.length > 0
                ? { details: error.slice(0, 16000) }
                : {}),
            },
            event: 'subsequent-error',
            result: {
              changedBlockerIds: ['direct-preview-terminal-failure'],
              discoveredBlockerIds: ['direct-preview-terminal-failure'],
              outcome: 'committed',
              remainingBlockerIds: ['direct-preview-terminal-failure'],
              resolvedBlockerIds: [],
            },
          }
        : {
            event: 'render-result',
            result: {
              changedBlockerIds: [],
              discoveredBlockerIds: [],
              outcome: 'committed',
              remainingBlockerIds: [],
              resolvedBlockerIds: [],
            },
          }),
      previewCommand: 'direct-preview',
      sequence: previewDirectBlockerTraceSequence,
      target: {
        revision: Number.isSafeInteger(previewEntryRevision) && previewEntryRevision >= 0
          ? previewEntryRevision
          : 0,
      },
      timestamp: new Date().toISOString(),
      traceId: 'direct-preview-' + String(previewEntryRevision) + '-' +
        String(previewDirectBlockerTraceSequence),
    },
    type: 'react-preview-blocker-trace',
  };
  try {
    const delivery = postMessage.call(previewHotRuntime.vscodeApi, message);
    if (delivery !== null && typeof delivery === 'object' && typeof delivery.catch === 'function') {
      delivery.catch(() => undefined);
    }
  } catch {
    /* Diagnostic delivery must never alter the direct render lifecycle. */
  }
}
`;
}
