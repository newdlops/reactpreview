/**
 * Provides bounded JSX-component discovery for the syntax-only render-outcome analyzer.
 *
 * JSX children and JSX-valued props are render evidence, while ordinary scalar props are not.
 * Keeping that distinction here prevents styling expressions such as `color={error ? ...}` from
 * multiplying page outcomes. Every fallback AST walk also uses explicit depth and node budgets so
 * generated expressions cannot monopolize the extension host or overflow its JavaScript stack.
 */
import ts from 'typescript';
import type { PreviewReactRenderComponentNode } from './previewReactRenderOutcomeTypes';
import {
  isPreviewComponentName,
  isPreviewRenderFunction,
  readPreviewRenderLocation,
  unwrapPreviewRenderExpression,
} from './previewReactRenderOutcomeSyntax';

const MAX_RENDERABILITY_DEPTH = 16;
const MAX_STATIC_COMPONENT_DEPTH = 32;
const MAX_STATIC_COMPONENT_VISITS = 512;

/** Minimal same-module binding evidence needed to recognize JSX aliases and render callbacks. */
export interface PreviewReactRenderLocalBindingEvidence {
  readonly expression?: ts.Expression;
  readonly functionLike?: ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression;
}

/** One JSX child or proven render-valued attribute ready for branch expansion. */
export interface PreviewReactNestedRenderExpression {
  /** Whether a bare PascalCase/member value denotes a component passed through a render slot. */
  readonly allowComponentReference: boolean;
  /** Authored expression whose JSX branches should be analyzed. */
  readonly expression: ts.Expression;
}

/** Nested-expression collection plus a signal that a caller-provided scan budget was exhausted. */
export interface PreviewReactNestedRenderExpressionCollection {
  readonly expressions: readonly PreviewReactNestedRenderExpression[];
  readonly truncated: boolean;
}

/** Bounded fallback component discovery plus an explicit signal that evidence was pruned. */
export interface PreviewStaticComponentForestResult {
  readonly componentTree: readonly PreviewReactRenderComponentNode[];
  readonly truncated: boolean;
}

/**
 * Collects direct JSX children and only attributes whose values are statically render-capable.
 *
 * JSX-valued attributes are safe regardless of their names. Bare component references and render
 * callbacks require a conventional component/render/as/slot-style prop name; spread props remain
 * opaque because their runtime keys cannot be proven without evaluating project code.
 */
export function collectPreviewJsxNestedRenderExpressions(
  node: ts.JsxElement | ts.JsxFragment | ts.JsxSelfClosingElement,
  bindings: ReadonlyMap<string, PreviewReactRenderLocalBindingEvidence>,
  maximumCandidates = Number.MAX_SAFE_INTEGER,
): PreviewReactNestedRenderExpressionCollection {
  const expressions: PreviewReactNestedRenderExpression[] = [];
  let remainingCandidates = Math.max(0, maximumCandidates);
  let truncated = false;
  const attributes = ts.isJsxElement(node)
    ? node.openingElement.attributes.properties
    : ts.isJsxSelfClosingElement(node)
      ? node.attributes.properties
      : [];
  for (const attribute of attributes) {
    if (remainingCandidates <= 0) {
      truncated = true;
      break;
    }
    remainingCandidates -= 1;
    if (
      !ts.isJsxAttribute(attribute) ||
      attribute.initializer === undefined ||
      !ts.isJsxExpression(attribute.initializer) ||
      attribute.initializer.expression === undefined
    ) {
      continue;
    }
    const expression = attribute.initializer.expression;
    const allowComponentReference = isPreviewRenderSlotAttribute(attribute.name.getText());
    if (
      hasPreviewRenderableExpression(expression, bindings, allowComponentReference, new Set(), 0)
    ) {
      expressions.push({ allowComponentReference, expression });
    }
  }
  if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
    for (const child of node.children) {
      if (remainingCandidates <= 0) {
        truncated = true;
        break;
      }
      remainingCandidates -= 1;
      if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
        expressions.push({ allowComponentReference: false, expression: child });
      } else if (ts.isJsxExpression(child) && child.expression !== undefined) {
        expressions.push({ allowComponentReference: false, expression: child.expression });
      }
    }
  }
  return { expressions, truncated };
}

/**
 * Finds component nodes in an otherwise unsupported expression using a bounded DFS.
 *
 * JSX is traversed through the same prop filter as normal outcome expansion. This matters at a
 * depth limit: falling back must not reintroduce scalar-attribute branches that the precise path
 * intentionally rejected.
 */
export function collectPreviewStaticComponentForest(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  bindings: ReadonlyMap<string, PreviewReactRenderLocalBindingEvidence>,
  allowRootComponentReference = false,
): PreviewStaticComponentForestResult {
  const forest: PreviewReactRenderComponentNode[] = [];
  let remainingVisits = MAX_STATIC_COMPONENT_VISITS;
  let truncated = false;

  /** Visits one AST node while preserving JSX component ancestry and enforcing both budgets. */
  const visit = (
    current: ts.Node,
    destination: PreviewReactRenderComponentNode[],
    depth: number,
    allowComponentReference: boolean,
  ): void => {
    if (depth > MAX_STATIC_COMPONENT_DEPTH || remainingVisits <= 0) {
      truncated = true;
      return;
    }
    remainingVisits -= 1;
    if (allowComponentReference && ts.isExpression(current)) {
      const reference = readPreviewComponentReferenceIdentity(current, sourceFile);
      if (reference !== undefined) {
        destination.push({ ...reference, children: [] });
        return;
      }
    }
    if (
      ts.isJsxElement(current) ||
      ts.isJsxSelfClosingElement(current) ||
      ts.isJsxFragment(current)
    ) {
      const identity = readPreviewJsxComponentIdentity(current, sourceFile);
      const children: PreviewReactRenderComponentNode[] = [];
      const nestedCollection = collectPreviewJsxNestedRenderExpressions(
        current,
        bindings,
        remainingVisits,
      );
      truncated ||= nestedCollection.truncated;
      for (const nested of nestedCollection.expressions) {
        visit(nested.expression, children, depth + 1, nested.allowComponentReference);
        if (remainingVisits <= 0) break;
      }
      if (identity === undefined) destination.push(...children);
      else destination.push({ ...identity, children });
      return;
    }
    if (ts.isCallExpression(current) && isPreviewCreateElementCall(current)) {
      const identity = readPreviewComponentReferenceIdentity(current.arguments[0], sourceFile);
      const children: PreviewReactRenderComponentNode[] = [];
      for (const child of current.arguments.slice(2)) {
        visit(child, children, depth + 1, false);
        if (remainingVisits <= 0) break;
      }
      if (identity === undefined) destination.push(...children);
      else destination.push({ ...identity, children });
      return;
    }
    ts.forEachChild<ts.Node>(current, (child) => {
      visit(child, destination, depth + 1, false);
      return remainingVisits <= 0 ? child : undefined;
    });
  };

  visit(node, forest, 0, allowRootComponentReference);
  return { componentTree: forest, truncated };
}

/** Reads a PascalCase/member JSX tag and its source location, skipping hosts and Fragments. */
export function readPreviewJsxComponentIdentity(
  node: ts.JsxElement | ts.JsxFragment | ts.JsxSelfClosingElement,
  sourceFile: ts.SourceFile,
): Omit<PreviewReactRenderComponentNode, 'children'> | undefined {
  if (ts.isJsxFragment(node)) return undefined;
  const tagName = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName;
  const name = tagName.getText(sourceFile);
  if (!isPreviewComponentName(name) && !name.includes('.')) return undefined;
  const location = readPreviewRenderLocation(sourceFile, tagName);
  return { column: location.column, line: location.line, name };
}

/** Reads a bare component value used by `component`, `render`, `as`, or slot-like props. */
export function readPreviewComponentReferenceIdentity(
  expression: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
): Omit<PreviewReactRenderComponentNode, 'children'> | undefined {
  if (expression === undefined) return undefined;
  const unwrapped = unwrapPreviewRenderExpression(expression);
  if (!ts.isIdentifier(unwrapped) && !ts.isPropertyAccessExpression(unwrapped)) return undefined;
  const name = unwrapped.getText(sourceFile);
  if (!isPreviewComponentName(name) && !name.includes('.')) return undefined;
  const location = readPreviewRenderLocation(sourceFile, unwrapped);
  return { column: location.column, line: location.line, name };
}

/** Reads a direct callback return that can reuse the ordinary nested-branch analyzer. */
export function readPreviewRenderFunctionReturnExpression(
  functionLike: ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression,
): ts.Expression | undefined {
  const body = functionLike.body;
  if (body === undefined) return undefined;
  if (!ts.isBlock(body)) return body;
  const statement = body.statements[0];
  if (body.statements.length !== 1 || statement === undefined || !ts.isReturnStatement(statement)) {
    return undefined;
  }
  return statement.expression;
}

/** Recognizes conventional props whose value is invoked or mounted as React output. */
function isPreviewRenderSlotAttribute(authoredName: string): boolean {
  const name = authoredName.toLowerCase();
  return (
    name === 'as' ||
    name === 'children' ||
    name === 'component' ||
    name === 'fallback' ||
    name === 'render' ||
    name === 'slot' ||
    name.startsWith('render') ||
    name.endsWith('component') ||
    name.endsWith('slot')
  );
}

/** Proves that an attribute value can create React output without evaluating the value. */
function hasPreviewRenderableExpression(
  expression_: ts.Expression,
  bindings: ReadonlyMap<string, PreviewReactRenderLocalBindingEvidence>,
  allowComponentReference: boolean,
  visitedBindings: ReadonlySet<string>,
  depth: number,
): boolean {
  if (depth > MAX_RENDERABILITY_DEPTH) return false;
  const expression = unwrapPreviewRenderExpression(expression_);
  if (
    ts.isJsxElement(expression) ||
    ts.isJsxSelfClosingElement(expression) ||
    ts.isJsxFragment(expression) ||
    isPreviewCreateElementCall(expression)
  ) {
    return true;
  }
  if (
    allowComponentReference &&
    readPreviewComponentReferenceIdentity(expression, expression.getSourceFile())
  ) {
    return true;
  }
  if (ts.isConditionalExpression(expression)) {
    return (
      hasPreviewRenderableExpression(
        expression.whenTrue,
        bindings,
        allowComponentReference,
        visitedBindings,
        depth + 1,
      ) ||
      hasPreviewRenderableExpression(
        expression.whenFalse,
        bindings,
        allowComponentReference,
        visitedBindings,
        depth + 1,
      )
    );
  }
  if (
    ts.isBinaryExpression(expression) &&
    (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return hasPreviewRenderableExpression(
      expression.right,
      bindings,
      allowComponentReference,
      visitedBindings,
      depth + 1,
    );
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.some(
      (element) =>
        !ts.isSpreadElement(element) &&
        hasPreviewRenderableExpression(
          element,
          bindings,
          allowComponentReference,
          visitedBindings,
          depth + 1,
        ),
    );
  }
  if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties.some((property) => {
      if (ts.isPropertyAssignment(property)) {
        return hasPreviewRenderableExpression(
          property.initializer,
          bindings,
          allowComponentReference,
          visitedBindings,
          depth + 1,
        );
      }
      return false;
    });
  }
  if (isPreviewRenderFunction(expression)) {
    if (!allowComponentReference) return false;
    return hasPreviewRenderableNode(expression.body, bindings, visitedBindings, depth + 1);
  }
  if (ts.isIdentifier(expression)) {
    if (visitedBindings.has(expression.text)) return false;
    const binding = bindings.get(expression.text);
    if (binding === undefined) return false;
    const nextVisited = new Set(visitedBindings);
    nextVisited.add(expression.text);
    if (binding.expression !== undefined) {
      return hasPreviewRenderableExpression(
        binding.expression,
        bindings,
        allowComponentReference,
        nextVisited,
        depth + 1,
      );
    }
    return binding.functionLike?.body === undefined
      ? false
      : hasPreviewRenderableNode(binding.functionLike.body, bindings, nextVisited, depth + 1);
  }
  return false;
}

/** Searches a bounded render callback body for a return/JSX expression. */
function hasPreviewRenderableNode(
  node: ts.Node,
  bindings: ReadonlyMap<string, PreviewReactRenderLocalBindingEvidence>,
  visitedBindings: ReadonlySet<string>,
  depth: number,
): boolean {
  if (depth > MAX_RENDERABILITY_DEPTH) return false;
  if (ts.isExpression(node)) {
    return hasPreviewRenderableExpression(node, bindings, true, visitedBindings, depth + 1);
  }
  let renderable = false;
  ts.forEachChild(node, (child) => {
    if (!renderable) {
      renderable = hasPreviewRenderableNode(child, bindings, visitedBindings, depth + 1);
    }
  });
  return renderable;
}

/** Reports whether an expression is a conventional React element factory call. */
function isPreviewCreateElementCall(expression: ts.Expression): expression is ts.CallExpression {
  if (!ts.isCallExpression(expression)) return false;
  const callee = expression.expression;
  return (
    (ts.isPropertyAccessExpression(callee) &&
      callee.name.text === 'createElement' &&
      callee.expression.getText().endsWith('React')) ||
    (ts.isIdentifier(callee) && callee.text === 'createElement')
  );
}
