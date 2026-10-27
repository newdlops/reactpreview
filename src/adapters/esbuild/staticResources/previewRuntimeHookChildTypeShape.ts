/** Merges child shapes and applies authored primitive semantic and literal hints. */
import ts from 'typescript';
import { type ShapeBudget, MAX_SHAPE_NODES } from './previewRuntimeHookChildTypeModel';
import { unwrapExpression, unwrapTypeNode } from './previewRuntimeHookChildTypeSyntax';
import { inferPreviewRuntimeSemanticFallback } from './previewRuntimeHookSemantics';
import { type PreviewInferredPropShape } from './reactExportPropInference';

/** Merges compatible structural shapes while letting an authored child type correct generic usage. */
export function mergePreviewRuntimeHookChildPropShapes(
  primary: PreviewInferredPropShape | undefined,
  secondary: PreviewInferredPropShape | undefined,
): PreviewInferredPropShape | undefined {
  return mergePropShapes(primary, secondary);
}

/** Recursively merges object properties and array item contracts into a frozen data-only shape. */
export function mergePropShapes(
  primary: PreviewInferredPropShape | undefined,
  secondary: PreviewInferredPropShape | undefined,
): PreviewInferredPropShape | undefined {
  if (primary === undefined) return secondary;
  if (secondary === undefined) return primary;
  if (primary.kind !== secondary.kind) {
    // Usage inference deliberately assigns a printable string/object to an otherwise untyped JSX
    // terminal. A resolved authored prop contract is stronger evidence for its runtime family, so
    // `data={patient.phoneNumbers}` must remain an Array rather than the label "phoneNumbers".
    return secondary;
  }
  if (primary.kind === 'array') {
    const items = mergePropShapes(primary.items, secondary.items);
    const minItems = Math.max(primary.minItems ?? 0, secondary.minItems ?? 0);
    return Object.freeze({
      kind: 'array',
      ...(items === undefined ? {} : { items }),
      ...(minItems === 0 ? {} : { minItems }),
      ...(primary.renderedCollection === true || secondary.renderedCollection === true
        ? { renderedCollection: true as const }
        : {}),
    });
  }
  if (primary.kind !== 'object') {
    const selected =
      primary.exactValue === true
        ? primary
        : secondary.exactValue === true
          ? secondary
          : primary.value === undefined
            ? secondary
            : primary;
    const candidateValues = [
      ...new Set([...(primary.candidateValues ?? []), ...(secondary.candidateValues ?? [])]),
    ].slice(0, 8);
    return candidateValues.length === 0
      ? selected
      : Object.freeze({ ...selected, candidateValues: Object.freeze(candidateValues) });
  }
  const properties: Record<string, PreviewInferredPropShape> = { ...(primary.properties ?? {}) };
  for (const [name, child] of Object.entries(secondary.properties ?? {})) {
    const merged = mergePropShapes(properties[name], child);
    if (merged !== undefined) properties[name] = merged;
  }
  return Object.freeze({ kind: 'object', properties: Object.freeze(properties) });
}

/**
 * Collects exact primitive values used by equality guards on named fields.
 *
 * A generated key-name string is structurally correct but can still be rejected by a route or enum
 * registry. An authored comparison such as `page.kind === "settings"` proves both the field's
 * domain and one valid scenario. The first source-ordered equality wins; inequality alone is not
 * treated as a valid member of the domain.
 */
export function collectPrimitivePropertyLiteralHints(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, boolean | number | string> {
  const hints = new Map<string, boolean | number | string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken)
    ) {
      appendPrimitivePropertyLiteralHint(node.left, node.right, hints);
      appendPrimitivePropertyLiteralHint(node.right, node.left, hints);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return hints;
}

/** Adds one `property === literal` pair without evaluating computed keys or expressions. */
export function appendPrimitivePropertyLiteralHint(
  propertyExpression: ts.Expression,
  literalExpression: ts.Expression,
  hints: Map<string, boolean | number | string>,
): void {
  const propertyName = readAccessPropertyName(unwrapExpression(propertyExpression));
  const literal = readPrimitiveExpression(literalExpression);
  if (propertyName !== undefined && literal !== undefined && !hints.has(propertyName)) {
    hints.set(propertyName, literal);
  }
}

/** Reads a direct static property name from dot or literal element access syntax. */
export function readAccessPropertyName(expression: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (
    ts.isElementAccessExpression(expression) &&
    ts.isStringLiteralLike(expression.argumentExpression)
  ) {
    return expression.argumentExpression.text;
  }
  return undefined;
}

/** Reads a primitive runtime literal without constant folding project expressions. */
export function readPrimitiveExpression(
  expression: ts.Expression,
): boolean | number | string | undefined {
  const current = unwrapExpression(expression);
  if (ts.isStringLiteralLike(current)) return current.text;
  if (ts.isNumericLiteral(current)) return Number(current.text);
  if (current.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (current.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

/** Applies the shared render-safe scalar for a typed field when its authored type agrees. */
export function applyPrimitiveSemanticHint(
  shape: PreviewInferredPropShape,
  propertyName: string,
): PreviewInferredPropShape {
  if (shape.value !== undefined) return shape;
  const semantic = inferPreviewRuntimeSemanticFallback(propertyName);
  const normalizedPropertyName = propertyName.replaceAll('_', '').toLowerCase();
  if (shape.kind === 'string') {
    // GraphQL commonly transports money as a decimal string even though reached components pass
    // it through Number/decimal formatters. Keep that typed contract while supplying parseable,
    // non-zero preview data; otherwise key-derived text produces NaN throughout amount UIs.
    if (normalizedPropertyName.endsWith('investmentamount')) {
      return Object.freeze({ ...shape, value: '100000000' });
    }
    // This bounded VCM-style discriminator is indexed against a min/max choice registry. `min` is
    // the least-assertive valid value and avoids rendering an undefined category label.
    if (normalizedPropertyName.endsWith('desiredinvestmentamountcategory')) {
      return Object.freeze({ ...shape, value: 'min' });
    }
    // Preserve string-backed numeric API contracts outside the investment-specific sample above.
    if (semantic?.kind === 'number' && semantic.value !== undefined) {
      return Object.freeze({ ...shape, value: String(semantic.value) });
    }
  }
  if (
    semantic?.kind !== shape.kind ||
    semantic.value === undefined ||
    (shape.kind !== 'string' && shape.kind !== 'number' && shape.kind !== 'boolean')
  ) {
    return shape;
  }
  return Object.freeze({ ...shape, value: semantic.value });
}

/** Applies a compatible source-proven literal to a neutral primitive type shape. */
export function applyPrimitiveLiteralHint(
  shape: PreviewInferredPropShape,
  hint: boolean | number | string | undefined,
): PreviewInferredPropShape {
  if (
    hint === undefined ||
    shape.value !== undefined ||
    (shape.kind === 'string' && typeof hint !== 'string') ||
    (shape.kind === 'number' && typeof hint !== 'number') ||
    (shape.kind === 'boolean' && typeof hint !== 'boolean') ||
    (shape.kind !== 'string' && shape.kind !== 'number' && shape.kind !== 'boolean')
  ) {
    return shape;
  }
  return Object.freeze({ ...shape, exactValue: true, value: hint });
}

/** Gives primitive/literal types stable neutral categories and literal values. */
export function readPrimitiveShape(typeNode: ts.TypeNode): PreviewInferredPropShape | undefined {
  if (typeNode.kind === ts.SyntaxKind.StringKeyword) return { kind: 'string' };
  if (
    typeNode.kind === ts.SyntaxKind.NumberKeyword ||
    typeNode.kind === ts.SyntaxKind.BigIntKeyword
  )
    return { kind: 'number' };
  if (typeNode.kind === ts.SyntaxKind.BooleanKeyword) return { kind: 'boolean' };
  if (!ts.isLiteralTypeNode(typeNode)) return undefined;
  if (ts.isStringLiteralLike(typeNode.literal))
    return { exactValue: true, kind: 'string', value: typeNode.literal.text };
  if (ts.isNumericLiteral(typeNode.literal))
    return { exactValue: true, kind: 'number', value: Number(typeNode.literal.text) };
  if (typeNode.literal.kind === ts.SyntaxKind.TrueKeyword)
    return { exactValue: true, kind: 'boolean', value: true };
  if (typeNode.literal.kind === ts.SyntaxKind.FalseKeyword)
    return { exactValue: true, kind: 'boolean', value: false };
  return undefined;
}

/** Counts one immutable shape node against the aggregate schema expansion budget. */
export function countShape(
  shape: PreviewInferredPropShape,
  budget: ShapeBudget,
): PreviewInferredPropShape | undefined {
  if (budget.nodes >= MAX_SHAPE_NODES) return undefined;
  budget.nodes += 1;
  return Object.freeze(shape);
}

/** Orders union members so useful browser primitives win over unresolved nominal objects. */
export function prioritizeUnionMembers(types: readonly ts.TypeNode[]): readonly ts.TypeNode[] {
  return [...types]
    .filter(
      (candidate) =>
        candidate.kind !== ts.SyntaxKind.NullKeyword &&
        candidate.kind !== ts.SyntaxKind.UndefinedKeyword &&
        candidate.kind !== ts.SyntaxKind.VoidKeyword,
    )
    .sort((left, right) => unionPriority(left) - unionPriority(right));
}

/** Ranks concrete primitives/structures before nominal references that may be unavailable. */
export function unionPriority(typeNode: ts.TypeNode): number {
  const current = unwrapTypeNode(typeNode);
  if (
    current.kind === ts.SyntaxKind.StringKeyword ||
    current.kind === ts.SyntaxKind.NumberKeyword ||
    current.kind === ts.SyntaxKind.BooleanKeyword ||
    ts.isLiteralTypeNode(current)
  )
    return 0;
  if (ts.isArrayTypeNode(current) || ts.isTupleTypeNode(current) || ts.isTypeLiteralNode(current))
    return 1;
  return 2;
}
