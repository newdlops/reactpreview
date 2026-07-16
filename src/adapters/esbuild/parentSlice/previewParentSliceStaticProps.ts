/**
 * Reads inert primitive values from JSX attributes for a parent render slice.
 * The helper never evaluates identifiers, calls, spreads, object literals, or interpolated
 * templates, which keeps reverse component analysis independent from the application's runtime.
 */
import ts from 'typescript';
import type {
  PreviewParentSliceStaticProps,
  PreviewParentSliceStaticValue,
} from './previewParentSliceSource';

const MAX_STATIC_PROPS_PER_ELEMENT = 32;
const MAX_STRING_PROP_LENGTH = 8_192;
const BLOCKED_PROP_NAMES = new Set(['__proto__', 'constructor', 'key', 'prototype', 'ref']);

/**
 * Copies a bounded set of primitive JSX attributes while ignoring executable expressions.
 *
 * @param attributes Parsed JSX attributes belonging to one opening element.
 * @returns A null-prototype record containing only inert primitive values.
 */
export function readPreviewParentSliceStaticProps(
  attributes: ts.JsxAttributes,
): PreviewParentSliceStaticProps {
  const props: Record<string, PreviewParentSliceStaticValue> = Object.create(null) as Record<
    string,
    PreviewParentSliceStaticValue
  >;
  let propCount = 0;

  for (const property of attributes.properties) {
    if (
      !ts.isJsxAttribute(property) ||
      !ts.isIdentifier(property.name) ||
      propCount >= MAX_STATIC_PROPS_PER_ELEMENT
    ) {
      continue;
    }
    const propName = property.name.text;
    if (BLOCKED_PROP_NAMES.has(propName)) {
      continue;
    }
    const value = readStaticJsxValue(property.initializer);
    if (value !== undefined) {
      props[propName] = value;
      propCount += 1;
    }
  }

  return props;
}

/**
 * Reports whether an imported wrapper has attributes the inert slice cannot reproduce exactly.
 * Imported components may use every prop to establish context or state, so dropping one silently
 * could turn a valid provider into a misleading broken wrapper. Intrinsic elements do not require
 * this stricter check because omitted complex DOM props cannot establish application context.
 *
 * @param attributes Parsed attributes belonging to an import-backed JSX wrapper.
 * @returns `true` when a spread, blocked name, or executable/non-primitive value is present.
 */
export function hasUnsafePreviewParentSliceRuntimeAttributes(
  attributes: ts.JsxAttributes,
): boolean {
  return attributes.properties.some((property) => {
    if (!ts.isJsxAttribute(property) || !ts.isIdentifier(property.name)) {
      return true;
    }
    return (
      BLOCKED_PROP_NAMES.has(property.name.text) ||
      readStaticJsxValue(property.initializer) === undefined
    );
  });
}

/**
 * Decodes one JSX initializer when its value is a literal and therefore safe to reproduce.
 *
 * @param initializer Optional initializer following a JSX attribute name.
 * @returns The decoded primitive, or `undefined` when runtime evaluation would be required.
 */
function readStaticJsxValue(
  initializer: ts.JsxAttributeValue | undefined,
): PreviewParentSliceStaticValue | undefined {
  if (initializer === undefined) {
    return true;
  }
  if (ts.isStringLiteral(initializer)) {
    return readBoundedString(initializer.text);
  }
  if (!ts.isJsxExpression(initializer) || initializer.expression === undefined) {
    return undefined;
  }

  const expression = unwrapStaticExpression(initializer.expression);
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return readBoundedString(expression.text);
  }
  if (ts.isNumericLiteral(expression)) {
    return readFiniteNumber(expression.text, false);
  }
  if (expression.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (expression.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }
  if (expression.kind === ts.SyntaxKind.NullKeyword) {
    return null;
  }
  if (
    ts.isPrefixUnaryExpression(expression) &&
    expression.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expression.operand)
  ) {
    return readFiniteNumber(expression.operand.text, true);
  }
  return undefined;
}

/**
 * Removes syntax-only wrappers that cannot add runtime behavior to a primitive expression.
 *
 * @param expression Expression that may be parenthesized or annotated with a TypeScript type.
 * @returns The innermost runtime expression.
 */
function unwrapStaticExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * Rejects oversized authored strings before they can inflate a generated virtual module.
 *
 * @param value Decoded string literal text.
 * @returns The original string when it remains inside the fixed byte-independent character cap.
 */
function readBoundedString(value: string): string | undefined {
  return value.length <= MAX_STRING_PROP_LENGTH ? value : undefined;
}

/**
 * Converts numeric literal text while rejecting infinities and malformed parser recovery values.
 *
 * @param text Numeric token text supplied by TypeScript.
 * @param negative Whether the token appeared below a unary minus operator.
 * @returns A finite JavaScript number, or `undefined` when conversion is unsafe.
 */
function readFiniteNumber(text: string, negative: boolean): number | undefined {
  const unsignedValue = Number(text);
  const value = negative ? -unsignedValue : unsignedValue;
  return Number.isFinite(value) ? value : undefined;
}
