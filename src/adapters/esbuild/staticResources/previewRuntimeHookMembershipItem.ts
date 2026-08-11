/**
 * Recovers one exact item for hook-backed permission/capability membership gates.
 *
 * `includes` is shared by strings and Arrays, so its method name is not collection proof by itself.
 * This helper additionally requires a collection-semantic receiver and a static operand, keeping
 * ordinary text searches untouched while allowing an authored enum member to pass its own gate.
 */
import ts from 'typescript';
import type { PreviewRuntimeLocalHelperItemFallback } from './previewRuntimeHookLocalHelperItem';
import { inferPreviewRuntimeSemanticFallback } from './previewRuntimeHookSemantics';
import { unwrapPreviewRuntimeExpression } from './previewRuntimeHookSyntax';

/** Uses one authored enum member to satisfy an `includes` permission/capability gate. */
export function inferPreviewRuntimeHookMembershipItemFallback(
  propertyAccess: ts.PropertyAccessExpression,
  receiverName: string,
  sourceFile: ts.SourceFile,
  collectionReceiverProven = false,
): PreviewRuntimeLocalHelperItemFallback | undefined {
  if (
    propertyAccess.name.text !== 'includes' ||
    propertyAccess.questionDotToken !== undefined ||
    (!collectionReceiverProven &&
      inferPreviewRuntimeSemanticFallback(receiverName)?.kind !== 'array')
  ) {
    return undefined;
  }
  const call = propertyAccess.parent;
  if (
    !ts.isCallExpression(call) ||
    call.expression !== propertyAccess ||
    call.questionDotToken !== undefined ||
    call.arguments.length !== 1
  ) {
    return undefined;
  }
  const itemArgument = call.arguments[0];
  if (itemArgument === undefined) return undefined;
  const item = unwrapPreviewRuntimeExpression(itemArgument);
  if (!isPreviewRuntimeStaticMembershipItem(item)) return undefined;
  return {
    expression: item.getText(sourceFile),
    label: 'authored collection membership item',
    requiredPaths: ['<root>'],
  };
}

/** Admits literals and qualified enum/constant members while rejecting calls and computed reads. */
function isPreviewRuntimeStaticMembershipItem(expression: ts.Expression): boolean {
  if (
    ts.isStringLiteralLike(expression) ||
    ts.isNumericLiteral(expression) ||
    ts.isBigIntLiteral(expression) ||
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    expression.kind === ts.SyntaxKind.NullKeyword
  ) {
    return true;
  }
  if (
    ts.isPrefixUnaryExpression(expression) &&
    (expression.operator === ts.SyntaxKind.PlusToken ||
      expression.operator === ts.SyntaxKind.MinusToken)
  ) {
    return ts.isNumericLiteral(unwrapPreviewRuntimeExpression(expression.operand));
  }
  let current = expression;
  while (ts.isPropertyAccessExpression(current) && current.questionDotToken === undefined) {
    current = unwrapPreviewRuntimeExpression(current.expression);
  }
  return ts.isIdentifier(current) && /^[A-Z_$]/u.test(current.text);
}
