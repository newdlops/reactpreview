/**
 * Reads the largest index an authored element read can reach, from syntax alone.
 *
 * Generated sample lists hold a fixed number of items (three by default). A component that reads
 * fixed week columns, `finals[k]` with `k: 0 | 1 | 2 | 3` or `stocks[k]` inside
 * `[0, 1, 2, 3, 4].map((k) => ...)`, then reads past the end and renders `fmtInt(undefined)` as
 * NaN (SimSheet). The bound comes from a non-negative integer literal, a callback parameter of an
 * integer-literal Array, or a parameter/props member typed as a union of integer literals. Any other
 * index stays unbounded so ordinary loops cannot inflate generated lists.
 */
import ts from 'typescript';

/** Generated lists hold at most ten items, so larger indexes are not worth a longer list. */
const MAX_BOUNDED_INDEX = 9;
const INDEXED_CALLBACK_METHOD_NAMES = new Set([
  'every',
  'filter',
  'find',
  'findIndex',
  'flatMap',
  'forEach',
  'map',
  'some',
]);

/**
 * Returns the largest index `expression` can take, or `undefined` when syntax does not bound it.
 *
 * @param expression Argument of an element access such as `finals[k]`.
 */
export function readPreviewBoundedIndexMaximum(expression: ts.Expression): number | undefined {
  const index = unwrapExpression(expression);
  if (ts.isNumericLiteral(index)) return readPreviewBoundedIndexLiteral(index.text);
  if (!ts.isIdentifier(index)) return undefined;
  let scope = ts.findAncestor(index.parent, ts.isFunctionLike);
  while (scope !== undefined) {
    for (const [position, parameter] of scope.parameters.entries()) {
      const bound = readParameterBound(scope, position, parameter, index.text);
      if (bound !== 'absent') return bound;
    }
    scope = ts.findAncestor(scope.parent, ts.isFunctionLike);
  }
  return undefined;
}

/**
 * Reads the bound of `name` when `parameter` declares it; `'absent'` lets the search continue to
 * the enclosing function, and `undefined` stops it because the nearest declaration is unbounded.
 */
function readParameterBound(
  owner: ts.SignatureDeclaration,
  position: number,
  parameter: ts.ParameterDeclaration,
  name: string,
): number | undefined | 'absent' {
  if (ts.isIdentifier(parameter.name)) {
    if (parameter.name.text !== name) return 'absent';
    return parameter.type === undefined
      ? position === 0
        ? readIntegerArrayCallbackBound(owner)
        : undefined
      : readIntegerUnionMaximum(parameter.type);
  }
  if (!ts.isObjectBindingPattern(parameter.name)) return 'absent';
  const element = parameter.name.elements.find(
    (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name,
  );
  if (element === undefined) return 'absent';
  const property = element.propertyName ?? element.name;
  const propertyName =
    ts.isIdentifier(property) || ts.isStringLiteral(property) ? property.text : undefined;
  const member =
    propertyName === undefined || parameter.type === undefined
      ? undefined
      : readTypeMember(parameter.type, propertyName, owner.getSourceFile());
  return member === undefined ? undefined : readIntegerUnionMaximum(member);
}

/** Bounds `k` in `[0, 1, 2, 3].map((k) => ...)`, including `as const` and parenthesized arrays. */
function readIntegerArrayCallbackBound(callback: ts.SignatureDeclaration): number | undefined {
  const call = callback.parent;
  if (
    !ts.isCallExpression(call) ||
    call.arguments[0] !== callback ||
    !ts.isPropertyAccessExpression(call.expression) ||
    !INDEXED_CALLBACK_METHOD_NAMES.has(call.expression.name.text)
  ) {
    return undefined;
  }
  const receiver = unwrapExpression(call.expression.expression);
  if (!ts.isArrayLiteralExpression(receiver) || receiver.elements.length === 0) return undefined;
  let maximum = -1;
  for (const element of receiver.elements) {
    const value = ts.isNumericLiteral(element)
      ? readPreviewBoundedIndexLiteral(element.text)
      : undefined;
    if (value === undefined) return undefined;
    maximum = Math.max(maximum, value);
  }
  return maximum;
}

/** Finds a member type in an inline type literal or a same-file interface/type alias. */
function readTypeMember(
  type: ts.TypeNode,
  propertyName: string,
  sourceFile: ts.SourceFile,
): ts.TypeNode | undefined {
  const members = ts.isTypeLiteralNode(type)
    ? type.members
    : ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)
      ? readLocalObjectTypeMembers(type.typeName.text, sourceFile)
      : undefined;
  const member = members?.find(
    (candidate): candidate is ts.PropertySignature =>
      ts.isPropertySignature(candidate) &&
      (ts.isIdentifier(candidate.name) || ts.isStringLiteral(candidate.name)) &&
      candidate.name.text === propertyName,
  );
  return member?.type;
}

/** Reads the members of a top-level interface or object type alias declared in the same file. */
function readLocalObjectTypeMembers(
  name: string,
  sourceFile: ts.SourceFile,
): ts.NodeArray<ts.TypeElement> | undefined {
  for (const statement of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(statement) && statement.name.text === name) {
      return statement.members;
    }
    if (
      ts.isTypeAliasDeclaration(statement) &&
      statement.name.text === name &&
      ts.isTypeLiteralNode(statement.type)
    ) {
      return statement.type.members;
    }
  }
  return undefined;
}

/** Reads `3` or `0 | 1 | 2 | 3`; any non-literal member makes the type unbounded. */
function readIntegerUnionMaximum(type: ts.TypeNode): number | undefined {
  const members = ts.isUnionTypeNode(type) ? type.types : [type];
  let maximum = -1;
  for (const member of members) {
    const value =
      ts.isLiteralTypeNode(member) && ts.isNumericLiteral(member.literal)
        ? readPreviewBoundedIndexLiteral(member.literal.text)
        : undefined;
    if (value === undefined) return undefined;
    maximum = Math.max(maximum, value);
  }
  return maximum < 0 ? undefined : maximum;
}

/** Accepts a small non-negative integer literal (an index text such as a `'3'` path segment). */
export function readPreviewBoundedIndexLiteral(text: string): number | undefined {
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_BOUNDED_INDEX
    ? value
    : undefined;
}

/** Skips parentheses, `as`/`satisfies`/non-null wrappers around an index or Array literal. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
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
