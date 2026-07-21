/**
 * Bounds host-session advisory repetition without hiding a newly changed failure.
 * Diagnostics admitted here are informational compiler decisions; build errors remain uncached and
 * are always surfaced by the owning revision.
 */
import type { Message } from 'esbuild';

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

  /** Admits one esbuild advisory once across hot rebuilds using only stable source identity. */
  public admitBuildWarning(message: Message): boolean {
    const location = message.location;
    return this.admit(
      [
        'esbuild-warning',
        message.id,
        location?.file ?? '',
        location?.line ?? '',
        location?.column ?? '',
        message.text,
      ].join('\0'),
    );
  }

  /** Removes all target identities during compiler shutdown. */
  public clear(): void {
    this.identities.clear();
  }
}
