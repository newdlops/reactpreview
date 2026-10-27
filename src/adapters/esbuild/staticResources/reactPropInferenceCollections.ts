/** Finds identity-preserving collection helpers and syntax-proven array bounds. */
import ts from 'typescript';
import { readPreviewBoundedIndexMaximum } from './reactPropIndexBounds';
import {
  BLOCKED_PROPERTY_NAMES,
  type ExportedFunctionLike,
  type InferenceState,
  KEYED_COLLECTION_HELPER_PATTERN,
  LOCAL_HELPER_ITEM_IDENTITY_METHOD_NAMES,
  MAX_INFERRED_DEPTH,
} from './reactPropInferenceModel';
import { inferPreviewUsageSemanticFallback } from './reactPropInferenceOperations';
import {
  createMutableNode,
  readMutablePathNode,
  recordArrayMinItems,
  requirePath,
} from './reactPropInferenceShape';
import { isShadowedPathRoot, readPropPath, unwrapExpression } from './reactPropInferenceSyntax';
import { setArrayItemRequirement } from './reactPropInferenceTypeShape';

/**
 * Recovers the item key supplied to conventional collection helpers such as
 * `sortByNewest(project.issues, 'createdAt')`. The helper name, prop-rooted first argument, and
 * literal key must all be present; no imported helper is executed or assumed to return a value.
 */
export function collectKeyedCollectionHelperRequirements(
  functionLike: ExportedFunctionLike,
  state: InferenceState,
): void {
  if (functionLike.body === undefined) return;
  const visit = (node: ts.Node): void => {
    if (
      node !== functionLike &&
      (ts.isArrowFunction(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isMethodDeclaration(node))
    ) {
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      KEYED_COLLECTION_HELPER_PATTERN.test(node.expression.text)
    ) {
      const collectionArgument = node.arguments[0];
      const keyArgument = node.arguments[1];
      if (
        collectionArgument !== undefined &&
        keyArgument !== undefined &&
        !ts.isSpreadElement(collectionArgument) &&
        !ts.isSpreadElement(keyArgument)
      ) {
        const collectionPath = readPropPath(collectionArgument, state.aliases);
        const keyValue = unwrapExpression(keyArgument);
        const key = ts.isStringLiteralLike(keyValue) ? keyValue.text : undefined;
        if (
          collectionPath !== undefined &&
          collectionPath.length > 0 &&
          collectionPath.length < MAX_INFERRED_DEPTH &&
          key !== undefined &&
          !BLOCKED_PROPERTY_NAMES.has(key) &&
          !isShadowedPathRoot(collectionArgument, state)
        ) {
          const semantic = inferPreviewUsageSemanticFallback(state, key);
          const item = createMutableNode('object', 'usage');
          const property = createMutableNode(semantic?.kind ?? 'string', 'usage');
          if (semantic?.value !== undefined) property.value = semantic.value;
          if (semantic?.exactValue === true) {
            property.exactValue = true;
            property.exactValueSource = 'usage';
          }
          item.children.set(key, property);
          requirePath(state, collectionPath, 'array', 'usage');
          setArrayItemRequirement(state, collectionPath, item);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(functionLike.body);
}

/**
 * Records how many items authored index reads reach (`readPreviewBoundedIndexMaximum`). An index
 * variable bounded by a literal range proves an Array receiver; a literal index (`name[0]`, which
 * may read a string) only lengthens a receiver that is already an Array.
 */
export function collectBoundedIndexReadLengths(
  functionLike: ExportedFunctionLike,
  state: InferenceState,
): void {
  const body = functionLike.body;
  if (body === undefined) return;
  const visit = (node: ts.Node): void => {
    if (ts.isElementAccessExpression(node)) {
      const maximum = readPreviewBoundedIndexMaximum(node.argumentExpression);
      const path_ =
        maximum === undefined ? undefined : readPropPath(node.expression, state.aliases);
      if (
        maximum !== undefined &&
        path_ !== undefined &&
        path_.length > 0 &&
        !isShadowedPathRoot(node.expression, state)
      ) {
        if (!ts.isNumericLiteral(unwrapExpression(node.argumentExpression))) {
          requirePath(state, path_, 'array', 'usage');
        }
        const receiver = readMutablePathNode(state, path_);
        if (receiver?.kind === 'array') recordArrayMinItems(receiver, maximum);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
}

/** Finds local helpers whose result keeps every returned item from one Array parameter unchanged. */
export function collectIdentityCollectionHelperParameters(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, ReadonlySet<number>> {
  const candidates = new Map<string, ExportedFunctionLike[]>();
  const append = (name: string, functionLike: ExportedFunctionLike): void => {
    const values = candidates.get(name) ?? [];
    values.push(functionLike);
    candidates.set(name, values);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      append(node.name.text, node);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const initializer = unwrapExpression(node.initializer);
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
        append(node.name.text, initializer);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const result = new Map<string, ReadonlySet<number>>();
  for (const [name, declarations] of candidates) {
    const declaration = declarations.length === 1 ? declarations[0] : undefined;
    if (declaration === undefined) continue;
    const parameters = new Set<number>();
    for (const [index, parameter] of declaration.parameters.entries()) {
      if (
        ts.isIdentifier(parameter.name) &&
        doesLocalHelperReturnIdentityCollection(declaration, parameter.name.text)
      ) {
        parameters.add(index);
      }
    }
    if (parameters.size > 0) result.set(name, parameters);
  }
  return result;
}

/** Accepts only direct filter/sort/slice chains and aliases rooted in the selected parameter. */
export function doesLocalHelperReturnIdentityCollection(
  functionLike: ExportedFunctionLike,
  parameterName: string,
): boolean {
  const body = functionLike.body;
  if (body === undefined) return false;
  const aliases = new Set([parameterName]);
  if (!ts.isBlock(body)) return isIdentityCollectionCarrier(body, aliases);
  const returnState = { returned: false, unsupported: false };
  const visit = (node: ts.Node): void => {
    if (
      node !== body &&
      (ts.isArrowFunction(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isMethodDeclaration(node))
    ) {
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      if (isIdentityCollectionCarrier(node.initializer, aliases)) aliases.add(node.name.text);
      else aliases.delete(node.name.text);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(unwrapExpression(node.left))
    ) {
      const name = (unwrapExpression(node.left) as ts.Identifier).text;
      if (isIdentityCollectionCarrier(node.right, aliases)) aliases.add(name);
      else aliases.delete(name);
    } else if (ts.isReturnStatement(node)) {
      if (node.expression !== undefined && isIdentityCollectionCarrier(node.expression, aliases)) {
        returnState.returned = true;
      } else {
        returnState.unsupported = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return returnState.returned && !returnState.unsupported;
}

/** Reports an expression whose Array transforms cannot replace or reshape its items. */
export function isIdentityCollectionCarrier(
  expression: ts.Expression,
  aliases: ReadonlySet<string>,
): boolean {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return aliases.has(current.text);
  if (!ts.isCallExpression(current)) return false;
  const callee = unwrapExpression(current.expression);
  return (
    ts.isPropertyAccessExpression(callee) &&
    LOCAL_HELPER_ITEM_IDENTITY_METHOD_NAMES.has(callee.name.text) &&
    isIdentityCollectionCarrier(callee.expression, aliases)
  );
}

/** Carries a prop Array path through one proven same-file identity-preserving helper call. */
export function readIdentityCollectionHelperCallPath(
  expression: ts.Expression,
  state: InferenceState,
): readonly string[] | undefined {
  const current = unwrapExpression(expression);
  if (!ts.isCallExpression(current)) return undefined;
  const callee = unwrapExpression(current.expression);
  if (!ts.isIdentifier(callee)) return undefined;
  const parameterIndexes = state.identityCollectionHelperParameters.get(callee.text);
  if (parameterIndexes === undefined) return undefined;
  for (const parameterIndex of parameterIndexes) {
    const argument = current.arguments[parameterIndex];
    if (argument === undefined || ts.isSpreadElement(argument)) continue;
    const path_ =
      readPropPath(argument, state.aliases) ??
      readIdentityCollectionHelperCallPath(argument, state);
    if (path_ !== undefined) return path_;
  }
  return undefined;
}
