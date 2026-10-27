/** Runs a single bounded worker attempt and records process ownership. */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY,
  type PreviewTsxCorpusAttemptKind,
  type PreviewTsxCorpusAttemptRecord,
  type PreviewTsxCorpusAttemptSpec,
  type PreviewTsxCorpusCleanupProof,
  type PreviewTsxCorpusProcessLifecycleEvent,
  type PreviewTsxCorpusStageEvent,
} from './previewHeadlessTsxCorpusCampaignTypes';
import {
  classifyCompilerStall,
  identifyInfrastructureReason,
} from './previewTsxCorpusClassification';
import {
  ledgerRecord,
  pad,
  parseDiagnosticHistory,
  parseWorkerResult,
  readJsonIfPresent,
  writeJsonAtomic,
  writeRawEvidence,
} from './previewTsxCorpusFiles';
import { probeOwnedGroupAbsent } from './previewTsxCorpusLane';
import type { CampaignState } from './previewTsxCorpusModel';
import { confirmNormalWorkerCleanup } from './previewTsxCorpusOwnership';
import { persistSynchronousSpawnFailure } from './previewTsxCorpusPersistence';
import { assertAttemptIdentity } from './previewTsxCorpusPreparation';

/** Executes one manifest row in an owned worker, captures bounded evidence, and returns its classified cleanup outcome. */
export async function runAttempt(
  state: CampaignState,
  index: number,
  attemptKind: PreviewTsxCorpusAttemptKind,
): Promise<PreviewTsxCorpusAttemptRecord> {
  const row = state.rows[index];
  if (row === undefined) throw new Error(`Manifest index ${index.toString()} is absent.`);
  const directory = path.join(state.options.artifacts, 'attempts', pad(index));
  const recordPath = path.join(directory, `${attemptKind}.json`);
  const existing = await readJsonIfPresent<PreviewTsxCorpusAttemptRecord>(recordPath);
  if (existing !== undefined) {
    assertAttemptIdentity(existing, state, index, attemptKind);
    await ledgerRecord(state, recordPath, 'attempt', index, attemptKind);
    return existing;
  }
  await mkdir(directory, { recursive: true });
  const spec: PreviewTsxCorpusAttemptSpec = {
    attemptKind,
    chromiumPath: state.options.chromiumPath,
    index,
    manifestSha256: state.identity.manifestSha256,
    row,
    sourceRoot: state.options.sourceRoot,
    workspace: state.options.workspace,
  };
  const encodedSpec = Buffer.from(JSON.stringify(spec)).toString('base64url');
  const started = Date.now();
  const startedMonotonic = performance.now();
  const startedAt = new Date(started).toISOString();
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(process.execPath, [state.options.runtimePath, '__worker', encodedSpec], {
      detached: process.platform !== 'win32',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    return persistSynchronousSpawnFailure(
      state,
      index,
      attemptKind,
      recordPath,
      row,
      started,
      startedAt,
      error,
    );
  }
  const elapsedMs = (): number => Math.round(performance.now() - startedMonotonic);
  const processLifecycle: PreviewTsxCorpusProcessLifecycleEvent[] = [];
  const recordProcess = (
    event: PreviewTsxCorpusProcessLifecycleEvent['event'],
    detail?: Readonly<Record<string, unknown>>,
  ): void => {
    processLifecycle.push({
      ...(detail === undefined ? {} : { detail }),
      elapsedMs: elapsedMs(),
      event,
      kind: 'parent-process',
      version: 3,
    });
  };
  const ownedPgid = process.platform === 'win32' ? undefined : child.pid;
  recordProcess('spawn-returned', {
    ...(child.pid === undefined ? {} : { pid: child.pid }),
    ...(ownedPgid === undefined ? {} : { pgid: ownedPgid }),
  });
  let spawnError: string | undefined;
  let exitResult:
    { readonly code: number | null; readonly signal: NodeJS.Signals | null } | undefined;
  let closeResult:
    { readonly code: number | null; readonly signal: NodeJS.Signals | null } | undefined;
  let lifecycleOrdinal = 0;
  let exitOrdinal: number | undefined;
  let closeOrdinal: number | undefined;
  const onChildError = (error: Error): void => {
    spawnError = error.message;
    recordProcess('child-error', { message: error.message.slice(0, 1_000) });
  };
  const onChildExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    exitResult = { code, signal };
    exitOrdinal = lifecycleOrdinal += 1;
    recordProcess('child-exit', { code, signal });
  };
  let resolveProcessResult:
    | ((value: { readonly code: number | null; readonly signal: NodeJS.Signals | null }) => void)
    | undefined;
  const onChildClose = (code: number | null, signal: NodeJS.Signals | null): void => {
    closeResult = { code, signal };
    closeOrdinal = lifecycleOrdinal += 1;
    recordProcess('child-close', { code, signal });
    resolveProcessResult?.({ code, signal });
  };
  const processResultPromise = new Promise<{
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
  }>((resolve) => {
    resolveProcessResult = resolve;
  });
  child.once('error', onChildError);
  child.once('exit', onChildExit);
  child.once('close', onChildClose);
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  const stages: Buffer[] = [];
  const stdoutStream = child.stdout;
  const stderrStream = child.stderr;
  const stageStream = child.stdio[3];
  let stdoutTerminal = stdoutStream === null;
  let stderrTerminal = stderrStream === null;
  let stageTerminal = stageStream === null || stageStream === undefined;
  const onStdoutData = (chunk: Buffer): void => {
    stdout.push(chunk);
  };
  const onStderrData = (chunk: Buffer): void => {
    stderr.push(chunk);
  };
  const onStageData = (chunk: Buffer): void => {
    stages.push(chunk);
  };
  const markStdoutTerminal = (): void => {
    if (stdoutTerminal) return;
    stdoutTerminal = true;
    recordProcess('stream-terminal', { stream: 'stdout' });
  };
  const markStderrTerminal = (): void => {
    if (stderrTerminal) return;
    stderrTerminal = true;
    recordProcess('stream-terminal', { stream: 'stderr' });
  };
  const markStageTerminal = (): void => {
    if (stageTerminal) return;
    stageTerminal = true;
    recordProcess('stream-terminal', { stream: 'fd3' });
  };
  if (stdoutStream !== null) {
    stdoutStream.on('data', onStdoutData);
    stdoutStream.once('close', markStdoutTerminal);
    stdoutStream.once('end', markStdoutTerminal);
    stdoutStream.once('error', markStdoutTerminal);
  }
  if (stderrStream !== null) {
    stderrStream.on('data', onStderrData);
    stderrStream.once('close', markStderrTerminal);
    stderrStream.once('end', markStderrTerminal);
    stderrStream.once('error', markStderrTerminal);
  }
  if (stageStream !== null && stageStream !== undefined) {
    stageStream.on('data', onStageData);
    stageStream.once('close', markStageTerminal);
    stageStream.once('end', markStageTerminal);
    stageStream.once('error', markStageTerminal);
  }
  const stdioSetupFailure = [stdoutStream, stderrStream, stageStream].some(
    (stream) => stream === null || stream === undefined,
  );
  let timedOut = false;
  let forcedTermination = false;
  let sigtermDelivered = false;
  let sigkillDelivered = false;
  let graceTimer: NodeJS.Timeout | undefined;
  const signalOwnedGroup = (signal: NodeJS.Signals): boolean => {
    if (ownedPgid === undefined) {
      recordProcess('group-signal', { delivered: false, error: 'missing-pgid', signal });
      return false;
    }
    try {
      process.kill(-ownedPgid, signal);
      recordProcess('group-signal', { delivered: true, pgid: ownedPgid, signal });
      return true;
    } catch (error) {
      recordProcess('group-signal', {
        delivered: false,
        error: error instanceof Error ? error.message.slice(0, 1_000) : String(error),
        pgid: ownedPgid,
        signal,
      });
      return false;
    }
  };
  const startGrace = (): void => {
    graceTimer = setTimeout(() => {
      recordProcess('grace-expired');
      forcedTermination = true;
      sigkillDelivered = signalOwnedGroup('SIGKILL');
    }, PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY.cleanupGraceMs);
  };
  if (stdioSetupFailure) {
    spawnError = 'Child process did not establish stdout, stderr, and fd3 stage streams.';
    recordProcess('child-error', { message: spawnError });
    sigtermDelivered = signalOwnedGroup('SIGTERM');
    startGrace();
  }
  const deadlineTimer = setTimeout(() => {
    timedOut = true;
    recordProcess('deadline-expired');
    sigtermDelivered = signalOwnedGroup('SIGTERM');
    startGrace();
  }, PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY.outerDeadlineMs);
  const processResult = await processResultPromise;
  clearTimeout(deadlineTimer);
  if (graceTimer !== undefined) clearTimeout(graceTimer);
  recordProcess('timers-cleared', { deadline: true, grace: true });
  child.removeListener('error', onChildError);
  child.removeListener('exit', onChildExit);
  child.removeListener('close', onChildClose);
  if (stdoutStream !== null) {
    stdoutStream.removeListener('data', onStdoutData);
    stdoutStream.removeListener('close', markStdoutTerminal);
    stdoutStream.removeListener('end', markStdoutTerminal);
    stdoutStream.removeListener('error', markStdoutTerminal);
  }
  if (stderrStream !== null) {
    stderrStream.removeListener('data', onStderrData);
    stderrStream.removeListener('close', markStderrTerminal);
    stderrStream.removeListener('end', markStderrTerminal);
    stderrStream.removeListener('error', markStderrTerminal);
  }
  if (stageStream !== null && stageStream !== undefined) {
    stageStream.removeListener('data', onStageData);
    stageStream.removeListener('close', markStageTerminal);
    stageStream.removeListener('end', markStageTerminal);
    stageStream.removeListener('error', markStageTerminal);
  }
  recordProcess('listeners-detached');
  const groupAbsentAfterClose = probeOwnedGroupAbsent(ownedPgid, recordProcess);
  const stdoutBuffer = Buffer.concat(stdout);
  const stderrBuffer = Buffer.concat([
    ...stderr,
    ...(spawnError === undefined ? [] : [Buffer.from(`${spawnError}\n`)]),
  ]);
  let stageBuffer = Buffer.concat(stages);
  if (spawnError !== undefined && stageBuffer.byteLength === 0) {
    const syntheticStage: PreviewTsxCorpusStageEvent = {
      detail: {
        parentSynthesized: true,
        processFailure: spawnError,
        ...(child.pid === undefined ? {} : { pid: child.pid }),
      },
      elapsedMs: Date.now() - started,
      index,
      kind: 'target-stage',
      path: row.path,
      stage: 'spawned',
      version: 3,
    };
    stageBuffer = Buffer.from(`${JSON.stringify(syntheticStage)}\n`);
  }
  const diagnostics = parseDiagnosticHistory(stageBuffer, row, index);
  const stageHistory = diagnostics.stageHistory;
  const result = parseWorkerResult(stdoutBuffer, row, index, state.options.sourceRoot);
  const normalWorkerCleanup = confirmNormalWorkerCleanup(stageHistory, result);
  // Take one typed snapshot after listener removal: callbacks own the mutable observations above.
  const observedTerminal: {
    readonly stdoutTerminal: boolean;
    readonly stderrTerminal: boolean;
    readonly stageTerminal: boolean;
    readonly exitOrdinal: number | undefined;
    readonly closeOrdinal: number | undefined;
    readonly sigtermDelivered: boolean;
    readonly sigkillDelivered: boolean;
    readonly forcedTermination: boolean;
    readonly spawnError: string | undefined;
    readonly exitResult:
      { readonly code: number | null; readonly signal: NodeJS.Signals | null } | undefined;
    readonly closeResult:
      { readonly code: number | null; readonly signal: NodeJS.Signals | null } | undefined;
  } = {
    stdoutTerminal,
    stderrTerminal,
    stageTerminal,
    exitOrdinal,
    closeOrdinal,
    sigtermDelivered,
    sigkillDelivered,
    exitResult,
    closeResult,
    spawnError,
    forcedTermination,
  };
  const streamsTerminal =
    observedTerminal.stdoutTerminal &&
    observedTerminal.stderrTerminal &&
    observedTerminal.stageTerminal;
  const childExitBeforeClose =
    observedTerminal.exitOrdinal !== undefined &&
    observedTerminal.closeOrdinal !== undefined &&
    observedTerminal.exitOrdinal < observedTerminal.closeOrdinal;
  const preRenderCompileStarted = stageHistory.some((event) => event.stage === 'compile-started');
  const preRenderOnly = !stageHistory.some((event) => event.stage === 'render-started');
  const timersCleared = processLifecycle.some((event) => event.event === 'timers-cleared');
  const listenersDetached = processLifecycle.some((event) => event.event === 'listeners-detached');
  const strictParentForcedCleanup =
    !normalWorkerCleanup &&
    preRenderCompileStarted &&
    preRenderOnly &&
    ownedPgid !== undefined &&
    observedTerminal.forcedTermination &&
    observedTerminal.sigtermDelivered &&
    observedTerminal.sigkillDelivered &&
    observedTerminal.exitResult !== undefined &&
    observedTerminal.closeResult !== undefined &&
    childExitBeforeClose &&
    streamsTerminal &&
    timersCleared &&
    listenersDetached &&
    groupAbsentAfterClose;
  const cleanupProof: PreviewTsxCorpusCleanupProof = {
    childCloseObserved: observedTerminal.closeResult !== undefined,
    childExitBeforeClose,
    forcedGroupTermination: observedTerminal.forcedTermination && observedTerminal.sigkillDelivered,
    groupAbsentAfterClose,
    listenersDetached,
    normalWorkerCleanup,
    ...(ownedPgid === undefined ? {} : { ownedPgid }),
    preRenderCompileStarted,
    preRenderOnly,
    streamsTerminal,
    strictParentForcedCleanup,
    timersCleared,
  };
  const cleanupConfirmed =
    normalWorkerCleanup ||
    strictParentForcedCleanup ||
    (observedTerminal.spawnError !== undefined && child.pid === undefined && streamsTerminal);
  const raw = await writeRawEvidence(
    state.options.artifacts,
    index,
    attemptKind,
    stdoutBuffer,
    stderrBuffer,
    stageBuffer,
  );
  const infrastructureReason = identifyInfrastructureReason({
    cleanupConfirmed,
    ...(result === undefined ? {} : { result }),
    stageHistory,
    stderr: stderrBuffer.toString('utf8'),
    timedOut,
    protocolValid: diagnostics.valid,
  });
  const stallClassification = classifyCompilerStall(
    timedOut,
    stageHistory,
    diagnostics.compilerProgress,
    diagnostics.workerLifecycle,
  );
  const lastStage = stageHistory.at(-1)?.stage;
  const record: PreviewTsxCorpusAttemptRecord = {
    attemptKind,
    cleanupConfirmed,
    cleanupProof,
    compilerProgress: diagnostics.compilerProgress,
    deadlineMs: 90000,
    diagnosticProtocolValid: diagnostics.valid,
    durationMs: Date.now() - started,
    endedAt: new Date().toISOString(),
    exitCode: processResult.code,
    exitSignal: processResult.signal,
    forcedTermination: observedTerminal.forcedTermination,
    index,
    ...(infrastructureReason === undefined ? {} : { infrastructureReason }),
    kind: 'attempt',
    ...(lastStage === undefined ? {} : { lastStage }),
    path: row.path,
    policyDigest: state.identity.policyDigest,
    processLifecycle,
    raw,
    ...(result === undefined ? {} : { result }),
    stageHistory,
    ...(stallClassification === undefined ? {} : { stallClassification }),
    startedAt,
    timedOut,
    version: 3,
    workerLifecycle: diagnostics.workerLifecycle,
  };
  await writeJsonAtomic(recordPath, record);
  await ledgerRecord(state, recordPath, 'attempt', index, attemptKind);
  return record;
}
