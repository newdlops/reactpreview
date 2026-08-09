/**
 * Selects conventional application-level stylesheet imports for standalone component previews.
 * Only inert root source text is parsed; application layouts and Pages wrappers are never loaded
 * or evaluated merely to recover the global CSS they declare.
 */
import path from 'node:path';
import ts from 'typescript';
import type { ReadPreviewProjectSourceOptions } from './previewProjectFileAnalysisCache';

const MAXIMUM_APPLICATION_ROOT_BYTES = 1024 * 1024;
const MAXIMUM_APPLICATION_STYLESHEET_IMPORTS = 8;
const APPLICATION_STYLE_EXTENSIONS = new Set(['.css', '.sass', '.scss']);
const APPLICATION_ROOT_EXTENSIONS = ['tsx', 'jsx', 'ts', 'js'] as const;

/** One side-effect stylesheet import resolved later from the source file that authored it. */
export interface PreviewApplicationStylesheetImportSelection {
  /** Absolute conventional application root containing the import declaration. */
  readonly importerPath: string;
  /** Exact static module request retained for project-aware esbuild resolution. */
  readonly moduleSpecifier: string;
}

/** Inputs for bounded Next application-root stylesheet selection. */
export interface SelectPreviewApplicationStylesheetImportsOptions {
  /** Nearest package boundary containing the selected preview target. */
  readonly projectRoot: string;
  /** Cached byte-bounded source reader shared with the rest of preview preparation. */
  readonly readSource: (options: ReadPreviewProjectSourceOptions) => Promise<string | undefined>;
}

/** Existing conventional application root plus its current inert source text. */
interface PreviewConventionalApplicationRoot {
  readonly sourcePath: string;
  readonly sourceText: string;
}

/**
 * Recovers global CSS imported directly by the active Next application boundary.
 * App Router takes precedence over Pages Router just as a root `app` directory does for the
 * standalone design-system examples this fallback serves. Within each convention, root-level
 * directories precede their `src` equivalents and only the first existing entry is considered.
 */
export async function selectPreviewApplicationStylesheetImports(
  options: SelectPreviewApplicationStylesheetImportsOptions,
): Promise<readonly PreviewApplicationStylesheetImportSelection[]> {
  const root = await selectConventionalApplicationRoot(options);
  if (root === undefined) return Object.freeze([]);
  const sourceFile = createApplicationRootSourceFile(root.sourcePath, root.sourceText);
  if (hasParseDiagnostics(sourceFile)) return Object.freeze([]);

  const selections: PreviewApplicationStylesheetImportSelection[] = [];
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      statement.importClause !== undefined ||
      !ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      continue;
    }
    const moduleSpecifier = statement.moduleSpecifier.text;
    if (!isPreviewApplicationStylesheetPath(moduleSpecifier)) continue;
    selections.push(Object.freeze({ importerPath: root.sourcePath, moduleSpecifier }));
    if (selections.length >= MAXIMUM_APPLICATION_STYLESHEET_IMPORTS) break;
  }
  return Object.freeze(selections);
}

/** Reports whether one query-free request or resolved path uses a supported style extension. */
export function isPreviewApplicationStylesheetPath(candidate: string): boolean {
  return (
    candidate.length > 0 &&
    candidate.length <= 8_192 &&
    !/[\0?#]/u.test(candidate) &&
    APPLICATION_STYLE_EXTENSIONS.has(path.extname(candidate).toLowerCase())
  );
}

/** Chooses one existing Next root without scanning directories or crossing the project boundary. */
async function selectConventionalApplicationRoot(
  options: SelectPreviewApplicationStylesheetImportsOptions,
): Promise<PreviewConventionalApplicationRoot | undefined> {
  for (const stem of [
    path.join('app', 'layout'),
    path.join('src', 'app', 'layout'),
    path.join('pages', '_app'),
    path.join('src', 'pages', '_app'),
  ]) {
    for (const extension of APPLICATION_ROOT_EXTENSIONS) {
      const sourcePath = path.join(options.projectRoot, `${stem}.${extension}`);
      const sourceText = await options.readSource({
        maximumBytes: MAXIMUM_APPLICATION_ROOT_BYTES,
        sourcePath,
      });
      if (sourceText !== undefined) return { sourcePath, sourceText };
    }
  }
  return undefined;
}

/** Parses the root using the exact JavaScript/TypeScript JSX grammar selected by its extension. */
function createApplicationRootSourceFile(sourcePath: string, sourceText: string): ts.SourceFile {
  const extension = path.extname(sourcePath).toLowerCase();
  const scriptKind =
    extension === '.tsx'
      ? ts.ScriptKind.TSX
      : extension === '.jsx'
        ? ts.ScriptKind.JSX
        : extension === '.js'
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS;
  return ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
}

/** Rejects parser recovery so a partially edited layout cannot emit incomplete style imports. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  return (
    ((sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics?.length ?? 0) > 0
  );
}
