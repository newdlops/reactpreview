/** Reads prop paths and lexical bindings without running project code. */
import path from 'node:path';
import ts from 'typescript';
import {
  BLOCKED_PROPERTY_NAMES,
  CLASS_COMPONENT_PROPS_ALIAS,
  type ExportedFunctionLike,
  type InferenceState,
  type PreviewInferredPropKind,
  type PropPathBinding,
} from './reactPropInferenceModel';

/**
 * Reads `'REQUESTED' | 'IN_TRANSIT' | 'DELIVERED'` (or numeric literals) in declaration order.
 * Mixed kinds, open members (`'a' | string`), and non-literal members are not a closed value set.
 */
export function readLiteralUnionValues(
  members: readonly ts.TypeNode[],
): readonly string[] | readonly number[] | undefined {
  const values = members.map((member) => {
    const unwrapped = ts.isParenthesizedTypeNode(member) ? member.type : member;
    return ts.isLiteralTypeNode(unwrapped) ? readLiteralValue(unwrapped.literal) : undefined;
  });
  if (values.every((value): value is string => typeof value === 'string')) return values;
  if (values.every((value): value is number => typeof value === 'number')) return values;
  return undefined;
}

/** Narrows the three serializable switch-literal categories to inference shape kinds. */
export function readPrimitiveValueKind(value: boolean | number | string): PreviewInferredPropKind {
  if (typeof value === 'boolean') return 'boolean';
  return typeof value === 'number' ? 'number' : 'string';
}

/** Reads an access chain rooted in a known prop or local alias without invoking computed values. */
export function readPropPath(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, PropPathBinding>,
): readonly string[] | undefined {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return aliases.get(current.text)?.path;
  if (ts.isPropertyAccessExpression(current)) {
    if (
      current.name.text === 'props' &&
      unwrapExpression(current.expression).kind === ts.SyntaxKind.ThisKeyword
    ) {
      return aliases.get(CLASS_COMPONENT_PROPS_ALIAS)?.path;
    }
    const parentPath = readPropPath(current.expression, aliases);
    return parentPath === undefined || BLOCKED_PROPERTY_NAMES.has(current.name.text)
      ? undefined
      : [...parentPath, current.name.text];
  }
  if (ts.isElementAccessExpression(current)) {
    const propertyName = readElementPropertyName(current.argumentExpression);
    if (
      propertyName === 'props' &&
      unwrapExpression(current.expression).kind === ts.SyntaxKind.ThisKeyword
    ) {
      return aliases.get(CLASS_COMPONENT_PROPS_ALIAS)?.path;
    }
    const parentPath = readPropPath(current.expression, aliases);
    return parentPath === undefined ||
      propertyName === undefined ||
      BLOCKED_PROPERTY_NAMES.has(propertyName)
      ? undefined
      : [...parentPath, propertyName];
  }
  return undefined;
}

/** Rejects a root identifier shadowed between its access and the exported component function. */
export function isShadowedPathRoot(node: ts.Expression, state: InferenceState): boolean {
  let root: ts.Expression = node;
  while (isAccessExpression(root)) root = unwrapExpression(root.expression);
  return ts.isIdentifier(root) ? isShadowedIdentifier(root, root.text, state.functionLike) : false;
}

/** Detects nested function parameters that replace a component prop/alias identity. */
export function isShadowedIdentifier(
  identifier: ts.Identifier,
  name: string,
  functionLike: ExportedFunctionLike,
): boolean {
  let current: ts.Node = identifier.parent;
  while (current !== functionLike && !ts.isSourceFile(current)) {
    if (isFunctionLike(current) && current !== functionLike) {
      if (current.parameters.some((parameter) => bindingContainsName(parameter.name, name))) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

/** Keeps eager container materialization within the selected component's own render scope. */
export function isInsideNestedFunction(node: ts.Node, functionLike: ExportedFunctionLike): boolean {
  let current = node.parent;
  while (current !== functionLike && !ts.isSourceFile(current)) {
    if (isFunctionLike(current)) return true;
    current = current.parent;
  }
  return current !== functionLike;
}

/** Unwraps syntax-only assertions while retaining runtime access structure. */
export function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  )
    current = current.expression;
  return current;
}

/** Reports property/element access expressions handled by the path reader. */
export function isAccessExpression(
  node: ts.Node,
): node is ts.PropertyAccessExpression | ts.ElementAccessExpression {
  return ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
}

/** Keeps only the outermost access chain so each operation is interpreted exactly once. */
export function isNestedAccessReceiver(node: ts.Expression): boolean {
  const parent = node.parent;
  return isAccessExpression(parent) && parent.expression === node;
}

/** Reports whether an identifier already belongs to an access chain visited at its outer node. */
export function isIdentifierPartOfAccess(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  return (
    (ts.isPropertyAccessExpression(parent) &&
      (parent.expression === identifier || parent.name === identifier)) ||
    (ts.isElementAccessExpression(parent) && parent.expression === identifier)
  );
}

/** Excludes declaration/binding positions from bare identifier operation inference. */
export function isDeclarationName(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  return (
    (ts.isBindingElement(parent) && parent.name === identifier) ||
    (ts.isParameter(parent) && parent.name === identifier) ||
    (ts.isVariableDeclaration(parent) && parent.name === identifier) ||
    (ts.isPropertyAssignment(parent) && parent.name === identifier)
  );
}

/** Narrows ordinary nested function scopes used by shadow checks. */
export function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node)
  );
}

/** Recursively checks a binding pattern for one shadowing local name. */
export function bindingContainsName(binding: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(binding)) return binding.text === name;
  return binding.elements.some(
    (element) => !ts.isOmittedExpression(element) && bindingContainsName(element.name, name),
  );
}

/** Reads an external property name from shorthand, renamed, or nested binding syntax. */
export function readBindingPropertyName(element: ts.BindingElement): string | undefined {
  if (element.propertyName !== undefined) return readPropertyName(element.propertyName);
  return ts.isIdentifier(element.name) ? element.name.text : undefined;
}

/** Reads a safe static property name without evaluating a computed expression. */
export function readPropertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

/** Reads a static element-access name accepted by object shape serialization. */
export function readElementPropertyName(expression: ts.Expression | undefined): string | undefined {
  return expression !== undefined &&
    (ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression))
    ? expression.text
    : undefined;
}

/** Reads primitive literal types while excluding bigint and expression-based values. */
export function readLiteralValue(
  literal: ts.LiteralTypeNode['literal'],
): boolean | number | string | undefined {
  if (ts.isStringLiteralLike(literal)) return literal.text;
  if (ts.isNumericLiteral(literal)) return Number(literal.text);
  if (literal.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (literal.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

/** Reports a direct export modifier without relying on TypeScript-internal node flags. */
export function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
        false)
    : false;
}

/** Reports a default modifier paired with an exported declaration. */
export function hasDefaultModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ??
        false)
    : false;
}

/** Rejects parser recovery so generated paths never reflect malformed syntax. */
export function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return (diagnostics?.length ?? 0) > 0;
}

/** Selects the JSX-aware parser grammar from one supported source suffix. */
export function readScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.ts' || extension === '.mts' || extension === '.cts') return ts.ScriptKind.TS;
  return extension === '.jsx' ? ts.ScriptKind.JSX : ts.ScriptKind.JS;
}
