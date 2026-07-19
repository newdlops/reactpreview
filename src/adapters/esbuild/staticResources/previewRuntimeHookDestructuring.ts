/**
 * Extracts object-property demand from aliases destructured after a runtime hook call.
 *
 * The primary hook analyzer already understands direct reads such as `result.company.name`, but
 * application code frequently stores a hook result and destructures it later. This syntax-only
 * adapter converts that later object pattern into the same bounded property paths without loading
 * types, evaluating defaults, or following computed/prototype-sensitive keys.
 */
import ts from 'typescript';

const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DESTRUCTURED_PATH_DEPTH = 12;

/**
 * Reads paths from a declaration whose initializer is the requested hook-result identifier.
 *
 * Aliases with defaults, rest elements, array bindings, and computed names are omitted because their
 * runtime semantics cannot be represented by a deterministic plain fallback. An empty result means
 * the declaration contributes no safe evidence; it never invalidates evidence found elsewhere.
 */
export function readPreviewRuntimeHookDestructuredPaths(
  declaration: ts.VariableDeclaration,
  identifierName: string,
): readonly (readonly string[])[] {
  const initializer = declaration.initializer;
  if (
    initializer === undefined ||
    !ts.isObjectBindingPattern(declaration.name) ||
    !isExactIdentifier(initializer, identifierName)
  ) {
    return [];
  }
  const paths: string[][] = [];
  appendObjectBindingPaths(declaration.name, [], paths);
  return paths;
}

/** Recursively emits leaf paths from one supported object binding under strict depth bounds. */
function appendObjectBindingPaths(
  pattern: ts.ObjectBindingPattern,
  prefix: readonly string[],
  destination: string[][],
): void {
  if (prefix.length >= MAX_DESTRUCTURED_PATH_DEPTH) return;
  for (const element of pattern.elements) {
    if (element.dotDotDotToken !== undefined || element.initializer !== undefined) continue;
    const propertyName = readStaticBindingPropertyName(element);
    if (propertyName === undefined) continue;
    const path = [...prefix, propertyName];
    if (ts.isObjectBindingPattern(element.name)) {
      appendObjectBindingPaths(element.name, path, destination);
    } else if (ts.isIdentifier(element.name)) {
      destination.push(path);
    }
  }
}

/** Reads a safe authored key while allowing ordinary renamed bindings such as `{ name: title }`. */
function readStaticBindingPropertyName(element: ts.BindingElement): string | undefined {
  const property = element.propertyName;
  const name =
    property === undefined && ts.isIdentifier(element.name)
      ? element.name.text
      : property !== undefined && (ts.isIdentifier(property) || ts.isStringLiteral(property))
        ? property.text
        : undefined;
  return name !== undefined && name.length <= 128 && !BLOCKED_PROPERTY_NAMES.has(name)
    ? name
    : undefined;
}

/** Unwraps syntax-only wrappers before comparing one initializer with the hook-result local. */
function isExactIdentifier(expression: ts.Expression, identifierName: string): boolean {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return ts.isIdentifier(current) && current.text === identifierName;
}
