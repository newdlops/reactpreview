/**
 * Traces an authored JSX event through same-module component callback props to deferred UI.
 *
 * A mounted button often calls a callback prop instead of touching a modal controller directly:
 * `onClick={() => onOpen(file)}` can flow through several local components before reaching
 * `setFile(file); modalActions.show()`. This analyzer follows that source-only corridor without
 * executing handlers, resolving imports, or inventing event arguments. It accepts only lexical
 * declarations and explicit JSX prop assignments from the same parsed module.
 */
import ts from 'typescript';

const MAX_PROP_FLOW_DEPTH = 16;
const MAX_PROP_FLOW_NODE_VISITS = 512;
const IMPERATIVE_VISIBILITY_METHODS = new Set([
  'open',
  'openModal',
  'present',
  'presentModal',
  'show',
  'showModal',
]);

/** Result consumed by the ordinary deferred-trigger metadata instrumenter. */
export interface PreviewDeferredUiPropFlowEvidence {
  /** The mounted outer event closure can be invoked without manufacturing an event object. */
  readonly invocationSafe: true;
  /** Exact imperative method found at the end of the component-prop corridor. */
  readonly methodName: string;
}

/** Reusable same-module index created once for every JSX event in one parsed source file. */
export interface PreviewDeferredUiPropFlowAnalyzer {
  readonly find: (eventExpression: ts.Expression) => PreviewDeferredUiPropFlowEvidence | undefined;
}

type PreviewPropFlowFunction = ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression;

type PreviewPropFlowResolution =
  | { readonly expression: ts.Expression; readonly kind: 'expression' }
  | { readonly functionLike: PreviewPropFlowFunction; readonly kind: 'function' }
  | {
      readonly componentName: string;
      readonly kind: 'prop';
      readonly propName: string;
    }
  | { readonly kind: 'opaque' };

interface PreviewPropUsage {
  readonly expression: ts.Expression;
}

interface PreviewPropFlowIndex {
  readonly componentNameCounts: ReadonlyMap<string, number>;
  readonly propUsages: ReadonlyMap<string, readonly PreviewPropUsage[]>;
  readonly sourceFile: ts.SourceFile;
}

interface PreviewPropFlowBudget {
  visits: number;
}

interface PreviewPropFlowTrace {
  readonly depth: number;
  readonly visitedNodes: ReadonlySet<ts.Node>;
  readonly visitedProps: ReadonlySet<string>;
}

/**
 * Proves that one zero-argument JSX event closure eventually calls a local UI visibility method.
 *
 * Direct modal calls remain handled by the smaller primary analyzer. This fallback specializes in
 * callback props passed through locally declared React components and returns no evidence when
 * different call sites lead to different visibility methods.
 */
export function createPreviewDeferredUiPropFlowAnalyzer(
  sourceFile: ts.SourceFile,
): PreviewDeferredUiPropFlowAnalyzer {
  const index = createPreviewPropFlowIndex(sourceFile);
  return {
    find: (eventExpression_) => {
      const eventExpression = unwrapPreviewPropFlowExpression(eventExpression_);
      if (
        (!ts.isArrowFunction(eventExpression) && !ts.isFunctionExpression(eventExpression)) ||
        eventExpression.parameters.length !== 0
      ) {
        return undefined;
      }
      const budget: PreviewPropFlowBudget = { visits: 0 };
      const methods = tracePreviewPropFlowFunction(eventExpression, index, budget, {
        depth: 0,
        visitedNodes: new Set([eventExpression]),
        visitedProps: new Set(),
      });
      return methods.size === 1
        ? { invocationSafe: true, methodName: [...methods][0] ?? '' }
        : undefined;
    },
  };
}

/** Indexes explicit JSX prop expressions by their locally named component and prop. */
function createPreviewPropFlowIndex(sourceFile: ts.SourceFile): PreviewPropFlowIndex {
  const mutable = new Map<string, PreviewPropUsage[]>();
  const componentNameCounts = new Map<string, number>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isArrowFunction(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node)
    ) {
      const name = readPreviewPropFlowFunctionName(node);
      if (name !== undefined) {
        componentNameCounts.set(name, (componentNameCounts.get(name) ?? 0) + 1);
      }
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = ts.isIdentifier(node.tagName) ? node.tagName.text : undefined;
      if (tagName !== undefined) {
        for (const attribute of node.attributes.properties) {
          if (
            !ts.isJsxAttribute(attribute) ||
            !ts.isIdentifier(attribute.name) ||
            attribute.initializer === undefined ||
            !ts.isJsxExpression(attribute.initializer) ||
            attribute.initializer.expression === undefined
          ) {
            continue;
          }
          const key = createPreviewPropFlowKey(tagName, attribute.name.text);
          const usages = mutable.get(key) ?? [];
          usages.push({ expression: attribute.initializer.expression });
          mutable.set(key, usages);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { componentNameCounts, propUsages: mutable, sourceFile };
}

/** Traces a render callback body while refusing to descend into uninvoked nested closures. */
function tracePreviewPropFlowFunction(
  functionLike: PreviewPropFlowFunction,
  index: PreviewPropFlowIndex,
  budget: PreviewPropFlowBudget,
  trace: PreviewPropFlowTrace,
): ReadonlySet<string> {
  const body = functionLike.body;
  if (body === undefined) return new Set();
  if (!ts.isBlock(body)) return tracePreviewPropFlowExpression(body, index, budget, trace);
  const methods = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (budget.visits >= MAX_PROP_FLOW_NODE_VISITS) return;
    budget.visits += 1;
    if (node !== body && ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node)) {
      addPreviewPropFlowMethods(
        methods,
        tracePreviewPropFlowExpression(node, index, budget, trace),
      );
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return methods;
}

/** Recursively resolves one expression through lexical aliases, calls, and component props. */
function tracePreviewPropFlowExpression(
  expression_: ts.Expression,
  index: PreviewPropFlowIndex,
  budget: PreviewPropFlowBudget,
  trace: PreviewPropFlowTrace,
): ReadonlySet<string> {
  if (trace.depth > MAX_PROP_FLOW_DEPTH || budget.visits >= MAX_PROP_FLOW_NODE_VISITS) {
    return new Set();
  }
  budget.visits += 1;
  const expression = unwrapPreviewPropFlowExpression(expression_);
  if (trace.visitedNodes.has(expression)) return new Set();
  const nextNodes = new Set(trace.visitedNodes);
  nextNodes.add(expression);
  const nextTrace = { ...trace, depth: trace.depth + 1, visitedNodes: nextNodes };
  if (ts.isCallExpression(expression)) {
    const methodName = readPreviewVisibilityMethod(expression);
    if (methodName !== undefined) return new Set([methodName]);
    const callee = unwrapPreviewPropFlowExpression(expression.expression);
    if (!ts.isIdentifier(callee)) return new Set();
    return tracePreviewPropFlowResolution(
      resolvePreviewPropFlowIdentifier(callee, index.sourceFile),
      index,
      budget,
      nextTrace,
    );
  }
  if (ts.isIdentifier(expression)) {
    return tracePreviewPropFlowResolution(
      resolvePreviewPropFlowIdentifier(expression, index.sourceFile),
      index,
      budget,
      nextTrace,
    );
  }
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    return tracePreviewPropFlowFunction(expression, index, budget, nextTrace);
  }
  if (ts.isConditionalExpression(expression)) {
    return mergePreviewPropFlowMethods([
      tracePreviewPropFlowExpression(expression.whenTrue, index, budget, nextTrace),
      tracePreviewPropFlowExpression(expression.whenFalse, index, budget, nextTrace),
    ]);
  }
  if (
    ts.isBinaryExpression(expression) &&
    [
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
    ].includes(expression.operatorToken.kind)
  ) {
    return mergePreviewPropFlowMethods([
      tracePreviewPropFlowExpression(expression.left, index, budget, nextTrace),
      tracePreviewPropFlowExpression(expression.right, index, budget, nextTrace),
    ]);
  }
  return new Set();
}

/** Dispatches one lexical resolution without letting opaque/shadowed bindings fall through. */
function tracePreviewPropFlowResolution(
  resolution: PreviewPropFlowResolution | undefined,
  index: PreviewPropFlowIndex,
  budget: PreviewPropFlowBudget,
  trace: PreviewPropFlowTrace,
): ReadonlySet<string> {
  if (resolution === undefined || resolution.kind === 'opaque') return new Set();
  if (resolution.kind === 'expression') {
    return tracePreviewPropFlowExpression(resolution.expression, index, budget, trace);
  }
  if (resolution.kind === 'function') {
    if (trace.visitedNodes.has(resolution.functionLike)) return new Set();
    const visitedNodes = new Set(trace.visitedNodes);
    visitedNodes.add(resolution.functionLike);
    return tracePreviewPropFlowFunction(resolution.functionLike, index, budget, {
      ...trace,
      visitedNodes,
    });
  }
  const key = createPreviewPropFlowKey(resolution.componentName, resolution.propName);
  if (
    index.componentNameCounts.get(resolution.componentName) !== 1 ||
    trace.visitedProps.has(key)
  ) {
    return new Set();
  }
  const visitedProps = new Set(trace.visitedProps);
  visitedProps.add(key);
  return mergePreviewPropFlowMethods(
    (index.propUsages.get(key) ?? []).map((usage) =>
      tracePreviewPropFlowExpression(usage.expression, index, budget, {
        ...trace,
        visitedProps,
      }),
    ),
  );
}

/** Resolves the nearest lexical declaration or destructured component prop for one identifier. */
function resolvePreviewPropFlowIdentifier(
  identifier: ts.Identifier,
  sourceFile: ts.SourceFile,
): PreviewPropFlowResolution | undefined {
  let current = identifier.parent;
  while (!ts.isSourceFile(current)) {
    if (ts.isBlock(current)) {
      const binding = resolvePreviewPropFlowStatementBinding(
        current.statements,
        identifier,
        sourceFile,
      );
      if (binding !== undefined) return binding;
    }
    if (
      ts.isArrowFunction(current) ||
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current)
    ) {
      const parameter = resolvePreviewPropFlowParameter(current, identifier.text);
      if (parameter !== undefined) return parameter;
    }
    current = current.parent;
  }
  return resolvePreviewPropFlowStatementBinding(current.statements, identifier, sourceFile);
}

/** Resolves a direct block declaration while retaining TDZ and mutable-shadow evidence. */
function resolvePreviewPropFlowStatementBinding(
  statements: readonly ts.Statement[],
  identifier: ts.Identifier,
  sourceFile: ts.SourceFile,
): PreviewPropFlowResolution | undefined {
  for (const statement of statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === identifier.text) {
      return { functionLike: statement, kind: 'function' };
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== identifier.text) {
        continue;
      }
      const immutable = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
      if (
        !immutable ||
        declaration.initializer === undefined ||
        declaration.getStart(sourceFile) >= identifier.getStart(sourceFile)
      ) {
        return { kind: 'opaque' };
      }
      return { expression: declaration.initializer, kind: 'expression' };
    }
  }
  return undefined;
}

/** Converts a destructured parameter into the public prop identity used at JSX call sites. */
function resolvePreviewPropFlowParameter(
  functionLike: PreviewPropFlowFunction,
  localName: string,
): PreviewPropFlowResolution | undefined {
  for (const parameter of functionLike.parameters) {
    if (ts.isIdentifier(parameter.name) && parameter.name.text === localName) {
      return { kind: 'opaque' };
    }
    if (!ts.isObjectBindingPattern(parameter.name)) continue;
    for (const element of parameter.name.elements) {
      if (!ts.isIdentifier(element.name) || element.name.text !== localName) continue;
      const componentName = readPreviewPropFlowFunctionName(functionLike);
      if (componentName === undefined) return { kind: 'opaque' };
      const propName =
        element.propertyName !== undefined && ts.isIdentifier(element.propertyName)
          ? element.propertyName.text
          : element.name.text;
      return { componentName, kind: 'prop', propName };
    }
  }
  return undefined;
}

/** Reads a stable local component name from declarations used by explicit JSX tags. */
function readPreviewPropFlowFunctionName(
  functionLike: PreviewPropFlowFunction,
): string | undefined {
  if (
    (ts.isFunctionDeclaration(functionLike) || ts.isFunctionExpression(functionLike)) &&
    functionLike.name !== undefined
  ) {
    return functionLike.name.text;
  }
  return ts.isVariableDeclaration(functionLike.parent) && ts.isIdentifier(functionLike.parent.name)
    ? functionLike.parent.name.text
    : undefined;
}

/** Recognizes a zero-argument visual controller method with a UI-shaped receiver. */
function readPreviewVisibilityMethod(call: ts.CallExpression): string | undefined {
  if (call.arguments.length !== 0) return undefined;
  const callee = unwrapPreviewPropFlowExpression(call.expression);
  if (
    !ts.isPropertyAccessExpression(callee) ||
    !IMPERATIVE_VISIBILITY_METHODS.has(callee.name.text) ||
    !hasPreviewUiReceiverEvidence(callee.expression)
  ) {
    return undefined;
  }
  return callee.name.text;
}

/** Excludes domain calls such as `billing.show()` while admitting modal refs and action objects. */
function hasPreviewUiReceiverEvidence(expression_: ts.Expression): boolean {
  const names: string[] = [];
  let expression = unwrapPreviewPropFlowExpression(expression_);
  while (ts.isPropertyAccessExpression(expression)) {
    names.push(expression.name.text);
    expression = unwrapPreviewPropFlowExpression(expression.expression);
  }
  if (ts.isIdentifier(expression)) names.push(expression.text);
  return names.some((name) => {
    const lowerName = name.toLowerCase();
    if (lowerName === 'action' || lowerName === 'actions' || lowerName === 'ref') return true;
    return ['dialog', 'drawer', 'modal', 'overlay', 'popover', 'sheet'].some((token) =>
      lowerName.includes(token),
    );
  });
}

/** Removes syntax-only wrappers while preserving every authored expression node identity. */
function unwrapPreviewPropFlowExpression(expression_: ts.Expression): ts.Expression {
  let expression = expression_;
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    expression = expression.expression;
  }
  return expression;
}

/** Adds bounded method evidence without interpreting conditions or choosing an authored branch. */
function mergePreviewPropFlowMethods(records: readonly ReadonlySet<string>[]): ReadonlySet<string> {
  const methods = new Set<string>();
  for (const record of records) addPreviewPropFlowMethods(methods, record);
  return methods;
}

/** Merges one evidence set into a mutable accumulator used only during this syntax pass. */
function addPreviewPropFlowMethods(destination: Set<string>, source: ReadonlySet<string>): void {
  for (const method of source) destination.add(method);
}

/** Produces an unambiguous key for one local JSX component prop corridor. */
function createPreviewPropFlowKey(componentName: string, propName: string): string {
  return `${componentName}\u0000${propName}`;
}
