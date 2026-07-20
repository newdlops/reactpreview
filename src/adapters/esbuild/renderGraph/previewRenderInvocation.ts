/**
 * Classifies React component transport at one inert identifier reference.
 *
 * The render graph already follows declaration references, but a generic `value-flow` edge cannot
 * explain whether the value was rendered as JSX, wrapped by an HOC, or passed through a component
 * slot. This module adds that meaning from syntax only. It never resolves imports or evaluates a
 * project factory, so unfamiliar calls remain ordinary value flow instead of speculative React
 * ownership.
 */
import ts from 'typescript';
import type {
  PreviewRenderInvocation,
  PreviewRenderInvocationMode,
} from './previewRenderGraphTypes';

/** Common exact HOC factory names that are safe to describe as React wrapper evidence. */
const KNOWN_HOC_FACTORIES = new Set([
  'compose',
  'connect',
  'forwardRef',
  'inject',
  'lazy',
  'memo',
  'observer',
  'styled',
  'withRouter',
]);

/**
 * Infers the semantic React invocation surrounding one known component identifier.
 *
 * @param identifier Runtime reference already proven to resolve to a local or imported graph value.
 * @param boundary Top-level owner whose subtree bounds all ancestry inspection.
 * @returns Frozen invocation evidence, or `undefined` for an ordinary non-React value read.
 */
export function readPreviewRenderInvocation(
  identifier: ts.Identifier,
  boundary: ts.Node,
): PreviewRenderInvocation | undefined {
  if (isJsxTagReference(identifier)) {
    const calleeName = readContainingJsxTagName(identifier);
    return Object.freeze({
      ...(calleeName === undefined ? {} : { calleeName }),
      mode: 'jsx',
    });
  }

  const attribute = findContainingJsxAttribute(identifier, boundary);
  if (attribute !== undefined) {
    const slotName = attribute.name.getText();
    const mode = classifyComponentSlot(slotName);
    if (mode !== undefined) {
      const calleeName = readJsxAttributeReceiver(attribute);
      const factoryNames = collectHocFactoryNames(identifier, boundary);
      return Object.freeze({
        ...(calleeName === undefined ? {} : { calleeName }),
        ...(factoryNames.length === 0 ? {} : { factoryNames: Object.freeze(factoryNames) }),
        mode,
        slotName,
      });
    }
  }

  if (isInsideReactCreateElement(identifier, boundary)) {
    return Object.freeze({ calleeName: 'createElement', mode: 'create-element' });
  }

  const factoryNames = collectHocFactoryNames(identifier, boundary);
  if (factoryNames.length === 0) return undefined;
  const outermostFactory = factoryNames.at(-1);
  if (outermostFactory === undefined) return undefined;
  return Object.freeze({
    calleeName: outermostFactory,
    factoryNames: Object.freeze(factoryNames),
    mode: classifyHocMode(factoryNames),
  });
}

/** Reports an identifier used as the tag identity of an opening or self-closing JSX element. */
function isJsxTagReference(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  return (
    (ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) &&
    parent.tagName === identifier
  );
}

/** Reads the authored tag containing a direct JSX tag identifier. */
function readContainingJsxTagName(identifier: ts.Identifier): string | undefined {
  const parent = identifier.parent;
  return ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)
    ? parent.tagName.getText()
    : undefined;
}

/** Finds the nearest JSX attribute whose initializer contains the component reference. */
function findContainingJsxAttribute(
  identifier: ts.Identifier,
  boundary: ts.Node,
): ts.JsxAttribute | undefined {
  let current: ts.Node = identifier.parent;
  while (!ts.isSourceFile(current)) {
    if (ts.isJsxAttribute(current)) return current;
    if (current === boundary) break;
    current = current.parent;
  }
  return undefined;
}

/** Classifies conventional React slots while avoiding arbitrary data-valued JSX attributes. */
function classifyComponentSlot(slotName: string): PreviewRenderInvocationMode | undefined {
  if (slotName === 'as') return 'polymorphic-prop';
  if (/^(?:render|renderer)|(?:Render|Renderer)$/u.test(slotName)) return 'render-prop';
  if (/(?:component|element|icon|view|screen|page|layout|fallback|content)$/iu.test(slotName)) {
    return 'component-prop';
  }
  return undefined;
}

/** Reads the receiver tag for a JSX component-valued prop. */
function readJsxAttributeReceiver(attribute: ts.JsxAttribute): string | undefined {
  const attributes = attribute.parent;
  const opening = attributes.parent;
  return ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening)
    ? opening.tagName.getText()
    : undefined;
}

/** Recognizes the first component argument of `createElement`/`React.createElement`. */
function isInsideReactCreateElement(identifier: ts.Identifier, boundary: ts.Node): boolean {
  let current: ts.Node = identifier.parent;
  while (!ts.isSourceFile(current)) {
    if (ts.isCallExpression(current)) {
      const calleeName = readCallFactoryName(current.expression);
      if (
        calleeName === 'createElement' &&
        current.arguments[0] !== undefined &&
        containsNode(current.arguments[0], identifier)
      ) {
        return true;
      }
    }
    if (current === boundary) break;
    current = current.parent;
  }
  return false;
}

/** Collects recognized nested HOC calls from the closest factory toward the outermost factory. */
function collectHocFactoryNames(identifier: ts.Identifier, boundary: ts.Node): string[] {
  const names: string[] = [];
  let current: ts.Node = identifier.parent;
  while (!ts.isSourceFile(current)) {
    if (
      ts.isCallExpression(current) &&
      current.arguments.some((argument) => containsNode(argument, identifier))
    ) {
      const factoryName = readCallFactoryName(current.expression);
      const componentArgument = current.arguments[0];
      if (
        factoryName !== undefined &&
        componentArgument !== undefined &&
        containsNode(componentArgument, identifier) &&
        isPreviewRenderHocFactoryCall(current)
      ) {
        names.push(factoryName);
      }
    }
    if (current === boundary) break;
    current = current.parent;
  }
  return names.slice(0, 8);
}

/** Reads a stable final callee segment, including curried calls such as `connect(...)(Target)`. */
function readCallFactoryName(expression: ts.Expression): string | undefined {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return current.text;
  if (ts.isPropertyAccessExpression(current)) return current.name.text;
  return ts.isCallExpression(current) ? readCallFactoryName(current.expression) : undefined;
}

/** Admits conventional HOC names without declaring arbitrary project calls to be components. */
function isHocFactoryName(name: string): boolean {
  return KNOWN_HOC_FACTORIES.has(name) || /^with\p{Lu}/u.test(name) || name.endsWith('HOC');
}

/** Reports a conventional React HOC/factory call without evaluating the factory binding. */
export function isPreviewRenderHocFactoryCall(expression: ts.CallExpression): boolean {
  const factoryName = readCallFactoryName(expression.expression);
  return factoryName !== undefined && isHocFactoryName(factoryName);
}

/** Gives React's built-in factories their own debugger node shape and groups the rest as HOCs. */
function classifyHocMode(factoryNames: readonly string[]): PreviewRenderInvocationMode {
  if (factoryNames.includes('forwardRef')) return 'forward-ref';
  if (factoryNames.includes('memo')) return 'memo';
  if (factoryNames.includes('styled')) return 'styled';
  return 'hoc';
}

/** Removes syntax-only wrappers while preserving expression identity. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Checks AST containment using stable authored ranges rather than parent object identity. */
function containsNode(container: ts.Node, candidate: ts.Node): boolean {
  return candidate.getStart() >= container.getStart() && candidate.end <= container.end;
}
