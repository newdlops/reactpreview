/**
 * Partitions fast Page Inspector source admission so one graph direction cannot starve another.
 *
 * Reverse discovery intentionally samples hundreds of nearby files and can encounter generated
 * modules before the much shorter application-entry path is walked. A single aggregate byte limit
 * therefore lets reverse analysis consume the complete allowance and makes the later forward read
 * incorrectly look like a missing source. These readers share one raw read cache and one admitted
 * source set, but reserve bounded new-source capacity for each phase. The four reservations still
 * sum to the original 16 MiB safety envelope.
 *
 * Callers rank sources before requesting them. Admission therefore follows request order instead
 * of disk completion order. Raw reads still start concurrently, and admitted text remains available
 * immediately without waiting for unrelated pending admissions.
 */
import path from 'node:path';
import type { ReadPreviewInspectorSource } from './previewInspectorAncestorTypes';

const MEBIBYTE = 1024 * 1024;

/** Compiler-phase readers sharing already admitted source without charging it twice. */
export interface PreviewInspectorFastSourceReaders {
  /** Conventional entry detection has a small lane isolated from reverse candidates. */
  readonly entry: ReadPreviewInspectorSource;
  /** Entry-to-target traversal retains enough capacity for application routers and providers. */
  readonly forward: ReadPreviewInspectorSource;
  /** Target-to-owner sampling remains the largest cold-search consumer. */
  readonly reverse: ReadPreviewInspectorSource;
  /** Layout/header/navigation expansion can reuse corridor sources plus bounded new siblings. */
  readonly subtree: ReadPreviewInspectorSource;
}

/** Internal lane identity retained only for deterministic byte accounting. */
type SourceReaderLane = keyof PreviewInspectorFastSourceReaders;

const LANE_BUDGET_BYTES: Readonly<Record<SourceReaderLane, number>> = Object.freeze({
  entry: 2 * MEBIBYTE,
  forward: 6 * MEBIBYTE,
  reverse: 6 * MEBIBYTE,
  subtree: 2 * MEBIBYTE,
});

/**
 * Creates phase-reserved readers over one snapshot-aware compiler source function.
 *
 * A source admitted by any lane is available to every other lane because retaining another
 * reference does not duplicate its text. Rejected oversized reads stay in the raw cache and may be
 * admitted later by a lane with remaining capacity.
 */
export function createPreviewInspectorFastSourceReaders(
  readSource: ReadPreviewInspectorSource,
): PreviewInspectorFastSourceReaders {
  const rawSourceByPath = new Map<string, Promise<string | undefined>>();
  const admittedPaths = new Set<string>();
  const admittedBytesByLane: Record<SourceReaderLane, number> = {
    entry: 0,
    forward: 0,
    reverse: 0,
    subtree: 0,
  };
  let admissionTail: Promise<void> = Promise.resolve();

  /** Reads one normalized path once without deciding which analysis phase may retain it. */
  const readRawSource = (sourcePath: string): Promise<string | undefined> => {
    const normalizedPath = path.normalize(sourcePath);
    const existing = rawSourceByPath.get(normalizedPath);
    if (existing !== undefined) return existing;
    const pending = readSource(normalizedPath);
    rawSourceByPath.set(normalizedPath, pending);
    return pending;
  };

  /** Starts raw I/O immediately, then commits new admissions in the caller's ranked request order. */
  const createLane = (lane: SourceReaderLane): ReadPreviewInspectorSource => {
    return async (sourcePath) => {
      const normalizedPath = path.normalize(sourcePath);
      const pendingSource = readRawSource(normalizedPath);
      if (admittedPaths.has(normalizedPath)) return pendingSource;
      const admission = admissionTail.then(async () => {
        const sourceText = await pendingSource;
        if (sourceText === undefined || admittedPaths.has(normalizedPath)) return sourceText;
        const byteLength = Buffer.byteLength(sourceText, 'utf8');
        if (admittedBytesByLane[lane] + byteLength > LANE_BUDGET_BYTES[lane]) {
          return undefined;
        }
        admittedBytesByLane[lane] += byteLength;
        admittedPaths.add(normalizedPath);
        return sourceText;
      });
      admissionTail = admission.then(
        () => undefined,
        () => undefined,
      );
      // Raw failures reach callers immediately; only successful text waits for ordered admission.
      // The tail observes a failed slot separately so later admissions retain their predecessor.
      return pendingSource.then(() => admission);
    };
  };

  return Object.freeze({
    entry: createLane('entry'),
    forward: createLane('forward'),
    reverse: createLane('reverse'),
    subtree: createLane('subtree'),
  });
}
