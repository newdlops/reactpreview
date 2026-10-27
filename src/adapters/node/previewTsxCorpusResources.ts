/** Samples host resources and enforces campaign supervisor admission. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseManifest, writeJsonAtomic } from './previewTsxCorpusFiles';
import { PrimaryLane } from './previewTsxCorpusLane';
import {
  type CampaignResourceSample,
  type CampaignState,
  execFileAsync,
  GIB,
  MIB,
} from './previewTsxCorpusModel';

/** One bounded, fail-closed sampler for the campaign-owned detached process groups. */
export class CampaignResourceSupervisor {
  #baseline: CampaignResourceSample | undefined;
  #hardReason: string | undefined;
  #interval: NodeJS.Timeout | undefined;
  #paused = false;
  #pauseEvents: { readonly atEpochMs: number; readonly reason: string }[] = [];
  #quarantined = new Set<number>();
  #running: Promise<void> | undefined;
  #samples: CampaignResourceSample[] = [];
  #unavailable: string | undefined;

  /** Borrows campaign state and its live owned lanes for resource accounting without taking their lifecycle ownership. */
  constructor(
    private readonly state: CampaignState,
    private readonly lanes: ReadonlySet<PrimaryLane>,
  ) {}

  /** Takes the baseline resource sample and starts the unreferenced periodic sampler. */
  async start(): Promise<void> {
    await this.sample();
    this.#interval = setInterval(() => {
      void this.sample();
    }, 1_000);
    this.#interval.unref();
  }

  /** Stops periodic sampling and takes the final resource observation before terminal reporting. */
  async stop(): Promise<void> {
    if (this.#interval !== undefined) clearInterval(this.#interval);
    this.#interval = undefined;
    await this.sample();
  }

  /** Pauses dispatch at soft limits and rejects claims when a hard resource limit has been recorded. */
  async beforeClaim(): Promise<void> {
    await this.sample();
    this.assertWithinHardLimit();
    while (this.#paused) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1_000);
        timer.unref();
      });
      await this.sample();
      this.assertWithinHardLimit();
    }
  }

  /** Rejects new dispatch after any asynchronous sample records a hard resource limit. */
  private assertWithinHardLimit(): void {
    if (this.#hardReason !== undefined) throw new Error(this.#hardReason);
  }

  /** Returns the latest owned-group resident byte count for a lane when sampling supplied it. */
  laneRssBytes(laneId: number): number | undefined {
    return this.#samples.at(-1)?.laneOwnedRssBytes[laneId.toString()];
  }

  /** Quarantines lanes above the hard RSS limit and requests retirement at bounded growth or absolute thresholds. */
  generationMustRetire(laneId: number, postWarmRssBytes: number | undefined): boolean {
    const rss = this.laneRssBytes(laneId);
    if (rss === undefined) return false;
    if (rss >= 3.5 * GIB) {
      this.#quarantined.add(laneId);
      this.#hardReason ??= `Primary lane ${laneId.toString()} exceeded the 3.5 GiB quarantine limit.`;
      return true;
    }
    return rss >= 2.5 * GIB || (postWarmRssBytes !== undefined && rss - postWarmRssBytes >= GIB);
  }

  /** Writes bounded sample history and returns the final gate only when resource evidence is complete and within limits. */
  async persist(final: boolean): Promise<boolean> {
    const latest = this.#samples.at(-1);
    const baseline = this.#baseline;
    const complete =
      final && latest !== undefined && baseline !== undefined && this.#unavailable === undefined;
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

  /** Coalesces concurrent sampler calls into one observation and retains failures in the resource report. */
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

  /** Reads bounded macOS process, swap, and compression observations for campaign-owned groups only. */
  private async collect(): Promise<void> {
    const sampledAtEpochMs = Date.now();
    try {
      if (process.platform !== 'darwin')
        throw new Error('resource sampling requires macOS ps/vm_stat/sysctl.');
      const [processes, swap, vm] = await Promise.all([
        execFileAsync('/bin/ps', ['-Ao', 'pid=,ppid=,pgid=,rss='], {
          maxBuffer: 512 * 1024,
          timeout: 2_000,
        }),
        execFileAsync('/usr/sbin/sysctl', ['-n', 'vm.swapusage'], {
          maxBuffer: 16 * 1024,
          timeout: 2_000,
        }),
        execFileAsync('/usr/bin/vm_stat', [], { maxBuffer: 128 * 1024, timeout: 2_000 }),
      ]);
      const pgids = new Map<number, number>();
      for (const lane of this.lanes) {
        if (lane.child.pid !== undefined) pgids.set(lane.child.pid, lane.laneId);
      }
      const laneOwnedRssBytes: Record<string, number> = {};
      for (const line of processes.stdout.split('\n')) {
        const fields = line.trim().split(/\s+/u);
        if (fields.length !== 4) continue;
        const pgid = Number(fields[2]);
        const rssKiB = Number(fields[3]);
        const laneId = pgids.get(pgid);
        if (laneId === undefined || !Number.isSafeInteger(rssKiB)) continue;
        laneOwnedRssBytes[laneId.toString()] =
          (laneOwnedRssBytes[laneId.toString()] ?? 0) + rssKiB * 1024;
      }
      const compressedBytes = parseCompressedBytes(vm.stdout);
      const swapBytes = parseSwapBytes(swap.stdout);
      const sample: CampaignResourceSample = {
        aggregateOwnedRssBytes: Object.values(laneOwnedRssBytes).reduce(
          (sum, value) => sum + value,
          0,
        ),
        ...(compressedBytes === undefined ? {} : { compressedBytes }),
        laneOwnedRssBytes,
        sampledAtEpochMs,
        ...(swapBytes === undefined ? {} : { swapBytes }),
      };
      this.recordSample(sample);
    } catch (error) {
      const unavailable = error instanceof Error ? error.message.slice(0, 1_000) : String(error);
      this.#unavailable ??= unavailable;
      this.recordSample({
        aggregateOwnedRssBytes: 0,
        laneOwnedRssBytes: {},
        sampledAtEpochMs,
        unavailable,
      });
    }
  }

  /** Retains bounded resource history and updates pause, quarantine, and hard-limit state from baseline deltas. */
  private recordSample(sample: CampaignResourceSample): void {
    if (this.#baseline === undefined) this.#baseline = sample;
    this.#samples.push(sample);
    if (this.#samples.length > 3_600) this.#samples.shift();
    if (sample.unavailable !== undefined) return;
    const swapDelta =
      sample.swapBytes === undefined || this.#baseline.swapBytes === undefined
        ? Number.POSITIVE_INFINITY
        : sample.swapBytes - this.#baseline.swapBytes;
    const compressedDelta =
      sample.compressedBytes === undefined || this.#baseline.compressedBytes === undefined
        ? Number.POSITIVE_INFINITY
        : sample.compressedBytes - this.#baseline.compressedBytes;
    const hard =
      sample.aggregateOwnedRssBytes >= 32 * GIB || swapDelta >= GIB || compressedDelta >= 4 * GIB;
    if (hard) {
      this.#hardReason ??= 'Campaign resource hard limit reached.';
      return;
    }
    const pause =
      sample.aggregateOwnedRssBytes >= 28 * GIB ||
      swapDelta >= 512 * MIB ||
      compressedDelta >= 2 * GIB;
    if (pause && !this.#paused)
      this.#pauseEvents.push({
        atEpochMs: sample.sampledAtEpochMs,
        reason: 'resource-pause-threshold',
      });
    this.#paused = pause;
  }
}

/** Parses used swap megabytes from macOS sysctl output and returns bytes when the expected format is present. */
export function parseSwapBytes(source: string): number | undefined {
  const match = /total = ([\d.]+)M\s+used = ([\d.]+)M/iu.exec(source);
  return match === null ? undefined : Math.round(Number(match[2]) * MIB);
}

/** Locates each mandatory sentinel uniquely in the frozen manifest and returns its expected source and fidelity identity. */
export async function frozenMandatorySentinels(
  manifestPath: string,
): Promise<
  readonly { readonly digest: string; readonly fidelity: string; readonly index: number }[]
> {
  const rows = parseManifest(await readFile(manifestPath, 'utf8'));
  const suffix =
    'legal/right-to-consent-or-consult/pages/rtcc-investment-contract-management-page/investment-agreement-management-modals.tsx';
  const matches = rows
    .map((row, index) => ({ index, row }))
    .filter(({ row }) => row.path.endsWith(suffix));
  if (matches.length !== 1 || matches[0] === undefined)
    throw new Error('Mandatory v9 corridor is not uniquely frozen.');
  return [
    {
      digest: matches[0].row.sha256,
      fidelity: 'pending-expanded-certification',
      index: matches[0].index,
    },
  ];
}

/** Parses compressed-memory page counts and their page size from macOS vm_stat output. */
export function parseCompressedBytes(source: string): number | undefined {
  const pageSize = 4096;
  const match = /Pages occupied by compressor:\s+(\d+)\./u.exec(source);
  return match === null ? undefined : Number(match[1]) * pageSize;
}
