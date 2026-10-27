/**
 * Keeps import answers and package metadata inside one analysis program.
 * Every new program starts with fresh resolution answers and the caller's fresh filesystem host.
 * Parsed source reuse remains independent; no saved lookup evidence or negative answers cross
 * programs. Capacity limits affect storage only, never ordinary module resolution or source reads.
 */
import path from 'node:path';
import type ts from 'typescript';

const MAX_CACHED_RESOLUTIONS = 50_000;
const MAX_METADATA_READ_BYTES = 1024 * 1024;

/** Bounded admission answers whose lifetime ends before the next program is constructed. */
export class PreviewTypeResolutionCache {
  private readonly resolutions = new Map<string, string | null>();

  /** Releases answers without affecting a previously created program's immutable import graph. */
  public clear(): void {
    this.resolutions.clear();
  }

  /** Reads a path, a remembered miss, or undefined when this program has no answer yet. */
  public read(key: string): string | null | undefined {
    return this.resolutions.get(key);
  }

  /** Retains current-program answers; a full cache keeps ordinary resolution available. */
  public write(key: string, resolvedFileName: string | undefined): void {
    if (this.resolutions.size >= MAX_CACHED_RESOLUTIONS && !this.resolutions.has(key)) return;
    this.resolutions.set(key, resolvedFileName ?? null);
  }

  /**
   * Starts an empty program scope without eagerly replaying filesystem queries.
   * Only package metadata is memoized; current source reads and all other host behavior stay live.
   * Each returned host owns its metadata so an older program cannot populate the next program.
   */
  public createHost(host: ts.ModuleResolutionHost): ts.ModuleResolutionHost {
    this.clear();
    const metadata = new Map<string, string | undefined>();
    let metadataBytes = 0;
    return {
      ...host,
      readFile(fileName): string | undefined {
        if (path.basename(fileName) !== 'package.json') return host.readFile(fileName);
        if (metadata.has(fileName)) return metadata.get(fileName);
        const value = host.readFile(fileName);
        const bytes = 64 + 2 * (fileName.length + (value?.length ?? 0));
        if (metadataBytes + bytes <= MAX_METADATA_READ_BYTES) {
          metadata.set(fileName, value);
          metadataBytes += bytes;
        }
        return value;
      },
    };
  }
}
