/** Enumerates authored JSX route elements and enclosing route factories. */
import ts from 'typescript';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';
import type { PreviewInspectorDirectRouteChoice } from './previewInspectorDirectRouteChoiceTypes';
import {
  type ParsedRouteModule,
  MAXIMUM_DIRECT_ROUTE_CHOICES,
} from './previewInspectorDirectRouteModel';
import {
  createDirectRoutePattern,
  readJsxExpressionAttribute,
  readJsxRouteChildExpression,
  readJsxTagTerminalName,
} from './previewInspectorDirectRouteSyntax';
import { addExpressionChoice } from './previewInspectorDirectRouteTargets';
import { readPreviewInspectorRouteFactoryBasePath } from './previewInspectorRouteFactory';
import {
  readStaticJsxBooleanAttribute,
  readStaticJsxStringAttribute,
} from './previewInspectorRoutePathMetadata';

/** Collects nested JSX Route paths and their directly rendered component expressions. */
export function collectJsxRouteChoices(
  parsed: ParsedRouteModule,
  sourcePath: string,
  choices: PreviewInspectorDirectRouteChoice[],
  resolveModule: ResolvePreviewRenderGraphModule | undefined,
): void {
  const visit = (
    node: ts.Node,
    parentSegments: readonly string[],
    parentResolution: PreviewInspectorDirectRouteChoice['pathResolution'],
    insideFactory: boolean,
  ): void => {
    if (choices.length >= MAXIMUM_DIRECT_ROUTE_CHOICES) return;
    const withinFactory =
      insideFactory ||
      (ts.isCallExpression(node) &&
        readPreviewInspectorRouteFactoryBasePath(node, parsed.sourceFile) !== undefined);
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      if (isDirectJsxRouteElement(opening, parsed, sourcePath, resolveModule)) {
        const pathAttribute = opening.attributes.properties.find(
          (property): property is ts.JsxAttribute =>
            ts.isJsxAttribute(property) && property.name.getText() === 'path',
        );
        const routePath = readStaticJsxStringAttribute(opening.attributes, 'path');
        // Factory catch-alls remain authored fallback syntax, including unused JSX reached by this
        // broad AST walk. Only the returned occurrences contribute fallback diagnostics elsewhere.
        if (withinFactory && (routePath === '*' || routePath === '/*')) return;
        const isIndex = readStaticJsxBooleanAttribute(opening.attributes, 'index') === true;
        const inheritedSegments =
          parentSegments.length > 0
            ? parentSegments
            : (readEnclosingRouteFactorySegments(node, parsed.sourceFile) ?? []);
        const routeSegments =
          routePath === undefined
            ? inheritedSegments
            : routePath.startsWith('/')
              ? [routePath]
              : [...inheritedSegments, routePath];
        const pathResolution =
          routePath === undefined
            ? pathAttribute === undefined
              ? parentResolution
              : 'unresolved'
            : routePath.startsWith('/')
              ? 'resolved'
              : parentResolution;
        const routePattern = createDirectRoutePattern(routeSegments, pathResolution, isIndex);
        const hasExplicitComponentAttribute = opening.attributes.properties.some(
          (property) =>
            ts.isJsxAttribute(property) &&
            ['element', 'Component', 'component'].includes(property.name.getText()),
        );
        const ownsNestedRouteContent =
          jsxRouteOwnsNestedRoutes(node) ||
          (ts.isJsxElement(node) &&
            hasExplicitComponentAttribute &&
            hasSubstantiveJsxRouteChildren(node));
        const componentExpression = ownsNestedRouteContent
          ? undefined
          : hasExplicitComponentAttribute
            ? readJsxExpressionAttribute(opening.attributes, ['element', 'Component', 'component'])
            : readJsxRouteChildExpression(node);
        if (
          !ownsNestedRouteContent &&
          (routePath !== undefined || isIndex || componentExpression !== undefined)
        ) {
          addExpressionChoice(
            componentExpression,
            routePattern,
            parsed,
            sourcePath,
            choices,
            resolveModule,
            pathResolution,
            pathAttribute?.initializer !== undefined &&
              ts.isJsxExpression(pathAttribute.initializer)
              ? pathAttribute.initializer.expression
              : undefined,
          );
        }
        if (ts.isJsxElement(node)) {
          for (const child of node.children)
            visit(child, routeSegments, pathResolution, withinFactory);
        }
        return;
      }
    }
    ts.forEachChild(node, (child) => {
      visit(child, parentSegments, parentResolution, withinFactory);
    });
  };
  visit(parsed.sourceFile, [], 'resolved', false);
}

/**
 * Recognizes a standard Route or one imported component-style Route adapter.
 *
 * React Router v5 applications commonly wrap Route as `PrivateRoute` and forward `path` plus
 * `component`. Treating only the literal `<Route>` spelling as route evidence drops the nearest
 * authored branch and leaves the preview at its broad parent pathname. A custom adapter is admitted
 * only when its local binding resolves to a real source module and the occurrence carries both a
 * path and an explicit routed component slot; the later render-chain check still has to prove that
 * exact component on the selected target path.
 */
export function isDirectJsxRouteElement(
  opening: ts.JsxOpeningLikeElement,
  parsed: ParsedRouteModule,
  sourcePath: string,
  resolveModule: ResolvePreviewRenderGraphModule | undefined,
): boolean {
  const terminalName = readJsxTagTerminalName(opening.tagName);
  if (terminalName === 'Route') return true;
  if (!terminalName.endsWith('Route') || !ts.isIdentifier(opening.tagName)) return false;
  const hasPath = opening.attributes.properties.some(
    (property) => ts.isJsxAttribute(property) && property.name.getText() === 'path',
  );
  const hasComponentSlot = opening.attributes.properties.some(
    (property) =>
      ts.isJsxAttribute(property) &&
      ['Component', 'component', 'element'].includes(property.name.getText()),
  );
  if (!hasPath || !hasComponentSlot) return false;
  const imported = parsed.imports.get(opening.tagName.text);
  return (
    imported !== undefined && resolveModule?.(imported.moduleSpecifier, sourcePath) !== undefined
  );
}

/** Recovers an absolute base passed to a surrounding conventional app/router factory. */
export function readEnclosingRouteFactorySegments(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): readonly string[] | undefined {
  let current = node.parent;
  while (!ts.isSourceFile(current)) {
    if (ts.isCallExpression(current)) {
      const basePath = readPreviewInspectorRouteFactoryBasePath(current, sourceFile);
      if (basePath !== undefined) return [basePath];
    }
    current = current.parent;
  }
  return undefined;
}

/** Reports whether a Route is a layout/path parent whose visible page is selected by child Routes. */
export function jsxRouteOwnsNestedRoutes(node: ts.JsxElement | ts.JsxSelfClosingElement): boolean {
  if (!ts.isJsxElement(node)) return false;
  let found = false;
  const visit = (candidate: ts.Node): void => {
    if (found) return;
    if (
      (ts.isJsxElement(candidate) || ts.isJsxSelfClosingElement(candidate)) &&
      readJsxTagTerminalName(
        ts.isJsxElement(candidate) ? candidate.openingElement.tagName : candidate.tagName,
      ) === 'Route'
    ) {
      found = true;
      return;
    }
    ts.forEachChild(candidate, visit);
  };
  for (const child of node.children) visit(child);
  return found;
}

/** Reports direct JSX child syntax that makes an explicit Route component a nested owner. */
export function hasSubstantiveJsxRouteChildren(node: ts.JsxElement): boolean {
  return node.children.some(
    (child) =>
      ts.isJsxElement(child) ||
      ts.isJsxSelfClosingElement(child) ||
      (ts.isJsxExpression(child) && child.expression !== undefined),
  );
}
