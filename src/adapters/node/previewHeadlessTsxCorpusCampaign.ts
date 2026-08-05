import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { EsbuildPreviewCompiler } from '../esbuild/esbuildPreviewCompiler';
import { renderCompiledPreviewHeadlessly } from './previewHeadlessRenderer';
import {
  PREVIEW_TSX_CORPUS_SPOOL_LIMIT_BYTES,
  readPreviewTsxCorpusSpool,
  removePreviewTsxCorpusSpool,
  type PreviewTsxCorpusCompilerLaneCommand,
  type PreviewTsxCorpusCompilerLaneMessage,
  type PreviewTsxCorpusSpoolDescriptor,
} from './previewHeadlessTsxCorpusPipeline';
import type { PreviewBuildRequest } from '../../domain/preview';
import type { PreviewHeadlessOwnershipEvent, PreviewHeadlessResult } from './previewHeadlessRenderer';
import {
  PREVIEW_TSX_CORPUS_ARCHITECTURE_ID,
  PREVIEW_TSX_CORPUS_CAMPAIGN_SCHEMA_VERSION,
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
  type PreviewTsxCorpusGenerationCertificate,
  type PreviewTsxCorpusManifestRow,
  type PreviewTsxCorpusProcessLifecycleEvent,
  type PreviewTsxCorpusRowOwnershipEvent,
  type PreviewTsxCorpusStageEvent,
  type PreviewTsxCorpusThroughputEpoch,
  type PreviewTsxCorpusWorkerLifecycleEvent,
  type PreviewTsxCorpusWorkerResult,
  type PreviewTsxCorpusFrozenPolicy,
  type PreviewTsxCorpusV11CandidateTerminalReport,
} from './previewHeadlessTsxCorpusCampaignTypes';
import {
  readPreviewTsxCorpusChecksummedJson,
  writePreviewTsxCorpusArtifactAtomic,
  writePreviewTsxCorpusJsonAtomic,
} from './previewHeadlessTsxCorpusCampaignArtifacts';

interface CampaignOptions {
  readonly artifacts: string;
  readonly chromiumPath: string;
  readonly manifestPath: string;
  readonly maxRows?: number;
  readonly phase: 'baseline' | 'calibration' | 'final';
  readonly policyPath?: string;
  readonly primaryJobs?: 12 | 14 | 16;
  readonly referenceRoot?: string;
  readonly runtimePath: string;
  readonly sourceRoot: string;
  readonly workspace: string;
}

interface CampaignIdentity {
  readonly classifierDigest: string;
  readonly engineDigest: string;
  readonly manifestSha256: string;
  readonly phase: 'baseline' | 'calibration' | 'final';
  readonly policyDigest: string;
  readonly sourceRoot: string;
  readonly version: 1;
  readonly workspace: string;
}

interface CampaignState {
  readonly identity: CampaignIdentity;
  readonly ledgerDigests: Set<string>;
  ledgerWriteChain: Promise<void>;
  readonly options: CampaignOptions;
  readonly orderedCommits: Map<number, number>;
  readonly orderedTimeline: Array<{ readonly committedAtEpochMs: number; readonly index: number }>;
  orderedFrontier: number;
  readonly selectedLaneCount?: 12 | 14 | 16;
  readonly sentinelIndices: readonly number[];
  warmupBarrierEpochMs: number | undefined;
  readonly rows: readonly PreviewTsxCorpusManifestRow[];
  referenceSignature?: Readonly<Record<string, unknown>>;
}

const LANE_CAPTURE_LIMIT_BYTES = 1024 * 1024;
const GIB = 1024 * 1024 * 1024;
const MIB = 1024 * 1024;
const execFileAsync = promisify(execFile);

interface LaneCapture {
  readonly chunks: Buffer[];
  bytes: number;
  truncated: boolean;
}

interface LaneCleanup {
  readonly closeObserved: boolean;
  readonly groupAbsent: boolean;
  readonly listenersDetached: boolean;
  readonly reason: string;
  readonly streamsTerminal: boolean;
  readonly termSent: boolean;
  readonly killSent: boolean;
}

interface LaneRowOutcome {
  readonly cleanup?: LaneCleanup;
  readonly commandId: string;
  readonly generationId: string;
  readonly index: number;
  readonly laneId: number;
  readonly laneProcess: Readonly<{
    readonly closeObserved: boolean;
    readonly error?: string;
    readonly exit?: { readonly code: number | null; readonly signal: NodeJS.Signals | null };
    readonly ownedPgid?: number;
    readonly streamsTerminal: Readonly<{ readonly fd3: boolean; readonly stderr: boolean; readonly stdout: boolean }>;
  }>;
  readonly lifecycle: readonly PreviewTsxCorpusProcessLifecycleEvent[];
  readonly ownership: readonly PreviewTsxCorpusRowOwnershipEvent[];
  readonly protocolValid: boolean;
  readonly result: PreviewTsxCorpusWorkerResult;
  readonly stages: Buffer;
  readonly stderr: Buffer;
  readonly stdout: Buffer;
  readonly truncation: Readonly<{ readonly stages: boolean; readonly stderr: boolean; readonly stdout: boolean }>;
}

class LaneRowFailure extends Error {
  constructor(
    readonly index: number,
    readonly cleanup: LaneCleanup,
    readonly outcome: Omit<LaneRowOutcome, 'result'>,
  ) {
    super(cleanup.reason);
  }
}

interface ActiveLaneRow {
  readonly commandId: string;
  readonly deadline: NodeJS.Timeout;
  readonly index: number;
  readonly lifecycle: PreviewTsxCorpusProcessLifecycleEvent[];
  readonly ownership: PreviewTsxCorpusRowOwnershipEvent[];
  readonly resolve: (value: LaneRowOutcome) => void;
  readonly reject: (error: LaneRowFailure) => void;
  readonly stages: LaneCapture;
  readonly startedAt: number;
  readonly stderr: LaneCapture;
  readonly stdout: LaneCapture;
  protocolValid: boolean;
  result?: PreviewTsxCorpusWorkerResult;
}

/** Persistent serial compiler-lane transport. Campaign promotion remains responsible for durable acknowledgement. */
class PrimaryLane {
  #active: ActiveLaneRow | undefined;
  #childError: string | undefined;
  #close: Promise<void>;
  #closeObserved = false;
  #cleanup: Promise<LaneCleanup> | undefined;
  #drained: Promise<void> | undefined;
  #fd3Remainder = '';
  #exit: { readonly code: number | null; readonly signal: NodeJS.Signals | null } | undefined;
  #listenersDetached = false;
  #ready: Promise<void>;
  #readySettled = false;
  #rejectReady!: (error: Error) => void;
  #resolveDrained: (() => void) | undefined;
  #resolveClose!: () => void;
  #resolveReady!: () => void;
  #stderrTerminal = false;
  #stdoutRemainder = '';
  #stdoutTerminal = false;
  #stageTerminal = false;
  #streamTerminalListeners: Array<{ readonly mark: () => void; readonly stream: NodeJS.ReadableStream }> = [];
  #unacked = new Set<number>();
  readonly generationId = randomUUID();
  readonly laneId: number;
  readonly child: ReturnType<typeof spawn>;

  constructor(private readonly state: CampaignState, laneId: number) {
    this.laneId = laneId;
    this.#close = new Promise((resolve) => { this.#resolveClose = resolve; });
    this.#ready = new Promise((resolve, reject) => {
      this.#resolveReady = (): void => {
        this.#readySettled = true;
        resolve();
      };
      this.#rejectReady = (error: Error): void => {
        this.#readySettled = true;
        reject(error);
      };
    });
    this.child = spawn(process.execPath, [state.options.runtimePath, '__lane'], {
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    });
    this.child.stdout?.on('data', this.receiveStdout);
    this.child.stderr?.on('data', this.receiveStderr);
    this.child.stdio[3]?.on('data', this.receiveFd3);
    this.child.once('error', this.onChildError);
    this.child.once('exit', this.onChildExit);
    this.child.once('close', this.onChildClose);
    this.attachStreamTerminalListeners();
    const readyDeadline = setTimeout(() => {
      void this.terminateAndProbe('Primary lane ready handshake timed out.');
    }, PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY.cleanupGraceMs);
    readyDeadline.unref();
    void this.#ready.then(
      () => clearTimeout(readyDeadline),
      () => clearTimeout(readyDeadline),
    );
  }

  async run(index: number): Promise<LaneRowOutcome> {
    await this.#ready;
    if (this.#active !== undefined) throw new Error('Primary lane already has an active row.');
    if (this.#unacked.size >= 2) throw new Error('Primary lane durable acknowledgement ceiling reached.');
    const row = this.state.rows[index];
    if (row === undefined) throw new Error(`Missing manifest row ${index}.`);
    const commandId = randomUUID();
    return new Promise<LaneRowOutcome>((resolve, reject) => {
      const startedAt = performance.now();
      const active: ActiveLaneRow = {
        commandId,
        deadline: setTimeout(() => {
          this.recordLifecycle(active, 'deadline-expired');
          void this.terminateAndProbe('Primary lane row deadline expired.');
        }, PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY.outerDeadlineMs),
        index,
        lifecycle: [],
        ownership: [],
        protocolValid: true,
        reject,
        resolve,
        stages: this.createCapture(),
        startedAt,
        stderr: this.createCapture(),
        stdout: this.createCapture(),
      };
      active.deadline.unref();
      this.#active = active;
      this.recordLifecycle(active, 'spawn-returned', { pgid: this.child.pid, pid: this.child.pid });
      const command = {
        commandId,
        generationId: this.generationId,
        kind: 'row' as const,
        laneId: this.laneId,
        row: {
          attemptKind: 'primary' as const,
          chromiumPath: this.state.options.chromiumPath,
          index,
          manifestSha256: this.state.identity.manifestSha256,
          row,
          sourceRoot: this.state.options.sourceRoot,
          workspace: this.state.options.workspace,
        },
        version: 3 as const,
      };
      if (this.child.stdin == null || this.child.stdin.destroyed) {
        this.invalidateProtocol('Primary lane stdin is unavailable or backpressured.');
        return;
      }
      this.child.stdin.write(`${JSON.stringify(command)}\n`);
    });
  }

  ack(index: number): void {
    if (!this.#unacked.delete(index)) throw new Error(`Unknown lane acknowledgement for ${index}.`);
    if (this.child.stdin == null || this.child.stdin.destroyed) {
      void this.terminateAndProbe('Primary lane acknowledgement transport failed.');
      return;
    }
    this.child.stdin.write(`${JSON.stringify({ index, kind: 'ack', version: 3 })}\n`);
  }

  async drainShutdown(): Promise<LaneCleanup> {
    if (this.#active !== undefined || this.#unacked.size !== 0) {
      throw new Error('Cannot drain lane with an active or unacknowledged row.');
    }
    this.#drained ??= new Promise<void>((resolve) => { this.#resolveDrained = resolve; });
    if (this.child.stdin == null || this.child.stdin.destroyed) {
      return this.terminateAndProbe('Primary lane shutdown transport failed.');
    }
    this.child.stdin.write(`${JSON.stringify({ kind: 'shutdown', version: 3 })}\n`);
    const drained = await this.waitForDrained();
    if (!drained) return this.terminateAndProbe('Primary lane did not acknowledge shutdown drain.');
    return this.awaitClosedCleanup('Primary lane drained.');
  }

  async abort(reason: string): Promise<LaneCleanup> {
    return this.terminateAndProbe(reason);
  }

  private readonly receiveStdout = (chunk: Buffer): void => {
    this.appendCapture(this.#active?.stdout, chunk);
    this.#stdoutRemainder += chunk.toString('utf8');
    if (Buffer.byteLength(this.#stdoutRemainder) > LANE_CAPTURE_LIMIT_BYTES) {
      this.invalidateProtocol('Primary lane stdout JSONL line exceeded the capture limit.');
      return;
    }
    this.consumeLines('stdout');
  };

  private readonly receiveStderr = (chunk: Buffer): void => {
    this.appendCapture(this.#active?.stderr, chunk);
  };

  private readonly receiveFd3 = (chunk: Buffer): void => {
    this.appendCapture(this.#active?.stages, chunk);
    this.#fd3Remainder += chunk.toString('utf8');
    if (Buffer.byteLength(this.#fd3Remainder) > LANE_CAPTURE_LIMIT_BYTES) {
      this.invalidateProtocol('Primary lane fd3 JSONL line exceeded the capture limit.');
      return;
    }
    this.consumeLines('fd3');
  };

  private consumeLines(source: 'fd3' | 'stdout'): void {
    let remainder = source === 'stdout' ? this.#stdoutRemainder : this.#fd3Remainder;
    let newline = remainder.indexOf('\n');
    while (newline >= 0) {
      const line = remainder.slice(0, newline);
      remainder = remainder.slice(newline + 1);
      if (line.length !== 0) this.receiveJsonLine(source, line);
      newline = remainder.indexOf('\n');
    }
    if (source === 'stdout') this.#stdoutRemainder = remainder;
    else this.#fd3Remainder = remainder;
  }

  private receiveJsonLine(source: 'fd3' | 'stdout', line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.invalidateProtocol(`Malformed ${source} JSONL.`);
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) {
      this.invalidateProtocol(`Invalid ${source} JSONL value.`);
      return;
    }
    if (source === 'fd3') {
      this.receiveDiagnostic(parsed as Record<string, unknown>);
      return;
    }
    this.receiveStdoutMessage(parsed as Record<string, unknown>);
  }

  private receiveStdoutMessage(message: Record<string, unknown>): void {
    if (message.version !== 3 || typeof message.kind !== 'string') {
      this.invalidateProtocol('Invalid primary lane stdout protocol version or kind.');
      return;
    }
    if (message.kind === 'ready') {
      if (this.#active !== undefined || this.#closeObserved) {
        this.invalidateProtocol('Primary lane sent ready outside its startup handshake.');
        return;
      }
      if (!this.#readySettled) this.#resolveReady();
      return;
    }
    if (message.kind === 'drained') {
      if (this.#resolveDrained === undefined) {
        this.invalidateProtocol('Primary lane drained without a supervisor request.');
        return;
      }
      this.#resolveDrained();
      this.#resolveDrained = undefined;
      return;
    }
    const active = this.#active;
    if (this.#cleanup !== undefined) return;
    if (active === undefined) {
      this.invalidateProtocol(`Primary lane emitted ${message.kind} without an active row.`);
      return;
    }
    if (message.kind === 'row-terminal') {
      if (message.index !== active.index || message.commandId !== active.commandId || active.result === undefined) {
        this.invalidateProtocol('Primary lane terminal did not correlate with its worker result.');
        return;
      }
      if (this.#unacked.size >= 2) {
        this.invalidateProtocol('Primary lane exceeded its two-result durable-credit ceiling.');
        return;
      }
      clearTimeout(active.deadline);
      this.recordLifecycle(active, 'timers-cleared', { deadline: true });
      this.#active = undefined;
      this.#unacked.add(active.index);
      active.resolve(this.toOutcome(active, active.result));
      return;
    }
    if ((message.kind === 'headless-result' || message.kind === 'compile-or-render-failure') && message.index === active.index) {
      active.result = message as unknown as PreviewTsxCorpusWorkerResult;
      return;
    }
    this.invalidateProtocol('Primary lane stdout message did not match the active row.');
  }

  private receiveDiagnostic(message: Record<string, unknown>): void {
    const active = this.#active;
    if (this.#cleanup !== undefined) return;
    if (active === undefined || message.version !== 3 || message.index !== active.index) {
      this.invalidateProtocol('Primary lane fd3 diagnostic did not match the active row.');
      return;
    }
    if (message.kind === 'row-ownership') {
      active.ownership.push(message as unknown as PreviewTsxCorpusRowOwnershipEvent);
      return;
    }
    if (message.kind !== 'compiler-progress' && message.kind !== 'target-stage' && message.kind !== 'worker-lifecycle') {
      this.invalidateProtocol('Primary lane emitted an unknown fd3 diagnostic.');
    }
  }

  private invalidateProtocol(reason: string): void {
    if (this.#active !== undefined) this.#active.protocolValid = false;
    void this.terminateAndProbe(reason);
  }

  private readonly onChildError = (error: Error): void => {
    this.#childError = error.message;
    this.recordLifecycle(this.#active, 'child-error', { message: error.message.slice(0, 1_000) });
    void this.terminateAndProbe(`Primary lane child error: ${error.message}`);
  };

  private readonly onChildExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    this.#exit = { code, signal };
    this.recordLifecycle(this.#active, 'child-exit', { code, signal });
  };

  private readonly onChildClose = (code: number | null, signal: NodeJS.Signals | null): void => {
    this.#closeObserved = true;
    this.#resolveClose();
    this.recordLifecycle(this.#active, 'child-close', { code, signal });
    if (this.#active !== undefined) void this.terminateAndProbe('Primary lane closed while a row was active.');
  };

  private attachStreamTerminalListeners(): void {
    const attach = (stream: NodeJS.ReadableStream | null | undefined, terminal: 'fd3' | 'stderr' | 'stdout'): void => {
      if (stream == null) return;
      const mark = (): void => {
        if (terminal === 'stdout') this.#stdoutTerminal = true;
        else if (terminal === 'stderr') this.#stderrTerminal = true;
        else this.#stageTerminal = true;
        this.recordLifecycle(this.#active, 'stream-terminal', { stream: terminal });
      };
      stream.once('close', mark);
      stream.once('end', mark);
      stream.once('error', mark);
      this.#streamTerminalListeners.push({ mark, stream });
    };
    attach(this.child.stdout, 'stdout');
    attach(this.child.stderr, 'stderr');
    attach(this.child.stdio[3] as NodeJS.ReadableStream | null | undefined, 'fd3');
  }

  private createCapture(): LaneCapture {
    return { bytes: 0, chunks: [], truncated: false };
  }

  private appendCapture(capture: LaneCapture | undefined, chunk: Buffer): void {
    if (capture === undefined || capture.truncated) return;
    const remaining = LANE_CAPTURE_LIMIT_BYTES - capture.bytes;
    if (remaining <= 0) {
      capture.truncated = true;
      return;
    }
    const retained = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
    capture.chunks.push(retained);
    capture.bytes += retained.byteLength;
    if (retained.byteLength !== chunk.byteLength) capture.truncated = true;
  }

  private toOutcome(active: ActiveLaneRow, result: PreviewTsxCorpusWorkerResult): LaneRowOutcome {
    return {
      commandId: active.commandId,
      generationId: this.generationId,
      index: active.index,
      laneId: this.laneId,
      laneProcess: this.laneProcessState(),
      lifecycle: active.lifecycle,
      ownership: active.ownership,
      protocolValid: active.protocolValid,
      result,
      stages: Buffer.concat(active.stages.chunks),
      stderr: Buffer.concat(active.stderr.chunks),
      stdout: Buffer.concat(active.stdout.chunks),
      truncation: { stages: active.stages.truncated, stderr: active.stderr.truncated, stdout: active.stdout.truncated },
    };
  }

  private toFailureOutcome(active: ActiveLaneRow): Omit<LaneRowOutcome, 'result'> {
    return {
      commandId: active.commandId,
      generationId: this.generationId,
      index: active.index,
      laneId: this.laneId,
      laneProcess: this.laneProcessState(),
      lifecycle: active.lifecycle,
      ownership: active.ownership,
      protocolValid: active.protocolValid,
      stages: Buffer.concat(active.stages.chunks),
      stderr: Buffer.concat(active.stderr.chunks),
      stdout: Buffer.concat(active.stdout.chunks),
      truncation: { stages: active.stages.truncated, stderr: active.stderr.truncated, stdout: active.stdout.truncated },
    };
  }

  private laneProcessState(): LaneRowOutcome['laneProcess'] {
    return {
      closeObserved: this.#closeObserved,
      ...(this.#childError === undefined ? {} : { error: this.#childError }),
      ...(this.#exit === undefined ? {} : { exit: this.#exit }),
      ...(this.child.pid === undefined || process.platform === 'win32' ? {} : { ownedPgid: this.child.pid }),
      streamsTerminal: { fd3: this.#stageTerminal, stderr: this.#stderrTerminal, stdout: this.#stdoutTerminal },
    };
  }

  private recordLifecycle(active: ActiveLaneRow | undefined, event: PreviewTsxCorpusProcessLifecycleEvent['event'], detail?: Readonly<Record<string, unknown>>): void {
    if (active === undefined) return;
    active.lifecycle.push({
      ...(detail === undefined ? {} : { detail }),
      elapsedMs: Math.round(performance.now() - active.startedAt),
      event,
      kind: 'parent-process',
      version: 3,
    });
  }

  private async waitForDrained(): Promise<boolean> {
    const drained = this.#drained;
    if (drained === undefined) return false;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY.cleanupGraceMs);
      timer.unref();
      void drained.then(() => { clearTimeout(timer); resolve(true); });
    });
  }

  private async terminateAndProbe(reason: string): Promise<LaneCleanup> {
    this.#cleanup ??= this.performCleanup(reason);
    const cleanup = await this.#cleanup;
    const active = this.#active;
    if (active !== undefined) {
      clearTimeout(active.deadline);
      this.#active = undefined;
      active.reject(new LaneRowFailure(active.index, cleanup, this.toFailureOutcome(active)));
    }
    if (!this.#readySettled) this.#rejectReady(new Error(reason));
    return cleanup;
  }

  private async performCleanup(reason: string): Promise<LaneCleanup> {
    const active = this.#active;
    let termSent = false;
    let killSent = false;
    if (!this.#closeObserved) termSent = this.signalOwnedGroup('SIGTERM', active);
    if (!this.#closeObserved) {
      await this.waitForClose();
    }
    if (!this.probeGroupAbsent()) killSent = this.signalOwnedGroup('SIGKILL', active);
    await this.waitForGroupAbsence();
    return this.awaitClosedCleanup(reason, termSent, killSent);
  }

  private async awaitClosedCleanup(reason: string, termSent = false, killSent = false): Promise<LaneCleanup> {
    if (!this.#closeObserved) {
      await this.waitForClose();
    }
    await Promise.all([this.waitForStreamTerminal('stdout'), this.waitForStreamTerminal('stderr'), this.waitForStreamTerminal('fd3')]);
    this.detachListeners();
    return {
      closeObserved: this.#closeObserved,
      groupAbsent: this.probeGroupAbsent(),
      killSent,
      listenersDetached: this.#listenersDetached,
      reason,
      streamsTerminal: this.#stdoutTerminal && this.#stderrTerminal && this.#stageTerminal,
      termSent,
    };
  }

  private async waitForStreamTerminal(stream: 'fd3' | 'stderr' | 'stdout'): Promise<void> {
    const terminal = (): boolean => stream === 'stdout' ? this.#stdoutTerminal : stream === 'stderr' ? this.#stderrTerminal : this.#stageTerminal;
    if (terminal()) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY.cleanupGraceMs);
      timer.unref();
      const check = (): void => {
        if (!terminal()) return;
        finish();
      };
      const poll = (): void => {
        if (settled) return;
        check();
        if (!settled) {
          const next = setTimeout(poll, 20);
          next.unref();
        }
      };
      poll();
    });
  }

  private async waitForClose(): Promise<void> {
    if (this.#closeObserved) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY.cleanupGraceMs);
      timer.unref();
      void this.#close.then(() => { clearTimeout(timer); resolve(); });
    });
  }

  private async waitForGroupAbsence(): Promise<void> {
    if (this.probeGroupAbsent()) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        resolve();
      };
      const deadline = setTimeout(finish, PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY.cleanupGraceMs);
      deadline.unref();
      const poll = (): void => {
        if (settled) return;
        if (this.probeGroupAbsent()) {
          finish();
          return;
        }
        const next = setTimeout(poll, 50);
        next.unref();
      };
      poll();
    });
  }

  private signalOwnedGroup(signal: NodeJS.Signals, active: ActiveLaneRow | undefined): boolean {
    const pgid = this.child.pid;
    if (pgid === undefined) return false;
    try {
      if (process.platform === 'win32') this.child.kill(signal);
      else process.kill(-pgid, signal);
      this.recordLifecycle(active, 'group-signal', { pgid, signal });
      return true;
    } catch (error) {
      this.recordLifecycle(active, 'group-signal', { error: error instanceof Error ? error.message : String(error), pgid, signal });
      return false;
    }
  }

  private probeGroupAbsent(): boolean {
    const pgid = this.child.pid;
    if (pgid === undefined || process.platform === 'win32') return true;
    try {
      process.kill(-pgid, 0);
      return false;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ESRCH';
    }
  }

  private detachListeners(): void {
    if (this.#listenersDetached) return;
    this.child.stdout?.removeListener('data', this.receiveStdout);
    this.child.stderr?.removeListener('data', this.receiveStderr);
    this.child.stdio[3]?.removeListener('data', this.receiveFd3);
    this.child.removeListener('error', this.onChildError);
    this.child.removeListener('exit', this.onChildExit);
    this.child.removeListener('close', this.onChildClose);
    for (const { mark, stream } of this.#streamTerminalListeners) {
      stream.removeListener('close', mark);
      stream.removeListener('end', mark);
      stream.removeListener('error', mark);
    }
    this.#streamTerminalListeners = [];
    this.#listenersDetached = true;
  }
}

interface CampaignResourceSample {
  readonly aggregateOwnedRssBytes: number;
  readonly compressedBytes?: number;
  readonly laneOwnedRssBytes: Readonly<Record<string, number>>;
  readonly sampledAtEpochMs: number;
  readonly swapBytes?: number;
  readonly unavailable?: string;
}

/** One bounded, fail-closed sampler for the campaign-owned detached process groups. */
class CampaignResourceSupervisor {
  #baseline: CampaignResourceSample | undefined;
  #hardReason: string | undefined;
  #interval: NodeJS.Timeout | undefined;
  #paused = false;
  #pauseEvents: Array<{ readonly atEpochMs: number; readonly reason: string }> = [];
  #quarantined = new Set<number>();
  #running: Promise<void> | undefined;
  #samples: CampaignResourceSample[] = [];
  #unavailable: string | undefined;

  constructor(
    private readonly state: CampaignState,
    private readonly lanes: ReadonlySet<PrimaryLane>,
  ) {}

  async start(): Promise<void> {
    await this.sample();
    this.#interval = setInterval(() => { void this.sample(); }, 1_000);
    this.#interval.unref();
  }

  async stop(): Promise<void> {
    if (this.#interval !== undefined) clearInterval(this.#interval);
    this.#interval = undefined;
    await this.sample();
  }

  async beforeClaim(): Promise<void> {
    await this.sample();
    if (this.#hardReason !== undefined) throw new Error(this.#hardReason);
    while (this.#paused) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1_000);
        timer.unref();
      });
      await this.sample();
      if (this.#hardReason !== undefined) throw new Error(this.#hardReason);
    }
  }

  laneRssBytes(laneId: number): number | undefined {
    return this.#samples.at(-1)?.laneOwnedRssBytes[laneId.toString()];
  }

  generationMustRetire(laneId: number, postWarmRssBytes: number | undefined): boolean {
    const rss = this.laneRssBytes(laneId);
    if (rss === undefined) return false;
    if (rss >= 3.5 * GIB) {
      this.#quarantined.add(laneId);
      this.#hardReason ??= `Primary lane ${laneId} exceeded the 3.5 GiB quarantine limit.`;
      return true;
    }
    return rss >= 2.5 * GIB || (postWarmRssBytes !== undefined && rss - postWarmRssBytes >= GIB);
  }

  async persist(final: boolean): Promise<boolean> {
    const latest = this.#samples.at(-1);
    const baseline = this.#baseline;
    const complete = final && latest !== undefined && baseline !== undefined && this.#unavailable === undefined;
    const gate = complete && this.#hardReason === undefined && this.#quarantined.size === 0;
    await writeJsonAtomic(path.join(this.state.options.artifacts, 'resource-report.json'), {
      baseline,
      finalGate: gate,
      hardReason: this.#hardReason,
      pauseEvents: this.#pauseEvents,
      quarantinedLanes: [...this.#quarantined],
      samples: this.#samples,
      unavailable: this.#unavailable,
      version: 9,
    });
    return gate;
  }

  private async sample(): Promise<void> {
    if (this.#running !== undefined) return this.#running;
    this.#running = this.collect().then(
      () => undefined,
      () => undefined,
    );
    try {
      await this.#running;
    } finally {
      this.#running = undefined;
    }
  }

  private async collect(): Promise<void> {
    const sampledAtEpochMs = Date.now();
    try {
      if (process.platform !== 'darwin') throw new Error('resource sampling requires macOS ps/vm_stat/sysctl.');
      const [processes, swap, vm] = await Promise.all([
        execFileAsync('/bin/ps', ['-Ao', 'pid=,ppid=,pgid=,rss='], { maxBuffer: 512 * 1024, timeout: 2_000 }),
        execFileAsync('/usr/sbin/sysctl', ['-n', 'vm.swapusage'], { maxBuffer: 16 * 1024, timeout: 2_000 }),
        execFileAsync('/usr/bin/vm_stat', [], { maxBuffer: 128 * 1024, timeout: 2_000 }),
      ]);
      const pgids = new Map<number, number>();
      for (const lane of this.lanes) {
        if (lane.child.pid !== undefined) pgids.set(lane.child.pid, lane.laneId);
      }
      const laneOwnedRssBytes: Record<string, number> = {};
      for (const line of String(processes.stdout).split('\n')) {
        const fields = line.trim().split(/\s+/u);
        if (fields.length !== 4) continue;
        const pgid = Number(fields[2]);
        const rssKiB = Number(fields[3]);
        const laneId = pgids.get(pgid);
        if (laneId === undefined || !Number.isSafeInteger(rssKiB)) continue;
        laneOwnedRssBytes[laneId.toString()] = (laneOwnedRssBytes[laneId.toString()] ?? 0) + rssKiB * 1024;
      }
      const compressedBytes = parseCompressedBytes(String(vm.stdout));
      const swapBytes = parseSwapBytes(String(swap.stdout));
      const sample: CampaignResourceSample = {
        aggregateOwnedRssBytes: Object.values(laneOwnedRssBytes).reduce((sum, value) => sum + value, 0),
        ...(compressedBytes === undefined ? {} : { compressedBytes }),
        laneOwnedRssBytes,
        sampledAtEpochMs,
        ...(swapBytes === undefined ? {} : { swapBytes }),
      };
      this.recordSample(sample);
    } catch (error) {
      const unavailable = error instanceof Error ? error.message.slice(0, 1_000) : String(error);
      this.#unavailable ??= unavailable;
      this.recordSample({ aggregateOwnedRssBytes: 0, laneOwnedRssBytes: {}, sampledAtEpochMs, unavailable });
    }
  }

  private recordSample(sample: CampaignResourceSample): void {
    if (this.#baseline === undefined) this.#baseline = sample;
    this.#samples.push(sample);
    if (this.#samples.length > 3_600) this.#samples.shift();
    if (sample.unavailable !== undefined || this.#baseline === undefined) return;
    const swapDelta = sample.swapBytes === undefined || this.#baseline.swapBytes === undefined
      ? Number.POSITIVE_INFINITY
      : sample.swapBytes - this.#baseline.swapBytes;
    const compressedDelta = sample.compressedBytes === undefined || this.#baseline.compressedBytes === undefined
      ? Number.POSITIVE_INFINITY
      : sample.compressedBytes - this.#baseline.compressedBytes;
    const hard = sample.aggregateOwnedRssBytes >= 32 * GIB || swapDelta >= GIB || compressedDelta >= 4 * GIB;
    if (hard) {
      this.#hardReason ??= 'Campaign resource hard limit reached.';
      return;
    }
    const pause = sample.aggregateOwnedRssBytes >= 28 * GIB || swapDelta >= 512 * MIB || compressedDelta >= 2 * GIB;
    if (pause && !this.#paused) this.#pauseEvents.push({ atEpochMs: sample.sampledAtEpochMs, reason: 'resource-pause-threshold' });
    this.#paused = pause;
  }
}

function parseSwapBytes(source: string): number | undefined {
  const match = /total = ([\d.]+)M\s+used = ([\d.]+)M/iu.exec(source);
  return match === null ? undefined : Math.round(Number(match[2]) * MIB);
}

async function frozenMandatorySentinels(
  manifestPath: string,
): Promise<readonly { readonly digest: string; readonly fidelity: string; readonly index: number }[]> {
  const rows = parseManifest(await readFile(manifestPath, 'utf8'));
  const suffix = 'legal/right-to-consent-or-consult/pages/rtcc-investment-contract-management-page/investment-agreement-management-modals.tsx';
  const matches = rows.map((row, index) => ({ index, row })).filter(({ row }) => row.path.endsWith(suffix));
  if (matches.length !== 1 || matches[0] === undefined) throw new Error('Mandatory v9 corridor is not uniquely frozen.');
  return [{ digest: matches[0].row.sha256, fidelity: 'pending-expanded-certification', index: matches[0].index }];
}

function parseCompressedBytes(source: string): number | undefined {
  const pageSize = 4096;
  const match = /Pages occupied by compressor:\s+(\d+)\./u.exec(source);
  return match === null ? undefined : Number(match[1]) * pageSize;
}

/** Runs or resumes a frozen jobs-3 corpus campaign with a jobs-1 isolated fallback. */
export async function runPreviewHeadlessTsxCorpusCampaign(
  options: CampaignOptions,
): Promise<void> {
  const state = await prepareCampaign(options);
  const limit = Math.min(options.maxRows ?? state.rows.length, state.rows.length);
  const pending = await pendingCanonicalIndices(state, limit);
  const laneCount = state.selectedLaneCount ?? options.primaryJobs ?? PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY.primaryJobs;
  const warmupRows = laneCount * PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY.warmupRowsPerLane;
  if (pending.length < warmupRows && pending.length !== 0) {
    throw new Error('v9 requires exactly four durable warm-up rows per primary lane.');
  }
  const warmupAssignments = Array.from(
    { length: laneCount },
    (_, laneId) => pending.slice(
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
  let durableCanonicals = 0;
  let commitChain: Promise<void> = Promise.resolve();
  let isolationChain: Promise<void> = Promise.resolve();
  let abortPromise: Promise<void> | undefined;
  const activeLanes = new Set<PrimaryLane>();
  const resources = new CampaignResourceSupervisor(state, activeLanes);
  let generationStartSentinelChain: Promise<void> = Promise.resolve();
  const certifyGenerationBoundary = async (lane: PrimaryLane, boundary: 'drain' | 'start'): Promise<boolean> => {
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
          throw new Error(`Primary lane ${lane.laneId} abort cleanup was inconclusive.`);
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
  const enqueueIsolation = (index: number, primary: PreviewTsxCorpusAttemptRecord): Promise<void> => {
    const task = isolationChain.then(async () => {
      const isolated = await runAttempt(state, index, 'isolated');
      if (!isolatedCanBecomeCanonical(isolated)) {
        throw new Error(
          `Isolated infrastructure outcome left ${state.rows[index]?.path ?? index} unclassified: ${isolated.infrastructureReason ?? isolated.lastStage ?? 'no target evidence'}`,
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
      throw new Error(`Primary lane ${lane.laneId} failed its compiler-generation semantic sentinel.`);
    }
    const cleanup = await lane.drainShutdown();
    activeLanes.delete(lane);
    if (!cleanup.closeObserved || !cleanup.groupAbsent || !cleanup.listenersDetached || !cleanup.streamsTerminal) {
      throw new Error(`Primary lane ${lane.laneId} generation cleanup was inconclusive.`);
    }
    const certificate: PreviewTsxCorpusGenerationCertificate & { readonly cleanup: LaneCleanup; readonly reason: string } = {
      cleanup,
      generationId: lane.generationId,
      isolationProofs: 0,
      lane: lane.laneId,
      reason,
      rows,
      sentinelMatched: startSentinelMatched && drainSentinelMatched,
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
    if (!startSentinelMatched) throw new Error(`Primary lane ${laneId} failed its start sentinel.`);
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
        if (fatal !== undefined) return;
        await resources.beforeClaim();
        const index = claim();
        if (index === undefined) break;
        const primary = await processIndex(index, false);
        const generationExpired = performance.now() - generationStarted >= 15 * 60_000;
        const laneFailed = primary.infrastructureReason?.startsWith('primary-lane-failure:') === true;
        const resourceRetire = resources.generationMustRetire(laneId, postWarmRssBytes);
        if (laneFailed || resourceRetire || generationRows >= 64 || generationExpired) {
          await retireLane(lane, generationRows, laneFailed ? 'lane-failure' : resourceRetire ? 'resource-limit' : generationExpired ? 'age-limit' : 'row-limit', startSentinelMatched);
          if (fatal !== undefined || nextPending >= pending.length) return;
          lane = new PrimaryLane(state, laneId);
          activeLanes.add(lane);
          startSentinelMatched = await certifyGenerationBoundary(lane, 'start');
          if (!startSentinelMatched) throw new Error(`Primary lane ${laneId} failed its replacement start sentinel.`);
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
    if (fatal !== undefined) throw fatal;
  } catch (error) {
    await markFatal(error);
    await Promise.allSettled([...activeLanes].map((lane) => lane.abort('Campaign aborted after fatal scheduler error.')));
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
  readonly artifacts: string; readonly chromiumPath: string; readonly manifestPath: string;
  readonly runtimePath: string; readonly sourceRoot: string; readonly windowRows: number;
  readonly windowStart: number; readonly workspace: string;
}): Promise<void> {
  if (options.windowStart !== 0 || options.windowRows !== 240) {
    throw new Error('v11 calibration requires the contiguous manifest range 0–239.');
  }
  const reports: PreviewTsxCorpusV11CandidateTerminalReport[] = [];
  let reference: V11Reference | undefined;
  for (const laneCount of PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY.laneCounts) {
    const candidateArtifacts = path.join(options.artifacts, `candidate-v11-serial-l${laneCount.toString()}`);
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
        architectureId: PREVIEW_TSX_CORPUS_ARCHITECTURE_ID, classifierVersion: PREVIEW_TSX_CORPUS_CLASSIFIER_VERSION,
        engineDigest: state.identity.engineDigest, laneCount, manifestSha256: state.identity.manifestSha256, pipelineDepth: 1,
        policyDigest: state.identity.policyDigest, protocolVersion: 3, reuseMode: 'persistent-compiler-fresh-browser', selectedAt: new Date().toISOString(),
        sentinels: await frozenMandatorySentinels(options.manifestPath), version: PREVIEW_TSX_CORPUS_CAMPAIGN_SCHEMA_VERSION,
      };
      await writePreviewTsxCorpusJsonAtomic(path.join(options.artifacts, 'selected-policy.json'), policy);
      return;
    }
    if (report.status !== 'safe-sub-100') throw new Error(`v11 candidate L=${laneCount.toString()} closed with a failed gate.`);
  }
  await writeV11AggregateReport(options.artifacts, reports);
  throw new Error('No v11 calibration candidate achieved the required closed throughput gate.');
}

/**
 * v12 accelerator.  This intentionally has no fallback to the serial v11
 * runner: every production row crosses the durable spool seam before a fresh
 * Chromium invocation.  The queue is the only cross-stage ownership boundary.
 */
interface V12AccelerationOptions {
  readonly artifacts: string; readonly chromiumPath: string; readonly manifestPath: string;
  readonly runtimePath: string; readonly sourceRoot: string; readonly windowRows: number;
  readonly windowStart: number; readonly workspace: string; readonly chunkRows: number;
  readonly candidates: '12x4,14x4,16x5';
}

const FILTERED_JSX_EXPORT_MANIFEST_ROWS = 6807;
const FILTERED_JSX_EXPORT_MANIFEST_SHA256 =
  '5946df77be97f1fb2b5628358783f28c17a397210d540f60400c86c406ceede5';
const FILTERED_MINIMUM_TERMINAL_RATE_PER_MINUTE = 61.0;
const FILTERED_CAMPAIGN_WATCHDOG_RATE_PER_MINUTE = 30.0;
const FILTERED_COMPILER_GENERATION_ROWS = 3;

export async function acceleratePreviewHeadlessTsxCorpusCampaign(options: V12AccelerationOptions): Promise<void> {
  let watchdog: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    // esbuild's service handles may be unref'd while a compile promise is still
    // pending. Keep one supervisor-owned handle referenced until the complete
    // acceleration path has either closed its reports or failed.
    watchdog = setTimeout(
      () => reject(new Error('v12 acceleration watchdog expired.')),
      // The all-row audit preserves the ninety-second per-row deadline while
      // allowing its bounded pipeline enough wall time to close every artifact.
      Math.max(60, Math.ceil(options.windowRows / FILTERED_CAMPAIGN_WATCHDOG_RATE_PER_MINUTE) + 30) * 60_000,
    );
  });
  try {
    await Promise.race([runV12Acceleration(options), deadline]);
  } finally {
    if (watchdog !== undefined) clearTimeout(watchdog);
  }
}

async function runV12Acceleration(options: V12AccelerationOptions): Promise<void> {
  if (options.chunkRows !== 8 || options.candidates !== '12x4,14x4,16x5') {
    throw new Error('v12 accelerate requires eight-row admission windows and candidates 12x4,14x4,16x5.');
  }
  const manifestBytes = await readFile(options.manifestPath);
  const manifest = parseManifest(manifestBytes.toString('utf8'));
  const manifestDigest = digest(manifestBytes);
  if (
    manifest.length !== FILTERED_JSX_EXPORT_MANIFEST_ROWS ||
    manifestDigest !== FILTERED_JSX_EXPORT_MANIFEST_SHA256
  ) {
    throw new Error('v13 acceleration requires the immutable 6,807-row JSX-export manifest.');
  }
  if (options.windowStart + options.windowRows > manifest.length) throw new Error('v12 acceleration window exceeds the frozen manifest.');
  const engineDigest = digest(await readFile(options.runtimePath));
  const corridorSuffix = 'legal/right-to-consent-or-consult/pages/rtcc-investment-contract-management-page/investment-agreement-management-modals.tsx';
  const corridorMatches = manifest
    .map((row, index) => ({ index, row }))
    .filter(({ row }) => row.path.endsWith(corridorSuffix));
  if (corridorMatches.length !== 1 || corridorMatches[0] === undefined) {
    throw new Error(`v12 reference corridor resolution expected one match, found ${corridorMatches.length}.`);
  }
  const corridor = corridorMatches[0];
  const semanticKey = digestJson({
    chromiumPath: path.resolve(options.chromiumPath),
    corridorDigest: corridor.row.sha256,
    corridorIndex: corridor.index,
    engineDigest,
    manifestDigest,
    manifestRows: manifest.length,
    sourceRoot: path.resolve(options.sourceRoot),
    timeoutMs: 30_000,
    virtualTimeMs: 5_000,
    workspace: path.resolve(options.workspace),
  });
  const referencePath = path.join(options.artifacts, 'reference', engineDigest, semanticKey, 'reference.json');
  const reference = await readJsonIfPresent<{ readonly semanticKey: string; readonly engineDigest: string }>(referencePath);
  if (reference !== undefined) {
    if (reference.semanticKey !== semanticKey || reference.engineDigest !== engineDigest) throw new Error('v12 engine-namespaced reference identity mismatch.');
    await readPreviewTsxCorpusChecksummedJson(referencePath);
  } else {
    // The reference is namespaced before lookup.  Foreign namespaces are never
    // inspected or overwritten.
    const row = corridor.row;
    const compiler = new EsbuildPreviewCompiler();
    let referenceDeadline: NodeJS.Timeout | undefined;
    try {
      const referenceWork = (async () => {
        const request = await v12Request(row, options.sourceRoot, options.workspace);
        const bundle = await compiler.compile(request);
        return {
          request,
          result: await renderCompiledPreviewHeadlessly(bundle, request, { chromiumPath: options.chromiumPath, timeoutMs: 30_000, virtualTimeMs: 5_000 }),
        };
      })();
      const deadline = new Promise<never>((_, reject) => {
        referenceDeadline = setTimeout(
          () => reject(new Error('v12 reference deadline expired.')),
          120_000,
        );
      });
      const { request, result } = await Promise.race([referenceWork, deadline]);
      if (!result.cleanup.browserTerminated || !result.cleanup.profileRemoved || !result.cleanup.serverClosed) throw new Error('v12 reference renderer cleanup was inconclusive.');
      const checksum = await writePreviewTsxCorpusJsonAtomic(referencePath, { engineDigest, semanticKey, signature: semanticSentinelSignature({ headless: result, index: corridor.index, kind: 'headless-result', documentPath: request.documentPath, durationMs: 0, path: row.path, version: 3 }), version: 12 });
      await writePreviewTsxCorpusJsonAtomic(`${referencePath}.checksum.json`, checksum);
      await readPreviewTsxCorpusChecksummedJson(referencePath);
    } finally {
      if (referenceDeadline !== undefined) clearTimeout(referenceDeadline);
      await compiler.shutdown();
    }
  }
  const aggregate: unknown[] = [];
  // Measure the highest already-bounded topology first. A complete sub-100
  // result is still an honest result and does not justify spending two more
  // full 240-row windows on strictly lower concurrency.
  for (const candidate of [{ lanes: 16, renders: 5 }, { lanes: 14, renders: 4 }, { lanes: 12, renders: 4 }] as const) {
    const root = path.join(options.artifacts, `candidate-v12-${candidate.lanes}x${candidate.renders}`);
    const report = await runV12Candidate({ ...options, engineDigest, manifest, root, semanticKey }, candidate.lanes, candidate.renders);
    aggregate.push(report);
    const checksum = await writePreviewTsxCorpusJsonAtomic(path.join(options.artifacts, 'aggregate-report.json'), { candidates: aggregate, engineDigest, semanticKey, version: 12 });
    await writePreviewTsxCorpusJsonAtomic(path.join(options.artifacts, 'aggregate-report.json.checksum.json'), checksum);
    await readPreviewTsxCorpusChecksummedJson(path.join(options.artifacts, 'aggregate-report.json'));
    if (report.status === 'selected' || report.status === 'safe-sub-100') return;
  }
  throw new Error('Every v12 candidate failed a safety gate.');
}

async function v12Request(row: PreviewTsxCorpusManifestRow, sourceRoot: string, workspace: string): Promise<PreviewBuildRequest> {
  const documentPath = path.resolve(sourceRoot, row.path);
  const sourceText = await readFile(documentPath, 'utf8');
  if (digest(sourceText) !== row.sha256) throw new Error(`Frozen target digest changed: ${row.path}`);
  return Object.freeze({ dependencySnapshots: Object.freeze([]), documentPath, language: 'tsx', preparationMode: 'fast', renderMode: 'page-inspector', sourceText, useStorybookPreview: false, workspaceRoot: workspace });
}

type V12CompileCommand = Extract<PreviewTsxCorpusCompilerLaneCommand, { readonly kind: 'compile' }>;
type V12CompiledMessage = Extract<PreviewTsxCorpusCompilerLaneMessage, { readonly kind: 'compiled' }>;

class V12CompileDeadlineError extends Error {}
class V12CompileStageError extends Error {
  constructor(readonly stage: 'compile' | 'spool', message: string) { super(message); }
}

/** One compiler and one esbuild service in an independently owned process group. */
class V12CompilerProcess {
  #active: {
    readonly commandId: string;
    readonly deadline: NodeJS.Timeout;
    readonly reject: (error: Error) => void;
    readonly resolve: (message: V12CompiledMessage) => void;
  } | undefined;
  #close: Promise<void>;
  #closeObserved = false;
  #cleanup: Promise<boolean> | undefined;
  #drained: Promise<void>;
  #ready: Promise<void>;
  #readySettled = false;
  #rejectReady!: (error: Error) => void;
  #resolveClose!: () => void;
  #resolveDrained!: () => void;
  #resolveReady!: () => void;
  #stderr = '';
  #stdoutRemainder = '';
  readonly child: ReturnType<typeof spawn>;

  constructor(runtimePath: string, readonly laneId: number) {
    this.#close = new Promise((resolve) => { this.#resolveClose = resolve; });
    this.#drained = new Promise((resolve) => { this.#resolveDrained = resolve; });
    this.#ready = new Promise((resolve, reject) => {
      this.#resolveReady = (): void => { this.#readySettled = true; resolve(); };
      this.#rejectReady = (error: Error): void => { this.#readySettled = true; reject(error); };
    });
    this.child = spawn(process.execPath, [runtimePath, '__v12-compiler-lane'], {
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout?.on('data', this.receiveStdout);
    this.child.stderr?.on('data', (chunk: Buffer) => {
      this.#stderr = `${this.#stderr}${chunk.toString('utf8')}`.slice(-16_384);
    });
    this.child.once('error', (error) => this.fail(error));
    this.child.once('close', (code, signal) => {
      this.#closeObserved = true;
      this.#resolveClose();
      const error = new Error(`v12 compiler lane ${this.laneId.toString()} closed (${String(code)}/${String(signal)}).${this.#stderr.length === 0 ? '' : `\n${this.#stderr}`}`);
      if (!this.#readySettled) this.#rejectReady(error);
      this.failActive(error);
    });
    const readyDeadline = setTimeout(() => {
      this.fail(new Error(`v12 compiler lane ${this.laneId.toString()} ready handshake timed out.`));
    }, 10_000);
    void this.#ready.then(() => clearTimeout(readyDeadline), () => clearTimeout(readyDeadline));
  }

  async compile(command: V12CompileCommand): Promise<V12CompiledMessage> {
    await this.#ready;
    if (this.#active !== undefined) throw new Error(`v12 compiler lane ${this.laneId.toString()} already has active work.`);
    if (this.#closeObserved || this.child.stdin == null || this.child.stdin.destroyed) throw new Error(`v12 compiler lane ${this.laneId.toString()} is unavailable.`);
    return new Promise<V12CompiledMessage>((resolve, reject) => {
      const deadline = setTimeout(() => {
        const error = new V12CompileDeadlineError(`v12 compiler lane ${this.laneId.toString()} row ${command.identity.row.toString()} exceeded its absolute deadline.`);
        this.failActive(error);
        void this.abort(error.message);
      }, Math.max(1, command.absoluteDeadlineEpochMs - Date.now()));
      this.#active = { commandId: command.commandId, deadline, reject, resolve };
      this.child.stdin?.write(`${JSON.stringify(command)}\n`, (error) => {
        if (error == null) return;
        this.fail(error);
      });
    });
  }

  async shutdown(): Promise<boolean> {
    if (this.#active !== undefined) throw new Error(`Cannot drain active v12 compiler lane ${this.laneId.toString()}.`);
    if (this.#cleanup !== undefined) return this.#cleanup;
    this.#cleanup = this.drainAndClose();
    return this.#cleanup;
  }

  async abort(reason: string): Promise<boolean> {
    this.#cleanup ??= this.terminateOwnedGroup(reason);
    return this.#cleanup;
  }

  private readonly receiveStdout = (chunk: Buffer): void => {
    this.#stdoutRemainder += chunk.toString('utf8');
    if (Buffer.byteLength(this.#stdoutRemainder) > LANE_CAPTURE_LIMIT_BYTES) {
      this.fail(new Error(`v12 compiler lane ${this.laneId.toString()} stdout exceeded its protocol limit.`));
      return;
    }
    let newline = this.#stdoutRemainder.indexOf('\n');
    while (newline >= 0) {
      const line = this.#stdoutRemainder.slice(0, newline);
      this.#stdoutRemainder = this.#stdoutRemainder.slice(newline + 1);
      newline = this.#stdoutRemainder.indexOf('\n');
      if (line.length === 0) continue;
      try {
        this.receiveMessage(JSON.parse(line) as PreviewTsxCorpusCompilerLaneMessage);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };

  private receiveMessage(message: PreviewTsxCorpusCompilerLaneMessage): void {
    if (message.version !== 12) throw new Error('Invalid v12 compiler lane message version.');
    if (message.kind === 'ready') {
      if (this.#readySettled || this.#active !== undefined) throw new Error('Duplicate or late v12 compiler ready message.');
      this.#resolveReady();
      return;
    }
    if (message.kind === 'drained') {
      this.#resolveDrained();
      return;
    }
    const active = this.#active;
    if (active === undefined || message.commandId !== active.commandId) throw new Error('Uncorrelated v12 compiler lane message.');
    clearTimeout(active.deadline);
    this.#active = undefined;
    if (message.kind === 'compiled') active.resolve(message);
    else active.reject(new V12CompileStageError(message.stage, `${message.errorName}: ${message.error}`));
  }

  private fail(error: Error): void {
    if (!this.#readySettled) this.#rejectReady(error);
    this.failActive(error);
    void this.abort(error.message);
  }

  private failActive(error: Error): void {
    const active = this.#active;
    if (active === undefined) return;
    clearTimeout(active.deadline);
    this.#active = undefined;
    active.reject(error);
  }

  private async drainAndClose(): Promise<boolean> {
    await this.#ready;
    if (this.#closeObserved) return this.probeGroupAbsent();
    if (this.child.stdin == null || this.child.stdin.destroyed) return this.terminateOwnedGroup('v12 compiler stdin unavailable during drain.');
    this.child.stdin.write(`${JSON.stringify({ kind: 'shutdown', version: 12 })}\n`);
    if (!await this.waitFor(this.#drained, 10_000)) return this.terminateOwnedGroup('v12 compiler drain acknowledgement timed out.');
    if (!await this.waitFor(this.#close, 10_000)) return this.terminateOwnedGroup('v12 compiler process did not close after drain.');
    return this.waitForGroupAbsence();
  }

  private async terminateOwnedGroup(_reason: string): Promise<boolean> {
    if (!this.#closeObserved) {
      this.signalOwnedGroup('SIGTERM');
      if (!await this.waitFor(this.#close, 5_000)) {
        this.signalOwnedGroup('SIGKILL');
        await this.waitFor(this.#close, 5_000);
      }
    }
    return this.waitForGroupAbsence();
  }

  private signalOwnedGroup(signal: NodeJS.Signals): void {
    const pid = this.child.pid;
    if (pid === undefined) return;
    try {
      if (process.platform === 'win32') this.child.kill(signal);
      else process.kill(-pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }

  private probeGroupAbsent(): boolean {
    const pid = this.child.pid;
    if (pid === undefined) return this.#closeObserved;
    try {
      if (process.platform === 'win32') process.kill(pid, 0);
      else process.kill(-pid, 0);
      return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
      throw error;
    }
  }

  private async waitForGroupAbsence(): Promise<boolean> {
    const deadline = Date.now() + 5_000;
    while (!this.probeGroupAbsent() && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    return this.probeGroupAbsent();
  }

  private async waitFor(completion: Promise<void>, timeoutMs: number): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
    const completed = completion.then(() => true);
    try {
      return await Promise.race([completed, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

interface V12RowClassification {
  readonly category: PreviewTsxCorpusCategory;
  readonly cleanupConfirmed: boolean;
  readonly index: number;
  readonly path: string;
  readonly reason: string;
}

interface V12ProgressRuntimeState {
  readonly claimedRows: number;
  readonly compilerLanesDone: number;
  readonly fatal: unknown;
  readonly queueRows: number;
  readonly reservations: number;
}

interface V12ProgressCommittedState {
  readonly categoryCounts: Readonly<Record<PreviewTsxCorpusCategory, number>>;
  readonly terminalRows: number;
}

const V12_PROGRESS_BATCH_ROWS = 25;
const V12_PROGRESS_MAX_DELAY_MS = 1_000;

function emptyPreviewTsxCorpusCategoryCounts(): Record<PreviewTsxCorpusCategory, number> {
  return {
    Unrendered: 0,
    'blank/empty output': 0,
    blocker: 0,
    'explicitly structurally non-renderable': 0,
    'incomplete page composition': 0,
    'runtime/build failure': 0,
    'successful meaningful render': 0,
  };
}

/**
 * Persists v12 terminal classifications without rewriting the growing row inventory.
 * The append-only journal owns file-level evidence while the small atomic report owns
 * live counts and a checksum for the exact durable journal prefix it summarizes.
 */
class V12ProgressCheckpointWriter {
  readonly #categoryCounts = emptyPreviewTsxCorpusCategoryCounts();
  readonly #journalPath: string;
  readonly #progressPath: string;
  readonly #seen = new Set<number>();
  #closed = false;
  #committedRows = 0;
  #failure: unknown;
  #journalBytes = 0;
  #journalHash = createHash('sha256');
  #lastCommittedAt: number | undefined;
  #lastCommittedIndex: number | undefined;
  #pending: Array<V12RowClassification & { readonly terminalAt: number; readonly version: 1 }> = [];
  #revision = 0;
  #serial: Promise<void> = Promise.resolve();
  #timer: NodeJS.Timeout | undefined;

  constructor(
    readonly options: {
      readonly campaignId: string;
      readonly candidate: string;
      readonly compilerLaneCount: number;
      readonly engineDigest: string;
      readonly onError: (error: unknown) => void;
      readonly policyDigest: string;
      readonly root: string;
      readonly runtimeState: () => V12ProgressRuntimeState;
      readonly startedAt: number;
      readonly totalRows: number;
      readonly windowStart: number;
    },
  ) {
    this.#journalPath = path.join(options.root, 'candidate-progress-classifications.jsonl');
    this.#progressPath = path.join(options.root, 'candidate-progress-report.json');
  }

  async initialize(): Promise<void> {
    const reference = await writePreviewTsxCorpusArtifactAtomic(this.#journalPath, Buffer.alloc(0));
    const emptyDigest = this.#journalHash.copy().digest('hex');
    if (reference.bytes !== 0 || reference.sha256 !== emptyDigest) {
      throw new Error('v12 progress journal initialization verification failed.');
    }
    await this.enqueueFlush(true);
  }

  record(classification: V12RowClassification): void {
    if (this.#closed) throw new Error('v12 progress checkpoint received a row after close.');
    if (this.#failure !== undefined) throw this.#failure;
    if (this.#seen.has(classification.index)) {
      throw new Error(`Duplicate v12 progress classification ${classification.index.toString()}.`);
    }
    this.#seen.add(classification.index);
    this.#pending.push({ ...classification, terminalAt: Date.now(), version: 1 });
    this.scheduleFlush(this.#pending.length >= V12_PROGRESS_BATCH_ROWS ? 0 : V12_PROGRESS_MAX_DELAY_MS);
  }

  async finish(): Promise<V12ProgressCommittedState> {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    await this.enqueueFlush(true);
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    this.#closed = true;
    return {
      categoryCounts: { ...this.#categoryCounts },
      terminalRows: this.#committedRows,
    };
  }

  private scheduleFlush(delayMs: number): void {
    if (this.#timer !== undefined) {
      if (delayMs !== 0) return;
      clearTimeout(this.#timer);
    }
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.enqueueFlush(false).catch(() => undefined);
    }, delayMs);
  }

  private enqueueFlush(forceSnapshot: boolean): Promise<void> {
    const operation = this.#serial.then(async () => {
      if (this.#failure !== undefined) throw this.#failure;
      await this.commitPending(forceSnapshot);
    });
    this.#serial = operation.catch((error: unknown) => {
      if (this.#failure === undefined) {
        this.#failure = error;
        this.options.onError(error);
      }
    });
    return operation;
  }

  private async commitPending(forceSnapshot: boolean): Promise<void> {
    const batch = this.#pending.splice(0);
    if (batch.length !== 0) {
      const bytes = Buffer.from(`${batch.map((record) => JSON.stringify(record)).join('\n')}\n`);
      await appendFile(this.#journalPath, bytes, { flush: true });
      this.#journalHash.update(bytes);
      this.#journalBytes += bytes.byteLength;
      for (const record of batch) {
        this.#categoryCounts[record.category] += 1;
        this.#committedRows += 1;
        this.#lastCommittedAt = record.terminalAt;
        this.#lastCommittedIndex = record.index;
      }
    }
    if (batch.length === 0 && !forceSnapshot) return;
    await this.writeSnapshot();
    if (this.#pending.length !== 0 && this.#timer === undefined) {
      this.scheduleFlush(
        this.#pending.length >= V12_PROGRESS_BATCH_ROWS ? 0 : V12_PROGRESS_MAX_DELAY_MS,
      );
    }
  }

  private async writeSnapshot(): Promise<void> {
    const runtime = this.options.runtimeState();
    const claimedRows = Math.min(this.options.totalRows, runtime.claimedRows);
    this.#revision += 1;
    const report = {
      campaignId: this.options.campaignId,
      candidate: this.options.candidate,
      categoryCounts: { ...this.#categoryCounts },
      checkpointPolicy: {
        maxBatchRows: V12_PROGRESS_BATCH_ROWS,
        maxDelayMs: V12_PROGRESS_MAX_DELAY_MS,
      },
      classifications: {
        artifact: path.basename(this.#journalPath),
        bytes: this.#journalBytes,
        records: this.#committedRows,
        sha256: this.#journalHash.copy().digest('hex'),
      },
      complete:
        this.#committedRows === this.options.totalRows &&
        runtime.compilerLanesDone === this.options.compilerLaneCount &&
        runtime.fatal === undefined,
      engineDigest: this.options.engineDigest,
      fatal:
        runtime.fatal instanceof Error
          ? { message: runtime.fatal.message, name: runtime.fatal.name }
          : runtime.fatal === undefined
            ? null
            : String(runtime.fatal),
      lastCommittedAt: this.#lastCommittedAt ?? null,
      lastCommittedIndex: this.#lastCommittedIndex ?? null,
      policyDigest: this.options.policyDigest,
      progress: {
        claimedRows,
        compilerLanesDone: runtime.compilerLanesDone,
        inFlightRows: Math.max(0, claimedRows - this.#committedRows),
        queueRows: runtime.queueRows,
        remainingRows: this.options.totalRows - this.#committedRows,
        reservations: runtime.reservations,
        terminalRows: this.#committedRows,
        totalRows: this.options.totalRows,
      },
      revision: this.#revision,
      startedAt: this.options.startedAt,
      updatedAt: Date.now(),
      version: 12 as const,
      windowStart: this.options.windowStart,
    };
    const checksum = await writePreviewTsxCorpusJsonAtomic(this.#progressPath, report);
    await writePreviewTsxCorpusJsonAtomic(`${this.#progressPath}.checksum.json`, checksum);
  }
}

async function runV12Candidate(
  context: { readonly artifacts: string; readonly chromiumPath: string; readonly engineDigest: string; readonly manifest: readonly PreviewTsxCorpusManifestRow[]; readonly root: string; readonly runtimePath: string; readonly semanticKey: string; readonly sourceRoot: string; readonly windowRows: number; readonly windowStart: number; readonly workspace: string }, lanes: number, renderSlots: number,
): Promise<{ readonly candidate: string; readonly gates: Readonly<Record<string, boolean>>; readonly ratePerMinute: number; readonly status: 'failed' | 'safe-sub-100' | 'selected'; readonly terminalRows: number; readonly version: 12 }> {
  await mkdir(context.root, { recursive: true });
  const pendingRows = Array.from(
    { length: context.windowRows },
    (_, offset) => context.windowStart + offset,
  );
  // Row zero owns an unusually broad automatic-search frontier when compiled
  // cold. Admit it after the shared project caches have received initial work,
  // without pinning seven unrelated rows behind the same compiler process.
  const rowZeroOffset = pendingRows.indexOf(0);
  if (rowZeroOffset >= 0) {
    pendingRows.splice(rowZeroOffset, 1);
    pendingRows.splice(Math.min(lanes, pendingRows.length), 0, 0);
  }
  const queue: Array<{ readonly descriptor: PreviewTsxCorpusSpoolDescriptor; readonly admittedAt: number; readonly compileStarted: number; readonly compileFinished: number }> = [];
  const events: Array<Record<string, unknown>> = [];
  const terminal = new Set<number>(); const compilerIntervals: Array<[number, number]> = []; const renderIntervals: Array<[number, number]> = [];
  const warmupIntervals: Array<[number, number]> = [];
  const compilerProcesses = Array.from({ length: lanes }, (_, laneId) => new V12CompilerProcess(context.runtimePath, laneId));
  const compilerCleanups = Array.from({ length: lanes }, () => false);
  const retiredCompilerCleanups: boolean[] = [];
  const deadlineCleanups: boolean[] = [];
  const rowFailures: Array<Record<string, unknown>> = [];
  const rowClassifications: V12RowClassification[] = [];
  // A reservation covers active compilation as well as durable render handoff.
  // Basing this only on renderer count silently capped a 16-lane compiler pool
  // at ten active rows. Keep every compiler admissible and retain one bounded
  // renderer-sized handoff cushion; the independent byte ceiling remains the
  // hard payload bound.
  const reservationLimit = lanes + renderSlots;
  let unclaimed = 0; let bytes = 0; let compilersDone = 0; let fatal: unknown; let reservations = 0;
  let highCount = 0; let highBytes = 0; let queueHighCount = 0;
  let wake!: () => void; let changed = new Promise<void>((resolve) => { wake = resolve; });
  const signal = (): void => { wake(); changed = new Promise<void>((resolve) => { wake = resolve; }); };
  const wait = async (): Promise<void> => changed;
  const campaignId = randomUUID(); const candidateStartedAt = Date.now(); let barrier = candidateStartedAt; let finishedAt = 0;
  const fail = (error: unknown): void => { fatal ??= error; signal(); };
  const progressWriter = new V12ProgressCheckpointWriter({
    campaignId,
    candidate: `${lanes}x${renderSlots}`,
    compilerLaneCount: lanes,
    engineDigest: context.engineDigest,
    onError: fail,
    policyDigest: context.semanticKey,
    root: context.root,
    runtimeState: () => ({
      claimedRows: unclaimed,
      compilerLanesDone: compilersDone,
      fatal,
      queueRows: queue.length,
      reservations,
    }),
    startedAt: candidateStartedAt,
    totalRows: context.windowRows,
    windowStart: context.windowStart,
  });
  await progressWriter.initialize();
  const acquireReservation = async (): Promise<void> => {
    while (reservations >= reservationLimit || bytes >= PREVIEW_TSX_CORPUS_SPOOL_LIMIT_BYTES) {
      if (fatal !== undefined) throw fatal;
      await wait();
    }
    if (fatal !== undefined) throw fatal;
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
    let compiler = compilerProcesses[laneId]!; let generation = 1; let generationRows = 0;
    try {
      for (;;) {
        // Claim one row at a time so a slow file cannot strand the remaining
        // rows in an eight-row lane-local chunk while other compilers go idle.
        const index = pendingRows[unclaimed++]; if (index === undefined) break;
        // Three rows was the faster of the closed 240-row measurements because longer-lived
        // project/vendor caches increased aggregate memory contention. Rotation happens only after
        // another row has been claimed, so the final generation is not spawned merely to shut down.
        if (generationRows >= FILTERED_COMPILER_GENERATION_ROWS) {
          const cleanupConfirmed = await compiler.shutdown();
          retiredCompilerCleanups.push(cleanupConfirmed);
          if (!cleanupConfirmed) throw new Error(`v12 retired compiler lane ${laneId.toString()} left an owned process group.`);
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
            const request = await v12Request(context.manifest[index]!, context.sourceRoot, context.workspace);
            const identity = { attemptId: randomUUID(), campaignId, candidate: `${lanes}x${renderSlots}`, engineDigest: context.engineDigest, generationId: `${laneId}-g${generation.toString()}`, laneId, policyDigest: context.semanticKey, row: index, sourceDigest: context.manifest[index]!.sha256 };
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
            await readPreviewTsxCorpusSpool(descriptor, identity); // durable supervisor acknowledgement
            if (fatal !== undefined) throw fatal;
            if (bytes + descriptor.bundleBytes > PREVIEW_TSX_CORPUS_SPOOL_LIMIT_BYTES) throw new Error('v12 durable spool byte ceiling would be exceeded.');
            bytes += descriptor.bundleBytes;
            highBytes = Math.max(highBytes, bytes);
            queue.push({ admittedAt, compileFinished: message.compileFinishedAt, compileStarted: message.compileStartedAt, descriptor });
            queueHighCount = Math.max(queueHighCount, queue.length);
            handedOff = true;
            generationRows += 1;
            events.push({ index, laneId, stage: 'compile-handoff-acknowledged', at: Date.now() });
            signal();
          } catch (error) {
            if (!handedOff) {
              if (descriptor !== undefined) await removePreviewTsxCorpusSpool(descriptor).catch(() => undefined);
              releaseReservation();
            }
            if (error instanceof V12CompileDeadlineError || (error instanceof V12CompileStageError && error.stage === 'compile')) {
              let cleanupConfirmed = true;
              if (error instanceof V12CompileDeadlineError) {
                cleanupConfirmed = await compiler.abort(error.message);
                deadlineCleanups.push(cleanupConfirmed);
                retiredCompilerCleanups.push(cleanupConfirmed);
                if (!cleanupConfirmed) throw new Error(`v12 timed-out compiler lane ${laneId.toString()} left an owned process group.`);
                compiler = new V12CompilerProcess(context.runtimePath, laneId);
                compilerProcesses[laneId] = compiler;
                generation += 1;
                generationRows = 0;
              }
              if (terminal.has(index)) throw new Error(`Duplicate v12 compile-failure terminal ${index.toString()}.`);
              const at = Date.now();
              terminal.add(index);
              finishedAt = at;
              rowFailures.push({
                category: 'runtime/build failure', cleanupConfirmed, deadline: error instanceof V12CompileDeadlineError,
                error: error.message.slice(0, 16_384), index, laneId, path: context.manifest[index]!.path,
              });
              const classification: V12RowClassification = {
                category: 'runtime/build failure',
                cleanupConfirmed,
                index,
                path: context.manifest[index]!.path,
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
        if (!compilerCleanups[laneId]) fail(new Error(`v12 compiler lane ${laneId.toString()} left an owned process group.`));
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
      const item = queue.shift(); if (item === undefined) { if (fatal !== undefined || compilersDone === lanes) return; continue; }
      try {
        const envelope = await readPreviewTsxCorpusSpool(item.descriptor, { attemptId: item.descriptor.attemptId, campaignId, candidate: `${lanes}x${renderSlots}`, engineDigest: context.engineDigest, generationId: item.descriptor.generationId, laneId: item.descriptor.laneId, policyDigest: context.semanticKey, row: item.descriptor.row, sourceDigest: item.descriptor.sourceDigest });
        const start = Date.now(); const result = await renderCompiledPreviewHeadlessly(envelope.bundle, envelope.request, { chromiumPath: context.chromiumPath, timeoutMs: 30_000, virtualTimeMs: 5_000 }); const end = Date.now(); renderIntervals.push([start, end]);
        const cleanupConfirmed = result.cleanup.browserTerminated && result.cleanup.profileRemoved && result.cleanup.serverClosed;
        if (!cleanupConfirmed) throw new Error(`v12 renderer cleanup failure for row ${item.descriptor.row.toString()}: ${JSON.stringify(result.cleanup)}`);
        if (end > item.admittedAt + 90_000) {
          if (terminal.has(item.descriptor.row)) throw new Error(`Duplicate v12 render-deadline terminal ${item.descriptor.row.toString()}.`);
          terminal.add(item.descriptor.row);
          finishedAt = end;
          deadlineCleanups.push(true);
          rowFailures.push({
            category: 'runtime/build failure', cleanupConfirmed: true, deadline: true,
            error: 'The combined compile, spool, queue, and render path exceeded 90 seconds.', index: item.descriptor.row,
            path: context.manifest[item.descriptor.row]!.path, workerId,
          });
          const classification: V12RowClassification = {
            category: 'runtime/build failure',
            cleanupConfirmed: true,
            index: item.descriptor.row,
            path: context.manifest[item.descriptor.row]!.path,
            reason: 'The combined compile, spool, queue, and render path exceeded 90 seconds.',
          };
          rowClassifications.push(classification);
          progressWriter.record(classification);
          events.push({ at: end, index: item.descriptor.row, stage: 'render-deadline-terminal', workerId });
          await removePreviewTsxCorpusSpool(item.descriptor); bytes -= item.descriptor.bundleBytes; releaseReservation();
          continue;
        }
        if (terminal.has(item.descriptor.row)) throw new Error(`Duplicate v12 durable terminal ${item.descriptor.row}.`);
        const classification = classifyHeadlessResult(
          result,
          context.manifest[item.descriptor.row]!,
          context.sourceRoot,
        );
        const durableClassification: V12RowClassification = {
          ...classification,
          cleanupConfirmed: true,
          index: item.descriptor.row,
          path: context.manifest[item.descriptor.row]!.path,
        };
        rowClassifications.push(durableClassification);
        progressWriter.record(durableClassification);
        terminal.add(item.descriptor.row); finishedAt = end; events.push({ index: item.descriptor.row, workerId, stage: 'durable-terminal', at: end });
        await removePreviewTsxCorpusSpool(item.descriptor); bytes -= item.descriptor.bundleBytes; releaseReservation();
      } catch (error) {
        await removePreviewTsxCorpusSpool(item.descriptor).catch(() => undefined);
        bytes = Math.max(0, bytes - item.descriptor.bundleBytes);
        releaseReservation();
        fail(error);
        return;
      }
    }
  };
  await Promise.all([...Array.from({ length: renderSlots }, (_, workerId) => renderer(workerId)), ...Array.from({ length: lanes }, (_, laneId) => compilerLane(laneId))]);
  while (queue.length !== 0) {
    const item = queue.shift()!;
    await removePreviewTsxCorpusSpool(item.descriptor).catch(() => undefined);
    bytes = Math.max(0, bytes - item.descriptor.bundleBytes);
    releaseReservation();
  }
  const progress = await progressWriter.finish();
  const elapsed = finishedAt === 0 ? 0 : Math.max(1, finishedAt - barrier); const rate = terminal.size === context.windowRows ? context.windowRows * 60_000 / elapsed : 0;
  const wallElapsed = finishedAt === 0 ? 0 : Math.max(1, finishedAt - candidateStartedAt);
  const wallRate = terminal.size === context.windowRows ? context.windowRows * 60_000 / wallElapsed : 0;
  const overlap = compilerIntervals.some(([a, b]) => renderIntervals.some(([c, d]) => a < d && c < b));
  const allCompilerCleanups = compilerCleanups.every(Boolean) && retiredCompilerCleanups.every(Boolean);
  const gates = { backpressure: highCount <= reservationLimit && highBytes <= PREVIEW_TSX_CORPUS_SPOOL_LIMIT_BYTES, cleanup: fatal === undefined && allCompilerCleanups, deadlines: deadlineCleanups.every(Boolean), identity: true, lifecycle: compilersDone === lanes && queue.length === 0 && bytes === 0 && reservations === 0 && allCompilerCleanups, overlap, terminals: terminal.size === context.windowRows };
  const status = Object.values(gates).every(Boolean) && rate >= FILTERED_MINIMUM_TERMINAL_RATE_PER_MINUTE ? 'selected' : Object.values(gates).every(Boolean) ? 'safe-sub-100' : 'failed';
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
    candidate: `${lanes}x${renderSlots}`,
    candidateStartedAt,
    categoryCounts,
    classifications,
    compilerIntervals,
    events,
    fatal: fatal instanceof Error ? { message: fatal.message, name: fatal.name, stack: fatal.stack } : fatal === undefined ? null : String(fatal),
    gates,
    measurementStartedAt: barrier,
    ratePerMinute: rate,
    renderIntervals,
    rowFailures,
    spool: { highBytes, highCount, limitBytes: PREVIEW_TSX_CORPUS_SPOOL_LIMIT_BYTES, limitCount: reservationLimit, queueHighCount },
    status,
    terminalRows: terminal.size,
    wallElapsedMs: wallElapsed,
    wallRatePerMinute: wallRate,
    warmupElapsedMs: barrier - candidateStartedAt,
    warmupIntervals,
    version: 12 as const,
  };
  const terminalPath = path.join(context.root, 'candidate-terminal-report.json'); const checksum = await writePreviewTsxCorpusJsonAtomic(terminalPath, report); await writePreviewTsxCorpusJsonAtomic(`${terminalPath}.checksum.json`, checksum); await readPreviewTsxCorpusChecksummedJson(terminalPath);
  return { candidate: report.candidate, gates, ratePerMinute: rate, status, terminalRows: terminal.size, version: 12 };
}

interface V11Reference { readonly semanticKey: string; readonly signature: Readonly<Record<string, unknown>>; }

class V11CandidateLifecycle {
  readonly ownedLanes = new Set<PrimaryLane>();
  readonly terminalIndices = new Set<number>();
  readonly taskRegistry = new Map<string, 'pending' | 'rejected' | 'fulfilled'>();
  readonly workCompletion: Promise<void>;
  readonly closedCompletion: Promise<void>;
  watchdog: NodeJS.Timeout | undefined;
  fatal: unknown;
  state: 'initializing' | 'starting' | 'measuring' | 'draining' | 'reporting' | 'closed' = 'initializing';
  measurementStartedAt: number | undefined;
  terminalCommittedAt: number | undefined;
  #resolveClosed!: () => void;
  #resolveWork!: () => void;
  #rejectWork!: (error: Error) => void;
  #workSettled = false;
  constructor(readonly laneCount: 12 | 14 | 16) {
    this.workCompletion = new Promise((resolve, reject) => { this.#resolveWork = resolve; this.#rejectWork = reject; });
    this.closedCompletion = new Promise((resolve) => { this.#resolveClosed = resolve; });
  }
  register<T>(name: string, task: Promise<T>): Promise<T> {
    if (this.taskRegistry.has(name)) throw new Error(`Duplicate v11 lifecycle task: ${name}`);
    this.taskRegistry.set(name, 'pending');
    return task.then(
      (value) => { this.taskRegistry.set(name, 'fulfilled'); return value; },
      (error: unknown) => { this.taskRegistry.set(name, 'rejected'); this.fail(error); throw error; },
    );
  }
  fail(error: unknown): void {
    if (this.fatal !== undefined) return;
    this.fatal = error;
    // Before dispatch there is no work waiter yet. The enclosing candidate path
    // observes this startup fatal synchronously and still closes its report.
    if (this.state !== 'measuring') return;
    if (!this.#workSettled) { this.#workSettled = true; this.#rejectWork(error instanceof Error ? error : new Error(String(error))); }
  }
  terminal(index: number, committedAt: number): void {
    if (index < 0 || index >= 240 || this.terminalIndices.has(index)) throw new Error(`Invalid duplicate/out-of-range v11 terminal ${index}.`);
    this.terminalIndices.add(index);
    if (this.terminalIndices.size === 240) {
      this.terminalCommittedAt = committedAt;
      this.#workSettled = true;
      this.#resolveWork();
    }
  }
  close(): void { this.state = 'closed'; this.#resolveClosed(); }
}

class V11IsolationArbiter {
  #active = false;
  #queue: Array<() => void> = [];
  async run<T>(operation: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => { this.#queue.push(resolve); this.pump(); });
    try { return await operation(); } finally { this.#active = false; this.pump(); }
  }
  private pump(): void { if (this.#active) return; const next = this.#queue.shift(); if (next === undefined) return; this.#active = true; next(); }
}

async function createV11Reference(state: CampaignState, root: string): Promise<V11Reference> {
  const referencePath = path.join(root, 'reference', 'reference.json');
  const semanticKey = digestJson({ chromiumPath: path.resolve(state.options.chromiumPath), classifierDigest: state.identity.classifierDigest, engineDigest: state.identity.engineDigest, manifestSha256: state.identity.manifestSha256, policyDigest: state.identity.policyDigest, sourceRoot: state.identity.sourceRoot, timeoutMs: PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY.rendererDeadlineMs, virtualTimeMs: 5_000, workspace: state.identity.workspace });
  const cached = await readJsonIfPresent<{ readonly semanticKey: string; readonly signature: Readonly<Record<string, unknown>> }>(referencePath);
  if (cached !== undefined) {
    if (cached.semanticKey !== semanticKey) throw new Error('v11 cached reference semantic identity mismatch.');
    await readPreviewTsxCorpusChecksummedJson(referencePath);
    return cached;
  }
  const fresh = new PrimaryLane(state, 90_000);
  let deadline: NodeJS.Timeout | undefined;
  try {
    const deadlinePromise = new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('v11 fresh reference deadline expired.')), 120_000); });
    const outcome = await Promise.race([fresh.run(state.sentinelIndices[0]!), deadlinePromise]);
    await persistSentinelOutcome(state, fresh, 'start', 'fresh', outcome);
    fresh.ack(outcome.index);
    const cleanup = await fresh.drainShutdown();
    if (!cleanup.closeObserved || !cleanup.groupAbsent || !cleanup.listenersDetached || !cleanup.streamsTerminal) throw new Error('v11 fresh reference cleanup was inconclusive.');
    const signature = semanticSentinelSignature(outcome.result);
    if (!strictCorridorSignature(signature)) throw new Error('v11 fresh reference lacks strict Page Context fidelity.');
    const reference = { cleanup, semanticKey, signature, version: 11 };
    const checksum = await writePreviewTsxCorpusJsonAtomic(referencePath, reference);
    await writePreviewTsxCorpusJsonAtomic(`${referencePath}.checksum.json`, checksum);
    await readPreviewTsxCorpusChecksummedJson(referencePath);
    return { semanticKey, signature };
  } catch (error) {
    await fresh.abort('v11 fresh reference failed.');
    throw error;
  } finally { if (deadline !== undefined) clearTimeout(deadline); }
}

async function certifyV11Sentinel(state: CampaignState, lane: PrimaryLane, reference: V11Reference, boundary: 'drain' | 'start'): Promise<boolean> {
  for (const index of state.sentinelIndices) {
    const outcome = await lane.run(index);
    await persistSentinelOutcome(state, lane, boundary, 'warm', outcome);
    lane.ack(index);
    const matched = digestJson(semanticSentinelSignature(outcome.result)) === digestJson(reference.signature) && strictCorridorSignature(semanticSentinelSignature(outcome.result));
    await writeJsonAtomic(path.join(state.options.artifacts, 'sentinels', lane.generationId, boundary, `${pad(index)}.comparison.json`), { index, matched, reference: reference.signature, version: 11 });
    if (!matched) return false;
  }
  return true;
}

async function runV11ThroughputCandidate(state: CampaignState, laneCount: 12 | 14 | 16, reference: V11Reference, root: string): Promise<PreviewTsxCorpusV11CandidateTerminalReport> {
  const lifecycle = new V11CandidateLifecycle(laneCount);
  lifecycle.watchdog = setTimeout(() => lifecycle.fail(new Error('v11 candidate watchdog expired.')), 60 * 60_000);
  const resources = new CampaignResourceSupervisor(state, lifecycle.ownedLanes);
  const isolation = new V11IsolationArbiter();
  const rows: Promise<void>[] = [];
  const startCertificates: Array<{ readonly lane: number; readonly matched: boolean }> = [];
  const drainCertificates: Array<{ readonly lane: number; readonly matched: boolean; readonly cleanup: LaneCleanup }> = [];
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
      lane.child.once('close', () => { if (lifecycle.ownedLanes.has(lane) && lifecycle.state !== 'draining' && lifecycle.state !== 'reporting' && lifecycle.state !== 'closed') lifecycle.fail(new Error(`v11 lane ${laneId} closed before its registered drain.`)); });
      const matched = await lifecycle.register(`start-sentinel-${laneId}`, certifyV11Sentinel(state, lane, reference, 'start'));
      startCertificates.push({ lane: laneId, matched });
      if (!matched) throw new Error(`v11 lane ${laneId} failed start sentinel.`);
    }
    lifecycle.state = 'measuring';
    lifecycle.measurementStartedAt = Date.now();
    for (const lane of lifecycle.ownedLanes) {
      const task = lifecycle.register(`row-loop-${lane.laneId}`, (async () => {
        for (;;) {
          if (lifecycle.fatal !== undefined) throw lifecycle.fatal;
          await resources.beforeClaim();
          const index = nextIndex;
          nextIndex += 1;
          if (index >= 240) return;
          let primary: PreviewTsxCorpusAttemptRecord;
          try { primary = await persistPrimaryLaneOutcome(state, index, await lane.run(index)); }
          catch (error) { if (error instanceof LaneRowFailure) await persistPrimaryLaneFailure(state, index, error); throw error; }
          let attempts: readonly PreviewTsxCorpusAttemptRecord[] = [primary];
          if (attemptRequiresIsolation(primary)) {
            const isolated = await lifecycle.register(`isolation-${index}`, isolation.run(() => runAttempt(state, index, 'isolated')));
            if (!isolatedCanBecomeCanonical(isolated)) throw new Error(`v11 isolated attempt for ${index} was not terminal.`);
            attempts = [primary, isolated];
          }
          const committedAt = await writeCanonical(state, index, attempts);
          if (committedAt === undefined) throw new Error(`v11 duplicate durable terminal ${index}.`);
          lane.ack(index);
          lifecycle.terminal(index, committedAt);
        }
      })());
      rows.push(task);
    }
    await lifecycle.workCompletion;
    await Promise.all(rows);
    if (lifecycle.fatal !== undefined) throw lifecycle.fatal;
    lifecycle.state = 'draining';
    for (const lane of [...lifecycle.ownedLanes]) {
      const matched = await lifecycle.register(`drain-sentinel-${lane.laneId}`, certifyV11Sentinel(state, lane, reference, 'drain'));
      const cleanup = await lifecycle.register(`drain-${lane.laneId}`, lane.drainShutdown());
      lifecycle.ownedLanes.delete(lane);
      drainCertificates.push({ cleanup, lane: lane.laneId, matched });
      if (!matched || !cleanup.closeObserved || !cleanup.groupAbsent || !cleanup.listenersDetached || !cleanup.streamsTerminal) throw new Error(`v11 lane ${lane.laneId} drain failed.`);
    }
    await resources.stop();
    resourceGate = await resources.persist(true);
    cleanupGate = drainCertificates.length === laneCount && drainCertificates.every(({ cleanup }) => cleanup.closeObserved && cleanup.groupAbsent && cleanup.listenersDetached && cleanup.streamsTerminal);
  } catch (error) {
    lifecycle.fail(error);
  } finally {
    lifecycle.state = 'reporting';
    const cleanups = await Promise.allSettled([...lifecycle.ownedLanes].map((lane) => lifecycle.register(`cleanup-${lane.laneId}`, lane.abort('v11 candidate finalization.'))));
    lifecycle.ownedLanes.clear();
    await resources.stop();
    resourceGate = await resources.persist(true);
    cleanupGate = cleanupGate || cleanups.every((entry) => entry.status === 'fulfilled' && entry.value.groupAbsent && entry.value.listenersDetached && entry.value.streamsTerminal);
    const sentinelGate = startCertificates.length === laneCount && drainCertificates.length === laneCount && startCertificates.every((entry) => entry.matched) && drainCertificates.every((entry) => entry.matched);
    const identityGate = reference.semanticKey.length > 0;
    const taskGate = [...lifecycle.taskRegistry.values()].every((status) => status !== 'pending');
    const terminalRows = lifecycle.terminalIndices.size;
    const elapsed = lifecycle.measurementStartedAt === undefined || lifecycle.terminalCommittedAt === undefined ? 0 : Math.max(1, lifecycle.terminalCommittedAt - lifecycle.measurementStartedAt);
    const rate = terminalRows === 240 ? 240 * 60_000 / elapsed : 0;
    const gates = { cleanup: cleanupGate, identity: identityGate, noOwnedProcesses: cleanups.every((entry) => entry.status === 'fulfilled' && entry.value.groupAbsent), resource: resourceGate, sentinel: sentinelGate, tasks: taskGate, terminals: terminalRows === 240, watchdog: lifecycle.fatal === undefined };
    const passed = Object.values(gates).every(Boolean) && rate >= 100;
    report = { candidate: laneCount, gates, ...(lifecycle.measurementStartedAt === undefined ? {} : { measurementStartedAt: lifecycle.measurementStartedAt }), status: passed ? 'selected' : lifecycle.fatal === undefined && Object.values(gates).every(Boolean) ? 'safe-sub-100' : 'failed', ...(lifecycle.terminalCommittedAt === undefined ? {} : { terminalCommittedAt: lifecycle.terminalCommittedAt }), terminalRows, terminalRatePerMinute: rate, version: 11 };
    const terminalPath = path.join(root, 'candidate-terminal-report.json');
    const checksum = await writePreviewTsxCorpusJsonAtomic(terminalPath, { ...report, drainCertificates, fatalCause: lifecycle.fatal instanceof Error ? lifecycle.fatal.message : lifecycle.fatal === undefined ? undefined : String(lifecycle.fatal), referenceIdentity: reference.semanticKey, startCertificates, taskRegistry: Object.fromEntries(lifecycle.taskRegistry) });
    await writePreviewTsxCorpusJsonAtomic(`${terminalPath}.checksum.json`, checksum);
    await readPreviewTsxCorpusChecksummedJson(terminalPath);
    if (lifecycle.watchdog !== undefined) clearTimeout(lifecycle.watchdog);
    lifecycle.close();
  }
  await lifecycle.closedCompletion;
  if (report === undefined) throw new Error('v11 candidate failed before terminal report closure.');
  return report;
}

async function writeV11AggregateReport(root: string, candidates: readonly PreviewTsxCorpusV11CandidateTerminalReport[], selected?: 12 | 14 | 16): Promise<void> {
  const filePath = path.join(root, 'measurement-report.json');
  const checksum = await writePreviewTsxCorpusJsonAtomic(filePath, { architectureId: PREVIEW_TSX_CORPUS_ARCHITECTURE_ID, candidates, selected: selected ?? null, version: 11 });
  await writePreviewTsxCorpusJsonAtomic(`${filePath}.checksum.json`, checksum);
  await readPreviewTsxCorpusChecksummedJson(filePath);
}

export async function verifyPreviewHeadlessTsxCorpusCampaign(options: {
  readonly baseline: string; readonly final: string; readonly manifestPath: string; readonly policyPath: string; readonly report: string;
}): Promise<void> {
  const [manifest, policy, baselineActive, finalActive] = await Promise.all([
    readFile(options.manifestPath, 'utf8'), readJsonIfPresent<PreviewTsxCorpusFrozenPolicy>(options.policyPath),
    readJsonIfPresent<{ readonly artifacts: string }>(path.join(options.baseline, 'active-campaign.json')),
    readJsonIfPresent<{ readonly artifacts: string }>(path.join(options.final, 'active-campaign.json')),
  ]);
  const [baseline, final] = await Promise.all([
    baselineActive === undefined ? undefined : readJsonIfPresent<{ readonly canonical: number; readonly pending: number; readonly policyDigest: string }>(path.join(options.baseline, baselineActive.artifacts, 'summary.json')),
    finalActive === undefined ? undefined : readJsonIfPresent<{ readonly canonical: number; readonly pending: number; readonly policyDigest: string }>(path.join(options.final, finalActive.artifacts, 'summary.json')),
  ]);
  const [baselinePerformance, finalPerformance] = await Promise.all([
    baselineActive === undefined ? undefined : readJsonIfPresent<{ readonly overallRatePerMinute: number; readonly epochs600: readonly { readonly ratePerMinute: number }[]; readonly cleanupGate: boolean; readonly identityGate: boolean; readonly resourceGate: boolean; readonly sentinelGate: boolean }>(path.join(options.baseline, baselineActive.artifacts, 'performance.json')),
    finalActive === undefined ? undefined : readJsonIfPresent<{ readonly overallRatePerMinute: number; readonly epochs600: readonly { readonly ratePerMinute: number }[]; readonly cleanupGate: boolean; readonly identityGate: boolean; readonly resourceGate: boolean; readonly sentinelGate: boolean }>(path.join(options.final, finalActive.artifacts, 'performance.json')),
  ]);
  const performancePasses = (performance: typeof baselinePerformance): boolean =>
    performance !== undefined &&
    performance.overallRatePerMinute >= 100 &&
    performance.epochs600.every((epoch) => epoch.ratePerMinute >= 100) &&
    performance.cleanupGate && performance.identityGate && performance.resourceGate && performance.sentinelGate;
  if (
    policy === undefined ||
    policy.architectureId !== PREVIEW_TSX_CORPUS_ARCHITECTURE_ID ||
    policy.pipelineDepth !== 1 ||
    policy.reuseMode !== 'persistent-compiler-fresh-browser' ||
    baseline === undefined || final === undefined ||
    parseManifest(manifest).length !== 7725 || baseline.canonical !== 7725 || final.canonical !== 7725 ||
    baseline.pending !== 0 || final.pending !== 0 || baseline.policyDigest !== policy.policyDigest ||
    final.policyDigest !== policy.policyDigest || !performancePasses(baselinePerformance) || !performancePasses(finalPerformance)
  ) {
    throw new Error('v9 verification requires two complete 7,725-row serial-policy phases with every performance gate closed.');
  }
  await writePreviewTsxCorpusJsonAtomic(path.join(options.report, 'verification.json'), { baseline, final, manifestSha256: digest(manifest), policy, version: 2 });
}

async function prepareCampaign(options: CampaignOptions): Promise<CampaignState> {
  await mkdir(options.artifacts, { recursive: true });
  const manifestSource = await readFile(options.manifestPath, 'utf8');
  const rows = parseManifest(manifestSource);
  const corridorSuffix = 'legal/right-to-consent-or-consult/pages/rtcc-investment-contract-management-page/investment-agreement-management-modals.tsx';
  const corridorMatches = rows
    .map((row, index) => ({ index, row }))
    .filter(({ row }) => row.path.endsWith(corridorSuffix));
  if (corridorMatches.length !== 1) {
    throw new Error(`v9 mandatory corridor resolution expected one match, found ${corridorMatches.length}.`);
  }
  const corridor = corridorMatches[0];
  if (corridor === undefined || !/^[a-f0-9]{64}$/u.test(corridor.row.sha256)) {
    throw new Error('v9 mandatory corridor digest is absent or invalid.');
  }
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
  let selectedLaneCount: 12 | 14 | 16 | undefined;
  if (options.policyPath !== undefined) {
    const frozen = await readJsonIfPresent<PreviewTsxCorpusFrozenPolicy>(options.policyPath);
    if (
      frozen === undefined ||
      frozen.architectureId !== PREVIEW_TSX_CORPUS_ARCHITECTURE_ID ||
      frozen.version !== PREVIEW_TSX_CORPUS_CAMPAIGN_SCHEMA_VERSION ||
      frozen.protocolVersion !== 3 ||
      frozen.pipelineDepth !== 1 ||
      frozen.manifestSha256 !== manifestSha256 ||
      frozen.engineDigest !== engineDigest ||
      frozen.policyDigest !== policyDigest ||
      frozen.reuseMode !== 'persistent-compiler-fresh-browser' ||
      (options.primaryJobs !== undefined && frozen.laneCount !== options.primaryJobs) ||
      frozen.sentinels.length === 0 ||
      !frozen.sentinels.some((sentinel) => sentinel.index === corridor.index && sentinel.digest === corridor.row.sha256)
    ) throw new Error('Frozen v9 policy does not match the exact runtime, manifest, or protocol identity.');
    selectedLaneCount = frozen.laneCount;
  }
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
  return {
    identity,
    ledgerDigests,
    ledgerWriteChain: Promise.resolve(),
    options: campaignOptions,
    orderedCommits: new Map(),
    orderedFrontier: -1,
    orderedTimeline: [],
    rows,
    ...(selectedLaneCount === undefined ? {} : { selectedLaneCount }),
    sentinelIndices: [corridor.index],
    warmupBarrierEpochMs: undefined,
  };
}

async function pendingCanonicalIndices(
  state: CampaignState,
  limit: number,
): Promise<readonly number[]> {
  const pending: number[] = [];
  for (let index = 0; index < limit; index += 1) {
    if (!(await canonicalExists(state, index))) pending.push(index);
  }
  return pending;
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
  const onStdoutData = (chunk: Buffer): void => { stdout.push(chunk); };
  const onStderrData = (chunk: Buffer): void => { stderr.push(chunk); };
  const onStageData = (chunk: Buffer): void => { stages.push(chunk); };
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
      version: 3,
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
    ...(stageHistory.at(-1) === undefined ? {} : { lastStage: stageHistory.at(-1)!.stage }),
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

/** Persists a terminal persistent-lane row before its supervisor grants durable credit. */
async function persistPrimaryLaneOutcome(
  state: CampaignState,
  index: number,
  outcome: LaneRowOutcome,
): Promise<PreviewTsxCorpusAttemptRecord> {
  const row = state.rows[index];
  if (row === undefined || outcome.index !== index) throw new Error(`Primary lane outcome lost manifest identity at ${index}.`);
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
    (!rendered || (rendererCleanupConfirmed && ownership.sequenceValid && ownership.browserGroupAbsent && ownership.profilePathAbsent && ownership.serverPortClosed));
  const cleanupProof: PreviewTsxCorpusCleanupProof = {
    childCloseObserved: outcome.laneProcess.closeObserved,
    childExitBeforeClose: false,
    forcedGroupTermination: false,
    groupAbsentAfterClose: false,
    listenersDetached: false,
    normalWorkerCleanup,
    ownershipEventCount: diagnostics.ownership.length,
    ownershipSequenceValid: ownership.sequenceValid,
    preRenderCompileStarted: diagnostics.stageHistory.some((event) => event.stage === 'compile-started'),
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
    ...(diagnostics.stageHistory.at(-1) === undefined ? {} : { lastStage: diagnostics.stageHistory.at(-1)!.stage }),
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
async function persistPrimaryLaneFailure(
  state: CampaignState,
  index: number,
  failure: LaneRowFailure,
): Promise<PreviewTsxCorpusAttemptRecord> {
  const row = state.rows[index];
  if (row === undefined || failure.index !== index || failure.outcome.index !== index) {
    throw new Error(`Primary lane failure lost manifest identity at ${index}.`);
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
    preRenderCompileStarted: diagnostics.stageHistory.some((event) => event.stage === 'compile-started'),
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
  const durationMs = Math.max(
    0,
    ...failure.outcome.lifecycle.map((event) => event.elapsedMs),
  );
  const stallClassification = classifyCompilerStall(
    timedOut,
    diagnostics.stageHistory,
    diagnostics.compilerProgress,
    diagnostics.workerLifecycle,
  );
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
    ...(diagnostics.stageHistory.at(-1) === undefined ? {} : { lastStage: diagnostics.stageHistory.at(-1)!.stage }),
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

function primaryAttemptRecordPath(state: CampaignState, index: number): string {
  return path.join(state.options.artifacts, 'attempts', pad(index), 'primary.json');
}

async function certifyGenerationSentinels(
  state: CampaignState,
  lane: PrimaryLane,
  boundary: 'drain' | 'start',
): Promise<boolean> {
  const comparisons: unknown[] = [];
  for (const index of state.sentinelIndices) {
    let warm: LaneRowOutcome;
    try {
      warm = await lane.run(index);
    } catch (error) {
      if (error instanceof LaneRowFailure) {
        await persistSentinelFailure(state, lane, boundary, 'warm', error);
      }
      throw error;
    }
    await persistSentinelOutcome(state, lane, boundary, 'warm', warm);
    lane.ack(index);
    try {
      const warmSignature = semanticSentinelSignature(warm.result);
      const reference = await loadOrCreateV10Reference(state, lane, index);
      const matched = digestJson(warmSignature) === digestJson(reference) && strictCorridorSignature(warmSignature);
      const comparison = { cachedReference: reference, index, matched, warm: warmSignature };
      comparisons.push(comparison);
      const directory = path.join(state.options.artifacts, 'sentinels', lane.generationId, boundary);
      await mkdir(directory, { recursive: true });
      await writeJsonAtomic(path.join(directory, `${pad(index)}.comparison.json`), {
        ...comparison,
        sha256: digestJson(comparison),
        version: 3,
      });
      if (!matched) return false;
    } catch (error) {
      if (error instanceof LaneRowFailure) {
        await persistSentinelFailure(state, lane, boundary, 'fresh', error);
      }
      throw error;
    }
  }
  return comparisons.length === state.sentinelIndices.length;
}

/** Exactly one fresh corridor reference is retained outside candidate namespaces. */
async function loadOrCreateV10Reference(
  state: CampaignState,
  lane: PrimaryLane,
  index: number,
): Promise<Readonly<Record<string, unknown>>> {
  if (state.referenceSignature !== undefined) return state.referenceSignature;
  const cachePath = path.join(state.options.referenceRoot ?? state.options.artifacts, 'reference.json');
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
  const cached = await readJsonIfPresent<{ readonly semanticKey: string; readonly signature: Readonly<Record<string, unknown>> }>(cachePath);
  if (cached !== undefined) {
    if (cached.semanticKey !== semanticKey) throw new Error('v10 cached reference semantic identity mismatch.');
    state.referenceSignature = cached.signature;
    return cached.signature;
  }
  const fresh = new PrimaryLane(state, 10_000 + lane.laneId);
  try {
    const outcome = await fresh.run(index);
    await persistSentinelOutcome(state, lane, 'start', 'fresh', outcome);
    fresh.ack(index);
    const cleanup = await fresh.drainShutdown();
    if (!cleanup.closeObserved || !cleanup.groupAbsent || !cleanup.listenersDetached || !cleanup.streamsTerminal) {
      throw new Error('v10 fresh reference cleanup was inconclusive.');
    }
    const signature = semanticSentinelSignature(outcome.result);
    if (!strictCorridorSignature(signature)) throw new Error('v10 fresh reference lacks strict Page Context fidelity.');
    const reference = { cleanup, semanticKey, signature, version: 10 };
    const checksum = await writePreviewTsxCorpusJsonAtomic(cachePath, reference);
    await writePreviewTsxCorpusJsonAtomic(`${cachePath}.checksum.json`, { ...checksum, semanticKey, version: 10 });
    state.referenceSignature = signature;
    return signature;
  } catch (error) {
    await fresh.abort('v10 fresh reference failed.');
    throw error;
  }
}

async function persistSentinelFailure(
  state: CampaignState,
  lane: PrimaryLane,
  boundary: 'drain' | 'start',
  mode: 'fresh' | 'warm',
  failure: LaneRowFailure,
): Promise<void> {
  const outcome = failure.outcome;
  const directory = path.join(state.options.artifacts, 'sentinels', lane.generationId, boundary, mode, pad(outcome.index));
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeBufferAtomic(path.join(directory, 'stdout'), outcome.stdout),
    writeBufferAtomic(path.join(directory, 'stderr'), outcome.stderr),
    writeBufferAtomic(path.join(directory, 'stages.jsonl'), outcome.stages),
  ]);
  await writeJsonAtomic(path.join(directory, 'failure.json'), {
    cleanup: failure.cleanup,
    commandId: outcome.commandId,
    diagnosticsProtocolValid: outcome.protocolValid,
    generationId: outcome.generationId,
    index: outcome.index,
    laneProcess: outcome.laneProcess,
    lifecycle: outcome.lifecycle,
    reason: failure.message,
    truncation: outcome.truncation,
    version: 3,
  });
}

async function persistSentinelOutcome(
  state: CampaignState,
  lane: PrimaryLane,
  boundary: 'drain' | 'start',
  mode: 'fresh' | 'warm',
  outcome: LaneRowOutcome,
): Promise<void> {
  const directory = path.join(state.options.artifacts, 'sentinels', lane.generationId, boundary, mode, pad(outcome.index));
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeBufferAtomic(path.join(directory, 'stdout'), outcome.stdout),
    writeBufferAtomic(path.join(directory, 'stderr'), outcome.stderr),
    writeBufferAtomic(path.join(directory, 'stages.jsonl'), outcome.stages),
  ]);
  await writeJsonAtomic(path.join(directory, 'outcome.json'), {
    commandId: outcome.commandId,
    diagnosticsProtocolValid: outcome.protocolValid,
    generationId: outcome.generationId,
    index: outcome.index,
    result: outcome.result,
    truncation: outcome.truncation,
    version: 3,
  });
}

function semanticSentinelSignature(result: PreviewTsxCorpusWorkerResult): Readonly<Record<string, unknown>> {
  const headless = result.headless;
  const composition = headless?.stabilization?.compositionSnapshot;
  return {
    category: result.kind === 'headless-result' && headless?.status === 'ready' ? 'successful meaningful render' : 'runtime/build failure',
    errorPresence: result.error !== undefined || headless?.protocolError !== undefined || headless?.runtimeErrorText !== undefined,
    fidelity: composition?.pageExecutionFidelity,
    kind: result.kind,
    outcome: headless?.stabilizedOutcome,
    output: composition?.targetHasOutput,
    pageRoot: composition?.targetPageRootCommitted,
    source: composition?.targetSourcePath,
    stage: composition?.targetStage,
    status: headless?.status,
    target: composition?.targetExportName,
    capReached: headless?.stabilization?.capReached,
    postTerminalSnapshot: headless?.stabilization?.postTerminalSnapshotReceived,
    quiet: headless?.stabilization?.quiet,
    truncated: composition?.criticalEvidenceTruncated,
  };
}

function strictCorridorSignature(signature: Readonly<Record<string, unknown>>): boolean {
  return signature.category === 'successful meaningful render' &&
    signature.fidelity !== 'none' && signature.fidelity !== 'target-only' &&
    signature.output === true && signature.pageRoot === true;
}

function hasLaneCaptureTruncation(outcome: Pick<LaneRowOutcome, 'truncation'>): boolean {
  return outcome.truncation.stdout || outcome.truncation.stderr || outcome.truncation.stages;
}

function ownershipTransportMatches(
  observed: readonly PreviewTsxCorpusRowOwnershipEvent[],
  captured: readonly PreviewTsxCorpusRowOwnershipEvent[],
): boolean {
  return observed.length === captured.length && observed.every(
    (event, index) => JSON.stringify(event) === JSON.stringify(captured[index]),
  );
}

function confirmRendererCleanup(result: PreviewTsxCorpusWorkerResult): boolean {
  const cleanup = result.headless?.cleanup;
  return cleanup !== undefined && cleanup.browserTerminated && cleanup.profileRemoved && cleanup.serverClosed;
}

async function inspectPrimaryOwnership(
  events: readonly PreviewTsxCorpusRowOwnershipEvent[],
  stages: readonly PreviewTsxCorpusStageEvent[],
): Promise<{
  readonly browserGroupAbsent: boolean;
  readonly cleanupFacts: Partial<PreviewTsxCorpusCleanupProof>;
  readonly profilePathAbsent: boolean;
  readonly sequenceValid: boolean;
  readonly serverPortClosed: boolean;
}> {
  const rendered = stages.some((event) => event.stage === 'render-started');
  if (!rendered) {
    return {
      browserGroupAbsent: events.length === 0,
      cleanupFacts: { ownershipEventCount: events.length, ownershipSequenceValid: events.length === 0 },
      profilePathAbsent: true,
      sequenceValid: events.length === 0,
      serverPortClosed: true,
    };
  }
  const ownership = events.map((event) => event.ownership);
  const expected: readonly PreviewHeadlessOwnershipEvent['kind'][] = [
    'profile-created',
    'server-listening',
    'browser-spawned',
    'browser-terminal',
    'server-closed',
    'profile-removed',
  ];
  const profileRoot = ownership[0]?.kind === 'profile-created' ? ownership[0].profileRoot : undefined;
  const server = ownership[1];
  const spawned = ownership[2];
  const sequenceValid =
    ownership.length === expected.length &&
    profileRoot !== undefined &&
    ownership.every((event, position) => event.kind === expected[position] && event.profileRoot === profileRoot) &&
    server?.kind === 'server-listening' &&
    spawned?.kind === 'browser-spawned' &&
    typeof spawned.pgid === 'number' &&
    Number.isSafeInteger(spawned.pgid) &&
    spawned.pgid > 0;
  const browserPgid = spawned?.kind === 'browser-spawned' ? spawned.pgid : undefined;
  const loopbackPort = server?.kind === 'server-listening' ? server.loopbackPort : undefined;
  const browserGroupAbsent = sequenceValid && probePrimaryBrowserGroupAbsent(browserPgid);
  const profilePathAbsent = sequenceValid && profileRoot !== undefined && await pathIsAbsent(profileRoot);
  const serverPortClosed = sequenceValid && loopbackPort !== undefined && await loopbackPortIsClosed(loopbackPort);
  return {
    browserGroupAbsent,
    cleanupFacts: {
      ...(browserPgid === undefined ? {} : { browserPgid, browserGroupAbsent }),
      ownershipEventCount: events.length,
      ownershipSequenceValid: sequenceValid,
      ...(profileRoot === undefined ? {} : { profileRoot, profilePathAbsent }),
      ...(loopbackPort === undefined ? {} : { serverLoopbackPort: loopbackPort, serverPortClosed }),
    },
    profilePathAbsent,
    sequenceValid,
    serverPortClosed,
  };
}

function probePrimaryBrowserGroupAbsent(pgid: number | undefined): boolean {
  if (pgid === undefined || process.platform === 'win32') return pgid !== undefined;
  try {
    process.kill(-pgid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

async function pathIsAbsent(target: string): Promise<boolean> {
  try {
    await stat(target);
    return false;
  } catch (error) {
    return isMissing(error);
  }
}

async function loopbackPortIsClosed(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (closed: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      resolve(closed);
    };
    const timer = setTimeout(() => finish(false), PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY.cleanupGraceMs);
    timer.unref();
    socket.once('connect', () => finish(false));
    socket.once('error', (error: NodeJS.ErrnoException) => finish(error.code === 'ECONNREFUSED'));
  });
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
): Promise<number | undefined> {
  const row = state.rows[index];
  if (row === undefined) throw new Error(`Manifest index ${index} is absent.`);
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

function recordOrderedCommit(state: CampaignState, index: number, committedAtEpochMs: number): void {
  state.orderedCommits.set(index, committedAtEpochMs);
  for (;;) {
    const next = state.orderedFrontier + 1;
    const committedAt = state.orderedCommits.get(next);
    if (committedAt === undefined) return;
    state.orderedFrontier = next;
    state.orderedTimeline.push({ committedAtEpochMs: committedAt, index: next });
  }
}

function campaignPerformance(state: CampaignState): {
  readonly barrierEpochMs?: number;
  readonly epochs600: readonly PreviewTsxCorpusThroughputEpoch[];
  readonly overallRatePerMinute: number;
  readonly orderedCommitTimeline: readonly { readonly committedAtEpochMs: number; readonly index: number }[];
  readonly slowest240RatePerMinute: number;
  readonly windows240: readonly PreviewTsxCorpusThroughputEpoch[];
} {
  const barrier = state.warmupBarrierEpochMs;
  const timed = barrier === undefined
    ? []
    : state.orderedTimeline.filter((entry) => entry.committedAtEpochMs >= barrier);
  const rate = (entries: readonly { readonly committedAtEpochMs: number; readonly index: number }[]): number => {
    if (barrier === undefined || entries.length === 0) return 0;
    const elapsedMs = Math.max(1, entries.at(-1)!.committedAtEpochMs - barrier);
    return (60_000 * entries.length) / elapsedMs;
  };
  const windows = (size: number, stride: number): PreviewTsxCorpusThroughputEpoch[] => {
    const result: PreviewTsxCorpusThroughputEpoch[] = [];
    for (let start = 0; start + size <= timed.length; start += stride) {
      const entries = timed.slice(start, start + size);
      const elapsedMs = Math.max(1, entries.at(-1)!.committedAtEpochMs - entries[0]!.committedAtEpochMs);
      result.push({
        committedRows: size,
        elapsedMs,
        ratePerMinute: (60_000 * size) / elapsedMs,
        startIndex: entries[0]!.index,
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
    slowest240RatePerMinute: windows240.length === 0 ? 0 : Math.min(...windows240.map((window) => window.ratePerMinute)),
    windows240,
  };
}

async function writeCampaignPerformance(
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
    laneCount: state.selectedLaneCount ?? state.options.primaryJobs ?? PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY.primaryJobs,
    limit,
    resourceGate,
    sentinelGate,
    version: 9,
  });
}

async function terminalSentinelGate(state: CampaignState): Promise<boolean> {
  let certificates: readonly string[];
  try {
    certificates = await readdir(path.join(state.options.artifacts, 'generations'));
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
  if (certificates.length === 0) return false;
  const matched = await Promise.all(certificates.map(async (file) => {
    const certificate = await readJsonIfPresent<PreviewTsxCorpusGenerationCertificate>(
      path.join(state.options.artifacts, 'generations', file),
    );
    return certificate?.sentinelMatched === true;
  }));
  return matched.every(Boolean);
}

async function terminalCleanupGate(state: CampaignState, limit: number): Promise<boolean> {
  const lineagesClosed = await Promise.all(Array.from({ length: limit }, async (_, index) => {
    const canonical = await readJsonIfPresent<PreviewTsxCorpusCanonicalRecord>(
      path.join(state.options.artifacts, 'canonical', `${pad(index)}.json`),
    );
    const terminal = canonical?.attempts.at(-1);
    if (terminal === undefined) return false;
    const attempt = await readJsonIfPresent<PreviewTsxCorpusAttemptRecord>(
      path.join(state.options.artifacts, 'attempts', pad(index), `${terminal.attemptKind}.json`),
    );
    return attempt?.cleanupConfirmed === true;
  }));
  let certificates: readonly string[];
  try {
    certificates = await readdir(path.join(state.options.artifacts, 'generations'));
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
  if (certificates.length === 0 || lineagesClosed.some((closed) => !closed)) return false;
  const cleanupClosed = await Promise.all(certificates.map(async (file) => {
    const certificate = await readJsonIfPresent<{ readonly cleanup?: LaneCleanup }>(
      path.join(state.options.artifacts, 'generations', file),
    );
    const cleanup = certificate?.cleanup;
    return cleanup !== undefined && cleanup.closeObserved && cleanup.groupAbsent && cleanup.listenersDetached && cleanup.streamsTerminal;
  }));
  return cleanupClosed.every(Boolean);
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
  return classifyHeadlessResult(result, row, sourceRoot);
}

/** Classifies one cleaned headless result identically across serial and pipelined campaigns. */
function classifyHeadlessResult(
  result: PreviewHeadlessResult,
  row: PreviewTsxCorpusManifestRow,
  sourceRoot: string,
): { readonly category: PreviewTsxCorpusCategory; readonly reason: string } {
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
  const hasVerifiedTargetOutput =
    composition?.targetStage === 'target-output' &&
    composition.targetOutputKind === 'target-output';
  const hasCurrentFileOutput = hasVerifiedTargetOutput || (
    (composition?.currentFileMounted ?? 0) > 0 &&
    (composition?.hostOutput ?? 0) > 0
  );
  const strictSuccess =
    result.stabilizedOutcome === 'ready' &&
    exactTarget &&
    fidelity !== 'none' &&
    fidelity !== 'target-only' &&
    composition !== undefined &&
    composition.targetExportName.trim().length !== 0 &&
    composition.targetPageRootCommitted &&
    composition.targetMounted &&
    composition.targetHasOutput &&
    hasCurrentFileOutput &&
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
  readonly ownership: readonly PreviewTsxCorpusRowOwnershipEvent[];
  readonly stageHistory: readonly PreviewTsxCorpusStageEvent[];
  readonly valid: boolean;
  readonly workerLifecycle: readonly PreviewTsxCorpusWorkerLifecycleEvent[];
} {
  const compilerProgress: PreviewTsxCorpusCompilerEvent[] = [];
  const ownership: PreviewTsxCorpusRowOwnershipEvent[] = [];
  const stageHistory: PreviewTsxCorpusStageEvent[] = [];
  const workerLifecycle: PreviewTsxCorpusWorkerLifecycleEvent[] = [];
  const lines = source.toString('utf8').split('\n').filter(Boolean);
  if (lines.length > 512) {
    return { compilerProgress, ownership, stageHistory, valid: false, workerLifecycle };
  }
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as PreviewTsxCorpusDiagnosticEvent;
      if (event.index !== index || event.path !== row.path || event.version !== 3) {
        return { compilerProgress, ownership, stageHistory, valid: false, workerLifecycle };
      }
      if (event.kind === 'target-stage') stageHistory.push(event);
      else if (event.kind === 'compiler-progress') compilerProgress.push(event);
      else if (event.kind === 'worker-lifecycle') workerLifecycle.push(event);
      else if (event.kind === 'row-ownership') {
        if (!isValidRowOwnershipEvent(event)) {
          return { compilerProgress, ownership, stageHistory, valid: false, workerLifecycle };
        }
        ownership.push(event);
      }
      else return { compilerProgress, ownership, stageHistory, valid: false, workerLifecycle };
    } catch {
      return { compilerProgress, ownership, stageHistory, valid: false, workerLifecycle };
    }
  }
  return { compilerProgress, ownership, stageHistory, valid: true, workerLifecycle };
}

function isValidRowOwnershipEvent(event: PreviewTsxCorpusDiagnosticEvent): event is PreviewTsxCorpusRowOwnershipEvent {
  if (event.kind !== 'row-ownership' || typeof event.generation !== 'string' || !Number.isInteger(event.lane)) return false;
  const ownership = event.ownership as PreviewHeadlessOwnershipEvent;
  if (typeof ownership !== 'object' || ownership === null || typeof ownership.profileRoot !== 'string') return false;
  if (ownership.kind === 'server-listening') {
    return Number.isInteger(ownership.loopbackPort) && ownership.loopbackPort > 0 && ownership.loopbackPort < 65536;
  }
  if (ownership.kind === 'browser-spawned' || ownership.kind === 'browser-terminal') {
    return (ownership.pid === undefined || Number.isSafeInteger(ownership.pid)) &&
      (ownership.pgid === undefined || Number.isSafeInteger(ownership.pgid));
  }
  return ownership.kind === 'profile-created' || ownership.kind === 'server-closed' || ownership.kind === 'profile-removed';
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
      result.version !== 3 ||
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
    record.policyDigest !== state.identity.policyDigest ||
    !Number.isSafeInteger(record.committedAtEpochMs)
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
  const operation = state.ledgerWriteChain.then(async () => {
    const source = await readFile(recordPath);
    const recordSha256 = digest(source);
    if (state.ledgerDigests.has(recordSha256)) return;
    await appendFile(
      path.join(state.options.artifacts, 'ledger.jsonl'),
      `${JSON.stringify({ attemptKind, index, kind, recordSha256, version: 1 })}\n`,
    );
    state.ledgerDigests.add(recordSha256);
  });
  state.ledgerWriteChain = operation.then(
    () => undefined,
    () => undefined,
  );
  await operation;
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
    record.version !== 3
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
  await writePreviewTsxCorpusJsonAtomic(filePath, value);
}

async function writeBufferAtomic(filePath: string, value: Buffer): Promise<void> {
  await writePreviewTsxCorpusArtifactAtomic(filePath, value);
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
