/** Keeps GraphQL map item origins local to their callback body and exact lexical binding. */
import ts from 'typescript';
import {
  createPreviewRuntimeHookAliasScope,
  type PreviewRuntimeHookAliasScope,
} from './previewRuntimeHookAliasScope';
import { unwrapPreviewRuntimeExpression } from './previewRuntimeHookSyntax';

/** One active item origin; nested maps restore the previous binding on exit. */
interface MappedItem {
  /** Callback body where the provided item is available. */
  readonly callback: ts.ArrowFunction;
  /** Absolute response item path, appended once to relative properties. */
  readonly prefix: readonly string[];
  /** Current-query lexical masks, including declarations in the owner's body. */
  readonly scope: PreviewRuntimeHookAliasScope;
}

/**
 * Tracks provided map items without retaining facts beyond one render-prop traversal.
 *
 * @param readPropertyPath Existing syntax-only property reader, supplied with a relative origin.
 * @returns Entry/restore operations and a reader that rejects shadowed or reassigned items.
 */
export function createPreviewGraphqlMappedItemScope(
  readPropertyPath: (
    expression: ts.Expression,
    bindings: ReadonlyMap<string, readonly string[]>,
  ) => readonly string[] | undefined,
): {
  /** Enters a proven collection map; returns an exit operation when its item is supported. */
  readonly enter: (
    callback: ts.ArrowFunction,
    prefix: readonly string[],
  ) => (() => void) | undefined;
  /** Reads a visible item property only within the provided callback's body. */
  readonly readPath: (expression: ts.Expression) => readonly string[] | undefined;
} {
  const items = new Map<string, MappedItem>();
  return {
    enter: (callback, prefix) => {
      const parameter = callback.parameters[0];
      if (parameter === undefined || !ts.isIdentifier(parameter.name) || parameter.dotDotDotToken)
        return undefined;
      const name = parameter.name.text;
      const scope = createPreviewRuntimeHookAliasScope(
        callback,
        new Map([[name, [[]]]]),
        new Set([name]),
        { ownerParameterOrigins: true },
      );
      if (hasParameterWrite(callback.body, name, scope)) return undefined;
      const previous = items.get(name);
      items.set(name, { callback, prefix, scope });
      return () => {
        if (previous === undefined) items.delete(name);
        else items.set(name, previous);
      };
    },
    readPath: (expression) => {
      for (const [name, item] of items) {
        if (
          expression.pos < item.callback.body.pos ||
          expression.end > item.callback.body.end ||
          !item.scope.readAliases(expression).has(name)
        )
          continue;
        const relative = readPropertyPath(expression, new Map([[name, []]]));
        if (relative !== undefined) return [...item.prefix, ...relative];
      }
      return undefined;
    },
  };
}

/** Rejects replaced identities, including writes in captured closures but excluding local shadows. */
function hasParameterWrite(
  body: ts.ConciseBody,
  name: string,
  scope: PreviewRuntimeHookAliasScope,
): boolean {
  let written = false;
  const visit = (node: ts.Node): void => {
    if (written) return;
    let target: ts.Expression | undefined;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    )
      target = node.left;
    else if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken)
    )
      target = node.operand;
    else if (
      (ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
      !ts.isVariableDeclarationList(node.initializer)
    )
      target = node.initializer;
    if (target !== undefined && writesParameter(target, name, scope)) written = true;
    if (!written) ts.forEachChild(node, visit);
  };
  visit(body);
  return written;
}

/** Reads assignment-pattern leaves; member writes preserve the item object's identity. */
function writesParameter(
  target: ts.Expression,
  name: string,
  scope: PreviewRuntimeHookAliasScope,
): boolean {
  const value = unwrapPreviewRuntimeExpression(target);
  if (ts.isIdentifier(value)) return value.text === name && scope.readAliases(value).has(name);
  if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.EqualsToken)
    return writesParameter(value.left, name, scope);
  if (ts.isArrayLiteralExpression(value))
    return value.elements.some((element) =>
      ts.isSpreadElement(element)
        ? writesParameter(element.expression, name, scope)
        : !ts.isOmittedExpression(element) && writesParameter(element, name, scope),
    );
  if (ts.isObjectLiteralExpression(value))
    return value.properties.some((property) => {
      if (ts.isShorthandPropertyAssignment(property))
        return writesParameter(property.name, name, scope);
      if (ts.isPropertyAssignment(property))
        return writesParameter(property.initializer, name, scope);
      if (ts.isSpreadAssignment(property)) return writesParameter(property.expression, name, scope);
      return false;
    });
  return false;
}
