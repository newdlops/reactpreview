/** Creates inert, parent-linked syntax for read-only preview analysis. */
import ts from 'typescript';

const MAXIMUM_ENTRIES = 512;
const MAXIMUM_STRING_BYTES = 4 * 1024 * 1024;
const MAXIMUM_SOURCE_LENGTH = 128 * 1024;

interface AnalysisSourceEntry {
  readonly sourceText: string;
  readonly sourceFile: WeakRef<ts.SourceFile>;
  readonly stringBytes: number;
}

const entries = new Map<string, AnalysisSourceEntry>();
let retainedStringBytes = 0;

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
  const sourceFile = entry?.sourceText === sourceText ? entry.sourceFile.deref() : undefined;
  if (sourceFile !== undefined && entry !== undefined) {
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
    const sourceFile = previous.sourceText === sourceText ? previous.sourceFile.deref() : undefined;
    entries.delete(key);
    if (sourceFile !== undefined) {
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
  while (
    entries.size >= MAXIMUM_ENTRIES ||
    retainedStringBytes + stringBytes > MAXIMUM_STRING_BYTES
  ) {
    const oldest = entries.entries().next().value;
    if (oldest === undefined) break;
    const [oldestKey, oldestEntry] = oldest;
    retainedStringBytes -= oldestEntry.stringBytes;
    entries.delete(oldestKey);
  }
  entries.set(key, { sourceText, sourceFile: new WeakRef(sourceFile), stringBytes });
  retainedStringBytes += stringBytes;
  return sourceFile;
}

/** Releases analysis syntax when its compiler shuts down. */
export function clearPreviewAnalysisSourceFileCache(): void {
  entries.clear();
  retainedStringBytes = 0;
}
