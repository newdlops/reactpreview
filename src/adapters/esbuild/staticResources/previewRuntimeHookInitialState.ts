/** Recovers a bounded JSON-like initial value passed to a custom merge/object state hook. */
import ts from 'typescript';

const MAXIMUM_DEPTH = 8;
const MAXIMUM_NODES = 128;
const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const STATIC_STATE_HOOK_PATTERN = /^use(?:Merge|Merged|Object|Partial)State$/u;

interface StaticValueBudget {
  nodes: number;
}

/**
 * Serializes only literal state or a uniquely declared local const that resolves to literals.
 * Calls, getters, spreads, mutable bindings, and cross-module values are deliberately rejected.
 */
export function readPreviewRuntimeHookInitialStateExpression(
  call: ts.CallExpression,
  hookName: string,
  sourceFile: ts.SourceFile,
): string | undefined {
  if (!STATIC_STATE_HOOK_PATTERN.test(hookName)) return undefined;
  const argument = call.arguments[0];
  if (argument === undefined || ts.isSpreadElement(argument)) return undefined;
  return serializeStaticValue(
    argument,
    collectUniqueConstInitializers(sourceFile),
    new Set(),
    { nodes: 0 },
    0,
  );
}

/** Indexes only unambiguous const identifier declarations from the current module. */
function collectUniqueConstInitializers(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, ts.Expression> {
  const values = new Map<string, ts.Expression>();
  const ambiguous = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const declarationList = node.parent;
      const isConst =
        ts.isVariableDeclarationList(declarationList) &&
        (declarationList.flags & ts.NodeFlags.Const) !== 0;
      if (!isConst || values.has(node.name.text)) {
        values.delete(node.name.text);
        ambiguous.add(node.name.text);
      } else if (!ambiguous.has(node.name.text)) {
        values.set(node.name.text, node.initializer);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return values;
}

/** Converts one safe static value into an independently frozen browser expression. */
function serializeStaticValue(
  expression: ts.Expression,
  values: ReadonlyMap<string, ts.Expression>,
  activeNames: ReadonlySet<string>,
  budget: StaticValueBudget,
  depth: number,
): string | undefined {
  if (depth > MAXIMUM_DEPTH || budget.nodes >= MAXIMUM_NODES) return undefined;
  budget.nodes += 1;
  const value = unwrapExpression(expression);
  if (ts.isIdentifier(value)) {
    if (value.text === 'undefined') return 'undefined';
    if (activeNames.has(value.text)) return undefined;
    const initializer = values.get(value.text);
    return initializer === undefined
      ? undefined
      : serializeStaticValue(
          initializer,
          values,
          new Set([...activeNames, value.text]),
          budget,
          depth + 1,
        );
  }
  if (ts.isStringLiteralLike(value)) return JSON.stringify(value.text);
  if (ts.isNumericLiteral(value)) {
    const number = Number(value.text);
    return Number.isFinite(number) ? String(number) : undefined;
  }
  if (value.kind === ts.SyntaxKind.TrueKeyword) return 'true';
  if (value.kind === ts.SyntaxKind.FalseKeyword) return 'false';
  if (value.kind === ts.SyntaxKind.NullKeyword) return 'null';
  if (
    ts.isPrefixUnaryExpression(value) &&
    (value.operator === ts.SyntaxKind.PlusToken || value.operator === ts.SyntaxKind.MinusToken) &&
    ts.isNumericLiteral(value.operand)
  ) {
    const number = Number(value.getText(value.getSourceFile()));
    return Number.isFinite(number) ? String(number) : undefined;
  }
  if (ts.isArrayLiteralExpression(value)) {
    const elements: string[] = [];
    for (const element of value.elements) {
      if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) return undefined;
      const child = serializeStaticValue(element, values, activeNames, budget, depth + 1);
      if (child === undefined) return undefined;
      elements.push(child);
    }
    return `Object.freeze([${elements.join(', ')}])`;
  }
  if (ts.isObjectLiteralExpression(value)) {
    const properties: string[] = [];
    for (const property of value.properties) {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
        return undefined;
      }
      const propertyName = readStaticPropertyName(property.name);
      if (propertyName === undefined || BLOCKED_PROPERTY_NAMES.has(propertyName)) return undefined;
      const initializer = ts.isPropertyAssignment(property) ? property.initializer : property.name;
      const child = serializeStaticValue(initializer, values, activeNames, budget, depth + 1);
      if (child === undefined) return undefined;
      properties.push(`${JSON.stringify(propertyName)}: ${child}`);
    }
    return `Object.freeze({${properties.length === 0 ? '' : ` ${properties.join(', ')} `}})`;
  }
  return undefined;
}

/** Reads a non-computed identifier, string, or numeric object key. */
function readStaticPropertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

/** Removes syntax-only wrappers without evaluating the authored expression. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
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
  return current;
}
