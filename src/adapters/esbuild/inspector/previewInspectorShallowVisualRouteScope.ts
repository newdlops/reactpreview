/**
 * Keeps exact React Router JSX occurrence boundaries during shallow page reconstruction.
 * A component under another Route is not page chrome, even when a HOC forces owner-level evidence.
 * Only import-proven route bindings are recognized; no project module or path expression executes.
 */
import ts from 'typescript';
import { createPreviewRenderSourceFile } from '../renderGraph/previewRenderSourceAnalysis';

/**
 * Builds one inert route-range index for a source snapshot and returns a cached occurrence test.
 * Ancestor/same-route components remain admitted; a different occurrence of the same export can be
 * an alternative without banning its valid page-frame occurrence elsewhere in the source.
 */
export function createPreviewInspectorShallowRouteAlternativeTest(
  sourcePath: string,
  sourceText: string,
): (occurrenceStart: number, selectedOccurrenceStart: number | undefined) => boolean {
  if (!sourceText.includes('react-router')) return () => false;
  const sourceFile = createPreviewRenderSourceFile(sourcePath, sourceText);
  const routeNames = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !['react-router', 'react-router-dom'].includes(statement.moduleSpecifier.text) ||
      statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
      routeNames.add(`${bindings.name.text}.Route`);
    } else if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (!element.isTypeOnly && (element.propertyName ?? element.name).text === 'Route') {
          routeNames.add(element.name.text);
        }
      }
    }
  }
  if (routeNames.size === 0) return () => false;
  const ranges: { readonly start: number; readonly end: number }[] = [];
  /** Visits once, retaining offsets rather than AST nodes in the returned query closure. */
  const visit = (node: ts.Node): void => {
    const opening = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : undefined;
    if (opening !== undefined && routeNames.has(opening.tagName.getText(sourceFile))) {
      ranges.push({ start: node.getStart(sourceFile), end: node.end });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const scopesByOccurrence = new Map<number, readonly number[]>();
  /** Caches scope IDs because several selected outcomes can reference the same authored node. */
  const readScopes = (position: number): readonly number[] => {
    const cached = scopesByOccurrence.get(position);
    if (cached !== undefined) return cached;
    const scopes = ranges.flatMap((range, index) =>
      position >= range.start && position < range.end ? [index] : [],
    );
    scopesByOccurrence.set(position, scopes);
    return scopes;
  };
  return (occurrenceStart, selectedOccurrenceStart) =>
    selectedOccurrenceStart !== undefined &&
    readScopes(occurrenceStart).some(
      (scope) => !readScopes(selectedOccurrenceStart).includes(scope),
    );
}
