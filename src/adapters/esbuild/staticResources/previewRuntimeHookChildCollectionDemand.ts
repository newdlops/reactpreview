/** Infers child collection callbacks and serializes their bounded shape contracts. */
import ts from 'typescript';
import {
  BLOCKED_PROP_NAMES,
  JSX_COLLECTION_ACTION_CALLBACK_NAMES,
  JSX_COLLECTION_ACTION_CONFIG_PROP_NAMES,
  JSX_COLLECTION_DIRECT_CALLBACK_PROP_NAMES,
  JSX_COLLECTION_FIELD_CALLBACK_NAMES,
  JSX_COLLECTION_FIELD_CONFIG_PROP_NAMES,
  JSX_COLLECTION_FIELD_KEY_NAMES,
  JSX_COLLECTION_ITEM_WRAPPER_NAMES,
  JSX_COLLECTION_PROP_NAMES,
  type PreviewRuntimeHookLocalTypeFallback,
} from './previewRuntimeHookChildDemandModel';
import { functionShadowsName } from './previewRuntimeHookChildDemandSyntax';
import { mergePreviewRuntimeHookChildPropShapes } from './previewRuntimeHookChildTypeDemand';
import {
  isPreviewRuntimeHookJsxCollectionCarrier,
  isPreviewRuntimeHookJsxCollectionExpressionCarrier,
} from './previewRuntimeHookJsxCollectionCarrier';
import { inferPreviewRuntimeSemanticFallback } from './previewRuntimeHookSemantics';
import {
  findNearestPreviewRuntimeFunction,
  isPreviewRuntimeFunction,
  unwrapPreviewRuntimeExpression,
} from './previewRuntimeHookSyntax';
import { createPreviewGeneratedListExpression } from './previewRuntimeHookUsageTree';
import {
  inferReactFunctionParameterUsageShape,
  type PreviewInferredPropShape,
} from './reactExportPropInference';

/**
 * Correlates one hook-fed JSX collection with row contracts authored beside that exact prop.
 *
 * Generic table/grid packages often expose their row type only through sibling configuration:
 * `data={rows}`, `columns={[{ key: 'title', formatter: row => row.startDate }]}`, and
 * `getID={row => row.id}`. The package implementation may live outside the inspectable workspace,
 * but these local literals and callback reads still prove the generated row fields. Only familiar
 * collection/config prop names and direct static callbacks participate; arbitrary child props stay
 * opaque.
 */
export function inferPreviewRuntimeHookJsxCollectionItemFallback(
  identifier: ts.Identifier,
  exactCollectionExpression?: ts.Expression,
): PreviewRuntimeHookLocalTypeFallback | undefined {
  const owner = findNearestPreviewRuntimeFunction(identifier);
  if (owner === undefined) return undefined;
  if (
    exactCollectionExpression !== undefined &&
    !isPreviewRuntimeHookNestedJsxCollectionValue(exactCollectionExpression)
  ) {
    return undefined;
  }
  let itemShape: PreviewInferredPropShape | undefined;

  const mergeItemShape = (shape: PreviewInferredPropShape | undefined): void => {
    if (shape?.kind !== 'object') return;
    itemShape = mergePreviewRuntimeHookChildPropShapes(itemShape, shape);
  };
  const appendField = (fieldName: string): void => {
    if (fieldName.length === 0 || fieldName.length > 128 || BLOCKED_PROP_NAMES.has(fieldName)) {
      return;
    }
    const semantic = inferPreviewRuntimeSemanticFallback(fieldName);
    const scalarKind =
      semantic?.kind === 'boolean' ||
      semantic?.kind === 'null' ||
      semantic?.kind === 'number' ||
      semantic?.kind === 'string'
        ? semantic.kind
        : 'string';
    const value = scalarKind === semantic?.kind ? semantic.value : fieldName;
    mergeItemShape(
      Object.freeze({
        kind: 'object',
        properties: Object.freeze({
          [fieldName]: Object.freeze({
            kind: scalarKind,
            ...(value === undefined ? {} : { value }),
          }),
        }),
      }),
    );
  };
  const appendCallback = (callback: ts.ArrowFunction | ts.FunctionExpression): void => {
    const inferred = inferReactFunctionParameterUsageShape(callback, 0);
    const wrappers =
      inferred?.kind === 'object'
        ? Object.entries(inferred.properties ?? {}).filter(
            ([name, child]) =>
              JSX_COLLECTION_ITEM_WRAPPER_NAMES.has(name.toLowerCase()) && child.kind === 'object',
          )
        : [];
    mergeItemShape(wrappers.length === 1 ? wrappers[0]?.[1] : inferred);
  };
  const collectConfig = (
    expression: ts.Expression,
    fieldConfig: boolean,
    callbackNames: ReadonlySet<string>,
  ): void => {
    const visitConfig = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node)) {
        const propertyName = readPreviewRuntimeHookStaticPropertyName(node.name)?.toLowerCase();
        const initializer = unwrapPreviewRuntimeExpression(node.initializer);
        if (
          fieldConfig &&
          propertyName !== undefined &&
          JSX_COLLECTION_FIELD_KEY_NAMES.has(propertyName) &&
          ts.isStringLiteralLike(initializer)
        ) {
          appendField(initializer.text);
        }
        if (
          propertyName !== undefined &&
          callbackNames.has(propertyName) &&
          (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
        ) {
          appendCallback(initializer);
          return;
        }
      }
      ts.forEachChild(node, visitConfig);
    };
    visitConfig(expression);
  };

  const visit = (node: ts.Node): void => {
    if (
      node !== owner &&
      isPreviewRuntimeFunction(node) &&
      functionShadowsName(node, identifier.text)
    ) {
      return;
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attributes = node.attributes.properties;
      const collectionAttribute = attributes.find((attribute) => {
        if (
          !ts.isJsxAttribute(attribute) ||
          attribute.initializer === undefined ||
          !ts.isJsxExpression(attribute.initializer) ||
          attribute.initializer.expression === undefined
        ) {
          return false;
        }
        const propName = readPreviewRuntimeHookJsxAttributeName(attribute)?.toLowerCase();
        const value = unwrapPreviewRuntimeExpression(attribute.initializer.expression);
        return (
          propName !== undefined &&
          JSX_COLLECTION_PROP_NAMES.has(propName) &&
          (exactCollectionExpression === undefined
            ? isPreviewRuntimeHookJsxCollectionCarrier(value, identifier.text)
            : isPreviewRuntimeHookJsxCollectionExpressionCarrier(value, exactCollectionExpression))
        );
      });
      if (collectionAttribute !== undefined) {
        for (const attribute of attributes) {
          if (
            !ts.isJsxAttribute(attribute) ||
            attribute.initializer === undefined ||
            !ts.isJsxExpression(attribute.initializer) ||
            attribute.initializer.expression === undefined
          ) {
            continue;
          }
          const propName = readPreviewRuntimeHookJsxAttributeName(attribute)?.toLowerCase();
          if (propName === undefined) continue;
          const expression = unwrapPreviewRuntimeExpression(attribute.initializer.expression);
          if (
            JSX_COLLECTION_DIRECT_CALLBACK_PROP_NAMES.has(propName) &&
            (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression))
          ) {
            appendCallback(expression);
          } else if (JSX_COLLECTION_FIELD_CONFIG_PROP_NAMES.has(propName)) {
            collectConfig(expression, true, JSX_COLLECTION_FIELD_CALLBACK_NAMES);
          } else if (JSX_COLLECTION_ACTION_CONFIG_PROP_NAMES.has(propName)) {
            collectConfig(expression, false, JSX_COLLECTION_ACTION_CALLBACK_NAMES);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);

  if (itemShape?.kind !== 'object' || Object.keys(itemShape.properties ?? {}).length === 0) {
    return undefined;
  }
  return Object.freeze({
    expression: serializePreviewRuntimeHookChildShape(itemShape, 'row'),
    kind: 'object',
    label: 'generated row from JSX collection configuration',
    requiredPaths: Object.freeze(collectPreviewRuntimeHookChildShapePaths(itemShape)),
  });
}

/** Quickly rejects property reads that cannot be the value of a familiar JSX collection prop. */
export function isPreviewRuntimeHookNestedJsxCollectionValue(expression: ts.Expression): boolean {
  let current: ts.Node = expression;
  for (let depth = 0; depth <= 8; depth += 1) {
    const parent = current.parent;
    if (ts.isJsxExpression(parent) && parent.expression === current) {
      const attribute = parent.parent;
      if (!ts.isJsxAttribute(attribute)) return false;
      const propName = readPreviewRuntimeHookJsxAttributeName(attribute)?.toLowerCase();
      return propName !== undefined && JSX_COLLECTION_PROP_NAMES.has(propName);
    }
    if (isPreviewRuntimeFunction(parent)) return false;
    if (!ts.isExpression(parent)) return false;
    current = parent;
  }
  return false;
}

/** Reads one ordinary JSX attribute name without admitting namespace syntax. */
export function readPreviewRuntimeHookJsxAttributeName(
  attribute: ts.JsxAttribute,
): string | undefined {
  return ts.isIdentifier(attribute.name) ? attribute.name.text : undefined;
}

/** Reads one prototype-safe static object-literal property name. */
export function readPreviewRuntimeHookStaticPropertyName(
  name: ts.PropertyName,
): string | undefined {
  const propertyName =
    ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)
      ? name.text
      : undefined;
  return propertyName === undefined || BLOCKED_PROP_NAMES.has(propertyName)
    ? undefined
    : propertyName;
}

/** Serializes one compiler-proven child item shape into a side-effect-free frozen value. */
export function serializePreviewRuntimeHookChildShape(
  shape: PreviewInferredPropShape,
  propertyName: string,
): string {
  if (shape.kind === 'array') {
    return shape.items === undefined
      ? 'Object.freeze([])'
      : createPreviewGeneratedListExpression(
          serializePreviewRuntimeHookChildShape(shape.items, propertyName),
        );
  }
  if (shape.kind === 'boolean')
    return typeof shape.value === 'boolean' ? String(shape.value) : 'false';
  if (shape.kind === 'null') return 'null';
  if (shape.kind === 'number')
    return typeof shape.value === 'number' && Number.isFinite(shape.value)
      ? String(shape.value)
      : '0';
  if (shape.kind === 'string')
    return JSON.stringify(typeof shape.value === 'string' ? shape.value : propertyName);
  if (shape.kind === 'function') return 'Object.freeze(() => undefined)';
  if (shape.kind === 'component') return 'Object.freeze(() => null)';
  if (shape.kind === 'element') return JSON.stringify('Preview');
  const properties = Object.entries(shape.properties ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([name, child]) =>
        `${JSON.stringify(name)}: ${serializePreviewRuntimeHookChildShape(child, name)}`,
    );
  return `Object.freeze({${properties.length === 0 ? '' : ` ${properties.join(', ')} `}})`;
}

/** Flattens nested array/item requirements into the runtime hook diagnostic path notation. */
export function collectPreviewRuntimeHookChildShapePaths(
  shape: PreviewInferredPropShape,
  prefix = '',
): readonly string[] {
  if (shape.kind === 'array') {
    const collectionPath = prefix.length === 0 ? '<root>' : `${prefix}.map()`;
    if (shape.items === undefined) return [collectionPath];
    const itemPrefix = prefix.length === 0 ? '<root>' : `${prefix}[]`;
    return [collectionPath, ...collectPreviewRuntimeHookChildShapePaths(shape.items, itemPrefix)];
  }
  if (shape.kind !== 'object') return prefix.length === 0 ? ['<root>'] : [prefix];
  const paths = Object.entries(shape.properties ?? {}).flatMap(([name, child]) =>
    collectPreviewRuntimeHookChildShapePaths(
      child,
      prefix.length === 0 ? name : `${prefix}.${name}`,
    ),
  );
  return paths.length === 0 && prefix.length > 0 ? [prefix] : paths;
}
