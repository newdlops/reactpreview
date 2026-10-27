/** Owns the persistent serial compiler lane protocol and per-row process capture. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY,
  type PreviewTsxCorpusProcessLifecycleEvent,
  type PreviewTsxCorpusRowOwnershipEvent,
  type PreviewTsxCorpusWorkerResult,
} from './previewHeadlessTsxCorpusCampaignTypes';
import {
  type ActiveLaneRow,
  type CampaignState,
  LANE_CAPTURE_LIMIT_BYTES,
  type LaneCapture,
  type LaneCleanup,
  type LaneRowOutcome,
} from './previewTsxCorpusModel';

/** Carries the manifest index, bounded row capture, and cleanup evidence when a persistent lane cannot complete a row. */
export class LaneRowFailure extends Error {
  /** Retains row and cleanup evidence while using the cleanup reason as the public failure message. */
  constructor(
    readonly index: number,
    readonly cleanup: LaneCleanup,
    readonly outcome: Omit<LaneRowOutcome, 'result'>,
  ) {
    super(cleanup.reason);
  }
}

/** Persistent serial compiler-lane transport. Campaign promotion remains responsible for durable acknowledgement. */
export class PrimaryLane {
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
  #streamTerminalListeners: {
    readonly mark: () => void;
    readonly stream: NodeJS.ReadableStream;
  }[] = [];
  #unacked = new Set<number>();
  readonly generationId = randomUUID();
  readonly laneId: number;
  readonly child: ReturnType<typeof spawn>;

  /** Starts one owned detached lane and installs its ready, stream, exit, and cleanup observers. */
  constructor(
    private readonly state: CampaignState,
    laneId: number,
  ) {
    this.laneId = laneId;
    this.#close = new Promise((resolve) => {
      this.#resolveClose = resolve;
    });
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
      () => {
        clearTimeout(readyDeadline);
      },
      () => {
        clearTimeout(readyDeadline);
      },
    );
  }

  /** Dispatches one frozen row after readiness, enforcing serial work and the durable-acknowledgement ceiling. */
  async run(index: number): Promise<LaneRowOutcome> {
    await this.#ready;
    if (this.#active !== undefined) throw new Error('Primary lane already has an active row.');
    if (this.#unacked.size >= 2)
      throw new Error('Primary lane durable acknowledgement ceiling reached.');
    const row = this.state.rows[index];
    if (row === undefined) throw new Error(`Missing manifest row ${index.toString()}.`);
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

  /** Releases a completed row's acknowledgement slot only after the campaign commits it durably. */
  ack(index: number): void {
    if (!this.#unacked.delete(index))
      throw new Error(`Unknown lane acknowledgement for ${index.toString()}.`);
    if (this.child.stdin == null || this.child.stdin.destroyed) {
      void this.terminateAndProbe('Primary lane acknowledgement transport failed.');
      return;
    }
    this.child.stdin.write(`${JSON.stringify({ index, kind: 'ack', version: 3 })}\n`);
  }

  /** Requests orderly lane drainage and returns cleanup proof after queued acknowledgements finish. */
  async drainShutdown(): Promise<LaneCleanup> {
    if (this.#active !== undefined || this.#unacked.size !== 0) {
      throw new Error('Cannot drain lane with an active or unacknowledged row.');
    }
    this.#drained ??= new Promise<void>((resolve) => {
      this.#resolveDrained = resolve;
    });
    if (this.child.stdin == null || this.child.stdin.destroyed) {
      return this.terminateAndProbe('Primary lane shutdown transport failed.');
    }
    this.child.stdin.write(`${JSON.stringify({ kind: 'shutdown', version: 3 })}\n`);
    const drained = await this.waitForDrained();
    if (!drained) return this.terminateAndProbe('Primary lane did not acknowledge shutdown drain.');
    return this.awaitClosedCleanup('Primary lane drained.');
  }

  /** Stops new lane work and terminates only its owned process group with the supplied diagnostic reason. */
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

  /** Splits buffered stdout or diagnostic bytes into complete protocol lines while retaining the final partial line. */
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

  /** Parses one transport line and invalidates the lane protocol when its JSON record is malformed. */
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

  /** Admits ready and row-result messages only when they match the active lane command identity. */
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
      if (
        message.index !== active.index ||
        message.commandId !== active.commandId ||
        active.result === undefined
      ) {
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
    if (
      (message.kind === 'headless-result' || message.kind === 'compile-or-render-failure') &&
      message.index === active.index
    ) {
      active.result = message as unknown as PreviewTsxCorpusWorkerResult;
      return;
    }
    this.invalidateProtocol('Primary lane stdout message did not match the active row.');
  }

  /** Correlates stage and ownership telemetry with the active row before retaining it as execution evidence. */
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
    if (
      message.kind !== 'compiler-progress' &&
      message.kind !== 'target-stage' &&
      message.kind !== 'worker-lifecycle'
    ) {
      this.invalidateProtocol('Primary lane emitted an unknown fd3 diagnostic.');
    }
  }

  /** Marks the active transport invalid and begins owned-group cleanup rather than trusting subsequent row output. */
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
    if (this.#active !== undefined)
      void this.terminateAndProbe('Primary lane closed while a row was active.');
  };

  /** Observes stdout, stderr, and stage stream termination separately from child exit. */
  private attachStreamTerminalListeners(): void {
    const attach = (
      stream: NodeJS.ReadableStream | null | undefined,
      terminal: 'fd3' | 'stderr' | 'stdout',
    ): void => {
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

  /** Creates an empty bounded stream accumulator with explicit byte and truncation counters. */
  private createCapture(): LaneCapture {
    return { bytes: 0, chunks: [], truncated: false };
  }

  /** Appends bytes only within the capture limit while accounting for dropped excess input. */
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

  /** Combines a matching worker result with captured streams, timing, ownership, and process lifecycle evidence. */
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
      truncation: {
        stages: active.stages.truncated,
        stderr: active.stderr.truncated,
        stdout: active.stdout.truncated,
      },
    };
  }

  /** Preserves partial row evidence for a failed lane without inventing a terminal worker result. */
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
      truncation: {
        stages: active.stages.truncated,
        stderr: active.stderr.truncated,
        stdout: active.stdout.truncated,
      },
    };
  }

  /** Projects the observed child exit and stream-terminal state into the transport-safe process record. */
  private laneProcessState(): LaneRowOutcome['laneProcess'] {
    return {
      closeObserved: this.#closeObserved,
      ...(this.#childError === undefined ? {} : { error: this.#childError }),
      ...(this.#exit === undefined ? {} : { exit: this.#exit }),
      ...(this.child.pid === undefined || process.platform === 'win32'
        ? {}
        : { ownedPgid: this.child.pid }),
      streamsTerminal: {
        fd3: this.#stageTerminal,
        stderr: this.#stderrTerminal,
        stdout: this.#stdoutTerminal,
      },
    };
  }

  /** Appends a timestamped row lifecycle event without retaining live process objects. */
  private recordLifecycle(
    active: ActiveLaneRow | undefined,
    event: PreviewTsxCorpusProcessLifecycleEvent['event'],
    detail?: Readonly<Record<string, unknown>>,
  ): void {
    if (active === undefined) return;
    active.lifecycle.push({
      ...(detail === undefined ? {} : { detail }),
      elapsedMs: Math.round(performance.now() - active.startedAt),
      event,
      kind: 'parent-process',
      version: 3,
    });
  }

  /** Waits within the cleanup grace period for the lane's explicit drained acknowledgement. */
  private async waitForDrained(): Promise<boolean> {
    const drained = this.#drained;
    if (drained === undefined) return false;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        resolve(false);
      }, PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY.cleanupGraceMs);
      timer.unref();
      void drained.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  /** Coalesces termination requests into one cleanup operation and verifies owned-group absence. */
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

  /** Signals the owned group as needed, waits for stream closure, and produces a bounded cleanup record. */
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

  /** Assembles cleanup proof only after the child and all protocol streams reach their terminal state. */
  private async awaitClosedCleanup(
    reason: string,
    termSent = false,
    killSent = false,
  ): Promise<LaneCleanup> {
    if (!this.#closeObserved) {
      await this.waitForClose();
    }
    await Promise.all([
      this.waitForStreamTerminal('stdout'),
      this.waitForStreamTerminal('stderr'),
      this.waitForStreamTerminal('fd3'),
    ]);
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

  /** Waits for one observed stream terminal event within the bounded cleanup grace period. */
  private async waitForStreamTerminal(stream: 'fd3' | 'stderr' | 'stdout'): Promise<void> {
    const terminal = (): boolean =>
      stream === 'stdout'
        ? this.#stdoutTerminal
        : stream === 'stderr'
          ? this.#stderrTerminal
          : this.#stageTerminal;
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
      const check = (): boolean => {
        if (!terminal()) return false;
        finish();
        return true;
      };
      const poll = (): void => {
        if (settled) return;
        if (!check()) {
          const next = setTimeout(poll, 20);
          next.unref();
        }
      };
      poll();
    });
  }

  /** Waits for the owned child close event without treating its earlier exit event as closed transport. */
  private async waitForClose(): Promise<void> {
    if (this.#closeObserved) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY.cleanupGraceMs);
      timer.unref();
      void this.#close.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** Polls only the owned process group until absence is proven or the cleanup deadline expires. */
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

  /** Signals only a valid campaign-owned process group and records the row's termination evidence. */
  private signalOwnedGroup(signal: NodeJS.Signals, active: ActiveLaneRow | undefined): boolean {
    const pgid = this.child.pid;
    if (pgid === undefined) return false;
    try {
      if (process.platform === 'win32') this.child.kill(signal);
      else process.kill(-pgid, signal);
      this.recordLifecycle(active, 'group-signal', { pgid, signal });
      return true;
    } catch (error) {
      this.recordLifecycle(active, 'group-signal', {
        error: error instanceof Error ? error.message : String(error),
        pgid,
        signal,
      });
      return false;
    }
  }

  /** Tests whether the lane's exact owned process group has disappeared. */
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

  /** Releases the installed stream and child observers after cleanup reaches its terminal state. */
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

/** Uses a signal-zero probe to prove owned-group absence; permission failures retain the group as present. */
export function probeOwnedGroupAbsent(
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
