import type { PreviewHeadlessResult } from './previewHeadlessRenderer';
import type { PreviewHeadlessOwnershipEvent } from './previewHeadlessRenderer';
import type { PreviewCompilerActivity } from '../../domain/previewCompilerActivity';
import type { PreviewProgressStage } from '../../domain/previewProgress';

export const PREVIEW_TSX_CORPUS_ARCHITECTURE_ID = 'tsx-corpus-serial-throughput-measurement-v10';
export const PREVIEW_TSX_CORPUS_CLASSIFIER_VERSION = 2;
export const PREVIEW_TSX_CORPUS_CAMPAIGN_SCHEMA_VERSION = 2;
export const PREVIEW_TSX_CORPUS_STAGE_PROTOCOL_VERSION = 3;
export const PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY = Object.freeze({
  cleanupGraceMs: 5_000,
  isolationJobs: 1,
  laneCounts: [12, 14, 16] as const,
  maxIsolatedAttempts: 1,
  maxPrimaryLanes: 16,
  outerDeadlineMs: 90_000,
  pipelineDepth: 1,
  primaryJobs: 12,
  rendererDeadlineMs: 30_000,
  reuseMode: 'persistent-compiler-fresh-browser',
  warmupRowsPerLane: 0,
});

export interface PreviewTsxCorpusFrozenPolicy {
  readonly architectureId: typeof PREVIEW_TSX_CORPUS_ARCHITECTURE_ID;
  readonly classifierVersion: number;
  readonly engineDigest: string;
  readonly laneCount: 12 | 14 | 16;
  readonly manifestSha256: string;
  readonly pipelineDepth: 1;
  readonly policyDigest: string;
  readonly protocolVersion: 3;
  readonly reuseMode: 'persistent-compiler-fresh-browser';
  readonly selectedAt: string;
  readonly sentinels: readonly { readonly digest: string; readonly fidelity: string; readonly index: number }[];
  readonly version: 2;
}

export type PreviewTsxCorpusCategory =
  | 'Unrendered'
  | 'blank/empty output'
  | 'blocker'
  | 'explicitly structurally non-renderable'
  | 'incomplete page composition'
  | 'runtime/build failure'
  | 'successful meaningful render';

export type PreviewTsxCorpusAttemptKind = 'isolated' | 'primary';

export type PreviewTsxCorpusStageName =
  | 'cleanup-finished'
  | 'compile-finished'
  | 'compile-started'
  | 'render-started'
  | 'renderer-terminal'
  | 'result-emitted'
  | 'spawned'
  | 'target-opened';

export interface PreviewTsxCorpusManifestRow {
  readonly bytes: number;
  readonly isDemo: boolean;
  readonly isStory: boolean;
  readonly isTest: boolean;
  readonly path: string;
  readonly sha256: string;
}

export interface PreviewTsxCorpusAttemptSpec {
  readonly attemptKind: PreviewTsxCorpusAttemptKind;
  readonly chromiumPath: string;
  readonly index: number;
  readonly manifestSha256: string;
  readonly row: PreviewTsxCorpusManifestRow;
  readonly sourceRoot: string;
  readonly workspace: string;
  readonly laneId?: number;
  readonly generationId?: string;
  readonly commandId?: string;
}

/** Versioned durable-credit lane transport. Commands and acknowledgements are JSONL. */
export type PreviewTsxCorpusLaneCommand =
  | { readonly index: number; readonly kind: 'ack'; readonly version: 3 }
  | { readonly commandId: string; readonly generationId: string; readonly kind: 'row'; readonly laneId: number; readonly row: PreviewTsxCorpusAttemptSpec; readonly version: 3 }
  | { readonly kind: 'drain'; readonly version: 3 }
  | { readonly kind: 'shutdown'; readonly version: 3 };

export type PreviewTsxCorpusLaneAcknowledgement =
  | { readonly index: number; readonly kind: 'row-terminal'; readonly version: 3 }
  | { readonly kind: 'drained'; readonly version: 3 }
  | { readonly kind: 'ready'; readonly version: 3 };

export interface PreviewTsxCorpusGenerationCertificate {
  readonly generationId: string;
  readonly isolationProofs: number;
  readonly lane: number;
  readonly rows: number;
  readonly sentinelMatched: boolean;
  readonly version: 2;
}

/** Closed evidence emitted by the isolated v11 throughput-candidate lifecycle. */
export interface PreviewTsxCorpusV11CandidateTerminalReport {
  readonly candidate: 12 | 14 | 16;
  readonly gates: Readonly<Record<string, boolean>>;
  readonly measurementStartedAt?: number;
  readonly status: 'failed' | 'safe-sub-100' | 'selected';
  readonly terminalCommittedAt?: number;
  readonly terminalRows: number;
  readonly terminalRatePerMinute: number;
  readonly version: 11;
}

export interface PreviewTsxCorpusThroughputEpoch {
  readonly committedRows: number;
  readonly elapsedMs: number;
  readonly ratePerMinute: number;
  readonly startIndex: number;
  readonly version: 2;
}

export interface PreviewTsxCorpusResourceSample {
  readonly compressedMemoryBytes?: number;
  readonly laneOwnedRssBytes: number;
  readonly sampledAtMs: number;
  readonly swapUsedBytes?: number;
}

export interface PreviewTsxCorpusRowOwnershipEvent {
  readonly generation: string;
  readonly index: number;
  readonly kind: 'row-ownership';
  readonly lane: number;
  readonly ownership: PreviewHeadlessOwnershipEvent;
  readonly path: string;
  readonly version: 3;
}

export interface PreviewTsxCorpusLaneLifecycleEvent {
  readonly event: 'draining' | 'generation-started' | 'generation-stopped' | 'quarantined';
  readonly generation: string;
  readonly kind: 'lane-lifecycle';
  readonly lane: number;
  readonly version: 3;
}

export interface PreviewTsxCorpusSentinelComparison {
  readonly comparedFields: readonly string[];
  readonly freshAttemptSha256: string;
  readonly generationId: string;
  readonly matched: boolean;
  readonly warmAttemptSha256: string;
}

export interface PreviewTsxCorpusStageEvent {
  readonly detail?: Readonly<Record<string, unknown>>;
  readonly elapsedMs: number;
  readonly index: number;
  readonly kind: 'target-stage';
  readonly path: string;
  readonly stage: PreviewTsxCorpusStageName;
  readonly version: 3;
}

export interface PreviewTsxCorpusCompilerEvent {
  readonly activity?: PreviewCompilerActivity;
  readonly elapsedMs: number;
  readonly index: number;
  readonly kind: 'compiler-progress';
  readonly path: string;
  readonly stage: PreviewProgressStage;
  readonly version: 3;
}

export interface PreviewTsxCorpusWorkerLifecycleEvent {
  readonly detail?: Readonly<Record<string, unknown>>;
  readonly elapsedMs: number;
  readonly event:
    | 'compiler-abort-requested'
    | 'compiler-shutdown-finished'
    | 'compiler-shutdown-started'
    | 'signal-received';
  readonly index: number;
  readonly kind: 'worker-lifecycle';
  readonly path: string;
  readonly version: 3;
}

export type PreviewTsxCorpusDiagnosticEvent =
  | PreviewTsxCorpusCompilerEvent
  | PreviewTsxCorpusRowOwnershipEvent
  | PreviewTsxCorpusStageEvent
  | PreviewTsxCorpusWorkerLifecycleEvent;

export interface PreviewTsxCorpusProcessLifecycleEvent {
  readonly detail?: Readonly<Record<string, unknown>>;
  readonly elapsedMs: number;
  readonly event:
    | 'child-close'
    | 'child-error'
    | 'child-exit'
    | 'deadline-expired'
    | 'grace-expired'
    | 'group-probe'
    | 'group-signal'
    | 'listeners-detached'
    | 'spawn-returned'
    | 'stream-terminal'
    | 'timers-cleared';
  readonly kind: 'parent-process';
  readonly version: 3;
}

export interface PreviewTsxCorpusCleanupProof {
  /** Browser ownership facts are optional so legacy one-shot attempts retain their schema. */
  readonly browserGroupAbsent?: boolean;
  readonly browserPgid?: number;
  readonly childCloseObserved: boolean;
  readonly childExitBeforeClose: boolean;
  readonly forcedGroupTermination: boolean;
  readonly groupAbsentAfterClose: boolean;
  readonly listenersDetached: boolean;
  readonly normalWorkerCleanup: boolean;
  readonly ownershipEventCount?: number;
  readonly ownershipSequenceValid?: boolean;
  readonly ownedPgid?: number;
  readonly preRenderCompileStarted: boolean;
  readonly preRenderOnly: boolean;
  readonly profilePathAbsent?: boolean;
  readonly profileRoot?: string;
  readonly rendererCleanupConfirmed?: boolean;
  readonly serverLoopbackPort?: number;
  readonly serverPortClosed?: boolean;
  readonly streamsTerminal: boolean;
  readonly strictParentForcedCleanup: boolean;
  readonly timersCleared: boolean;
}

export interface PreviewTsxCorpusWorkerResult {
  readonly documentPath: string;
  readonly durationMs: number;
  readonly error?: string;
  readonly errorName?: string;
  readonly headless?: PreviewHeadlessResult;
  readonly index: number;
  readonly kind: 'compile-or-render-failure' | 'headless-result';
  readonly path: string;
  readonly version: 3;
}

export interface PreviewTsxCorpusAttemptRecord {
  readonly attemptKind: PreviewTsxCorpusAttemptKind;
  readonly cleanupConfirmed: boolean;
  readonly cleanupProof: PreviewTsxCorpusCleanupProof;
  readonly compilerProgress: readonly PreviewTsxCorpusCompilerEvent[];
  readonly deadlineMs: 90000;
  readonly durationMs: number;
  readonly diagnosticProtocolValid: boolean;
  readonly endedAt: string;
  readonly exitCode: number | null;
  readonly exitSignal: NodeJS.Signals | null;
  readonly forcedTermination: boolean;
  readonly index: number;
  readonly infrastructureReason?: string;
  readonly kind: 'attempt';
  readonly lastStage?: PreviewTsxCorpusStageName;
  readonly path: string;
  readonly policyDigest: string;
  readonly processLifecycle: readonly PreviewTsxCorpusProcessLifecycleEvent[];
  readonly raw: {
    readonly stages: { readonly bytes: number; readonly sha256: string };
    readonly stderr: { readonly bytes: number; readonly sha256: string };
    readonly stdout: { readonly bytes: number; readonly sha256: string };
  };
  readonly result?: PreviewTsxCorpusWorkerResult;
  readonly stageHistory: readonly PreviewTsxCorpusStageEvent[];
  readonly stallClassification?:
    | 'event-loop-responsive-native-or-shutdown-wait'
    | 'event-loop-responsive-pre-native-wait'
    | 'normal-compiler-completion'
    | 'pre-native-same-thread-blockage'
    | 'same-thread-plugin-blockage-during-native-build';
  readonly startedAt: string;
  readonly timedOut: boolean;
  readonly version: 3;
  readonly workerLifecycle: readonly PreviewTsxCorpusWorkerLifecycleEvent[];
}

export interface PreviewTsxCorpusCanonicalRecord {
  readonly attempts: readonly {
    readonly attemptKind: PreviewTsxCorpusAttemptKind;
    readonly attemptRecordSha256: string;
  }[];
  readonly category: PreviewTsxCorpusCategory;
  readonly classifierDigest: string;
  readonly committedAtEpochMs: number;
  readonly engineDigest: string;
  readonly index: number;
  readonly kind: 'canonical';
  readonly manifestSha256: string;
  readonly path: string;
  readonly policyDigest: string;
  readonly reason: string;
  readonly sha256: string;
  readonly version: 1;
}
