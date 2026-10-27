/** Selects native runtime defaults for interactive previews while retaining shared isolation. */
import { availableParallelism, totalmem } from 'node:os';
import {
  createPreviewCompilerWorkerOptions,
  PREVIEW_INTERACTIVE_WORKER_OLD_GENERATION_LIMIT_MB,
} from './previewCompilerWorkerIsolation';

/** Host resources used to admit the larger interactive native heap. */
export interface PreviewCompilerWorkerHostResources {
  /** Physical host memory in bytes. */
  readonly memoryBytes: number;
  /** Available logical CPU slots reported by Node. */
  readonly cpuSlots: number;
}

const MINIMUM_HOST_MEMORY_BYTES = 32 * 1024 ** 3;
const MINIMUM_CPU_SLOTS = 8;

/**
 * Gives large interactive native graphs enough heap to avoid repeated collection under a small
 * soft limit. Shared isolation still supplies Node limits, environment filtering and two Go CPUs.
 * Explicit Go settings and other worker profiles retain their existing shared options.
 *
 * @param parentEnvironment Caller environment; this function never mutates it.
 * @param maxOldGenerationSizeMb Existing Node heap limit in MiB, also identifying interactive work.
 * @param hostResources Host capacity; injectable to verify eligibility without machine changes.
 * @returns Frozen worker options with eligible native defaults or the complete shared defaults.
 */
export function createPreviewInteractiveCompilerWorkerOptions(
  parentEnvironment: Readonly<NodeJS.ProcessEnv>,
  maxOldGenerationSizeMb: number,
  hostResources: PreviewCompilerWorkerHostResources = {
    memoryBytes: totalmem(),
    cpuSlots: availableParallelism(),
  },
): ReturnType<typeof createPreviewCompilerWorkerOptions> {
  const standard = createPreviewCompilerWorkerOptions(parentEnvironment, maxOldGenerationSizeMb);
  if (
    maxOldGenerationSizeMb !== PREVIEW_INTERACTIVE_WORKER_OLD_GENERATION_LIMIT_MB ||
    !Number.isSafeInteger(hostResources.memoryBytes) ||
    hostResources.memoryBytes < MINIMUM_HOST_MEMORY_BYTES ||
    !Number.isSafeInteger(hostResources.cpuSlots) ||
    hostResources.cpuSlots < MINIMUM_CPU_SLOTS ||
    parentEnvironment.GOMEMLIMIT !== undefined ||
    parentEnvironment.GOMAXPROCS !== undefined ||
    parentEnvironment.GOGC !== undefined
  ) {
    return standard;
  }
  return Object.freeze({
    ...standard,
    env: { ...standard.env, GOMEMLIMIT: '640MiB', GOGC: '200' },
  });
}
