/**
 * Infers fallback values from direct, property-free uses of one hook-result identifier.
 *
 * Deep property-path inference remains in the main hook analyzer. This focused module handles the
 * complementary cases—calling a returned function, testing a returned flag, applying an authored
 * nullish default, or rendering a returned scalar—without growing that analyzer to the file limit.
 */
import ts from 'typescript';

/** Static expression and user-facing description emitted for one proven direct use. */
export interface PreviewRuntimeHookDirectUsageFallback {
  /** Whether local syntax proves the fallback itself must be callable. */
  readonly callable?: boolean;
  /** Side-effect-free JavaScript expression evaluated only by the Inspector fallback boundary. */
  readonly expression: string;
  /** Concise explanation displayed beside the generated render value. */
  readonly label: string;
}

/** Function-like scope in which one hook result can be consumed during rendering. */
type RuntimeFunction =
  ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression | ts.MethodDeclaration;

/**
 * Infers a scalar/callable fallback when an identifier is used without a property receiver.
 *
 * Direct calls become inert functions, control-flow tests become false, nullish coalescing retains
 * the authored default, and direct JSX children receive recognizable text. The scan stays inside
 * the owning runtime function and ignores nested scopes that shadow the binding name.
 *
 * @param identifier Hook-result binding whose local references provide demand evidence.
 * @returns One bounded fallback, or `undefined` when direct usage proves no safe value kind.
 */
export function createPreviewRuntimeHookDirectUsageFallback(
  identifier: ts.Identifier,
): PreviewRuntimeHookDirectUsageFallback | undefined {
  const owner = findNearestRuntimeFunction(identifier);
  if (owner === undefined) return undefined;
  const usage = {
    called: false,
    conditional: false,
    nullishDefault: false,
    rendered: false,
  };
  const visit = (node: ts.Node): void => {
    if (node !== owner && isRuntimeFunction(node) && functionShadowsName(node, identifier.text)) {
      return;
    }
    if (ts.isIdentifier(node) && node.text === identifier.text && node !== identifier) {
      const parent = unwrapParentNode(node);
      if (ts.isCallExpression(parent) && unwrapExpression(parent.expression) === node) {
        usage.called = true;
      } else if (
        ts.isBinaryExpression(parent) &&
        parent.left === node &&
        parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ) {
        usage.nullishDefault = true;
      } else if (isBooleanTestPosition(node, parent)) {
        usage.conditional = true;
      } else if (ts.isJsxExpression(parent) && parent.expression === node) {
        if (isCallableJsxAttribute(parent.parent)) usage.called = true;
        else if (!ts.isJsxAttribute(parent.parent)) usage.rendered = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  if (usage.called) {
    return {
      callable: true,
      expression: 'Object.freeze(() => undefined)',
      label: 'generated no-op function from local call',
    };
  }
  if (usage.nullishDefault) {
    return { expression: 'undefined', label: 'generated missing value for authored default' };
  }
  if (usage.conditional) {
    return { expression: 'false', label: 'generated boolean from local condition' };
  }
  return usage.rendered
    ? {
        expression: JSON.stringify(createCompactPreviewKey(identifier.text)),
        label: 'generated rendered key text',
      }
    : undefined;
}

/** Bounds a source identifier before exposing it as visible generated component text. */
function createCompactPreviewKey(identifierName: string): string {
  return identifierName.length <= 32 ? identifierName : `${identifierName.slice(0, 31)}…`;
}

/** Treats JSX event/callback props as callable demand rather than rendered string content. */
function isCallableJsxAttribute(node: ts.Node): boolean {
  if (!ts.isJsxAttribute(node) || !ts.isIdentifier(node.name)) return false;
  return /^(?:on[A-Z0-9_$]|render[A-Z0-9_$])/u.test(node.name.text);
}

/** Locates the closest hook-capable runtime function without entering module initialization. */
function findNearestRuntimeFunction(node: ts.Node): RuntimeFunction | undefined {
  let current = node.parent;
  while (!ts.isSourceFile(current)) {
    if (isRuntimeFunction(current)) return current;
    current = current.parent;
  }
  return undefined;
}

/** Narrows TypeScript function-like nodes to runtime functions relevant to hook usage. */
function isRuntimeFunction(node: ts.Node): node is RuntimeFunction {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node)
  );
}

/** Detects a nested function parameter that replaces the analyzed result identifier. */
function functionShadowsName(scope: RuntimeFunction, identifierName: string): boolean {
  return scope.parameters.some((parameter) => bindingContainsName(parameter.name, identifierName));
}

/** Recursively checks one parameter pattern without evaluating its default expressions. */
function bindingContainsName(binding: ts.BindingName, identifierName: string): boolean {
  if (ts.isIdentifier(binding)) return binding.text === identifierName;
  return binding.elements.some(
    (element) =>
      !ts.isOmittedExpression(element) && bindingContainsName(element.name, identifierName),
  );
}

/** Unwraps transparent expression parents before classifying one direct identifier use. */
function unwrapParentNode(node: ts.Expression): ts.Node {
  let current: ts.Node = node;
  while (
    ts.isParenthesizedExpression(current.parent) ||
    ts.isAsExpression(current.parent) ||
    ts.isTypeAssertionExpression(current.parent) ||
    ts.isNonNullExpression(current.parent) ||
    ts.isSatisfiesExpression(current.parent)
  ) {
    current = current.parent;
  }
  return current.parent;
}

/** Removes transparent syntax wrappers from a potential direct call callee. */
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

/** Recognizes syntax positions that consume one direct value only for truthiness. */
function isBooleanTestPosition(expression: ts.Expression, parent: ts.Node): boolean {
  if (
    (ts.isIfStatement(parent) || ts.isWhileStatement(parent) || ts.isDoStatement(parent)) &&
    parent.expression === expression
  ) {
    return true;
  }
  if (ts.isConditionalExpression(parent) && parent.condition === expression) return true;
  if (ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.ExclamationToken) {
    return true;
  }
  return (
    ts.isBinaryExpression(parent) &&
    parent.left === expression &&
    (parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      parent.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  );
}
