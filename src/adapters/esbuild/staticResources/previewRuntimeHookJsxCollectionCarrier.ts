/** Recognizes hook collections forwarded into JSX through statically safe Array alternatives. */
import ts from 'typescript';
import { unwrapPreviewRuntimeExpression } from './previewRuntimeHookSyntax';

const MAX_COLLECTION_CARRIER_DEPTH = 4;

/**
 * Proves that one JSX value carries an exact hook binding or a literal Array instead.
 *
 * Query-backed UI commonly forwards `data && settled ? data : []`, `data ?? []`, or `data || []`.
 * The direct identifier remains the only project value admitted; every alternative must be an
 * Array literal, which establishes container kind without evaluating the condition or project code.
 */
export function isPreviewRuntimeHookJsxCollectionCarrier(
  expression: ts.Expression,
  identifierName: string,
  depth = 0,
): boolean {
  if (depth > MAX_COLLECTION_CARRIER_DEPTH) return false;
  const value = unwrapPreviewRuntimeExpression(expression);
  if (ts.isIdentifier(value)) return value.text === identifierName;
  if (ts.isConditionalExpression(value)) {
    return (
      (isPreviewRuntimeHookJsxCollectionCarrier(value.whenTrue, identifierName, depth + 1) &&
        ts.isArrayLiteralExpression(unwrapPreviewRuntimeExpression(value.whenFalse))) ||
      (isPreviewRuntimeHookJsxCollectionCarrier(value.whenFalse, identifierName, depth + 1) &&
        ts.isArrayLiteralExpression(unwrapPreviewRuntimeExpression(value.whenTrue)))
    );
  }
  return (
    ts.isBinaryExpression(value) &&
    (value.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) &&
    isPreviewRuntimeHookJsxCollectionCarrier(value.left, identifierName, depth + 1) &&
    ts.isArrayLiteralExpression(unwrapPreviewRuntimeExpression(value.right))
  );
}
