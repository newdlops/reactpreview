/**
 * Keeps neural pre-training from monopolizing the developer's machine while it renders pages.
 *
 * Pre-training previews hundreds of pages, each with a compiler build and a headless Chromium. Run
 * flat out it competed with the user's own work, and a starved machine also rendered worse: build
 * stages hit the 45 s watchdog and Chromium the 60 s terminal timeout, and those environmental
 * failures were then recorded as finished pages. The governor therefore
 * - lowers the process priority once (children such as Chromium inherit it; background QoS is
 *   deliberately not used because it confines work to efficiency cores and causes those stalls),
 * - admits the next page only while the 1-minute load average is below a high watermark, with
 *   hysteresis so a busy machine is not polled into flapping, and pauses on critical memory
 *   pressure,
 * - classifies starvation failures as retryable so a page is not lost to a busy moment.
 */
import { execFileSync } from 'node:child_process';
import os from 'node:os';

/** Thresholds of the admission gate, as ratios of the logical CPU count. */
export interface PreviewPretrainingGovernorPolicy {
  /** Pause before the next page while load exceeds `pauseLoadRatio × CPUs`. */
  readonly pauseLoadRatio: number;
  /** After pausing, resume once load falls below `resumeLoadRatio × CPUs`. */
  readonly resumeLoadRatio: number;
  /** macOS memory pressure level that pauses admission (1 normal, 2 warning, 4 critical). */
  readonly pauseMemoryPressure: number;
}

/** One reading of the machine's state. */
export interface PreviewPretrainingLoadSample {
  readonly cpuCount: number;
  /** One-minute load average. */
  readonly load: number;
  /** macOS `kern.memorystatus_vm_pressure_level`, when available. */
  readonly memoryPressure?: number;
}

/** The default policy: pause above one runnable task per CPU, resume below three quarters. */
export const PREVIEW_PRETRAINING_DEFAULT_GOVERNOR_POLICY: PreviewPretrainingGovernorPolicy =
  Object.freeze({ pauseLoadRatio: 1, pauseMemoryPressure: 4, resumeLoadRatio: 0.75 });

/** Default niceness for a pre-training process: below interactive work, still on all cores. */
export const PREVIEW_PRETRAINING_DEFAULT_NICENESS = 10;

/**
 * Decides whether the next page may start.
 *
 * @param sample Current machine state.
 * @param paused Whether the previous decision paused admission.
 * @param policy Thresholds.
 * @returns `undefined` to admit, otherwise the reason admission stays paused.
 */
export function readPreviewPretrainingPauseReason(
  sample: PreviewPretrainingLoadSample,
  paused: boolean,
  policy: PreviewPretrainingGovernorPolicy = PREVIEW_PRETRAINING_DEFAULT_GOVERNOR_POLICY,
): string | undefined {
  if (sample.memoryPressure !== undefined && sample.memoryPressure >= policy.pauseMemoryPressure) {
    return `memory pressure level ${String(sample.memoryPressure)}`;
  }
  const cpuCount = Math.max(1, sample.cpuCount);
  const limit = (paused ? policy.resumeLoadRatio : policy.pauseLoadRatio) * cpuCount;
  if (policy.pauseLoadRatio <= 0 || sample.load <= limit) return undefined;
  return `load ${sample.load.toFixed(1)} > ${limit.toFixed(1)}`;
}

/**
 * Reports whether a page failed because the machine was starved rather than because of the page.
 *
 * @param status Page status from the progress log (`protocol-error/none`, `build-stalled`, …).
 * @returns `true` for Chromium terminal timeouts and compiler watchdog, queue, or memory stalls.
 */
export function isPreviewPretrainingEnvironmentalFailure(status: string): boolean {
  return status.startsWith('protocol-error') || status === 'build-stalled';
}

/** Reads load, CPU count, and (on macOS) memory pressure. */
export function readPreviewPretrainingLoadSample(): PreviewPretrainingLoadSample {
  const cpuCount =
    typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return {
    cpuCount,
    load: os.loadavg()[0] ?? 0,
    ...readMemoryPressure(),
  };
}

/**
 * Lowers this process's scheduling priority; children inherit it.
 *
 * @param niceness Target niceness (0–19); a process cannot raise its own priority back.
 * @returns The niceness in effect afterwards, or `undefined` when it could not be read.
 */
export function lowerPreviewPretrainingPriority(niceness: number): number | undefined {
  try {
    const current = os.getPriority();
    if (Number.isFinite(niceness) && niceness > current) {
      os.setPriority(Math.min(19, Math.trunc(niceness)));
    }
    return os.getPriority();
  } catch {
    return undefined;
  }
}

/**
 * Waits until the governor admits the next page.
 *
 * @param options Sampling, sleeping, and logging hooks (replaceable in tests) and the policy.
 * @returns Milliseconds spent paused.
 */
export async function waitForPreviewPretrainingCapacity(options: {
  readonly log?: (message: string) => void;
  readonly now?: () => number;
  readonly pollMs?: number;
  readonly policy?: PreviewPretrainingGovernorPolicy;
  readonly sample?: () => PreviewPretrainingLoadSample;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}): Promise<number> {
  const sample = options.sample ?? readPreviewPretrainingLoadSample;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const pollMs = options.pollMs ?? 5_000;
  const started = now();
  let reason = readPreviewPretrainingPauseReason(sample(), false, options.policy);
  if (reason === undefined) return 0;
  options.log?.(`paused: ${reason}`);
  let lastLog = started;
  while (reason !== undefined) {
    await sleep(pollMs);
    reason = readPreviewPretrainingPauseReason(sample(), true, options.policy);
    if (reason !== undefined && now() - lastLog >= 60_000) {
      lastLog = now();
      options.log?.(
        `still paused after ${String(Math.round((lastLog - started) / 1_000))} s: ${reason}`,
      );
    }
  }
  const pausedMs = now() - started;
  options.log?.(`resumed after ${String(Math.round(pausedMs / 1_000))} s`);
  return pausedMs;
}

/** Reads macOS memory pressure; other platforms report none. */
function readMemoryPressure(): { readonly memoryPressure?: number } {
  if (process.platform !== 'darwin') return {};
  try {
    const level = Number(
      execFileSync('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], {
        encoding: 'utf8',
        timeout: 2_000,
      }).trim(),
    );
    return Number.isFinite(level) ? { memoryPressure: level } : {};
  } catch {
    return {};
  }
}
