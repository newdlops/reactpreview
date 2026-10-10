/**
 * Recognizes an early return that keeps a component from reading elements of an empty collection.
 *
 * `if (points.length === 0) return <Empty />` followed by `points[0].date` is the collection form of
 * a null-safety guard: forcing the continuation cannot create rows, it only moves the failure to the
 * first element dereference. Such a guard must settle through authored data (requirement search or
 * REST rows), never through an automatic Boolean continuation. A body that only maps or filters the
 * collection stays selectable, because an empty list renders safely.
 */
import ts from 'typescript';

const MAXIMUM_VISITED_NODES = 2_048;

/** Reports whether the returned side of `statement` protects a later element dereference. */
export function isPreviewReactEmptyCollectionSafetyGuard(
  statement: ts.IfStatement,
  returnedBranch: 'falsy' | 'truthy',
): boolean {
  const collection = readGuardedCollection(statement.expression, returnedBranch);
  if (collection === undefined || !ts.isBlock(statement.parent)) return false;
  const statementIndex = statement.parent.statements.indexOf(statement);
  if (statementIndex < 0) return false;
  const budget = { remaining: MAXIMUM_VISITED_NODES };
  return statement.parent.statements
    .slice(statementIndex + 1)
    .some((continuation) => hasElementDereference(continuation, collection, budget));
}

/** Searches one subtree (within a shared node budget) for a dereferenced element of collection. */
function hasElementDereference(
  node: ts.Node,
  collection: string,
  budget: { remaining: number },
): boolean {
  if (budget.remaining <= 0) return false;
  budget.remaining -= 1;
  if (readElementSource(node, collection) !== undefined && isDereferenced(node)) return true;
  return (
    ts.forEachChild(node, (child) =>
      hasElementDereference(child, collection, budget) ? true : undefined,
    ) === true
  );
}

/** Reads `X` from a guard whose returned side is selected exactly when `X.length` is zero. */
function readGuardedCollection(
  expression: ts.Expression,
  returnedBranch: 'falsy' | 'truthy',
): string | undefined {
  const current = unwrap(expression);
  let emptyWhenTrue: boolean | undefined;
  let lengthExpression: ts.Expression | undefined;
  if (ts.isPrefixUnaryExpression(current) && current.operator === ts.SyntaxKind.ExclamationToken) {
    lengthExpression = current.operand;
    emptyWhenTrue = true;
  } else if (ts.isBinaryExpression(current)) {
    const leftNumber = readNumber(current.left);
    const rightNumber = readNumber(current.right);
    if ((leftNumber === undefined) === (rightNumber === undefined)) return undefined;
    lengthExpression = leftNumber === undefined ? current.left : current.right;
    emptyWhenTrue = readEmptyWhenTrue(
      current.operatorToken.kind,
      leftNumber ?? rightNumber ?? Number.NaN,
      leftNumber === undefined,
    );
  } else {
    lengthExpression = current;
    emptyWhenTrue = false;
  }
  if (emptyWhenTrue === undefined || emptyWhenTrue !== (returnedBranch === 'truthy')) {
    return undefined;
  }
  const length = unwrap(lengthExpression);
  if (
    !ts.isPropertyAccessExpression(length) ||
    length.questionDotToken !== undefined ||
    length.name.text !== 'length'
  ) {
    return undefined;
  }
  return readStaticPath(length.expression);
}

/** Classifies `length <op> number` (or `number <op> length`) as an emptiness or fullness test. */
function readEmptyWhenTrue(
  operator: ts.SyntaxKind,
  value: number,
  lengthOnLeft: boolean,
): boolean | undefined {
  const flipped: Partial<Record<ts.SyntaxKind, ts.SyntaxKind>> = {
    [ts.SyntaxKind.GreaterThanToken]: ts.SyntaxKind.LessThanToken,
    [ts.SyntaxKind.GreaterThanEqualsToken]: ts.SyntaxKind.LessThanEqualsToken,
    [ts.SyntaxKind.LessThanToken]: ts.SyntaxKind.GreaterThanToken,
    [ts.SyntaxKind.LessThanEqualsToken]: ts.SyntaxKind.GreaterThanEqualsToken,
  };
  const kind = lengthOnLeft ? operator : (flipped[operator] ?? operator);
  switch (kind) {
    case ts.SyntaxKind.EqualsEqualsEqualsToken:
    case ts.SyntaxKind.EqualsEqualsToken:
      return value === 0 ? true : undefined;
    case ts.SyntaxKind.ExclamationEqualsEqualsToken:
    case ts.SyntaxKind.ExclamationEqualsToken:
      return value === 0 ? false : undefined;
    case ts.SyntaxKind.LessThanToken:
      return value === 1 ? true : undefined;
    case ts.SyntaxKind.LessThanEqualsToken:
      return value === 0 ? true : undefined;
    case ts.SyntaxKind.GreaterThanToken:
      return value === 0 ? false : undefined;
    case ts.SyntaxKind.GreaterThanEqualsToken:
      return value === 1 ? false : undefined;
    default:
      return undefined;
  }
}

/** Returns the collection path when `node` reads one element (`X[i]` or `X.at(i)`). */
function readElementSource(node: ts.Node, collection: string): string | undefined {
  if (ts.isElementAccessExpression(node) && node.questionDotToken === undefined) {
    return readStaticPath(node.expression) === collection ? collection : undefined;
  }
  if (
    ts.isCallExpression(node) &&
    node.questionDotToken === undefined &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.questionDotToken === undefined &&
    node.expression.name.text === 'at' &&
    readStaticPath(node.expression.expression) === collection
  ) {
    return collection;
  }
  return undefined;
}

/** Requires a non-optional member read of the element, which throws when the element is missing. */
function isDereferenced(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
    parent.expression === node &&
    parent.questionDotToken === undefined
  );
}

/** Reads `a.b.c` without optional links as a dotted identity, or undefined for anything else. */
function readStaticPath(expression: ts.Expression): string | undefined {
  const names: string[] = [];
  let current = unwrap(expression);
  while (ts.isPropertyAccessExpression(current) && current.questionDotToken === undefined) {
    names.unshift(current.name.text);
    current = unwrap(current.expression);
  }
  if (!ts.isIdentifier(current)) return undefined;
  names.unshift(current.text);
  return names.length <= 8 ? names.join('.') : undefined;
}

/** Reads a non-negative integer literal. */
function readNumber(expression: ts.Expression): number | undefined {
  const current = unwrap(expression);
  return ts.isNumericLiteral(current) ? Number(current.text) : undefined;
}

/** Removes parentheses and type-only wrappers. */
function unwrap(expression: ts.Expression): ts.Expression {
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
