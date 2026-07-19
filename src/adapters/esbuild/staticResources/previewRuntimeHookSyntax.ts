/**
 * Provides syntax-only helpers shared by render-critical hook instrumentation.
 *
 * This module owns generic TypeScript AST traversal and wrapper unwrapping. It deliberately knows
 * nothing about fallback values, Page Inspector state, or generated browser code, keeping the hook
 * policy module focused on inference rather than parser mechanics.
 */
import path from 'node:path';
import ts from 'typescript';

/** Function-like scope in which a React hook can execute during render. */
export type PreviewRuntimeFunction =
  ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression | ts.MethodDeclaration;

/** Finds the nearest render-time function while excluding module-level hook initialization. */
export function findNearestPreviewRuntimeFunction(
  node: ts.Node,
): PreviewRuntimeFunction | undefined {
  let current = node.parent;
  while (!ts.isSourceFile(current)) {
    if (isPreviewRuntimeFunction(current)) return current;
    current = current.parent;
  }
  return undefined;
}

/** Reads the authored component/function name that owns one runtime hook invocation. */
export function readPreviewRuntimeFunctionName(
  scope: PreviewRuntimeFunction | undefined,
): string | undefined {
  if (scope === undefined) return undefined;
  if (
    (ts.isFunctionDeclaration(scope) || ts.isFunctionExpression(scope)) &&
    scope.name !== undefined
  ) {
    return scope.name.text;
  }
  if (ts.isMethodDeclaration(scope)) {
    return ts.isIdentifier(scope.name) || ts.isStringLiteral(scope.name)
      ? scope.name.text
      : undefined;
  }
  const parent = scope.parent;
  if (
    ts.isVariableDeclaration(parent) &&
    parent.initializer === scope &&
    ts.isIdentifier(parent.name)
  ) {
    return parent.name.text;
  }
  if (ts.isPropertyAssignment(parent) && parent.initializer === scope) {
    return ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name)
      ? parent.name.text
      : undefined;
  }
  return undefined;
}

/** Narrows TypeScript function-like nodes to hook-capable runtime scopes. */
export function isPreviewRuntimeFunction(node: ts.Node): node is PreviewRuntimeFunction {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node)
  );
}

/** Walks through syntax-only wrappers while retaining the original runtime expression. */
export function unwrapPreviewRuntimeExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Walks from an expression through parent syntax-only wrappers for binding analysis. */
export function unwrapPreviewRuntimeParentExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    (ts.isParenthesizedExpression(current.parent) ||
      ts.isAsExpression(current.parent) ||
      ts.isSatisfiesExpression(current.parent) ||
      ts.isNonNullExpression(current.parent) ||
      ts.isTypeAssertionExpression(current.parent)) &&
    current.parent.expression === current
  ) {
    current = current.parent;
  }
  return current;
}

/** Reads an identifier/property callee name without evaluating computed expressions. */
export function readPreviewRuntimeCalleePropertyName(
  expression: ts.LeftHandSideExpression,
): string | undefined {
  const unwrapped = unwrapPreviewRuntimeExpression(expression);
  if (ts.isIdentifier(unwrapped)) return unwrapped.text;
  return ts.isPropertyAccessExpression(unwrapped) ? unwrapped.name.text : undefined;
}

/** Selects JSX-capable TypeScript parser grammar from the source extension. */
export function selectPreviewRuntimeScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.ts' || extension === '.mts' || extension === '.cts') return ts.ScriptKind.TS;
  return ts.ScriptKind.JSX;
}

/** Restricts instrumentation to source formats already handled by the preview compiler. */
export function isPreviewRuntimeJavaScriptLikeSource(sourcePath: string): boolean {
  return /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/iu.test(sourcePath);
}

/** Rejects parser recovery so generated offsets never target ambiguous or incomplete syntax. */
export function hasPreviewRuntimeParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return diagnostics !== undefined && diagnostics.length > 0;
}
