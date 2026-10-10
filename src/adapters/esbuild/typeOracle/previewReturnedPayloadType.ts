/**
 * Reads the declared payload type of a request whose own response body is untyped.
 *
 * API modules often call an HTTP client without a type argument and declare the payload on the
 * wrapping function instead:
 *
 * ```ts
 * export const getDetail = async (id: number): Promise<ContentDetail> => {
 *   const { data } = await apiClient.get(`/api/contents/${id}`);
 *   return data;
 * };
 * ```
 *
 * The call resolves to `AxiosResponse<any>`, so its body says nothing, while the function's
 * annotation states exactly what the response carries. The annotation is used only when the
 * response body leaves the function unchanged: a returned `data` binding, `response.data`,
 * `(await call).data`, or `call.then((response) => response.data)`. Any other use of the body
 * (mapping, picking one field) keeps the call untyped.
 */
import ts from 'typescript';

const ABSENT_TYPE_FLAGS =
  ts.TypeFlags.Any |
  ts.TypeFlags.Unknown |
  ts.TypeFlags.Never |
  ts.TypeFlags.Void |
  ts.TypeFlags.Undefined;
const BODY_PROPERTY = 'data';

/**
 * Returns the awaited return annotation of the function that returns this call's response body.
 *
 * @param checker Checker of the program that owns `call`.
 * @param call Request call whose own body type is `any` or `unknown`.
 * @returns Declared payload type, or `undefined` without an annotated pass-through return.
 */
export function readPreviewReturnedPayloadType(
  checker: ts.TypeChecker,
  call: ts.CallExpression,
): ts.Type | undefined {
  const owner = findOwnerFunction(call);
  if (owner?.type === undefined || !returnsResponseBody(owner, call)) return undefined;
  const declared = checker.getTypeFromTypeNode(owner.type);
  const payload = checker.getAwaitedType(declared) ?? declared;
  return (payload.flags & ABSENT_TYPE_FLAGS) === 0 ? payload : undefined;
}

/** Nearest function around the call; the request must run in that function's own body. */
function findOwnerFunction(node: ts.Node): ts.SignatureDeclaration | undefined {
  return ts.findAncestor(node.parent, ts.isFunctionLike);
}

/** True when one return of `owner` hands out the call's response body unchanged. */
function returnsResponseBody(owner: ts.SignatureDeclaration, call: ts.CallExpression): boolean {
  const promise = climbParentheses(call);
  const thenCall = readBodyThenCall(promise);
  if (thenCall !== undefined) return isReturnedFrom(owner, thenCall);
  const awaited = promise.parent;
  if (!ts.isAwaitExpression(awaited)) return false;
  const consumer = climbParentheses(awaited);
  const user = consumer.parent;
  if (ts.isPropertyAccessExpression(user) && user.name.text === BODY_PROPERTY) {
    return isReturnedFrom(owner, user);
  }
  if (!ts.isVariableDeclaration(user) || user.initializer !== consumer) return false;
  const binding = user.name;
  if (ts.isIdentifier(binding)) {
    return someReturn(owner, (value) => isBodyAccess(value, binding.text));
  }
  if (!ts.isObjectBindingPattern(binding)) return false;
  const bodyName = binding.elements.find(
    (element) =>
      element.dotDotDotToken === undefined &&
      readBindingPropertyName(element) === BODY_PROPERTY &&
      ts.isIdentifier(element.name),
  )?.name;
  return (
    bodyName !== undefined &&
    ts.isIdentifier(bodyName) &&
    someReturn(owner, (value) => ts.isIdentifier(value) && value.text === bodyName.text)
  );
}

/** `call.then((response) => response.data)` or `call.then(({ data }) => data)`. */
function readBodyThenCall(promise: ts.Expression): ts.CallExpression | undefined {
  const access = promise.parent;
  if (!ts.isPropertyAccessExpression(access) || access.name.text !== 'then') return undefined;
  const thenCall = access.parent;
  if (!ts.isCallExpression(thenCall) || thenCall.expression !== access) return undefined;
  const [callback] = thenCall.arguments;
  if (callback === undefined || !ts.isArrowFunction(callback) || !ts.isExpression(callback.body)) {
    return undefined;
  }
  const [parameter] = callback.parameters;
  const result = unwrapParentheses(callback.body);
  if (parameter === undefined) return undefined;
  if (ts.isIdentifier(parameter.name)) {
    return isBodyAccess(result, parameter.name.text) ? thenCall : undefined;
  }
  if (!ts.isObjectBindingPattern(parameter.name)) return undefined;
  const element = parameter.name.elements.find(
    (candidate) => readBindingPropertyName(candidate) === BODY_PROPERTY,
  );
  return element !== undefined &&
    ts.isIdentifier(element.name) &&
    ts.isIdentifier(result) &&
    result.text === element.name.text
    ? thenCall
    : undefined;
}

/** True when `value` is returned by `owner` itself (a return statement or an arrow body). */
function isReturnedFrom(owner: ts.SignatureDeclaration, value: ts.Expression): boolean {
  const outer = climbParentheses(value);
  const parent = outer.parent;
  if (ts.isArrowFunction(owner) && owner.body === outer) return true;
  return ts.isReturnStatement(parent) && findOwnerFunction(parent) === owner;
}

/** True when some return statement of `owner` (not of a nested function) satisfies `test`. */
function someReturn(
  owner: ts.SignatureDeclaration,
  test: (value: ts.Expression) => boolean,
): boolean {
  if (ts.isArrowFunction(owner) && ts.isExpression(owner.body)) {
    return test(unwrapParentheses(owner.body));
  }
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      found = test(unwrapParentheses(node.expression));
      return;
    }
    ts.forEachChild(node, visit);
  };
  const body = (owner as { readonly body?: ts.Node }).body;
  if (body !== undefined) ts.forEachChild(body, visit);
  return found;
}

/** `name.data`. */
function isBodyAccess(value: ts.Expression, name: string): boolean {
  return (
    ts.isPropertyAccessExpression(value) &&
    value.name.text === BODY_PROPERTY &&
    ts.isIdentifier(value.expression) &&
    value.expression.text === name
  );
}

/** Property name read by one binding element (`{ data }` or `{ data: body }`). */
function readBindingPropertyName(element: ts.BindingElement): string | undefined {
  const property = element.propertyName ?? element.name;
  return ts.isIdentifier(property) || ts.isStringLiteral(property) ? property.text : undefined;
}

/** Outermost parenthesized expression that wraps `node`. */
function climbParentheses(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current.parent)) current = current.parent;
  return current;
}

/** Expression inside any parentheses. */
function unwrapParentheses(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}
