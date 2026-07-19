/**
 * Reads side-effect-free GraphQL arguments for render-only hook instrumentation.
 *
 * The runtime needs the authored DocumentNode to infer selected response fields and may use the query
 * options to keep generated entity identifiers equal to route/request variables. Only identifier and
 * ordinary property-reference expressions are admitted; calls, optional access, element access,
 * spreads, and newly evaluated object literals remain outside this bridge.
 */
import ts from 'typescript';

/** Lazily readable source expressions accepted by the GraphQL fallback resolver. */
export interface PreviewRuntimeHookGraphqlArguments {
  /** Authored GraphQL document reference passed as the first hook argument. */
  readonly documentExpression: string;
  /** Optional stable options reference whose own `variables` data can align response identities. */
  readonly optionsExpression?: string;
}

/** Returns safe query argument expressions, or undefined for non-query and dynamic callsites. */
export function readPreviewRuntimeHookGraphqlArguments(
  hookName: string,
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  sourceText: string,
): PreviewRuntimeHookGraphqlArguments | undefined {
  if (hookName !== 'useQuery' && hookName !== 'useSuspenseQuery') return undefined;
  const document = call.arguments[0];
  if (document === undefined || !isSideEffectFreeReference(document)) return undefined;
  const options = call.arguments[1];
  return {
    documentExpression: sourceText.slice(document.getStart(sourceFile), document.end),
    ...(options !== undefined && isSideEffectFreeReference(options)
      ? { optionsExpression: sourceText.slice(options.getStart(sourceFile), options.end) }
      : {}),
  };
}

/** Accepts only a non-optional identifier/property chain after removing syntax-only wrappers. */
function isSideEffectFreeReference(expression: ts.Expression): boolean {
  let current = unwrapExpression(expression);
  while (ts.isPropertyAccessExpression(current) && current.questionDotToken === undefined) {
    current = unwrapExpression(current.expression);
  }
  return ts.isIdentifier(current);
}

/** Removes compile-time wrappers without evaluating or simplifying the authored expression. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
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
