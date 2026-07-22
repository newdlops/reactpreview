/**
 * Rewrites Next App Router document singleton JSX into ordinary preview host elements.
 *
 * A Next root layout is authored for a document renderer and conventionally returns `html`,
 * `head`, and `body`. React DOM treats those tags as process-wide singleton nodes. Mounting the
 * same JSX below VS Code's preview `<div>` can therefore attach project Fibers to the webview's
 * real document element. A later scroll event then crosses two React containers and may spend the
 * renderer thread walking hydration siblings indefinitely. The preview already applies statically
 * discovered document attributes to its shell, so ordinary block hosts preserve the visible layout
 * without claiming global DOM ownership.
 */
import ts from 'typescript';
import type { PreviewSourceReplacement } from './previewSourceReplacement';

const NEXT_LAYOUT_FILE_PATTERN = /(?:^|\/)app(?:\/.*)?\/layout\.(?:[cm]?[jt]sx?)$/iu;
const NEXT_DOCUMENT_TAGS = new Set(['body', 'head', 'html']);

/**
 * Returns length-preserving JSX tag edits for a compiler-proven Next App Router layout.
 *
 * Only intrinsic identifier tags are admitted. Member expressions, variables named `Html`, dirty
 * parser recovery, non-layout files, and projects without Next evidence remain untouched. Padding
 * `div` to four characters keeps every following source offset and line/column decoration aligned;
 * JSX accepts whitespace between a tag name and its closing delimiter.
 */
export function createNextAppDocumentElementReplacements(
  sourcePath: string,
  sourceText: string,
  projectUsesNextRuntime = false,
): readonly PreviewSourceReplacement[] {
  const normalizedPath = sourcePath.replace(/\\/gu, '/');
  if (
    !NEXT_LAYOUT_FILE_PATTERN.test(normalizedPath) ||
    !/(?:<\/?)(?:body|head|html)\b/iu.test(sourceText)
  ) {
    return [];
  }
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    selectScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) return [];
  if (!projectUsesNextRuntime && !hasStaticNextImport(sourceFile)) return [];

  const replacements: PreviewSourceReplacement[] = [];
  const visit = (node: ts.Node): void => {
    const tagName = readJsxTagName(node);
    if (tagName !== undefined && NEXT_DOCUMENT_TAGS.has(tagName.text)) {
      replacements.push({
        end: tagName.end,
        replacement: 'div'.padEnd(tagName.end - tagName.getStart(sourceFile), ' '),
        start: tagName.getStart(sourceFile),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return replacements;
}

/** Accepts the same direct Next package evidence used by metadata isolation. */
function hasStaticNextImport(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      (statement.moduleSpecifier.text === 'next' ||
        statement.moduleSpecifier.text.startsWith('next/')),
  );
}

/** Reads only intrinsic identifier tag names from opening, closing, and self-closing JSX nodes. */
function readJsxTagName(node: ts.Node): ts.Identifier | undefined {
  if (
    (ts.isJsxOpeningElement(node) ||
      ts.isJsxClosingElement(node) ||
      ts.isJsxSelfClosingElement(node)) &&
    ts.isIdentifier(node.tagName)
  ) {
    return node.tagName;
  }
  return undefined;
}

/** Selects JSX-capable parsing only for source extensions accepted by the workspace loader. */
function selectScriptKind(sourcePath: string): ts.ScriptKind {
  const normalizedPath = sourcePath.toLocaleLowerCase();
  if (normalizedPath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (normalizedPath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (normalizedPath.endsWith('.js') || normalizedPath.endsWith('.mjs')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Declines incomplete editor snapshots before trusting TypeScript source offsets. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return (diagnostics?.length ?? 0) > 0;
}
