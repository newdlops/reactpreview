/**
 * Infers the one positive visibility prop that can reveal a directly previewed React overlay.
 *
 * This syntax-only helper deliberately avoids resolving application types. An explicit binding is
 * strongest evidence. A rest wrapper is admitted only when an overlay-named owner forwards a
 * same-named rest property into an explicit overlay visibility attribute; a bare spread remains
 * ambiguous because libraries disagree on `show`, `open`, and related contracts.
 */
import ts from 'typescript';

const OVERLAY_COMPONENT_NAME_PATTERN =
  /(?:modal|dialog|drawer|popover|popper|overlay|portal|sheet|lightbox|tooltip|toast|dropdown|menu)$/iu;
const POSITIVE_OVERLAY_VISIBILITY_PROPS = new Set([
  'defaultopen',
  'defaultvisible',
  'expanded',
  'isopen',
  'isvisible',
  'open',
  'present',
  'show',
  'shown',
  'visible',
]);

/** Function-like component body accepted without invoking TypeScript's type checker. */
export type ReactOverlayFunctionLike =
  ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression;

/**
 * Returns one generated-true prop name, or `undefined` when visibility remains a user choice.
 *
 * @param functionLike Exact same-file function reached through the exported HOC chain.
 * @param exportName Public export identity used when the function itself is anonymous.
 */
export function inferReactOverlayVisibilityProp(
  functionLike: ReactOverlayFunctionLike,
  exportName: string,
): string | undefined {
  const ownerName = readFunctionLikeName(functionLike) ?? exportName;
  if (!OVERLAY_COMPONENT_NAME_PATTERN.test(ownerName)) return undefined;
  const parameter = functionLike.parameters[0];
  if (parameter === undefined || !ts.isObjectBindingPattern(parameter.name)) return undefined;
  const explicitPaths = parameter.name.elements.flatMap((element) => {
    if (element.dotDotDotToken !== undefined) return [];
    const propertyName = readBindingPropertyName(element);
    return propertyName !== undefined &&
      POSITIVE_OVERLAY_VISIBILITY_PROPS.has(normalizeVisibilityPropName(propertyName))
      ? [propertyName]
      : [];
  });
  if (explicitPaths.length === 1) return explicitPaths[0];
  if (explicitPaths.length > 1) return undefined;
  const restName = parameter.name.elements.find(
    (element) => element.dotDotDotToken !== undefined && ts.isIdentifier(element.name),
  )?.name;
  if (restName === undefined || !ts.isIdentifier(restName)) return undefined;
  const overlayOpening = findForwardedOverlayOpening(functionLike.body, restName.text);
  return overlayOpening === undefined
    ? undefined
    : readExplicitForwardedVisibilityProp(overlayOpening, restName.text);
}

/** Reads a stable authored owner name through the local HOC function candidate. */
function readFunctionLikeName(functionLike: ReactOverlayFunctionLike): string | undefined {
  const name =
    ts.isFunctionDeclaration(functionLike) || ts.isFunctionExpression(functionLike)
      ? functionLike.name
      : undefined;
  if (name !== undefined) return name.text;
  const parent = functionLike.parent;
  return ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
    ? parent.name.text
    : undefined;
}

/** Finds an overlay JSX tag that receives the exact object-rest binding from component props. */
function findForwardedOverlayOpening(
  body: ts.ConciseBody | undefined,
  restName: string,
): ts.JsxOpeningElement | ts.JsxSelfClosingElement | undefined {
  if (body === undefined) return undefined;
  let selected: ts.JsxOpeningElement | ts.JsxSelfClosingElement | undefined;
  const visit = (node: ts.Node): void => {
    if (selected !== undefined) return;
    if (
      ts.isJsxSpreadAttribute(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === restName &&
      ts.isJsxAttributes(node.parent)
    ) {
      const opening = node.parent.parent;
      if (ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening)) {
        const tag = opening.tagName.getText();
        if (tag.split('.').some((segment) => OVERLAY_COMPONENT_NAME_PATTERN.test(segment))) {
          selected = opening;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return selected;
}

/**
 * Reads one same-named rest property explicitly forwarded into the overlay's visibility attribute.
 * A bare spread supplies no evidence whether `Modal` means `show`, `open`, or another project API,
 * so ambiguous wrappers remain observed-only and editable in the Inspector.
 */
function readExplicitForwardedVisibilityProp(
  opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  restName: string,
): string | undefined {
  const candidates = opening.attributes.properties.flatMap((property) => {
    if (!ts.isJsxAttribute(property)) return [];
    const initializer = property.initializer;
    if (initializer === undefined || !ts.isJsxExpression(initializer)) return [];
    const attributeName = property.name.getText();
    if (!POSITIVE_OVERLAY_VISIBILITY_PROPS.has(normalizeVisibilityPropName(attributeName))) {
      return [];
    }
    const expression = initializer.expression;
    if (
      expression === undefined ||
      !ts.isPropertyAccessExpression(expression) ||
      !ts.isIdentifier(expression.expression) ||
      expression.expression.text !== restName ||
      normalizeVisibilityPropName(expression.name.text) !==
        normalizeVisibilityPropName(attributeName)
    ) {
      return [];
    }
    return [attributeName];
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** Returns the external key of a simple object-binding field without evaluating computed names. */
function readBindingPropertyName(element: ts.BindingElement): string | undefined {
  const name = element.propertyName ?? element.name;
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

/** Normalizes common `isOpen`/`is_open` spellings without admitting arbitrary property names. */
function normalizeVisibilityPropName(value: string): string {
  return value.replaceAll('_', '').toLowerCase();
}
