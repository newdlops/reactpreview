/** Recognizes hook collections forwarded into JSX through statically safe Array alternatives. */
import ts from 'typescript';
import { unwrapPreviewRuntimeExpression } from './previewRuntimeHookSyntax';

const MAX_COLLECTION_CARRIER_DEPTH = 4;
const IDENTITY_COLLECTION_METHOD_NAMES = new Set(['filter', 'slice', 'toReversed', 'toSorted']);

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
  return isPreviewRuntimeHookJsxCollectionCarrierMatching(
    expression,
    (value) => ts.isIdentifier(value) && value.text === identifierName,
    depth,
  );
}

/** Proves that a JSX collection carrier contains one exact hook-owned property occurrence. */
export function isPreviewRuntimeHookJsxCollectionExpressionCarrier(
  expression: ts.Expression,
  target: ts.Expression,
  depth = 0,
): boolean {
  const unwrappedTarget = unwrapPreviewRuntimeExpression(target);
  return isPreviewRuntimeHookJsxCollectionCarrierMatching(
    expression,
    (value) => value === unwrappedTarget,
    depth,
  );
}

/** Shares the bounded carrier grammar between root identifiers and exact nested expressions. */
function isPreviewRuntimeHookJsxCollectionCarrierMatching(
  expression: ts.Expression,
  matchesTarget: (value: ts.Expression) => boolean,
  depth: number,
): boolean {
  if (depth > MAX_COLLECTION_CARRIER_DEPTH) return false;
  const value = unwrapPreviewRuntimeExpression(expression);
  if (matchesTarget(value)) return true;
  if (
    ts.isCallExpression(value) &&
    value.questionDotToken === undefined &&
    ts.isPropertyAccessExpression(value.expression) &&
    value.expression.questionDotToken === undefined
  ) {
    if (IDENTITY_COLLECTION_METHOD_NAMES.has(value.expression.name.text)) {
      return isPreviewRuntimeHookJsxCollectionCarrierMatching(
        value.expression.expression,
        matchesTarget,
        depth + 1,
      );
    }
    if (
      value.expression.name.text === 'map' &&
      isIdentityPreservingMapCallback(value.arguments[0])
    ) {
      return isPreviewRuntimeHookJsxCollectionCarrierMatching(
        value.expression.expression,
        matchesTarget,
        depth + 1,
      );
    }
  }
  if (ts.isConditionalExpression(value)) {
    return (
      (isPreviewRuntimeHookJsxCollectionCarrierMatching(value.whenTrue, matchesTarget, depth + 1) &&
        ts.isArrayLiteralExpression(unwrapPreviewRuntimeExpression(value.whenFalse))) ||
      (isPreviewRuntimeHookJsxCollectionCarrierMatching(
        value.whenFalse,
        matchesTarget,
        depth + 1,
      ) &&
        ts.isArrayLiteralExpression(unwrapPreviewRuntimeExpression(value.whenTrue)))
    );
  }
  return (
    ts.isBinaryExpression(value) &&
    (value.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) &&
    isPreviewRuntimeHookJsxCollectionCarrierMatching(value.left, matchesTarget, depth + 1) &&
    ts.isArrayLiteralExpression(unwrapPreviewRuntimeExpression(value.right))
  );
}

/** Accepts a map only when its return explicitly retains the unchanged item record. */
function isIdentityPreservingMapCallback(expression: ts.Expression | undefined): boolean {
  if (
    expression === undefined ||
    (!ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression))
  ) {
    return false;
  }
  const parameter = expression.parameters[0];
  if (parameter === undefined || !ts.isIdentifier(parameter.name)) return false;
  const parameterName = parameter.name.text;
  const returned = readCallbackReturnExpression(expression);
  if (returned === undefined) return false;
  const value = unwrapPreviewRuntimeExpression(returned);
  if (ts.isIdentifier(value)) return value.text === parameterName;
  return (
    ts.isObjectLiteralExpression(value) &&
    value.properties.some((property) => {
      if (!ts.isSpreadAssignment(property)) return false;
      const spread = unwrapPreviewRuntimeExpression(property.expression);
      return ts.isIdentifier(spread) && spread.text === parameterName;
    })
  );
}

/** Reads one expression body or one direct top-level returned expression. */
function readCallbackReturnExpression(
  callback: ts.ArrowFunction | ts.FunctionExpression,
): ts.Expression | undefined {
  if (!ts.isBlock(callback.body)) return callback.body;
  const returns = callback.body.statements.filter(
    (statement): statement is ts.ReturnStatement =>
      ts.isReturnStatement(statement) && statement.expression !== undefined,
  );
  return returns.length === 1 ? returns[0]?.expression : undefined;
}
