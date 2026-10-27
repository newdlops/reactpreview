/** Validates browser evidence and classifies stable preview outcomes. */
import type { PreviewDiagnostic } from '../../domain/preview';
import { createPreviewHeadlessTimeoutExpression } from './previewHeadlessBridgeSource';
import { CdpPipeClient } from './previewHeadlessCdp';
import { normalizeHeadlessEvidence } from './previewHeadlessErrorEvidence';
import type {
  BrowserBridgePayload,
  BrowserExecution,
  PreviewHeadlessBrowserEvidence,
  PreviewHeadlessResult,
  PreviewHeadlessStabilizedOutcome,
  PreviewHeadlessTerminal,
} from './previewHeadlessModel';
import { readPreviewHeadlessNeuralModel } from './previewHeadlessNeuralModel';

/** Applies the v3 evidence policy without inferring success from a ready terminal alone. */
export function classifyPreviewHeadlessStabilizedOutcome(
  result: Pick<
    PreviewHeadlessResult,
    'evidence' | 'rootHtml' | 'runtimeErrorText' | 'stabilization' | 'terminal'
  >,
): PreviewHeadlessStabilizedOutcome {
  const stabilization = result.stabilization;
  const composition = stabilization?.compositionSnapshot;
  const fatalBrowserErrors = readPreviewHeadlessFatalBrowserErrors(result);
  if (
    stabilization?.structuredRuntimeError === true ||
    result.runtimeErrorText !== undefined ||
    fatalBrowserErrors.length > 0
  ) {
    return 'post-commit-failed';
  }
  if (stabilization?.progressVisible === true) {
    return 'partial-blocked';
  }
  if (
    composition !== undefined &&
    (composition.activeBlockers > 0 ||
      composition.targetError ||
      composition.targetOutputKind === 'candidate-output' ||
      composition.targetOutputKind === 'fallback-output' ||
      composition.targetStage === 'candidate-output' ||
      composition.targetStage === 'fallback-output' ||
      (composition.targetPageRootCommitted &&
        composition.requirementSearchExhausted &&
        !composition.targetMounted))
  ) {
    return 'partial-blocked';
  }
  const targetOutputIsConclusive =
    composition?.targetStage === 'target-output' &&
    composition.targetStatus === 'reached' &&
    composition.targetHasOutput;
  const requirementSearchIsConclusive =
    composition !== undefined &&
    composition.requirementSearchSettled &&
    (composition.requirementSearchExhausted ||
      !['idle', 'probing', 'searching', 'pending', 'untracked'].includes(
        composition.requirementSearchStatus,
      ));
  const evidenceIsConclusive =
    stabilization !== undefined &&
    stabilization.postTerminalSnapshotReceived &&
    composition !== undefined &&
    !composition.criticalEvidenceTruncated &&
    (targetOutputIsConclusive || (stabilization.quiet && !stabilization.capReached)) &&
    (targetOutputIsConclusive || requirementSearchIsConclusive);
  if (evidenceIsConclusive) {
    const hasStructuredHostOutput =
      composition.currentFileMounted > 0 && composition.hostOutput > 0;
    const hasCommittedDomEvidence =
      result.rootHtml.trim().length > 0 || stabilization.mountMutationCount > 0;
    if (
      composition.targetPageRootCommitted &&
      composition.activeBlockers === 0 &&
      composition.targetStage === 'target-output' &&
      composition.targetHasOutput &&
      (hasStructuredHostOutput || hasCommittedDomEvidence)
    ) {
      return 'ready';
    }
    if (
      composition.targetPageRootCommitted &&
      composition.activeBlockers === 0 &&
      composition.targetMounted &&
      composition.targetRenderedEmpty
    ) {
      return 'ready-empty';
    }
  }
  return 'insufficient-evidence';
}

/**
 * Returns browser exceptions that remain fatal after a proven runtime recovery or target commit.
 * React reports the first failed render attempt to both `window.onerror` and CDP before the
 * candidate boundary can remove or add its inferred MemoryRouter. Some native-web bridges also
 * dispatch an Error/Promise event without a reason after a successful browser-only fallback. The
 * opaque window event remains in evidence but is not fatal once exact target output is conclusive;
 * CDP exceptions and every descriptive browser error remain fatal.
 */
export function readPreviewHeadlessFatalBrowserErrors(
  result: Pick<PreviewHeadlessResult, 'evidence' | 'stabilization'>,
): readonly string[] {
  const composition = result.stabilization?.compositionSnapshot;
  const conclusiveTargetOutput =
    composition?.targetPageRootCommitted === true &&
    composition.activeBlockers === 0 &&
    composition.currentFileMounted > 0 &&
    composition.hostOutput > 0 &&
    !composition.targetError &&
    composition.targetStage === 'target-output' &&
    composition.targetStatus === 'reached' &&
    composition.targetHasOutput;
  const errors = [
    ...result.evidence.windowErrors.filter(
      (value) => !(conclusiveTargetOutput && value === 'undefined'),
    ),
    ...(result.evidence.cdpExceptions ?? []),
  ];
  return errors.filter((value) => {
    if (
      composition?.pageExecutionTargetRole === 'error-element' &&
      isPreviewHeadlessRouteErrorProbe(value)
    ) {
      return false;
    }
    if (
      result.stabilization?.routerScopeTransition === 'recovered' &&
      isPreviewHeadlessNestedRouterInvariant(value)
    ) {
      return false;
    }
    return true;
  });
}

/** Matches only the compiler-owned exception admitted by a proven error-element recipe. */
export function isPreviewHeadlessRouteErrorProbe(value: string): boolean {
  return /Error: React Preview route error probe(?:\\n|$)/u.test(value);
}

/** Matches only the invariant already admitted by the candidate Router error boundary. */
export function isPreviewHeadlessNestedRouterInvariant(value: string): boolean {
  return /cannot render a (?:<|\\u003c)Router(?:>|\\u003e) inside another (?:<|\\u003c)Router(?:>|\\u003e)|should never have more than one in your app/iu.test(
    value,
  );
}

/** Evaluates a bounded state snapshot when no authoritative binding arrived. */
export async function collectTimeoutDiagnostic(
  client: CdpPipeClient,
  sessionId: string,
  bindingName: string,
): Promise<string> {
  const expression = createPreviewHeadlessTimeoutExpression(bindingName);
  try {
    const response = await client.request(
      'Runtime.evaluate',
      { expression, returnByValue: true },
      sessionId,
    );
    return serializePreviewHeadlessTimeoutDiagnostic(response.result);
  } catch (error) {
    return `Timeout diagnostic failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Parses and revalidates the bridge payload against the expected terminal correlation. */
export function readBrowserResult(
  execution: BrowserExecution,
  diagnostics: readonly PreviewDiagnostic[],
  requests: readonly string[],
  expectedToken: string,
  expectedRevision: number,
): Omit<PreviewHeadlessResult, 'cleanup'> {
  if (execution.payload === undefined) {
    return createProtocolFailure(
      diagnostics,
      requests,
      execution.timedOut
        ? 'Chromium timed out before a matching terminal signal.'
        : `Chromium closed without a matching terminal signal.${
            execution.stderr.trim().length === 0 ? '' : ` ${execution.stderr.trim().slice(0, 4096)}`
          }`,
      execution,
    );
  }
  try {
    const payload = JSON.parse(execution.payload) as BrowserBridgePayload;
    const terminal = readPreviewHeadlessTerminal(payload.terminal, expectedToken, expectedRevision);
    if (terminal === undefined) {
      throw new Error('Bridge terminal correlation did not match the requested preview.');
    }
    const evidence: PreviewHeadlessBrowserEvidence = {
      cdpExceptions: execution.cdpExceptions,
      ...payload.evidence,
      incidentalNetworkFailures: execution.incidentalNetworkFailures,
      loopbackRequests: requests,
      requiredArtifactFailures: execution.requiredArtifactFailures,
      runtimeEvents: execution.runtimeEvents,
    };
    const neuralResidualModel = readPreviewHeadlessNeuralModel(payload.neuralResidualModel);
    const requiredArtifactProtocolError =
      execution.requiredArtifactFailures.length === 0
        ? undefined
        : `A planned preview artifact failed to load: ${execution.requiredArtifactFailures.at(0) ?? 'unknown artifact'}`;
    const result: Omit<PreviewHeadlessResult, 'cleanup' | 'stabilizedOutcome'> = {
      browserExitCode: execution.exitCode,
      ...(execution.exitSignal === null ? {} : { browserExitSignal: execution.exitSignal }),
      diagnostics,
      evidence,
      ...(neuralResidualModel === undefined ? {} : { neuralResidualModel }),
      ...(requiredArtifactProtocolError === undefined
        ? {}
        : { protocolError: requiredArtifactProtocolError }),
      rootHtml: payload.rootHtml,
      ...(payload.stabilization === undefined ? {} : { stabilization: payload.stabilization }),
      status:
        requiredArtifactProtocolError !== undefined
          ? 'protocol-error'
          : terminal.type === 'react-preview-runtime-ready'
            ? 'ready'
            : 'failed',
      terminal,
      ...(payload.runtimeErrorText === undefined
        ? {}
        : { runtimeErrorText: payload.runtimeErrorText }),
    };
    if (
      terminal.type !== 'react-preview-runtime-ready' ||
      requiredArtifactProtocolError !== undefined
    ) {
      return result;
    }
    return {
      ...result,
      stabilizedOutcome: classifyPreviewHeadlessStabilizedOutcome(result),
    };
  } catch (error) {
    return createProtocolFailure(
      diagnostics,
      requests,
      `Chromium returned malformed bridge evidence: ${error instanceof Error ? error.message : String(error)}`,
      execution,
    );
  }
}

/** Validates one untrusted bridge terminal against the requested preview correlation. */
export function readPreviewHeadlessTerminal(
  value: unknown,
  expectedToken: string,
  expectedRevision: number,
): PreviewHeadlessTerminal | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const terminal = value as Record<string, unknown>;
  if (
    terminal.token !== expectedToken ||
    terminal.revision !== expectedRevision ||
    (terminal.type !== 'react-preview-runtime-ready' &&
      terminal.type !== 'react-preview-runtime-failed')
  )
    return undefined;
  return {
    revision: expectedRevision,
    token: expectedToken,
    type: terminal.type,
  };
}

/** Creates an explicit protocol failure with bounded CDP and loopback diagnostics. */
export function createProtocolFailure(
  diagnostics: readonly PreviewDiagnostic[],
  requests: readonly string[],
  protocolError: string,
  execution?: BrowserExecution,
): Omit<PreviewHeadlessResult, 'cleanup'> {
  return {
    browserExitCode: execution?.exitCode ?? null,
    ...(execution?.exitSignal === undefined || execution.exitSignal === null
      ? {}
      : { browserExitSignal: execution.exitSignal }),
    diagnostics,
    evidence: {
      cdpExceptions: execution?.cdpExceptions ?? [],
      consoleFailures: [],
      extensionMessages: [],
      incidentalNetworkFailures: execution?.incidentalNetworkFailures ?? [],
      loopbackRequests: requests,
      requiredArtifactFailures: execution?.requiredArtifactFailures ?? [],
      runtimeEvents: execution?.runtimeEvents ?? [],
      windowErrors:
        execution?.stderr.trim().length === 0
          ? []
          : [execution?.stderr.trim().slice(0, 4096) ?? ''],
    },
    protocolError,
    rootHtml: '',
    status: 'protocol-error',
    ...(execution?.timeoutDiagnostic === undefined
      ? {}
      : { timeoutDiagnostic: execution.timeoutDiagnostic }),
  };
}

/** Serializes one CDP value within the evidence budget. */
export function boundedJson(value: unknown): string {
  return normalizeHeadlessEvidence(value).slice(0, 4096);
}

/** Keeps terminal timeout facts ahead of unbounded browser message text. */
export function serializePreviewHeadlessTimeoutDiagnostic(value: unknown): string {
  const cdpResult =
    typeof value === 'object' && value !== null && 'result' in value
      ? (value as { readonly result?: unknown }).result
      : value;
  const remoteValue =
    typeof cdpResult === 'object' && cdpResult !== null && 'value' in cdpResult
      ? (cdpResult as { readonly value?: unknown }).value
      : cdpResult;
  if (typeof remoteValue !== 'object' || remoteValue === null) return boundedJson(remoteValue);
  const snapshot = remoteValue as Record<string, unknown>;
  const composition = snapshot.composition;
  const terminal = snapshot.terminal;
  const mount = snapshot.mount;
  const messageTail = Array.isArray(snapshot.messages) ? snapshot.messages.slice(-16) : [];
  return JSON.stringify({
    document: {
      bodyPreviewState: snapshot.bodyPreviewState,
      bridgeInstalled: snapshot.bridgeInstalled,
      readyState: snapshot.documentReadyState,
    },
    entryModule: snapshot.entryModule,
    hotRuntime: snapshot.hotRuntime,
    progress: snapshot.progress,
    composition:
      composition === undefined
        ? undefined
        : normalizeHeadlessEvidence(composition).slice(0, 1_600),
    terminal:
      terminal === undefined ? undefined : normalizeHeadlessEvidence(terminal).slice(0, 400),
    counts: {
      messageCount: snapshot.messageCount,
      snapshotCount: snapshot.snapshotCount,
    },
    runtimeErrorText:
      typeof snapshot.runtimeErrorText === 'string'
        ? snapshot.runtimeErrorText.slice(0, 800)
        : undefined,
    mount: mount === undefined ? undefined : normalizeHeadlessEvidence(mount).slice(0, 800),
    messages: messageTail.map((message) => normalizeHeadlessEvidence(message).slice(0, 120)),
  }).slice(0, 4096);
}
export { normalizeHeadlessEvidence } from './previewHeadlessErrorEvidence';
