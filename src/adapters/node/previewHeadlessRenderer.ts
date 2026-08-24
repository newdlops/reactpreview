/** Runs the existing browser preview document through an isolated Chromium CDP pipe. */
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type { PreviewCompiler } from '../../application/previewCompiler';
import type { PreviewBuildRequest, PreviewBundle, PreviewDiagnostic } from '../../domain/preview';
import { createHotReloadScriptUri } from '../../presentation/previewHotReloadProtocol';
import { createPreviewHtml } from '../../presentation/webview/previewHtml';
import { planPreviewArtifactLayout } from '../vscode/previewArtifactLayout';
import { PREVIEW_INSPECTOR_ROUTE_ERROR_PROBE_SYMBOL_KEY } from '../esbuild/inspector/previewInspectorRouteExecutionRuntimeSource';
import { createPreviewManagedChildEnvironment } from './previewManagedChildEnvironment';

const DEFAULT_TIMEOUT_MS = 15_000;
const CDP_REQUEST_TIMEOUT_MS = 3_000;
const CDP_STARTUP_REQUEST_TIMEOUT_MS = 12_000;
const MAX_CAPTURE_BYTES = 256 * 1_024;
const MAX_EVIDENCE_ITEMS = 64;
const HEADLESS_BRIDGE_PATH = '/react-preview-headless-bridge.js';
const HEADLESS_DOCUMENT_PATH = '/index.html';
const HEADLESS_PUBLIC_ASSET_PREFIX = '/__react_preview_public__/';
const MAX_HEADLESS_PUBLIC_ASSET_BYTES = 20 * 1024 * 1024;
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
  readonly contextModuleEvidenceKind?: string;
  readonly contextModuleImportPathLength?: number;
  readonly contextModuleSourcePath?: string;
  readonly currentFileMounted: number;
  readonly hostOutput: number;
  readonly pageExecutionCandidateId?: string;
  readonly pageExecutionFidelity?: string;
  readonly pageExecutionNestedMountCount?: number;
  readonly pageExecutionRootSurfaceId?: string;
  readonly pageExecutionStandaloneTarget?: boolean;
  readonly pageExecutionTargetSurfaceId?: string;
  readonly pageExecutionTargetRole?: string;
  readonly requirementSearchExhausted: boolean;
  readonly requirementSearchObservedPathCount?: number;
  readonly requirementSearchPass?: number;
  readonly requirementSearchSettled: boolean;
  readonly requirementSearchStatus: string;
  readonly requirementSearchTotalPasses?: number;
  readonly targetAppliedConditionCount?: number;
  readonly targetDetachedBoundaryOutput?: boolean;
  readonly targetDetachedTargetPlacement?: string;
  readonly targetDirectElementOutput?: boolean;
  readonly targetAttempt?: number;
  readonly targetAutoAttemptMode?: string;
  readonly targetAutoAttemptResumeHandled?: boolean;
  readonly targetAutoAttemptResumeScheduled?: boolean;
  readonly targetAutoAttemptSettled?: boolean;
  readonly targetContextualFallbackRequested?: boolean;
  readonly targetError: boolean;
  readonly targetErrorDetails?: string;
  readonly targetErrorLocation?: string;
  readonly targetErrorMessage?: string;
  readonly targetErrorOwner?: string;
  readonly targetErrorPhase?: string;
  readonly targetErrorStack?: string;
  readonly targetExportName: string;
  readonly targetHasOutput: boolean;
  readonly targetIdlePasses?: number;
  readonly targetLastContinuationSkipReason?: string;
  readonly targetMounted: boolean;
  readonly targetOutputKind: string;
  readonly targetOwnershipPhases: Readonly<Record<string, boolean>>;
  readonly targetPageRootCommitted: boolean;
  readonly targetProbeRevision?: number;
  readonly targetProjectedCompatibilityOutput?: boolean;
  readonly targetRejectedConditionCount?: number;
  readonly targetRuntimeFallbackSummaries?: readonly string[];
  readonly targetEffectControllerOutput?: boolean;
  readonly targetRenderedEmpty: boolean;
  readonly targetRenderCommitChain?: {
    readonly alternateFiberObserved: boolean;
    readonly childrenForwarded: boolean;
    readonly connectedHostCount: number;
    readonly effectCompletedAfterMarkedCall: boolean;
    readonly firstBreak: string;
    readonly markedCallEffectId: string;
    readonly markedCallPropertyPath: string;
    readonly markedCallResult: boolean;
    readonly ownedHostObserved: boolean;
    readonly privateOwnershipCount: number;
    readonly resolverOutcome: string;
    readonly specializedReplacementExecuted: boolean;
    readonly stableRerenderObserved: boolean;
    readonly topologyVerdict: 'A' | 'B' | 'C' | 'D';
    readonly topologyReason: string;
    readonly topologyEffectContinuationAccepted: boolean;
    readonly topologyDelayedProbeFired: boolean;
    readonly topologyBoundaryIdentityRetained: boolean;
    readonly topologyCurrentBranchAmbiguous: boolean;
    readonly topologyCurrentExactTargetCount: number;
    readonly topologyLocatorExactTargetCount: number;
    readonly topologyCurrentTargetChildCount: number;
    readonly topologyCurrentRetainedChildCount: number;
    readonly topologyCurrentConnectedVisibleHostCount: number;
    readonly topologyCurrentDescendantHostCount: number;
    readonly topologyStaleExactTargetCount: number;
    readonly topologyStaleConnectedVisibleHostCount: number;
    readonly thunkTexts: readonly string[];
    readonly logicalTargetCount: number;
    readonly inputChildrenState: 'absent' | 'meaningful-or-unsupported';
    readonly mountedChildrenGateDecision: {
      readonly latchBefore: boolean;
      readonly directTarget: boolean;
      readonly pageRootCommitted: boolean;
      readonly currentMount: boolean;
      readonly targetOutput: boolean;
      readonly repairError: boolean;
      readonly activeKey: boolean;
      readonly renderError: boolean;
      readonly registrationCount: number;
      readonly registrationConflict: boolean;
      readonly transparentCapability: boolean;
      readonly retainedRouteAvailable: boolean;
      readonly retainedRouteOwned: boolean;
      readonly boundaryCount: number;
      readonly chainAvailable: boolean;
      readonly alternateFiber: boolean;
      readonly stableRerender: boolean;
      readonly markedCall: boolean;
      readonly effectCompleted: boolean;
      readonly logicalTargetCount: number;
      readonly inputChildrenState: 'absent' | 'meaningful-or-unsupported';
      readonly returnedChild: boolean;
      readonly ownedHost: boolean;
      readonly latchAfter: boolean;
      readonly requestAttempted: boolean;
      readonly requestAccepted: boolean;
      readonly notificationIssued: boolean;
      readonly mountedChildrenGateFirstReject: string;
    };
  };
  readonly targetSourcePath?: string;
  readonly targetStage: string;
  readonly targetStatus: string;
  readonly targetWasMounted?: boolean;
  readonly selectedRoutePathname?: string;
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
  /** Final candidate-local Router retry state observed through runtime-health telemetry. */
  readonly routerScopeTransition?: 'recovered' | 'recovering' | 'unresolved';
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
  /** Bounded observational ownership telemetry; exceptions are deliberately ignored. */
  readonly reportOwnership?: (event: PreviewHeadlessOwnershipEvent) => void;
}

export type PreviewHeadlessOwnershipEvent =
  | { readonly kind: 'profile-created'; readonly profileRoot: string }
  | {
      readonly kind: 'server-listening';
      readonly loopbackPort: number;
      readonly profileRoot: string;
    }
  | {
      readonly kind: 'browser-spawned';
      readonly pid?: number;
      readonly pgid?: number;
      readonly profileRoot: string;
    }
  | {
      readonly kind: 'browser-terminal';
      readonly pid?: number;
      readonly pgid?: number;
      readonly profileRoot: string;
    }
  | { readonly kind: 'server-closed'; readonly profileRoot: string }
  | { readonly kind: 'profile-removed'; readonly profileRoot: string };

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

export interface CdpMessage {
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
  return renderCompiledPreviewHeadlessly(bundle, request, options);
}

/**
 * Executes a caller-owned immutable compiler result through the normal Page Context document.
 * Campaign lanes use this seam to serialize compilation separately from rendering.
 */
export async function renderCompiledPreviewHeadlessly(
  bundle: PreviewBundle,
  request: PreviewBuildRequest,
  options: PreviewHeadlessRendererOptions = {},
): Promise<PreviewHeadlessResult> {
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
  reportPreviewHeadlessOwnership(options, { kind: 'profile-created', profileRoot: temporaryRoot });
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
    server = createPreviewHeadlessServer(routes, requests, bundle.publicAssetRoot);
    const port = await listenOnLoopback(server);
    reportPreviewHeadlessOwnership(options, {
      kind: 'server-listening',
      loopbackPort: port,
      profileRoot: temporaryRoot,
    });
    const origin = `http://127.0.0.1:${port.toString()}`;
    routes.set(HEADLESS_DOCUMENT_PATH, {
      contents: new TextEncoder().encode(
        createPreviewHtml(origin, {
          documentName: path.basename(request.documentPath),
          hostBridgeScriptUri: `${origin}${HEADLESS_BRIDGE_PATH}`,
          kind: 'ready',
          ...(bundle.publicAssetRoot === undefined
            ? {}
            : { publicAssetBaseUri: `${origin}${HEADLESS_PUBLIC_ASSET_PREFIX}` }),
          ...(layout.moduleImports === undefined
            ? {}
            : {
                moduleImports: layout.moduleImports.map(({ relativePath, specifier }) => ({
                  specifier,
                  uri: `${origin}/${relativePath}`,
                })),
              }),
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
        reportPreviewHeadlessOwnership(options, {
          kind: 'browser-spawned',
          ...(ownedBrowser.pid === undefined ? {} : { pid: ownedBrowser.pid }),
          ...(process.platform === 'win32' || ownedBrowser.pid === undefined
            ? {}
            : { pgid: ownedBrowser.pid }),
          profileRoot: temporaryRoot,
        });
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
    reportPreviewHeadlessOwnership(options, {
      kind: 'browser-terminal',
      ...(browser?.pid === undefined ? {} : { pid: browser.pid }),
      ...(process.platform === 'win32' || browser?.pid === undefined ? {} : { pgid: browser.pid }),
      profileRoot: temporaryRoot,
    });
    if (server !== undefined) {
      await closeServer(server);
      serverClosed = !server.listening;
      reportPreviewHeadlessOwnership(options, {
        kind: 'server-closed',
        profileRoot: temporaryRoot,
      });
    } else {
      serverClosed = true;
    }
    await rm(temporaryRoot, { force: true, recursive: true });
    profileRemoved = !existsSync(temporaryRoot);
    reportPreviewHeadlessOwnership(options, {
      kind: 'profile-removed',
      profileRoot: temporaryRoot,
    });
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
  _virtualTimeMs: number,
): readonly PreviewHeadlessCdpCommand[] {
  return [
    { method: 'Page.enable', params: {} },
    { method: 'Runtime.enable', params: {} },
    { method: 'Log.enable', params: {} },
    { method: 'Runtime.addBinding', params: { name: bindingName } },
    { method: 'Page.navigate', params: { url: documentUrl } },
  ];
}

/** Builds the bounded page snapshot evaluated only after terminal timeout. */
export function createPreviewHeadlessTimeoutExpression(bindingName: string): string {
  const stateName = `${bindingName}State`;
  return `(() => {
    const state = globalThis[${JSON.stringify(stateName)}];
    const root = document.querySelector?.('[data-react-preview-mount]') ?? document.getElementById('react-preview-root');
    const progressHost = document.getElementById('react-preview-progress-host');
    const progressRoot = progressHost?.shadowRoot;
    const hotRuntime = globalThis[Symbol.for('newdlops.react-file-preview.hot-runtime')];
    const entryScript = document.querySelector('script[type="module"][src]');
    let entryResource;
    try {
      entryResource = entryScript?.src === undefined
        ? undefined
        : performance.getEntriesByName(entryScript.src, 'resource').at(-1);
    } catch {
      entryResource = undefined;
    }
    const portalHtml = [...(document.body?.children ?? [])]
      .filter((node) => node !== root && node?.contains?.(root) !== true && node?.id !== 'react-preview-progress-host' && node?.hasAttribute?.('data-react-preview-inspector-ui') !== true && !['SCRIPT', 'STYLE'].includes(node?.tagName))
      .map((node) => node.outerHTML ?? '')
      .join('');
    return {
      bodyPreviewState: document.body?.dataset?.reactPreviewState,
      bridgeInstalled: state?.installed === true,
      composition: state?.latestComposition,
      documentReadyState: document.readyState,
      entryModule: {
        duration: Number.isFinite(entryResource?.duration) ? entryResource.duration : undefined,
        initiatorType: typeof entryResource?.initiatorType === 'string' ? entryResource.initiatorType.slice(0, 80) : undefined,
        present: entryScript !== null,
        resourceObserved: entryResource !== undefined,
        responseEnd: Number.isFinite(entryResource?.responseEnd) ? entryResource.responseEnd : undefined,
        source: typeof entryScript?.src === 'string' ? entryScript.src.slice(-1_024) : undefined,
        state: entryScript === null ? 'missing-script' : entryResource === undefined ? 'requested-or-pending' : 'loaded',
        transferSize: Number.isFinite(entryResource?.transferSize) ? entryResource.transferSize : undefined,
      },
      hotRuntime: {
        bootstrapPromisePresent: hotRuntime?.bootstrapPromise !== undefined,
        preparedEntryPresent: hotRuntime?.preparedEntry !== undefined,
        preparationPromisePresent: hotRuntime?.preparedEntry?.preparationPromise !== undefined,
        present: hotRuntime !== undefined,
        rootPresent: hotRuntime?.root !== undefined,
      },
      messageCount: Array.isArray(state?.messages) ? state.messages.length : 0,
      messages: state?.messages?.slice(-16) ?? [],
      mount: {
        ariaBusy: root?.getAttribute?.('aria-busy'),
        childElementCount: root?.childElementCount ?? 0,
        html: (String(root?.innerHTML ?? '') + portalHtml).slice(0, 65_536),
        isConnected: root?.isConnected === true,
        present: root !== null,
      },
      progress: {
        detail: progressRoot?.getElementById('react-preview-progress-detail')?.textContent?.slice(0, 400),
        label: progressRoot?.getElementById('react-preview-progress-label')?.textContent?.slice(0, 240),
        openShadowRootPresent: progressRoot !== null && progressRoot !== undefined,
        present: progressHost !== null,
        step: progressRoot?.getElementById('react-preview-progress-step')?.textContent?.slice(0, 160),
        visible: progressHost !== null && progressHost.hidden !== true,
      },
      runtimeErrorText: root?.querySelector('.react-preview-runtime-error')?.textContent?.slice(0, 4_096),
      snapshotCount: state?.snapshotCount ?? 0,
      terminal: state?.terminal,
    };
  })()`;
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
function isPreviewHeadlessRouteErrorProbe(value: string): boolean {
  return /Error: React Preview route error probe(?:\\n|$)/u.test(value);
}

/** Matches only the invariant already admitted by the candidate Router error boundary. */
function isPreviewHeadlessNestedRouterInvariant(value: string): boolean {
  return /cannot render a (?:<|\\u003c)Router(?:>|\\u003e) inside another (?:<|\\u003c)Router(?:>|\\u003e)|should never have more than one in your app/iu.test(
    value,
  );
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
  const routeErrorProbeSymbol = Symbol.for(${JSON.stringify(PREVIEW_INSPECTOR_ROUTE_ERROR_PROBE_SYMBOL_KEY)});
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
    routerScopeTransition: undefined,
    snapshotCount: 0,
    structuredRuntimeError: false,
  };
  globalThis[stateName] = bridgeState;
  const bounded = (value) => normalizeEvidence(value, new WeakSet(), 0).slice(0, maxText);
  const normalizeEvidence = (value, seen, depth) => {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    const type = typeof value;
    if (type === 'string') return value;
    if (type === 'number' || type === 'boolean' || type === 'bigint') return String(value);
    if (type === 'symbol') return value.toString();
    if (type === 'function') return '[function]';
    if (depth >= 4) return '[max-depth]';
    if (type !== 'object') return String(value);
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    try {
      const record = value;
      const name = typeof record.name === 'string' ? record.name : undefined;
      const message = typeof record.message === 'string' ? record.message : undefined;
      const cause = record.cause;
      if (name !== undefined || message !== undefined || cause !== undefined) {
        const head = (name ?? 'Error') + (message === undefined || message.length === 0 ? '' : ': ' + message);
        return head + (cause === undefined ? '' : '; cause=' + normalizeEvidence(cause, seen, depth + 1));
      }
      const fields = Object.keys(record).sort().slice(0, 12).map((key) => {
        let field;
        try { field = record[key]; } catch { return key + '=[unreadable]'; }
        return key + '=' + normalizeEvidence(field, seen, depth + 1);
      });
      return fields.length === 0 ? Object.prototype.toString.call(value) : '{' + fields.join(', ') + '}';
    } catch { return Object.prototype.toString.call(value); }
    finally { seen.delete(value); }
  };
  const retain = (list, value) => {
    if (list.length < limit) list.push(bounded(value));
    else evidenceTruncated = true;
  };
  const markActivity = () => {
    if (bridgeState.terminalAt !== undefined) bridgeState.lastActivityAt = Date.now();
  };
  const selectMountNode = () =>
    document.querySelector?.('[data-react-preview-mount]') ??
    document.getElementById('react-preview-root');
  const readRenderedHtml = (root, maximumLength) => {
    const portalHtml = [...(document.body?.children ?? [])]
      .filter((node) =>
        node !== root &&
        node?.contains?.(root) !== true &&
        node?.id !== 'react-preview-progress-host' &&
        node?.hasAttribute?.('data-react-preview-inspector-ui') !== true &&
        !['SCRIPT', 'STYLE'].includes(node?.tagName)
      )
      .map((node) => node.outerHTML ?? '')
      .join('');
    return (String(root?.innerHTML ?? '') + portalHtml).slice(0, maximumLength);
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
    const targetErrorDetails =
      typeof target?.errorDetails === 'string' ? target.errorDetails.slice(0, 2_400) : undefined;
    const targetErrorLocation =
      typeof target?.errorLocation === 'string' ? target.errorLocation.slice(0, 1_024) : undefined;
    const targetErrorOwner =
      typeof target?.errorOwner === 'string' ? target.errorOwner.slice(0, 240) : undefined;
    const targetErrorPhase =
      typeof target?.errorPhase === 'string' ? target.errorPhase.slice(0, 240) : undefined;
    const targetErrorStack =
      typeof target?.errorStack === 'string' ? target.errorStack.slice(0, 4_000) : undefined;
    const targetFallbackOwner =
      typeof target?.fallbackOwner === 'string' ? target.fallbackOwner.slice(0, 240) : undefined;
    const rawChain = target?.targetRenderCommitChain;
    const mountedGateRejects = new Set([
      'not-evaluated', 'prior-latch-set', 'direct-target', 'page-root-not-committed',
      'current-mount-not-observed', 'target-output-observed', 'repair-error-present',
      'active-key-not-owned', 'render-error-present', 'registration-not-unique',
      'registration-conflict', 'transparent-capability-unavailable',
      'retained-route-unavailable', 'retained-route-not-owned', 'boundary-count-not-one',
      'render-chain-unavailable', 'alternate-fiber-not-observed',
      'stable-rerender-not-observed', 'marked-context-call-not-used',
      'effect-not-completed-after-marked-call', 'logical-target-count-not-one',
      'input-children-not-absent', 'returned-child-observed', 'owned-host-observed', 'none',
    ]);
    const rawMountedDecision = rawChain?.mountedChildrenGateDecision;
    const mountedChildrenGateDecision = rawMountedDecision !== null &&
      typeof rawMountedDecision === 'object'
      ? {
          latchBefore: rawMountedDecision.latchBefore === true,
          directTarget: rawMountedDecision.directTarget === true,
          pageRootCommitted: rawMountedDecision.pageRootCommitted === true,
          currentMount: rawMountedDecision.currentMount === true,
          targetOutput: rawMountedDecision.targetOutput === true,
          repairError: rawMountedDecision.repairError === true,
          activeKey: rawMountedDecision.activeKey === true,
          renderError: rawMountedDecision.renderError === true,
          registrationCount: Number.isSafeInteger(rawMountedDecision.registrationCount) ? Math.max(0, rawMountedDecision.registrationCount) : 0,
          registrationConflict: rawMountedDecision.registrationConflict === true,
          transparentCapability: rawMountedDecision.transparentCapability === true,
          retainedRouteAvailable: rawMountedDecision.retainedRouteAvailable === true,
          retainedRouteOwned: rawMountedDecision.retainedRouteOwned === true,
          boundaryCount: Number.isSafeInteger(rawMountedDecision.boundaryCount) ? Math.max(0, rawMountedDecision.boundaryCount) : 0,
          chainAvailable: rawMountedDecision.chainAvailable === true,
          alternateFiber: rawMountedDecision.alternateFiber === true,
          stableRerender: rawMountedDecision.stableRerender === true,
          markedCall: rawMountedDecision.markedCall === true,
          effectCompleted: rawMountedDecision.effectCompleted === true,
          logicalTargetCount: Number.isSafeInteger(rawMountedDecision.logicalTargetCount) ? Math.max(0, rawMountedDecision.logicalTargetCount) : 0,
          inputChildrenState: rawMountedDecision.inputChildrenState === 'absent' ? 'absent' : 'meaningful-or-unsupported',
          returnedChild: rawMountedDecision.returnedChild === true,
          ownedHost: rawMountedDecision.ownedHost === true,
          latchAfter: rawMountedDecision.latchAfter === true,
          requestAttempted: rawMountedDecision.requestAttempted === true,
          requestAccepted: rawMountedDecision.requestAccepted === true,
          notificationIssued: rawMountedDecision.notificationIssued === true,
          mountedChildrenGateFirstReject: mountedGateRejects.has(rawMountedDecision.mountedChildrenGateFirstReject)
            ? rawMountedDecision.mountedChildrenGateFirstReject
            : 'not-evaluated',
        }
      : {
          latchBefore: false, directTarget: false, pageRootCommitted: false, currentMount: false,
          targetOutput: false, repairError: false, activeKey: false, renderError: false,
          registrationCount: 0, registrationConflict: false, transparentCapability: false,
          retainedRouteAvailable: false, retainedRouteOwned: false, boundaryCount: 0,
          chainAvailable: false, alternateFiber: false, stableRerender: false, markedCall: false,
          effectCompleted: false, logicalTargetCount: 0,
          inputChildrenState: 'meaningful-or-unsupported', returnedChild: false,
          ownedHost: false, latchAfter: false, requestAttempted: false, requestAccepted: false,
          notificationIssued: false, mountedChildrenGateFirstReject: 'not-evaluated',
        };
    const targetRenderCommitChain = rawChain !== null && typeof rawChain === 'object'
      ? {
          alternateFiberObserved: rawChain.alternateFiberObserved === true,
          childrenForwarded: rawChain.childrenForwarded === true,
          connectedHostCount: Number.isSafeInteger(rawChain.connectedHostCount) ? Math.max(0, rawChain.connectedHostCount) : 0,
          effectCompletedAfterMarkedCall: rawChain.effectCompletedAfterMarkedCall === true,
          firstBreak: String(rawChain.firstBreak ?? 'unknown').slice(0, 80),
          markedCallEffectId: String(rawChain.markedCallEffectId ?? '').slice(0, 240),
          markedCallPropertyPath: String(rawChain.markedCallPropertyPath ?? '').slice(0, 240),
          markedCallResult: rawChain.markedCallResult === true,
          ownedHostObserved: rawChain.ownedHostObserved === true,
          inputChildrenState: rawChain.inputChildrenState === 'absent' ? 'absent' : 'meaningful-or-unsupported',
          logicalTargetCount: Number.isSafeInteger(rawChain.logicalTargetCount) ? Math.max(0, rawChain.logicalTargetCount) : 0,
          privateOwnershipCount: Number.isSafeInteger(rawChain.privateOwnershipCount) ? Math.max(0, rawChain.privateOwnershipCount) : 0,
          resolverOutcome: String(rawChain.resolverOutcome ?? 'unknown').slice(0, 80),
          specializedReplacementExecuted: rawChain.specializedReplacementExecuted === true,
          stableRerenderObserved: rawChain.stableRerenderObserved === true,
          topologyVerdict: ['A', 'B', 'C', 'D'].includes(rawChain.topologyVerdict)
            ? rawChain.topologyVerdict : 'D',
          topologyReason: String(rawChain.topologyReason ?? 'current-root-ambiguous-or-resolver-disagrees').slice(0, 80),
          topologyEffectContinuationAccepted: rawChain.topologyEffectContinuationAccepted === true,
          topologyDelayedProbeFired: rawChain.topologyDelayedProbeFired === true,
          topologyBoundaryIdentityRetained: rawChain.topologyBoundaryIdentityRetained === true,
          topologyCurrentBranchAmbiguous: rawChain.topologyCurrentBranchAmbiguous === true,
          topologyCurrentExactTargetCount: Number.isSafeInteger(rawChain.topologyCurrentExactTargetCount) ? Math.max(0, rawChain.topologyCurrentExactTargetCount) : 0,
          topologyLocatorExactTargetCount: Number.isSafeInteger(rawChain.topologyLocatorExactTargetCount) ? Math.max(0, rawChain.topologyLocatorExactTargetCount) : 0,
          topologyCurrentTargetChildCount: Number.isSafeInteger(rawChain.topologyCurrentTargetChildCount) ? Math.max(0, rawChain.topologyCurrentTargetChildCount) : 0,
          topologyCurrentRetainedChildCount: Number.isSafeInteger(rawChain.topologyCurrentRetainedChildCount) ? Math.max(0, rawChain.topologyCurrentRetainedChildCount) : 0,
          topologyCurrentConnectedVisibleHostCount: Number.isSafeInteger(rawChain.topologyCurrentConnectedVisibleHostCount) ? Math.max(0, rawChain.topologyCurrentConnectedVisibleHostCount) : 0,
          topologyCurrentDescendantHostCount: Number.isSafeInteger(rawChain.topologyCurrentDescendantHostCount) ? Math.max(0, rawChain.topologyCurrentDescendantHostCount) : 0,
          topologyStaleExactTargetCount: Number.isSafeInteger(rawChain.topologyStaleExactTargetCount) ? Math.max(0, rawChain.topologyStaleExactTargetCount) : 0,
          topologyStaleConnectedVisibleHostCount: Number.isSafeInteger(rawChain.topologyStaleConnectedVisibleHostCount) ? Math.max(0, rawChain.topologyStaleConnectedVisibleHostCount) : 0,
          thunkTexts: Array.isArray(rawChain.thunkTexts) ? rawChain.thunkTexts.filter((text) => typeof text === 'string').slice(0, 4).map((text) => text.slice(0, 320)) : [],
          mountedChildrenGateDecision,
        }
      : undefined;
    return {
      activeBlockerProvenance,
      activeBlockers: Number.isSafeInteger(detail?.blockerSummary?.active)
        ? Math.max(0, detail.blockerSummary.active)
        : 0,
      criticalEvidenceTruncated:
        detail?.visitLimitReached === true ||
        detail?.statusCounts === '[Depth limit]' ||
        detail?.targetState === '[Depth limit]',
      ...(typeof detail?.contextModule?.evidenceKind === 'string'
        ? { contextModuleEvidenceKind: detail.contextModule.evidenceKind.slice(0, 80) }
        : {}),
      ...(Number.isSafeInteger(detail?.contextModule?.importPathLength)
        ? {
            contextModuleImportPathLength: Math.max(
              0,
              Number(detail.contextModule.importPathLength),
            ),
          }
        : {}),
      ...(typeof detail?.contextModule?.sourcePath === 'string'
        ? { contextModuleSourcePath: detail.contextModule.sourcePath.slice(0, 1_024) }
        : {}),
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
      pageExecutionStandaloneTarget: pageExecution?.standaloneTarget === true,
      ...(typeof pageExecution?.runtimeTargetSurfaceId === 'string'
        ? { pageExecutionTargetSurfaceId: pageExecution.runtimeTargetSurfaceId.slice(0, 240) }
        : {}),
      ...(typeof pageExecution?.targetRole === 'string'
        ? { pageExecutionTargetRole: pageExecution.targetRole.slice(0, 80) }
        : {}),
      requirementSearchExhausted: search?.exhausted === true,
      requirementSearchObservedPathCount: Number.isSafeInteger(search?.observedPathCount)
        ? Math.max(0, Number(search.observedPathCount))
        : 0,
      requirementSearchPass: Number.isSafeInteger(search?.pass)
        ? Math.max(0, Number(search.pass))
        : 0,
      requirementSearchSettled: search?.settled === true,
      requirementSearchStatus: String(search?.searchStatus ?? 'untracked').slice(0, 80),
      requirementSearchTotalPasses: Number.isSafeInteger(search?.totalPasses)
        ? Math.max(0, Number(search.totalPasses))
        : 0,
      targetAppliedConditionCount: Number.isSafeInteger(target?.appliedConditionCount)
        ? Math.max(0, Number(target.appliedConditionCount))
        : 0,
      targetDetachedBoundaryOutput: target?.detachedBoundaryOutput === true,
      targetDetachedTargetPlacement: String(target?.detachedTargetPlacement ?? '').slice(0, 80),
      targetDirectElementOutput: target?.directElementOutput === true,
      targetAttempt: Number.isSafeInteger(target?.attempt)
        ? Math.max(0, Number(target.attempt))
        : 0,
      targetAutoAttemptMode: String(target?.activeAutoAttemptMode ?? '').slice(0, 80),
      targetAutoAttemptResumeHandled: target?.activeAutoAttemptResumeHandled === true,
      targetAutoAttemptResumeScheduled: target?.activeAutoAttemptResumeScheduled === true,
      targetAutoAttemptSettled: target?.activeAutoAttemptSettled === true,
      targetContextualFallbackRequested: target?.contextualTargetFallbackRequested === true,
      targetError:
        targetErrorMessage !== undefined ||
        targetErrorDetails !== undefined ||
        targetErrorLocation !== undefined ||
        targetErrorOwner !== undefined ||
        targetErrorPhase !== undefined ||
        targetErrorStack !== undefined ||
        targetFallbackOwner !== undefined,
      ...(targetErrorDetails === undefined ? {} : { targetErrorDetails }),
      ...(targetErrorLocation === undefined ? {} : { targetErrorLocation }),
      ...(targetErrorMessage === undefined ? {} : { targetErrorMessage }),
      ...(targetErrorOwner === undefined ? {} : { targetErrorOwner }),
      ...(targetErrorPhase === undefined ? {} : { targetErrorPhase }),
      ...(targetErrorStack === undefined ? {} : { targetErrorStack }),
      targetExportName: String(target?.exportName ?? 'default').slice(0, 160),
      targetHasOutput: target?.hasOutput === true || target?.reachabilityHasOutput === true,
      targetIdlePasses: Number.isSafeInteger(target?.idlePasses)
        ? Math.max(0, Number(target.idlePasses))
        : 0,
      targetLastContinuationSkipReason: String(
        target?.lastContinuationSkipReason ?? '',
      ).slice(0, 120),
      targetMounted: target?.mounted === true,
      targetOutputKind: String(target?.outputKind ?? 'none').slice(0, 80),
      targetOwnershipPhases: ownershipPhases,
      targetPageRootCommitted: target?.pageRootCommitted === true,
      targetProbeRevision: Number.isSafeInteger(target?.probeRevision)
        ? Math.max(0, Number(target.probeRevision))
        : 0,
      targetProjectedCompatibilityOutput: target?.projectedCompatibilityOutput === true,
      targetRejectedConditionCount: Number.isSafeInteger(target?.rejectedConditionCount)
        ? Math.max(0, Number(target.rejectedConditionCount))
        : 0,
      targetRuntimeFallbackSummaries: Array.isArray(target?.runtimeFallbackSummaries)
        ? target.runtimeFallbackSummaries
            .filter((value) => typeof value === 'string')
            .slice(0, 12)
            .map((value) => value.slice(0, 1_000))
        : [],
      targetEffectControllerOutput: target?.targetEffectControllerOutput === true,
      targetRenderedEmpty: target?.targetRenderedEmpty === true,
      ...(targetRenderCommitChain === undefined ? {} : { targetRenderCommitChain }),
      ...(typeof detail?.evidence?.sourcePath === 'string'
        ? { targetSourcePath: detail.evidence.sourcePath.slice(0, 1_024) }
        : {}),
      targetStage: String(target?.stage ?? 'unknown').slice(0, 80),
      targetStatus: String(target?.status ?? 'unknown').slice(0, 80),
      targetWasMounted: target?.wasMounted === true,
      ...(typeof detail?.route?.pathname === 'string'
        ? { selectedRoutePathname: detail.route.pathname.slice(0, 2_048) }
        : {}),
    };
  };
  const pendingCompositionStatuses = new Set([
    'advancing',
    'blocked',
    'filling-requirements',
    'mounting-contextual-target',
    'page-root-pending',
    'probing',
    'recovering-after-rejected-gate',
    'resolving-deferred-render-contract',
    'retrying-page-execution',
    'resuming-new-requirements',
    'revealing-overlay',
    'searching-deterministic-requirements',
    'searching-requirements',
    'settling-auto-attempt',
    'settling-neural-render-state',
  ]);
  const isCompositionPending = () => {
    const composition = bridgeState.latestComposition;
    if (composition === undefined) return true;
    if (
      composition.targetStage === 'target-output' &&
      composition.targetStatus === 'reached' &&
      composition.targetHasOutput === true
    ) return false;
    // A file-only component has no Page Execution corridor or requirement-search lifecycle. Its
    // runtime-ready signal plus one quiet composition snapshot is already the complete contract.
    if (composition.pageExecutionFidelity === 'none') return false;
    if (
      composition.targetAutoAttemptMode &&
      (
        composition.targetAutoAttemptSettled !== true ||
        composition.targetAutoAttemptResumeScheduled === true ||
        composition.targetAutoAttemptResumeHandled !== true
      )
    ) return true;
    if (
      composition.targetStatus === 'settling-neural-render-state' ||
      composition.targetStatus === 'retrying-page-execution'
    ) return true;
    if (pendingCompositionStatuses.has(composition.targetStatus)) {
      return composition.requirementSearchExhausted !== true;
    }
    return composition.requirementSearchSettled !== true &&
      composition.requirementSearchExhausted !== true;
  };
  const capturePayload = () => {
    if (bridgeState.published) return;
    bridgeState.published = true;
    const root = selectMountNode();
    const progressHost = document.getElementById('react-preview-progress-host');
    const runtimeError = root?.querySelector('.react-preview-runtime-error');
    const now = Date.now();
    const payload = {
      evidence: { consoleFailures, extensionMessages: messages, windowErrors },
      rootHtml: readRenderedHtml(root, ${MAX_CAPTURE_BYTES.toString()}),
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
          !isCompositionPending() &&
          now - bridgeState.lastActivityAt >= ${PREVIEW_HEADLESS_STABILIZATION_QUIET_MS.toString()},
        ...(bridgeState.routerScopeTransition === undefined
          ? {}
          : { routerScopeTransition: bridgeState.routerScopeTransition }),
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
      if ((quiet && !isCompositionPending()) || capped) capturePayload();
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
        message?.type === 'react-preview-runtime-health' &&
        message?.runtimeRevision === expectedRevision
      ) {
        const event = message?.event?.event;
        const category = message?.event?.category;
        const transition = message?.event?.detail?.transition;
        if (
          category === 'router-scope' &&
          (transition === 'recovering' || transition === 'recovered' || transition === 'unresolved')
        ) {
          bridgeState.routerScopeTransition = transition;
        }
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
    try {
      if (event.error?.[routeErrorProbeSymbol] === true) {
        event.preventDefault?.();
        return;
      }
    } catch { /* An uninspectable project error follows the ordinary evidence path. */ }
    retain(windowErrors, event.error ?? event.message);
    markActivity();
  });
  addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const retainUnhandledRejection = () => {
      /*
       * The generated preview entry may prove that a render-only rejection is non-fatal and call
       * preventDefault from a listener installed after this pre-entry bridge. Defer observation
       * until dispatch completes so headless classification follows the browser runtime's final
       * decision instead of preserving a false post-commit blocker.
       */
      if (event.defaultPrevented) return;
      retain(windowErrors, reason);
      markActivity();
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(retainUnhandledRejection);
    else Promise.resolve().then(retainUnhandledRejection, retainUnhandledRejection);
  });
  const observeMount = () => {
    const root = selectMountNode();
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
export class CdpPipeClient {
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
    timeoutMs = CDP_REQUEST_TIMEOUT_MS,
  ): Promise<CdpMessage> {
    const requestTimeoutMs = validateCdpRequestTimeout(timeoutMs);
    if (this.closedError !== undefined) return Promise.reject(this.closedError);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP request timed out: ${method}`));
      }, requestTimeoutMs);
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
    const targetResponse = await client.request(
      'Target.getTargets',
      {},
      undefined,
      CDP_STARTUP_REQUEST_TIMEOUT_MS,
    );
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
      const created = await client.request(
        'Target.createTarget',
        { url: 'about:blank' },
        undefined,
        CDP_STARTUP_REQUEST_TIMEOUT_MS,
      );
      targetId = created.result?.targetId;
    }
    if (typeof targetId !== 'string')
      throw new Error('Chromium did not expose an attachable page.');
    const attached = await client.request(
      'Target.attachToTarget',
      { flatten: true, targetId },
      undefined,
      CDP_STARTUP_REQUEST_TIMEOUT_MS,
    );
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
    const deadline = createCancellableDeadline(timeoutMs);
    const outcome = await Promise.race([
      bindingPromise.then((value) => ({ kind: 'payload' as const, value })),
      deadline.promise.then(() => ({ kind: 'timeout' as const })),
      processEndPromise,
    ]).finally(() => deadline.cancel());
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
    return serializePreviewHeadlessTimeoutDiagnostic(response.result);
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
  publicAssetRoot?: string,
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
    const exactRoute = routes.get(pathname);
    if (
      exactRoute === undefined &&
      publicAssetRoot !== undefined &&
      pathname.startsWith(HEADLESS_PUBLIC_ASSET_PREFIX)
    ) {
      void readPreviewHeadlessPublicAsset(publicAssetRoot, pathname).then((publicAsset) => {
        retainEvidence(requests, `${pathname} ${publicAsset === undefined ? '404' : '200-public'}`);
        if (publicAsset === undefined) {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, {
          'Cache-Control': 'no-store',
          'Content-Length': publicAsset.contents.byteLength,
          'Content-Type': publicAsset.type,
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(request.method === 'HEAD' ? undefined : publicAsset.contents);
      });
      return;
    }
    if (
      exactRoute === undefined &&
      isPreviewHeadlessGuardedClientRouteNavigation(request, pathname)
    ) {
      retainPriorityLoopbackEvidence(requests, `${pathname} 204-navigation-blocked`);
      response.writeHead(204, { 'Cache-Control': 'no-store' }).end();
      return;
    }
    const route = exactRoute;
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

/** Reads one bounded public asset while rejecting traversal and escaping symlinks. */
async function readPreviewHeadlessPublicAsset(
  publicAssetRoot: string,
  pathname: string,
): Promise<{ readonly contents: Uint8Array; readonly type: string } | undefined> {
  try {
    const encodedRelativePath = pathname.slice(HEADLESS_PUBLIC_ASSET_PREFIX.length);
    const relativePath = decodeURIComponent(encodedRelativePath);
    if (relativePath.length === 0 || /[\\\0]/u.test(relativePath)) return undefined;
    const canonicalRoot = await realpath(publicAssetRoot);
    const candidatePath = path.resolve(canonicalRoot, relativePath);
    if (!isPathInside(canonicalRoot, candidatePath)) return undefined;
    const canonicalCandidate = await realpath(candidatePath);
    if (!isPathInside(canonicalRoot, canonicalCandidate)) return undefined;
    const metadata = await stat(canonicalCandidate);
    if (!metadata.isFile() || metadata.size > MAX_HEADLESS_PUBLIC_ASSET_BYTES) return undefined;
    return {
      contents: await readFile(canonicalCandidate),
      type: mimeTypeForPreviewPublicAsset(canonicalCandidate),
    };
  } catch {
    return undefined;
  }
}

/** Returns a nosniff-compatible content type for passive files served only by headless QA. */
function mimeTypeForPreviewPublicAsset(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.avif':
      return 'image/avif';
    case '.bmp':
      return 'image/bmp';
    case '.gif':
      return 'image/gif';
    case '.ico':
      return 'image/x-icon';
    case '.jpeg':
    case '.jpg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    case '.webp':
      return 'image/webp';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    case '.mp3':
      return 'audio/mpeg';
    case '.mp4':
      return 'video/mp4';
    case '.ogg':
      return 'audio/ogg';
    case '.webm':
      return 'video/webm';
    default:
      return 'application/octet-stream';
  }
}

/** Reports whether one resolved file remains at or below its canonical public directory. */
function isPathInside(directoryPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(directoryPath, candidatePath);
  return (
    relativePath.length === 0 || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
}

/** Recognizes bounded full-document client-route navigations guarded from replacing the preview. */
function isPreviewHeadlessGuardedClientRouteNavigation(
  request: IncomingMessage,
  pathname: string,
): boolean {
  if (
    (request.method !== 'GET' && request.method !== 'HEAD') ||
    pathname.length === 0 ||
    pathname.length > 2_048
  ) {
    return false;
  }
  const accept = readPreviewHeadlessRequestHeader(request, 'accept');
  if (
    accept === undefined ||
    !accept.split(',').some((value) => value.split(';', 1)[0]?.trim().toLowerCase() === 'text/html')
  ) {
    return false;
  }
  const destination = readPreviewHeadlessRequestHeader(request, 'sec-fetch-dest');
  if (destination !== undefined && destination.toLowerCase() !== 'document') return false;
  const mode = readPreviewHeadlessRequestHeader(request, 'sec-fetch-mode');
  if (mode !== undefined && mode.toLowerCase() !== 'navigate') return false;
  const site = readPreviewHeadlessRequestHeader(request, 'sec-fetch-site');
  if (site !== undefined && site.toLowerCase() !== 'same-origin' && site.toLowerCase() !== 'none')
    return false;
  const purpose =
    readPreviewHeadlessRequestHeader(request, 'sec-purpose') ??
    readPreviewHeadlessRequestHeader(request, 'purpose');
  if (purpose?.toLowerCase().includes('prefetch') === true) return false;
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  const segments = decodedPathname.split('/').filter(Boolean);
  return segments.length <= 64 && segments.every((segment) => !segment.includes('.'));
}

/** Reads one bounded Node request-header value without weakening multi-value checks. */
function readPreviewHeadlessRequestHeader(
  request: IncomingMessage,
  name: string,
): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value.join(',') : value;
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
  const deadline = createCancellableDeadline(timeoutMs);
  return Promise.race([
    new Promise<void>((resolve) =>
      browser.once('close', () => {
        resolve();
      }),
    ),
    deadline.promise,
  ]).finally(() => deadline.cancel());
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

/** Keeps an individual CDP request positive and within the bounded startup allowance. */
function validateCdpRequestTimeout(timeoutMs: number): number {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > CDP_STARTUP_REQUEST_TIMEOUT_MS
  ) {
    throw new RangeError('CDP request timeout must be an integer from 1 to 12000 ms.');
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

/** Keeps navigation guards by replacing only ordinary evidence after the shared cap is full. */
function retainPriorityLoopbackEvidence(target: string[], value: string): void {
  const bounded = value.slice(0, 4096);
  if (target.length < MAX_EVIDENCE_ITEMS) {
    target.push(bounded);
    return;
  }
  const ordinaryIndex = target.findIndex((entry) => !entry.includes('204-navigation-blocked'));
  if (ordinaryIndex < 0) return;
  target.splice(ordinaryIndex, 1);
  target.push(bounded);
}

/** Serializes one CDP value within the evidence budget. */
function boundedJson(value: unknown): string {
  return normalizeHeadlessEvidence(value).slice(0, 4096);
}

/** Keeps terminal timeout facts ahead of unbounded browser message text. */
function serializePreviewHeadlessTimeoutDiagnostic(value: unknown): string {
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

/** Keeps CDP and browser causes useful when their prototypes do not cross a realm boundary. */
function normalizeHeadlessEvidence(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value);
    case 'symbol':
      return value.toString();
    case 'function':
      return '[function]';
    case 'object':
      break;
    default:
      return String(value);
  }
  if (depth >= 4) return '[max-depth]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  try {
    const record = value as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name : undefined;
    const message = typeof record.message === 'string' ? record.message : undefined;
    const cause = record.cause;
    if (name !== undefined || message !== undefined || cause !== undefined) {
      return `${name ?? 'Error'}${message === undefined || message.length === 0 ? '' : `: ${message}`}${cause === undefined ? '' : `; cause=${normalizeHeadlessEvidence(cause, seen, depth + 1)}`}`;
    }
    const fields = Object.keys(record)
      .sort()
      .slice(0, 16)
      .map((key) => {
        try {
          return `${key}=${normalizeHeadlessEvidence(record[key], seen, depth + 1)}`;
        } catch {
          return `${key}=[unreadable]`;
        }
      });
    return fields.length === 0 ? Object.prototype.toString.call(value) : `{${fields.join(', ')}}`;
  } catch {
    return Object.prototype.toString.call(value);
  } finally {
    seen.delete(value);
  }
}

/** Retains a bounded prefix of process output. */
function appendBounded(current: string, next: string): string {
  return (current + next).slice(0, MAX_CAPTURE_BYTES);
}

/** Observational telemetry must never influence the production rendering path. */
function reportPreviewHeadlessOwnership(
  options: PreviewHeadlessRendererOptions,
  event: PreviewHeadlessOwnershipEvent,
): void {
  try {
    options.reportOwnership?.(event);
  } catch {
    /* observer isolation */
  }
}

/** A deadline whose timer cannot retain the process after another race branch wins. */
function createCancellableDeadline(timeoutMs: number): {
  readonly cancel: () => void;
  readonly promise: Promise<void>;
} {
  let timer: NodeJS.Timeout | undefined;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timer = undefined;
      resolve();
    }, timeoutMs);
    timer.unref();
  });
  return {
    cancel: () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
    promise,
  };
}
