declare module 'yauzl' {
  import type { Readable } from 'node:stream';

  export interface Entry {
    readonly crc32: number;
    readonly fileName: string;
    readonly uncompressedSize: number;
  }

  export interface ZipFile {
    readonly entryCount: number;
    close(): void;
    on(event: 'end', listener: () => void): this;
    on(event: 'entry', listener: (entry: Entry) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    openReadStreamPromise(entry: Entry): Promise<Readable>;
    readEntry(): void;
    removeListener(event: 'end', listener: () => void): this;
    removeListener(event: 'entry', listener: (entry: Entry) => void): this;
    removeListener(event: 'error', listener: (error: Error) => void): this;
  }

  export function openPromise(
    archivePath: string,
    options: {
      readonly autoClose: boolean;
      readonly lazyEntries: boolean;
      readonly strictFileNames: boolean;
      readonly validateEntrySizes: boolean;
    },
  ): Promise<ZipFile>;
}
