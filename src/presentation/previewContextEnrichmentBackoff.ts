/**
 * Retains bounded process-local backoff for deterministic full-context enrichment stalls.
 *
 * A panel-local flag is lost when the preview tab is reopened, so an unchanged oversized graph can
 * repeatedly restart the isolated compiler. This cache is shared only inside the current extension
 * host process, keyed by an exact source/resource fingerprint, and expires automatically. Editing
 * the target or any captured dependency produces a new identity and bypasses the old record.
 */

/** Maximum unchanged graph identities retained across concurrently reopened preview panels. */
const ENRICHMENT_BACKOFF_ENTRY_LIMIT = 64;

/** Initial pause after one deterministic memory/native/watchdog stall. */
const ENRICHMENT_BACKOFF_INITIAL_MS = 10 * 60 * 1_000;

/** Maximum exponential pause for a repeatedly failing unchanged graph. */
const ENRICHMENT_BACKOFF_MAXIMUM_MS = 4 * 60 * 60 * 1_000;

/** Absolute retention cap, after which an old fingerprint may receive a fresh bounded attempt. */
const ENRICHMENT_BACKOFF_RETENTION_MS = 24 * 60 * 60 * 1_000;

/** One retained deterministic-stall history entry. */
interface PreviewContextEnrichmentBackoffEntry {
  readonly failedAt: number;
  readonly failureCount: number;
  readonly retryAfter: number;
}

/** Result of checking whether one unchanged resource graph may start another full pass. */
export interface PreviewContextEnrichmentBackoffDecision {
  readonly allowed: boolean;
  readonly retryAfterMs: number;
}

/** Injectable monotonic wall-clock boundary used by production and deterministic tests. */
export interface PreviewContextEnrichmentBackoffOptions {
  readonly now?: () => number;
}

/**
 * Stores deterministic full-enrichment failures with bounded size, expiry, and exponential delay.
 *
 * The class contains no VS Code objects and never persists source paths or source text. Only the
 * SHA-256 resource identity created by the coordinator enters this cache.
 */
export class PreviewContextEnrichmentBackoff {
  private readonly entries = new Map<string, PreviewContextEnrichmentBackoffEntry>();
  private readonly now: () => number;

  /** Creates an isolated cache or the extension-host shared production cache. */
  public constructor(options: PreviewContextEnrichmentBackoffOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  /** Reports whether an unchanged graph may run and how long a suppressed attempt should wait. */
  public check(resourceIdentity: string): PreviewContextEnrichmentBackoffDecision {
    const now = this.now();
    this.prune(now);
    const entry = this.entries.get(resourceIdentity);
    if (entry === undefined || now >= entry.retryAfter) {
      return { allowed: true, retryAfterMs: 0 };
    }
    return {
      allowed: false,
      retryAfterMs: Math.max(1, entry.retryAfter - now),
    };
  }

  /** Increases the pause for one deterministic stall without retaining the thrown error object. */
  public recordFailure(resourceIdentity: string): void {
    const now = this.now();
    this.prune(now);
    const previous = this.entries.get(resourceIdentity);
    const failureCount = Math.min(16, (previous?.failureCount ?? 0) + 1);
    const delay = Math.min(
      ENRICHMENT_BACKOFF_MAXIMUM_MS,
      ENRICHMENT_BACKOFF_INITIAL_MS * 2 ** Math.min(4, failureCount - 1),
    );
    this.entries.delete(resourceIdentity);
    this.entries.set(resourceIdentity, {
      failedAt: now,
      failureCount,
      retryAfter: now + delay,
    });
    while (this.entries.size > ENRICHMENT_BACKOFF_ENTRY_LIMIT) {
      const oldestIdentity = this.entries.keys().next().value;
      if (oldestIdentity === undefined) break;
      this.entries.delete(oldestIdentity);
    }
  }

  /** Clears stale failure history after the exact graph completes successfully. */
  public recordSuccess(resourceIdentity: string): void {
    this.entries.delete(resourceIdentity);
  }

  /** Removes expired records and keeps recent insertion order useful for bounded eviction. */
  private prune(now: number): void {
    for (const [identity, entry] of this.entries) {
      if (now - entry.failedAt >= ENRICHMENT_BACKOFF_RETENTION_MS) {
        this.entries.delete(identity);
      }
    }
  }
}

/** Shared extension-host cache that lets reopened panels remember an unchanged expensive graph. */
export const sharedPreviewContextEnrichmentBackoff = new PreviewContextEnrichmentBackoff();
