import type { PreviewHeadlessResult } from './previewHeadlessRenderer';
import type { PreviewCompilerActivity } from '../../domain/previewCompilerActivity';
import type { PreviewProgressStage } from '../../domain/previewProgress';

export const PREVIEW_TSX_CORPUS_CLASSIFIER_VERSION = 1;
export const PREVIEW_TSX_CORPUS_STAGE_PROTOCOL_VERSION = 2;
export const PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY = Object.freeze({
  cleanupGraceMs: 5_000,
  isolationJobs: 1,
  maxIsolatedAttempts: 1,
  outerDeadlineMs: 90_000,
  primaryJobs: 3,
});

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
}

export interface PreviewTsxCorpusStageEvent {
  readonly detail?: Readonly<Record<string, unknown>>;
  readonly elapsedMs: number;
  readonly index: number;
  readonly kind: 'target-stage';
  readonly path: string;
  readonly stage: PreviewTsxCorpusStageName;
  readonly version: 2;
}

export interface PreviewTsxCorpusCompilerEvent {
  readonly activity?: PreviewCompilerActivity;
  readonly elapsedMs: number;
  readonly index: number;
  readonly kind: 'compiler-progress';
  readonly path: string;
  readonly stage: PreviewProgressStage;
  readonly version: 2;
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
  readonly version: 2;
}

export type PreviewTsxCorpusDiagnosticEvent =
  | PreviewTsxCorpusCompilerEvent
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
  readonly version: 2;
}

export interface PreviewTsxCorpusCleanupProof {
  readonly childCloseObserved: boolean;
  readonly childExitBeforeClose: boolean;
  readonly forcedGroupTermination: boolean;
  readonly groupAbsentAfterClose: boolean;
  readonly listenersDetached: boolean;
  readonly normalWorkerCleanup: boolean;
  readonly ownedPgid?: number;
  readonly preRenderCompileStarted: boolean;
  readonly preRenderOnly: boolean;
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
  readonly version: 2;
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
  readonly version: 2;
  readonly workerLifecycle: readonly PreviewTsxCorpusWorkerLifecycleEvent[];
}

export interface PreviewTsxCorpusCanonicalRecord {
  readonly attempts: readonly {
    readonly attemptKind: PreviewTsxCorpusAttemptKind;
    readonly attemptRecordSha256: string;
  }[];
  readonly category: PreviewTsxCorpusCategory;
  readonly classifierDigest: string;
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
