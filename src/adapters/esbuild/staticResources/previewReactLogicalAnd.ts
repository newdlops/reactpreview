/**
 * Provides bounded, syntax-only normalization for React logical-AND render expressions.
 *
 * JavaScript parses `a && b && value` as a left-associated tree, while authors can explicitly write
 * the equivalent right-associated form `a && (b && value)`. Consumers should see the same ordered
 * guard list for both spellings. This module only normalizes syntax: it never decides whether the
 * terminal value is renderable and never evaluates a project expression.
 */
import ts from 'typescript';

/** Maximum leaves retained separately before a remaining subtree is kept as one compound leaf. */
const MAX_PREVIEW_REACT_LOGICAL_AND_OPERANDS = 129;

/** Ordered logical-AND operands split into controlling guards and the final result expression. */
export interface PreviewReactLogicalAndExpansion {
  /** Expressions that must be truthy, in JavaScript evaluation order, to reach `terminal`. */
  readonly guards: readonly ts.Expression[];
  /** Final value returned after every preceding guard is truthy. */
  readonly terminal: ts.Expression;
  /** Whether a pathological chain retained at least one bounded compound AND operand. */
  readonly truncated: boolean;
}

/** Removes wrappers that do not alter logical-AND evaluation or source expression identity. */
function unwrapPreviewReactLogicalAndExpression(expression: ts.Expression): ts.Expression {
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

/** Reports whether one unwrapped expression is a JavaScript logical-AND node. */
function isPreviewReactLogicalAndExpression(
  expression: ts.Expression,
): expression is ts.BinaryExpression {
  return (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  );
}

/**
 * Flattens either association of a logical-AND tree without changing operand order.
 *
 * The iterative stack avoids call-stack growth on generated sources. When the public operand budget
 * would be exceeded, the current AND subtree is retained as one compound operand and `truncated` is
 * reported. Retaining the subtree, instead of dropping its leaves, preserves authored semantics for
 * callers that choose to instrument or analyze the bounded result.
 *
 * @param expression Candidate expression, including optional parentheses and TypeScript wrappers.
 * @returns Ordered guards and terminal, or `undefined` when the root is not logical AND.
 */
export function expandPreviewReactLogicalAndExpression(
  expression: ts.Expression,
): PreviewReactLogicalAndExpansion | undefined {
  const root = unwrapPreviewReactLogicalAndExpression(expression);
  if (!isPreviewReactLogicalAndExpression(root)) return undefined;

  const operands: ts.Expression[] = [];
  const pending: ts.Expression[] = [root];
  let truncated = false;
  while (pending.length > 0) {
    const pendingExpression = pending.pop();
    if (pendingExpression === undefined) continue;
    const current = unwrapPreviewReactLogicalAndExpression(pendingExpression);
    if (
      isPreviewReactLogicalAndExpression(current) &&
      operands.length + pending.length + 2 <= MAX_PREVIEW_REACT_LOGICAL_AND_OPERANDS
    ) {
      /* Push right first so the LIFO stack visits left-to-right, matching JavaScript evaluation. */
      pending.push(current.right, current.left);
      continue;
    }
    if (isPreviewReactLogicalAndExpression(current)) truncated = true;
    operands.push(current);
  }

  const terminal = operands.at(-1);
  return terminal === undefined
    ? undefined
    : {
        guards: Object.freeze(operands.slice(0, -1)),
        terminal,
        truncated,
      };
}
