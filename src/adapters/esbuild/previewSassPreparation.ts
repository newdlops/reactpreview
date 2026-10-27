/** Finds one explicit inert Sass import for early compiler initialization, without reading styles. */
import path from 'node:path';
import ts from 'typescript';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import { readPreviewAnalysisSourceFile } from './previewAnalysisSourceFile';
import type { PreviewApplicationStylesheetImportSelection } from './previewApplicationStylesheetSelection';
import type { PreviewGlobalStyleImportSelection } from './previewGlobalStyleSelection';

const MAXIMUM_STYLE_MODULES = 8;
const MAXIMUM_SOURCE_BYTES = 128 * 1024;

/** Proven style owners and a snapshot-aware, bounded inert source reader. */
export interface PreviewSassPreparationInput {
  /** Explicit side effects already selected from the application's admitted entry. */
  readonly applicationImports: readonly PreviewApplicationStylesheetImportSelection[];
  /** Proven global style owners already imported by the preview entry. */
  readonly globalImports: readonly PreviewGlobalStyleImportSelection[];
  /** Current editor-aware source reader; its byte limit never applies to stylesheet contents. */
  readonly readSource: (sourcePath: string, maximumBytes: number) => Promise<string | undefined>;
}

/** Selects at most one relative, explicit Sass side effect; other imports keep normal lazy loading. */
export async function selectPreviewSassPreparationPath(
  input: PreviewSassPreparationInput,
): Promise<string | undefined> {
  for (const selection of input.applicationImports.slice(0, MAXIMUM_STYLE_MODULES)) {
    const selected = resolveExplicitSassPath(selection.moduleSpecifier, selection.importerPath);
    if (selected !== undefined) return selected;
  }
  for (const selection of input.globalImports.slice(0, MAXIMUM_STYLE_MODULES)) {
    const text = await input
      .readSource(selection.moduleSpecifier, MAXIMUM_SOURCE_BYTES)
      .catch(() => undefined);
    if (text === undefined || Buffer.byteLength(text) > MAXIMUM_SOURCE_BYTES) continue;
    const source = readPreviewAnalysisSourceFile(
      selection.moduleSpecifier,
      text,
      ts.ScriptKind.TSX,
    );
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        statement.importClause !== undefined ||
        !ts.isStringLiteralLike(statement.moduleSpecifier)
      )
        continue;
      const selected = resolveExplicitSassPath(
        statement.moduleSpecifier.text,
        selection.moduleSpecifier,
      );
      if (selected !== undefined) return selected;
    }
  }
  return undefined;
}

/** Resolves exact relative styles without probing packages, loading configuration, or reading CSS. */
function resolveExplicitSassPath(specifier: string, importer: string): string | undefined {
  return /^\.\.?[/\\]/u.test(specifier) && /\.s[ac]ss$/iu.test(specifier)
    ? canonicalizeExistingPath(path.resolve(path.dirname(importer), specifier))
    : undefined;
}
