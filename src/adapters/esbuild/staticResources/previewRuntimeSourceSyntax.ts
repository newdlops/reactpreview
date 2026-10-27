/**
 * Reuses one private parser tree across adjacent runtime instrumentation stages.
 *
 * Each pipeline owns its scope. Exact path, text, and grammar must all match before reuse;
 * a rewrite replaces the retained entry, so authored offsets and parser recovery stay local
 * to the current input. Trees are never shared with typechecking or other preview requests.
 */
import ts from 'typescript';

/** One synchronous runtime pipeline's latest parent-linked syntax tree. */
export interface PreviewRuntimeSourceSyntax {
  /** Reads exact input syntax without retaining earlier source revisions. */
  readSourceFile(sourcePath: string, sourceText: string, scriptKind: ts.ScriptKind): ts.SourceFile;
}

/** Creates an isolated, single-entry scope; no source or tree survives its owning pipeline. */
export function createPreviewRuntimeSourceSyntax(): PreviewRuntimeSourceSyntax {
  let latest:
    | {
        readonly sourcePath: string;
        readonly sourceText: string;
        readonly scriptKind: ts.ScriptKind;
        readonly sourceFile: ts.SourceFile;
      }
    | undefined;
  return {
    readSourceFile(sourcePath, sourceText, scriptKind) {
      if (
        latest?.sourcePath === sourcePath &&
        latest.sourceText === sourceText &&
        latest.scriptKind === scriptKind
      ) {
        return latest.sourceFile;
      }
      const sourceFile = ts.createSourceFile(
        sourcePath,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        scriptKind,
      );
      latest = { sourceFile, sourcePath, sourceText, scriptKind };
      return sourceFile;
    },
  };
}
