/**
 * Sizes the declared-type analysis program from the compiler worker's heap headroom.
 *
 * This is a crash-safety valve, not a quality budget: the interactive worker's 4 GiB heap
 * normally admits the full default program, while 384 MiB validation-campaign workers and extreme
 * projects get a smaller program instead of a terminated worker. An overflow terminates the worker
 * instead of throwing, so the size must be decided before the program exists.
 *
 * The raw `used_heap_size` between collections includes garbage that V8 reclaims before an
 * allocation could fail; in measured preview workers it overstated the live set by 60-100 MiB,
 * which made the gate refuse programs the worker could afford. The live figure used here is the
 * heap measured right after the latest major collection, never more than the current raw figure.
 */
import { constants, PerformanceObserver } from 'node:perf_hooks';
import v8 from 'node:v8';
import {
  PREVIEW_TYPE_PROGRAM_DEFAULT_BUDGET,
  type PreviewTypeProgramBudget,
} from './previewTypeProgram';

/** Heap facts the admission gate reads. */
export interface PreviewTypeHeapStatistics {
  readonly heap_size_limit: number;
  /** Live heap estimate in bytes. */
  readonly used_heap_size: number;
}

/** Share of the isolate heap limit that the build may reach while the program is alive. */
const HEAP_CEILING_RATIO = 0.8;
/** Live heap left for the rest of the build (bundling and output) after the program exists. */
const HEAP_RESERVE_BYTES = 120 * 1024 * 1024;
/** Worst measured heap per admitted text byte (parse, bind, and checker state) plus margin. */
const HEAP_BYTES_PER_TEXT_BYTE = 40;
/** Heap credited back per cached text byte: unchanged parses are reused, not allocated again. */
const RETAINED_HEAP_BYTES_PER_TEXT_BYTE = 12;
/** Smallest useful program; TypeScript's lib files alone are about 0.45 MiB of text. */
const MIN_TEXT_BYTES = 1024 * 1024;
/** Budget granularity, so small heap fluctuations do not change which modules are admitted. */
const TEXT_BUDGET_STEP_BYTES = 512 * 1024;

/**
 * Chooses one build's text budget from the worker's live heap headroom.
 *
 * @param heap Heap limit and live heap estimate.
 * @param retainedTextBytes Text bytes of parses the cache already holds for reuse.
 * @param maximum Upper bound used when the heap has room to spare.
 * @returns Budget, or `undefined` when the worker cannot afford a useful program.
 */
export function selectPreviewTypeProgramBudget(
  heap: PreviewTypeHeapStatistics,
  retainedTextBytes: number,
  maximum: PreviewTypeProgramBudget = PREVIEW_TYPE_PROGRAM_DEFAULT_BUDGET,
): PreviewTypeProgramBudget | undefined {
  const reused = Math.min(
    heap.used_heap_size,
    retainedTextBytes * RETAINED_HEAP_BYTES_PER_TEXT_BYTE,
  );
  const available =
    heap.heap_size_limit * HEAP_CEILING_RATIO - (heap.used_heap_size - reused) - HEAP_RESERVE_BYTES;
  const affordable =
    Math.floor(available / HEAP_BYTES_PER_TEXT_BYTE / TEXT_BUDGET_STEP_BYTES) *
    TEXT_BUDGET_STEP_BYTES;
  const maxTextBytes = Math.min(maximum.maxTextBytes, affordable);
  return maxTextBytes < MIN_TEXT_BYTES ? undefined : { ...maximum, maxTextBytes };
}

let heapAfterMajorCollection: number | undefined;
let collectionObserver: PerformanceObserver | undefined;

/**
 * Starts recording the heap after each major collection in this isolate. Idempotent; the
 * compiler worker calls it at construction so its first build already has a measurement.
 */
export function observePreviewTypeHeap(): void {
  if (collectionObserver !== undefined) return;
  try {
    collectionObserver = new PerformanceObserver((list) => {
      const major = list.getEntries().some((entry) => {
        const { detail } = entry as { readonly detail?: { readonly kind?: number } | null };
        return detail?.kind === constants.NODE_PERFORMANCE_GC_MAJOR;
      });
      if (major) heapAfterMajorCollection = v8.getHeapStatistics().used_heap_size;
    });
    collectionObserver.observe({ entryTypes: ['gc'] });
  } catch {
    collectionObserver = undefined;
  }
}

/** Reads the heap limit and the live estimate: the latest post-collection figure, when lower. */
export function readPreviewTypeLiveHeapStatistics(): PreviewTypeHeapStatistics {
  const heap = v8.getHeapStatistics();
  return {
    heap_size_limit: heap.heap_size_limit,
    used_heap_size:
      heapAfterMajorCollection === undefined
        ? heap.used_heap_size
        : Math.min(heap.used_heap_size, heapAfterMajorCollection),
  };
}
