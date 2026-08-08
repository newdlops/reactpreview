/**
 * Reads bounded property chains rooted at one locally bound runtime-hook result.
 *
 * Keeping this syntax helper separate prevents the hook instrumentation coordinator from owning
 * collection vocabulary and AST traversal details. The helper never resolves symbols or evaluates
 * computed keys; callers can still retain the last statically named receiver before such a key.
 */
import ts from 'typescript';
import { PREVIEW_STRING_ONLY_METHOD_NAMES } from '../previewStringMethodNames';
import { unwrapPreviewRuntimeExpression } from './previewRuntimeHookSyntax';

const ARRAY_USAGE_PROPERTIES = new Set([
  '[]',
  'at',
  'every',
  'filter',
  'find',
  'findIndex',
  'flatMap',
  'forEach',
  'length',
  'map',
  'reduce',
  'some',
]);
const STRING_USAGE_PROPERTIES = new Set<string>(PREVIEW_STRING_ONLY_METHOD_NAMES);

/** One statically named property chain and whether any receiver used optional access. */
export interface PreviewRuntimeHookPropertyUsage {
  /** Element type proven by a surrounding `T[]`, tuple, or standard Array annotation. */
  readonly collectionItemType?: ts.TypeNode;
  /** Property names ordered from the hook-bound identifier toward the reached leaf. */
  readonly names: readonly string[];
  /** True when the authored chain may short-circuit before reaching its final leaf. */
  readonly optional: boolean;
}

/** One literal Array index with item-relative property demand on a hook-bound value. */
export interface PreviewRuntimeHookLiteralElementUsage {
  /** Whether the final item property is immediately called. */
  readonly itemCalled: boolean;
  /** Statically named path below the indexed item. */
  readonly itemNames: readonly string[];
  /** Scalar item expression proven by a direct template or React-child sink. */
  readonly itemValueExpression?: string;
  /** Property path from the hook-bound identifier to the indexed Array receiver. */
  readonly receiverNames: readonly string[];
}

/** Reads one property path without following calls, imports, or computed element keys. */
export function readPreviewRuntimeHookPropertyUsage(
  expression: ts.PropertyAccessExpression,
  identifierName: string,
): PreviewRuntimeHookPropertyUsage | undefined {
  const names: string[] = [];
  let optional = false;
  let current: ts.Expression = expression;
  while (ts.isPropertyAccessExpression(current)) {
    optional = optional || current.questionDotToken !== undefined;
    names.unshift(current.name.text);
    current = unwrapPreviewRuntimeExpression(current.expression);
  }
  if (!ts.isIdentifier(current) || current.text !== identifierName) return undefined;
  const arrayContext = readPreviewRuntimeHookArrayValueContext(expression);
  if (arrayContext?.array === true) names.push('[]');
  return {
    ...(arrayContext?.itemType === undefined ? {} : { collectionItemType: arrayContext.itemType }),
    names,
    optional,
  };
}

/** Reads `value.rows[0].field` as an Array receiver plus one item-relative field path. */
export function readPreviewRuntimeHookLiteralElementUsage(
  expression: ts.ElementAccessExpression,
  identifierName: string,
): PreviewRuntimeHookLiteralElementUsage | undefined {
  if (expression.questionDotToken !== undefined || !isSafeArrayIndex(expression.argumentExpression)) {
    return undefined;
  }
  const receiverNames: string[] = [];
  let receiver = unwrapPreviewRuntimeExpression(expression.expression);
  while (ts.isPropertyAccessExpression(receiver)) {
    if (receiver.questionDotToken !== undefined) return undefined;
    receiverNames.unshift(receiver.name.text);
    receiver = unwrapPreviewRuntimeExpression(receiver.expression);
  }
  if (!ts.isIdentifier(receiver) || receiver.text !== identifierName) {
    return undefined;
  }
  const itemNames: string[] = [];
  let current: ts.Expression = expression;
  while (
    ts.isPropertyAccessExpression(current.parent) &&
    current.parent.expression === current
  ) {
    if (current.parent.questionDotToken !== undefined) return undefined;
    itemNames.push(current.parent.name.text);
    current = current.parent;
  }
  const itemValueExpression =
    itemNames.length === 0 ? readPreviewRuntimeHookLiteralElementScalarExpression(current) : undefined;
  if (itemNames.length === 0 && itemValueExpression === undefined) return undefined;
  return {
    itemCalled: ts.isCallExpression(current.parent) && current.parent.expression === current,
    itemNames: Object.freeze(itemNames),
    ...(itemValueExpression === undefined ? {} : { itemValueExpression }),
    receiverNames: Object.freeze(receiverNames),
  };
}

/** Uses zero as the smallest scalar accepted by interpolation and ordinary React child rendering. */
function readPreviewRuntimeHookLiteralElementScalarExpression(
  expression: ts.Expression,
): string | undefined {
  let current = expression;
  while (
    (ts.isParenthesizedExpression(current.parent) ||
      ts.isAsExpression(current.parent) ||
      ts.isTypeAssertionExpression(current.parent) ||
      ts.isNonNullExpression(current.parent) ||
      ts.isSatisfiesExpression(current.parent)) &&
    current.parent.expression === current
  ) {
    current = current.parent;
  }
  const parent = current.parent;
  if (ts.isTemplateSpan(parent) && parent.expression === current) return '0';
  if (
    ts.isJsxExpression(parent) &&
    (!ts.isJsxAttribute(parent.parent) ||
      (ts.isIdentifier(parent.parent.name) && parent.parent.name.text === 'children'))
  ) return '0';
  return undefined;
}

/** Admits only a bounded non-negative integer literal as static Array-index evidence. */
function isSafeArrayIndex(argument: ts.Expression | undefined): boolean {
  if (argument === undefined) return false;
  const value = unwrapPreviewRuntimeExpression(argument);
  const text =
    ts.isNumericLiteral(value) || ts.isStringLiteralLike(value) ? value.text : undefined;
  if (text === undefined || !/^(?:0|[1-9]\d{0,5})$/u.test(text)) return false;
  const index = Number(text);
  return Number.isSafeInteger(index) && index >= 0;
}

/** Reports whether a named terminal property proves an Array-style receiver in preview code. */
export function isPreviewRuntimeHookArrayUsageProperty(propertyName: string | undefined): boolean {
  return propertyName !== undefined && ARRAY_USAGE_PROPERTIES.has(propertyName);
}

/** Reports whether a called terminal property unambiguously proves a String receiver. */
export function isPreviewRuntimeHookStringUsageProperty(propertyName: string | undefined): boolean {
  return propertyName !== undefined && STRING_USAGE_PROPERTIES.has(propertyName);
}

/**
 * Decides whether an optional nested failure shape may enter a synthesized containing object.
 * Remote-data carrier fields need their collection receivers after a swallowed hook failure;
 * ordinary optional Context children remain absent so the authored short circuit keeps its meaning.
 */
export function shouldMaterializePreviewRuntimeHookNestedFallback(
  fallback:
    | {
        readonly preserveNullish?: boolean;
        readonly requiredPaths?: readonly string[];
      }
    | undefined,
  propertyName: string,
): boolean {
  if (fallback === undefined) return false;
  if (fallback.preserveNullish !== true || (fallback.requiredPaths?.length ?? 0) > 0) return true;
  return /^(?:data|payload|response|result)$/iu.test(propertyName);
}

/**
 * Detects an authored array contract around a hook-owned property without resolving project types.
 *
 * A query field is often selected into `(data?.items ?? []) as Item[]` before being passed to a
 * helper in another module. The helper's `flatMap` is outside this parser tree, but the empty-array
 * alternative and the explicit array annotation already prove the selected value's container kind.
 * Only syntax-transparent wrappers and value-choice operators are followed, so an unrelated array
 * elsewhere in the enclosing callback cannot affect this property.
 */
function readPreviewRuntimeHookArrayValueContext(
  expression: ts.Expression,
): { readonly array: true; readonly itemType?: ts.TypeNode } | undefined {
  let current: ts.Expression = expression;
  let arrayProven = false;
  for (;;) {
    const parent = current.parent;
    if (
      (ts.isParenthesizedExpression(parent) || ts.isNonNullExpression(parent)) &&
      parent.expression === current
    ) {
      current = parent;
      continue;
    }
    if (
      (ts.isAsExpression(parent) ||
        ts.isTypeAssertionExpression(parent) ||
        ts.isSatisfiesExpression(parent)) &&
      parent.expression === current
    ) {
      const itemType = readPreviewRuntimeHookArrayItemType(parent.type);
      if (itemType !== undefined) return { array: true, itemType };
      current = parent;
      continue;
    }
    if (
      ts.isBinaryExpression(parent) &&
      (parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        parent.operatorToken.kind === ts.SyntaxKind.BarBarToken) &&
      (parent.left === current || parent.right === current)
    ) {
      const alternative = parent.left === current ? parent.right : parent.left;
      if (ts.isArrayLiteralExpression(unwrapPreviewRuntimeExpression(alternative))) {
        arrayProven = true;
      }
      current = parent;
      continue;
    }
    if (
      ts.isVariableDeclaration(parent) &&
      parent.initializer === current &&
      parent.type !== undefined
    ) {
      const itemType = readPreviewRuntimeHookArrayItemType(parent.type);
      return itemType === undefined
        ? arrayProven
          ? { array: true }
          : undefined
        : { array: true, itemType };
    }
    return arrayProven ? { array: true } : undefined;
  }
}

/** Reads the element type from bounded syntax forms that directly declare an Array-compatible value. */
function readPreviewRuntimeHookArrayItemType(typeNode: ts.TypeNode): ts.TypeNode | undefined {
  if (ts.isArrayTypeNode(typeNode)) return typeNode.elementType;
  if (ts.isTupleTypeNode(typeNode)) {
    return typeNode.elements.find((element) => !ts.isOptionalTypeNode(element));
  }
  if (
    ts.isTypeReferenceNode(typeNode) &&
    ts.isIdentifier(typeNode.typeName) &&
    (typeNode.typeName.text === 'Array' || typeNode.typeName.text === 'ReadonlyArray')
  ) {
    return typeNode.typeArguments?.[0];
  }
  return undefined;
}
