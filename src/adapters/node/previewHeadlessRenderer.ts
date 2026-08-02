/** Runs the existing browser preview document through an isolated Chromium CDP pipe. */
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type { PreviewCompiler } from '../../application/previewCompiler';
import type { PreviewBuildRequest, PreviewDiagnostic } from '../../domain/preview';
import { createHotReloadScriptUri } from '../../presentation/previewHotReloadProtocol';
import { createPreviewHtml } from '../../presentation/webview/previewHtml';
import { planPreviewArtifactLayout } from '../vscode/previewArtifactLayout';
import { createPreviewManagedChildEnvironment } from './previewManagedChildEnvironment';

const DEFAULT_TIMEOUT_MS = 15_000;
const CDP_REQUEST_TIMEOUT_MS = 3_000;
const MAX_CAPTURE_BYTES = 256 * 1_024;
const MAX_EVIDENCE_ITEMS = 64;
const HEADLESS_BRIDGE_PATH = '/react-preview-headless-bridge.js';
const HEADLESS_DOCUMENT_PATH = '/index.html';
export const PREVIEW_HEADLESS_STABILIZATION_QUIET_MS = 1_250;
export const PREVIEW_HEADLESS_STABILIZATION_CAP_MS = 5_000;
export const PREVIEW_HEADLESS_FAILED_CAPTURE_MS = 250;

/** Browser terminal message accepted from the existing runtime protocol. */
export interface PreviewHeadlessTerminal {
  readonly revision: number;
  readonly token: string;
  readonly type: 'react-preview-runtime-failed' | 'react-preview-runtime-ready';
}

/** Bounded browser evidence collected without changing preview success semantics. */
export interface PreviewHeadlessBrowserEvidence {
  readonly cdpExceptions?: readonly string[];
  readonly consoleFailures: readonly string[];
  readonly extensionMessages: readonly string[];
  readonly incidentalNetworkFailures?: readonly string[];
  readonly loopbackRequests: readonly string[];
  readonly requiredArtifactFailures?: readonly string[];
  readonly runtimeEvents: readonly string[];
  readonly windowErrors: readonly string[];
}

/** Compact renderer-owned composition facts retained independently from bounded message text. */
export interface PreviewHeadlessCompositionDiagnostic {
  readonly activeBlockerProvenance: readonly {
    readonly kind: string;
    readonly name: string;
    readonly ownerPath: string;
  }[];
  readonly activeBlockers: number;
  readonly criticalEvidenceTruncated: boolean;
  readonly currentFileMounted: number;
  readonly hostOutput: number;
  readonly pageExecutionCandidateId?: string;
  readonly pageExecutionFidelity?: string;
  readonly pageExecutionNestedMountCount?: number;
  readonly pageExecutionRootSurfaceId?: string;
  readonly pageExecutionTargetSurfaceId?: string;
  readonly requirementSearchExhausted: boolean;
  readonly requirementSearchSettled: boolean;
  readonly requirementSearchStatus: string;
  readonly targetError: boolean;
  readonly targetErrorOwner?: string;
  readonly targetErrorPhase?: string;
  readonly targetExportName: string;
  readonly targetHasOutput: boolean;
  readonly targetMounted: boolean;
  readonly targetOutputKind: string;
  readonly targetOwnershipPhases: Readonly<Record<string, boolean>>;
  readonly targetPageRootCommitted: boolean;
  readonly targetRenderedEmpty: boolean;
  readonly targetSourcePath?: string;
  readonly targetStage: string;
  readonly targetStatus: string;
}

/** Evidence window completed after a matching ready/failed terminal. */
export interface PreviewHeadlessStabilization {
  readonly capReached: boolean;
  readonly compositionSnapshot?: PreviewHeadlessCompositionDiagnostic;
  readonly durationMs: number;
  readonly messagesTruncated: boolean;
  readonly mountMutationCount: number;
  readonly postTerminalSnapshotReceived: boolean;
  /** Whether the extension-owned preparation indicator remained visible at terminal capture. */
  readonly progressVisible: boolean;
  readonly quiet: boolean;
  readonly snapshotCount: number;
  readonly structuredRuntimeError: boolean;
}

/** Source-general stabilized outcome used by the route campaign. */
export type PreviewHeadlessStabilizedOutcome =
  'insufficient-evidence' | 'partial-blocked' | 'post-commit-failed' | 'ready' | 'ready-empty';

/** Structured result from one real compiler-to-Chromium preview execution. */
export interface PreviewHeadlessResult {
  readonly browserExitCode: number | null;
  readonly browserExitSignal?: NodeJS.Signals;
  readonly cleanup: PreviewHeadlessCleanup;
  readonly diagnostics: readonly PreviewDiagnostic[];
  readonly evidence: PreviewHeadlessBrowserEvidence;
  readonly protocolError?: string;
  readonly rootHtml: string;
  readonly runtimeErrorText?: string;
  readonly stabilization?: PreviewHeadlessStabilization;
  readonly stabilizedOutcome?: PreviewHeadlessStabilizedOutcome;
  readonly status: 'failed' | 'protocol-error' | 'ready';
  readonly terminal?: PreviewHeadlessTerminal;
  readonly timeoutDiagnostic?: string;
}

/** Observable resource teardown completed before a result is returned. */
export interface PreviewHeadlessCleanup {
  readonly browserTerminated: boolean;
  readonly profileRemoved: boolean;
  readonly serverClosed: boolean;
}

/** Caller-owned dependencies and bounded process timings for headless execution. */
export interface PreviewHeadlessRendererOptions {
  readonly chromiumPath?: string;
  /** Optional explicit parent environment source; production inherits the current host. */
  readonly parentEnvironment?: Readonly<NodeJS.ProcessEnv>;
  /** Test seam for observing the exact Chromium spawn boundary. */
  readonly spawnProcess?: PreviewHeadlessSpawnProcess;
  readonly timeoutMs?: number;
  readonly virtualTimeMs?: number;
}

/** Narrow Chromium process-spawn boundary retained for deterministic environment tests. */
export type PreviewHeadlessSpawnProcess = (
  executable: string,
  arguments_: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

interface BrowserBridgePayload {
  readonly evidence: Omit<
    PreviewHeadlessBrowserEvidence,
    | 'cdpExceptions'
    | 'incidentalNetworkFailures'
    | 'loopbackRequests'
    | 'requiredArtifactFailures'
    | 'runtimeEvents'
  >;
  readonly rootHtml: string;
  readonly runtimeErrorText?: string;
  readonly stabilization?: PreviewHeadlessStabilization;
  readonly terminal: unknown;
}

interface BrowserExecution {
  readonly exitCode: number | null;
  readonly exitSignal: NodeJS.Signals | null;
  readonly cdpExceptions: readonly string[];
  readonly incidentalNetworkFailures: readonly string[];
  readonly payload?: string;
  readonly requiredArtifactFailures: readonly string[];
  readonly runtimeEvents: readonly string[];
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly timeoutDiagnostic?: string;
}

interface CdpMessage {
  readonly error?: { readonly message?: string };
  readonly id?: number;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly result?: Record<string, unknown>;
  readonly sessionId?: string;
}

/** Result of decoding complete NUL-delimited CDP messages from a streaming buffer. */
export interface PreviewHeadlessCdpFrames {
  readonly messages: readonly CdpMessage[];
  readonly remainder: string;
}

/** One ordered page-session command required before or during preview navigation. */
export interface PreviewHeadlessCdpCommand {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

/**
 * Compiles and executes one immutable preview request through the normal artifact and HTML path.
 */
export async function renderPreviewHeadlessly(
  compiler: PreviewCompiler,
  request: PreviewBuildRequest,
  options: PreviewHeadlessRendererOptions = {},
): Promise<PreviewHeadlessResult> {
  const bundle = await compiler.compile(request);
  const layout = planPreviewArtifactLayout(bundle);
  const revision = 1;
  const token = `${revision.toString()}:${layout.contentHash}`;
  const timeoutMs = validateRunTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const virtualTimeMs = validateVirtualTimeBudget(
    options.virtualTimeMs ?? Math.min(5_000, timeoutMs),
    timeoutMs,
  );
  const chromiumPath = options.chromiumPath ?? discoverChromiumPath();
  if (chromiumPath === undefined) {
    return {
      ...createProtocolFailure(bundle.diagnostics, [], 'No local Chromium executable was found.'),
      cleanup: { browserTerminated: true, profileRemoved: true, serverClosed: true },
    };
  }
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-headless-'));
  const bindingName = `__reactPreviewHeadless_${randomUUID().replaceAll('-', '')}`;
  const routes = new Map<string, { readonly contents: Uint8Array; readonly type: string }>();
  const requests: string[] = [];
  let browser: ChildProcess | undefined;
  let server: Server | undefined;
  let result: Omit<PreviewHeadlessResult, 'cleanup'> | undefined;
  let browserTerminated = true;
  let profileRemoved = false;
  let serverClosed = false;
  try {
    for (const file of layout.files) {
      routes.set(`/${file.relativePath}`, {
        contents: file.contents,
        type: mimeTypeForPreviewArtifact(file.relativePath),
      });
    }
    routes.set(HEADLESS_BRIDGE_PATH, {
      contents: new TextEncoder().encode(
        createPreviewHeadlessBridgeSource(
          token,
          revision,
          bindingName,
          request.renderMode === 'page-inspector',
        ),
      ),
      type: 'text/javascript; charset=utf-8',
    });
    server = createPreviewHeadlessServer(routes, requests);
    const port = await listenOnLoopback(server);
    const origin = `http://127.0.0.1:${port.toString()}`;
    routes.set(HEADLESS_DOCUMENT_PATH, {
      contents: new TextEncoder().encode(
        createPreviewHtml(origin, {
          documentName: path.basename(request.documentPath),
          hostBridgeScriptUri: `${origin}${HEADLESS_BRIDGE_PATH}`,
          kind: 'ready',
          runtimeRevision: revision,
          runtimeToken: token,
          scriptUri: createHotReloadScriptUri(
            `${origin}/${layout.entryPath}`,
            revision,
            layout.contentHash,
          ),
          ...(layout.stylesheetPath === undefined
            ? {}
            : { stylesheetUri: `${origin}/${layout.stylesheetPath}` }),
        }),
      ),
      type: 'text/html; charset=utf-8',
    });
    const execution = await executeChromiumWithCdp(
      chromiumPath,
      `${origin}${HEADLESS_DOCUMENT_PATH}`,
      path.join(temporaryRoot, 'profile'),
      bindingName,
      new Set(routes.keys()),
      timeoutMs,
      virtualTimeMs,
      options.parentEnvironment ?? process.env,
      options.spawnProcess ?? spawnPreviewHeadlessProcess,
      (ownedBrowser) => {
        browser = ownedBrowser;
        browserTerminated = false;
      },
    );
    browserTerminated = execution.exitCode !== null || execution.exitSignal !== null;
    if (browserTerminated) browser = undefined;
    result = readBrowserResult(execution, bundle.diagnostics, requests, token, revision);
  } catch (error) {
    result = createProtocolFailure(
      bundle.diagnostics,
      requests,
      `Headless Chromium execution failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (browser !== undefined && !isBrowserTerminated(browser)) {
      await terminateOwnedBrowser(browser);
    }
    browserTerminated = browser === undefined || isBrowserTerminated(browser);
    if (server !== undefined) {
      await closeServer(server);
      serverClosed = !server.listening;
    } else {
      serverClosed = true;
    }
    await rm(temporaryRoot, { force: true, recursive: true });
    profileRemoved = !existsSync(temporaryRoot);
  }
  result ??= createProtocolFailure(
    bundle.diagnostics,
    requests,
    'Headless Chromium execution ended without a result.',
  );
  return {
    ...result,
    cleanup: { browserTerminated, profileRemoved, serverClosed },
  };
}

/** Returns a content type for planner-validated browser artifact paths. */
export function mimeTypeForPreviewArtifact(relativePath: string): string {
  if (relativePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (relativePath.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'application/octet-stream';
}

/** Decodes only complete NUL-delimited CDP frames and retains the partial suffix. */
export function decodePreviewHeadlessCdpFrames(source: string): PreviewHeadlessCdpFrames {
  const frames = source.split('\0');
  const remainder = frames.pop() ?? '';
  const messages = frames
    .filter((frame) => frame.length > 0)
    .map((frame) => JSON.parse(frame) as CdpMessage);
  return { messages, remainder };
}

/** Lists page commands with the host binding provably installed before navigation. */
export function createPreviewHeadlessCdpCommands(
  bindingName: string,
  documentUrl: string,
  virtualTimeMs: number,
): readonly PreviewHeadlessCdpCommand[] {
  return [
    { method: 'Page.enable', params: {} },
    { method: 'Runtime.enable', params: {} },
    { method: 'Log.enable', params: {} },
    { method: 'Runtime.addBinding', params: { name: bindingName } },
    { method: 'Page.navigate', params: { url: documentUrl } },
    {
      method: 'Emulation.setVirtualTimePolicy',
      params: {
        budget: virtualTimeMs,
        policy: 'pauseIfNetworkFetchesPending',
        waitForNavigation: true,
      },
    },
  ];
}

/** Builds the bounded page snapshot evaluated only after terminal timeout. */
export function createPreviewHeadlessTimeoutExpression(bindingName: string): string {
  const stateName = `${bindingName}State`;
  return `(() => { const state = globalThis[${JSON.stringify(stateName)}]; const root = document.querySelector('#react-preview-root'); const progressHost = document.getElementById('react-preview-progress-host'); return { bridgeInstalled: state?.installed === true, documentReadyState: document.readyState, messages: state?.messages?.slice(0, 64) ?? [], mountHtml: String(root?.innerHTML ?? '').slice(0, 65536), progressVisible: progressHost !== null && progressHost.hidden !== true, runtimeErrorText: root?.querySelector('.react-preview-runtime-error')?.textContent?.slice(0, 4096) }; })()`;
}

/** Applies the v3 evidence policy without inferring success from a ready terminal alone. */
export function classifyPreviewHeadlessStabilizedOutcome(
  result: Pick<
    PreviewHeadlessResult,
    'evidence' | 'rootHtml' | 'runtimeErrorText' | 'stabilization' | 'terminal'
  >,
): PreviewHeadlessStabilizedOutcome {
  const stabilization = result.stabilization;
  const composition = stabilization?.compositionSnapshot;
  if (
    stabilization?.structuredRuntimeError === true ||
    result.runtimeErrorText !== undefined ||
    result.evidence.windowErrors.length > 0 ||
    (result.evidence.cdpExceptions?.length ?? 0) > 0
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
  const evidenceIsConclusive =
    stabilization !== undefined &&
    stabilization.postTerminalSnapshotReceived &&
    stabilization.quiet &&
    !stabilization.capReached &&
    composition !== undefined &&
    !composition.criticalEvidenceTruncated &&
    composition.requirementSearchSettled &&
    (composition.requirementSearchExhausted ||
      !['idle', 'probing', 'searching', 'pending', 'untracked'].includes(
        composition.requirementSearchStatus,
      ));
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

/** Produces the pre-entry VS Code shim and terminal binding publisher. */
export function createPreviewHeadlessBridgeSource(
  token: string,
  revision: number,
  bindingName: string,
  requireCompositionSnapshot = false,
): string {
  const stateName = `${bindingName}State`;
  return String.raw`
(() => {
  const expectedToken = ${JSON.stringify(token)};
  const expectedRevision = ${revision.toString()};
  const bindingName = ${JSON.stringify(bindingName)};
  const requireCompositionSnapshot = ${JSON.stringify(requireCompositionSnapshot)};
  const stateName = ${JSON.stringify(stateName)};
  const limit = 64;
  const maxText = 4096;
  const messages = [];
  const consoleFailures = [];
  const windowErrors = [];
  let evidenceTruncated = false;
  let vscodeState;
  const bridgeState = {
    installed: true,
    messages,
    terminal: undefined,
    terminalAt: undefined,
    lastActivityAt: undefined,
    latestComposition: undefined,
    mountMutationCount: 0,
    published: false,
    snapshotCount: 0,
    structuredRuntimeError: false,
  };
  globalThis[stateName] = bridgeState;
  const bounded = (value) => {
    try { return JSON.stringify(value).slice(0, maxText); }
    catch { return String(value).slice(0, maxText); }
  };
  const retain = (list, value) => {
    if (list.length < limit) list.push(bounded(value));
    else evidenceTruncated = true;
  };
  const markActivity = () => {
    if (bridgeState.terminalAt !== undefined) bridgeState.lastActivityAt = Date.now();
  };
  const readComposition = (message) => {
    const detail = message?.event?.detail;
    const target = detail?.targetState;
    const pageExecution = detail?.pageExecution;
    const search = detail?.requirementSearch;
    const counts = detail?.statusCounts;
    const ownershipPhases =
      target?.ownershipPhases !== null && typeof target?.ownershipPhases === 'object'
        ? Object.fromEntries(
            [
              'compiler-export-evidence',
              'facade-resolution',
              'facade-evaluation',
              'wrapper-render',
              'boundary-commit',
              'source-export-match',
              'fiber-availability',
            ].map((phase) => [
              phase,
              target.ownershipPhases[phase] === true,
            ]),
          )
        : {};
    if (detail === null || typeof detail !== 'object') return undefined;
    const blockerProvenance = Array.isArray(detail?.activeBlockerProvenance)
      ? detail.activeBlockerProvenance
      : detail?.blockerSummary?.items;
    const activeBlockerProvenance = Array.isArray(blockerProvenance)
      ? blockerProvenance
          .filter((item) => item?.active === true)
          .slice(0, 16)
          .map((item) => ({
            kind: String(item?.kind ?? 'unknown').slice(0, 80),
            name: String(item?.name ?? 'Unknown blocker').slice(0, 240),
            ownerPath: String(item?.ownerPath ?? '').slice(0, 320),
          }))
      : [];
    const targetErrorMessage =
      typeof target?.errorMessage === 'string' ? target.errorMessage.slice(0, 1_200) : undefined;
    const targetErrorOwner =
      typeof target?.errorOwner === 'string' ? target.errorOwner.slice(0, 240) : undefined;
    const targetErrorPhase =
      typeof target?.errorPhase === 'string' ? target.errorPhase.slice(0, 240) : undefined;
    const targetFallbackOwner =
      typeof target?.fallbackOwner === 'string' ? target.fallbackOwner.slice(0, 240) : undefined;
    return {
      activeBlockerProvenance,
      activeBlockers: Number.isSafeInteger(detail?.blockerSummary?.active)
        ? Math.max(0, detail.blockerSummary.active)
        : 0,
      criticalEvidenceTruncated:
        detail?.visitLimitReached === true ||
        detail?.statusCounts === '[Depth limit]' ||
        detail?.targetState === '[Depth limit]',
      currentFileMounted: Number.isSafeInteger(counts?.currentFileMounted)
        ? Math.max(0, counts.currentFileMounted)
        : 0,
      hostOutput: Number.isSafeInteger(counts?.hostOutput) ? Math.max(0, counts.hostOutput) : 0,
      ...(typeof pageExecution?.candidateId === 'string'
        ? { pageExecutionCandidateId: pageExecution.candidateId.slice(0, 160) }
        : {}),
      ...(typeof pageExecution?.fidelity === 'string'
        ? { pageExecutionFidelity: pageExecution.fidelity.slice(0, 80) }
        : {}),
      ...(Number.isSafeInteger(pageExecution?.nestedMountCount)
        ? {
            pageExecutionNestedMountCount: Math.max(
              0,
              Number(pageExecution.nestedMountCount),
            ),
          }
        : {}),
      ...(typeof pageExecution?.executionRootSurfaceId === 'string'
        ? { pageExecutionRootSurfaceId: pageExecution.executionRootSurfaceId.slice(0, 240) }
        : {}),
      ...(typeof pageExecution?.runtimeTargetSurfaceId === 'string'
        ? { pageExecutionTargetSurfaceId: pageExecution.runtimeTargetSurfaceId.slice(0, 240) }
        : {}),
      requirementSearchExhausted: search?.exhausted === true,
      requirementSearchSettled: search?.settled === true,
      requirementSearchStatus: String(search?.searchStatus ?? 'untracked').slice(0, 80),
      targetError:
        targetErrorMessage !== undefined ||
        targetErrorOwner !== undefined ||
        targetErrorPhase !== undefined ||
        targetFallbackOwner !== undefined,
      ...(targetErrorOwner === undefined ? {} : { targetErrorOwner }),
      ...(targetErrorPhase === undefined ? {} : { targetErrorPhase }),
      targetExportName: String(target?.exportName ?? 'default').slice(0, 160),
      targetHasOutput: target?.hasOutput === true || target?.reachabilityHasOutput === true,
      targetMounted: target?.mounted === true,
      targetOutputKind: String(target?.outputKind ?? 'none').slice(0, 80),
      targetOwnershipPhases: ownershipPhases,
      targetPageRootCommitted: target?.pageRootCommitted === true,
      targetRenderedEmpty: target?.targetRenderedEmpty === true,
      ...(typeof detail?.evidence?.sourcePath === 'string'
        ? { targetSourcePath: detail.evidence.sourcePath.slice(0, 1_024) }
        : {}),
      targetStage: String(target?.stage ?? 'unknown').slice(0, 80),
      targetStatus: String(target?.status ?? 'unknown').slice(0, 80),
    };
  };
  const capturePayload = () => {
    if (bridgeState.published) return;
    bridgeState.published = true;
    const root = document.querySelector('#react-preview-root');
    const progressHost = document.getElementById('react-preview-progress-host');
    const runtimeError = root?.querySelector('.react-preview-runtime-error');
    const now = Date.now();
    const payload = {
      evidence: { consoleFailures, extensionMessages: messages, windowErrors },
      rootHtml: String(root?.innerHTML ?? '').slice(0, ${MAX_CAPTURE_BYTES.toString()}),
      runtimeErrorText: runtimeError?.textContent?.slice(0, maxText),
      stabilization: {
        capReached:
          bridgeState.terminal?.type === 'react-preview-runtime-ready' &&
          now - bridgeState.terminalAt >= ${PREVIEW_HEADLESS_STABILIZATION_CAP_MS.toString()},
        ...(bridgeState.latestComposition === undefined
          ? {}
          : { compositionSnapshot: bridgeState.latestComposition }),
        durationMs: Math.max(0, now - bridgeState.terminalAt),
        messagesTruncated: evidenceTruncated,
        mountMutationCount: bridgeState.mountMutationCount,
        postTerminalSnapshotReceived: bridgeState.snapshotCount > 0,
        progressVisible: progressHost !== null && progressHost.hidden !== true,
        quiet:
          bridgeState.terminal?.type === 'react-preview-runtime-ready' &&
          bridgeState.snapshotCount > 0 &&
          now - bridgeState.lastActivityAt >= ${PREVIEW_HEADLESS_STABILIZATION_QUIET_MS.toString()},
        snapshotCount: bridgeState.snapshotCount,
        structuredRuntimeError: bridgeState.structuredRuntimeError,
      },
      terminal: bridgeState.terminal,
    };
    const binding = globalThis[bindingName];
    if (typeof binding === 'function') binding(JSON.stringify(payload));
  };
  const scheduleReadyCheck = () => {
    if (!requireCompositionSnapshot) {
      setTimeout(capturePayload, 0);
      return;
    }
    const check = () => {
      if (bridgeState.published || bridgeState.terminalAt === undefined) return;
      const now = Date.now();
      const quiet =
        bridgeState.snapshotCount > 0 &&
        now - bridgeState.lastActivityAt >= ${PREVIEW_HEADLESS_STABILIZATION_QUIET_MS.toString()};
      const capped =
        now - bridgeState.terminalAt >= ${PREVIEW_HEADLESS_STABILIZATION_CAP_MS.toString()};
      if (quiet || capped) capturePayload();
      else setTimeout(check, Math.min(50, Math.max(1,
        ${PREVIEW_HEADLESS_STABILIZATION_QUIET_MS.toString()} -
          (now - bridgeState.lastActivityAt))));
    };
    setTimeout(check, 0);
  };
  const settle = (message) => {
    if (bridgeState.terminal !== undefined) return;
    bridgeState.terminal = { revision: message.revision, token: message.token, type: message.type };
    bridgeState.terminalAt = Date.now();
    bridgeState.lastActivityAt = bridgeState.terminalAt;
    if (message.type === 'react-preview-runtime-failed') {
      setTimeout(capturePayload, ${PREVIEW_HEADLESS_FAILED_CAPTURE_MS.toString()});
    } else {
      scheduleReadyCheck();
    }
  };
  const vscode = Object.freeze({
    getState: () => vscodeState,
    postMessage: (message) => {
      retain(messages, message);
      if (
        bridgeState.terminal?.type === 'react-preview-runtime-ready' &&
        message?.type === 'react-preview-runtime-health' &&
        message?.runtimeRevision === expectedRevision
      ) {
        const event = message?.event?.event;
        if (event === 'page-composition-snapshot') {
          const composition = readComposition(message);
          if (composition !== undefined) {
            bridgeState.latestComposition = composition;
            bridgeState.snapshotCount += 1;
            markActivity();
          }
        } else if (
          event === 'render-attempt-started' ||
          event === 'render-attempt-settled' ||
          String(event ?? '').startsWith('runtime-error')
        ) {
          if (String(event ?? '').startsWith('runtime-error')) {
            bridgeState.structuredRuntimeError = true;
          }
          markActivity();
        }
      }
      if (
        (message?.type === 'react-preview-runtime-ready' ||
          message?.type === 'react-preview-runtime-failed') &&
        message.token === expectedToken &&
        message.revision === expectedRevision
      ) settle(message);
      return Promise.resolve(true);
    },
    setState: (value) => { vscodeState = value; return value; },
  });
  globalThis.acquireVsCodeApi = () => vscode;
  for (const method of ['error', 'warn']) {
    const original = console[method].bind(console);
    console[method] = (...values) => { retain(consoleFailures, values); original(...values); };
  }
  addEventListener('error', (event) => {
    retain(windowErrors, event.error ?? event.message);
    markActivity();
  });
  addEventListener('unhandledrejection', (event) => {
    retain(windowErrors, event.reason);
    markActivity();
  });
  const observeMount = () => {
    const root = document.querySelector('#react-preview-root');
    if (root === null) {
      setTimeout(observeMount, 10);
      return;
    }
    new MutationObserver(() => {
      if (bridgeState.terminal?.type !== 'react-preview-runtime-ready') return;
      bridgeState.mountMutationCount += 1;
      markActivity();
    }).observe(root, { attributes: true, characterData: true, childList: true, subtree: true });
  };
  observeMount();
})();
`;
}

/** Minimal request/event client for Chromium's NUL-delimited DevTools pipe. */
class CdpPipeClient {
  private buffer = '';
  private closedError: Error | undefined;
  private nextId = 1;
  private readonly listeners = new Set<(message: CdpMessage) => void>();
  private readonly pending = new Map<
    number,
    { readonly reject: (error: Error) => void; readonly resolve: (value: CdpMessage) => void }
  >();

  /** Connects request output and event/response input for one owned browser pipe. */
  public constructor(
    private readonly input: Writable,
    output: Readable,
  ) {
    output.on('data', (chunk: Buffer) => {
      try {
        const decoded = decodePreviewHeadlessCdpFrames(this.buffer + chunk.toString('utf8'));
        this.buffer = decoded.remainder;
        for (const message of decoded.messages) this.receive(message);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    input.once('error', (error) => {
      this.fail(error);
    });
    input.once('close', () => {
      this.fail(new Error('Chromium CDP request pipe closed.'));
    });
    output.once('error', (error) => {
      this.fail(error);
    });
    output.once('close', () => {
      this.fail(new Error('Chromium CDP response pipe closed.'));
    });
  }

  /** Subscribes to CDP events and returns a synchronous detach function. */
  public onEvent(listener: (message: CdpMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Sends one bounded request over the browser or attached page session. */
  public request(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<CdpMessage> {
    if (this.closedError !== undefined) return Promise.reject(this.closedError);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP request timed out: ${method}`));
      }, CDP_REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
      });
      this.input.write(
        `${JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) })}\0`,
        (error) => {
          if (error !== null && error !== undefined) this.fail(error);
        },
      );
    });
  }

  /** Rejects every pending request immediately after a process or pipe failure. */
  public fail(error: Error): void {
    if (this.closedError !== undefined) return;
    this.closedError = error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  /** Routes responses to callers and broadcasts target events. */
  private receive(message: CdpMessage): void {
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (pending === undefined) return;
      this.pending.delete(message.id);
      if (message.error === undefined) pending.resolve(message);
      else pending.reject(new Error(message.error.message ?? 'Unknown CDP error.'));
      return;
    }
    for (const listener of this.listeners) listener(message);
  }
}

/** Launches Chromium, installs the binding before navigation, and waits only for its payload. */
async function executeChromiumWithCdp(
  executable: string,
  documentUrl: string,
  profilePath: string,
  bindingName: string,
  plannedRoutePaths: ReadonlySet<string>,
  timeoutMs: number,
  virtualTimeMs: number,
  parentEnvironment: Readonly<NodeJS.ProcessEnv>,
  spawnProcess: PreviewHeadlessSpawnProcess,
  own: (browser: ChildProcess) => void,
): Promise<BrowserExecution> {
  const browser = spawnProcess(
    executable,
    [
      '--headless=new',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-gpu',
      '--disable-sync',
      '--metrics-recording-only',
      '--no-default-browser-check',
      '--no-first-run',
      '--remote-debugging-pipe',
      `--user-data-dir=${profilePath}`,
      'about:blank',
    ],
    {
      detached: process.platform !== 'win32',
      env: createPreviewManagedChildEnvironment(parentEnvironment),
      stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'],
    },
  );
  own(browser);
  const stderr = captureBoundedStream(browser.stderr);
  const input = browser.stdio[3] as Writable | null;
  const output = browser.stdio[4] as Readable | null;
  if (input === null || output === null)
    throw new Error('Chromium CDP pipe descriptors are unavailable.');
  const client = new CdpPipeClient(input, output);
  const processEndPromise = new Promise<{ readonly detail: string; readonly kind: 'process-end' }>(
    (resolve) => {
      browser.once('error', (error) => {
        client.fail(error);
        resolve({ detail: error.message, kind: 'process-end' });
      });
      browser.once('close', (code, signal) => {
        const detail =
          signal === null
            ? `Chromium closed with code ${String(code)}.`
            : `Chromium exited from signal ${signal}.`;
        client.fail(new Error(detail));
        resolve({ detail, kind: 'process-end' });
      });
    },
  );
  const runtimeEvents: string[] = [];
  const cdpExceptions: string[] = [];
  const incidentalNetworkFailures: string[] = [];
  const requiredArtifactFailures: string[] = [];
  let payload: string | undefined;
  let pageSessionId: string | undefined;
  let timeoutDiagnostic: string | undefined;
  let timedOut = false;
  const bindingPromise = new Promise<string>((resolve) => {
    client.onEvent((message) => {
      if (
        (message.method === 'Runtime.exceptionThrown' ||
          message.method === 'Runtime.consoleAPICalled' ||
          message.method === 'Log.entryAdded') &&
        runtimeEvents.length < MAX_EVIDENCE_ITEMS
      )
        runtimeEvents.push(boundedJson(message));
      if (message.method === 'Runtime.exceptionThrown') {
        retainEvidence(cdpExceptions, boundedJson(message));
        if (pageSessionId !== undefined) {
          const stateName = `${bindingName}State`;
          void client
            .request(
              'Runtime.evaluate',
              {
                expression: `(() => { const state = globalThis[${JSON.stringify(stateName)}]; if (state?.terminal?.type === 'react-preview-runtime-ready') state.lastActivityAt = Date.now(); })()`,
              },
              pageSessionId,
            )
            .catch(() => undefined);
        }
      }
      if (message.method === 'Log.entryAdded') {
        const failure = classifyPreviewHeadlessNetworkFailure(
          message.params?.entry,
          documentUrl,
          plannedRoutePaths,
        );
        if (failure?.required === true) retainEvidence(requiredArtifactFailures, failure.text);
        else if (failure !== undefined) retainEvidence(incidentalNetworkFailures, failure.text);
      }
      if (
        message.method === 'Runtime.bindingCalled' &&
        message.params?.name === bindingName &&
        typeof message.params.payload === 'string'
      )
        resolve(message.params.payload);
    });
  });
  try {
    const targetResponse = await client.request('Target.getTargets');
    const targetInfos = targetResponse.result?.targetInfos;
    const targetCandidates: unknown[] = Array.isArray(targetInfos)
      ? (targetInfos as unknown[])
      : [];
    const page: unknown = targetCandidates.find(
      (candidate) =>
        typeof candidate === 'object' &&
        candidate !== null &&
        (candidate as { readonly type?: unknown }).type === 'page',
    );
    let targetId = (page as { readonly targetId?: unknown } | undefined)?.targetId;
    if (typeof targetId !== 'string') {
      const created = await client.request('Target.createTarget', { url: 'about:blank' });
      targetId = created.result?.targetId;
    }
    if (typeof targetId !== 'string')
      throw new Error('Chromium did not expose an attachable page.');
    const attached = await client.request('Target.attachToTarget', { flatten: true, targetId });
    const sessionId = attached.result?.sessionId;
    if (typeof sessionId !== 'string')
      throw new Error('Chromium did not attach a page CDP session.');
    pageSessionId = sessionId;
    for (const command of createPreviewHeadlessCdpCommands(
      bindingName,
      documentUrl,
      virtualTimeMs,
    )) {
      await client.request(command.method, command.params, sessionId);
    }
    const outcome = await Promise.race([
      bindingPromise.then((value) => ({ kind: 'payload' as const, value })),
      delay(timeoutMs).then(() => ({ kind: 'timeout' as const })),
      processEndPromise,
    ]);
    if (outcome.kind === 'payload') payload = outcome.value;
    else if (outcome.kind === 'timeout') {
      timedOut = true;
      timeoutDiagnostic = await collectTimeoutDiagnostic(client, sessionId, bindingName);
    } else {
      throw new Error(outcome.detail);
    }
    void client.request('Browser.close').catch(() => undefined);
    await waitForBrowserClose(browser, 750);
    if (!isBrowserTerminated(browser)) await terminateOwnedBrowser(browser);
    return {
      cdpExceptions,
      exitCode: browser.exitCode,
      exitSignal: browser.signalCode,
      incidentalNetworkFailures,
      ...(payload === undefined ? {} : { payload }),
      requiredArtifactFailures,
      runtimeEvents,
      stderr: stderr(),
      timedOut,
      ...(timeoutDiagnostic === undefined ? {} : { timeoutDiagnostic }),
    };
  } catch (error) {
    await waitForBrowserClose(browser, 100);
    if (!isBrowserTerminated(browser)) await terminateOwnedBrowser(browser);
    return {
      cdpExceptions,
      exitCode: browser.exitCode,
      exitSignal: browser.signalCode,
      incidentalNetworkFailures,
      requiredArtifactFailures,
      runtimeEvents,
      stderr: appendBounded(stderr(), error instanceof Error ? error.message : String(error)),
      timedOut,
    };
  }
}

/** Adapts Node's mutable argument array signature to the renderer's read-only spawn seam. */
function spawnPreviewHeadlessProcess(
  executable: string,
  arguments_: readonly string[],
  options: SpawnOptions,
): ChildProcess {
  return spawn(executable, [...arguments_], options);
}

/** Evaluates a bounded state snapshot when no authoritative binding arrived. */
async function collectTimeoutDiagnostic(
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
    return boundedJson(response.result);
  } catch (error) {
    return `Timeout diagnostic failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Parses and revalidates the bridge payload against the expected terminal correlation. */
function readBrowserResult(
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
    const requiredArtifactProtocolError =
      execution.requiredArtifactFailures.length === 0
        ? undefined
        : `A planned preview artifact failed to load: ${execution.requiredArtifactFailures.at(0) ?? 'unknown artifact'}`;
    const result: Omit<PreviewHeadlessResult, 'cleanup' | 'stabilizedOutcome'> = {
      browserExitCode: execution.exitCode,
      ...(execution.exitSignal === null ? {} : { browserExitSignal: execution.exitSignal }),
      diagnostics,
      evidence,
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
function readPreviewHeadlessTerminal(
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
function createProtocolFailure(
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

interface PreviewHeadlessNetworkFailure {
  readonly required: boolean;
  readonly text: string;
}

/** Separates failed planned artifacts from browser-discovered incidental resources. */
function classifyPreviewHeadlessNetworkFailure(
  value: unknown,
  documentUrl: string,
  plannedRoutePaths: ReadonlySet<string>,
): PreviewHeadlessNetworkFailure | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const entry = value as Record<string, unknown>;
  if (entry.source !== 'network' || entry.level !== 'error') return undefined;
  const text = (typeof entry.text === 'string' ? entry.text : boundedJson(entry)).slice(0, 8_192);
  const discoveredUrl = /https?:\/\/[^\s"'<>]+/u.exec(text)?.[0];
  const urlValue = typeof entry.url === 'string' ? entry.url : discoveredUrl;
  if (urlValue === undefined) return { required: false, text };
  try {
    const failedUrl = new URL(urlValue);
    const previewOrigin = new URL(documentUrl).origin;
    return {
      required: failedUrl.origin === previewOrigin && plannedRoutePaths.has(failedUrl.pathname),
      text,
    };
  } catch {
    return { required: false, text };
  }
}

/** Creates an HTTP server exposing exact planned routes and bounded request evidence. */
function createPreviewHeadlessServer(
  routes: ReadonlyMap<string, { readonly contents: Uint8Array; readonly type: string }>,
  requests: string[],
): Server {
  return createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      retainEvidence(requests, `${request.method ?? 'UNKNOWN'} 405`);
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    let pathname: string;
    try {
      pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    } catch {
      retainEvidence(requests, 'MALFORMED 400');
      response.writeHead(400).end();
      return;
    }
    const route = routes.get(pathname);
    retainEvidence(requests, `${pathname} ${route === undefined ? '404' : '200'}`);
    if (route === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': route.contents.byteLength,
      'Content-Type': route.type,
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : route.contents);
  });
}

/** Binds the owned server to an ephemeral IPv4 loopback port. */
function listenOnLoopback(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Headless preview server did not expose an IPv4 loopback port.'));
      } else resolve(address.port);
    });
  });
}

/** Captures a bounded stream and returns a snapshot reader. */
function captureBoundedStream(stream: Readable | null): () => string {
  let captured = '';
  stream?.on('data', (chunk: Buffer) => {
    captured = appendBounded(captured, chunk.toString('utf8'));
  });
  return () => captured;
}

/** Waits no longer than the supplied close grace period. */
function waitForBrowserClose(browser: ChildProcess, timeoutMs: number): Promise<void> {
  if (isBrowserTerminated(browser)) return Promise.resolve();
  return Promise.race([
    new Promise<void>((resolve) =>
      browser.once('close', () => {
        resolve();
      }),
    ),
    delay(timeoutMs),
  ]);
}

/** Stops only the browser process group spawned by this invocation. */
async function terminateOwnedBrowser(browser: ChildProcess): Promise<void> {
  signalOwnedBrowser(browser, 'SIGTERM');
  await waitForBrowserClose(browser, 500);
  if (!isBrowserTerminated(browser)) {
    signalOwnedBrowser(browser, 'SIGKILL');
    await waitForBrowserClose(browser, 1_000);
  }
  if (!isBrowserTerminated(browser)) throw new Error('Owned Chromium process did not terminate.');
}

/** Recognizes normal and signal-driven process termination. */
function isBrowserTerminated(browser: ChildProcess): boolean {
  return browser.exitCode !== null || browser.signalCode !== null;
}

/** Signals the exact spawned process group so helper children cannot survive cleanup. */
function signalOwnedBrowser(browser: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (process.platform !== 'win32' && browser.pid !== undefined)
      process.kill(-browser.pid, signal);
    else browser.kill(signal);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM') {
      browser.kill(signal);
    } else if (code !== 'ESRCH') {
      throw error;
    }
  }
}

/** Closes the loopback listener and all retained HTTP connections. */
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (
        error === undefined ||
        (error as NodeJS.ErrnoException | undefined)?.code === 'ERR_SERVER_NOT_RUNNING'
      )
        resolve();
      else reject(error);
    });
    server.closeAllConnections();
  });
}

/** Finds Chromium only at explicit or conventional local executable paths. */
function discoverChromiumPath(): string | undefined {
  return [
    process.env.CHROMIUM_PATH,
    '/opt/homebrew/bin/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find((candidate) => candidate !== undefined && candidate.length > 0 && existsSync(candidate));
}

/** Validates the wall-clock ceiling before allocating owned resources. */
function validateRunTimeout(timeoutMs: number): number {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    throw new RangeError('Headless preview timeout must be an integer from 100 to 120000 ms.');
  }
  return timeoutMs;
}

/** Keeps Chromium virtual time positive and no longer than the run wall-clock ceiling. */
function validateVirtualTimeBudget(virtualTimeMs: number, timeoutMs: number): number {
  if (!Number.isSafeInteger(virtualTimeMs) || virtualTimeMs < 1 || virtualTimeMs > timeoutMs) {
    throw new RangeError(
      'Chromium virtual-time budget must be positive and no greater than timeout.',
    );
  }
  return virtualTimeMs;
}

/** Retains one bounded evidence item. */
function retainEvidence(target: string[], value: string): void {
  if (target.length < MAX_EVIDENCE_ITEMS) target.push(value.slice(0, 4096));
}

/** Serializes one CDP value within the evidence budget. */
function boundedJson(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 4096);
  } catch {
    return String(value).slice(0, 4096);
  }
}

/** Retains a bounded prefix of process output. */
function appendBounded(current: string, next: string): string {
  return (current + next).slice(0, MAX_CAPTURE_BYTES);
}

/** Resolves after a bounded wall-clock delay. */
function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}
