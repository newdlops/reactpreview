/** Shared immutable campaign contracts, mutable coordinator state, and resource units. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  type PreviewTsxCorpusCategory,
  type PreviewTsxCorpusDiagnosticEvent,
  type PreviewTsxCorpusManifestRow,
  type PreviewTsxCorpusProcessLifecycleEvent,
  type PreviewTsxCorpusRowOwnershipEvent,
  type PreviewTsxCorpusWorkerResult,
} from './previewHeadlessTsxCorpusCampaignTypes';
import {
  type PreviewTsxCorpusCompilerLaneCommand,
  type PreviewTsxCorpusCompilerLaneMessage,
} from './previewHeadlessTsxCorpusPipeline';
import { LaneRowFailure } from './previewTsxCorpusLane';
import { isPreviewLoopbackHost } from './previewLoopback';

export interface CampaignOptions {
  /** Absolute root for this campaign’s owned reports, captures, and canonical row artifacts. */
  readonly artifacts: string;
  /** Browser executable selected explicitly for every fresh renderer invocation. */
  readonly chromiumPath: string;
  /** Frozen JSONL source manifest whose rows and digest bind the campaign. */
  readonly manifestPath: string;
  /** Optional upper bound on manifest rows processed by this run. */
  readonly maxRows?: number;
  /** Campaign phase whose artifacts are measured or verified. */
  readonly phase: 'baseline' | 'calibration' | 'final';
  /** Optional persisted lane policy to validate before dispatch. */
  readonly policyPath?: string;
  /** Requested persistent compiler lane count when a frozen policy does not select it. */
  readonly primaryJobs?: 12 | 14 | 16;
  /** Optional artifact root containing the frozen comparison reference. */
  readonly referenceRoot?: string;
  /** Compiled worker entry invoked with the current Node executable. */
  readonly runtimePath: string;
  /** Immutable source tree used to resolve manifest-relative rows. */
  readonly sourceRoot: string;
  /** Workspace root whose package and compiler configuration apply to the frozen source. */
  readonly workspace: string;
}

export interface CampaignIdentity {
  /** Digest binding the row-classification implementation used by this campaign. */
  readonly classifierDigest: string;
  /** Digest of the compiled preview engine admitted by this campaign. */
  readonly engineDigest: string;
  /** SHA-256 of the exact frozen manifest bytes. */
  readonly manifestSha256: string;
  /** Campaign phase whose artifacts are measured or verified. */
  readonly phase: 'baseline' | 'calibration' | 'final';
  /** Digest binding the supervisor and renderer policy used for every row. */
  readonly policyDigest: string;
  /** Immutable source tree used to resolve manifest-relative rows. */
  readonly sourceRoot: string;
  /** Schema version used to compare persisted campaign identities. */
  readonly version: 1;
  /** Workspace root whose package and compiler configuration apply to the frozen source. */
  readonly workspace: string;
}

export interface CampaignState {
  /** Frozen source, engine, classifier, phase, and policy identity for this run. */
  readonly identity: CampaignIdentity;
  /** Digests already committed to the append-only ledger, used to prevent duplicate evidence. */
  readonly ledgerDigests: Set<string>;
  /** Serialized ledger persistence; later commits wait for the previous write. */
  ledgerWriteChain: Promise<void>;
  /** Validated campaign paths and execution options borrowed by phase coordinators. */
  readonly options: CampaignOptions;
  /** Manifest index to durable commit time in Unix epoch milliseconds. */
  readonly orderedCommits: Map<number, number>;
  /** Durable commit observations in manifest promotion order. */
  readonly orderedTimeline: {
    /** Unix epoch milliseconds when the canonical row became durable. */ readonly committedAtEpochMs: number;
    /** Zero-based index in the frozen source manifest. */ readonly index: number;
  }[];
  /** Next manifest index eligible for ordered canonical promotion. */
  orderedFrontier: number;
  /** Lane count admitted by the validated frozen policy, when present. */
  readonly selectedLaneCount?: 12 | 14 | 16;
  /** Manifest indices of the mandatory semantic sentinel rows. */
  readonly sentinelIndices: readonly number[];
  /** Unix epoch milliseconds when every primary lane completed its warm-up rows. */
  warmupBarrierEpochMs: number | undefined;
  /** Frozen manifest rows in their original deterministic order. */
  readonly rows: readonly PreviewTsxCorpusManifestRow[];
  /** Optional frozen semantic signature used to certify subsequent lane generations. */
  referenceSignature?: Readonly<Record<string, unknown>>;
}

export const LANE_CAPTURE_LIMIT_BYTES = 1024 * 1024;

export const GIB = 1024 * 1024 * 1024;

export const MIB = 1024 * 1024;

export const execFileAsync = promisify(execFile);

export interface LaneCapture {
  /** Ordered retained stream chunks whose combined bytes stay within the capture budget. */
  readonly chunks: Buffer[];
  /** Number of retained bytes, excluding input discarded after the capture limit. */
  bytes: number;
  /** Whether the stream exceeded its capture budget and lost required evidence. */
  truncated: boolean;
}

export interface LaneCleanup {
  /** Whether the owned child emitted close after its process and stdio terminated. */
  readonly closeObserved: boolean;
  /** Whether a bounded probe proved that the exact owned process group no longer exists. */
  readonly groupAbsent: boolean;
  /** Whether all installed child and stream observers were released. */
  readonly listenersDetached: boolean;
  /** Bounded diagnostic reason retained with this outcome or cleanup decision. */
  readonly reason: string;
  /** Whether each required protocol stream reached its terminal event. */
  readonly streamsTerminal: boolean;
  /** Whether SIGTERM was delivered to the owned group during cleanup. */
  readonly termSent: boolean;
  /** Whether cleanup escalated to a delivered SIGKILL. */
  readonly killSent: boolean;
}

export interface LaneRowOutcome {
  /** Owned-lane cleanup proof, present when the lane reports a cleanup outcome. */
  readonly cleanup?: LaneCleanup;
  /** Unique command identity correlating one dispatched row with its messages. */
  readonly commandId: string;
  /** Identity of the persistent worker generation that owned this row. */
  readonly generationId: string;
  /** Zero-based index in the frozen source manifest. */
  readonly index: number;
  /** Supervisor-assigned lane identifier; reserved identifiers may designate fresh reference lanes. */
  readonly laneId: number;
  /** Observed child exit and transport state, without retaining live process handles. */
  readonly laneProcess: Readonly<{
    /** Whether the owned child emitted close after its process and stdio terminated. */
    readonly closeObserved: boolean;
    /** Bounded spawn or transport failure text when available. */
    readonly error?: string;
    /** Native child exit status observed before stdio closure. */
    readonly exit?: {
      /** Native exit code, or null when the process terminated through a signal. */ readonly code:
        number | null;
      /** Native termination signal, or null for an ordinary exit code. */ readonly signal: NodeJS.Signals | null;
    };
    /** Process group created for this campaign-owned worker. */
    readonly ownedPgid?: number;
    /** Whether each required protocol stream reached its terminal event. */
    readonly streamsTerminal: Readonly<{
      /** Terminal state of the dedicated diagnostic transport stream. */
      readonly fd3: boolean;
      /** Captured stderr bytes or the corresponding stream-state flag. */
      readonly stderr: boolean;
      /** Captured stdout bytes or the corresponding stream-state flag. */
      readonly stdout: boolean;
    }>;
  }>;
  /** Ordered parent-process lifecycle observations associated with this row. */
  readonly lifecycle: readonly PreviewTsxCorpusProcessLifecycleEvent[];
  /** Browser, profile, and loopback-listener ownership observations for this command. */
  readonly ownership: readonly PreviewTsxCorpusRowOwnershipEvent[];
  /** Whether every retained message satisfied correlation and protocol requirements. */
  readonly protocolValid: boolean;
  /** The worker’s correlated terminal compile or renderer result. */
  readonly result: PreviewTsxCorpusWorkerResult;
  /** Captured diagnostic transport bytes or its evidence-truncation flag. */
  readonly stages: Buffer;
  /** Captured stderr bytes or the corresponding stream-state flag. */
  readonly stderr: Buffer;
  /** Captured stdout bytes or the corresponding stream-state flag. */
  readonly stdout: Buffer;
  /** Independent capture-budget flags for each required evidence stream. */
  readonly truncation: Readonly<{
    /** Captured diagnostic transport bytes or its evidence-truncation flag. */
    readonly stages: boolean;
    /** Captured stderr bytes or the corresponding stream-state flag. */
    readonly stderr: boolean;
    /** Captured stdout bytes or the corresponding stream-state flag. */
    readonly stdout: boolean;
  }>;
}

export interface ActiveLaneRow {
  /** Unique command identity correlating one dispatched row with its messages. */
  readonly commandId: string;
  /** Unreferenced timer enforcing the active row’s outer execution deadline. */
  readonly deadline: NodeJS.Timeout;
  /** Zero-based index in the frozen source manifest. */
  readonly index: number;
  /** Ordered parent-process lifecycle observations associated with this row. */
  readonly lifecycle: PreviewTsxCorpusProcessLifecycleEvent[];
  /** Browser, profile, and loopback-listener ownership observations for this command. */
  readonly ownership: PreviewTsxCorpusRowOwnershipEvent[];
  /** Completes the active row only after a correlated terminal result is observed. */
  readonly resolve: (value: LaneRowOutcome) => void;
  /** Rejects the active row with its bounded transport and cleanup evidence. */
  readonly reject: (error: LaneRowFailure) => void;
  /** Captured diagnostic transport bytes or its evidence-truncation flag. */
  readonly stages: LaneCapture;
  /** Monotonic performance-clock milliseconds at the start of this active row. */
  readonly startedAt: number;
  /** Captured stderr bytes or the corresponding stream-state flag. */
  readonly stderr: LaneCapture;
  /** Captured stdout bytes or the corresponding stream-state flag. */
  readonly stdout: LaneCapture;
  /** Whether every retained message satisfied correlation and protocol requirements. */
  protocolValid: boolean;
  /** The worker’s correlated terminal compile or renderer result. */
  result?: PreviewTsxCorpusWorkerResult;
}

export interface CampaignResourceSample {
  /** Sum of sampled resident bytes across the campaign’s owned worker groups. */
  readonly aggregateOwnedRssBytes: number;
  /** Sampled compressed-memory bytes, when the host exposes a valid observation. */
  readonly compressedBytes?: number;
  /** Supervisor lane identifier to its sampled owned-group resident byte count. */
  readonly laneOwnedRssBytes: Readonly<Record<string, number>>;
  /** Unix epoch milliseconds when the host resource observation was taken. */
  readonly sampledAtEpochMs: number;
  /** Sampled used swap bytes, when the host exposes a valid observation. */
  readonly swapBytes?: number;
  /** Reason the required resource observation could not be obtained. */
  readonly unavailable?: string;
}

/**
 * v12 accelerator.  This intentionally has no fallback to the serial v11
 * runner: every production row crosses the durable spool seam before a fresh
 * Chromium invocation.  The queue is the only cross-stage ownership boundary.
 */
export interface V12AccelerationOptions {
  /** Absolute root for this campaign’s owned reports, captures, and canonical row artifacts. */
  readonly artifacts: string;
  /** Browser executable selected explicitly for every fresh renderer invocation. */
  readonly chromiumPath: string;
  /** Frozen JSONL source manifest whose rows and digest bind the campaign. */
  readonly manifestPath: string;
  /** Compiled worker entry invoked with the current Node executable. */
  readonly runtimePath: string;
  /** Immutable source tree used to resolve manifest-relative rows. */
  readonly sourceRoot: string;
  /** Number of selected rows included in this acceleration measurement window. */
  readonly windowRows: number;
  /** Zero-based manifest offset of the contiguous measurement window. */
  readonly windowStart: number;
  /** Workspace root whose package and compiler configuration apply to the frozen source. */
  readonly workspace: string;
  /** Configured dispatch chunk size in rows. */
  readonly chunkRows: number;
  /** Fixed compiler-lane and renderer-slot matrix admitted by the acceleration protocol. */
  readonly candidates: '12x4,14x4,16x5';
  /** Optional frozen static-triage selection file replacing a contiguous row window. */
  readonly selectionPath?: string;
}

export const FILTERED_JSX_EXPORT_MANIFEST_ROWS = 6807;

export const FILTERED_JSX_EXPORT_MANIFEST_SHA256 =
  '5946df77be97f1fb2b5628358783f28c17a397210d540f60400c86c406ceede5';

export const FILTERED_MINIMUM_TERMINAL_RATE_PER_MINUTE = 61.0;

export const FILTERED_CAMPAIGN_WATCHDOG_RATE_PER_MINUTE = 30.0;

export const FILTERED_COMPILER_GENERATION_ROWS = 3;

export type V12CompileCommand = Extract<
  PreviewTsxCorpusCompilerLaneCommand,
  { /** Protocol discriminant selecting the compiler message variant. */ readonly kind: 'compile' }
>;

export type V12CompiledMessage = Extract<
  PreviewTsxCorpusCompilerLaneMessage,
  { /** Protocol discriminant selecting the compiler message variant. */ readonly kind: 'compiled' }
>;

export interface V12RowClassification {
  /** Terminal row category assigned from execution and cleanup evidence. */
  readonly category: PreviewTsxCorpusCategory;
  /** Whether the required process, browser, profile, and listener cleanup is proven. */
  readonly cleanupConfirmed: boolean;
  /** Zero-based index in the frozen source manifest. */
  readonly index: number;
  /** Manifest-relative source path identifying the classified row. */
  readonly path: string;
  /** Bounded diagnostic reason retained with this outcome or cleanup decision. */
  readonly reason: string;
}

export interface V12ProgressRuntimeState {
  /** Number of rows claimed by compiler dispatch, including unfinished work. */
  readonly claimedRows: number;
  /** Number of compiler lanes that reached their terminal dispatch boundary. */
  readonly compilerLanesDone: number;
  /** First retained asynchronous failure, or undefined while the candidate remains healthy. */
  readonly fatal: unknown;
  /** Number of durable compiler spools waiting for a renderer slot. */
  readonly queueRows: number;
  /** Active compiler and queued-spool credits currently held against the admission limit. */
  readonly reservations: number;
}

export interface V12ProgressCommittedState {
  /** Durably committed terminal row count for each supported category. */
  readonly categoryCounts: Readonly<Record<PreviewTsxCorpusCategory, number>>;
  /** Number of rows whose terminal classifications have been committed durably. */
  readonly terminalRows: number;
}

export interface V11Reference {
  /** Digest binding the engine and source semantics of the serial comparison reference. */
  readonly semanticKey: string;
  /** Frozen semantic and fidelity evidence used to compare sentinel executions. */
  readonly signature: Readonly<Record<string, unknown>>;
}

/** Narrows untrusted ownership telemetry against the supported version, process identities, and row command fields. */
export function isValidRowOwnershipEvent(
  event: PreviewTsxCorpusDiagnosticEvent,
): event is PreviewTsxCorpusRowOwnershipEvent {
  if (
    event.kind !== 'row-ownership' ||
    typeof event.generation !== 'string' ||
    !Number.isInteger(event.lane)
  )
    return false;
  const value: unknown = event.ownership;
  if (typeof value !== 'object' || value === null) return false;
  const ownership = value as Record<string, unknown>;
  if (typeof ownership.profileRoot !== 'string') return false;
  if (ownership.kind === 'server-listening') {
    return (
      isPreviewLoopbackHost(ownership.loopbackHost) &&
      typeof ownership.loopbackPort === 'number' &&
      Number.isInteger(ownership.loopbackPort) &&
      ownership.loopbackPort > 0 &&
      ownership.loopbackPort < 65536
    );
  }
  if (ownership.kind === 'browser-spawned' || ownership.kind === 'browser-terminal') {
    return (
      (ownership.pid === undefined ||
        (typeof ownership.pid === 'number' && Number.isSafeInteger(ownership.pid))) &&
      (ownership.pgid === undefined ||
        (typeof ownership.pgid === 'number' && Number.isSafeInteger(ownership.pgid)))
    );
  }
  return (
    ownership.kind === 'profile-created' ||
    ownership.kind === 'server-closed' ||
    ownership.kind === 'profile-removed'
  );
}
