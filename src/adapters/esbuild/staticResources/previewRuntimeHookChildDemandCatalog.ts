/**
 * Defers bounded child-contract analysis until a consumer requests that exact component.
 * Complete Map enumeration still resolves every admitted binding in the original source order.
 * This catalog belongs to one immutable source snapshot; it retains no filesystem cache or AST.
 */
import type { PreviewRuntimeHookChildPropDemandCatalog } from './previewRuntimeHookChildDemandModel';
import type { PreviewInferredPropShape } from './reactExportPropInference';

type ChildProperties = ReadonlyMap<string, PreviewInferredPropShape>;

/**
 * Creates a request-local Map whose lookups compute only the requested admitted child.
 *
 * @param names Existing bounded component identities in unchanged source priority order.
 * @param resolve Reads one compiler-owned contract; undefined keeps that binding absent.
 * @returns A complete ReadonlyMap contract, with deferred own entries and ordinary Map iteration.
 */
export function createPreviewRuntimeHookChildDemandCatalog(
  names: readonly string[],
  resolve: (name: string) => ChildProperties | undefined,
): PreviewRuntimeHookChildPropDemandCatalog {
  return new PreviewRuntimeHookChildDemandCatalog(names, resolve);
}

/** Keeps misses, reentrant lookups, and complete enumeration within the admitted name set. */
class PreviewRuntimeHookChildDemandCatalog extends Map<string, ChildProperties> {
  private readonly names: ReadonlySet<string>;
  private readonly resolved = new Set<string>();
  private readonly resolving = new Set<string>();
  private complete = false;

  /** Captures a finite identity list and its snapshot-confined resolver without reading children. */
  public constructor(
    names: readonly string[],
    private readonly resolve: (name: string) => ChildProperties | undefined,
  ) {
    super();
    this.names = new Set(names);
  }

  /** Resolves one admitted identity at most once; recursive reads fail open like inference cycles. */
  public override get(name: string): ChildProperties | undefined {
    if (!this.names.has(name)) return undefined;
    if (!this.resolved.has(name) && !this.resolving.has(name)) {
      this.resolving.add(name);
      try {
        const properties = this.resolve(name);
        if (properties !== undefined) super.set(name, properties);
        this.resolved.add(name);
      } finally {
        this.resolving.delete(name);
      }
    }
    return super.get(name);
  }

  /** Reports actual availability, including a remembered unresolved child. */
  public override has(name: string): boolean {
    this.get(name);
    return super.has(name);
  }

  /** Counts actual inferred children rather than reporting the larger admitted-name upper bound. */
  public override get size(): number {
    this.materializeAll();
    return super.size;
  }

  /** Resolves the finite remainder before returning ordinary source-order entry iteration. */
  public override entries(): ReturnType<Map<string, ChildProperties>['entries']> {
    this.materializeAll();
    return super.entries();
  }

  /** Retains the ordinary Map ordering even when callers queried a later child first. */
  public override keys(): ReturnType<Map<string, ChildProperties>['keys']> {
    this.materializeAll();
    return super.keys();
  }

  /** Enumerates every available value after resolving all originally admitted identities. */
  public override values(): ReturnType<Map<string, ChildProperties>['values']> {
    this.materializeAll();
    return super.values();
  }

  /** Preserves callback receiver and Map identity while exposing the complete original ordering. */
  public override forEach(
    callback: (value: ChildProperties, key: string, map: Map<string, ChildProperties>) => void,
    thisArg?: unknown,
  ): void {
    this.materializeAll();
    super.forEach(callback, thisArg);
  }

  /** Gives spread and new Map(catalog) the same complete entries as explicit enumeration. */
  public override [Symbol.iterator](): ReturnType<Map<string, ChildProperties>['entries']> {
    return this.entries();
  }

  /** Reorders only once, before any complete iterator escapes to a consumer. */
  private materializeAll(): void {
    if (this.complete) return;
    for (const name of this.names) this.get(name);
    const ordered = [...this.names].flatMap((name) => {
      const properties = super.get(name);
      return properties === undefined ? [] : [[name, properties] as const];
    });
    super.clear();
    for (const [name, properties] of ordered) super.set(name, properties);
    this.complete = true;
  }
}
