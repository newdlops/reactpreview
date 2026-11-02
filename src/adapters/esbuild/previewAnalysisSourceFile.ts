/** Creates inert, parent-linked syntax for read-only preview analysis. */
import ts from 'typescript';

const MAXIMUM_ENTRIES = 512;
const MAXIMUM_STRING_BYTES = 4 * 1024 * 1024;
const MAXIMUM_SOURCE_LENGTH = 128 * 1024;
/** Budgets account for UTF-16 strings; parser trees have additional heap cost. */
const MAXIMUM_ACTIVE_ENTRIES = 1024;
const MAXIMUM_ACTIVE_STRING_BYTES = 8 * 1024 * 1024;

interface AnalysisSourceEntry {
  readonly sourceText: string;
  readonly sourceFile: WeakRef<ts.SourceFile>;
  readonly stringBytes: number;
  /** Owned only while a compiler job is active; never retained between completed jobs. */
  retainedSourceFile?: ts.SourceFile;
}

const entries = new Map<string, AnalysisSourceEntry>();
let retainedStringBytes = 0;
let activeJobs = 0;

/**
 * Keeps bounded, read-only syntax alive through one compiler job's asynchronous stages.
 * Parallel and nested jobs share one budget. The last job releases all cache-owned strong references
 * and restores the ordinary weak-cache limits, including when work throws or is cancelled.
 *
 * @param work Compiler operation supplied by the trusted composition root.
 * @returns The operation's unchanged result.
 * @throws Propagates operation failures after releasing its retention lease.
 */
export async function withPreviewAnalysisSourceFileRetention<T>(
  work: () => Promise<T>,
): Promise<T> {
  activeJobs += 1;
  try {
    return await work();
  } finally {
    activeJobs -= 1;
    if (activeJobs === 0) {
      for (const entry of entries.values()) delete entry.retainedSourceFile;
      trimAnalysisSourceEntries(MAXIMUM_ENTRIES, MAXIMUM_STRING_BYTES);
    }
  }
}

/**
 * Reads live, exact syntax without creating a parse or replacing another reader's cached text.
 *
 * @param sourcePath Exact parser file identity.
 * @param sourceText Current authored text, including unsaved edits.
 * @param scriptKind Exact grammar of the requesting read-only analyzer.
 * @returns Matching immutable syntax, or `undefined`; misses never parse or change the cache.
 */
export function readCachedPreviewAnalysisSourceFile(
  sourcePath: string,
  sourceText: string,
  scriptKind: ts.ScriptKind,
): ts.SourceFile | undefined {
  const key = `${scriptKind.toString()}:${sourcePath}`;
  const entry = entries.get(key);
  const sourceFile =
    entry?.sourceText === sourceText
      ? (entry.retainedSourceFile ?? entry.sourceFile.deref())
      : undefined;
  if (sourceFile !== undefined && entry !== undefined) {
    if (activeJobs > 0) entry.retainedSourceFile = sourceFile;
    entries.delete(key);
    entries.set(key, entry);
  }
  return sourceFile;
}

/**
 * Reuses exact syntax for read-only analyzers, never for type checking or transformation.
 *
 * @param sourcePath Exact parser file identity; callers retain their existing normalization.
 * @param sourceText Current authored snapshot, including unsaved edits.
 * @param scriptKind The caller's existing grammar, kept distinct even for the same file name.
 * @returns Parent-linked syntax whose nodes callers must neither mutate nor attach to a checker.
 */
export function readPreviewAnalysisSourceFile(
  sourcePath: string,
  sourceText: string,
  scriptKind: ts.ScriptKind,
): ts.SourceFile {
  const key = `${scriptKind.toString()}:${sourcePath}`;
  const previous = entries.get(key);
  if (previous !== undefined) {
    const sourceFile =
      previous.sourceText === sourceText
        ? (previous.retainedSourceFile ?? previous.sourceFile.deref())
        : undefined;
    entries.delete(key);
    if (sourceFile !== undefined) {
      if (activeJobs > 0) previous.retainedSourceFile = sourceFile;
      entries.set(key, previous);
      return sourceFile;
    }
    retainedStringBytes -= previous.stringBytes;
  }

  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const stringBytes = (key.length + sourceText.length) * 2;
  if (sourceText.length > MAXIMUM_SOURCE_LENGTH || stringBytes > MAXIMUM_STRING_BYTES) {
    return sourceFile;
  }
  const maximumEntries = activeJobs > 0 ? MAXIMUM_ACTIVE_ENTRIES : MAXIMUM_ENTRIES;
  const maximumStringBytes = activeJobs > 0 ? MAXIMUM_ACTIVE_STRING_BYTES : MAXIMUM_STRING_BYTES;
  trimAnalysisSourceEntries(maximumEntries - 1, maximumStringBytes - stringBytes);
  entries.set(key, {
    sourceText,
    sourceFile: new WeakRef(sourceFile),
    stringBytes,
    ...(activeJobs > 0 ? { retainedSourceFile: sourceFile } : {}),
  });
  retainedStringBytes += stringBytes;
  return sourceFile;
}

/** Removes only the oldest cache facts; readers still own any syntax they are using. */
function trimAnalysisSourceEntries(maximumEntries: number, maximumStringBytes: number): void {
  while (entries.size > maximumEntries || retainedStringBytes > maximumStringBytes) {
    const oldest = entries.entries().next().value;
    if (oldest === undefined) break;
    const [oldestKey, oldestEntry] = oldest;
    retainedStringBytes -= oldestEntry.stringBytes;
    entries.delete(oldestKey);
  }
}

/** Releases analysis syntax when its compiler shuts down. */
export function clearPreviewAnalysisSourceFileCache(): void {
  entries.clear();
  retainedStringBytes = 0;
}
