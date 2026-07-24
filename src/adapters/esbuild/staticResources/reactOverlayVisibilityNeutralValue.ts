/**
 * Infers a dormant scalar for a prop path used directly by an overlay visibility expression.
 *
 * The value is not an overlay-name guess: the owning JSX attribute has already been proven by the
 * shared overlay contract. Only literal equality expressions are interpreted, so the result stays
 * deterministic, serializable, and independent of application execution.
 */
import ts from 'typescript';
import { isReactOverlayVisibilityJsxAttribute } from './reactOverlayVisibilityInference';

/** Scalar shape that can be serialized into a parent hook's generated fallback object. */
export interface ReactOverlayVisibilityNeutralValue {
  readonly kind: 'boolean' | 'null' | 'number' | 'string';
  readonly value?: boolean | number | string;
}

/**
 * Returns a value that makes the containing overlay visibility expression false.
 *
 * Bare fields such as `show={state.open}` become `false`. Equality and inequality literals use the
 * corresponding opposite/same value, including the important `target !== null` → `target: null`
 * case. More complex calls and project enum expressions remain authored rather than guessed.
 */
export function inferReactOverlayVisibilityNeutralValue(
  expression: ts.Expression,
): ReactOverlayVisibilityNeutralValue | undefined {
  const carrier = readOutermostTransparentExpression(expression);
  const parent = carrier.parent;
  if (isDirectOverlayVisibilityExpression(carrier, parent)) {
    return Object.freeze({ kind: 'boolean', value: false });
  }
  if (!ts.isBinaryExpression(parent) || !isEqualityOperator(parent.operatorToken.kind)) {
    return undefined;
  }
  if (readOverlayVisibilityAttribute(parent) === undefined) return undefined;
  const compared =
    unwrapExpression(parent.left) === expression
      ? unwrapExpression(parent.right)
      : unwrapExpression(parent.right) === expression
        ? unwrapExpression(parent.left)
        : undefined;
  if (compared === undefined) return undefined;
  const inequality =
    parent.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    parent.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken;
  if (compared.kind === ts.SyntaxKind.NullKeyword) {
    return inequality
      ? Object.freeze({ kind: 'null' })
      : Object.freeze({ kind: 'boolean', value: false });
  }
  if (compared.kind === ts.SyntaxKind.TrueKeyword || compared.kind === ts.SyntaxKind.FalseKeyword) {
    const comparedValue = compared.kind === ts.SyntaxKind.TrueKeyword;
    return Object.freeze({
      kind: 'boolean',
      value: inequality ? comparedValue : !comparedValue,
    });
  }
  if (ts.isStringLiteralLike(compared)) {
    return Object.freeze({
      kind: 'string',
      value: inequality ? compared.text : compared.text.length === 0 ? '-preview' : '',
    });
  }
  if (ts.isNumericLiteral(compared)) {
    const comparedValue = Number(compared.text);
    return Object.freeze({
      kind: 'number',
      value: inequality ? comparedValue : comparedValue === 0 ? 1 : 0,
    });
  }
  return undefined;
}

/** Climbs syntax-only wrappers so parenthesized/asserted visibility expressions remain visible. */
function readOutermostTransparentExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current.parent) ||
    ts.isAsExpression(current.parent) ||
    ts.isSatisfiesExpression(current.parent) ||
    ts.isNonNullExpression(current.parent)
  ) {
    current = current.parent;
  }
  return current;
}

/** Recognizes a path used as the complete expression of a proven overlay visibility attribute. */
function isDirectOverlayVisibilityExpression(expression: ts.Expression, parent: ts.Node): boolean {
  return (
    ts.isJsxExpression(parent) &&
    parent.expression === expression &&
    ts.isJsxAttribute(parent.parent) &&
    isReactOverlayVisibilityJsxAttribute(parent.parent)
  );
}

/** Returns the proven overlay visibility attribute containing one comparison. */
function readOverlayVisibilityAttribute(expression: ts.Expression): ts.JsxAttribute | undefined {
  let current: ts.Node = expression;
  while (
    ts.isParenthesizedExpression(current.parent) ||
    ts.isAsExpression(current.parent) ||
    ts.isSatisfiesExpression(current.parent) ||
    ts.isNonNullExpression(current.parent)
  ) {
    current = current.parent;
  }
  const container = current.parent;
  return ts.isJsxExpression(container) &&
    container.expression === current &&
    ts.isJsxAttribute(container.parent) &&
    isReactOverlayVisibilityJsxAttribute(container.parent)
    ? container.parent
    : undefined;
}

/** Restricts neutralization to equality operators with an unambiguous false counterpart. */
function isEqualityOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    kind === ts.SyntaxKind.EqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsToken
  );
}

/** Removes syntax-only wrappers while preserving the compared runtime expression. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}
