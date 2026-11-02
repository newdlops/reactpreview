/**
 * Reuses saved analysis text only after revalidating its exact disk identity.
 * The owning program cache prunes this map to relevant files and clears it on shutdown/heap gates;
 * decoded text also feeds the existing parsed-source cache without copying its contents here.
 * Editor snapshots bypass this reader, and import/package resolution remains fresh each program.
 */
import { statSync, type BigIntStats } from 'node:fs';
import ts from 'typescript';

interface SavedSourceText {
  /** Conservative retained string/key bytes, including fixed entry overhead. */
  readonly bytes: number;
  /** Complete identity observed before and after reading this text. */
  readonly identity: string;
  /** Decoded TypeScript input; its length still counts toward each program's admission budget. */
  readonly text: string;
}

/** Identity-checked disk text retained only for the owning analysis cache's relevant paths. */
export class PreviewTypeSourceTextCache {
  private readonly entries = new Map<string, SavedSourceText>();
  private retainedBytes = 0;

  /** Creates an optional storage ceiling; files beyond it are still read and returned normally. */
  public constructor(private readonly maxRetainedBytes = Infinity) {}

  /**
   * Returns current decoded text or an oversized file's byte count for admission refusal.
   * Full nanosecond stamps detect same-size edits with restored mtime and symlink replacements.
   * Changed/missing inputs never reuse old bytes; read races are not retained for later programs.
   */
  public read(fileName: string, limit: number): string | number | undefined {
    const before = statSync(fileName, { bigint: true, throwIfNoEntry: false });
    // Preserve the admission guard: UTF-8 uses at most three bytes per UTF-16 code unit.
    if (before !== undefined && Number(before.size) > limit * 3) return Number(before.size);
    const identity = before === undefined ? undefined : readIdentity(before);
    const cached = this.entries.get(fileName);
    if (identity !== undefined && cached?.identity === identity) return cached.text;
    this.forget(fileName);
    const text = ts.sys.readFile(fileName);
    if (text === undefined || identity === undefined || text.length > limit) return text;
    const bytes = 64 + 2 * (fileName.length + identity.length + text.length);
    if (this.retainedBytes + bytes > this.maxRetainedBytes) return text;
    try {
      const after = statSync(fileName, { bigint: true, throwIfNoEntry: false });
      if (after !== undefined && identity === readIdentity(after)) {
        this.entries.set(fileName, { bytes, identity, text });
        this.retainedBytes += bytes;
      }
    } catch {
      // A post-read deletion/permission race must not turn a successful read into a build error.
    }
    return text;
  }

  /** Releases text excluded from this program, keeping storage under its existing admission cap. */
  public retainOnly(fileKeys: ReadonlySet<string>): void {
    for (const key of this.entries.keys()) {
      if (!fileKeys.has(key)) this.forget(key);
    }
  }

  /** Drops all disk text when the owning oracle releases its reusable analysis state. */
  public clear(): void {
    this.entries.clear();
    this.retainedBytes = 0;
  }

  /** Returns a removed entry's allowance without changing live filesystem reads. */
  private forget(fileName: string): void {
    const entry = this.entries.get(fileName);
    if (entry !== undefined) this.retainedBytes -= entry.bytes;
    this.entries.delete(fileName);
  }
}

/** Includes ctime so restored modification times cannot make changed bytes appear unchanged. */
function readIdentity(stats: BigIntStats): string {
  return `${String(stats.dev)}:${String(stats.ino)}:${String(stats.size)}:${String(stats.mtimeNs)}:${String(stats.ctimeNs)}`;
}
