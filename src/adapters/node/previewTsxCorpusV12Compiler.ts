/** Owns the isolated compiler subprocess protocol used by acceleration candidates. */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PreviewBuildRequest } from '../../domain/preview';
import { type PreviewTsxCorpusManifestRow } from './previewHeadlessTsxCorpusCampaignTypes';
import { type PreviewTsxCorpusCompilerLaneMessage } from './previewHeadlessTsxCorpusPipeline';
import { digest } from './previewTsxCorpusFiles';
import {
  type V12CompileCommand,
  type V12CompiledMessage,
  LANE_CAPTURE_LIMIT_BYTES,
} from './previewTsxCorpusModel';

/** Builds the compiler request from one frozen manifest row and its campaign-confined source snapshot. */
export async function v12Request(
  row: PreviewTsxCorpusManifestRow,
  sourceRoot: string,
  workspace: string,
): Promise<PreviewBuildRequest> {
  const documentPath = path.resolve(sourceRoot, row.path);
  const sourceText = await readFile(documentPath, 'utf8');
  if (digest(sourceText) !== row.sha256)
    throw new Error(`Frozen target digest changed: ${row.path}`);
  return Object.freeze({
    dependencySnapshots: Object.freeze([]),
    documentPath,
    language: 'tsx',
    preparationMode: 'fast',
    renderMode: 'page-inspector',
    sourceText,
    useStorybookPreview: false,
    workspaceRoot: workspace,
  });
}

/** Distinguishes an expired bounded compiler command from a component compilation failure. */
export class V12CompileDeadlineError extends Error {}

/** Retains the compiler's diagnostic stage when an owned compile command fails. */
export class V12CompileStageError extends Error {
  /** Stores the reported compiler stage alongside its bounded failure message. */
  constructor(
    readonly stage: 'compile' | 'spool',
    message: string,
  ) {
    super(message);
  }
}

/** One compiler and one esbuild service in an independently owned process group. */
export class V12CompilerProcess {
  #active:
    | {
        readonly commandId: string;
        readonly deadline: NodeJS.Timeout;
        readonly reject: (error: Error) => void;
        readonly resolve: (message: V12CompiledMessage) => void;
      }
    | undefined;
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

  /** Starts one owned compiler worker and installs matching-message, readiness, exit, and stream observers. */
  constructor(
    runtimePath: string,
    readonly laneId: number,
  ) {
    this.#close = new Promise((resolve) => {
      this.#resolveClose = resolve;
    });
    this.#drained = new Promise((resolve) => {
      this.#resolveDrained = resolve;
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
    this.child = spawn(process.execPath, [runtimePath, '__v12-compiler-lane'], {
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout?.on('data', this.receiveStdout);
    this.child.stderr?.on('data', (chunk: Buffer) => {
      this.#stderr = `${this.#stderr}${chunk.toString('utf8')}`.slice(-16_384);
    });
    this.child.once('error', (error) => {
      this.fail(error);
    });
    this.child.once('close', (code, signal) => {
      this.#closeObserved = true;
      this.#resolveClose();
      const error = new Error(
        `v12 compiler lane ${this.laneId.toString()} closed (${String(code)}/${String(signal)}).${this.#stderr.length === 0 ? '' : `\n${this.#stderr}`}`,
      );
      if (!this.#readySettled) this.#rejectReady(error);
      this.failActive(error);
    });
    const readyDeadline = setTimeout(() => {
      this.fail(
        new Error(`v12 compiler lane ${this.laneId.toString()} ready handshake timed out.`),
      );
    }, 10_000);
    void this.#ready.then(
      () => {
        clearTimeout(readyDeadline);
      },
      () => {
        clearTimeout(readyDeadline);
      },
    );
  }

  /** Dispatches one serial compile command and enforces its deadline and command identity. */
  async compile(command: V12CompileCommand): Promise<V12CompiledMessage> {
    await this.#ready;
    if (this.#active !== undefined)
      throw new Error(`v12 compiler lane ${this.laneId.toString()} already has active work.`);
    if (this.#closeObserved || this.child.stdin == null || this.child.stdin.destroyed)
      throw new Error(`v12 compiler lane ${this.laneId.toString()} is unavailable.`);
    return new Promise<V12CompiledMessage>((resolve, reject) => {
      const deadline = setTimeout(
        () => {
          const error = new V12CompileDeadlineError(
            `v12 compiler lane ${this.laneId.toString()} row ${command.identity.row.toString()} exceeded its absolute deadline.`,
          );
          this.failActive(error);
          void this.abort(error.message);
        },
        Math.max(1, command.absoluteDeadlineEpochMs - Date.now()),
      );
      this.#active = { commandId: command.commandId, deadline, reject, resolve };
      this.child.stdin?.write(`${JSON.stringify(command)}\n`, (error) => {
        if (error == null) return;
        this.fail(error);
      });
    });
  }

  /** Requests orderly drainage and returns whether the compiler group reaches proven terminal cleanup. */
  async shutdown(): Promise<boolean> {
    if (this.#active !== undefined)
      throw new Error(`Cannot drain active v12 compiler lane ${this.laneId.toString()}.`);
    if (this.#cleanup !== undefined) return this.#cleanup;
    this.#cleanup = this.drainAndClose();
    return this.#cleanup;
  }

  /** Terminates the owned compiler group and resolves cleanup before its lane can be reused or discarded. */
  async abort(reason: string): Promise<boolean> {
    // The supervisor records this reason; this phase returns only owned-group cleanup proof.
    void reason;
    this.#cleanup ??= this.terminateOwnedGroup();
    return this.#cleanup;
  }

  private readonly receiveStdout = (chunk: Buffer): void => {
    this.#stdoutRemainder += chunk.toString('utf8');
    if (Buffer.byteLength(this.#stdoutRemainder) > LANE_CAPTURE_LIMIT_BYTES) {
      this.fail(
        new Error(
          `v12 compiler lane ${this.laneId.toString()} stdout exceeded its protocol limit.`,
        ),
      );
      return;
    }
    let newline = this.#stdoutRemainder.indexOf('\n');
    while (newline >= 0) {
      const line = this.#stdoutRemainder.slice(0, newline);
      this.#stdoutRemainder = this.#stdoutRemainder.slice(newline + 1);
      newline = this.#stdoutRemainder.indexOf('\n');
      if (line.length === 0) continue;
      try {
        const transportValue: unknown = JSON.parse(line);
        if (
          typeof transportValue !== 'object' ||
          transportValue === null ||
          !('version' in transportValue) ||
          transportValue.version !== 12
        )
          throw new Error('Invalid v12 compiler lane message version.');
        this.receiveMessage(transportValue as PreviewTsxCorpusCompilerLaneMessage);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };

  /** Admits only supported-version compiler messages matching the current command or readiness boundary. */
  private receiveMessage(message: PreviewTsxCorpusCompilerLaneMessage): void {
    if (message.kind === 'ready') {
      if (this.#readySettled || this.#active !== undefined)
        throw new Error('Duplicate or late v12 compiler ready message.');
      this.#resolveReady();
      return;
    }
    if (message.kind === 'drained') {
      this.#resolveDrained();
      return;
    }
    const active = this.#active;
    if (active?.commandId !== message.commandId)
      throw new Error('Uncorrelated v12 compiler lane message.');
    clearTimeout(active.deadline);
    this.#active = undefined;
    if (message.kind === 'compiled') active.resolve(message);
    else
      active.reject(
        new V12CompileStageError(message.stage, `${message.errorName}: ${message.error}`),
      );
  }

  /** Retains a worker failure and rejects the readiness or active command waiter that owns it. */
  private fail(error: Error): void {
    if (!this.#readySettled) this.#rejectReady(error);
    this.failActive(error);
    void this.abort(error.message);
  }

  /** Rejects and releases the active compile command without admitting a partial spool result. */
  private failActive(error: Error): void {
    const active = this.#active;
    if (active === undefined) return;
    clearTimeout(active.deadline);
    this.#active = undefined;
    active.reject(error);
  }

  /** Waits for the worker's drained state, child close, and owned-group absence within bounded cleanup windows. */
  private async drainAndClose(): Promise<boolean> {
    await this.#ready;
    if (this.#closeObserved) return this.probeGroupAbsent();
    if (this.child.stdin == null || this.child.stdin.destroyed) return this.terminateOwnedGroup();
    this.child.stdin.write(`${JSON.stringify({ kind: 'shutdown', version: 12 })}\n`);
    if (!(await this.waitFor(this.#drained, 10_000))) return this.terminateOwnedGroup();
    if (!(await this.waitFor(this.#close, 10_000))) return this.terminateOwnedGroup();
    return this.waitForGroupAbsence();
  }

  /** Escalates termination only for this lane's owned process group and returns whether absence is proven. */
  private async terminateOwnedGroup(): Promise<boolean> {
    if (!this.#closeObserved) {
      this.signalOwnedGroup('SIGTERM');
      if (!(await this.waitFor(this.#close, 5_000))) {
        this.signalOwnedGroup('SIGKILL');
        await this.waitFor(this.#close, 5_000);
      }
    }
    return this.waitForGroupAbsence();
  }

  /** Signals the recorded detached group only when its process identity is valid. */
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

  /** Uses a signal-zero process-group probe and treats uncertain errors as still present. */
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

  /** Polls owned compiler-group absence until the bounded cleanup deadline expires. */
  private async waitForGroupAbsence(): Promise<boolean> {
    const deadline = Date.now() + 5_000;
    while (!this.probeGroupAbsent() && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    return this.probeGroupAbsent();
  }

  /** Races an owned lifecycle promise against the specified cleanup timeout without leaking its timer. */
  private async waitFor(completion: Promise<void>, timeoutMs: number): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => {
        resolve(false);
      }, timeoutMs);
    });
    const completed = completion.then(() => true);
    try {
      return await Promise.race([completed, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
