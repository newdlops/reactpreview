/** Enumerates object route descriptors and RouterProvider delegates. */
import ts from 'typescript';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';
import type { PreviewInspectorDirectRouteChoice } from './previewInspectorDirectRouteChoiceTypes';
import {
  type ImportedBinding,
  MAXIMUM_DIRECT_ROUTE_CHOICES,
  type ParsedRouteModule,
} from './previewInspectorDirectRouteModel';
import {
  createDirectRoutePattern,
  findObjectProperty,
  isRouterDescriptorCall,
  readImportedExpressionBinding,
  readJsxExpressionAttribute,
  readStaticObjectBooleanProperty,
  readStaticObjectStringProperty,
  unwrapExpression,
} from './previewInspectorDirectRouteSyntax';
import { addDynamicImportChoice, addExpressionChoice } from './previewInspectorDirectRouteTargets';

/** Collects descriptor arrays passed to exact React Router factory/useRoutes imports. */
export function collectObjectRouteChoices(
  parsed: ParsedRouteModule,
  sourcePath: string,
  choices: PreviewInspectorDirectRouteChoice[],
  resolveModule: ResolvePreviewRenderGraphModule | undefined,
  enqueueDelegate: (binding: ImportedBinding, consumerPath: string) => void,
  descriptorExportName: string | undefined,
): void {
  const roots: ts.Expression[] = [];
  const visitCalls = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isRouterDescriptorCall(node.expression, parsed)) {
      const firstArgument = node.arguments[0];
      if (firstArgument !== undefined) {
        const imported = readImportedExpressionBinding(firstArgument, parsed);
        if (imported !== undefined) enqueueDelegate(imported, sourcePath);
        else roots.push(firstArgument);
      }
    }
    ts.forEachChild(node, visitCalls);
  };
  visitCalls(parsed.sourceFile);
  const exportedRoot = readExportedDescriptorExpression(parsed, descriptorExportName);
  if (exportedRoot !== undefined) roots.push(exportedRoot);
  const visited = new Set<ts.Node>();
  const visitDescriptor = (
    node: ts.Node,
    parentSegments: readonly string[],
    parentResolution: PreviewInspectorDirectRouteChoice['pathResolution'],
  ): void => {
    if (choices.length >= MAXIMUM_DIRECT_ROUTE_CHOICES || visited.has(node)) return;
    visited.add(node);
    const expression = ts.isExpression(node) ? unwrapExpression(node) : node;
    if (ts.isIdentifier(expression)) {
      const initializer = parsed.initializers.get(expression.text);
      if (initializer !== undefined) visitDescriptor(initializer, parentSegments, parentResolution);
      return;
    }
    if (ts.isArrayLiteralExpression(expression)) {
      for (const element of expression.elements) {
        visitDescriptor(
          ts.isSpreadElement(element) ? element.expression : element,
          parentSegments,
          parentResolution,
        );
      }
      return;
    }
    if (!ts.isObjectLiteralExpression(expression)) return;
    const pathProperty = findObjectProperty(expression, ['path']);
    const routePath = readStaticObjectStringProperty(expression, 'path');
    const isIndex = readStaticObjectBooleanProperty(expression, 'index') === true;
    const routeSegments =
      routePath === undefined
        ? parentSegments
        : routePath.startsWith('/')
          ? [routePath]
          : [...parentSegments, routePath];
    const pathResolution =
      routePath === undefined
        ? pathProperty === undefined
          ? parentResolution
          : 'unresolved'
        : routePath.startsWith('/')
          ? 'resolved'
          : parentResolution;
    const routePattern = createDirectRoutePattern(routeSegments, pathResolution, isIndex);
    const componentProperty = findObjectProperty(expression, ['Component', 'component', 'element']);
    const lazyProperty = findObjectProperty(expression, ['lazy']);
    const childrenProperty = findObjectProperty(expression, ['children']);
    if (
      (childrenProperty === undefined || isIndex) &&
      (routePath !== undefined || isIndex || componentProperty !== undefined)
    ) {
      addExpressionChoice(
        componentProperty?.initializer,
        routePattern,
        parsed,
        sourcePath,
        choices,
        resolveModule,
        pathResolution,
        pathProperty?.initializer,
      );
      if (componentProperty === undefined && lazyProperty !== undefined) {
        addDynamicImportChoice(
          lazyProperty.initializer,
          routePattern,
          parsed,
          sourcePath,
          choices,
          resolveModule,
          pathResolution,
          pathProperty?.initializer,
        );
      }
    }
    if (childrenProperty !== undefined) {
      visitDescriptor(childrenProperty.initializer, routeSegments, pathResolution);
    }
    for (const property of expression.properties) {
      if (ts.isSpreadAssignment(property))
        visitDescriptor(property.expression, parentSegments, parentResolution);
    }
  };
  for (const root of roots) visitDescriptor(root, [], 'resolved');
}

/** Finds an imported descriptor aggregate's exact named/default export without evaluating it. */
export function readExportedDescriptorExpression(
  parsed: ParsedRouteModule,
  exportName: string | undefined,
): ts.Expression | undefined {
  if (exportName === undefined || exportName === '*') return undefined;
  if (exportName === 'default') {
    return parsed.sourceFile.statements.find(ts.isExportAssignment)?.expression;
  }
  const directInitializer = parsed.initializers.get(exportName);
  if (directInitializer !== undefined) return directInitializer;
  for (const statement of parsed.sourceFile.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.exportClause === undefined ||
      !ts.isNamedExports(statement.exportClause)
    ) {
      continue;
    }
    const element = statement.exportClause.elements.find(
      (candidate) => candidate.name.text === exportName,
    );
    const localName = element?.propertyName?.text ?? element?.name.text;
    if (localName !== undefined) return parsed.initializers.get(localName);
  }
  return undefined;
}

/** Follows an imported RouterProvider router value without traversing arbitrary component imports. */
export function collectRouterProviderDelegates(
  parsed: ParsedRouteModule,
  sourcePath: string,
  enqueueDelegate: (binding: ImportedBinding, consumerPath: string) => void,
): void {
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tagText = opening.tagName.getText(parsed.sourceFile);
      const terminalName = tagText.split('.').at(-1);
      const directProvider =
        ts.isIdentifier(opening.tagName) && parsed.routerProviderBindings.has(opening.tagName.text);
      const namespacedProvider =
        ts.isPropertyAccessExpression(opening.tagName) &&
        opening.tagName.name.text === 'RouterProvider' &&
        ts.isIdentifier(opening.tagName.expression) &&
        parsed.routerNamespaces.has(opening.tagName.expression.text);
      if (directProvider || namespacedProvider || terminalName === 'RouterProvider') {
        const routerExpression = readJsxExpressionAttribute(opening.attributes, ['router']);
        const imported = readImportedExpressionBinding(routerExpression, parsed);
        if (imported !== undefined) enqueueDelegate(imported, sourcePath);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed.sourceFile);
}
