/** Registers static render-prop collection demand against the exact GraphQL DocumentNode. */
import ts from 'typescript';
import { PREVIEW_COLLECTION_METHOD_NAMES } from '../previewCollectionMethodNames';
import type { PreviewSourceReplacement } from './previewSourceReplacement';
import type { PreviewRuntimeHookChildPropDemandCatalog } from './previewRuntimeHookChildPropDemand';
import type { PreviewInferredPropShape } from './reactExportPropInference';

const API = 'newdlops.react-file-preview.page-inspector';
const MAX_DEMANDS = 32;
const COLLECTION_METHOD_NAMES = new Set<string>(PREVIEW_COLLECTION_METHOD_NAMES);

type PreviewGraphqlLiteralDemand = Readonly<{
  path: string;
  value: boolean | number | string;
}>;

/** Instruments inline JSX query render props without evaluating authored code during analysis. */
export function createPreviewGraphqlRenderPropUsageReplacements(
  sourcePath: string,
  sourceText: string,
  catalog: PreviewRuntimeHookChildPropDemandCatalog | undefined,
): readonly PreviewSourceReplacement[] {
  if (!sourceText.includes('query=') || !sourceText.includes('=>')) return [];
  const file = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    sourcePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.JSX,
  );
  if (
    (file as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics
      ?.length
  )
    return [];
  const replacements: PreviewSourceReplacement[] = [];
  const visit = (node: ts.Node): void => {
    if (replacements.length >= MAX_DEMANDS) return;
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const query = node.attributes.properties.find(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          ts.isIdentifier(attribute.name) &&
          attribute.name.text === 'query' &&
          attribute.initializer !== undefined &&
          ts.isJsxExpression(attribute.initializer) &&
          attribute.initializer.expression !== undefined &&
          isStaticDocumentExpression(attribute.initializer.expression),
      ) as ts.JsxAttribute | undefined;
      const render = readInlineRenderProp(node);
      const expression =
        query?.initializer && ts.isJsxExpression(query.initializer)
          ? query.initializer.expression
          : undefined;
      if (expression !== undefined && render !== undefined && ts.isArrowFunction(render)) {
        const demand = collectDemandPaths(render, catalog);
        if (demand.paths.length > 0)
          replacements.push({
            end: expression.end,
            replacement: `((previewDocument) => { const previewApi = globalThis[Symbol.for(${JSON.stringify(API)})]; return typeof previewApi?.registerGraphqlRenderPropUsage === 'function' ? previewApi.registerGraphqlRenderPropUsage(previewDocument, ${JSON.stringify(demand.paths)}, ${JSON.stringify(demand.literalDemands)}) : previewDocument; })(${sourceText.slice(expression.getStart(file), expression.end)})`,
            start: expression.getStart(file),
          });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return replacements;
}

/** Finds one direct attribute or JSX-child render callback for the owning element. */
function readInlineRenderProp(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): ts.ArrowFunction | undefined {
  const attribute = node.attributes.properties.find(
    (candidate) =>
      ts.isJsxAttribute(candidate) &&
      ts.isIdentifier(candidate.name) &&
      (candidate.name.text === 'render' || candidate.name.text === 'children') &&
      candidate.initializer !== undefined &&
      ts.isJsxExpression(candidate.initializer) &&
      candidate.initializer.expression !== undefined &&
      ts.isArrowFunction(candidate.initializer.expression),
  ) as ts.JsxAttribute | undefined;
  if (attribute?.initializer && ts.isJsxExpression(attribute.initializer)) {
    const expression = attribute.initializer.expression;
    return expression !== undefined && ts.isArrowFunction(expression)
      ? expression
      : undefined;
  }
  if (!ts.isJsxOpeningElement(node) || !ts.isJsxElement(node.parent)) return undefined;
  const child = node.parent.children.find(
    (candidate) =>
      ts.isJsxExpression(candidate) &&
      candidate.expression !== undefined &&
      ts.isArrowFunction(candidate.expression),
  ) as ts.JsxExpression | undefined;
  const childExpression = child?.expression;
  return childExpression !== undefined && ts.isArrowFunction(childExpression)
    ? childExpression
    : undefined;
}

/** Accepts only direct identifier/property document references. */
function isStaticDocumentExpression(expression: ts.Expression): boolean {
  let current: ts.Expression = expression;
  while (ts.isPropertyAccessExpression(current)) current = current.expression;
  return ts.isIdentifier(current);
}

/** Extracts collection and imported-child array requirements from one inline callback. */
function collectDemandPaths(
  render: ts.ArrowFunction,
  catalog: PreviewRuntimeHookChildPropDemandCatalog | undefined,
): Readonly<{
  literalDemands: readonly PreviewGraphqlLiteralDemand[];
  paths: readonly string[];
}> {
  const bindings = collectDataBindings(render.parameters[0]);
  if (bindings.size === 0) return { literalDemands: [], paths: [] };
  const paths = new Set<string>();
  const literalDemands = new Map<string, PreviewGraphqlLiteralDemand>();
  const items = new Map<string, readonly string[]>();
  const visit = (node: ts.Node): void => {
    const mapCallback = ts.isCallExpression(node) ? node.arguments[0] : undefined;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      COLLECTION_METHOD_NAMES.has(node.expression.name.text) &&
      node.expression.name.text === 'map' &&
      mapCallback !== undefined &&
      ts.isArrowFunction(mapCallback)
    ) {
      const collection = readPath(node.expression.expression, bindings);
      const parameter = mapCallback.parameters[0];
      if (collection !== undefined && parameter !== undefined && ts.isIdentifier(parameter.name)) {
        paths.add([...collection, '[]'].join('.'));
        items.set(parameter.name.text, [...collection, '[]']);
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      COLLECTION_METHOD_NAMES.has(node.expression.name.text)
    ) {
      const collection = readPath(node.expression.expression, bindings);
      if (collection !== undefined) paths.add([...collection, '[]'].join('.'));
      if (node.expression.name.text === 'find' && collection !== undefined) {
        const literalDemand = readFindLiteralDemand(node.arguments[0], [...collection, '[]']);
        if (literalDemand !== undefined && !literalDemands.has(literalDemand.path)) {
          literalDemands.set(literalDemand.path, literalDemand);
        }
      }
    }
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression !== undefined
    ) {
      const attributeExpression = node.initializer.expression;
      const component = node.parent.parent.tagName;
      const shape = ts.isIdentifier(component)
        ? catalog?.get(component.text)?.get(node.name.text)
        : undefined;
      const directPath = readPath(attributeExpression, bindings);
      if (directPath !== undefined && shape !== undefined) appendShape(paths, directPath, shape, 0);
      if (shape !== undefined) {
        appendMappedPropShape(paths, attributeExpression, bindings, shape);
      }
      const itemPath = [...items.entries()]
        .map(([name, prefix]) => [name, readPath(attributeExpression, new Map([[name, prefix]])), prefix] as const)
        .find((entry) => entry[1] !== undefined);
      if (itemPath !== undefined && ts.isIdentifier(component)) {
        if (shape !== undefined)
          appendShape(paths, [...itemPath[2], ...(itemPath[1] ?? [])], shape, 0);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(render.body);
  const normalizedPaths = [...paths]
    .filter((path) => path !== 'data.[]')
    .sort()
    .slice(0, MAX_DEMANDS);
  return {
    literalDemands: [...literalDemands.values()].slice(0, MAX_DEMANDS),
    paths: normalizedPaths,
  };
}

/** Reads one direct callback-item equality against a finite primitive literal. */
function readFindLiteralDemand(
  callback: ts.Expression | undefined,
  collectionPath: readonly string[],
): PreviewGraphqlLiteralDemand | undefined {
  if (callback === undefined || !ts.isArrowFunction(callback) || callback.parameters.length === 0) {
    return undefined;
  }
  const parameter = callback.parameters[0];
  if (parameter === undefined) return undefined;
  const bindings = collectCallbackItemBindings(parameter);
  if (bindings.size === 0 || !ts.isBinaryExpression(callback.body)) return undefined;
  if (
    callback.body.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsToken &&
    callback.body.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken
  ) {
    return undefined;
  }
  const leftPath = readPath(callback.body.left, bindings);
  const rightPath = readPath(callback.body.right, bindings);
  const leftValue = readPrimitiveLiteral(callback.body.left);
  const rightValue = readPrimitiveLiteral(callback.body.right);
  const itemPath = leftPath === undefined ? rightPath : leftPath;
  const value = leftPath === undefined ? leftValue : rightValue;
  return itemPath === undefined || value === undefined
    ? undefined
    : { path: [...collectionPath, ...itemPath].join('.'), value };
}

/** Maps a direct identifier or object-destructured .find item parameter to its item-relative path. */
function collectCallbackItemBindings(
  parameter: ts.ParameterDeclaration,
): Map<string, readonly string[]> {
  const bindings = new Map<string, readonly string[]>();
  if (ts.isIdentifier(parameter.name)) bindings.set(parameter.name.text, []);
  else if (ts.isObjectBindingPattern(parameter.name)) appendBinding(bindings, parameter.name, []);
  return bindings;
}

/** Accepts only exact finite number, Boolean, and string syntax literals. */
function readPrimitiveLiteral(expression: ts.Expression): boolean | number | string | undefined {
  if (ts.isStringLiteral(expression)) return expression.text;
  if (ts.isNumericLiteral(expression)) {
    const value = Number(expression.text);
    return Number.isFinite(value) ? value : undefined;
  }
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (
    ts.isPrefixUnaryExpression(expression) &&
    (expression.operator === ts.SyntaxKind.MinusToken || expression.operator === ts.SyntaxKind.PlusToken) &&
    ts.isNumericLiteral(expression.operand)
  ) {
    const value = Number(expression.operand.text) * (expression.operator === ts.SyntaxKind.MinusToken ? -1 : 1);
    return Number.isFinite(value) ? value : undefined;
  }
  return undefined;
}

/** Maps direct, aliased, and nested callback data bindings to canonical data paths. */
function collectDataBindings(parameter: ts.ParameterDeclaration | undefined): Map<string, readonly string[]> {
  const bindings = new Map<string, readonly string[]>();
  if (parameter === undefined || !ts.isObjectBindingPattern(parameter.name)) return bindings;
  for (const element of parameter.name.elements) {
    if (element.dotDotDotToken !== undefined || !isDataProperty(element)) continue;
    appendBinding(bindings, element.name, ['data']);
  }
  return bindings;
}

function isDataProperty(element: ts.BindingElement): boolean {
  return (
    (element.propertyName === undefined && ts.isIdentifier(element.name) && element.name.text === 'data') ||
    (element.propertyName !== undefined &&
      ts.isIdentifier(element.propertyName) &&
      element.propertyName.text === 'data')
  );
}

function appendBinding(
  bindings: Map<string, readonly string[]>,
  name: ts.BindingName,
  path: readonly string[],
  depth = 0,
): void {
  if (depth > 8 || bindings.size >= MAX_DEMANDS) return;
  if (ts.isIdentifier(name)) {
    bindings.set(name.text, path);
    return;
  }
  if (!ts.isObjectBindingPattern(name)) return;
  for (const element of name.elements) {
    if (element.dotDotDotToken !== undefined) continue;
    const propertyName = element.propertyName;
    const property =
      element.propertyName === undefined && ts.isIdentifier(element.name)
        ? element.name.text
        : propertyName !== undefined && ts.isIdentifier(propertyName)
          ? propertyName.text
          : undefined;
    if (property !== undefined) appendBinding(bindings, element.name, [...path, property], depth + 1);
  }
}

/**
 * Projects an imported child's array prop requirements through one direct authored `.map`.
 * The callback may select or rename item fields before passing them to JSX; only exact callback
 * item paths and compiler-inferred Array shapes are retained.
 */
function appendMappedPropShape(
  paths: Set<string>,
  expression: ts.Expression,
  bindings: ReadonlyMap<string, readonly string[]>,
  shape: PreviewInferredPropShape,
): void {
  if (shape.kind !== 'array' || shape.items === undefined) return;
  const value = unwrapExpression(expression);
  if (
    !ts.isCallExpression(value) ||
    !ts.isPropertyAccessExpression(value.expression) ||
    value.expression.name.text !== 'map'
  ) {
    return;
  }
  const collection = readPath(value.expression.expression, bindings);
  const callback = value.arguments[0];
  if (
    collection === undefined ||
    callback === undefined ||
    (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) ||
    callback.parameters[0] === undefined
  ) {
    return;
  }
  paths.add([...collection, '[]'].join('.'));
  const returned = readMappedReturnExpression(callback);
  if (returned === undefined) return;
  const relativeBindings = collectCallbackItemBindings(callback.parameters[0]);
  const itemBindings = new Map(
    [...relativeBindings].map(
      ([name, relativePath]) =>
        [name, [...collection, '[]', ...relativePath]] as const,
    ),
  );
  appendMappedResultShape(paths, returned, itemBindings, shape.items);
}

/** Reads one expression-bodied callback or one unambiguous top-level returned expression. */
function readMappedReturnExpression(
  callback: ts.ArrowFunction | ts.FunctionExpression,
): ts.Expression | undefined {
  if (!ts.isBlock(callback.body)) return callback.body;
  const returns = callback.body.statements.filter(
    (statement): statement is ts.ReturnStatement =>
      ts.isReturnStatement(statement) && statement.expression !== undefined,
  );
  return returns.length === 1 ? returns[0]?.expression : undefined;
}

/** Maps array-item output fields back to exact callback-item source paths. */
function appendMappedResultShape(
  paths: Set<string>,
  expression: ts.Expression,
  bindings: ReadonlyMap<string, readonly string[]>,
  shape: PreviewInferredPropShape,
): void {
  const value = unwrapExpression(expression);
  const directPath = readPath(value, bindings);
  if (directPath !== undefined) {
    appendShape(paths, directPath, shape, 0);
    return;
  }
  if (shape.kind !== 'object' || !ts.isObjectLiteralExpression(value)) return;
  for (const property of value.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
      continue;
    }
    const propertyName = readObjectPropertyName(property.name);
    const childShape = propertyName === undefined ? undefined : shape.properties?.[propertyName];
    if (childShape === undefined) continue;
    const initializer = ts.isPropertyAssignment(property)
      ? property.initializer
      : property.name;
    const sourcePath = readPath(initializer, bindings);
    if (sourcePath !== undefined) appendShape(paths, sourcePath, childShape, 0);
  }
}

/** Reads only prototype-safe static object-literal keys. */
function readObjectPropertyName(name: ts.PropertyName | undefined): string | undefined {
  if (
    name === undefined ||
    (!ts.isIdentifier(name) && !ts.isStringLiteral(name) && !ts.isNumericLiteral(name))
  ) {
    return undefined;
  }
  return ['__proto__', 'constructor', 'prototype'].includes(name.text) ? undefined : name.text;
}

/** Removes syntax-only expression wrappers while retaining every authored property hop. */
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

/** Reads a direct or optional property chain rooted at a callback binding. */
function readPath(
  expression: ts.Expression,
  bindings: ReadonlyMap<string, readonly string[]>,
): readonly string[] | undefined {
  const result: string[] = [];
  let current = expression;
  while (ts.isPropertyAccessExpression(current)) {
    result.unshift(current.name.text);
    current = current.expression;
  }
  const root = ts.isIdentifier(current) ? bindings.get(current.text) : undefined;
  return root === undefined ? undefined : [...root, ...result];
}

/** Appends only Array-bearing paths from a previously syntax-proven child prop shape. */
function appendShape(
  paths: Set<string>,
  prefix: readonly string[],
  shape: PreviewInferredPropShape,
  depth: number,
): void {
  if (depth > 8 || paths.size >= MAX_DEMANDS) return;
  if (shape.kind === 'array') {
    paths.add([...prefix, '[]'].join('.'));
    if (shape.items !== undefined) appendShape(paths, [...prefix, '[]'], shape.items, depth + 1);
    return;
  }
  if (shape.kind === 'object')
    for (const [name, child] of Object.entries(shape.properties ?? {}))
      appendShape(paths, [...prefix, name], child, depth + 1);
}
