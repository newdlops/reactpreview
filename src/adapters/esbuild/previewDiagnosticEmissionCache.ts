/**
 * Bounds host-session advisory repetition without hiding a newly changed failure.
 * Diagnostics admitted here are informational compiler decisions; build errors remain uncached and
 * are always surfaced by the owning revision.
 */

const MAX_EMITTED_DIAGNOSTICS = 512;

/** Compiler-lifetime LRU set for one-time advisory identities. */
export class PreviewDiagnosticEmissionCache {
  private readonly identities = new Set<string>();

  /** Returns `true` once for an identity and refreshes already-seen entries without re-emitting. */
  public admit(identity: string): boolean {
    const alreadyEmitted = this.identities.delete(identity);
    this.identities.add(identity);
    while (this.identities.size > MAX_EMITTED_DIAGNOSTICS) {
      const oldestIdentity = this.identities.values().next().value;
      if (oldestIdentity === undefined) {
        break;
      }
      this.identities.delete(oldestIdentity);
    }
    return !alreadyEmitted;
  }

  /** Removes all target identities during compiler shutdown. */
  public clear(): void {
    this.identities.clear();
  }
}
