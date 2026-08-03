import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import type { PreviewHeadlessResult } from './previewHeadlessRenderer';
import {
  PREVIEW_TSX_CORPUS_CLASSIFIER_VERSION,
  PREVIEW_TSX_CORPUS_STAGE_PROTOCOL_VERSION,
  PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY,
  type PreviewTsxCorpusAttemptKind,
  type PreviewTsxCorpusAttemptRecord,
  type PreviewTsxCorpusAttemptSpec,
  type PreviewTsxCorpusCanonicalRecord,
  type PreviewTsxCorpusCategory,
  type PreviewTsxCorpusCleanupProof,
  type PreviewTsxCorpusCompilerEvent,
  type PreviewTsxCorpusDiagnosticEvent,
  type PreviewTsxCorpusManifestRow,
  type PreviewTsxCorpusProcessLifecycleEvent,
  type PreviewTsxCorpusStageEvent,
  type PreviewTsxCorpusWorkerLifecycleEvent,
  type PreviewTsxCorpusWorkerResult,
} from './previewHeadlessTsxCorpusCampaignTypes';

interface CampaignOptions {
  readonly artifacts: string;
  readonly chromiumPath: string;
  readonly manifestPath: string;
  readonly maxRows?: number;
  readonly phase: 'baseline' | 'final';
  readonly runtimePath: string;
  readonly sourceRoot: string;
  readonly workspace: string;
}

interface CampaignIdentity {
  readonly classifierDigest: string;
  readonly engineDigest: string;
  readonly manifestSha256: string;
  readonly phase: 'baseline' | 'final';
  readonly policyDigest: string;
  readonly sourceRoot: string;
  readonly version: 1;
  readonly workspace: string;
}

interface CampaignState {
  readonly identity: CampaignIdentity;
  readonly ledgerDigests: Set<string>;
  readonly options: CampaignOptions;
  readonly rows: readonly PreviewTsxCorpusManifestRow[];
}

/** Runs or resumes a frozen jobs-3 corpus campaign with a jobs-1 isolated fallback. */
export async function runPreviewHeadlessTsxCorpusCampaign(
  options: CampaignOptions,
): Promise<void> {
  const state = await prepareCampaign(options);
  const limit = Math.min(options.maxRows ?? state.rows.length, state.rows.length);
  let cursor = 0;
  while (cursor < limit) {
    const batch: number[] = [];
    while (cursor < limit && batch.length < PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY.primaryJobs) {
      if (!(await canonicalExists(state, cursor))) batch.push(cursor);
      cursor += 1;
    }
    if (batch.length === 0) continue;
    const primaryAttempts = await Promise.all(
      batch.map(async (index) => runAttempt(state, index, 'primary')),
    );
    const isolation: Array<{ index: number; primary: PreviewTsxCorpusAttemptRecord }> = [];
    for (let offset = 0; offset < batch.length; offset += 1) {
      const index = batch[offset];
      const primary = primaryAttempts[offset];
      if (index === undefined || primary === undefined) throw new Error('Primary batch lost identity.');
      if (attemptRequiresIsolation(primary)) isolation.push({ index, primary });
      else await writeCanonical(state, index, [primary]);
    }
    for (const pending of isolation.sort((left, right) => left.index - right.index)) {
      const isolated = await runAttempt(state, pending.index, 'isolated');
      if (!isolatedCanBecomeCanonical(isolated)) {
        throw new Error(
          `Isolated infrastructure outcome left ${state.rows[pending.index]?.path ?? pending.index} unclassified: ${isolated.infrastructureReason ?? isolated.lastStage ?? 'no target evidence'}`,
        );
      }
      await writeCanonical(state, pending.index, [pending.primary, isolated]);
    }
    await writeSummary(state, limit);
  }
  if (options.maxRows !== undefined) await commitStagedCanonicals(state, limit);
  await writeSummary(state, limit);
}

async function prepareCampaign(options: CampaignOptions): Promise<CampaignState> {
  await mkdir(options.artifacts, { recursive: true });
  const manifestSource = await readFile(options.manifestPath, 'utf8');
  const rows = parseManifest(manifestSource);
  const manifestSha256 = digest(manifestSource);
  const runtimeSource = await readFile(options.runtimePath);
  const engineDigest = digest(runtimeSource);
  const classifierDigest = digestJson({
    classifierVersion: PREVIEW_TSX_CORPUS_CLASSIFIER_VERSION,
    categories: [
      'successful meaningful render',
      'blocker',
      'Unrendered',
      'blank/empty output',
      'incomplete page composition',
      'runtime/build failure',
      'explicitly structurally non-renderable',
    ],
  });
  const policyDigest = digestJson({
    ...PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY,
    stageProtocolVersion: PREVIEW_TSX_CORPUS_STAGE_PROTOCOL_VERSION,
  });
  const campaignArtifacts = path.join(options.artifacts, 'campaigns', engineDigest);
  const campaignOptions = { ...options, artifacts: campaignArtifacts };
  await Promise.all(
    ['attempts', 'canonical', 'canonical-staging', 'raw'].map(async (name) =>
      mkdir(path.join(campaignArtifacts, name), { recursive: true }),
    ),
  );
  const identity: CampaignIdentity = {
    classifierDigest,
    engineDigest,
    manifestSha256,
    phase: options.phase,
    policyDigest,
    sourceRoot: path.resolve(options.sourceRoot),
    version: 1,
    workspace: path.resolve(options.workspace),
  };
  await assertOrWriteIdentity(campaignArtifacts, identity);
  await writeJsonAtomic(path.join(options.artifacts, 'active-campaign.json'), {
    artifacts: path.relative(options.artifacts, campaignArtifacts),
    engineDigest,
    phase: options.phase,
    policyDigest,
    version: 1,
  });
  const ledgerPath = path.join(campaignArtifacts, 'ledger.jsonl');
  const ledgerDigests = await readLedgerDigests(ledgerPath);
  return { identity, ledgerDigests, options: campaignOptions, rows };
}

async function runAttempt(
  state: CampaignState,
  index: number,
  attemptKind: PreviewTsxCorpusAttemptKind,
): Promise<PreviewTsxCorpusAttemptRecord> {
  const row = state.rows[index];
  if (row === undefined) throw new Error(`Manifest index ${index} is absent.`);
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
      version: 2,
    });
  };
  const ownedPgid = process.platform === 'win32' ? undefined : child.pid;
  recordProcess('spawn-returned', {
    ...(child.pid === undefined ? {} : { pid: child.pid }),
    ...(ownedPgid === undefined ? {} : { pgid: ownedPgid }),
  });
  let spawnError: string | undefined;
  let exitResult:
    | { readonly code: number | null; readonly signal: NodeJS.Signals | null }
    | undefined;
  let closeResult:
    | { readonly code: number | null; readonly signal: NodeJS.Signals | null }
    | undefined;
  let lifecycleOrdinal = 0;
  let exitOrdinal: number | undefined;
  let closeOrdinal: number | undefined;
  const onChildError = (error: Error): void => {
    spawnError = error.message;
    recordProcess('child-error', { message: error.message.slice(0, 1_000) });
  };
  const onChildExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    exitResult = { code, signal };
    exitOrdinal = (lifecycleOrdinal += 1);
    recordProcess('child-exit', { code, signal });
  };
  let resolveProcessResult:
    | ((value: { readonly code: number | null; readonly signal: NodeJS.Signals | null }) => void)
    | undefined;
  const onChildClose = (code: number | null, signal: NodeJS.Signals | null): void => {
    closeResult = { code, signal };
    closeOrdinal = (lifecycleOrdinal += 1);
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
  let stdoutTerminal = stdoutStream === null || stdoutStream === undefined;
  let stderrTerminal = stderrStream === null || stderrStream === undefined;
  let stageTerminal = stageStream === null || stageStream === undefined;
  const onStdoutData = (chunk: Buffer): void => stdout.push(chunk);
  const onStderrData = (chunk: Buffer): void => stderr.push(chunk);
  const onStageData = (chunk: Buffer): void => stages.push(chunk);
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
  if (stdoutStream !== null && stdoutStream !== undefined) {
    stdoutStream.on('data', onStdoutData);
    stdoutStream.once('close', markStdoutTerminal);
    stdoutStream.once('end', markStdoutTerminal);
    stdoutStream.once('error', markStdoutTerminal);
  }
  if (stderrStream !== null && stderrStream !== undefined) {
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
  if (stdoutStream !== null && stdoutStream !== undefined) {
    stdoutStream.removeListener('data', onStdoutData);
    stdoutStream.removeListener('close', markStdoutTerminal);
    stdoutStream.removeListener('end', markStdoutTerminal);
    stdoutStream.removeListener('error', markStdoutTerminal);
  }
  if (stderrStream !== null && stderrStream !== undefined) {
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
      version: 2,
    };
    stageBuffer = Buffer.from(`${JSON.stringify(syntheticStage)}\n`);
  }
  const diagnostics = parseDiagnosticHistory(stageBuffer, row, index);
  const stageHistory = diagnostics.stageHistory;
  const result = parseWorkerResult(stdoutBuffer, row, index, state.options.sourceRoot);
  const normalWorkerCleanup = confirmNormalWorkerCleanup(stageHistory, result);
  const streamsTerminal = stdoutTerminal && stderrTerminal && stageTerminal;
  const childExitBeforeClose =
    exitOrdinal !== undefined && closeOrdinal !== undefined && exitOrdinal < closeOrdinal;
  const preRenderCompileStarted = stageHistory.some((event) => event.stage === 'compile-started');
  const preRenderOnly = !stageHistory.some((event) => event.stage === 'render-started');
  const timersCleared = processLifecycle.some((event) => event.event === 'timers-cleared');
  const listenersDetached = processLifecycle.some((event) => event.event === 'listeners-detached');
  const strictParentForcedCleanup =
    !normalWorkerCleanup &&
    preRenderCompileStarted &&
    preRenderOnly &&
    ownedPgid !== undefined &&
    forcedTermination &&
    sigtermDelivered &&
    sigkillDelivered &&
    exitResult !== undefined &&
    closeResult !== undefined &&
    childExitBeforeClose &&
    streamsTerminal &&
    timersCleared &&
    listenersDetached &&
    groupAbsentAfterClose;
  const cleanupProof: PreviewTsxCorpusCleanupProof = {
    childCloseObserved: closeResult !== undefined,
    childExitBeforeClose,
    forcedGroupTermination: forcedTermination && sigkillDelivered,
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
    (spawnError !== undefined && child.pid === undefined && streamsTerminal);
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
    result,
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
    forcedTermination,
    index,
    ...(infrastructureReason === undefined ? {} : { infrastructureReason }),
    kind: 'attempt',
    ...(stageHistory.at(-1) === undefined ? {} : { lastStage: stageHistory.at(-1)?.stage }),
    path: row.path,
    policyDigest: state.identity.policyDigest,
    processLifecycle,
    raw,
    ...(result === undefined ? {} : { result }),
    stageHistory,
    ...(stallClassification === undefined ? {} : { stallClassification }),
    startedAt,
    timedOut,
    version: 2,
    workerLifecycle: diagnostics.workerLifecycle,
  };
  await writeJsonAtomic(recordPath, record);
  await ledgerRecord(state, recordPath, 'attempt', index, attemptKind);
  return record;
}

async function persistSynchronousSpawnFailure(
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
    version: 2,
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
      version: 2,
    },
    {
      elapsedMs: Date.now() - started,
      event: 'timers-cleared',
      kind: 'parent-process',
      version: 2,
    },
    {
      elapsedMs: Date.now() - started,
      event: 'listeners-detached',
      kind: 'parent-process',
      version: 2,
    },
    {
      detail: { absent: true, reason: 'spawn-threw-before-pgid' },
      elapsedMs: Date.now() - started,
      event: 'group-probe',
      kind: 'parent-process',
      version: 2,
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
    version: 2,
    workerLifecycle: [],
  };
  await writeJsonAtomic(recordPath, record);
  await ledgerRecord(state, recordPath, 'attempt', index, attemptKind);
  return record;
}

function attemptRequiresIsolation(attempt: PreviewTsxCorpusAttemptRecord): boolean {
  return (
    attempt.result === undefined ||
    attempt.timedOut ||
    !attempt.cleanupConfirmed ||
    attempt.infrastructureReason !== undefined
  );
}

function isolatedCanBecomeCanonical(attempt: PreviewTsxCorpusAttemptRecord): boolean {
  if (!attempt.cleanupConfirmed || attempt.infrastructureReason !== undefined) return false;
  if (attempt.result !== undefined) return true;
  return (
    attempt.timedOut &&
    attempt.stageHistory.some((event) =>
      ['compile-started', 'render-started'].includes(event.stage),
    )
  );
}

async function writeCanonical(
  state: CampaignState,
  index: number,
  attempts: readonly PreviewTsxCorpusAttemptRecord[],
): Promise<void> {
  const row = state.rows[index];
  if (row === undefined) throw new Error(`Manifest index ${index} is absent.`);
  const recordPath = canonicalRecordPath(state, index);
  if (await fileExists(recordPath)) return;
  const terminal = attempts.at(-1);
  if (terminal === undefined) throw new Error(`Canonical row ${row.path} has no attempt lineage.`);
  const classification = classifyCanonical(terminal, row, state.options.sourceRoot);
  const attemptLinks = await Promise.all(
    attempts.map(async (attempt) => ({
      attemptKind: attempt.attemptKind,
      attemptRecordSha256: digest(
        await readFile(
          path.join(
            state.options.artifacts,
            'attempts',
            pad(index),
            `${attempt.attemptKind}.json`,
          ),
        ),
      ),
    })),
  );
  const record: PreviewTsxCorpusCanonicalRecord = {
    attempts: attemptLinks,
    category: classification.category,
    classifierDigest: state.identity.classifierDigest,
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
}

function classifyCanonical(
  attempt: PreviewTsxCorpusAttemptRecord,
  row: PreviewTsxCorpusManifestRow,
  sourceRoot: string,
): { readonly category: PreviewTsxCorpusCategory; readonly reason: string } {
  if (attempt.result === undefined) {
    const lastCompiler = attempt.compilerProgress.at(-1);
    const nativeActivity =
      lastCompiler?.activity?.kind === 'native-build' ? lastCompiler.activity : undefined;
    return {
      category: 'runtime/build failure',
      reason: `isolated ${attempt.lastStage ?? 'unknown-stage'} outer deadline at 90000 ms with confirmed cleanup; stall=${attempt.stallClassification ?? 'unclassified'}; lastCompiler=${lastCompiler?.stage ?? 'none'}${nativeActivity === undefined ? '' : `/${nativeActivity.phase}/pass-${nativeActivity.pass.toString()}`}`,
    };
  }
  if (attempt.result.kind === 'compile-or-render-failure') {
    return {
      category: 'runtime/build failure',
      reason: `${attempt.result.errorName ?? 'Error'}: ${attempt.result.error ?? 'target-bound compile/render failure'}`.slice(0, 2_000),
    };
  }
  const result = attempt.result.headless;
  if (result === undefined) {
    return { category: 'runtime/build failure', reason: 'target-bound worker result omitted headless evidence' };
  }
  const composition = result.stabilization?.compositionSnapshot;
  const errorEvidence =
    result.status !== 'ready' ||
    result.protocolError !== undefined ||
    result.runtimeErrorText !== undefined ||
    result.evidence.windowErrors.length > 0 ||
    (result.evidence.cdpExceptions?.length ?? 0) > 0 ||
    (result.evidence.requiredArtifactFailures?.length ?? 0) > 0 ||
    composition?.targetError === true;
  if (errorEvidence) {
    return {
      category: 'runtime/build failure',
      reason: String(
        result.protocolError ??
          result.runtimeErrorText ??
          result.evidence.windowErrors.at(0) ??
          result.evidence.cdpExceptions?.at(0) ??
          `headless status ${result.status}`,
      ).slice(0, 2_000),
    };
  }
  if (result.rootHtml.includes('Unrendered')) {
    return { category: 'Unrendered', reason: 'captured target output contains the explicit Unrendered sentinel' };
  }
  if (
    /no direct default or PascalCase component exports to preview/iu.test(result.rootHtml) &&
    composition?.targetMounted === false &&
    composition.targetHasOutput === false
  ) {
    return {
      category: 'explicitly structurally non-renderable',
      reason: 'compiler export evidence proves no direct default or PascalCase component export',
    };
  }
  if ((composition?.activeBlockers ?? 0) > 0) {
    return {
      category: 'blocker',
      reason: `active blocker: ${composition?.activeBlockerProvenance.at(0)?.kind ?? 'unknown'}`,
    };
  }
  if (
    result.rootHtml.trim().length === 0 ||
    result.stabilizedOutcome === 'ready-empty' ||
    composition?.targetRenderedEmpty === true
  ) {
    return { category: 'blank/empty output', reason: 'settled capture contains no target-owned visible output' };
  }
  const exactTarget = targetSourceIsExact(composition?.targetSourcePath, row.path, sourceRoot);
  const fidelity = composition?.pageExecutionFidelity ?? 'none';
  const strictSuccess =
    result.stabilizedOutcome === 'ready' &&
    exactTarget &&
    fidelity !== 'none' &&
    fidelity !== 'target-only' &&
    composition?.targetExportName.trim().length !== 0 &&
    composition.targetPageRootCommitted &&
    composition.targetMounted &&
    composition.targetHasOutput &&
    composition.currentFileMounted > 0 &&
    composition.hostOutput > 0 &&
    composition.requirementSearchSettled &&
    result.stabilization?.postTerminalSnapshotReceived === true &&
    result.stabilization.quiet &&
    !result.stabilization.capReached &&
    !composition.criticalEvidenceTruncated;
  if (strictSuccess) {
    return {
      category: 'successful meaningful render',
      reason: `strict target-owned ${fidelity} Page Context render`,
    };
  }
  return {
    category: 'incomplete page composition',
    reason: `non-strict composition: outcome=${result.stabilizedOutcome ?? 'none'}, fidelity=${fidelity}, stage=${composition?.targetStage ?? 'none'}`,
  };
}

function identifyInfrastructureReason(input: {
  readonly cleanupConfirmed: boolean;
  readonly protocolValid: boolean;
  readonly result?: PreviewTsxCorpusWorkerResult;
  readonly stageHistory: readonly PreviewTsxCorpusStageEvent[];
  readonly stderr: string;
  readonly timedOut: boolean;
}): string | undefined {
  if (!input.protocolValid) return 'diagnostic-protocol-invalid';
  if (!input.cleanupConfirmed) return 'cleanup-unconfirmed';
  if (input.result === undefined) {
    if (
      input.timedOut &&
      input.stageHistory.some((event) =>
        ['compile-started', 'render-started'].includes(event.stage),
      )
    ) {
      return undefined;
    }
    return input.timedOut ? 'outer-timeout-without-result' : 'worker-exited-without-result';
  }
  if (input.result.kind === 'compile-or-render-failure') {
    if (!input.stageHistory.some((event) => event.stage === 'compile-started')) {
      return 'failure-before-compile-started';
    }
    if (/esbuild JavaScript API cannot be bundled|Cannot find package ['"]esbuild|ERR_MODULE_NOT_FOUND/iu.test(input.result.error ?? '')) {
      return 'native-esbuild-bootstrap-failure';
    }
    return undefined;
  }
  const protocolError = input.result.headless?.protocolError ?? '';
  if (/listen EPERM|No local Chromium executable|CDP pipe descriptors|spawn .*ENOENT/iu.test(protocolError)) {
    return `shared-headless-infrastructure: ${protocolError.slice(0, 500)}`;
  }
  return undefined;
}

function confirmNormalWorkerCleanup(
  stages: readonly PreviewTsxCorpusStageEvent[],
  result: PreviewTsxCorpusWorkerResult | undefined,
): boolean {
  if (!stages.some((event) => event.stage === 'cleanup-finished')) return false;
  const cleanup = result?.headless?.cleanup;
  return cleanup === undefined
    ? true
    : cleanup.browserTerminated && cleanup.profileRemoved && cleanup.serverClosed;
}

function classifyCompilerStall(
  timedOut: boolean,
  stages: readonly PreviewTsxCorpusStageEvent[],
  compilerProgress: readonly PreviewTsxCorpusCompilerEvent[],
  workerLifecycle: readonly PreviewTsxCorpusWorkerLifecycleEvent[],
): PreviewTsxCorpusAttemptRecord['stallClassification'] | undefined {
  if (stages.some((event) => event.stage === 'compile-finished')) {
    return 'normal-compiler-completion';
  }
  if (!timedOut || !stages.some((event) => event.stage === 'compile-started')) return undefined;
  const nativeBuildStarted = compilerProgress.some((event) => event.activity?.kind === 'native-build');
  const signalAcknowledged = workerLifecycle.some((event) => event.event === 'signal-received');
  if (nativeBuildStarted) {
    return signalAcknowledged
      ? 'event-loop-responsive-native-or-shutdown-wait'
      : 'same-thread-plugin-blockage-during-native-build';
  }
  return signalAcknowledged
    ? 'event-loop-responsive-pre-native-wait'
    : 'pre-native-same-thread-blockage';
}

async function writeRawEvidence(
  artifacts: string,
  index: number,
  attemptKind: PreviewTsxCorpusAttemptKind,
  stdout: Buffer,
  stderr: Buffer,
  stages: Buffer,
): Promise<PreviewTsxCorpusAttemptRecord['raw']> {
  const directory = path.join(artifacts, 'raw', pad(index));
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeBufferAtomic(path.join(directory, `${attemptKind}.stdout`), stdout),
    writeBufferAtomic(path.join(directory, `${attemptKind}.stderr`), stderr),
    writeBufferAtomic(path.join(directory, `${attemptKind}.stages.jsonl`), stages),
  ]);
  return {
    stages: { bytes: stages.byteLength, sha256: digest(stages) },
    stderr: { bytes: stderr.byteLength, sha256: digest(stderr) },
    stdout: { bytes: stdout.byteLength, sha256: digest(stdout) },
  };
}

function parseDiagnosticHistory(
  source: Buffer,
  row: PreviewTsxCorpusManifestRow,
  index: number,
): {
  readonly compilerProgress: readonly PreviewTsxCorpusCompilerEvent[];
  readonly stageHistory: readonly PreviewTsxCorpusStageEvent[];
  readonly valid: boolean;
  readonly workerLifecycle: readonly PreviewTsxCorpusWorkerLifecycleEvent[];
} {
  const compilerProgress: PreviewTsxCorpusCompilerEvent[] = [];
  const stageHistory: PreviewTsxCorpusStageEvent[] = [];
  const workerLifecycle: PreviewTsxCorpusWorkerLifecycleEvent[] = [];
  const lines = source.toString('utf8').split('\n').filter(Boolean);
  if (lines.length > 512) {
    return { compilerProgress, stageHistory, valid: false, workerLifecycle };
  }
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as PreviewTsxCorpusDiagnosticEvent;
      if (event.index !== index || event.path !== row.path || event.version !== 2) {
        return { compilerProgress, stageHistory, valid: false, workerLifecycle };
      }
      if (event.kind === 'target-stage') stageHistory.push(event);
      else if (event.kind === 'compiler-progress') compilerProgress.push(event);
      else if (event.kind === 'worker-lifecycle') workerLifecycle.push(event);
      else return { compilerProgress, stageHistory, valid: false, workerLifecycle };
    } catch {
      return { compilerProgress, stageHistory, valid: false, workerLifecycle };
    }
  }
  return { compilerProgress, stageHistory, valid: true, workerLifecycle };
}

function parseWorkerResult(
  source: Buffer,
  row: PreviewTsxCorpusManifestRow,
  index: number,
  sourceRoot: string,
): PreviewTsxCorpusWorkerResult | undefined {
  const lines = source.toString('utf8').trim().split('\n').filter(Boolean);
  if (lines.length !== 1) return undefined;
  try {
    const result = JSON.parse(lines[0] ?? '') as PreviewTsxCorpusWorkerResult;
    const expectedPath = path.resolve(sourceRoot, row.path);
    if (
      result.version !== 2 ||
      result.index !== index ||
      result.path !== row.path ||
      path.resolve(result.documentPath) !== expectedPath
    ) {
      return undefined;
    }
    return result;
  } catch {
    return undefined;
  }
}

function parseManifest(source: string): readonly PreviewTsxCorpusManifestRow[] {
  const rows = source.trimEnd().split('\n').map((line) => JSON.parse(line) as PreviewTsxCorpusManifestRow);
  if (rows.length === 0) throw new Error('Corpus manifest is empty.');
  const paths = rows.map((row) => row.path);
  const sorted = [...paths].sort();
  if (new Set(paths).size !== paths.length || paths.some((value, index) => value !== sorted[index])) {
    throw new Error('Corpus manifest paths must be unique and sorted.');
  }
  return rows;
}

async function canonicalExists(state: CampaignState, index: number): Promise<boolean> {
  const recordPath = canonicalRecordPath(state, index);
  const record = await readJsonIfPresent<PreviewTsxCorpusCanonicalRecord>(recordPath);
  if (record === undefined) return false;
  const row = state.rows[index];
  if (
    row === undefined ||
    record.index !== index ||
    record.path !== row.path ||
    record.sha256 !== row.sha256 ||
    record.manifestSha256 !== state.identity.manifestSha256 ||
    record.engineDigest !== state.identity.engineDigest ||
    record.classifierDigest !== state.identity.classifierDigest ||
    record.policyDigest !== state.identity.policyDigest
  ) {
    throw new Error(`Canonical identity mismatch at manifest index ${index}.`);
  }
  if (state.options.maxRows === undefined) {
    await ledgerRecord(state, recordPath, 'canonical', index);
  }
  return true;
}

async function commitStagedCanonicals(state: CampaignState, limit: number): Promise<void> {
  const staged: Array<{ readonly index: number; readonly record: PreviewTsxCorpusCanonicalRecord }> = [];
  for (let index = 0; index < limit; index += 1) {
    const record = await readJsonIfPresent<PreviewTsxCorpusCanonicalRecord>(
      path.join(state.options.artifacts, 'canonical-staging', `${pad(index)}.json`),
    );
    if (record === undefined) {
      throw new Error(`Gate cannot promote with missing canonical candidate at index ${index}.`);
    }
    staged.push({ index, record });
  }
  for (const candidate of staged) {
    const recordPath = path.join(
      state.options.artifacts,
      'canonical',
      `${pad(candidate.index)}.json`,
    );
    if (!(await fileExists(recordPath))) await writeJsonAtomic(recordPath, candidate.record);
    await ledgerRecord(state, recordPath, 'canonical', candidate.index);
  }
}

function canonicalRecordPath(state: CampaignState, index: number): string {
  return path.join(
    state.options.artifacts,
    state.options.maxRows === undefined ? 'canonical' : 'canonical-staging',
    `${pad(index)}.json`,
  );
}

async function writeSummary(state: CampaignState, limit: number): Promise<void> {
  const totals: Record<PreviewTsxCorpusCategory, number> = {
    Unrendered: 0,
    'blank/empty output': 0,
    blocker: 0,
    'explicitly structurally non-renderable': 0,
    'incomplete page composition': 0,
    'runtime/build failure': 0,
    'successful meaningful render': 0,
  };
  let canonical = 0;
  let isolatedAttempts = 0;
  let primaryAttempts = 0;
  for (let index = 0; index < limit; index += 1) {
    const record = await readJsonIfPresent<PreviewTsxCorpusCanonicalRecord>(
      path.join(state.options.artifacts, 'canonical', `${pad(index)}.json`),
    );
    if (record !== undefined) {
      canonical += 1;
      totals[record.category] += 1;
    }
    if (await fileExists(path.join(state.options.artifacts, 'attempts', pad(index), 'primary.json'))) {
      primaryAttempts += 1;
    }
    if (await fileExists(path.join(state.options.artifacts, 'attempts', pad(index), 'isolated.json'))) {
      isolatedAttempts += 1;
    }
  }
  await writeJsonAtomic(path.join(state.options.artifacts, 'summary.json'), {
    canonical,
    isolatedAttempts,
    limit,
    pending: limit - canonical,
    policyDigest: state.identity.policyDigest,
    primaryAttempts,
    totals,
    version: 1,
  });
}

async function ledgerRecord(
  state: CampaignState,
  recordPath: string,
  kind: 'attempt' | 'canonical',
  index: number,
  attemptKind?: PreviewTsxCorpusAttemptKind,
): Promise<void> {
  const source = await readFile(recordPath);
  const recordSha256 = digest(source);
  if (state.ledgerDigests.has(recordSha256)) return;
  await appendFile(
    path.join(state.options.artifacts, 'ledger.jsonl'),
    `${JSON.stringify({ attemptKind, index, kind, recordSha256, version: 1 })}\n`,
  );
  state.ledgerDigests.add(recordSha256);
}

async function assertOrWriteIdentity(
  artifacts: string,
  identity: CampaignIdentity,
): Promise<void> {
  const filePath = path.join(artifacts, 'identity.json');
  const existing = await readJsonIfPresent<CampaignIdentity>(filePath);
  if (existing === undefined) {
    await writeJsonAtomic(filePath, identity);
    return;
  }
  if (digestJson(existing) !== digestJson(identity)) {
    if (await directoryHasEntries(path.join(artifacts, 'canonical'))) {
      throw new Error('Campaign identity does not match the immutable existing artifact phase.');
    }
    await writeJsonAtomic(
      path.join(artifacts, `identity-precanonical-${existing.engineDigest}.json`),
      existing,
    );
    await writeJsonAtomic(filePath, identity);
  }
}

function assertAttemptIdentity(
  record: PreviewTsxCorpusAttemptRecord,
  state: CampaignState,
  index: number,
  attemptKind: PreviewTsxCorpusAttemptKind,
): void {
  const row = state.rows[index];
  if (
    row === undefined ||
    record.index !== index ||
    record.path !== row.path ||
    record.attemptKind !== attemptKind ||
    record.policyDigest !== state.identity.policyDigest ||
    record.deadlineMs !== 90000 ||
    record.version !== 2
  ) {
    throw new Error(`Attempt identity mismatch at manifest index ${index}.`);
  }
}

function targetSourceIsExact(value: string | undefined, rowPath: string, sourceRoot: string): boolean {
  if (value === undefined || value.length === 0) return false;
  const expected = path.resolve(sourceRoot, rowPath);
  const actual = path.isAbsolute(value) ? path.resolve(value) : path.resolve(sourceRoot, value);
  return actual === expected;
}

function probeOwnedGroupAbsent(
  pgid: number | undefined,
  recordProcess: (
    event: PreviewTsxCorpusProcessLifecycleEvent['event'],
    detail?: Readonly<Record<string, unknown>>,
  ) => void,
): boolean {
  if (pgid === undefined) {
    recordProcess('group-probe', { absent: true, reason: 'no-pgid-created' });
    return true;
  }
  try {
    process.kill(-pgid, 0);
    recordProcess('group-probe', { absent: false, pgid });
    return false;
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'unknown';
    const absent = code === 'ESRCH';
    recordProcess('group-probe', { absent, code, pgid });
    return absent;
  }
}

async function readLedgerDigests(filePath: string): Promise<Set<string>> {
  try {
    const source = await readFile(filePath, 'utf8');
    return new Set(
      source
        .split('\n')
        .filter(Boolean)
        .map((line) => (JSON.parse(line) as { readonly recordSha256: string }).recordSha256),
    );
  } catch (error) {
    if (isMissing(error)) return new Set();
    throw error;
  }
}

async function readJsonIfPresent<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writeBufferAtomic(filePath, Buffer.from(`${JSON.stringify(value, undefined, 2)}\n`));
}

async function writeBufferAtomic(filePath: string, value: Buffer): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, value, { flag: 'wx' });
  await rename(temporaryPath, filePath);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function directoryHasEntries(directoryPath: string): Promise<boolean> {
  try {
    const { readdir } = await import('node:fs/promises');
    return (await readdir(directoryPath)).length > 0;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function pad(index: number): string {
  return index.toString().padStart(6, '0');
}

function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function digestJson(value: unknown): string {
  return digest(JSON.stringify(value));
}
