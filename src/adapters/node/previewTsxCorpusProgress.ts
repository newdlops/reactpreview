import { asPreviewHeadlessError, normalizeHeadlessEvidence } from './previewHeadlessErrorEvidence';
/** Persists coalesced acceleration checkpoints without losing acknowledged progress. */
import { createHash } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import {
  writePreviewTsxCorpusArtifactAtomic,
  writePreviewTsxCorpusJsonAtomic,
} from './previewHeadlessTsxCorpusCampaignArtifacts';
import { type PreviewTsxCorpusCategory } from './previewHeadlessTsxCorpusCampaignTypes';
import type {
  V12ProgressCommittedState,
  V12ProgressRuntimeState,
  V12RowClassification,
} from './previewTsxCorpusModel';

export const V12_PROGRESS_BATCH_ROWS = 25;

export const V12_PROGRESS_MAX_DELAY_MS = 1_000;

/** Creates independent zero counters for every supported terminal row category. */
export function emptyPreviewTsxCorpusCategoryCounts(): Record<PreviewTsxCorpusCategory, number> {
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
export class V12ProgressCheckpointWriter {
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
  #pending: (V12RowClassification & { readonly terminalAt: number; readonly version: 1 })[] = [];
  #revision = 0;
  #serial: Promise<void> = Promise.resolve();
  #timer: NodeJS.Timeout | undefined;

  /** Binds progress output paths and the immutable campaign identity without writing artifacts before initialization. */
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

  /** Creates and verifies the empty classification journal before publishing its first checkpoint. */
  async initialize(): Promise<void> {
    const reference = await writePreviewTsxCorpusArtifactAtomic(this.#journalPath, Buffer.alloc(0));
    const emptyDigest = this.#journalHash.copy().digest('hex');
    if (reference.bytes !== 0 || reference.sha256 !== emptyDigest) {
      throw new Error('v12 progress journal initialization verification failed.');
    }
    await this.enqueueFlush(true);
  }

  /** Queues one unique terminal classification and schedules a bounded-size or bounded-delay durable flush. */
  record(classification: V12RowClassification): void {
    if (this.#closed) throw new Error('v12 progress checkpoint received a row after close.');
    if (this.#failure !== undefined) throw asPreviewHeadlessError(this.#failure);
    if (this.#seen.has(classification.index)) {
      throw new Error(`Duplicate v12 progress classification ${classification.index.toString()}.`);
    }
    this.#seen.add(classification.index);
    this.#pending.push({ ...classification, terminalAt: Date.now(), version: 1 });
    this.scheduleFlush(
      this.#pending.length >= V12_PROGRESS_BATCH_ROWS ? 0 : V12_PROGRESS_MAX_DELAY_MS,
    );
  }

  /** Flushes all pending classifications, closes the writer, and returns only durably committed counters. */
  async finish(): Promise<V12ProgressCommittedState> {
    this.clearScheduledFlush();
    await this.enqueueFlush(true);
    this.clearScheduledFlush();
    this.#closed = true;
    return {
      categoryCounts: { ...this.#categoryCounts },
      terminalRows: this.#committedRows,
    };
  }

  /** Cancels a timer that an asynchronous commit may have scheduled while finish was awaiting it. */
  private clearScheduledFlush(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  /** Coalesces delayed flushes while allowing a full batch to advance the next flush immediately. */
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

  /** Serializes journal commits and retains the first persistence failure for every later caller. */
  private enqueueFlush(forceSnapshot: boolean): Promise<void> {
    const operation = this.#serial.then(async () => {
      if (this.#failure !== undefined) throw asPreviewHeadlessError(this.#failure);
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

  /** Appends a classification batch before advancing counters and publishing its matching snapshot. */
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

  /** Publishes the current journal digest, byte count, committed counters, and sampled runtime state atomically. */
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
            : normalizeHeadlessEvidence(runtime.fatal),
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
