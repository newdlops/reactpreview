/** Collects bounded scalar-comparison demands from one local Boolean condition. */
import ts from 'typescript';
import { unwrapPreviewRuntimeExpression } from './previewRuntimeHookSyntax';

const MAX_CONDITION_COMPARISONS = 16;

/** One equality expression and the Boolean result required from that exact atom. */
export interface PreviewRuntimeHookConditionComparison {
  readonly desiredValue: boolean;
  readonly expression: ts.BinaryExpression;
}

/**
 * Reads comparisons that can be assigned without changing unrelated Boolean operands.
 *
 * Positive AND/OR trees are made false at every comparison. A direct negated comparison is
 * inverted explicitly. More complex negated trees remain unsupported because satisfying one side
 * may invalidate another comparison rooted in the same hook field.
 */
export function collectPreviewRuntimeHookConditionComparisons(
  expression: ts.Expression,
  renderGuard: boolean,
): readonly PreviewRuntimeHookConditionComparison[] {
  const comparisons: PreviewRuntimeHookConditionComparison[] = [];
  const visit = (candidate: ts.Expression, desiredValue: boolean): void => {
    if (comparisons.length >= MAX_CONDITION_COMPARISONS) return;
    const current = unwrapPreviewRuntimeExpression(candidate);
    if (
      renderGuard &&
      !desiredValue &&
      ts.isBinaryExpression(current) &&
      (current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        current.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      visit(current.left, false);
      visit(current.right, false);
      return;
    }
    if (
      renderGuard &&
      ts.isPrefixUnaryExpression(current) &&
      current.operator === ts.SyntaxKind.ExclamationToken
    ) {
      const operand = unwrapPreviewRuntimeExpression(current.operand);
      if (ts.isBinaryExpression(operand) && isEqualityOperator(operand.operatorToken.kind)) {
        comparisons.push(Object.freeze({ desiredValue: true, expression: operand }));
      }
      return;
    }
    if (ts.isBinaryExpression(current) && isEqualityOperator(current.operatorToken.kind)) {
      comparisons.push(Object.freeze({ desiredValue, expression: current }));
    }
  };
  visit(expression, false);
  return Object.freeze(comparisons);
}

/** Matches JavaScript equality and inequality operators without admitting relational coercion. */
function isEqualityOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    kind === ts.SyntaxKind.EqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsToken
  );
}
