/**
 * Infers an item value when a hook-owned collection is spread into a typed local array.
 *
 * A spread proves only that the source is iterable. The receiving local declaration can provide the
 * missing item contract without project-specific knowledge—for example `(RegExp | string)[]` tells
 * the preview that an inert regular expression is safer than a generic object. This keeps control
 * data from failing after the outer VirtualPage shell has otherwise rendered successfully.
 */
import ts from 'typescript';
import {
  isPreviewRuntimeFunction,
  unwrapPreviewRuntimeExpression,
} from './previewRuntimeHookSyntax';

/** Static item fallback returned to the usage-tree serializer. */
export interface PreviewRuntimeHookSpreadItemFallback {
  /** Side-effect-free item expression evaluated inside the generated preview bundle. */
  readonly expression: string;
  /** Human-readable inference source retained for future diagnostics. */
  readonly label: string;
  /** Paths required on the generated item, when its type itself proves a callable contract. */
  readonly requiredPaths?: readonly string[];
}

/**
 * Reads a typed `target.push(...source)` or `target.unshift(...source)` receiver.
 *
 * @param sourceAccess Property access used as the spread expression.
 * @returns A bounded scalar/native item expression, or undefined when local syntax is inconclusive.
 */
export function inferPreviewRuntimeHookSpreadItemFallback(
  sourceAccess: ts.PropertyAccessExpression,
): PreviewRuntimeHookSpreadItemFallback | undefined {
  const spread = sourceAccess.parent;
  if (!ts.isSpreadElement(spread)) return undefined;
  const call = spread.parent;
  if (!ts.isCallExpression(call)) return undefined;
  const callee = unwrapPreviewRuntimeExpression(call.expression);
  if (
    !ts.isPropertyAccessExpression(callee) ||
    (callee.name.text !== 'push' && callee.name.text !== 'unshift')
  ) {
    return undefined;
  }
  const receiver = unwrapPreviewRuntimeExpression(callee.expression);
  if (!ts.isIdentifier(receiver)) return undefined;
  const type = findLexicalArrayElementType(call, receiver.text);
  return type === undefined ? undefined : inferFallbackFromType(type, receiver.text, 0);
}

/** Finds the nearest typed lexical declaration, including variables captured by nested callbacks. */
function findLexicalArrayElementType(
  origin: ts.Node,
  receiverName: string,
): ts.TypeNode | undefined {
  let current: ts.Node = origin;
  for (;;) {
    if (isPreviewRuntimeFunction(current)) {
      const result = findOwnedArrayElementType(current, receiverName);
      if (result.found) return result.type;
    }
    if (ts.isSourceFile(current)) break;
    current = current.parent;
  }
  return undefined;
}

/** Finds one declaration owned by a function without entering any of its nested function scopes. */
function findOwnedArrayElementType(
  owner: ts.FunctionLikeDeclaration,
  receiverName: string,
): { readonly found: boolean; readonly type?: ts.TypeNode } {
  const results: ts.TypeNode[] = [];
  let found = owner.parameters.some(
    (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === receiverName,
  );
  const visit = (node: ts.Node): void => {
    if (node !== owner && isPreviewRuntimeFunction(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === receiverName
    ) {
      found = true;
      const elementType = node.type === undefined ? undefined : readArrayElementType(node.type);
      if (elementType !== undefined) results.push(elementType);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  const result = results.length === 1 ? results[0] : undefined;
  return result === undefined ? { found } : { found: true, type: result };
}

/** Unwraps `T[]`, `Array<T>`, and `ReadonlyArray<T>` while retaining the authored element type. */
function readArrayElementType(type: ts.TypeNode): ts.TypeNode | undefined {
  let current = type;
  while (ts.isParenthesizedTypeNode(current)) current = current.type;
  if (ts.isArrayTypeNode(current)) return current.elementType;
  if (
    ts.isTypeReferenceNode(current) &&
    ts.isIdentifier(current.typeName) &&
    (current.typeName.text === 'Array' || current.typeName.text === 'ReadonlyArray') &&
    current.typeArguments?.length === 1
  ) {
    return current.typeArguments[0];
  }
  return undefined;
}

/** Chooses a native inert value from a narrow type node, preferring the safest union member. */
function inferFallbackFromType(
  type: ts.TypeNode,
  semanticName: string,
  depth: number,
): PreviewRuntimeHookSpreadItemFallback | undefined {
  if (depth > 4) return undefined;
  let current = type;
  while (ts.isParenthesizedTypeNode(current)) current = current.type;
  if (ts.isUnionTypeNode(current)) {
    const candidates = current.types
      .map((member) => inferFallbackFromType(member, semanticName, depth + 1))
      .filter(
        (candidate): candidate is PreviewRuntimeHookSpreadItemFallback => candidate !== undefined,
      );
    return (
      candidates.find((candidate) => candidate.label === 'generated regular expression') ??
      candidates.find((candidate) => candidate.label === 'generated string') ??
      candidates[0]
    );
  }
  if (
    ts.isTypeReferenceNode(current) &&
    ts.isIdentifier(current.typeName) &&
    current.typeName.text === 'RegExp'
  ) {
    return Object.freeze({
      expression: 'new RegExp(".*")',
      label: 'generated regular expression',
      requiredPaths: Object.freeze(['test()']),
    });
  }
  if (current.kind === ts.SyntaxKind.StringKeyword) {
    return Object.freeze({
      expression: JSON.stringify(semanticName.toLowerCase().includes('route') ? '/' : semanticName),
      label: 'generated string',
    });
  }
  if (current.kind === ts.SyntaxKind.NumberKeyword) {
    return Object.freeze({ expression: '0', label: 'generated number' });
  }
  if (current.kind === ts.SyntaxKind.BooleanKeyword) {
    return Object.freeze({ expression: 'false', label: 'generated boolean' });
  }
  if (ts.isFunctionTypeNode(current)) {
    return Object.freeze({
      expression: 'Object.freeze(() => undefined)',
      label: 'generated function',
      requiredPaths: Object.freeze(['<root>()']),
    });
  }
  return undefined;
}
