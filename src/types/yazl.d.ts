declare module 'yazl' {
  import type { Readable } from 'node:stream';

  /** Minimal deterministic archive writer used only by focused source-cache tests. */
  export class ZipFile {
    /** Readable archive bytes emitted after entries are added. */
    readonly outputStream: Readable;
    /** Adds one in-memory entry at an exact portable metadata path. */
    addBuffer(contents: Buffer, metadataPath: string): void;
    /** Finalizes the central directory and closes the output stream. */
    end(): void;
  }
}
