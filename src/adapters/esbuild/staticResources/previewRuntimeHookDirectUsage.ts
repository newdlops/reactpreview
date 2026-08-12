/**
 * Infers fallback values from direct, property-free uses of one hook-result identifier.
 *
 * Deep property-path inference remains in the main hook analyzer. This focused module handles the
 * complementary cases—calling a returned function, testing a returned flag, applying an authored
 * nullish default, or rendering a returned scalar—without growing that analyzer to the file limit.
 */
import ts from 'typescript';
import { readPreviewRuntimeCallResultBinding } from './previewRuntimeHookSyntax';

/** Static expression and user-facing description emitted for one proven direct use. */
export interface PreviewRuntimeHookDirectUsageFallback {
  /** Whether local syntax proves the fallback itself must be callable. */
  readonly callable?: boolean;
  /** Variable bindings that prove a called fallback must return a particular static shape. */
  readonly callResultBindings?: readonly ts.BindingName[];
  /** Fulfillment bindings proving that a called fallback must preserve a Promise contract. */
  readonly promiseResultBindings?: readonly ts.BindingName[];
  /** Side-effect-free JavaScript expression evaluated only by the Inspector fallback boundary. */
  readonly expression: string;
  /** Concise explanation displayed beside the generated render value. */
  readonly label: string;
  /** Whether local syntax directly chains the callable result as a Promise. */
  readonly promiseReturning?: boolean;
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
    callResultBindings: [] as ts.BindingName[],
    conditional: false,
    emptyRenderable: false,
    mutableRef: false,
    nullishDefault: false,
    promiseResultBindings: [] as ts.BindingName[],
    promiseReturning: false,
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
        const resultBinding = readPreviewRuntimeCallResultBinding(parent);
        if (
          resultBinding !== undefined &&
          !usage.callResultBindings.some(
            (candidate) => candidate.getStart() === resultBinding.getStart(),
          )
        ) {
          usage.callResultBindings.push(resultBinding);
        }
        const promiseResult = readPromiseResultDemand(parent);
        if (promiseResult !== undefined) {
          usage.promiseReturning = true;
          const binding = promiseResult.binding;
          if (
            binding !== undefined &&
            !usage.promiseResultBindings.some(
              (candidate) => candidate.getStart() === binding.getStart(),
            )
          ) {
            usage.promiseResultBindings.push(binding);
          }
        }
      } else if (
        ts.isBinaryExpression(parent) &&
        parent.left === node &&
        parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ) {
        usage.nullishDefault = true;
      } else if (isBooleanTestPosition(node, parent)) {
        usage.conditional = true;
      } else if (ts.isJsxExpression(parent) && parent.expression === node) {
        if (isPreviewRuntimeHookMutableRefJsxValue(node)) usage.mutableRef = true;
        else if (isCallableJsxAttribute(parent.parent)) usage.called = true;
        else if (isPreviewRuntimeHookEmptyRenderableJsxValue(node)) usage.emptyRenderable = true;
        else if (!ts.isJsxAttribute(parent.parent) || isChildrenJsxAttribute(parent.parent)) {
          usage.rendered = true;
        }
      } else if (isRenderedCollectionCallbackValue(node, owner)) {
        usage.rendered = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  if (usage.called) {
    return {
      callable: true,
      ...(usage.callResultBindings.length === 0
        ? {}
        : { callResultBindings: Object.freeze([...usage.callResultBindings]) }),
      ...(usage.promiseResultBindings.length === 0
        ? {}
        : { promiseResultBindings: Object.freeze([...usage.promiseResultBindings]) }),
      ...(usage.promiseReturning ? { promiseReturning: true } : {}),
      expression: 'Object.freeze(() => undefined)',
      label: 'generated no-op function from local call',
    };
  }
  if (usage.mutableRef) {
    return {
      expression: '({ current: null })',
      label: 'generated mutable React ref',
    };
  }
  if (usage.nullishDefault) {
    return { expression: 'undefined', label: 'generated missing value for authored default' };
  }
  if (usage.conditional) {
    return { expression: 'false', label: 'generated boolean from local condition' };
  }
  if (usage.emptyRenderable) {
    return { expression: 'null', label: 'generated empty render value' };
  }
  return usage.rendered
    ? {
        expression: JSON.stringify(createCompactPreviewKey(identifier.text)),
        label: 'generated rendered key text',
      }
    : undefined;
}

/** Promise-chain evidence and the first fulfillment callback binding, when authored inline. */
interface PreviewRuntimePromiseResultDemand {
  readonly binding?: ts.BindingName;
}

/**
 * Recognizes an immediate `.then`, `.catch`, or `.finally` consumer of one generated call.
 *
 * A synchronous no-op is compatible with `await`, but not with direct Promise chaining. For
 * `.then`, the first inline callback parameter also provides an exact fulfillment payload shape.
 */
function readPromiseResultDemand(
  call: ts.CallExpression,
): PreviewRuntimePromiseResultDemand | undefined {
  let result: ts.Expression = call;
  while (
    (ts.isParenthesizedExpression(result.parent) ||
      ts.isAsExpression(result.parent) ||
      ts.isTypeAssertionExpression(result.parent) ||
      ts.isNonNullExpression(result.parent) ||
      ts.isSatisfiesExpression(result.parent)) &&
    result.parent.expression === result
  ) {
    result = result.parent;
  }
  const access = result.parent;
  if (
    !ts.isPropertyAccessExpression(access) ||
    access.expression !== result ||
    !['then', 'catch', 'finally'].includes(access.name.text)
  ) {
    return undefined;
  }
  const chainCall = access.parent;
  if (!ts.isCallExpression(chainCall) || chainCall.expression !== access) return undefined;
  if (access.name.text !== 'then') return {};
  const callback = chainCall.arguments[0];
  if (
    callback === undefined ||
    (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
  ) {
    return {};
  }
  const binding = callback.parameters[0]?.name;
  return binding === undefined ? {} : { binding };
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

/**
 * Reports whether an expression is supplied to a React event/render callback attribute.
 *
 * Property-shaped hook results such as `modal.open` do not contain an authored call expression,
 * but React will call them later. Exposing this syntax fact lets deep hook fallback generation emit
 * a no-op function instead of an object that would fail only after the user clicks the preview.
 */
export function isPreviewRuntimeHookCallableJsxValue(expression: ts.Expression): boolean {
  const parent = unwrapParentNode(expression);
  return ts.isJsxExpression(parent) && isCallableJsxAttribute(parent.parent);
}

/**
 * Reports whether an exact hook-derived value is assigned to React's special JSX ref attribute.
 * React mutates object refs during commit, so this syntax is the proof needed to keep only that
 * generated leaf extensible while surrounding fallback records remain frozen.
 */
export function isPreviewRuntimeHookMutableRefJsxValue(expression: ts.Expression): boolean {
  const parent = unwrapParentNode(expression);
  return ts.isJsxExpression(parent) &&
    ts.isJsxAttribute(parent.parent) &&
    ts.isIdentifier(parent.parent.name) &&
    parent.parent.name.text === 'ref';
}

/**
 * Recognizes JSX slots whose value is rendered as a React node by common component contracts.
 * A neutral `null` is safer than inventing `{}` for these opaque prop edges because React rejects a
 * plain object when the receiving component places it in its child tree.
 */
export function isPreviewRuntimeHookEmptyRenderableJsxValue(expression: ts.Expression): boolean {
  const parent = unwrapParentNode(expression);
  if (
    !ts.isJsxExpression(parent) ||
    !ts.isJsxAttribute(parent.parent) ||
    !ts.isIdentifier(parent.parent.name)
  ) {
    return false;
  }
  const attributeName = parent.parent.name.text;
  return /^(?:(?:start|end|menu|expand|collapse|close|open|leading|trailing)?Icon|(?:start|end)?Adornment|avatar|decorator)$/iu.test(
    attributeName,
  );
}

/** Reports whether React consumes this exact expression as ordinary rendered child content. */
export function isPreviewRuntimeHookRenderedJsxValue(expression: ts.Expression): boolean {
  const parent = unwrapParentNode(expression);
  return (
    ts.isJsxExpression(parent) &&
    (!ts.isJsxAttribute(parent.parent) || isChildrenJsxAttribute(parent.parent))
  );
}

/** Recognizes React's explicit `children` prop as rendered content rather than an opaque prop. */
function isChildrenJsxAttribute(node: ts.Node): boolean {
  return ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === 'children';
}

/**
 * Detects an array callback that returns its item unchanged into an immediate React render sink.
 *
 * A Context hook such as `useButtons(): ReactNode[]` often feeds `buttons.map(button => button)`.
 * Property-free analysis previously invented an `{ id, name }` object for that item, which React
 * rejects as a child. The narrow identity-and-render proof below permits a short scalar while
 * leaving callbacks that read item fields to the existing object-shape inference.
 */
function isRenderedCollectionCallbackValue(
  expression: ts.Identifier,
  owner: RuntimeFunction,
): boolean {
  if (!ts.isArrowFunction(owner) && !ts.isFunctionExpression(owner)) return false;
  if (!owner.parameters.some((parameter) => bindingContainsName(parameter.name, expression.text))) {
    return false;
  }
  const returnParent = unwrapParentNode(expression);
  const returnsItem =
    (ts.isArrowFunction(owner) &&
      !ts.isBlock(owner.body) &&
      unwrapExpression(owner.body) === expression) ||
    (ts.isReturnStatement(returnParent) && returnParent.expression !== undefined);
  if (!returnsItem) return false;
  const call = unwrapParentNode(owner);
  if (!ts.isCallExpression(call)) return false;
  const callee = unwrapExpression(call.expression);
  if (
    !ts.isPropertyAccessExpression(callee) ||
    (callee.name.text !== 'map' && callee.name.text !== 'flatMap')
  ) {
    return false;
  }
  const renderParent = unwrapParentNode(call);
  if (ts.isReturnStatement(renderParent)) return true;
  return (
    ts.isJsxExpression(renderParent) &&
    (!ts.isJsxAttribute(renderParent.parent) || isChildrenJsxAttribute(renderParent.parent))
  );
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
