/**
 * Resolves a deliberately small subset of local functions that synchronously return React JSX.
 *
 * Render helpers such as `const renderBody = () => <Body />` are ordinary JavaScript calls, so a
 * JSX-only tree walk cannot see their output. This module follows only immutable, zero-argument,
 * synchronous helpers with a concise body or one `return` statement. It never executes workspace
 * code, resolves imports, invents arguments, or crosses a statement that could perform side effects.
 */
import ts from 'typescript';
import { readPreviewRenderFunctionReturnExpression } from './previewReactRenderOutcomeComponents';
import {
  isPreviewEmptyRenderExpression,
  isPreviewRenderFunction,
  unwrapPreviewRenderExpression,
} from './previewReactRenderOutcomeSyntax';
import type { PreviewRenderFunction } from './previewReactRenderOutcomeSyntax';

/** Same-module declaration evidence shared by export/HOC and local render-call traversal. */
export interface PreviewLocalRenderBinding {
  /** Initializer retained as syntax only; arbitrary expressions are never evaluated. */
  readonly expression?: ts.Expression;
  /** Function declaration retained without converting it into executable JavaScript. */
  readonly functionLike?: PreviewRenderFunction;
  /** Only immutable bindings may be invoked as local render helpers. */
  readonly immutable: boolean;
}

/** Successfully proven helper return plus every alias consumed while reaching it. */
export interface PreviewResolvedLocalRenderCall {
  readonly expression: ts.Expression;
  readonly kind: 'resolved';
  readonly visitedBindings: ReadonlySet<string>;
}

/** Fail-closed result distinguishes an exhausted budget from ordinary unsupported syntax. */
export type PreviewLocalRenderCallResolution =
  PreviewResolvedLocalRenderCall | { readonly kind: 'bounded' | 'unsupported' };

/** Internal validation result used while following helper-to-helper return chains. */
type SafeExpressionResult = { readonly kind: 'bounded' } | { readonly kind: 'safe' | 'unsafe' };

/** Collects module declarations while retaining mutability evidence for conservative call handling. */
export function collectPreviewModuleRenderBindings(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, PreviewLocalRenderBinding> {
  const bindings = new Map<string, PreviewLocalRenderBinding>();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      bindings.set(statement.name.text, { functionLike: statement, immutable: true });
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    const immutable = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined) {
        bindings.set(declaration.name.text, {
          expression: declaration.initializer,
          immutable,
        });
      }
    }
  }
  return bindings;
}

/**
 * Adds direct component-body helpers without leaking declarations from nested callbacks or blocks.
 *
 * A flat recursive declaration scan would conflate shadowed names from event handlers and branches.
 * Direct statements are the only declarations in the selected component's lexical scope that can be
 * followed without a scope graph. `const` aliases and function declarations are admitted; `let` and
 * `var` remain available to ordinary runtime code but cannot become syntax-proven render helpers.
 */
export function collectPreviewComponentRenderBindings(
  component: PreviewRenderFunction,
  inherited: ReadonlyMap<string, PreviewLocalRenderBinding>,
): ReadonlyMap<string, PreviewLocalRenderBinding> {
  if (component.body === undefined || !ts.isBlock(component.body)) return inherited;
  const bindings = new Map(inherited);
  for (const parameter of component.parameters) {
    shadowPreviewLocalBindingName(parameter.name, bindings);
  }
  for (const statement of component.body.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      bindings.set(statement.name.text, { functionLike: statement, immutable: true });
      continue;
    }
    if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
      bindings.set(statement.name.text, { immutable: false });
      continue;
    }
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    const immutable = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) {
        bindings.set(declaration.name.text, {
          ...(declaration.initializer === undefined ? {} : { expression: declaration.initializer }),
          immutable,
        });
      } else {
        shadowPreviewLocalBindingName(declaration.name, bindings);
      }
    }
  }
  return bindings;
}

/** Marks every identifier introduced by an unsupported binding pattern as a lexical shadow. */
function shadowPreviewLocalBindingName(
  name: ts.BindingName,
  bindings: Map<string, PreviewLocalRenderBinding>,
): void {
  if (ts.isIdentifier(name)) {
    bindings.set(name.text, { immutable: false });
    return;
  }
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    shadowPreviewLocalBindingName(element.name, bindings);
  }
}

/**
 * Resolves one direct local call without executing it or guessing an argument contract.
 *
 * Optional calls, member calls, imported functions, async/generator functions, parameters, and
 * multi-statement bodies all remain unknown. A bounded validation pass also rejects concise comma or
 * call expressions that could run effects before producing JSX.
 */
export function readPreviewSafeLocalRenderCall(
  call: ts.CallExpression,
  bindings: ReadonlyMap<string, PreviewLocalRenderBinding>,
  visitedBindings: ReadonlySet<string>,
  depth: number,
  maximumDepth: number,
): PreviewLocalRenderCallResolution {
  if (depth > maximumDepth) return { kind: 'bounded' };
  if (call.arguments.length !== 0 || call.questionDotToken !== undefined) {
    return { kind: 'unsupported' };
  }
  const resolved = resolvePreviewLocalRenderFunction(
    call.expression,
    bindings,
    visitedBindings,
    depth,
    maximumDepth,
  );
  if (resolved.kind !== 'resolved') return resolved;
  if (!isSafePreviewLocalRenderFunction(resolved.functionLike)) return { kind: 'unsupported' };
  const expression = readPreviewRenderFunctionReturnExpression(resolved.functionLike);
  if (expression === undefined) return { kind: 'unsupported' };
  const validation = validatePreviewLocalRenderExpression(
    expression,
    bindings,
    resolved.visitedBindings,
    depth + 1,
    maximumDepth,
  );
  if (validation.kind !== 'safe')
    return validation.kind === 'bounded' ? validation : { kind: 'unsupported' };
  return {
    expression,
    kind: 'resolved',
    visitedBindings: resolved.visitedBindings,
  };
}

/** Function resolution follows only immutable identifier aliases under the shared depth budget. */
function resolvePreviewLocalRenderFunction(
  expression_: ts.Expression,
  bindings: ReadonlyMap<string, PreviewLocalRenderBinding>,
  visitedBindings: ReadonlySet<string>,
  depth: number,
  maximumDepth: number,
):
  | {
      readonly functionLike: PreviewRenderFunction;
      readonly kind: 'resolved';
      readonly visitedBindings: ReadonlySet<string>;
    }
  | { readonly kind: 'bounded' | 'unsupported' } {
  if (depth > maximumDepth) return { kind: 'bounded' };
  const expression = unwrapPreviewRenderExpression(expression_);
  if (!ts.isIdentifier(expression) || visitedBindings.has(expression.text)) {
    return { kind: 'unsupported' };
  }
  const binding = bindings.get(expression.text);
  if (binding?.immutable !== true) return { kind: 'unsupported' };
  const nextVisited = new Set(visitedBindings);
  nextVisited.add(expression.text);
  if (binding.functionLike !== undefined) {
    return { functionLike: binding.functionLike, kind: 'resolved', visitedBindings: nextVisited };
  }
  if (binding.expression === undefined) return { kind: 'unsupported' };
  const value = unwrapPreviewRenderExpression(binding.expression);
  if (isPreviewRenderFunction(value)) {
    return { functionLike: value, kind: 'resolved', visitedBindings: nextVisited };
  }
  if (!ts.isIdentifier(value)) return { kind: 'unsupported' };
  return resolvePreviewLocalRenderFunction(value, bindings, nextVisited, depth + 1, maximumDepth);
}

/** Rejects every callable shape that can suspend, yield, consume arguments, or execute statements. */
function isSafePreviewLocalRenderFunction(functionLike: PreviewRenderFunction): boolean {
  if (functionLike.parameters.length !== 0) return false;
  const asyncFunction =
    ts.canHaveModifiers(functionLike) &&
    ts.getModifiers(functionLike)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword);
  if (asyncFunction) return false;
  if (
    (ts.isFunctionDeclaration(functionLike) || ts.isFunctionExpression(functionLike)) &&
    functionLike.asteriskToken !== undefined
  ) {
    return false;
  }
  const body = functionLike.body;
  if (body === undefined || !ts.isBlock(body)) return body !== undefined;
  const statement = body.statements[0];
  return body.statements.length === 1 && statement !== undefined && ts.isReturnStatement(statement);
}

/** Validates render-only return syntax and recursively proves nested zero-argument local helpers. */
function validatePreviewLocalRenderExpression(
  expression_: ts.Expression,
  bindings: ReadonlyMap<string, PreviewLocalRenderBinding>,
  visitedBindings: ReadonlySet<string>,
  depth: number,
  maximumDepth: number,
): SafeExpressionResult {
  if (depth > maximumDepth) return { kind: 'bounded' };
  const expression = unwrapPreviewRenderExpression(expression_);
  if (
    ts.isJsxElement(expression) ||
    ts.isJsxSelfClosingElement(expression) ||
    ts.isJsxFragment(expression) ||
    isPreviewEmptyRenderExpression(expression)
  ) {
    return { kind: 'safe' };
  }
  if (ts.isConditionalExpression(expression)) {
    if (!isPreviewSideEffectFreeGuard(expression.condition, depth + 1, maximumDepth)) {
      return { kind: 'unsafe' };
    }
    return mergePreviewSafeExpressionResults(
      validatePreviewLocalRenderExpression(
        expression.whenTrue,
        bindings,
        visitedBindings,
        depth + 1,
        maximumDepth,
      ),
      validatePreviewLocalRenderExpression(
        expression.whenFalse,
        bindings,
        visitedBindings,
        depth + 1,
        maximumDepth,
      ),
    );
  }
  if (
    ts.isBinaryExpression(expression) &&
    [
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
    ].includes(expression.operatorToken.kind)
  ) {
    if (!isPreviewSideEffectFreeGuard(expression.left, depth + 1, maximumDepth)) {
      return { kind: 'unsafe' };
    }
    return validatePreviewLocalRenderExpression(
      expression.right,
      bindings,
      visitedBindings,
      depth + 1,
      maximumDepth,
    );
  }
  if (ts.isArrayLiteralExpression(expression)) {
    let result: SafeExpressionResult = { kind: 'safe' };
    for (const element of expression.elements) {
      if (ts.isSpreadElement(element)) return { kind: 'unsafe' };
      result = mergePreviewSafeExpressionResults(
        result,
        validatePreviewLocalRenderExpression(
          element,
          bindings,
          visitedBindings,
          depth + 1,
          maximumDepth,
        ),
      );
      if (result.kind !== 'safe') return result;
    }
    return result;
  }
  if (ts.isIdentifier(expression)) {
    if (visitedBindings.has(expression.text)) return { kind: 'unsafe' };
    const binding = bindings.get(expression.text);
    if (binding?.immutable !== true || binding.expression === undefined) return { kind: 'unsafe' };
    const nextVisited = new Set(visitedBindings);
    nextVisited.add(expression.text);
    return validatePreviewLocalRenderExpression(
      binding.expression,
      bindings,
      nextVisited,
      depth + 1,
      maximumDepth,
    );
  }
  if (ts.isCallExpression(expression)) {
    const nested = readPreviewSafeLocalRenderCall(
      expression,
      bindings,
      visitedBindings,
      depth + 1,
      maximumDepth,
    );
    return nested.kind === 'resolved'
      ? { kind: 'safe' }
      : nested.kind === 'bounded'
        ? { kind: 'bounded' }
        : { kind: 'unsafe' };
  }
  return { kind: 'unsafe' };
}

/** Preserves bounded failures while requiring every possible branch to be render-only. */
function mergePreviewSafeExpressionResults(
  left: SafeExpressionResult,
  right: SafeExpressionResult,
): SafeExpressionResult {
  if (left.kind === 'bounded' || right.kind === 'bounded') return { kind: 'bounded' };
  return left.kind === 'safe' && right.kind === 'safe' ? { kind: 'safe' } : { kind: 'unsafe' };
}

/** Conservative expression purity check for conditions that select one local JSX return branch. */
function isPreviewSideEffectFreeGuard(
  expression_: ts.Expression,
  depth: number,
  maximumDepth: number,
): boolean {
  if (depth > maximumDepth) return false;
  const expression = unwrapPreviewRenderExpression(expression_);
  if (
    ts.isIdentifier(expression) ||
    ts.isLiteralExpression(expression) ||
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    expression.kind === ts.SyntaxKind.NullKeyword ||
    expression.kind === ts.SyntaxKind.ThisKeyword
  ) {
    return true;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return isPreviewSideEffectFreeGuard(expression.expression, depth + 1, maximumDepth);
  }
  if (ts.isElementAccessExpression(expression)) {
    return (
      isPreviewSideEffectFreeGuard(expression.expression, depth + 1, maximumDepth) &&
      isPreviewSideEffectFreeGuard(expression.argumentExpression, depth + 1, maximumDepth)
    );
  }
  if (ts.isPrefixUnaryExpression(expression)) {
    return isPreviewSideEffectFreeGuard(expression.operand, depth + 1, maximumDepth);
  }
  if (ts.isBinaryExpression(expression)) {
    const operator = expression.operatorToken.kind;
    if (
      operator === ts.SyntaxKind.CommaToken ||
      (operator >= ts.SyntaxKind.FirstAssignment && operator <= ts.SyntaxKind.LastAssignment)
    ) {
      return false;
    }
    return (
      isPreviewSideEffectFreeGuard(expression.left, depth + 1, maximumDepth) &&
      isPreviewSideEffectFreeGuard(expression.right, depth + 1, maximumDepth)
    );
  }
  return false;
}
