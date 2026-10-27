/**
 * Preserves source-proven query lifecycle exits before their own data is dereferenced.
 * A Boolean override cannot populate a pending/error query. This parser-only analysis correlates
 * status and data through prior immutable local bindings, without executing hooks or query options.
 */
import ts from 'typescript';

type Access = readonly string[];
interface Binding {
  /** Authored initializer whose stable identity is followed without evaluating it. */
  readonly expression: ts.Expression;
  /** Object-destructuring property appended after resolving the initializer. */
  readonly property?: string;
}

/** Reports whether bypassing this lifecycle exit reaches consumption of the same result's data. */
export function isPreviewReactQueryLifecycleSafetyGuard(
  statement: ts.IfStatement,
  returnedBranch: 'falsy' | 'truthy',
): boolean {
  if (!ts.isBlock(statement.parent)) return false;
  const index = statement.parent.statements.indexOf(statement);
  if (index < 0) return false;
  const bindings = collectPriorBindings(statement.parent.statements.slice(0, index));
  const lifecycle = readLifecycleAccess(statement.expression, returnedBranch, bindings);
  if (lifecycle === undefined) return false;
  const data = [...lifecycle.slice(0, -1), 'data'];
  let remaining = 2_048;
  const visit = (node: ts.Node): boolean => {
    if (remaining-- <= 0 || ts.isFunctionLike(node)) return false;
    if (ts.isExpression(node)) {
      const access = readAccess(node, bindings);
      if (access !== undefined && sameAccess(access, data) && isDereferenced(node)) return true;
    }
    return ts.forEachChild(node, (child) => (visit(child) ? true : undefined)) === true;
  };
  return statement.parent.statements.slice(index + 1).some(visit);
}

/** Collects only direct prior const declarations; defaults, rest, mutations and nested scopes stop proof. */
function collectPriorBindings(statements: readonly ts.Statement[]): ReadonlyMap<string, Binding> {
  const bindings = new Map<string, Binding>();
  for (const statement of statements) {
    if (
      !ts.isVariableStatement(statement) ||
      (statement.declarationList.flags & ts.NodeFlags.Const) === 0
    )
      continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.initializer === undefined) continue;
      if (ts.isIdentifier(declaration.name)) {
        bindings.set(declaration.name.text, { expression: declaration.initializer });
      } else if (ts.isObjectBindingPattern(declaration.name)) {
        for (const element of declaration.name.elements) {
          const property = element.propertyName ?? element.name;
          if (
            !ts.isIdentifier(element.name) ||
            element.initializer !== undefined ||
            element.dotDotDotToken !== undefined ||
            !(ts.isIdentifier(property) || ts.isStringLiteralLike(property))
          )
            continue;
          bindings.set(element.name.text, {
            expression: declaration.initializer,
            property: property.text,
          });
        }
      }
    }
  }
  return bindings;
}

/** Recognizes only pending/loading/error exits or the failure of a success-state check. */
function readLifecycleAccess(
  expression: ts.Expression,
  returnedBranch: 'falsy' | 'truthy',
  bindings: ReadonlyMap<string, Binding>,
): Access | undefined {
  const value = unwrap(expression);
  if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.ExclamationToken) {
    return readLifecycleAccess(
      value.operand,
      returnedBranch === 'truthy' ? 'falsy' : 'truthy',
      bindings,
    );
  }
  if (ts.isBinaryExpression(value)) {
    const left = unwrap(value.left),
      right = unwrap(value.right);
    const literal = ts.isStringLiteralLike(left)
      ? left
      : ts.isStringLiteralLike(right)
        ? right
        : undefined;
    if (literal === undefined) return undefined;
    const equal =
      value.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      value.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken;
    const unequal =
      value.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      value.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken;
    if (!equal && !unequal) return undefined;
    const returnsEqual = equal === (returnedBranch === 'truthy');
    if (
      !(returnsEqual && ['pending', 'loading', 'error'].includes(literal.text)) &&
      !(!returnsEqual && literal.text === 'success')
    )
      return undefined;
    const access = readAccess(literal === left ? right : left, bindings);
    return access !== undefined && access.length > 1 && access.at(-1) === 'status'
      ? access
      : undefined;
  }
  const access = readAccess(value, bindings);
  if (access === undefined || access.length < 2) return undefined;
  const property = access.at(-1);
  return (returnedBranch === 'truthy' &&
    ['isPending', 'isLoading', 'isError'].includes(property ?? '')) ||
    (returnedBranch === 'falsy' && property === 'isSuccess')
    ? access
    : undefined;
}

/** Resolves immutable aliases with a short cycle/depth bound and original call-site identities. */
function readAccess(
  expression: ts.Expression,
  bindings: ReadonlyMap<string, Binding>,
  depth = 0,
): Access | undefined {
  if (depth >= 8) return undefined;
  const value = unwrap(expression);
  if (ts.isPropertyAccessExpression(value) && value.questionDotToken === undefined) {
    const receiver = readAccess(value.expression, bindings, depth + 1);
    return receiver === undefined ? undefined : [...receiver, value.name.text];
  }
  if (ts.isCallExpression(value)) return ['#' + String(value.pos)];
  if (!ts.isIdentifier(value)) return undefined;
  const binding = bindings.get(value.text);
  if (binding === undefined) return [value.text];
  const receiver = readAccess(binding.expression, bindings, depth + 1);
  return receiver === undefined
    ? undefined
    : binding.property === undefined
      ? receiver
      : [...receiver, binding.property];
}

/** Accepts member/index receivers only; optional reads and passing an undefined value stay selectable. */
function isDereferenced(expression: ts.Expression): boolean {
  const parent = expression.parent;
  return (
    (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
    parent.expression === expression &&
    parent.questionDotToken === undefined
  );
}

/** Compares original lexical identities rather than coincidental status/data names. */
function sameAccess(left: Access, right: Access): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

/** Removes inert wrappers without changing expression identity or following executable syntax. */
function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  )
    current = current.expression;
  return current;
}
