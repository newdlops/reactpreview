/** Normalizes and deduplicates safe hook alias paths and callable smart values. */
import ts from 'typescript';
import type {
  PreviewRuntimeHookAliasUsagePath,
  PreviewRuntimeHookImportedHelperItemFallback,
} from './previewRuntimeHookAliasModel';
import {
  createPreviewRuntimeHookRenderedTextExpression,
  isPreviewRuntimeHookEmptyRenderableJsxValue,
  isPreviewRuntimeHookMutableRefJsxValue,
  isPreviewRuntimeHookTextValue,
} from './previewRuntimeHookDirectUsage';
import {
  inferPreviewRuntimeHookCollectionLengthGuardPassValue,
  inferPreviewRuntimeHookExpressionGuardPassFallback,
} from './previewRuntimeHookGuardValue';
import { inferPreviewRuntimeHookMembershipItemFallback } from './previewRuntimeHookMembershipItem';
import {
  isPreviewRuntimeHookArrayUsageProperty,
  isPreviewRuntimeHookStringUsageProperty,
} from './previewRuntimeHookPropertyUsage';
import { inferPreviewRuntimeSemanticFallback } from './previewRuntimeHookSemantics';
import {
  unwrapPreviewRuntimeExpression,
  type PreviewRuntimeFunction,
} from './previewRuntimeHookSyntax';

/** Converts one reached terminal into the collection/string/call shape used by serialization. */
export function normalizeAliasUsage(
  expression: ts.PropertyAccessExpression,
  names: readonly string[],
  rootName: string,
  availableBeforePosition: number,
  provenCollectionPaths: ReadonlySet<string>,
  inferCollectionItem?: (
    access: ts.PropertyAccessExpression,
  ) => PreviewRuntimeHookImportedHelperItemFallback | undefined,
): PreviewRuntimeHookAliasUsagePath | undefined {
  if (names.length === 0 || names.length > 12) return undefined;
  const terminal = names.at(-1);
  const called =
    ts.isCallExpression(expression.parent) && expression.parent.expression === expression;
  const smartCallable = called ? inferPreviewRuntimeHookCallableSmartValue(expression) : undefined;
  const receiverNames = names.slice(0, -1);
  const membershipItem = inferPreviewRuntimeHookMembershipItemFallback(
    expression,
    names.at(-2) ?? rootName,
    expression.getSourceFile(),
    provenCollectionPaths.has(receiverNames.join('.')),
  );
  const collection =
    isPreviewRuntimeHookArrayUsageProperty(terminal) || membershipItem !== undefined;
  const collectionLengthRequiresItem =
    terminal === 'length' &&
    inferPreviewRuntimeHookCollectionLengthGuardPassValue(expression) === true;
  // Alias receivers must preserve the same callback/helper item evidence as direct hook reads.
  const item =
    membershipItem ??
    (called && collection ? inferCollectionItem?.(expression) : undefined) ??
    (collectionLengthRequiresItem
      ? {
          expression: 'Object.freeze({ id: "preview-id", name: "name" })',
          requiredPaths: ['id', 'name'],
        }
      : undefined);
  const stringReceiver =
    called &&
    isPreviewRuntimeHookStringUsageProperty(terminal) &&
    inferPreviewRuntimeSemanticFallback(names.at(-2) ?? rootName)?.label !== 'generated object';
  const guardPass =
    !called && !collection && !stringReceiver
      ? inferPreviewRuntimeHookExpressionGuardPassFallback(expression, availableBeforePosition)
      : undefined;
  const mutableRef = isPreviewRuntimeHookMutableRefJsxValue(expression);
  const emptyRenderable = isPreviewRuntimeHookEmptyRenderableJsxValue(expression);
  const rendered = isPreviewRuntimeHookTextValue(expression);
  const renderedExpression = rendered
    ? createPreviewRuntimeHookRenderedTextExpression(terminal)
    : undefined;
  return Object.freeze({
    called: !collection && !stringReceiver && called,
    ...(item === undefined
      ? {}
      : {
          collectionItemExpression: item.expression,
          ...(item.generatedStringIdentity === true
            ? { collectionItemStringIdentity: true as const }
            : {}),
          collectionItemRequiredPaths: Object.freeze([...(item.requiredPaths ?? [])]),
        }),
    ...(collection && terminal !== undefined ? { collectionProperty: terminal } : {}),
    names: Object.freeze(collection || stringReceiver ? names.slice(0, -1) : [...names]),
    ...(guardPass === undefined
      ? {}
      : { renderGuard: true as const, valueExpression: guardPass.expression }),
    ...(mutableRef ? { valueExpression: '({ current: null })' } : {}),
    ...(emptyRenderable ? { valueExpression: 'null' } : {}),
    ...(renderedExpression === undefined || emptyRenderable
      ? {}
      : { valueExpression: renderedExpression }),
    ...(smartCallable === undefined
      ? {}
      : {
          smartValueExpression: smartCallable.expression,
          smartValueRole: smartCallable.role,
        }),
    ...(stringReceiver ? { stringProperty: terminal ?? '' } : {}),
  });
}

/**
 * Describes a callable result that can be explored without baking the result into its fallback.
 *
 * A generated hook method used as the direct predicate of an Array filter is an observable data
 * valve: a falsey no-op drops every generated row, while a truthy result retains the corridor for
 * downstream verification. The compiler emits both the neutral callable and this candidate role;
 * the browser-side residual chooses and learns from the observed invocation outcome.
 */
export function inferPreviewRuntimeHookCallableSmartValue(
  propertyAccess: ts.PropertyAccessExpression,
):
  | {
      readonly expression: 'true';
      readonly role: 'collection-filter-predicate';
    }
  | undefined {
  const call = propertyAccess.parent;
  if (!ts.isCallExpression(call) || call.expression !== propertyAccess) return undefined;
  const callback = findDirectCollectionFilterCallback(call);
  return callback === undefined
    ? undefined
    : Object.freeze({ expression: 'true', role: 'collection-filter-predicate' });
}

/** Finds the exact inline callback whose returned expression contains this generated call. */
export function findDirectCollectionFilterCallback(
  expression: ts.Expression,
): ts.ArrowFunction | ts.FunctionExpression | undefined {
  let returned: ts.Node = expression;
  while (
    (ts.isParenthesizedExpression(returned.parent) ||
      ts.isAsExpression(returned.parent) ||
      ts.isTypeAssertionExpression(returned.parent) ||
      ts.isNonNullExpression(returned.parent) ||
      ts.isSatisfiesExpression(returned.parent)) &&
    returned.parent.expression === returned
  ) {
    returned = returned.parent;
  }
  let callback: ts.ArrowFunction | ts.FunctionExpression | undefined;
  if (
    (ts.isArrowFunction(returned.parent) || ts.isFunctionExpression(returned.parent)) &&
    returned.parent.body === returned
  ) {
    callback = returned.parent;
  } else if (ts.isReturnStatement(returned.parent) && returned.parent.expression === returned) {
    const block = returned.parent.parent;
    const owner = block.parent;
    if (
      ts.isBlock(block) &&
      block.statements.length === 1 &&
      (ts.isArrowFunction(owner) || ts.isFunctionExpression(owner)) &&
      owner.body === block
    ) {
      callback = owner;
    }
  }
  if (callback === undefined) return undefined;
  let callbackNode: ts.Node = callback;
  while (
    ts.isParenthesizedExpression(callbackNode.parent) &&
    callbackNode.parent.expression === callbackNode
  ) {
    callbackNode = callbackNode.parent;
  }
  const filterCall = callbackNode.parent;
  if (!ts.isCallExpression(filterCall)) return undefined;
  const callee = unwrapPreviewRuntimeExpression(filterCall.expression);
  const methodFilter =
    ts.isPropertyAccessExpression(callee) &&
    callee.questionDotToken === undefined &&
    callee.name.text === 'filter' &&
    filterCall.arguments[0] === callbackNode;
  const utilityFilter =
    ts.isIdentifier(callee) && callee.text === 'filter' && filterCall.arguments[1] === callbackNode;
  return methodFilter || utilityFilter ? callback : undefined;
}

/** Rejects nested functions whose parameter shadows any alias tracked in the outer component. */
export function functionShadowsTrackedAlias(
  scope: PreviewRuntimeFunction,
  aliasNames: ReadonlySet<string>,
): boolean {
  return scope.parameters.some(
    (parameter) => ts.isIdentifier(parameter.name) && aliasNames.has(parameter.name.text),
  );
}
