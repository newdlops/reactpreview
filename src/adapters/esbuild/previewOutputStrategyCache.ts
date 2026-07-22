/**
 * Remembers targets whose native ESM splitting produced excessive local artifact fan-out.
 * The cache is compiler-local and bounded: it avoids repeating an expensive failed split attempt
 * on every hot reload while never persisting project identities beyond the extension host session.
 */
const MAX_CACHED_OUTPUT_STRATEGIES = 256;

/** Evidence retained after one split build crossed the configured local output-file threshold. */
export interface PreviewCoalescedOutputStrategy {
  /** Number of files emitted by the split attempt that selected the coalesced fallback. */
  readonly splitOutputCount: number;
}

/** LRU-like cache of target plans that should start subsequent revisions in coalesced mode. */
export class PreviewOutputStrategyCache {
  private readonly strategies = new Map<string, PreviewCoalescedOutputStrategy>();

  /**
   * Starts every local preview in coalesced mode. Dynamic imports still initialize lazily inside the
   * entry artifact, while esbuild never allocates thousands of output-file objects merely to learn
   * that the graph exceeds the fan-out threshold. The retained cache API preserves compatibility
   * with session evidence written by older compiler paths.
   */
  public shouldSplit(): boolean {
    return false;
  }

  /** Returns and refreshes prior fan-out evidence for one stable target/runtime plan. */
  public read(cacheKey: string): PreviewCoalescedOutputStrategy | undefined {
    const strategy = this.strategies.get(cacheKey);
    if (strategy !== undefined) {
      this.strategies.delete(cacheKey);
      this.strategies.set(cacheKey, strategy);
    }
    return strategy;
  }

  /** Records a split overflow and evicts the least recently used strategy beyond the fixed bound. */
  public write(cacheKey: string, splitOutputCount: number): void {
    this.strategies.delete(cacheKey);
    this.strategies.set(cacheKey, Object.freeze({ splitOutputCount }));
    while (this.strategies.size > MAX_CACHED_OUTPUT_STRATEGIES) {
      const oldestKey = this.strategies.keys().next().value;
      if (oldestKey === undefined) {
        return;
      }
      this.strategies.delete(oldestKey);
    }
  }

  /** Removes all target identities during compiler shutdown. */
  public clear(): void {
    this.strategies.clear();
  }
}
