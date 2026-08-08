/**
 * Recovers the visible scalar of an enum/Boolean overlay `state` prop for target-only Smart Fill.
 *
 * The ordinary fallback deliberately stays dormant. This evidence is consumed only after the
 * selected component mounted without output, preventing unrelated page overlays from opening.
 */
import ts from 'typescript';
import { isReactOverlayComponentName } from './reactOverlayVisibilityInference';
import {
  findNearestPreviewRuntimeFunction,
  isPreviewRuntimeFunction,
  previewRuntimeFunctionShadowsName,
  unwrapPreviewRuntimeExpression,
} from './previewRuntimeHookSyntax';

const OVERLAY_STATE_PROP_NAMES = new Set(['state', 'visibilitystate']);
const VISIBLE_STATE_NAMES = new Set([
  'active',
  'default',
  'expanded',
  'open',
  'opened',
  'present',
  'show',
  'shown',
  'visible',
]);
const HIDDEN_STATE_NAMES = new Set([
  'close',
  'closed',
  'collapsed',
  'dormant',
  'hidden',
  'inactive',
  'none',
]);

/** A side-effect-free authored expression evaluated only when Smart Fill opens this exact target. */
export interface PreviewRuntimeHookOverlayStateDemand {
  readonly expression: string;
}

/**
 * Infers a visible enum member or Boolean from one hook-bound local used by an overlay state prop.
 */
export function inferPreviewRuntimeHookOverlayStateDemand(
  identifier: ts.Identifier,
  sourceFile: ts.SourceFile,
): PreviewRuntimeHookOverlayStateDemand | undefined {
  const owner = findNearestPreviewRuntimeFunction(identifier);
  if (owner === undefined) return undefined;
  let directStateCarrier = false;
  const conditionalValues = new Set<string>();

  const visitRenderedSyntax = (node: ts.Node): void => {
    if (node !== owner && isPreviewRuntimeFunction(node)) return;
    if (ts.isJsxAttribute(node) && isOverlayStateAttribute(node, sourceFile)) {
      const expression =
        node.initializer !== undefined && ts.isJsxExpression(node.initializer)
          ? node.initializer.expression
          : undefined;
      if (expression !== undefined) {
        const unwrapped = unwrapPreviewRuntimeExpression(expression);
        if (isIdentifierReference(unwrapped, identifier.text)) {
          directStateCarrier = true;
        } else if (ts.isConditionalExpression(unwrapped)) {
          const condition = readTrackedBooleanCondition(unwrapped.condition, identifier.text);
          const whenTrue = classifyStateExpression(unwrapped.whenTrue);
          const whenFalse = classifyStateExpression(unwrapped.whenFalse);
          if (condition !== undefined && whenTrue !== whenFalse) {
            if (whenTrue === 'visible' && whenFalse === 'hidden') {
              conditionalValues.add(condition ? 'true' : 'false');
            } else if (whenTrue === 'hidden' && whenFalse === 'visible') {
              conditionalValues.add(condition ? 'false' : 'true');
            }
          }
        }
      }
    }
    ts.forEachChild(node, visitRenderedSyntax);
  };
  visitRenderedSyntax(owner);
  if (conditionalValues.size === 1) {
    return Object.freeze({ expression: [...conditionalValues][0] ?? 'true' });
  }
  if (!directStateCarrier) return undefined;

  const visibleValues = new Set<string>();
  const visitComparisons = (node: ts.Node): void => {
    if (
      node !== owner &&
      isPreviewRuntimeFunction(node) &&
      previewRuntimeFunctionShadowsName(node, identifier.text)
    ) {
      return;
    }
    if (ts.isBinaryExpression(node) && isEqualityOperator(node.operatorToken.kind)) {
      const left = unwrapPreviewRuntimeExpression(node.left);
      const right = unwrapPreviewRuntimeExpression(node.right);
      const peer = isIdentifierReference(left, identifier.text)
        ? right
        : isIdentifierReference(right, identifier.text)
          ? left
          : undefined;
      if (peer !== undefined && classifyStateExpression(peer) === 'visible') {
        visibleValues.add(peer.getText(sourceFile));
      }
    }
    ts.forEachChild(node, visitComparisons);
  };
  visitComparisons(owner);
  return visibleValues.size === 1
    ? Object.freeze({ expression: [...visibleValues][0] ?? 'true' })
    : undefined;
}

/** Requires both an overlay-shaped JSX tag and its explicit enum-like `state` prop. */
function isOverlayStateAttribute(attribute: ts.JsxAttribute, sourceFile: ts.SourceFile): boolean {
  const propName = attribute.name.getText(sourceFile).replace(/[-_]/gu, '').toLowerCase();
  if (!OVERLAY_STATE_PROP_NAMES.has(propName)) return false;
  const opening = attribute.parent.parent;
  if (!ts.isJsxOpeningElement(opening) && !ts.isJsxSelfClosingElement(opening)) return false;
  return opening.tagName
    .getText(sourceFile)
    .split('.')
    .some((segment) => isReactOverlayComponentName(segment));
}

/** Reads `flag`/`!flag` without widening to compound application conditions. */
function readTrackedBooleanCondition(expression: ts.Expression, name: string): boolean | undefined {
  const value = unwrapPreviewRuntimeExpression(expression);
  if (isIdentifierReference(value, name)) return true;
  return ts.isPrefixUnaryExpression(value) &&
    value.operator === ts.SyntaxKind.ExclamationToken &&
    isIdentifierReference(unwrapPreviewRuntimeExpression(value.operand), name)
    ? false
    : undefined;
}

/** Classifies only explicit enum/member terminal names; arbitrary string values remain ambiguous. */
function classifyStateExpression(expression: ts.Expression): 'hidden' | 'visible' | undefined {
  const value = unwrapPreviewRuntimeExpression(expression);
  const terminalName = ts.isPropertyAccessExpression(value)
    ? value.name.text
    : ts.isElementAccessExpression(value) &&
        value.argumentExpression !== undefined &&
        ts.isStringLiteralLike(value.argumentExpression)
      ? value.argumentExpression.text
      : undefined;
  if (terminalName === undefined) return undefined;
  const normalized = terminalName.replace(/[-_]/gu, '').toLowerCase();
  if (VISIBLE_STATE_NAMES.has(normalized)) return 'visible';
  if (HIDDEN_STATE_NAMES.has(normalized)) return 'hidden';
  return undefined;
}

/** Supports ordinary equality while leaving relational/coercion expressions untouched. */
function isEqualityOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    kind === ts.SyntaxKind.EqualsEqualsToken
  );
}

function isIdentifierReference(expression: ts.Expression, name: string): boolean {
  return ts.isIdentifier(expression) && expression.text === name;
}
