import { asPreviewHeadlessError, normalizeHeadlessEvidence } from './previewHeadlessErrorEvidence';
/** Certifies and executes throughput candidates with an isolation arbiter. */
import path from 'node:path';
import {
  readPreviewTsxCorpusChecksummedJson,
  writePreviewTsxCorpusJsonAtomic,
} from './previewHeadlessTsxCorpusCampaignArtifacts';
import {
  PREVIEW_TSX_CORPUS_ARCHITECTURE_ID,
  PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY,
  type PreviewTsxCorpusAttemptRecord,
  type PreviewTsxCorpusV11CandidateTerminalReport,
} from './previewHeadlessTsxCorpusCampaignTypes';
import { runAttempt } from './previewTsxCorpusAttempt';
import {
  attemptRequiresIsolation,
  isolatedCanBecomeCanonical,
} from './previewTsxCorpusClassification';
import { digestJson, pad, readJsonIfPresent, writeJsonAtomic } from './previewTsxCorpusFiles';
import { LaneRowFailure, PrimaryLane } from './previewTsxCorpusLane';
import type { CampaignState, LaneCleanup, V11Reference } from './previewTsxCorpusModel';
import {
  persistPrimaryLaneFailure,
  persistPrimaryLaneOutcome,
  writeCanonical,
} from './previewTsxCorpusPersistence';
import {
  persistSentinelOutcome,
  semanticSentinelSignature,
  strictCorridorSignature,
} from './previewTsxCorpusPreparation';
import { CampaignResourceSupervisor } from './previewTsxCorpusResources';

/** Tracks owned tasks, durable row terminals, and closure for one bounded throughput candidate. */
export class V11CandidateLifecycle {
  readonly ownedLanes = new Set<PrimaryLane>();
  readonly terminalIndices = new Set<number>();
  readonly taskRegistry = new Map<string, 'pending' | 'rejected' | 'fulfilled'>();
  readonly workCompletion: Promise<void>;
  readonly closedCompletion: Promise<void>;
  watchdog: NodeJS.Timeout | undefined;
  fatal: unknown;
  state: 'initializing' | 'starting' | 'measuring' | 'draining' | 'reporting' | 'closed' =
    'initializing';
  measurementStartedAt: number | undefined;
  terminalCommittedAt: number | undefined;
  #resolveClosed!: () => void;
  #resolveWork!: () => void;
  #rejectWork!: (error: Error) => void;
  #workSettled = false;
  /** Creates separate work and closure promises for the candidate's fixed lane count. */
  constructor(readonly laneCount: 12 | 14 | 16) {
    this.workCompletion = new Promise((resolve, reject) => {
      this.#resolveWork = resolve;
      this.#rejectWork = reject;
    });
    this.closedCompletion = new Promise((resolve) => {
      this.#resolveClosed = resolve;
    });
  }
  /** Registers a uniquely named task, recording rejection and propagating its original failure. */
  register<T>(name: string, task: Promise<T>): Promise<T> {
    if (this.taskRegistry.has(name)) throw new Error(`Duplicate v11 lifecycle task: ${name}`);
    this.taskRegistry.set(name, 'pending');
    return task.then(
      (value) => {
        this.taskRegistry.set(name, 'fulfilled');
        return value;
      },
      (error: unknown) => {
        this.taskRegistry.set(name, 'rejected');
        this.fail(error);
        throw error;
      },
    );
  }
  /** Retains the first fatal failure and rejects the measurement waiter when measurement is active. */
  fail(error: unknown): void {
    if (this.fatal !== undefined) return;
    this.fatal = error;
    // Before dispatch there is no work waiter yet. The enclosing candidate path
    // observes this startup fatal synchronously and still closes its report.
    if (this.state !== 'measuring') return;
    if (!this.#workSettled) {
      this.#workSettled = true;
      this.#rejectWork(error instanceof Error ? error : new Error(String(error)));
    }
  }
  /** Accepts each in-range row exactly once and resolves work only after all required rows are durably terminal. */
  terminal(index: number, committedAt: number): void {
    if (index < 0 || index >= 240 || this.terminalIndices.has(index))
      throw new Error(`Invalid duplicate/out-of-range v11 terminal ${index.toString()}.`);
    this.terminalIndices.add(index);
    if (this.terminalIndices.size === 240) {
      this.terminalCommittedAt = committedAt;
      this.#workSettled = true;
      this.#resolveWork();
    }
  }
  /** Marks terminal closure and releases callers waiting for the candidate report and cleanup boundary. */
  close(): void {
    this.state = 'closed';
    this.#resolveClosed();
  }
}

/** Serializes fresh-worker fallback operations so candidate lanes cannot multiply isolated resource usage. */
export class V11IsolationArbiter {
  #active = false;
  #queue: (() => void)[] = [];
  /** Waits for the single isolation slot and releases it even when the owned operation rejects. */
  async run<T>(operation: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      this.#queue.push(resolve);
      this.pump();
    });
    try {
      return await operation();
    } finally {
      this.#active = false;
      this.pump();
    }
  }
  /** Starts the next queued isolation waiter only when no fallback operation is active. */
  private pump(): void {
    if (this.#active) return;
    const next = this.#queue.shift();
    if (next === undefined) return;
    this.#active = true;
    next();
  }
}

/** Loads or measures a checksummed serial reference under the candidate's exact engine and semantic identity. */
export async function createV11Reference(
  state: CampaignState,
  root: string,
): Promise<V11Reference> {
  const referencePath = path.join(root, 'reference', 'reference.json');
  const semanticKey = digestJson({
    chromiumPath: path.resolve(state.options.chromiumPath),
    classifierDigest: state.identity.classifierDigest,
    engineDigest: state.identity.engineDigest,
    manifestSha256: state.identity.manifestSha256,
    policyDigest: state.identity.policyDigest,
    sourceRoot: state.identity.sourceRoot,
    timeoutMs: PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY.rendererDeadlineMs,
    virtualTimeMs: 5_000,
    workspace: state.identity.workspace,
  });
  const cached = await readJsonIfPresent<{
    readonly semanticKey: string;
    readonly signature: Readonly<Record<string, unknown>>;
  }>(referencePath);
  if (cached !== undefined) {
    if (cached.semanticKey !== semanticKey)
      throw new Error('v11 cached reference semantic identity mismatch.');
    await readPreviewTsxCorpusChecksummedJson(referencePath);
    return cached;
  }
  const sentinelIndex = state.sentinelIndices[0];
  if (sentinelIndex === undefined) throw new Error('v11 reference requires a frozen sentinel.');
  const fresh = new PrimaryLane(state, 90_000);
  let deadline: NodeJS.Timeout | undefined;
  try {
    const deadlinePromise = new Promise<never>((_, reject) => {
      deadline = setTimeout(() => {
        reject(new Error('v11 fresh reference deadline expired.'));
      }, 120_000);
    });
    const outcome = await Promise.race([fresh.run(sentinelIndex), deadlinePromise]);
    await persistSentinelOutcome(state, fresh, 'start', 'fresh', outcome);
    fresh.ack(outcome.index);
    const cleanup = await fresh.drainShutdown();
    if (
      !cleanup.closeObserved ||
      !cleanup.groupAbsent ||
      !cleanup.listenersDetached ||
      !cleanup.streamsTerminal
    )
      throw new Error('v11 fresh reference cleanup was inconclusive.');
    const signature = semanticSentinelSignature(outcome.result);
    if (!strictCorridorSignature(signature))
      throw new Error('v11 fresh reference lacks strict Page Context fidelity.');
    const reference = { cleanup, semanticKey, signature, version: 11 };
    const checksum = await writePreviewTsxCorpusJsonAtomic(referencePath, reference);
    await writePreviewTsxCorpusJsonAtomic(`${referencePath}.checksum.json`, checksum);
    await readPreviewTsxCorpusChecksummedJson(referencePath);
    return { semanticKey, signature };
  } catch (error) {
    await fresh.abort('v11 fresh reference failed.');
    throw error;
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
  }
}

/** Executes one mandatory sentinel and compares its semantic signature with the frozen reference. */
export async function certifyV11Sentinel(
  state: CampaignState,
  lane: PrimaryLane,
  reference: V11Reference,
  boundary: 'drain' | 'start',
): Promise<boolean> {
  for (const index of state.sentinelIndices) {
    const outcome = await lane.run(index);
    await persistSentinelOutcome(state, lane, boundary, 'warm', outcome);
    lane.ack(index);
    const matched =
      digestJson(semanticSentinelSignature(outcome.result)) === digestJson(reference.signature) &&
      strictCorridorSignature(semanticSentinelSignature(outcome.result));
    await writeJsonAtomic(
      path.join(
        state.options.artifacts,
        'sentinels',
        lane.generationId,
        boundary,
        `${pad(index)}.comparison.json`,
      ),
      { index, matched, reference: reference.signature, version: 11 },
    );
    if (!matched) return false;
  }
  return true;
}

/** Runs one fixed lane-count candidate through certification, measured dispatch, durable promotion, and owned cleanup. */
export async function runV11ThroughputCandidate(
  state: CampaignState,
  laneCount: 12 | 14 | 16,
  reference: V11Reference,
  root: string,
): Promise<PreviewTsxCorpusV11CandidateTerminalReport> {
  const lifecycle = new V11CandidateLifecycle(laneCount);
  lifecycle.watchdog = setTimeout(() => {
    lifecycle.fail(new Error('v11 candidate watchdog expired.'));
  }, 60 * 60_000);
  const resources = new CampaignResourceSupervisor(state, lifecycle.ownedLanes);
  const isolation = new V11IsolationArbiter();
  const rows: Promise<void>[] = [];
  const startCertificates: { readonly lane: number; readonly matched: boolean }[] = [];
  const drainCertificates: {
    readonly lane: number;
    readonly matched: boolean;
    readonly cleanup: LaneCleanup;
  }[] = [];
  let nextIndex = 0;
  let resourceGate = false;
  let cleanupGate = false;
  let report: PreviewTsxCorpusV11CandidateTerminalReport | undefined;
  try {
    lifecycle.state = 'starting';
    await resources.start();
    for (let laneId = 0; laneId < laneCount; laneId += 1) {
      const lane = new PrimaryLane(state, laneId);
      lifecycle.ownedLanes.add(lane);
      lane.child.once('close', () => {
        if (
          lifecycle.ownedLanes.has(lane) &&
          lifecycle.state !== 'draining' &&
          lifecycle.state !== 'reporting' &&
          lifecycle.state !== 'closed'
        )
          lifecycle.fail(
            new Error(`v11 lane ${laneId.toString()} closed before its registered drain.`),
          );
      });
      const matched = await lifecycle.register(
        `start-sentinel-${laneId.toString()}`,
        certifyV11Sentinel(state, lane, reference, 'start'),
      );
      startCertificates.push({ lane: laneId, matched });
      if (!matched) throw new Error(`v11 lane ${laneId.toString()} failed start sentinel.`);
    }
    lifecycle.state = 'measuring';
    lifecycle.measurementStartedAt = Date.now();
    for (const lane of lifecycle.ownedLanes) {
      const task = lifecycle.register(
        `row-loop-${lane.laneId.toString()}`,
        (async () => {
          for (;;) {
            if (lifecycle.fatal !== undefined) throw asPreviewHeadlessError(lifecycle.fatal);
            await resources.beforeClaim();
            const index = nextIndex;
            nextIndex += 1;
            if (index >= 240) return;
            let primary: PreviewTsxCorpusAttemptRecord;
            try {
              primary = await persistPrimaryLaneOutcome(state, index, await lane.run(index));
            } catch (error) {
              if (error instanceof LaneRowFailure)
                await persistPrimaryLaneFailure(state, index, error);
              throw error;
            }
            let attempts: readonly PreviewTsxCorpusAttemptRecord[] = [primary];
            if (attemptRequiresIsolation(primary)) {
              const isolated = await lifecycle.register(
                `isolation-${index.toString()}`,
                isolation.run(() => runAttempt(state, index, 'isolated')),
              );
              if (!isolatedCanBecomeCanonical(isolated))
                throw new Error(`v11 isolated attempt for ${index.toString()} was not terminal.`);
              attempts = [primary, isolated];
            }
            const committedAt = await writeCanonical(state, index, attempts);
            if (committedAt === undefined)
              throw new Error(`v11 duplicate durable terminal ${index.toString()}.`);
            lane.ack(index);
            lifecycle.terminal(index, committedAt);
          }
        })(),
      );
      rows.push(task);
    }
    await lifecycle.workCompletion;
    await Promise.all(rows);
    if (lifecycle.fatal !== undefined) throw asPreviewHeadlessError(lifecycle.fatal);
    lifecycle.state = 'draining';
    for (const lane of [...lifecycle.ownedLanes]) {
      const matched = await lifecycle.register(
        `drain-sentinel-${lane.laneId.toString()}`,
        certifyV11Sentinel(state, lane, reference, 'drain'),
      );
      const cleanup = await lifecycle.register(
        `drain-${lane.laneId.toString()}`,
        lane.drainShutdown(),
      );
      lifecycle.ownedLanes.delete(lane);
      drainCertificates.push({ cleanup, lane: lane.laneId, matched });
      if (
        !matched ||
        !cleanup.closeObserved ||
        !cleanup.groupAbsent ||
        !cleanup.listenersDetached ||
        !cleanup.streamsTerminal
      )
        throw new Error(`v11 lane ${lane.laneId.toString()} drain failed.`);
    }
    await resources.stop();
    resourceGate = await resources.persist(true);
    cleanupGate =
      drainCertificates.length === laneCount &&
      drainCertificates.every(
        ({ cleanup }) =>
          cleanup.closeObserved &&
          cleanup.groupAbsent &&
          cleanup.listenersDetached &&
          cleanup.streamsTerminal,
      );
  } catch (error) {
    lifecycle.fail(error);
  } finally {
    lifecycle.state = 'reporting';
    const cleanups = await Promise.allSettled(
      [...lifecycle.ownedLanes].map((lane) =>
        lifecycle.register(
          `cleanup-${lane.laneId.toString()}`,
          lane.abort('v11 candidate finalization.'),
        ),
      ),
    );
    lifecycle.ownedLanes.clear();
    await resources.stop();
    resourceGate = await resources.persist(true);
    cleanupGate =
      cleanupGate ||
      cleanups.every(
        (entry) =>
          entry.status === 'fulfilled' &&
          entry.value.groupAbsent &&
          entry.value.listenersDetached &&
          entry.value.streamsTerminal,
      );
    const sentinelGate =
      startCertificates.length === laneCount &&
      drainCertificates.length === laneCount &&
      startCertificates.every((entry) => entry.matched) &&
      drainCertificates.every((entry) => entry.matched);
    const identityGate = reference.semanticKey.length > 0;
    const taskGate = [...lifecycle.taskRegistry.values()].every((status) => status !== 'pending');
    const terminalRows = lifecycle.terminalIndices.size;
    const elapsed =
      lifecycle.measurementStartedAt === undefined || lifecycle.terminalCommittedAt === undefined
        ? 0
        : Math.max(1, lifecycle.terminalCommittedAt - lifecycle.measurementStartedAt);
    const rate = terminalRows === 240 ? (240 * 60_000) / elapsed : 0;
    const gates = {
      cleanup: cleanupGate,
      identity: identityGate,
      noOwnedProcesses: cleanups.every(
        (entry) => entry.status === 'fulfilled' && entry.value.groupAbsent,
      ),
      resource: resourceGate,
      sentinel: sentinelGate,
      tasks: taskGate,
      terminals: terminalRows === 240,
      watchdog: lifecycle.fatal === undefined,
    };
    const passed = Object.values(gates).every(Boolean) && rate >= 100;
    report = {
      candidate: laneCount,
      gates,
      ...(lifecycle.measurementStartedAt === undefined
        ? {}
        : { measurementStartedAt: lifecycle.measurementStartedAt }),
      status: passed
        ? 'selected'
        : lifecycle.fatal === undefined && Object.values(gates).every(Boolean)
          ? 'safe-sub-100'
          : 'failed',
      ...(lifecycle.terminalCommittedAt === undefined
        ? {}
        : { terminalCommittedAt: lifecycle.terminalCommittedAt }),
      terminalRows,
      terminalRatePerMinute: rate,
      version: 11,
    };
    const terminalPath = path.join(root, 'candidate-terminal-report.json');
    const checksum = await writePreviewTsxCorpusJsonAtomic(terminalPath, {
      ...report,
      drainCertificates,
      fatalCause:
        lifecycle.fatal instanceof Error
          ? lifecycle.fatal.message
          : lifecycle.fatal === undefined
            ? undefined
            : normalizeHeadlessEvidence(lifecycle.fatal),
      referenceIdentity: reference.semanticKey,
      startCertificates,
      taskRegistry: Object.fromEntries(lifecycle.taskRegistry),
    });
    await writePreviewTsxCorpusJsonAtomic(`${terminalPath}.checksum.json`, checksum);
    await readPreviewTsxCorpusChecksummedJson(terminalPath);
    clearTimeout(lifecycle.watchdog);
    lifecycle.close();
  }
  await lifecycle.closedCompletion;
  return report;
}

/** Compares terminal candidate reports with the serial reference and persists the acceleration acceptance decision. */
export async function writeV11AggregateReport(
  root: string,
  candidates: readonly PreviewTsxCorpusV11CandidateTerminalReport[],
  selected?: 12 | 14 | 16,
): Promise<void> {
  const filePath = path.join(root, 'measurement-report.json');
  const checksum = await writePreviewTsxCorpusJsonAtomic(filePath, {
    architectureId: PREVIEW_TSX_CORPUS_ARCHITECTURE_ID,
    candidates,
    selected: selected ?? null,
    version: 11,
  });
  await writePreviewTsxCorpusJsonAtomic(`${filePath}.checksum.json`, checksum);
  await readPreviewTsxCorpusChecksummedJson(filePath);
}
