/** Replaces only the container argument of statically proven ReactDOM portal calls. */
import ts from 'typescript';
import type { PreviewSourceReplacement } from './previewSourceReplacement';

/** Keeps generated ref-like objects from reaching ReactDOM as invalid portal containers. */
export function createPreviewReactDomPortalContainerReplacements(
  sourceFile: ts.SourceFile,
  sourceText: string,
): readonly PreviewSourceReplacement[] {
  if (!sourceText.includes('createPortal') || !sourceText.includes('react-dom')) return [];
  const directBindings = new Set<string>();
  const namespaceBindings = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'react-dom' ||
      statement.importClause?.isTypeOnly === true
    ) continue;
    const clause = statement.importClause;
    if (clause?.name !== undefined) namespaceBindings.add(clause.name.text);
    const bindings = clause?.namedBindings;
    if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
      namespaceBindings.add(bindings.name.text);
    } else if (bindings !== undefined) {
      for (const element of bindings.elements) {
        if (!element.isTypeOnly && (element.propertyName ?? element.name).text === 'createPortal') {
          directBindings.add(element.name.text);
        }
      }
    }
  }
  if (directBindings.size === 0 && namespaceBindings.size === 0) return [];
  const replacements: PreviewSourceReplacement[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isReactDomPortalCall(node.expression)) {
      const container = node.arguments[1];
      if (container !== undefined && !ts.isSpreadElement(container)) {
        const original = sourceText.slice(container.getStart(sourceFile), container.end);
        replacements.push({
          end: container.end,
          priority: 2,
          replacement: createPortalContainerExpression(original),
          start: container.getStart(sourceFile),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return replacements;

  function isReactDomPortalCall(rawExpression: ts.Expression): boolean {
    const expression = unwrapExpression(rawExpression);
    if (ts.isIdentifier(expression)) return directBindings.has(expression.text);
    const receiver = ts.isPropertyAccessExpression(expression)
      ? unwrapExpression(expression.expression)
      : undefined;
    return ts.isPropertyAccessExpression(expression) &&
      expression.name.text === 'createPortal' &&
      receiver !== undefined &&
      ts.isIdentifier(receiver) &&
      namespaceBindings.has(receiver.text);
  }
}

/** Evaluates the authored host once and accepts only a real DOM Node from its owning realm. */
function createPortalContainerExpression(original: string): string {
  return `((previewPortalHost) => { const previewFallbackHost = globalThis.document?.body ?? globalThis.document?.documentElement; try { const PreviewNode = previewPortalHost?.ownerDocument?.defaultView?.Node ?? globalThis.Node; return typeof PreviewNode === 'function' && previewPortalHost instanceof PreviewNode && [1, 9, 11].includes(previewPortalHost.nodeType) ? previewPortalHost : previewFallbackHost; } catch { return previewFallbackHost; } })(${original})`;
}

/** Removes syntax-only wrappers without evaluating the authored expression. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) current = current.expression;
  return current;
}
