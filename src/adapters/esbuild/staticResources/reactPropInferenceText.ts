/** Collects direct text, template, overlay, and parameter requirements. */
import ts from 'typescript';
import { createPreviewSampleLabel } from '../previewSampleLabel';
import {
  inferReactOverlayVisibilityProp,
  type ReactOverlayStateVisibilityValue,
} from './reactOverlayVisibilityInference';
import { inferReactOverlayVisibilityTypePath } from './reactOverlayVisibilityTypeInference';
import {
  BLOCKED_PROPERTY_NAMES,
  type ExportedComponentFunction,
  type ExportedFunctionLike,
  type InferenceState,
  type LocalObjectType,
  type PropPathBinding,
} from './reactPropInferenceModel';
import {
  inferPreviewUsageSemanticFallback,
  isReactRenderedChildValueExpression,
  readFirstOptionalReceiverLength,
} from './reactPropInferenceOperations';
import {
  hasPreviewInferredPropTerminal,
  readMutablePathNode,
  requirePath,
} from './reactPropInferenceShape';
import {
  isAccessExpression,
  isIdentifierPartOfAccess,
  isNestedAccessReceiver,
  isShadowedPathRoot,
  readBindingPropertyName,
  readPropPath,
} from './reactPropInferenceSyntax';

/**
 * Gives a `children` slot the component's own label ("Button", "Section title") when the component
 * only renders it as direct JSX content. Its placeholder element showed an empty button in
 * target-only previews; any other use (`Children.map`, `cloneElement`, a call, a condition) keeps
 * the element, because those need a real element rather than text.
 */
export function labelDirectlyRenderedChildren(
  component: ExportedComponentFunction,
  state: InferenceState,
): void {
  const node = state.root.children.get('children');
  const body = component.functionLike.body;
  if (node?.kind !== 'element' || node.value !== undefined || body === undefined) return;
  const uses = { other: false, rendered: false };
  const visit = (current: ts.Node): void => {
    if (uses.other) return;
    if (
      (ts.isIdentifier(current) || ts.isPropertyAccessExpression(current)) &&
      !isNestedAccessReceiver(current) &&
      isChildrenPropReference(current, state)
    ) {
      if (isReactRenderedChildValueExpression(current)) uses.rendered = true;
      else uses.other = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(body);
  if (!uses.rendered || uses.other) return;
  const name =
    component.exportName === 'default'
      ? (readFunctionLikeName(component.functionLike) ?? 'Preview')
      : component.exportName;
  node.value = createPreviewSampleLabel(name);
}

/**
 * Marks text props that the component shows as-is (`<h1>{title}</h1>`). Only such leaves may take
 * a typed sample label: DateRangePicker parses `end` (`display(end)` split it into
 * "End.undefined.undefined"), so text read any other way keeps its neutral ''.
 */
export function markDirectlyRenderedTextProps(
  functionLike: ExportedFunctionLike,
  state: InferenceState,
): void {
  const body = functionLike.body;
  if (body === undefined) return;
  const visit = (current: ts.Node): void => {
    if (
      (ts.isIdentifier(current) || isAccessExpression(current)) &&
      !isNestedAccessReceiver(current) &&
      (!ts.isIdentifier(current) || isRuntimeValueReference(current)) &&
      isReactRenderedChildValueExpression(current)
    ) {
      const path_ = readPropPath(current, state.aliases);
      const node =
        path_ === undefined || path_.length === 0 || isShadowedPathRoot(current, state)
          ? undefined
          : readMutablePathNode(state, path_);
      if (node?.kind === 'string') node.renderedValue = true;
    }
    ts.forEachChild(current, visit);
  };
  visit(body);
}

/** Matches a runtime read that resolves to the root `children` prop. */
export function isChildrenPropReference(
  node: ts.Identifier | ts.PropertyAccessExpression,
  state: InferenceState,
): boolean {
  if (ts.isIdentifier(node) && !isRuntimeValueReference(node)) return false;
  const path_ = readPropPath(node, state.aliases);
  return path_?.length === 1 && path_[0] === 'children' && !isShadowedPathRoot(node, state);
}

/** Excludes declarations, property names, and JSX tag names from value references. */
export function isRuntimeValueReference(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  return !(
    (ts.isBindingElement(parent) &&
      (parent.name === identifier || parent.propertyName === identifier)) ||
    (ts.isParameter(parent) && parent.name === identifier) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === identifier) ||
    (ts.isPropertyAssignment(parent) && parent.name === identifier) ||
    (ts.isShorthandPropertyAssignment(parent) && parent.name === identifier) ||
    ts.isJsxAttribute(parent) ||
    ts.isJsxOpeningElement(parent) ||
    ts.isJsxClosingElement(parent) ||
    ts.isJsxSelfClosingElement(parent) ||
    ts.isTypeNode(parent)
  );
}

/** Reads a function's own name for a default export. */
export function readFunctionLikeName(functionLike: ExportedFunctionLike): string | undefined {
  if (functionLike.name !== undefined && ts.isIdentifier(functionLike.name)) {
    return functionLike.name.text;
  }
  const parent = functionLike.parent;
  return ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
    ? parent.name.text
    : undefined;
}

/**
 * Makes a prop read only as template text a string once every other rule has run. A read creates
 * an empty object receiver, so SegmentedControl's `${active ? 'bg-brand' : it.dot}` rendered
 * `class="… [object Object]"`. Only such empty objects change, to the name rule's value
 * (`count` → number) or neutral text; recorded members, values, and other kinds win, and an absent
 * leaf stays absent because `leadDays != null ? `${leadDays}일` : '—'` must keep its authored dash.
 */
export function collectTemplateTextReads(
  functionLike: ExportedFunctionLike,
  state: InferenceState,
): void {
  const body = functionLike.body;
  if (body === undefined) return;
  const visit = (node: ts.Node): void => {
    if (
      (ts.isIdentifier(node) || isAccessExpression(node)) &&
      !isNestedAccessReceiver(node) &&
      (!ts.isIdentifier(node) || !isIdentifierPartOfAccess(node)) &&
      isTemplateTextPosition(node)
    ) {
      const path_ = readPropPath(node, state.aliases);
      const existing = path_ === undefined ? undefined : readMutablePathNode(state, path_);
      if (
        path_ !== undefined &&
        path_.length > 0 &&
        !isShadowedPathRoot(node, state) &&
        existing?.kind === 'object' &&
        existing.children.size === 0 &&
        existing.collection === undefined
      ) {
        const semantic = inferPreviewUsageSemanticFallback(state, path_.at(-1) ?? '');
        if (semantic === undefined) requirePath(state, path_, 'string', 'usage');
        else requirePath(state, path_, semantic.kind, 'usage', semantic.value, semantic.exactValue);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
}

/** Follows value-preserving wrappers (`c ? a : x`, `x ?? ''`) to an untagged template or `'a' + x`. */
export function isTemplateTextPosition(node: ts.Expression): boolean {
  let current: ts.Node = node;
  for (let depth = 0; depth < 8; depth += 1) {
    const parent = current.parent;
    if (
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      (ts.isConditionalExpression(parent) && parent.condition !== current) ||
      (ts.isBinaryExpression(parent) &&
        (parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
          parent.operatorToken.kind === ts.SyntaxKind.BarBarToken))
    ) {
      current = parent;
      continue;
    }
    if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const other = parent.left === current ? parent.right : parent.left;
      return ts.isStringLiteralLike(other) || ts.isTemplateExpression(other);
    }
    return (
      ts.isTemplateSpan(parent) &&
      parent.expression === current &&
      ts.isTemplateExpression(parent.parent) &&
      !ts.isTaggedTemplateExpression(parent.parent.parent)
    );
  }
  return false;
}

/**
 * Materializes terminal fields read by a detached callback even when they are not rendered locally.
 * A callback supplied to `sumBy`, `groupBy`, or another collection utility consumes those leaves in
 * its caller, so retaining only their receiver containers would still produce an invalid item.
 */
export function collectRequiredPropertyReadTerminals(
  functionLike: ExportedFunctionLike,
  state: InferenceState,
): void {
  const body = functionLike.body;
  if (body === undefined) return;
  const visit = (node: ts.Node): void => {
    if (isAccessExpression(node) && !isNestedAccessReceiver(node)) {
      const path_ = readPropPath(node, state.aliases);
      const called = ts.isCallExpression(node.parent) && node.parent.expression === node;
      if (
        !called &&
        path_ !== undefined &&
        path_.length > 0 &&
        readFirstOptionalReceiverLength(node, state.aliases) === undefined &&
        !isShadowedPathRoot(node, state) &&
        !hasPreviewInferredPropTerminal(state, path_)
      ) {
        const semantic = inferPreviewUsageSemanticFallback(state, path_.at(-1) ?? '');
        requirePath(
          state,
          path_,
          semantic?.kind ?? 'object',
          'usage',
          semantic?.value,
          semantic?.exactValue,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
}

/**
 * Gives a directly previewed overlay its one visible state while retaining authored/user priority.
 * Exact visibility bindings win. A rest wrapper is admitted when an overlay-named component's
 * resolved contract proves one direct or nested visibility path; a bare untyped spread cannot prove
 * whether a project uses `show`, `open`, or another API. The inferred `usage` provenance keeps this
 * generated value visible and editable in Page Inspector rather than changing project source.
 */
export function addOverlayVisibilityRequirement(
  component: ExportedComponentFunction,
  localTypes: ReadonlyMap<string, LocalObjectType>,
  state: InferenceState,
  sourceFile: ts.SourceFile,
  overlayStateVisibility: ReactOverlayStateVisibilityValue | undefined,
): void {
  const functionLike = component.functionLike;
  if (component.classComponentProps === true || ts.isMethodDeclaration(functionLike)) return;
  const directPropName = inferReactOverlayVisibilityProp(functionLike, component.exportName);
  const visibilityPath =
    directPropName === undefined
      ? inferReactOverlayVisibilityTypePath(
          functionLike,
          component.exportName,
          component.contextualPropsType,
          sourceFile,
          localTypes,
        )
      : [directPropName];
  if (visibilityPath !== undefined) {
    requirePath(state, visibilityPath, 'boolean', 'usage', true, true);
  }
  if (overlayStateVisibility !== undefined) {
    requirePath(
      state,
      [overlayStateVisibility.propName],
      overlayStateVisibility.kind,
      'usage',
      overlayStateVisibility.value,
      true,
    );
    const renderedContent = overlayStateVisibility.renderedContent;
    if (renderedContent !== undefined) {
      const existing = readMutablePathNode(state, [renderedContent.propName]);
      if (existing?.kind === 'null' && existing.exactValue !== true) {
        existing.kind = 'string';
        existing.source = 'usage';
        existing.value = renderedContent.value;
      } else {
        requirePath(state, [renderedContent.propName], 'string', 'usage', renderedContent.value);
      }
    }
  }
}

/** Maps destructured/local prop bindings to their external root property paths. */
export function collectParameterBindings(
  bindingName: ts.BindingName,
  parentPath: readonly string[],
  aliases: Map<string, PropPathBinding>,
): void {
  if (ts.isIdentifier(bindingName)) {
    aliases.set(bindingName.text, { path: parentPath });
    return;
  }
  const objectBinding = ts.isObjectBindingPattern(bindingName);
  for (const element of bindingName.elements) {
    if (ts.isOmittedExpression(element)) continue;
    if (objectBinding && element.dotDotDotToken !== undefined && ts.isIdentifier(element.name)) {
      aliases.set(element.name.text, { path: parentPath });
      continue;
    }
    if (element.initializer !== undefined) continue;
    const propertyName = readBindingPropertyName(element);
    if (propertyName === undefined || BLOCKED_PROPERTY_NAMES.has(propertyName)) continue;
    collectParameterBindings(element.name, [...parentPath, propertyName], aliases);
  }
}
