/**
 * Recovers a bounded viewport-relative dimension for a hook value used by inline JSX layout.
 *
 * A dormant drawer can have the correct visible state while remaining clipped at width zero. This
 * demand is emitted only as target-guided Smart metadata, and only when a width/height-named hook
 * binding directly feeds the matching property of a JSX `style` object.
 */
import ts from 'typescript';
import {
  findNearestPreviewRuntimeFunction,
  isPreviewRuntimeFunction,
  type PreviewRuntimeFunction,
} from './previewRuntimeHookSyntax';

/** One side-effect-free scalar keyed relative to the analyzed hook-result binding. */
export interface PreviewRuntimeHookLayoutDimensionDemand {
  readonly expression: string;
  readonly path: '<root>';
}

type PreviewRuntimeLayoutAxis = 'height' | 'width';

/**
 * Finds a direct `style={{ width: currentWidth }}` or height equivalent in the owning component.
 *
 * Name and syntax must agree. This excludes ordinary numeric hook fields and data objects, while a
 * viewport cap keeps a generated drawer inside narrow preview canvases.
 */
export function inferPreviewRuntimeHookLayoutDimensionDemand(
  identifier: ts.Identifier,
): PreviewRuntimeHookLayoutDimensionDemand | undefined {
  const axis = readPreviewRuntimeLayoutAxis(identifier.text);
  const owner = findNearestPreviewRuntimeFunction(identifier);
  if (axis === undefined || owner === undefined) return undefined;
  if (!hasPreviewRuntimeJsxDimensionUse(owner, owner, identifier.text, axis)) return undefined;
  const viewportName = axis === 'width' ? 'innerWidth' : 'innerHeight';
  const cap = axis === 'width' ? 520 : 640;
  return Object.freeze({
    expression: `(Math.max(1, Math.min(${String(cap)}, Number(globalThis.${viewportName}) || ${String(cap)})))`,
    path: '<root>',
  });
}

/** Recursively finds the matching JSX style leaf without crossing another function scope. */
function hasPreviewRuntimeJsxDimensionUse(
  node: ts.Node,
  owner: PreviewRuntimeFunction,
  identifierName: string,
  axis: PreviewRuntimeLayoutAxis,
): boolean {
  if (node !== owner && isPreviewRuntimeFunction(node)) return false;
  if (
    ts.isPropertyAssignment(node) &&
    readPreviewRuntimePropertyName(node.name) === axis &&
    isPreviewRuntimeJsxStyleProperty(node) &&
    containsPreviewRuntimeIdentifier(node.initializer, identifierName, owner)
  ) {
    return true;
  }
  return (
    ts.forEachChild(node, (child) =>
      hasPreviewRuntimeJsxDimensionUse(child, owner, identifierName, axis) ? child : undefined,
    ) !== undefined
  );
}

/** Recognizes only explicit dimension names rather than generic size/count fields. */
function readPreviewRuntimeLayoutAxis(name: string): PreviewRuntimeLayoutAxis | undefined {
  if (/width$/iu.test(name)) return 'width';
  if (/height$/iu.test(name)) return 'height';
  return undefined;
}

/** Reads a non-computed object-literal property name. */
function readPreviewRuntimePropertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;
}

/** Proves that the property belongs to an inline JSX `style` object. */
function isPreviewRuntimeJsxStyleProperty(node: ts.PropertyAssignment): boolean {
  const object = node.parent;
  const expression = ts.isObjectLiteralExpression(object) ? object.parent : undefined;
  const attribute =
    expression !== undefined && ts.isJsxExpression(expression) ? expression.parent : undefined;
  return (
    attribute !== undefined &&
    ts.isJsxAttribute(attribute) &&
    ts.isIdentifier(attribute.name) &&
    attribute.name.text === 'style'
  );
}

/** Finds the exact local binding while refusing to cross another function scope. */
function containsPreviewRuntimeIdentifier(
  node: ts.Node,
  name: string,
  owner: PreviewRuntimeFunction,
): boolean {
  let found = false;
  const visit = (current: ts.Node): void => {
    if (found || (current !== node && current !== owner && isPreviewRuntimeFunction(current))) {
      return;
    }
    if (ts.isIdentifier(current) && current.text === name) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}
