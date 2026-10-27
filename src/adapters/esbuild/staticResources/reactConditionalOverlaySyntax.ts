/** Reads inert overlay function, wrapper, property, and portal syntax. */
import ts from 'typescript';
import {
  type OverlayRuntimeFunction,
  type ReactDomPortalBindings,
  OVERLAY_COMPONENT_NAME_PATTERN,
} from './reactConditionalModel';

/** Finds the render-time owner of an early-return guard without crossing another function. */
export function findNearestOverlayRuntimeFunction(
  node: ts.Node,
): OverlayRuntimeFunction | undefined {
  let current = (node as unknown as { readonly parent?: ts.Node }).parent;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (
      ts.isArrowFunction(current) ||
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isMethodDeclaration(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

/** Requires an overlay-shaped function name or an exact createPortal call in its own body. */
export function isOverlayRuntimeFunction(
  owner: OverlayRuntimeFunction,
  sourceFile: ts.SourceFile,
  portalBindings: ReactDomPortalBindings,
): boolean {
  const ownerName = readOverlayRuntimeFunctionName(owner, sourceFile);
  if (ownerName !== undefined && OVERLAY_COMPONENT_NAME_PATTERN.test(ownerName)) return true;
  if (owner.body === undefined) return false;
  let portalFound = false;
  const visit = (node: ts.Node): void => {
    if (portalFound || (node !== owner && ts.isFunctionLike(node))) return;
    if (ts.isCallExpression(node) && isReactDomPortalCall(node, portalBindings)) {
      portalFound = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(owner.body);
  return portalFound;
}

/** Reads a declaration, variable, assignment, or method name without resolving project values. */
export function readOverlayRuntimeFunctionName(
  owner: OverlayRuntimeFunction,
  sourceFile: ts.SourceFile,
): string | undefined {
  if (owner.name !== undefined) return owner.name.getText(sourceFile);
  let current: ts.Node = owner;
  for (let depth = 0; depth < 8 && !ts.isSourceFile(current.parent); depth += 1) {
    const parent = current.parent;
    if (
      ts.isVariableDeclaration(parent) &&
      parent.initializer === current &&
      ts.isIdentifier(parent.name)
    ) {
      return parent.name.text;
    }
    if (ts.isPropertyAssignment(parent) && parent.initializer === current) {
      return parent.name.getText(sourceFile);
    }
    if (!isTransparentComponentFactoryWrapper(parent, current)) break;
    current = parent;
  }
  return undefined;
}

/**
 * Admits syntax-only HOC/styling wrappers between a render function and its authored binding.
 *
 * Common components are declared as `const Page = styled(() => ...)\`...\``,
 * `const Page = memo(() => ...)`, or nested factory calls. Walking only an argument, callee tag, or
 * syntax wrapper cannot cross into unrelated control flow, while recovering the name required to
 * attach an early-return condition to the root-to-target component path.
 */
export function isTransparentComponentFactoryWrapper(parent: ts.Node, child: ts.Node): boolean {
  if (
    ts.isParenthesizedExpression(parent) ||
    ts.isAsExpression(parent) ||
    ts.isSatisfiesExpression(parent) ||
    ts.isNonNullExpression(parent) ||
    ts.isTypeAssertionExpression(parent)
  ) {
    return parent.expression === child;
  }
  if (ts.isCallExpression(parent)) {
    return parent.arguments.includes(child as ts.Expression);
  }
  return ts.isTaggedTemplateExpression(parent) && parent.tag === child;
}

/** Collects direct and namespace createPortal imports from the browser ReactDOM package. */
export function collectReactDomPortalBindings(sourceFile: ts.SourceFile): ReactDomPortalBindings {
  const direct = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'react-dom' ||
      statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause?.name !== undefined) namespaces.add(clause.name.text);
    const bindings = clause?.namedBindings;
    if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
    } else if (bindings !== undefined) {
      for (const element of bindings.elements) {
        if (!element.isTypeOnly && (element.propertyName ?? element.name).text === 'createPortal') {
          direct.add(element.name.text);
        }
      }
    }
  }
  return { direct, namespaces };
}

/** Reads an identifier or quoted object key without evaluating computed project expressions. */
export function readStaticPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

/** Proves createPortal through a named import or ReactDOM namespace/default binding. */
export function isReactDomPortalCall(
  expression: ts.Expression,
  bindings: ReactDomPortalBindings,
): expression is ts.CallExpression {
  if (!ts.isCallExpression(expression)) return false;
  const callee = unwrapConditionalExpression(expression.expression);
  if (ts.isIdentifier(callee)) return bindings.direct.has(callee.text);
  return (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === 'createPortal' &&
    ts.isIdentifier(callee.expression) &&
    bindings.namespaces.has(callee.expression.text)
  );
}

/** Removes syntax-only wrappers that do not change whether an expression is direct JSX. */
export function unwrapConditionalExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}
