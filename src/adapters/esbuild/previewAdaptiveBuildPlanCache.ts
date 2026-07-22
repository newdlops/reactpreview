/**
 * Reuses graph-proven router, lexical-global, and portal-host requirements across hot rebuilds.
 * The first build for a target may still expand its plan once; later revisions start from the last
 * successful evidence and avoid the former unconditional discovery build.
 */

const MAX_ADAPTIVE_BUILD_PLANS = 256;

/** Minimal router evidence needed to choose the automatic bridge before a native rebuild. */
export interface CachedPreviewRouterRequirement {
  /** Whether any reached source consumed a supported router API. */
  readonly consumesRouter: boolean;
  /** Whether the reached application graph already rendered its own router provider. */
  readonly ownsRouter: boolean;
}

/** Evidence retained for one target/configuration identity. */
export interface PreviewAdaptiveBuildPlan {
  /** Sloppy CommonJS assignment globals proven by the last successful dependency graph. */
  readonly legacyCommonJsGlobalNames: readonly string[];
  /** Exact portal roots discovered from the last successful esbuild input graph. */
  readonly portalHostIds: readonly string[];
  /** Free lexical identifiers that required exact installed-package fallback on the last build. */
  readonly referencedGlobalNames: readonly string[];
  /** Last graph-proven router ownership requirement. */
  readonly routerRequirement: CachedPreviewRouterRequirement;
}

/** Small LRU-like cache containing JSON-safe build requirements only. */
export class PreviewAdaptiveBuildPlanCache {
  private readonly plans = new Map<string, PreviewAdaptiveBuildPlan>();

  /** Returns and refreshes the latest evidence for one stable target/configuration key. */
  public read(cacheKey: string): PreviewAdaptiveBuildPlan | undefined {
    const plan = this.plans.get(cacheKey);
    if (plan !== undefined) {
      this.plans.delete(cacheKey);
      this.plans.set(cacheKey, plan);
    }
    return plan;
  }

  /** Replaces stale evidence after a successful build and bounds retained target count. */
  public write(cacheKey: string, plan: PreviewAdaptiveBuildPlan): void {
    this.plans.delete(cacheKey);
    this.plans.set(
      cacheKey,
      Object.freeze({
        legacyCommonJsGlobalNames: Object.freeze(
          [...new Set(plan.legacyCommonJsGlobalNames)].sort(),
        ),
        portalHostIds: Object.freeze([...new Set(plan.portalHostIds)].sort()),
        referencedGlobalNames: Object.freeze([...new Set(plan.referencedGlobalNames)].sort()),
        routerRequirement: Object.freeze({ ...plan.routerRequirement }),
      }),
    );
    while (this.plans.size > MAX_ADAPTIVE_BUILD_PLANS) {
      const oldestKey = this.plans.keys().next().value;
      if (oldestKey === undefined) {
        return;
      }
      this.plans.delete(oldestKey);
    }
  }

  /** Removes all package/target evidence during compiler shutdown. */
  public clear(): void {
    this.plans.clear();
  }
}
