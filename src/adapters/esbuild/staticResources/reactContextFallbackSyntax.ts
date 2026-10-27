/** Allocates collision-free local fallback bindings and traverses direct lexical scopes. */
import ts from 'typescript';
import type { RuntimeFunction } from './reactContextFallbackModel';

/** Narrows TypeScript function-like nodes to runtime functions analyzed by this adapter. */
export function isRuntimeFunction(node: ts.Node): node is RuntimeFunction {
  return (
    ts.isArrowFunction(node) || ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
  );
}

/** Allocates a collision-free, human-readable binding retained in generated diagnostics. */
export function allocateFallbackBinding(usedBindings: Set<string>): string {
  for (let index = 0; ; index += 1) {
    const candidate = `__reactPreviewContextHookFallback${index.toString()}`;
    if (!usedBindings.has(candidate)) {
      usedBindings.add(candidate);
      return candidate;
    }
  }
}

/** Collects every authored identifier so generated declarations never shadow project code. */
export function collectIdentifierTexts(sourceFile: ts.SourceFile): Set<string> {
  const identifiers = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return identifiers;
}

/** Visits nodes owned by one scope and deliberately stops before nested runtime functions. */
export function visitDirectScopeNodes(
  scope: RuntimeFunction,
  visitor: (node: ts.Node) => void,
): void {
  const visit = (node: ts.Node): void => {
    if (node !== scope && isRuntimeFunction(node)) return;
    if (node !== scope) visitor(node);
    ts.forEachChild(node, visit);
  };
  visit(scope);
}

/** Returns direct nested runtime functions so inherited aliases can be analyzed with shadowing. */
export function collectDirectNestedFunctions(scope: RuntimeFunction): readonly RuntimeFunction[] {
  const functions: RuntimeFunction[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== scope && isRuntimeFunction(node)) {
      functions.push(node);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return functions;
}

/** Removes syntax-only wrappers without evaluating or simplifying application expressions. */
export function unwrapExpression(expression: ts.Expression): ts.Expression {
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
