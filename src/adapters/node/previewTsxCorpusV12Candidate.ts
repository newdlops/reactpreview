import { asPreviewHeadlessError, normalizeHeadlessEvidence } from './previewHeadlessErrorEvidence';
/** Runs one acceleration candidate with bounded compilation and durable classification. */
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { renderCompiledPreviewHeadlessly } from './previewHeadlessRenderer';
import {
  readPreviewTsxCorpusChecksummedJson,
  writePreviewTsxCorpusJsonAtomic,
} from './previewHeadlessTsxCorpusCampaignArtifacts';
import {
  type PreviewTsxCorpusCategory,
  type PreviewTsxCorpusManifestRow,
} from './previewHeadlessTsxCorpusCampaignTypes';
import {
  PREVIEW_TSX_CORPUS_SPOOL_LIMIT_BYTES,
  readPreviewTsxCorpusSpool,
  removePreviewTsxCorpusSpool,
  verifyPreviewTsxCorpusSpool,
  type PreviewTsxCorpusSpoolDescriptor,
} from './previewHeadlessTsxCorpusPipeline';
import { classifyHeadlessResult } from './previewTsxCorpusClassification';
import {
  FILTERED_COMPILER_GENERATION_ROWS,
  FILTERED_MINIMUM_TERMINAL_RATE_PER_MINUTE,
  type V12RowClassification,
} from './previewTsxCorpusModel';
import {
  V12ProgressCheckpointWriter,
  emptyPreviewTsxCorpusCategoryCounts,
} from './previewTsxCorpusProgress';
import {
  V12CompileDeadlineError,
  V12CompileStageError,
  V12CompilerProcess,
  v12Request,
} from './previewTsxCorpusV12Compiler';

/** Coordinates compiler spools, browser rendering, isolated fallback, checkpoints, and final cleanup for one candidate. */
export async function runV12Candidate(
  context: {
    readonly artifacts: string;
    readonly chromiumPath: string;
    readonly engineDigest: string;
    readonly manifest: readonly PreviewTsxCorpusManifestRow[];
    readonly policyDigest: string;
    readonly root: string;
    readonly runtimePath: string;
    readonly selectedRows: readonly number[];
    readonly selection: Readonly<{
      readonly digest: string;
      readonly mode: 'contiguous-window' | 'static-triage';
      readonly rows: number;
    }>;
    readonly semanticKey: string;
    readonly sourceRoot: string;
    readonly windowRows: number;
    readonly windowStart: number;
    readonly workspace: string;
  },
  lanes: number,
  renderSlots: number,
): Promise<{
  readonly candidate: string;
  readonly gates: Readonly<Record<string, boolean>>;
  readonly ratePerMinute: number;
  readonly status: 'failed' | 'safe-sub-100' | 'selected';
  readonly terminalRows: number;
  readonly version: 12;
}> {
  /** Requires an exact frozen row before using its source identity or persisting a classification. */
  function manifestRow(index: number): PreviewTsxCorpusManifestRow {
    const row = context.manifest[index];
    if (row === undefined) throw new Error(`Missing v12 manifest row ${index.toString()}.`);
    return row;
  }
  await mkdir(context.root, { recursive: true });
  const pendingRows = [...context.selectedRows];
  // Row zero owns an unusually broad automatic-search frontier when compiled
  // cold. Admit it after the shared project caches have received initial work,
  // without pinning seven unrelated rows behind the same compiler process.
  const rowZeroOffset = pendingRows.indexOf(0);
  if (rowZeroOffset >= 0) {
    pendingRows.splice(rowZeroOffset, 1);
    pendingRows.splice(Math.min(lanes, pendingRows.length), 0, 0);
  }
  const queue: {
    readonly descriptor: PreviewTsxCorpusSpoolDescriptor;
    readonly admittedAt: number;
    readonly compileStarted: number;
    readonly compileFinished: number;
  }[] = [];
  const events: Record<string, unknown>[] = [];
  const terminal = new Set<number>();
  const compilerIntervals: [number, number][] = [];
  const renderIntervals: [number, number][] = [];
  const warmupIntervals: [number, number][] = [];
  const compilerProcesses = Array.from(
    { length: lanes },
    (_, laneId) => new V12CompilerProcess(context.runtimePath, laneId),
  );
  const compilerCleanups = Array.from({ length: lanes }, () => false);
  const retiredCompilerCleanups: boolean[] = [];
  const deadlineCleanups: boolean[] = [];
  const rowFailures: Record<string, unknown>[] = [];
  const rowClassifications: V12RowClassification[] = [];
  // A reservation covers active compilation as well as durable render handoff.
  // Basing this only on renderer count silently capped a 16-lane compiler pool
  // at ten active rows. Keep every compiler admissible and retain one bounded
  // renderer-sized handoff cushion; the independent byte ceiling remains the
  // hard payload bound.
  const reservationLimit = lanes + renderSlots;
  let unclaimed = 0;
  let bytes = 0;
  let compilersDone = 0;
  let fatal: unknown;
  let reservations = 0;
  let highCount = 0;
  let highBytes = 0;
  let queueHighCount = 0;
  let wake!: () => void;
  let changed = new Promise<void>((resolve) => {
    wake = resolve;
  });
  const signal = (): void => {
    wake();
    changed = new Promise<void>((resolve) => {
      wake = resolve;
    });
  };
  const wait = async (): Promise<void> => changed;
  const campaignId = randomUUID();
  const candidateStartedAt = Date.now();
  let barrier = candidateStartedAt;
  let finishedAt = 0;
  const fail = (error: unknown): void => {
    fatal ??= error;
    signal();
  };
  const runtimeState = (): import('./previewTsxCorpusModel').V12ProgressRuntimeState => ({
    claimedRows: unclaimed,
    compilerLanesDone: compilersDone,
    fatal,
    queueRows: queue.length,
    reservations,
  });
  const progressWriter = new V12ProgressCheckpointWriter({
    campaignId,
    candidate: `${lanes.toString()}x${renderSlots.toString()}`,
    compilerLaneCount: lanes,
    engineDigest: context.engineDigest,
    onError: fail,
    policyDigest: context.policyDigest,
    root: context.root,
    runtimeState,
    startedAt: candidateStartedAt,
    totalRows: context.windowRows,
    windowStart: context.windowStart,
  });
  await progressWriter.initialize();
  const acquireReservation = async (): Promise<void> => {
    while (reservations >= reservationLimit || bytes >= PREVIEW_TSX_CORPUS_SPOOL_LIMIT_BYTES) {
      if (fatal !== undefined) throw asPreviewHeadlessError(fatal);
      await wait();
    }
    if (fatal !== undefined) throw asPreviewHeadlessError(fatal);
    reservations += 1;
    highCount = Math.max(highCount, reservations);
  };
  const releaseReservation = (): void => {
    if (reservations <= 0) throw new Error('v12 spool reservation underflow.');
    reservations -= 1;
    signal();
  };
  barrier = Date.now();
  const compilerLane = async (laneId: number): Promise<void> => {
    let compiler = compilerProcesses[laneId];
    if (compiler === undefined) throw new Error(`Missing v12 compiler lane ${laneId.toString()}.`);
    let generation = 1;
    let generationRows = 0;
    try {
      for (;;) {
        // Claim one row at a time so a slow file cannot strand the remaining
        // rows in an eight-row lane-local chunk while other compilers go idle.
        const index = pendingRows[unclaimed++];
        if (index === undefined) break;
        // Three rows was the faster of the closed 240-row measurements because longer-lived
        // project/vendor caches increased aggregate memory contention. Rotation happens only after
        // another row has been claimed, so the final generation is not spawned merely to shut down.
        if (generationRows >= FILTERED_COMPILER_GENERATION_ROWS) {
          const cleanupConfirmed = await compiler.shutdown();
          retiredCompilerCleanups.push(cleanupConfirmed);
          if (!cleanupConfirmed)
            throw new Error(
              `v12 retired compiler lane ${laneId.toString()} left an owned process group.`,
            );
          compiler = new V12CompilerProcess(context.runtimePath, laneId);
          compilerProcesses[laneId] = compiler;
          generation += 1;
          generationRows = 0;
        }
        await acquireReservation();
        let descriptor: PreviewTsxCorpusSpoolDescriptor | undefined;
        let handedOff = false;
        try {
          const admittedAt = Date.now();
          const request = await v12Request(
            manifestRow(index),
            context.sourceRoot,
            context.workspace,
          );
          const identity = {
            attemptId: randomUUID(),
            campaignId,
            candidate: `${lanes.toString()}x${renderSlots.toString()}`,
            engineDigest: context.engineDigest,
            generationId: `${laneId.toString()}-g${generation.toString()}`,
            laneId,
            policyDigest: context.policyDigest,
            row: index,
            sourceDigest: manifestRow(index).sha256,
          };
          const message = await compiler.compile({
            absoluteDeadlineEpochMs: admittedAt + 90_000,
            commandId: randomUUID(),
            identity,
            kind: 'compile',
            request,
            spoolRoot: context.root,
            version: 12,
          });
          descriptor = message.descriptor;
          compilerIntervals.push([message.compileStartedAt, message.compileFinishedAt]);
          await verifyPreviewTsxCorpusSpool(descriptor, identity); // durable supervisor acknowledgement
          if (Date.now() > descriptor.absoluteDeadlineEpochMs)
            throw new Error('Row deadline expired while waiting in the render queue.');
          if (fatal !== undefined) throw asPreviewHeadlessError(fatal);
          if (bytes + descriptor.bundleBytes > PREVIEW_TSX_CORPUS_SPOOL_LIMIT_BYTES)
            throw new Error('v12 durable spool byte ceiling would be exceeded.');
          bytes += descriptor.bundleBytes;
          highBytes = Math.max(highBytes, bytes);
          queue.push({
            admittedAt,
            compileFinished: message.compileFinishedAt,
            compileStarted: message.compileStartedAt,
            descriptor,
          });
          queueHighCount = Math.max(queueHighCount, queue.length);
          handedOff = true;
          generationRows += 1;
          events.push({ index, laneId, stage: 'compile-handoff-acknowledged', at: Date.now() });
          signal();
        } catch (error) {
          if (!handedOff) {
            if (descriptor !== undefined)
              await removePreviewTsxCorpusSpool(descriptor).catch(() => undefined);
            releaseReservation();
          }
          if (
            error instanceof V12CompileDeadlineError ||
            (error instanceof V12CompileStageError && error.stage === 'compile')
          ) {
            let cleanupConfirmed = true;
            if (error instanceof V12CompileDeadlineError) {
              cleanupConfirmed = await compiler.abort(error.message);
              deadlineCleanups.push(cleanupConfirmed);
              retiredCompilerCleanups.push(cleanupConfirmed);
              if (!cleanupConfirmed)
                throw new Error(
                  `v12 timed-out compiler lane ${laneId.toString()} left an owned process group.`,
                );
              compiler = new V12CompilerProcess(context.runtimePath, laneId);
              compilerProcesses[laneId] = compiler;
              generation += 1;
              generationRows = 0;
            }
            if (terminal.has(index))
              throw new Error(`Duplicate v12 compile-failure terminal ${index.toString()}.`);
            const at = Date.now();
            terminal.add(index);
            finishedAt = at;
            rowFailures.push({
              category: 'runtime/build failure',
              cleanupConfirmed,
              deadline: error instanceof V12CompileDeadlineError,
              error: error.message.slice(0, 16_384),
              index,
              laneId,
              path: manifestRow(index).path,
            });
            const classification: V12RowClassification = {
              category: 'runtime/build failure',
              cleanupConfirmed,
              index,
              path: manifestRow(index).path,
              reason: error.message.slice(0, 2_000),
            };
            rowClassifications.push(classification);
            progressWriter.record(classification);
            events.push({ at, index, laneId, stage: 'compile-failure-terminal' });
            if (!(error instanceof V12CompileDeadlineError)) generationRows += 1;
            signal();
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      fail(error);
    } finally {
      try {
        compilerCleanups[laneId] = await compiler.shutdown();
        if (!compilerCleanups[laneId])
          fail(new Error(`v12 compiler lane ${laneId.toString()} left an owned process group.`));
      } catch (error) {
        fail(error);
      }
      compilersDone += 1;
      signal();
    }
  };
  const renderer = async (workerId: number): Promise<void> => {
    for (;;) {
      while (queue.length === 0 && compilersDone !== lanes && fatal === undefined) await wait();
      if (fatal !== undefined) return;
      const item = queue.shift();
      if (item === undefined) {
        if (compilersDone === lanes) return;
        continue;
      }
      try {
        const envelope = await readPreviewTsxCorpusSpool(item.descriptor, {
          attemptId: item.descriptor.attemptId,
          campaignId,
          candidate: `${lanes.toString()}x${renderSlots.toString()}`,
          engineDigest: context.engineDigest,
          generationId: item.descriptor.generationId,
          laneId: item.descriptor.laneId,
          policyDigest: context.policyDigest,
          row: item.descriptor.row,
          sourceDigest: item.descriptor.sourceDigest,
        });
        const start = Date.now();
        const result = await renderCompiledPreviewHeadlessly(envelope.bundle, envelope.request, {
          chromiumPath: context.chromiumPath,
          timeoutMs: 30_000,
          virtualTimeMs: 5_000,
        });
        const end = Date.now();
        renderIntervals.push([start, end]);
        const cleanupConfirmed =
          result.cleanup.browserTerminated &&
          result.cleanup.profileRemoved &&
          result.cleanup.serverClosed;
        if (!cleanupConfirmed)
          throw new Error(
            `v12 renderer cleanup failure for row ${item.descriptor.row.toString()}: ${JSON.stringify(result.cleanup)}`,
          );
        if (end > item.admittedAt + 90_000) {
          if (terminal.has(item.descriptor.row))
            throw new Error(
              `Duplicate v12 render-deadline terminal ${item.descriptor.row.toString()}.`,
            );
          terminal.add(item.descriptor.row);
          finishedAt = end;
          deadlineCleanups.push(true);
          rowFailures.push({
            category: 'runtime/build failure',
            cleanupConfirmed: true,
            deadline: true,
            error: 'The combined compile, spool, queue, and render path exceeded 90 seconds.',
            index: item.descriptor.row,
            path: manifestRow(item.descriptor.row).path,
            workerId,
          });
          const classification: V12RowClassification = {
            category: 'runtime/build failure',
            cleanupConfirmed: true,
            index: item.descriptor.row,
            path: manifestRow(item.descriptor.row).path,
            reason: 'The combined compile, spool, queue, and render path exceeded 90 seconds.',
          };
          rowClassifications.push(classification);
          progressWriter.record(classification);
          events.push({
            at: end,
            index: item.descriptor.row,
            stage: 'render-deadline-terminal',
            workerId,
          });
          await removePreviewTsxCorpusSpool(item.descriptor);
          bytes -= item.descriptor.bundleBytes;
          releaseReservation();
          continue;
        }
        if (terminal.has(item.descriptor.row))
          throw new Error(`Duplicate v12 durable terminal ${item.descriptor.row.toString()}.`);
        const classification = classifyHeadlessResult(
          result,
          manifestRow(item.descriptor.row),
          context.sourceRoot,
        );
        const durableClassification: V12RowClassification = {
          ...classification,
          cleanupConfirmed: true,
          index: item.descriptor.row,
          path: manifestRow(item.descriptor.row).path,
        };
        rowClassifications.push(durableClassification);
        progressWriter.record(durableClassification);
        terminal.add(item.descriptor.row);
        finishedAt = end;
        events.push({ index: item.descriptor.row, workerId, stage: 'durable-terminal', at: end });
        await removePreviewTsxCorpusSpool(item.descriptor);
        bytes -= item.descriptor.bundleBytes;
        releaseReservation();
      } catch (error) {
        await removePreviewTsxCorpusSpool(item.descriptor).catch(() => undefined);
        bytes = Math.max(0, bytes - item.descriptor.bundleBytes);
        releaseReservation();
        fail(error);
        return;
      }
    }
  };
  await Promise.all([
    ...Array.from({ length: renderSlots }, (_, workerId) => renderer(workerId)),
    ...Array.from({ length: lanes }, (_, laneId) => compilerLane(laneId)),
  ]);
  for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
    await removePreviewTsxCorpusSpool(item.descriptor).catch(() => undefined);
    bytes = Math.max(0, bytes - item.descriptor.bundleBytes);
    releaseReservation();
  }
  const progress = await progressWriter.finish();
  const finalRuntime = runtimeState();
  const elapsed = finishedAt === 0 ? 0 : Math.max(1, finishedAt - barrier);
  const rate = terminal.size === context.windowRows ? (context.windowRows * 60_000) / elapsed : 0;
  const wallElapsed = finishedAt === 0 ? 0 : Math.max(1, finishedAt - candidateStartedAt);
  const wallRate =
    terminal.size === context.windowRows ? (context.windowRows * 60_000) / wallElapsed : 0;
  const overlap = compilerIntervals.some(([a, b]) =>
    renderIntervals.some(([c, d]) => a < d && c < b),
  );
  const allCompilerCleanups =
    compilerCleanups.every(Boolean) && retiredCompilerCleanups.every(Boolean);
  const gates = {
    backpressure:
      highCount <= reservationLimit && highBytes <= PREVIEW_TSX_CORPUS_SPOOL_LIMIT_BYTES,
    cleanup: fatal === undefined && allCompilerCleanups,
    deadlines: deadlineCleanups.every(Boolean),
    identity: true,
    lifecycle:
      compilersDone === lanes &&
      queue.length === 0 &&
      bytes === 0 &&
      finalRuntime.reservations === 0 &&
      allCompilerCleanups,
    overlap,
    terminals: terminal.size === context.windowRows,
  };
  const status =
    Object.values(gates).every(Boolean) && rate >= FILTERED_MINIMUM_TERMINAL_RATE_PER_MINUTE
      ? 'selected'
      : Object.values(gates).every(Boolean)
        ? 'safe-sub-100'
        : 'failed';
  const classifications = [...rowClassifications].sort((left, right) => left.index - right.index);
  const categoryCounts = emptyPreviewTsxCorpusCategoryCounts();
  for (const classification of classifications) categoryCounts[classification.category] += 1;
  if (progress.terminalRows !== classifications.length) {
    throw new Error('v12 final classifications diverged from the durable progress journal.');
  }
  for (const category of Object.keys(categoryCounts) as PreviewTsxCorpusCategory[]) {
    if (progress.categoryCounts[category] !== categoryCounts[category]) {
      throw new Error(`v12 final category ${category} diverged from the durable progress journal.`);
    }
  }
  const report = {
    candidate: `${lanes.toString()}x${renderSlots.toString()}`,
    candidateStartedAt,
    categoryCounts,
    classifications,
    compilerIntervals,
    events,
    fatal:
      fatal instanceof Error
        ? { message: fatal.message, name: fatal.name, stack: fatal.stack }
        : fatal === undefined
          ? null
          : normalizeHeadlessEvidence(fatal),
    gates,
    measurementStartedAt: barrier,
    ratePerMinute: rate,
    renderIntervals,
    rowFailures,
    selection: context.selection,
    spool: {
      highBytes,
      highCount,
      limitBytes: PREVIEW_TSX_CORPUS_SPOOL_LIMIT_BYTES,
      limitCount: reservationLimit,
      queueHighCount,
    },
    status,
    terminalRows: terminal.size,
    wallElapsedMs: wallElapsed,
    wallRatePerMinute: wallRate,
    warmupElapsedMs: barrier - candidateStartedAt,
    warmupIntervals,
    version: 12 as const,
  };
  const terminalPath = path.join(context.root, 'candidate-terminal-report.json');
  const checksum = await writePreviewTsxCorpusJsonAtomic(terminalPath, report);
  await writePreviewTsxCorpusJsonAtomic(`${terminalPath}.checksum.json`, checksum);
  await readPreviewTsxCorpusChecksummedJson(terminalPath);
  return {
    candidate: report.candidate,
    gates,
    ratePerMinute: rate,
    status,
    terminalRows: terminal.size,
    version: 12,
  };
}
