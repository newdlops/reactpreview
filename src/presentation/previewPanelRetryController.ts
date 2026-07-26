/**
 * Owns opaque retry-token lifecycle independently from the panel, compiler, and webview HTML.
 *
 * Keeping this small controller separate makes retry validation deterministic and prevents the
 * large panel lifecycle from retaining another mutable protocol concern.
 */
import type { PendingPreviewRetry } from './previewPanelSessionState';

/** Session-local retry token authority for one pinned preview panel. */
export class PreviewPanelRetryController {
  private pending: PendingPreviewRetry | undefined;
  private sequence = 0;

  /** Mints the only retry action accepted until it is used, replaced, or cleared. */
  public create(revision: number): PendingPreviewRetry {
    this.sequence += 1;
    const retry = {
      revision,
      token: `${revision.toString(36)}.${this.sequence.toString(36)}.${Date.now().toString(36)}`,
    } as const;
    this.pending = retry;
    return retry;
  }

  /** Consumes a matching browser request exactly once. */
  public accept(request: PendingPreviewRetry): boolean {
    const pending = this.pending;
    if (pending?.revision !== request.revision || pending.token !== request.token) {
      return false;
    }
    this.pending = undefined;
    return true;
  }

  /** Invalidates a retry action when a normal artifact commits or the session disposes. */
  public clear(): void {
    this.pending = undefined;
  }
}
