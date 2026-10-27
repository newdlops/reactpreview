/** Headless browser protocol contracts, capture limits, and stabilization policy. */
import { type ChildProcess, type SpawnOptions } from 'node:child_process';
import type { PreviewDiagnostic } from '../../domain/preview';
import type { PreviewInspectorNeuralModel } from '../../presentation/previewInspectorNeuralModelProtocol';

export const DEFAULT_TIMEOUT_MS = 15_000;

export const CDP_REQUEST_TIMEOUT_MS = 3_000;

export const CDP_STARTUP_REQUEST_TIMEOUT_MS = 12_000;

export const MAX_CAPTURE_BYTES = 256 * 1_024;

export const MAX_EVIDENCE_ITEMS = 64;

export const HEADLESS_BRIDGE_PATH = '/react-preview-headless-bridge.js';

export const HEADLESS_DOCUMENT_PATH = '/index.html';

export const HEADLESS_PUBLIC_ASSET_PREFIX = '/__react_preview_public__/';

export const MAX_HEADLESS_PUBLIC_ASSET_BYTES = 20 * 1024 * 1024;

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
  /** Model from the page's last neural synchronization, validated like host sync traffic. */
  readonly neuralResidualModel?: PreviewInspectorNeuralModel;
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
  /** Mirrors the extension's HTTPS stylesheet setting; off keeps campaign runs network-free. */
  readonly remoteStylesheets?: boolean;
  /** Profile neural model restored before boot; offline pre-training carries it across pages. */
  readonly neuralResidualModel?: PreviewInspectorNeuralModel;
  /** Bounded observational ownership telemetry; exceptions are deliberately ignored. */
  readonly reportOwnership?: (event: PreviewHeadlessOwnershipEvent) => void;
}

export type PreviewHeadlessOwnershipEvent =
  | { readonly kind: 'profile-created'; readonly profileRoot: string }
  | {
      readonly kind: 'server-listening';
      /** Actual dedicated loopback address used by both the browser and cleanup probe. */
      readonly loopbackHost: string;
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

export interface BrowserBridgePayload {
  readonly evidence: Omit<
    PreviewHeadlessBrowserEvidence,
    | 'cdpExceptions'
    | 'incidentalNetworkFailures'
    | 'loopbackRequests'
    | 'requiredArtifactFailures'
    | 'runtimeEvents'
  >;
  readonly neuralResidualModel?: unknown;
  readonly rootHtml: string;
  readonly runtimeErrorText?: string;
  readonly stabilization?: PreviewHeadlessStabilization;
  readonly terminal: unknown;
}

export interface BrowserExecution {
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
