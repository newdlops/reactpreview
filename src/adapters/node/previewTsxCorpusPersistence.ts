/** Persists primary-lane terminal outcomes and ordered canonical commits. */
import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY,
  type PreviewTsxCorpusAttemptKind,
  type PreviewTsxCorpusAttemptRecord,
  type PreviewTsxCorpusCanonicalRecord,
  type PreviewTsxCorpusCleanupProof,
  type PreviewTsxCorpusGenerationCertificate,
  type PreviewTsxCorpusManifestRow,
  type PreviewTsxCorpusProcessLifecycleEvent,
  type PreviewTsxCorpusStageEvent,
  type PreviewTsxCorpusThroughputEpoch,
} from './previewHeadlessTsxCorpusCampaignTypes';
import {
  classifyCanonical,
  classifyCompilerStall,
  identifyInfrastructureReason,
} from './previewTsxCorpusClassification';
import {
  canonicalRecordPath,
  digest,
  fileExists,
  isMissing,
  ledgerRecord,
  pad,
  parseDiagnosticHistory,
  readJsonIfPresent,
  writeJsonAtomic,
  writeRawEvidence,
} from './previewTsxCorpusFiles';
import { LaneRowFailure } from './previewTsxCorpusLane';
import type { CampaignState, LaneCleanup, LaneRowOutcome } from './previewTsxCorpusModel';
import {
  confirmNormalWorkerCleanup,
  confirmRendererCleanup,
  hasLaneCaptureTruncation,
  inspectPrimaryOwnership,
  ownershipTransportMatches,
} from './previewTsxCorpusOwnership';
import { assertAttemptIdentity, primaryAttemptRecordPath } from './previewTsxCorpusPreparation';

/** Persists a terminal persistent-lane row before its supervisor grants durable credit. */
export async function persistPrimaryLaneOutcome(
  state: CampaignState,
  index: number,
  outcome: LaneRowOutcome,
): Promise<PreviewTsxCorpusAttemptRecord> {
  const row = state.rows[index];
  if (row === undefined || outcome.index !== index)
    throw new Error(`Primary lane outcome lost manifest identity at ${index.toString()}.`);
  const recordPath = primaryAttemptRecordPath(state, index);
  const existing = await readJsonIfPresent<PreviewTsxCorpusAttemptRecord>(recordPath);
  if (existing !== undefined) {
    assertAttemptIdentity(existing, state, index, 'primary');
    await ledgerRecord(state, recordPath, 'attempt', index, 'primary');
    return existing;
  }
  await mkdir(path.dirname(recordPath), { recursive: true });
  const diagnostics = parseDiagnosticHistory(outcome.stages, row, index);
  const protocolValid =
    outcome.protocolValid &&
    diagnostics.valid &&
    ownershipTransportMatches(outcome.ownership, diagnostics.ownership) &&
    !hasLaneCaptureTruncation(outcome);
  const ownership = await inspectPrimaryOwnership(diagnostics.ownership, diagnostics.stageHistory);
  const rendererCleanupConfirmed = confirmRendererCleanup(outcome.result);
  const normalWorkerCleanup = confirmNormalWorkerCleanup(diagnostics.stageHistory, outcome.result);
  const rendered = diagnostics.stageHistory.some((event) => event.stage === 'render-started');
  const cleanupConfirmed =
    protocolValid &&
    normalWorkerCleanup &&
    (!rendered ||
      (rendererCleanupConfirmed &&
        ownership.sequenceValid &&
        ownership.browserGroupAbsent &&
        ownership.profilePathAbsent &&
        ownership.serverPortClosed));
  const cleanupProof: PreviewTsxCorpusCleanupProof = {
    childCloseObserved: outcome.laneProcess.closeObserved,
    childExitBeforeClose: false,
    forcedGroupTermination: false,
    groupAbsentAfterClose: false,
    listenersDetached: false,
    normalWorkerCleanup,
    ownershipEventCount: diagnostics.ownership.length,
    ownershipSequenceValid: ownership.sequenceValid,
    preRenderCompileStarted: diagnostics.stageHistory.some(
      (event) => event.stage === 'compile-started',
    ),
    preRenderOnly: !rendered,
    rendererCleanupConfirmed,
    streamsTerminal:
      outcome.laneProcess.streamsTerminal.stdout &&
      outcome.laneProcess.streamsTerminal.stderr &&
      outcome.laneProcess.streamsTerminal.fd3,
    strictParentForcedCleanup: false,
    timersCleared: outcome.lifecycle.some((event) => event.event === 'timers-cleared'),
    ...ownership.cleanupFacts,
  };
  const raw = await writeRawEvidence(
    state.options.artifacts,
    index,
    'primary',
    outcome.stdout,
    outcome.stderr,
    outcome.stages,
  );
  const timedOut = outcome.lifecycle.some((event) => event.event === 'deadline-expired');
  const infrastructureReason = identifyInfrastructureReason({
    cleanupConfirmed,
    protocolValid,
    result: outcome.result,
    stageHistory: diagnostics.stageHistory,
    stderr: outcome.stderr.toString('utf8'),
    timedOut,
  });
  const durationMs = Math.max(0, outcome.result.durationMs);
  const stallClassification = classifyCompilerStall(
    timedOut,
    diagnostics.stageHistory,
    diagnostics.compilerProgress,
    diagnostics.workerLifecycle,
  );
  const lastStage = diagnostics.stageHistory.at(-1)?.stage;
  const record: PreviewTsxCorpusAttemptRecord = {
    attemptKind: 'primary',
    cleanupConfirmed,
    cleanupProof,
    compilerProgress: diagnostics.compilerProgress,
    deadlineMs: 90000,
    diagnosticProtocolValid: protocolValid,
    durationMs,
    endedAt: new Date().toISOString(),
    exitCode: outcome.laneProcess.exit?.code ?? null,
    exitSignal: outcome.laneProcess.exit?.signal ?? null,
    forcedTermination: false,
    index,
    ...(infrastructureReason === undefined ? {} : { infrastructureReason }),
    kind: 'attempt',
    ...(lastStage === undefined ? {} : { lastStage }),
    path: row.path,
    policyDigest: state.identity.policyDigest,
    processLifecycle: outcome.lifecycle,
    raw,
    result: outcome.result,
    stageHistory: diagnostics.stageHistory,
    ...(stallClassification === undefined ? {} : { stallClassification }),
    startedAt: new Date(Date.now() - durationMs).toISOString(),
    timedOut,
    version: 3,
    workerLifecycle: diagnostics.workerLifecycle,
  };
  await writeJsonAtomic(recordPath, record);
  await ledgerRecord(state, recordPath, 'attempt', index, 'primary');
  return record;
}

/** Persists a sole-row persistent-lane infrastructure failure before supervisor recovery. */
export async function persistPrimaryLaneFailure(
  state: CampaignState,
  index: number,
  failure: LaneRowFailure,
): Promise<PreviewTsxCorpusAttemptRecord> {
  const row = state.rows[index];
  if (row === undefined || failure.index !== index || failure.outcome.index !== index) {
    throw new Error(`Primary lane failure lost manifest identity at ${index.toString()}.`);
  }
  const recordPath = primaryAttemptRecordPath(state, index);
  const existing = await readJsonIfPresent<PreviewTsxCorpusAttemptRecord>(recordPath);
  if (existing !== undefined) {
    assertAttemptIdentity(existing, state, index, 'primary');
    await ledgerRecord(state, recordPath, 'attempt', index, 'primary');
    return existing;
  }
  await mkdir(path.dirname(recordPath), { recursive: true });
  const diagnostics = parseDiagnosticHistory(failure.outcome.stages, row, index);
  const protocolValid =
    failure.outcome.protocolValid &&
    diagnostics.valid &&
    ownershipTransportMatches(failure.outcome.ownership, diagnostics.ownership) &&
    !hasLaneCaptureTruncation(failure.outcome);
  const ownership = await inspectPrimaryOwnership(diagnostics.ownership, diagnostics.stageHistory);
  const rendered = diagnostics.stageHistory.some((event) => event.stage === 'render-started');
  const cleanupProof: PreviewTsxCorpusCleanupProof = {
    childCloseObserved: failure.cleanup.closeObserved,
    childExitBeforeClose: false,
    forcedGroupTermination: failure.cleanup.killSent,
    groupAbsentAfterClose: failure.cleanup.groupAbsent,
    listenersDetached: failure.cleanup.listenersDetached,
    normalWorkerCleanup: false,
    ownershipEventCount: diagnostics.ownership.length,
    ownershipSequenceValid: ownership.sequenceValid,
    preRenderCompileStarted: diagnostics.stageHistory.some(
      (event) => event.stage === 'compile-started',
    ),
    preRenderOnly: !rendered,
    rendererCleanupConfirmed: false,
    streamsTerminal: failure.cleanup.streamsTerminal,
    strictParentForcedCleanup: false,
    timersCleared: failure.outcome.lifecycle.some((event) => event.event === 'timers-cleared'),
    ...ownership.cleanupFacts,
  };
  const raw = await writeRawEvidence(
    state.options.artifacts,
    index,
    'primary',
    failure.outcome.stdout,
    failure.outcome.stderr,
    failure.outcome.stages,
  );
  const timedOut =
    failure.outcome.lifecycle.some((event) => event.event === 'deadline-expired') ||
    /deadline expired/iu.test(failure.cleanup.reason);
  const durationMs = Math.max(0, ...failure.outcome.lifecycle.map((event) => event.elapsedMs));
  const stallClassification = classifyCompilerStall(
    timedOut,
    diagnostics.stageHistory,
    diagnostics.compilerProgress,
    diagnostics.workerLifecycle,
  );
  const lastStage = diagnostics.stageHistory.at(-1)?.stage;
  const record: PreviewTsxCorpusAttemptRecord = {
    attemptKind: 'primary',
    cleanupConfirmed: false,
    cleanupProof,
    compilerProgress: diagnostics.compilerProgress,
    deadlineMs: 90000,
    diagnosticProtocolValid: protocolValid,
    durationMs,
    endedAt: new Date().toISOString(),
    exitCode: failure.outcome.laneProcess.exit?.code ?? null,
    exitSignal: failure.outcome.laneProcess.exit?.signal ?? null,
    forcedTermination: failure.cleanup.termSent || failure.cleanup.killSent,
    index,
    infrastructureReason: `primary-lane-failure: ${failure.cleanup.reason.slice(0, 1_000)}`,
    kind: 'attempt',
    ...(lastStage === undefined ? {} : { lastStage }),
    path: row.path,
    policyDigest: state.identity.policyDigest,
    processLifecycle: failure.outcome.lifecycle,
    raw,
    stageHistory: diagnostics.stageHistory,
    ...(stallClassification === undefined ? {} : { stallClassification }),
    startedAt: new Date(Date.now() - durationMs).toISOString(),
    timedOut,
    version: 3,
    workerLifecycle: diagnostics.workerLifecycle,
  };
  await writeJsonAtomic(recordPath, record);
  await ledgerRecord(state, recordPath, 'attempt', index, 'primary');
  return record;
}

/** Writes an attempt and classification for worker spawn failure without fabricating browser execution evidence. */
export async function persistSynchronousSpawnFailure(
  state: CampaignState,
  index: number,
  attemptKind: PreviewTsxCorpusAttemptKind,
  recordPath: string,
  row: PreviewTsxCorpusManifestRow,
  started: number,
  startedAt: string,
  error: unknown,
): Promise<PreviewTsxCorpusAttemptRecord> {
  const message = error instanceof Error ? error.message : String(error);
  const stage: PreviewTsxCorpusStageEvent = {
    detail: { parentSynthesized: true, processFailure: message.slice(0, 1_000) },
    elapsedMs: Date.now() - started,
    index,
    kind: 'target-stage',
    path: row.path,
    stage: 'spawned',
    version: 3,
  };
  const stageBuffer = Buffer.from(`${JSON.stringify(stage)}\n`);
  const stderrBuffer = Buffer.from(`${message}\n`);
  const raw = await writeRawEvidence(
    state.options.artifacts,
    index,
    attemptKind,
    Buffer.alloc(0),
    stderrBuffer,
    stageBuffer,
  );
  const cleanupProof: PreviewTsxCorpusCleanupProof = {
    childCloseObserved: false,
    childExitBeforeClose: false,
    forcedGroupTermination: false,
    groupAbsentAfterClose: true,
    listenersDetached: true,
    normalWorkerCleanup: false,
    preRenderCompileStarted: false,
    preRenderOnly: true,
    streamsTerminal: true,
    strictParentForcedCleanup: false,
    timersCleared: true,
  };
  const processLifecycle: readonly PreviewTsxCorpusProcessLifecycleEvent[] = [
    {
      detail: { message: message.slice(0, 1_000), synchronous: true },
      elapsedMs: Date.now() - started,
      event: 'child-error',
      kind: 'parent-process',
      version: 3,
    },
    {
      elapsedMs: Date.now() - started,
      event: 'timers-cleared',
      kind: 'parent-process',
      version: 3,
    },
    {
      elapsedMs: Date.now() - started,
      event: 'listeners-detached',
      kind: 'parent-process',
      version: 3,
    },
    {
      detail: { absent: true, reason: 'spawn-threw-before-pgid' },
      elapsedMs: Date.now() - started,
      event: 'group-probe',
      kind: 'parent-process',
      version: 3,
    },
  ];
  const record: PreviewTsxCorpusAttemptRecord = {
    attemptKind,
    cleanupConfirmed: true,
    cleanupProof,
    compilerProgress: [],
    deadlineMs: 90000,
    diagnosticProtocolValid: true,
    durationMs: Date.now() - started,
    endedAt: new Date().toISOString(),
    exitCode: null,
    exitSignal: null,
    forcedTermination: false,
    index,
    infrastructureReason: 'synchronous-spawn-failure',
    kind: 'attempt',
    lastStage: 'spawned',
    path: row.path,
    policyDigest: state.identity.policyDigest,
    processLifecycle,
    raw,
    stageHistory: [stage],
    startedAt,
    timedOut: false,
    version: 3,
    workerLifecycle: [],
  };
  await writeJsonAtomic(recordPath, record);
  await ledgerRecord(state, recordPath, 'attempt', index, attemptKind);
  return record;
}

/** Commits one eligible row's canonical record and ledger evidence under the frozen campaign identity. */
export async function writeCanonical(
  state: CampaignState,
  index: number,
  attempts: readonly PreviewTsxCorpusAttemptRecord[],
): Promise<number | undefined> {
  const row = state.rows[index];
  if (row === undefined) throw new Error(`Manifest index ${index.toString()} is absent.`);
  const recordPath = canonicalRecordPath(state, index);
  if (await fileExists(recordPath)) return undefined;
  const terminal = attempts.at(-1);
  if (terminal === undefined) throw new Error(`Canonical row ${row.path} has no attempt lineage.`);
  const classification = classifyCanonical(terminal, row, state.options.sourceRoot);
  const attemptLinks = await Promise.all(
    attempts.map(async (attempt) => ({
      attemptKind: attempt.attemptKind,
      attemptRecordSha256: digest(
        await readFile(
          path.join(state.options.artifacts, 'attempts', pad(index), `${attempt.attemptKind}.json`),
        ),
      ),
    })),
  );
  const record: PreviewTsxCorpusCanonicalRecord = {
    attempts: attemptLinks,
    category: classification.category,
    classifierDigest: state.identity.classifierDigest,
    committedAtEpochMs: Date.now(),
    engineDigest: state.identity.engineDigest,
    index,
    kind: 'canonical',
    manifestSha256: state.identity.manifestSha256,
    path: row.path,
    policyDigest: state.identity.policyDigest,
    reason: classification.reason,
    sha256: row.sha256,
    version: 1,
  };
  await writeJsonAtomic(recordPath, record);
  if (state.options.maxRows === undefined) {
    await ledgerRecord(state, recordPath, 'canonical', index);
  }
  // This is the supervisor's durable terminal boundary: raw evidence, attempt,
  // classifier candidate and cleanup have all been atomically persisted.
  return Date.now();
}

/** Records durable completion timing only when a row reaches the required ordered commit boundary. */
export function recordOrderedCommit(
  state: CampaignState,
  index: number,
  committedAtEpochMs: number,
): void {
  state.orderedCommits.set(index, committedAtEpochMs);
  for (;;) {
    const next = state.orderedFrontier + 1;
    const committedAt = state.orderedCommits.get(next);
    if (committedAt === undefined) return;
    state.orderedFrontier = next;
    state.orderedTimeline.push({ committedAtEpochMs: committedAt, index: next });
  }
}

/** Projects measured campaign counters and elapsed timing into the aggregate performance report. */
export function campaignPerformance(state: CampaignState): {
  readonly barrierEpochMs?: number;
  readonly epochs600: readonly PreviewTsxCorpusThroughputEpoch[];
  readonly overallRatePerMinute: number;
  readonly orderedCommitTimeline: readonly {
    readonly committedAtEpochMs: number;
    readonly index: number;
  }[];
  readonly slowest240RatePerMinute: number;
  readonly windows240: readonly PreviewTsxCorpusThroughputEpoch[];
} {
  const barrier = state.warmupBarrierEpochMs;
  const timed =
    barrier === undefined
      ? []
      : state.orderedTimeline.filter((entry) => entry.committedAtEpochMs >= barrier);
  const rate = (
    entries: readonly { readonly committedAtEpochMs: number; readonly index: number }[],
  ): number => {
    const last = entries.at(-1);
    if (barrier === undefined || last === undefined) return 0;
    const elapsedMs = Math.max(1, last.committedAtEpochMs - barrier);
    return (60_000 * entries.length) / elapsedMs;
  };
  const windows = (size: number, stride: number): PreviewTsxCorpusThroughputEpoch[] => {
    const result: PreviewTsxCorpusThroughputEpoch[] = [];
    for (let start = 0; start + size <= timed.length; start += stride) {
      const entries = timed.slice(start, start + size);
      const first = entries[0];
      const last = entries.at(-1);
      if (first === undefined || last === undefined)
        throw new Error('Empty corpus performance window.');
      const elapsedMs = Math.max(1, last.committedAtEpochMs - first.committedAtEpochMs);
      result.push({
        committedRows: size,
        elapsedMs,
        ratePerMinute: (60_000 * size) / elapsedMs,
        startIndex: first.index,
        version: 2,
      });
    }
    return result;
  };
  const windows240 = windows(240, 1);
  return {
    ...(barrier === undefined ? {} : { barrierEpochMs: barrier }),
    epochs600: windows(600, 600),
    overallRatePerMinute: rate(timed),
    orderedCommitTimeline: state.orderedTimeline,
    slowest240RatePerMinute:
      windows240.length === 0 ? 0 : Math.min(...windows240.map((window) => window.ratePerMinute)),
    windows240,
  };
}

/** Persists the campaign's current performance projection together with its terminal reporting context. */
export async function writeCampaignPerformance(
  state: CampaignState,
  limit: number,
  cleanupGate: boolean,
  resourceGate = false,
  sentinelGate = false,
): Promise<void> {
  const performance = campaignPerformance(state);
  await writeJsonAtomic(path.join(state.options.artifacts, 'performance.json'), {
    ...performance,
    cleanupGate,
    identityGate: true,
    laneCount:
      state.selectedLaneCount ??
      state.options.primaryJobs ??
      PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY.primaryJobs,
    limit,
    resourceGate,
    sentinelGate,
    version: 9,
  });
}

/** Requires every mandatory generation sentinel to retain its frozen semantic signature at campaign completion. */
export async function terminalSentinelGate(state: CampaignState): Promise<boolean> {
  let certificates: readonly string[];
  try {
    certificates = await readdir(path.join(state.options.artifacts, 'generations'));
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
  if (certificates.length === 0) return false;
  const matched = await Promise.all(
    certificates.map(async (file) => {
      const certificate = await readJsonIfPresent<PreviewTsxCorpusGenerationCertificate>(
        path.join(state.options.artifacts, 'generations', file),
      );
      return certificate?.sentinelMatched === true;
    }),
  );
  return matched.every(Boolean);
}

/** Checks owned process, capture, and cleanup evidence for every required row before final success. */
export async function terminalCleanupGate(state: CampaignState, limit: number): Promise<boolean> {
  const lineagesClosed = await Promise.all(
    Array.from({ length: limit }, async (_, index) => {
      const canonical = await readJsonIfPresent<PreviewTsxCorpusCanonicalRecord>(
        path.join(state.options.artifacts, 'canonical', `${pad(index)}.json`),
      );
      const terminal = canonical?.attempts.at(-1);
      if (terminal === undefined) return false;
      const attempt = await readJsonIfPresent<PreviewTsxCorpusAttemptRecord>(
        path.join(state.options.artifacts, 'attempts', pad(index), `${terminal.attemptKind}.json`),
      );
      return attempt?.cleanupConfirmed === true;
    }),
  );
  let certificates: readonly string[];
  try {
    certificates = await readdir(path.join(state.options.artifacts, 'generations'));
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
  if (certificates.length === 0 || lineagesClosed.some((closed) => !closed)) return false;
  const cleanupClosed = await Promise.all(
    certificates.map(async (file) => {
      const certificate = await readJsonIfPresent<{ readonly cleanup?: LaneCleanup }>(
        path.join(state.options.artifacts, 'generations', file),
      );
      const cleanup = certificate?.cleanup;
      return (
        cleanup !== undefined &&
        cleanup.closeObserved &&
        cleanup.groupAbsent &&
        cleanup.listenersDetached &&
        cleanup.streamsTerminal
      );
    }),
  );
  return cleanupClosed.every(Boolean);
}
