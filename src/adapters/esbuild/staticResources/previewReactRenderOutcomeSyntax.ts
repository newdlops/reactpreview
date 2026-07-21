/**
 * Small deterministic syntax utilities shared by React render-outcome traversal.
 * These helpers know nothing about graph semantics and keep parser/identity concerns outside the
 * control-flow analyzer so each module remains below the project's 1,000-line boundary.
 */
import { createHash } from 'node:crypto';
import ts from 'typescript';
import type { PreviewReactRenderSwitchValue } from './previewReactRenderOutcomeTypes';

/** Mirrors conditional-runtime authored-expression metadata so static and live decisions can join. */
const MAX_RENDER_TEXT_LENGTH = 180;

/** Function syntax that can be invoked by React after local HOC resolution. */
export type PreviewRenderFunction =
  ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression;

/** Produces a deterministic compact identity from JSON-safe source evidence. */
export function createPreviewRenderStableId(...parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 20);
}

/** Hashes the complete trimmed source expression so display truncation cannot alias hot edits. */
export function createPreviewRenderExpressionFingerprint(text: string): string {
  return createHash('sha256').update(text.trim()).digest('hex');
}

/** Normalizes source snippets for compact labels without changing condition meaning. */
export function boundedPreviewRenderText(text: string): string {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  return normalized.length <= MAX_RENDER_TEXT_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_RENDER_TEXT_LENGTH - 1)}…`;
}

/** Reads one-based source coordinates for graph navigation. */
export function readPreviewRenderLocation(
  sourceFile: ts.SourceFile,
  node: ts.Node,
): { readonly column: number; readonly line: number } {
  const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { column: location.character + 1, line: location.line + 1 };
}

/** Rejects non-code assets before selecting a TypeScript parser grammar. */
export function isPreviewJavaScriptLikeSource(sourcePath: string): boolean {
  return /\.(?:[cm]?[jt]sx?)$/iu.test(sourcePath);
}

/** Selects JSX grammar for JSX-bearing file extensions and TypeScript otherwise. */
export function selectPreviewRenderScriptKind(sourcePath: string): ts.ScriptKind {
  const lowerPath = sourcePath.toLowerCase();
  if (lowerPath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (lowerPath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (lowerPath.endsWith('.js') || lowerPath.endsWith('.mjs') || lowerPath.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/** Reads parser diagnostics through the SourceFile surface used throughout the esbuild adapter. */
export function hasPreviewRenderParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return (diagnostics?.length ?? 0) > 0;
}

/** Removes transparent TypeScript/JavaScript wrappers around an expression. */
export function unwrapPreviewRenderExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Distinguishes function-valued AST nodes from ordinary expressions. */
export function isPreviewRenderFunction(node: ts.Node): node is PreviewRenderFunction {
  return (
    ts.isArrowFunction(node) || ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
  );
}

/** Recognizes authored values that React intentionally renders as no host output. */
export function isPreviewEmptyRenderExpression(expression: ts.Expression): boolean {
  return (
    expression.kind === ts.SyntaxKind.NullKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isIdentifier(expression) && expression.text === 'undefined') ||
    (ts.isVoidExpression(expression) && expression.expression.kind === ts.SyntaxKind.NumericLiteral)
  );
}

/** Recognizes PascalCase/private-style component identifiers while excluding host tags. */
export function isPreviewComponentName(name: string): boolean {
  return /^[$_\p{Lu}]/u.test(name);
}

/** Reports whether a declaration carries the `export` keyword. */
export function hasPreviewExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
        false)
    : false;
}

/** Reports whether a declaration carries the `default` keyword. */
export function hasPreviewDefaultModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ??
        false)
    : false;
}

/** Reads only primitive switch labels that can be selected without evaluating project code. */
export function readPreviewSwitchLiteral(
  expression: ts.Expression,
):
  | { readonly supported: false }
  | { readonly supported: true; readonly value: PreviewReactRenderSwitchValue } {
  const unwrapped = unwrapPreviewRenderExpression(expression);
  if (ts.isStringLiteralLike(unwrapped)) return { supported: true, value: unwrapped.text };
  if (ts.isNumericLiteral(unwrapped)) return { supported: true, value: Number(unwrapped.text) };
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) return { supported: true, value: true };
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) return { supported: true, value: false };
  if (unwrapped.kind === ts.SyntaxKind.NullKeyword) return { supported: true, value: null };
  if (
    ts.isPrefixUnaryExpression(unwrapped) &&
    (unwrapped.operator === ts.SyntaxKind.MinusToken ||
      unwrapped.operator === ts.SyntaxKind.PlusToken) &&
    ts.isNumericLiteral(unwrapped.operand)
  ) {
    const number = Number(unwrapped.operand.text);
    return {
      supported: true,
      value: unwrapped.operator === ts.SyntaxKind.MinusToken ? -number : number,
    };
  }
  return { supported: false };
}
