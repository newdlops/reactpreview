import { asPreviewHeadlessError } from './previewHeadlessErrorEvidence';
import { isPreviewTsxCorpusFrozenPolicy } from './previewTsxCorpusPolicy';
/** Coordinates baseline, calibration, and verification of bounded TSX preview campaigns. */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { writePreviewTsxCorpusJsonAtomic } from './previewHeadlessTsxCorpusCampaignArtifacts';
import {
  PREVIEW_TSX_CORPUS_ARCHITECTURE_ID,
  PREVIEW_TSX_CORPUS_CAMPAIGN_SCHEMA_VERSION,
  PREVIEW_TSX_CORPUS_CLASSIFIER_VERSION,
  PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY,
  type PreviewTsxCorpusAttemptRecord,
  type PreviewTsxCorpusFrozenPolicy,
  type PreviewTsxCorpusGenerationCertificate,
  type PreviewTsxCorpusV11CandidateTerminalReport,
} from './previewHeadlessTsxCorpusCampaignTypes';
import { runAttempt } from './previewTsxCorpusAttempt';
import {
  attemptRequiresIsolation,
  isolatedCanBecomeCanonical,
} from './previewTsxCorpusClassification';
import {
  commitStagedCanonicals,
  digest,
  ledgerRecord,
  parseManifest,
  readJsonIfPresent,
  writeJsonAtomic,
  writeSummary,
} from './previewTsxCorpusFiles';
import { LaneRowFailure, PrimaryLane } from './previewTsxCorpusLane';
import type { CampaignOptions, LaneCleanup, V11Reference } from './previewTsxCorpusModel';
import {
  campaignPerformance,
  persistPrimaryLaneFailure,
  persistPrimaryLaneOutcome,
  recordOrderedCommit,
  terminalCleanupGate,
  terminalSentinelGate,
  writeCampaignPerformance,
  writeCanonical,
} from './previewTsxCorpusPersistence';
import {
  assertAttemptIdentity,
  certifyGenerationSentinels,
  pendingCanonicalIndices,
  prepareCampaign,
  primaryAttemptRecordPath,
} from './previewTsxCorpusPreparation';
import { CampaignResourceSupervisor, frozenMandatorySentinels } from './previewTsxCorpusResources';
import {
  createV11Reference,
  runV11ThroughputCandidate,
  writeV11AggregateReport,
} from './previewTsxCorpusV11';

/** Runs or resumes a frozen jobs-3 corpus campaign with a jobs-1 isolated fallback. */
export async function runPreviewHeadlessTsxCorpusCampaign(options: CampaignOptions): Promise<void> {
  const state = await prepareCampaign(options);
  const limit = Math.min(options.maxRows ?? state.rows.length, state.rows.length);
  const pending = await pendingCanonicalIndices(state, limit);
  const laneCount =
    state.selectedLaneCount ??
    options.primaryJobs ??
    PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY.primaryJobs;
  const warmupRows = laneCount * PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY.warmupRowsPerLane;
  if (pending.length < warmupRows && pending.length !== 0) {
    throw new Error('v9 requires exactly four durable warm-up rows per primary lane.');
  }
  const warmupAssignments = Array.from({ length: laneCount }, (_, laneId) =>
    pending.slice(
      laneId * PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY.warmupRowsPerLane,
      (laneId + 1) * PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY.warmupRowsPerLane,
    ),
  );
  let nextPending = Math.min(warmupRows, pending.length);
  let completedWarmupLanes = 0;
  let openWarmupBarrier: (() => void) | undefined;
  let rejectWarmupBarrier: ((error: Error) => void) | undefined;
  const warmupBarrier = new Promise<void>((resolve, reject) => {
    openWarmupBarrier = resolve;
    rejectWarmupBarrier = reject;
  });
  let stopClaims = false;
  let fatal: unknown;
  const readFatal = (): unknown => fatal;
  let durableCanonicals = 0;
  let commitChain: Promise<void> = Promise.resolve();
  let isolationChain: Promise<void> = Promise.resolve();
  let abortPromise: Promise<void> | undefined;
  const activeLanes = new Set<PrimaryLane>();
  const resources = new CampaignResourceSupervisor(state, activeLanes);
  let generationStartSentinelChain: Promise<void> = Promise.resolve();
  const certifyGenerationBoundary = async (
    lane: PrimaryLane,
    boundary: 'drain' | 'start',
  ): Promise<boolean> => {
    const certification = generationStartSentinelChain.then(() =>
      certifyGenerationSentinels(state, lane, boundary),
    );
    generationStartSentinelChain = certification.then(
      () => undefined,
      () => undefined,
    );
    return certification;
  };

  const commit = async <T>(operation: () => Promise<T>): Promise<T> => {
    const result = commitChain.then(operation);
    commitChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const claim = (): number | undefined => {
    if (stopClaims) return undefined;
    const index = pending[nextPending];
    nextPending += 1;
    return index;
  };
  const abortLanes = async (reason: string): Promise<void> => {
    abortPromise ??= Promise.all(
      [...activeLanes].map(async (lane) => {
        const cleanup = await lane.abort(reason);
        if (!cleanup.groupAbsent || !cleanup.listenersDetached) {
          throw new Error(`Primary lane ${lane.laneId.toString()} abort cleanup was inconclusive.`);
        }
      }),
    ).then(() => undefined);
    return abortPromise;
  };
  const markFatal = async (error: unknown): Promise<void> => {
    if (fatal === undefined) fatal = error;
    stopClaims = true;
    rejectWarmupBarrier?.(error instanceof Error ? error : new Error(String(error)));
    await abortLanes(error instanceof Error ? error.message : String(error));
  };
  const writeCanonicalCommitted = async (
    index: number,
    attempts: readonly PreviewTsxCorpusAttemptRecord[],
  ): Promise<void> => {
    const committedAtEpochMs = await writeCanonical(state, index, attempts);
    if (committedAtEpochMs === undefined) return;
    recordOrderedCommit(state, index, committedAtEpochMs);
    durableCanonicals += 1;
    if (durableCanonicals % 100 === 0) {
      await writeSummary(state, limit);
      await writeCampaignPerformance(state, limit, false);
    }
    const performance = campaignPerformance(state);
    if (
      state.options.phase !== 'calibration' &&
      performance.epochs600.some((epoch) => epoch.ratePerMinute < 100)
    ) {
      throw new Error('v9 production throughput gate failed for a complete 600-row epoch.');
    }
  };
  const enqueueIsolation = (
    index: number,
    primary: PreviewTsxCorpusAttemptRecord,
  ): Promise<void> => {
    const task = isolationChain.then(async () => {
      const isolated = await runAttempt(state, index, 'isolated');
      if (!isolatedCanBecomeCanonical(isolated)) {
        throw new Error(
          `Isolated infrastructure outcome left ${String(state.rows[index]?.path ?? index)} unclassified: ${isolated.infrastructureReason ?? isolated.lastStage ?? 'no target evidence'}`,
        );
      }
      await commit(() => writeCanonicalCommitted(index, [primary, isolated]));
    });
    isolationChain = task;
    void task.catch(async (error: unknown) => {
      try {
        await markFatal(error);
      } catch {
        // The terminal scheduler path rethrows the original fatal error.
      }
    });
    return task;
  };
  const persistOrReadPrimary = async (
    lane: PrimaryLane,
    index: number,
  ): Promise<PreviewTsxCorpusAttemptRecord> => {
    const recordPath = primaryAttemptRecordPath(state, index);
    const existing = await readJsonIfPresent<PreviewTsxCorpusAttemptRecord>(recordPath);
    if (existing !== undefined) {
      assertAttemptIdentity(existing, state, index, 'primary');
      await ledgerRecord(state, recordPath, 'attempt', index, 'primary');
    }
    if (existing !== undefined) return existing;
    try {
      const outcome = await lane.run(index);
      const record = await persistPrimaryLaneOutcome(state, index, outcome);
      lane.ack(index);
      return record;
    } catch (error) {
      if (!(error instanceof LaneRowFailure)) throw error;
      return persistPrimaryLaneFailure(state, index, error);
    }
  };
  const retireLane = async (
    lane: PrimaryLane,
    rows: number,
    reason: string,
    startSentinelMatched: boolean,
  ): Promise<void> => {
    await isolationChain;
    const drainSentinelMatched = await certifyGenerationBoundary(lane, 'drain');
    if (!startSentinelMatched || !drainSentinelMatched) {
      throw new Error(
        `Primary lane ${lane.laneId.toString()} failed its compiler-generation semantic sentinel.`,
      );
    }
    const cleanup = await lane.drainShutdown();
    activeLanes.delete(lane);
    if (
      !cleanup.closeObserved ||
      !cleanup.groupAbsent ||
      !cleanup.listenersDetached ||
      !cleanup.streamsTerminal
    ) {
      throw new Error(
        `Primary lane ${lane.laneId.toString()} generation cleanup was inconclusive.`,
      );
    }
    const certificate: PreviewTsxCorpusGenerationCertificate & {
      readonly cleanup: LaneCleanup;
      readonly reason: string;
    } = {
      cleanup,
      generationId: lane.generationId,
      isolationProofs: 0,
      lane: lane.laneId,
      reason,
      rows,
      sentinelMatched: true,
      version: 2,
    };
    await commit(async () => {
      const certificatePath = path.join(
        state.options.artifacts,
        'generations',
        `lane-${lane.laneId.toString()}-${lane.generationId}.json`,
      );
      await mkdir(path.dirname(certificatePath), { recursive: true });
      await writeJsonAtomic(certificatePath, certificate);
    });
  };
  const runLane = async (laneId: number): Promise<void> => {
    let lane = new PrimaryLane(state, laneId);
    activeLanes.add(lane);
    let startSentinelMatched = await certifyGenerationBoundary(lane, 'start');
    if (!startSentinelMatched)
      throw new Error(`Primary lane ${laneId.toString()} failed its start sentinel.`);
    let generationRows = 0;
    let generationStarted = performance.now();
    const processIndex = async (
      index: number,
      waitForIsolation: boolean,
    ): Promise<PreviewTsxCorpusAttemptRecord> => {
      const primary = await persistOrReadPrimary(lane, index);
      if (attemptRequiresIsolation(primary)) {
        const isolation = enqueueIsolation(index, primary);
        if (waitForIsolation) await isolation;
      } else {
        await commit(() => writeCanonicalCommitted(index, [primary]));
      }
      generationRows += 1;
      return primary;
    };
    try {
      await resources.beforeClaim();
      for (const index of warmupAssignments[laneId] ?? []) await processIndex(index, true);
      completedWarmupLanes += 1;
      if (
        state.warmupBarrierEpochMs === undefined &&
        (completedWarmupLanes === laneCount || (pending.length === 0 && laneId === 0))
      ) {
        await commit(async () => {
          state.warmupBarrierEpochMs = Date.now();
          await writeCampaignPerformance(state, limit, false);
          openWarmupBarrier?.();
        });
      }
      await warmupBarrier;
      let postWarmRssBytes = resources.laneRssBytes(laneId);
      for (;;) {
        if (readFatal() !== undefined) return;
        await resources.beforeClaim();
        const index = claim();
        if (index === undefined) break;
        const primary = await processIndex(index, false);
        const generationExpired = performance.now() - generationStarted >= 15 * 60_000;
        const laneFailed =
          primary.infrastructureReason?.startsWith('primary-lane-failure:') === true;
        const resourceRetire = resources.generationMustRetire(laneId, postWarmRssBytes);
        if (laneFailed || resourceRetire || generationRows >= 64 || generationExpired) {
          await retireLane(
            lane,
            generationRows,
            laneFailed
              ? 'lane-failure'
              : resourceRetire
                ? 'resource-limit'
                : generationExpired
                  ? 'age-limit'
                  : 'row-limit',
            startSentinelMatched,
          );
          if (readFatal() !== undefined || nextPending >= pending.length) return;
          lane = new PrimaryLane(state, laneId);
          activeLanes.add(lane);
          startSentinelMatched = await certifyGenerationBoundary(lane, 'start');
          if (!startSentinelMatched)
            throw new Error(
              `Primary lane ${laneId.toString()} failed its replacement start sentinel.`,
            );
          generationRows = 0;
          generationStarted = performance.now();
          postWarmRssBytes = resources.laneRssBytes(laneId);
        }
      }
      await retireLane(lane, generationRows, 'pending-exhausted', startSentinelMatched);
    } catch (error) {
      await markFatal(error);
      // A lane certification/dispatch failure must reject the candidate; swallowing
      // it lets Node finish with neither a closed report nor a calibration error.
      throw error;
    }
  };

  try {
    await resources.start();
    await resources.persist(false);
    await Promise.all(Array.from({ length: laneCount }, (_, laneId) => runLane(laneId)));
    await isolationChain;
    if (readFatal() !== undefined) throw asPreviewHeadlessError(fatal);
  } catch (error) {
    await markFatal(error);
    await Promise.allSettled(
      [...activeLanes].map((lane) => lane.abort('Campaign aborted after fatal scheduler error.')),
    );
    await resources.stop();
    const resourceGate = await resources.persist(true);
    await commit(() => writeCampaignPerformance(state, limit, false, resourceGate));
    throw fatal ?? error;
  }
  if (options.maxRows !== undefined) await commitStagedCanonicals(state, limit);
  await commit(async () => {
    await writeSummary(state, limit);
    await resources.stop();
    const resourceGate = await resources.persist(true);
    await writeCampaignPerformance(
      state,
      limit,
      await terminalCleanupGate(state, limit),
      resourceGate,
      await terminalSentinelGate(state),
    );
  });
}

/** Executes the v11 explicit, closed serial throughput candidates over one 240-row window. */
export async function calibratePreviewHeadlessTsxCorpusCampaign(options: {
  readonly artifacts: string;
  readonly chromiumPath: string;
  readonly manifestPath: string;
  readonly runtimePath: string;
  readonly sourceRoot: string;
  readonly windowRows: number;
  readonly windowStart: number;
  readonly workspace: string;
}): Promise<void> {
  if (options.windowStart !== 0 || options.windowRows !== 240) {
    throw new Error('v11 calibration requires the contiguous manifest range 0–239.');
  }
  const reports: PreviewTsxCorpusV11CandidateTerminalReport[] = [];
  let reference: V11Reference | undefined;
  for (const laneCount of PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY.laneCounts) {
    const candidateArtifacts = path.join(
      options.artifacts,
      `candidate-v11-serial-l${laneCount.toString()}`,
    );
    const state = await prepareCampaign({
      ...options,
      artifacts: candidateArtifacts,
      maxRows: 240,
      phase: 'calibration',
      primaryJobs: laneCount,
      referenceRoot: path.join(options.artifacts, 'reference'),
    });
    reference ??= await createV11Reference(state, options.artifacts);
    const report = await runV11ThroughputCandidate(state, laneCount, reference, candidateArtifacts);
    reports.push(report);
    const selected = report.status === 'selected';
    await writeV11AggregateReport(options.artifacts, reports, selected ? laneCount : undefined);
    if (selected) {
      const policy: PreviewTsxCorpusFrozenPolicy = {
        architectureId: PREVIEW_TSX_CORPUS_ARCHITECTURE_ID,
        classifierVersion: PREVIEW_TSX_CORPUS_CLASSIFIER_VERSION,
        engineDigest: state.identity.engineDigest,
        laneCount,
        manifestSha256: state.identity.manifestSha256,
        pipelineDepth: 1,
        policyDigest: state.identity.policyDigest,
        protocolVersion: 3,
        reuseMode: 'persistent-compiler-fresh-browser',
        selectedAt: new Date().toISOString(),
        sentinels: await frozenMandatorySentinels(options.manifestPath),
        version: PREVIEW_TSX_CORPUS_CAMPAIGN_SCHEMA_VERSION,
      };
      await writePreviewTsxCorpusJsonAtomic(
        path.join(options.artifacts, 'selected-policy.json'),
        policy,
      );
      return;
    }
    if (report.status !== 'safe-sub-100')
      throw new Error(`v11 candidate L=${laneCount.toString()} closed with a failed gate.`);
  }
  await writeV11AggregateReport(options.artifacts, reports);
  throw new Error('No v11 calibration candidate achieved the required closed throughput gate.');
}

/** Verifies durable campaign identities, row coverage, cleanup, and terminal gates before accepting the aggregate report. */
export async function verifyPreviewHeadlessTsxCorpusCampaign(options: {
  readonly baseline: string;
  readonly final: string;
  readonly manifestPath: string;
  readonly policyPath: string;
  readonly report: string;
}): Promise<void> {
  const [manifest, policy, baselineActive, finalActive] = await Promise.all([
    readFile(options.manifestPath, 'utf8'),
    readJsonIfPresent<unknown>(options.policyPath),
    readJsonIfPresent<{ readonly artifacts: string }>(
      path.join(options.baseline, 'active-campaign.json'),
    ),
    readJsonIfPresent<{ readonly artifacts: string }>(
      path.join(options.final, 'active-campaign.json'),
    ),
  ]);
  const [baseline, final] = await Promise.all([
    baselineActive === undefined
      ? undefined
      : readJsonIfPresent<{
          readonly canonical: number;
          readonly pending: number;
          readonly policyDigest: string;
        }>(path.join(options.baseline, baselineActive.artifacts, 'summary.json')),
    finalActive === undefined
      ? undefined
      : readJsonIfPresent<{
          readonly canonical: number;
          readonly pending: number;
          readonly policyDigest: string;
        }>(path.join(options.final, finalActive.artifacts, 'summary.json')),
  ]);
  const [baselinePerformance, finalPerformance] = await Promise.all([
    baselineActive === undefined
      ? undefined
      : readJsonIfPresent<{
          readonly overallRatePerMinute: number;
          readonly epochs600: readonly { readonly ratePerMinute: number }[];
          readonly cleanupGate: boolean;
          readonly identityGate: boolean;
          readonly resourceGate: boolean;
          readonly sentinelGate: boolean;
        }>(path.join(options.baseline, baselineActive.artifacts, 'performance.json')),
    finalActive === undefined
      ? undefined
      : readJsonIfPresent<{
          readonly overallRatePerMinute: number;
          readonly epochs600: readonly { readonly ratePerMinute: number }[];
          readonly cleanupGate: boolean;
          readonly identityGate: boolean;
          readonly resourceGate: boolean;
          readonly sentinelGate: boolean;
        }>(path.join(options.final, finalActive.artifacts, 'performance.json')),
  ]);
  const performancePasses = (performance: typeof baselinePerformance): boolean =>
    performance !== undefined &&
    performance.overallRatePerMinute >= 100 &&
    performance.epochs600.every((epoch) => epoch.ratePerMinute >= 100) &&
    performance.cleanupGate &&
    performance.identityGate &&
    performance.resourceGate &&
    performance.sentinelGate;
  if (
    !isPreviewTsxCorpusFrozenPolicy(policy) ||
    baseline === undefined ||
    final === undefined ||
    parseManifest(manifest).length !== 7725 ||
    baseline.canonical !== 7725 ||
    final.canonical !== 7725 ||
    baseline.pending !== 0 ||
    final.pending !== 0 ||
    baseline.policyDigest !== policy.policyDigest ||
    final.policyDigest !== policy.policyDigest ||
    !performancePasses(baselinePerformance) ||
    !performancePasses(finalPerformance)
  ) {
    throw new Error(
      'v9 verification requires two complete 7,725-row serial-policy phases with every performance gate closed.',
    );
  }
  await writePreviewTsxCorpusJsonAtomic(path.join(options.report, 'verification.json'), {
    baseline,
    final,
    manifestSha256: digest(manifest),
    policy,
    version: 2,
  });
}
export { acceleratePreviewHeadlessTsxCorpusCampaign } from './previewTsxCorpusV12';
