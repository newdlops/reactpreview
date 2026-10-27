/**
 * Shares exact filesystem lookup facts during one static resolver or analysis program.
 * Callers create a fresh host for each build; no disk state, source text, or editor snapshots are
 * retained across builds. Filesystem errors propagate, and the storage cap never limits resolution.
 */
import ts from 'typescript';

/** Maximum total file, directory, and realpath facts retained by one build-owned host. */
export const PREVIEW_RESOLUTION_FILE_SYSTEM_CACHE_LIMIT = 4096;

/** Module-resolution host with a directory reader available to compiler-host consumers. */
export interface PreviewResolutionFileSystem extends ts.ModuleResolutionHost {
  /** Exact file-presence lookup that can be passed to a compiler host without a receiver. */
  readonly fileExists: (fileName: string) => boolean;
  /** Exact directory-presence lookup that can be passed without a receiver. */
  readonly directoryExists: (directoryName: string) => boolean;
  /** TypeScript's optional symlink resolver, bound to the original system implementation. */
  readonly realpath?: (fileName: string) => string;
}

/** One bounded lookup entry, removable without retaining a second path-key string. */
interface RetainedLookup {
  readonly forget: () => void;
}

interface CachedLookup<T> extends RetainedLookup {
  readonly value: T;
}

/**
 * Creates bounded lookup reuse without changing TypeScript's filesystem answers or path spelling.
 * Source reads stay live so caller-owned unsaved snapshots and admitted text remain authoritative.
 * A thrown lookup is not remembered. New builds must create another instance to recheck changes.
 */
export function createPreviewResolutionFileSystem(): PreviewResolutionFileSystem {
  const files = new Map<string, CachedLookup<boolean>>();
  const directories = new Map<string, CachedLookup<boolean>>();
  const realPaths = new Map<string, CachedLookup<string>>();
  const probation = new Set<RetainedLookup>();
  const repeated = new Set<RetainedLookup>();
  const repeatedLimit = PREVIEW_RESOLUTION_FILE_SYSTEM_CACHE_LIMIT / 2;

  /** Protects repeatedly used facts from one-time scans within the unchanged shared storage cap. */
  function readLookup<T extends boolean | string>(
    cache: Map<string, CachedLookup<T>>,
    fileName: string,
    read: () => T,
  ): T {
    const cached = cache.get(fileName);
    if (cached !== undefined) {
      probation.delete(cached);
      repeated.delete(cached);
      repeated.add(cached);
      if (repeated.size > repeatedLimit) {
        const oldest = repeated.values().next().value;
        if (oldest !== undefined) {
          repeated.delete(oldest);
          probation.add(oldest);
        }
      }
      return cached.value;
    }
    const value = read();
    if (probation.size + repeated.size >= PREVIEW_RESOLUTION_FILE_SYSTEM_CACHE_LIMIT) {
      const oldest = probation.values().next().value;
      if (oldest !== undefined) {
        oldest.forget();
        probation.delete(oldest);
      }
    }
    const entry = { forget: () => cache.delete(fileName), value };
    cache.set(fileName, entry);
    probation.add(entry);
    return value;
  }

  const realpath = ts.sys.realpath?.bind(ts.sys);
  return {
    directoryExists: (directory) =>
      readLookup(directories, directory, () => ts.sys.directoryExists(directory)),
    fileExists: (fileName) => readLookup(files, fileName, () => ts.sys.fileExists(fileName)),
    getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
    getDirectories: (directory) => ts.sys.getDirectories(directory),
    readFile: (fileName) => ts.sys.readFile(fileName),
    ...(realpath === undefined
      ? {}
      : {
          realpath: (fileName: string) => readLookup(realPaths, fileName, () => realpath(fileName)),
        }),
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
  };
}
