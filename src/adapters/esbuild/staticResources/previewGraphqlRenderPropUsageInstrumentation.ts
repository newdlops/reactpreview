/** Registers static render-prop collection demand against the exact GraphQL DocumentNode. */
import ts from 'typescript';
import type { PreviewSourceReplacement } from './previewSourceReplacement';
import type { PreviewRuntimeHookChildPropDemandCatalog } from './previewRuntimeHookChildPropDemand';
import type { PreviewInferredPropShape } from './reactExportPropInference';

const API = 'newdlops.react-file-preview.page-inspector';
const MAX_DEMANDS = 32;

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
      const callback = node.attributes.properties.find(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          ts.isIdentifier(attribute.name) &&
          (attribute.name.text === 'render' || attribute.name.text === 'children') &&
          attribute.initializer !== undefined &&
          ts.isJsxExpression(attribute.initializer) &&
          attribute.initializer.expression !== undefined &&
          ts.isArrowFunction(attribute.initializer.expression),
      ) as ts.JsxAttribute | undefined;
      const expression =
        query?.initializer && ts.isJsxExpression(query.initializer)
          ? query.initializer.expression
          : undefined;
      const render =
        callback?.initializer && ts.isJsxExpression(callback.initializer)
          ? callback.initializer.expression
          : undefined;
      if (expression !== undefined && render !== undefined && ts.isArrowFunction(render)) {
        const paths = collectDemandPaths(render, catalog);
        if (paths.length > 0)
          replacements.push({
            end: expression.end,
            replacement: `((previewDocument) => { const previewApi = globalThis[Symbol.for(${JSON.stringify(API)})]; return typeof previewApi?.registerGraphqlRenderPropUsage === 'function' ? previewApi.registerGraphqlRenderPropUsage(previewDocument, ${JSON.stringify(paths)}) : previewDocument; })(${sourceText.slice(expression.getStart(file), expression.end)})`,
            start: expression.getStart(file),
          });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return replacements;
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
): readonly string[] {
  const data =
    render.parameters[0] && ts.isObjectBindingPattern(render.parameters[0].name)
      ? render.parameters[0].name.elements.find(
          (element) =>
            element.propertyName === undefined &&
            ts.isIdentifier(element.name) &&
            element.name.text === 'data',
        )
      : undefined;
  if (data === undefined || !ts.isIdentifier(data.name)) return [];
  const dataName = data.name.text;
  const paths = new Set<string>();
  const items = new Map<string, readonly string[]>();
  const visit = (node: ts.Node): void => {
    const mapCallback = ts.isCallExpression(node) ? node.arguments[0] : undefined;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'map' &&
      mapCallback !== undefined &&
      ts.isArrowFunction(mapCallback)
    ) {
      const collection = readPath(node.expression.expression, dataName);
      const parameter = mapCallback.parameters[0];
      if (collection !== undefined && parameter !== undefined && ts.isIdentifier(parameter.name)) {
        paths.add('data.' + collection.join('.') + '.[]');
        items.set(parameter.name.text, ['data', ...collection, '[]']);
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
      const itemPath = [...items.entries()]
        .map(([name, prefix]) => [name, readPath(attributeExpression, name), prefix] as const)
        .find((entry) => entry[1] !== undefined);
      const component = node.parent.parent.tagName;
      if (itemPath !== undefined && ts.isIdentifier(component)) {
        const shape = catalog?.get(component.text)?.get(node.name.text);
        if (shape !== undefined)
          appendShape(paths, [...itemPath[2], ...(itemPath[1] ?? [])], shape, 0);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(render.body);
  return [...paths]
    .filter((path) => path !== 'data.[]')
    .sort()
    .slice(0, MAX_DEMANDS);
}

/** Reads a direct, non-optional property chain rooted at one local binding. */
function readPath(expression: ts.Expression, root: string): readonly string[] | undefined {
  const result: string[] = [];
  let current = expression;
  while (ts.isPropertyAccessExpression(current) && current.questionDotToken === undefined) {
    result.unshift(current.name.text);
    current = current.expression;
  }
  return ts.isIdentifier(current) && current.text === root ? result : undefined;
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
