/**
 * Isolates Next App Router metadata initialization from the browser-only preview module graph.
 *
 * Next evaluates an App Router layout's exported `metadata` object on the server. Its initializer
 * may consequently read deployment-only environment variables, construct absolute server URLs,
 * or call other Node-oriented helpers before the layout component itself can mount. React Preview
 * does not need that value to render the authored `RootLayout`, so this analyzer retains the exact
 * export identity while replacing only its initializer with an inert scalar. A static `next` import
 * is required in addition to the filesystem convention so an unrelated `src/app/layout.tsx` stays
 * untouched in a framework-neutral project. A nearest-manifest Next dependency may provide the
 * same evidence for JavaScript layouts that do not import a Next runtime symbol themselves.
 */
import ts from 'typescript';
import type { PreviewSourceReplacement } from './previewSourceReplacement';

const NEXT_LAYOUT_FILE_NAMES = new Set([
  'layout.js',
  'layout.jsx',
  'layout.mjs',
  'layout.mts',
  'layout.ts',
  'layout.tsx',
]);

/**
 * Creates a source edit for a direct Next App Router `metadata` export.
 *
 * The path convention and declaration shape are both required. Alias exports such as
 * `export { value as metadata }`, non-const declarations, nested declarations, and similarly named
 * bindings remain authored because none proves Next's server-owned metadata convention. A
 * declaration list may contain siblings; replacing only the exact initializer keeps every sibling
 * binding and the layout's default React export intact.
 *
 * @param sourcePath Absolute or normalized module path supplied by the workspace source loader.
 * @param sourceText Original TypeScript or JavaScript source used for exact replacement offsets.
 * @param projectUsesNextRuntime Compiler-proven nearest-project dependency or resolution evidence.
 * @returns Zero or one initializer replacement; malformed source fails closed without an edit.
 */
export function createNextAppMetadataReplacements(
  sourcePath: string,
  sourceText: string,
  projectUsesNextRuntime = false,
): readonly PreviewSourceReplacement[] {
  if (!isNextAppLayoutPath(sourcePath) || !sourceText.includes('metadata')) return [];
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    selectScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) return [];
  if (!projectUsesNextRuntime && !hasStaticNextImport(sourceFile)) return [];

  for (const statement of sourceFile.statements) {
    if (!isExportedConstStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === 'metadata' &&
        declaration.initializer !== undefined
      ) {
        return [
          {
            end: declaration.initializer.getEnd(),
            replacement: createInertInitializer(declaration.initializer, sourceFile, sourceText),
            start: declaration.initializer.getStart(sourceFile),
          },
        ];
      }
    }
  }
  return [];
}

/** Proves that the convention file participates in Next rather than a similarly named app tree. */
function hasStaticNextImport(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      (statement.moduleSpecifier.text === 'next' ||
        statement.moduleSpecifier.text.startsWith('next/')),
  );
}

/**
 * Produces a non-evaluating scalar with exactly the initializer's original length and line breaks.
 * Type annotations are erased by esbuild and the server-only export is never consumed at runtime,
 * so `0` is sufficient. Masking every remaining non-newline character keeps later JSX offsets,
 * inspector reveal locations, and occurrence identities aligned with the authored source.
 */
function createInertInitializer(
  initializer: ts.Expression,
  sourceFile: ts.SourceFile,
  sourceText: string,
): string {
  const original = sourceText.slice(initializer.getStart(sourceFile), initializer.getEnd());
  return `0${original.slice(1).replace(/[^\r\n]/g, ' ')}`;
}

/** Proves a lowercase `layout.*` below an `app` directory without host path assumptions. */
function isNextAppLayoutPath(sourcePath: string): boolean {
  const segments = sourcePath.replace(/\\/gu, '/').split('/');
  const fileName = segments.at(-1);
  if (fileName === undefined || !NEXT_LAYOUT_FILE_NAMES.has(fileName)) return false;
  const appDirectoryIndex = segments.lastIndexOf('app');
  return appDirectoryIndex >= 0 && appDirectoryIndex < segments.length - 1;
}

/** Accepts only a top-level `export const` variable statement. */
function isExportedConstStatement(statement: ts.Statement): statement is ts.VariableStatement {
  return (
    ts.isVariableStatement(statement) &&
    (statement.declarationList.flags & ts.NodeFlags.Const) !== 0 &&
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}

/** Selects the TypeScript parser grammar that matches the authored layout extension. */
function selectScriptKind(sourcePath: string): ts.ScriptKind {
  const fileName = sourcePath.replace(/\\/gu, '/').split('/').at(-1) ?? '';
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (fileName.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (fileName.endsWith('.js') || fileName.endsWith('.mjs')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Rejects parser-recovered input before using AST offsets to modify executable source. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return (diagnostics?.length ?? 0) > 0;
}
