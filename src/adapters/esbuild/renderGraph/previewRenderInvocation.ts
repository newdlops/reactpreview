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

/** Callbacks whose return values are evaluated synchronously while an owner renders. */
const SYNCHRONOUS_RENDER_CALLBACKS = new Set([
  'flatMap',
  'from',
  'map',
  'reduce',
  'reduceRight',
  'useMemo',
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
  const deferred = isPreviewRenderInvocationDeferred(identifier, boundary);
  const localOwnerNames = collectPreviewRenderLocalComponentOwnerNames(identifier, boundary);
  const localOwnerEvidence =
    localOwnerNames.length === 0
      ? {}
      : { localOwnerNames: Object.freeze(localOwnerNames) };
  const attribute = findContainingJsxAttribute(identifier, boundary);
  if (attribute !== undefined) {
    const slotName = attribute.name.getText();
    const mode = classifyComponentSlot(slotName);
    if (mode !== undefined) {
      const calleeName = readJsxAttributeReceiver(attribute);
      const factoryNames = collectHocFactoryNames(identifier, boundary);
      return Object.freeze({
        ...(calleeName === undefined ? {} : { calleeName }),
        ...(deferred ? { deferred: true } : {}),
        ...(factoryNames.length === 0 ? {} : { factoryNames: Object.freeze(factoryNames) }),
        ...localOwnerEvidence,
        mode,
        slotName,
      });
    }
  }

  const childRenderSlot = findContainingJsxChildRenderSlot(identifier, boundary);
  if (childRenderSlot !== undefined) {
    return Object.freeze({
      calleeName: childRenderSlot.receiverName,
      deferred: true,
      ...localOwnerEvidence,
      mode: 'render-prop',
      slotName: 'children',
    });
  }

  if (isJsxTagReference(identifier)) {
    const calleeName = readContainingJsxTagName(identifier);
    return Object.freeze({
      ...(calleeName === undefined ? {} : { calleeName }),
      ...(deferred ? { deferred: true } : {}),
      ...localOwnerEvidence,
      mode: 'jsx',
    });
  }

  if (isInsideReactCreateElement(identifier, boundary)) {
    return Object.freeze({
      calleeName: 'createElement',
      ...(deferred ? { deferred: true } : {}),
      ...localOwnerEvidence,
      mode: 'create-element',
    });
  }

  if (isInsideStyledTemplateInterpolation(identifier, boundary)) {
    return Object.freeze({
      calleeName: 'styled',
      ...(deferred ? { deferred: true } : {}),
      factoryNames: Object.freeze(['styled']),
      ...localOwnerEvidence,
      mode: 'styled',
    });
  }

  const factoryNames = collectHocFactoryNames(identifier, boundary);
  if (factoryNames.length === 0) return undefined;
  const outermostFactory = factoryNames.at(-1);
  if (outermostFactory === undefined) return undefined;
  return Object.freeze({
    calleeName: outermostFactory,
    ...(deferred ? { deferred: true } : {}),
    factoryNames: Object.freeze(factoryNames),
    ...localOwnerEvidence,
    mode: classifyHocMode(factoryNames),
  });
}

/**
 * Retains named local React wrappers crossed before a top-level graph owner.
 *
 * A page can declare `const TaxDetailsModal = props => <DetailsModal {...props} />` inside a
 * render callback, then pass that local component through another component prop. The graph safely
 * connects the imported `DetailsModal` to the top-level page, but without this narrow syntax fact
 * the Inspector loses the local JSX name that owns the modal's `show` condition. PascalCase keeps
 * ordinary callbacks and event handlers out of the render corridor.
 */
function collectPreviewRenderLocalComponentOwnerNames(
  identifier: ts.Identifier,
  boundary: ts.Node,
): string[] {
  const names: string[] = [];
  let current: ts.Node = identifier.parent;
  while (current !== boundary && !ts.isSourceFile(current)) {
    if (
      ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current) ||
      ts.isFunctionDeclaration(current)
    ) {
      const name = readPreviewRenderLocalComponentOwnerName(current);
      if (name !== undefined && !names.includes(name)) names.push(name);
    }
    current = current.parent;
  }
  return names;
}

/** Reads only explicitly named PascalCase functions or const-initialized function expressions. */
function readPreviewRenderLocalComponentOwnerName(
  functionLike: ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression,
): string | undefined {
  if (functionLike.name !== undefined && /^[A-Z][A-Za-z0-9_$]*$/u.test(functionLike.name.text)) {
    return functionLike.name.text;
  }
  let current: ts.Node = functionLike;
  while (
    ts.isParenthesizedExpression(current.parent) ||
    ts.isAsExpression(current.parent) ||
    ts.isSatisfiesExpression(current.parent) ||
    ts.isNonNullExpression(current.parent)
  ) {
    current = current.parent;
  }
  const declaration = current.parent;
  return ts.isVariableDeclaration(declaration) &&
    declaration.initializer === current &&
    ts.isIdentifier(declaration.name) &&
    /^[A-Z][A-Za-z0-9_$]*$/u.test(declaration.name.text)
    ? declaration.name.text
    : undefined;
}

/**
 * Distinguishes JSX created by a dormant event/helper callback from JSX evaluated during render.
 *
 * A nested function is deferred unless syntax proves that the function is an IIFE or a callback of
 * a bounded synchronous render transform such as `map()` or `useMemo()`. This keeps collection
 * children on their authored path while exposing event-owned UI through a contextual sibling.
 */
function isPreviewRenderInvocationDeferred(identifier: ts.Identifier, boundary: ts.Node): boolean {
  let current: ts.Node = identifier.parent;
  while (!ts.isSourceFile(current)) {
    if (
      current !== boundary &&
      (ts.isArrowFunction(current) ||
        ts.isFunctionExpression(current) ||
        ts.isFunctionDeclaration(current)) &&
      !isSynchronouslyInvokedRenderFunction(current)
    ) {
      return true;
    }
    if (current === boundary) break;
    current = current.parent;
  }
  return false;
}

/** Reports whether syntax itself proves that one nested callback executes during render. */
function isSynchronouslyInvokedRenderFunction(
  functionLike: ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression,
): boolean {
  let wrapped: ts.Node = functionLike;
  while (
    ts.isParenthesizedExpression(wrapped.parent) ||
    ts.isAsExpression(wrapped.parent) ||
    ts.isSatisfiesExpression(wrapped.parent) ||
    ts.isNonNullExpression(wrapped.parent)
  ) {
    wrapped = wrapped.parent;
  }
  const call = wrapped.parent;
  if (!ts.isCallExpression(call)) return false;
  if (containsNode(call.expression, wrapped)) return true;
  if (!call.arguments.some((argument) => containsNode(argument, wrapped))) return false;
  const calleeName = readCallFactoryName(call.expression);
  return calleeName !== undefined && SYNCHRONOUS_RENDER_CALLBACKS.has(calleeName);
}

/**
 * Recognizes a component selector interpolated by a styled-components factory template.
 *
 * A component may be rendered in JSX and referenced again as `${Component}` in the same styled
 * shell. Treating the selector as ordinary helper data made the otherwise safe shallow projection
 * fail open and pulled the component's entire descendant graph back into fast preparation.
 */
function isInsideStyledTemplateInterpolation(
  identifier: ts.Identifier,
  boundary: ts.Node,
): boolean {
  let current: ts.Node = identifier;
  while (!ts.isSourceFile(current)) {
    if (ts.isTaggedTemplateExpression(current)) {
      const factoryName = readStyledTagFactoryName(current.tag);
      return factoryName === 'styled' && containsNode(current.template, identifier);
    }
    /*
     * A variable initializer such as `const Shell = styled(...)\`${Child}\`` is itself the value
     * analysis boundary. Inspect that final node before stopping; otherwise the selector looks like
     * an unrelated ordinary read even though the complete tagged template is statically present.
     */
    if (current === boundary) break;
    current = current.parent;
  }
  return false;
}

/** Reads `styled(Component)` and `styled.div` without admitting unrelated tagged templates. */
function readStyledTagFactoryName(expression: ts.LeftHandSideExpression): string | undefined {
  const current = unwrapExpression(expression);
  if (ts.isCallExpression(current)) return readCallFactoryName(current.expression);
  if (ts.isPropertyAccessExpression(current)) {
    const receiver = unwrapExpression(current.expression);
    if (ts.isIdentifier(receiver) && receiver.text === 'styled') return 'styled';
  }
  return readCallFactoryName(current);
}

/**
 * Finds an inline function passed as a component's direct JSX child.
 *
 * Libraries such as query/form renderers commonly defer their visual child until data is ready:
 * `<QueryRenderer>{(result) => <Target />}</QueryRenderer>`. The target reference is therefore a
 * real render-graph edge, but ordinary JSX ancestry does not describe that the parent must invoke a
 * callback first. Retaining this bounded syntax fact lets Page Inspector prioritize the renderer's
 * minimum payload instead of filling unrelated descendants while the selected target stays empty.
 */
function findContainingJsxChildRenderSlot(
  identifier: ts.Identifier,
  boundary: ts.Node,
): { readonly receiverName: string } | undefined {
  let current: ts.Node = identifier;
  while (current !== boundary && !ts.isSourceFile(current)) {
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      let wrapped: ts.Node = current;
      while (
        ts.isParenthesizedExpression(wrapped.parent) ||
        ts.isAsExpression(wrapped.parent) ||
        ts.isSatisfiesExpression(wrapped.parent) ||
        ts.isNonNullExpression(wrapped.parent)
      ) {
        wrapped = wrapped.parent;
      }
      const expression = wrapped.parent;
      const wrapper = expression.parent;
      if (
        ts.isJsxExpression(expression) &&
        ts.isJsxElement(wrapper) &&
        wrapper.children.includes(expression)
      ) {
        return { receiverName: wrapper.openingElement.tagName.getText() };
      }
      return undefined;
    }
    current = current.parent;
  }
  return undefined;
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
    /*
     * A function/class body executes after its surrounding factory call. Values read inside that
     * body are dependencies of the authored component, not component arguments of the outer HOC.
     * Without this boundary, `styled(() => { useData(); return <Header />; })` labels `useData`
     * and every constant in the callback as a `styled` component, allowing a shallow build to
     * replace runtime hooks with visual placeholders.
     */
    if (isNestedExecutionBoundary(current, boundary)) {
      break;
    }
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

/**
 * Reports a callable/class body nested below the analyzed top-level value.
 *
 * The boundary itself may be a function declaration whose body legitimately owns the reference,
 * so only descendants stop upward HOC inheritance. Arrow and function expressions passed directly
 * to `memo`, `forwardRef`, or `styled` are the important case: their internal reads must not inherit
 * the factory call that receives the function value.
 */
function isNestedExecutionBoundary(current: ts.Node, boundary: ts.Node): boolean {
  return (
    current !== boundary &&
    (ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current) ||
      ts.isFunctionDeclaration(current) ||
      ts.isClassExpression(current) ||
      ts.isClassDeclaration(current))
  );
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
