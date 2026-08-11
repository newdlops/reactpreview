/** Registers static render-prop collection demand against the exact GraphQL DocumentNode. */
import ts from 'typescript';
import { PREVIEW_COLLECTION_METHOD_NAMES } from '../previewCollectionMethodNames';
import type { PreviewSourceReplacement } from './previewSourceReplacement';
import type { PreviewRuntimeHookChildPropDemandCatalog } from './previewRuntimeHookChildPropDemand';
import type { PreviewInferredPropShape } from './reactExportPropInference';

const API = 'newdlops.react-file-preview.page-inspector';
const MAX_DEMANDS = 32;
const FIXED_QUERY_RENDERER_FACTORY = 'createContextFixedQueryRendererAndHook';
const FIXED_QUERY_RENDERER_MODULE_SUFFIX = '/query-renderer-context';
const COLLECTION_METHOD_NAMES = new Set<string>(PREVIEW_COLLECTION_METHOD_NAMES);
const CONNECTION_RELATIVE_PREFIX = '@connection.objectList';
const COLLECTION_CONFIG_CALLBACK_NAMES = new Set([
  'accessor',
  'cell',
  'formatter',
  'getValue',
  'render',
  'valueGetter',
]);

type PreviewGraphqlLiteralDemand = Readonly<{
  path: string;
  value: boolean | number | string;
}>;

/** Cheap source gate shared by the main transformer and this bounded syntax pass. */
export function mayContainPreviewGraphqlRenderPropUsage(sourceText: string): boolean {
  return (
    sourceText.includes('query=') ||
    sourceText.includes('QueryRenderer') ||
    sourceText.includes(FIXED_QUERY_RENDERER_FACTORY)
  );
}

/** Instruments inline JSX query render props without evaluating authored code during analysis. */
export function createPreviewGraphqlRenderPropUsageReplacements(
  sourcePath: string,
  sourceText: string,
  catalog: PreviewRuntimeHookChildPropDemandCatalog | undefined,
): readonly PreviewSourceReplacement[] {
  if (!mayContainPreviewGraphqlRenderPropUsage(sourceText)) return [];
  const file = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    readScriptKind(sourcePath),
  );
  if (
    (file as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics
      ?.length
  )
    return [];
  const replacements: PreviewSourceReplacement[] = [];
  const fixedFactoryBindings = collectFixedQueryRendererFactoryBindings(file);
  const visit = (node: ts.Node): void => {
    if (replacements.length >= MAX_DEMANDS) return;
    if (ts.isCallExpression(node)) {
      const replacement = createFixedQueryRendererFactoryReplacement(
        node,
        file,
        sourceText,
        fixedFactoryBindings,
      );
      if (replacement !== undefined) replacements.push(replacement);
    }
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
      if (render !== undefined && ts.isArrowFunction(render)) {
        const demand = collectDemandPaths(render, catalog);
        if (expression !== undefined && demand.paths.length > 0) {
          replacements.push({
            end: expression.end,
            replacement: `((previewDocument) => { const previewApi = globalThis[Symbol.for(${JSON.stringify(API)})]; return typeof previewApi?.registerGraphqlRenderPropUsage === 'function' ? previewApi.registerGraphqlRenderPropUsage(previewDocument, ${JSON.stringify(demand.paths)}, ${JSON.stringify(demand.literalDemands)}) : previewDocument; })(${sourceText.slice(expression.getStart(file), expression.end)})`,
            start: expression.getStart(file),
          });
        } else {
          const fixedRenderer = readFixedQueryRendererBinding(node);
          if (fixedRenderer !== undefined && demand.paths.length > 0) {
            replacements.push({
              end: render.end,
              replacement: `((previewRender) => { const previewApi = globalThis[Symbol.for(${JSON.stringify(API)})]; if (typeof previewApi?.registerGraphqlFixedRendererUsage === 'function') previewApi.registerGraphqlFixedRendererUsage(${fixedRenderer}, ${JSON.stringify(demand.paths)}, ${JSON.stringify(demand.literalDemands)}); return previewRender; })(${sourceText.slice(render.getStart(file), render.end)})`,
              start: render.getStart(file),
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return replacements;
}

/** Selects the parser mode matching one TypeScript or JavaScript source extension. */
function readScriptKind(sourcePath: string): ts.ScriptKind {
  if (sourcePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (sourcePath.endsWith('.ts')) return ts.ScriptKind.TS;
  if (sourcePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

/** Finds only the named workspace helper that binds a GraphQL document to one renderer tuple. */
function collectFixedQueryRendererFactoryBindings(file: ts.SourceFile): ReadonlySet<string> {
  const bindings = new Set<string>();
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.endsWith(FIXED_QUERY_RENDERER_MODULE_SUFFIX) ||
      statement.importClause?.namedBindings === undefined ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }
    for (const element of statement.importClause.namedBindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === FIXED_QUERY_RENDERER_FACTORY) {
        bindings.add(element.name.text);
      }
    }
  }
  return bindings;
}

/** Preserves one factory result while recording its exact renderer-to-document identity. */
function createFixedQueryRendererFactoryReplacement(
  call: ts.CallExpression,
  file: ts.SourceFile,
  sourceText: string,
  bindings: ReadonlySet<string>,
): PreviewSourceReplacement | undefined {
  if (
    !ts.isIdentifier(call.expression) ||
    !bindings.has(call.expression.text) ||
    call.arguments.length !== 1 ||
    (call.typeArguments?.length ?? 0) > 0
  ) {
    return undefined;
  }
  const document = call.arguments[0];
  if (document === undefined || !isStaticDocumentExpression(document)) return undefined;
  return {
    end: call.end,
    replacement: `((previewDocument) => { const previewResult = ${call.expression.text}(previewDocument); const previewApi = globalThis[Symbol.for(${JSON.stringify(API)})]; return typeof previewApi?.registerGraphqlFixedRenderer === 'function' ? previewApi.registerGraphqlFixedRenderer(previewResult, previewDocument) : previewResult; })(${sourceText.slice(document.getStart(file), document.end)})`,
    start: call.getStart(file),
  };
}

/** Accepts conventional fixed-query component bindings; unknown renderers remain runtime no-ops. */
function readFixedQueryRendererBinding(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): string | undefined {
  return ts.isIdentifier(node.tagName) && node.tagName.text.endsWith('QueryRenderer')
    ? node.tagName.text
    : undefined;
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
    return expression !== undefined && ts.isArrowFunction(expression) ? expression : undefined;
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
      if (directPath !== undefined && shape !== undefined)
        appendShape(paths, directPath, shape, 0, literalDemands);
      if (shape !== undefined) {
        appendMappedPropShape(paths, attributeExpression, bindings, shape);
      }
      const itemPath = [...items.entries()]
        .map(
          ([name, prefix]) =>
            [name, readPath(attributeExpression, new Map([[name, prefix]])), prefix] as const,
        )
        .find((entry) => entry[1] !== undefined);
      if (itemPath !== undefined && ts.isIdentifier(component)) {
        if (shape !== undefined)
          appendShape(paths, [...itemPath[2], ...(itemPath[1] ?? [])], shape, 0, literalDemands);
      }
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      appendSiblingCollectionRendererDemands(node, bindings, catalog, paths, literalDemands);
    }
    ts.forEachChild(node, visit);
  };
  visit(render.body);
  const normalizedPaths = [...paths]
    .map(toConnectionRelativePath)
    .filter((path) => path !== 'data.[]')
    .sort()
    .slice(0, MAX_DEMANDS);
  return {
    literalDemands: [...literalDemands.values()]
      .map((demand) => ({ ...demand, path: toConnectionRelativePath(demand.path) }))
      .slice(0, MAX_DEMANDS),
    paths: normalizedPaths,
  };
}

/** Traces a collection JSX prop through sibling columns/fields renderer callbacks. */
function appendSiblingCollectionRendererDemands(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  bindings: ReadonlyMap<string, readonly string[]>,
  catalog: PreviewRuntimeHookChildPropDemandCatalog | undefined,
  paths: Set<string>,
  literalDemands: Map<string, PreviewGraphqlLiteralDemand>,
): void {
  const collectionPaths = node.attributes.properties.flatMap((attribute) => {
    if (
      !ts.isJsxAttribute(attribute) ||
      !ts.isIdentifier(attribute.name) ||
      attribute.initializer === undefined ||
      !ts.isJsxExpression(attribute.initializer) ||
      attribute.initializer.expression === undefined ||
      !/^(?:data|items|objectList|records|results|rows|values)$/u.test(attribute.name.text)
    )
      return [];
    const path = readPath(attribute.initializer.expression, bindings);
    return path?.at(-1) === 'objectList' ? [path] : [];
  });
  const [collection] = collectionPaths;
  if (collection === undefined || collectionPaths.length !== 1) return;
  for (const attribute of node.attributes.properties) {
    if (
      !ts.isJsxAttribute(attribute) ||
      !ts.isIdentifier(attribute.name) ||
      attribute.initializer === undefined ||
      !ts.isJsxExpression(attribute.initializer) ||
      attribute.initializer.expression === undefined ||
      !/^(?:columns|fields)$/iu.test(attribute.name.text)
    )
      continue;
    const visit = (candidate: ts.Node): void => {
      if (
        (ts.isArrowFunction(candidate) ||
          ts.isFunctionExpression(candidate) ||
          ts.isMethodDeclaration(candidate)) &&
        candidate.name !== undefined &&
        ts.isIdentifier(candidate.name) &&
        COLLECTION_CONFIG_CALLBACK_NAMES.has(candidate.name.text) &&
        candidate.parameters[0] !== undefined
      ) {
        paths.add([...collection, '[]'].join('.'));
        const itemBindings = new Map(
          [...collectCallbackItemBindings(candidate.parameters[0])].map(
            ([name, relative]) => [name, [...collection, '[]', ...relative]] as const,
          ),
        );
        if (candidate.body !== undefined)
          appendRendererJsxDemands(candidate.body, itemBindings, catalog, paths, literalDemands);
      }
      ts.forEachChild(candidate, visit);
    };
    visit(attribute.initializer.expression);
  }
}

/** Applies imported child contracts reached within one item renderer. */
function appendRendererJsxDemands(
  node: ts.Node,
  bindings: ReadonlyMap<string, readonly string[]>,
  catalog: PreviewRuntimeHookChildPropDemandCatalog | undefined,
  paths: Set<string>,
  literalDemands: Map<string, PreviewGraphqlLiteralDemand>,
): void {
  const visit = (candidate: ts.Node): void => {
    if (
      ts.isJsxAttribute(candidate) &&
      ts.isIdentifier(candidate.name) &&
      candidate.initializer !== undefined &&
      ts.isJsxExpression(candidate.initializer) &&
      candidate.initializer.expression !== undefined
    ) {
      const component = candidate.parent.parent.tagName;
      const shape = ts.isIdentifier(component)
        ? catalog?.get(component.text)?.get(candidate.name.text)
        : undefined;
      const path =
        shape === undefined ? undefined : readPath(candidate.initializer.expression, bindings);
      if (path !== undefined && shape !== undefined)
        appendShape(paths, path, shape, 0, literalDemands);
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
}

/** Replaces an unknown response wrapper with a runtime-resolved connection-relative path. */
function toConnectionRelativePath(path: string): string {
  const segments = path.split('.');
  const objectList = segments.indexOf('objectList');
  return objectList < 0 || segments[objectList + 1] !== '[]'
    ? path
    : [CONNECTION_RELATIVE_PREFIX, ...segments.slice(objectList + 1)].join('.');
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
  const itemPath = leftPath ?? rightPath;
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
    (expression.operator === ts.SyntaxKind.MinusToken ||
      expression.operator === ts.SyntaxKind.PlusToken) &&
    ts.isNumericLiteral(expression.operand)
  ) {
    const value =
      Number(expression.operand.text) * (expression.operator === ts.SyntaxKind.MinusToken ? -1 : 1);
    return Number.isFinite(value) ? value : undefined;
  }
  return undefined;
}

/** Maps direct, aliased, and nested callback data bindings to canonical data paths. */
function collectDataBindings(
  parameter: ts.ParameterDeclaration | undefined,
): Map<string, readonly string[]> {
  const bindings = new Map<string, readonly string[]>();
  if (parameter === undefined || !ts.isObjectBindingPattern(parameter.name)) return bindings;
  for (const element of parameter.name.elements) {
    if (element.dotDotDotToken !== undefined) continue;
    if (isDataProperty(element)) appendBinding(bindings, element.name, ['data']);
    else if (isObjectListProperty(element)) appendBinding(bindings, element.name, ['objectList']);
  }
  return bindings;
}

/** Recognizes the conventional data wrapper exposed by query render props. */
function isDataProperty(element: ts.BindingElement): boolean {
  return (
    (element.propertyName === undefined &&
      ts.isIdentifier(element.name) &&
      element.name.text === 'data') ||
    (element.propertyName !== undefined &&
      ts.isIdentifier(element.propertyName) &&
      element.propertyName.text === 'data')
  );
}

/** Recognizes the direct collection contract exposed by typed list query renderers. */
function isObjectListProperty(element: ts.BindingElement): boolean {
  return (
    (element.propertyName === undefined &&
      ts.isIdentifier(element.name) &&
      element.name.text === 'objectList') ||
    (element.propertyName !== undefined &&
      ts.isIdentifier(element.propertyName) &&
      element.propertyName.text === 'objectList')
  );
}

/** Recursively records one destructured binding and its response-relative path. */
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
    if (property !== undefined)
      appendBinding(bindings, element.name, [...path, property], depth + 1);
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
      ([name, relativePath]) => [name, [...collection, '[]', ...relativePath]] as const,
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
    const initializer = ts.isPropertyAssignment(property) ? property.initializer : property.name;
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
  literalDemands?: Map<string, PreviewGraphqlLiteralDemand>,
): void {
  if (depth > 8 || paths.size >= MAX_DEMANDS) return;
  if (shape.kind === 'array') {
    paths.add([...prefix, '[]'].join('.'));
    if (shape.items !== undefined)
      appendShape(paths, [...prefix, '[]'], shape.items, depth + 1, literalDemands);
    return;
  }
  if (shape.kind === 'object')
    for (const [name, child] of Object.entries(shape.properties ?? {}))
      appendShape(paths, [...prefix, name], child, depth + 1, literalDemands);
  else if (
    shape.exactValue === true &&
    shape.value !== undefined &&
    shape.value !== null &&
    literalDemands !== undefined
  ) {
    const path = prefix.join('.');
    literalDemands.set(path, { path, value: shape.value });
  }
}
