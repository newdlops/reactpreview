/** Reads inert route syntax and imported expression bindings. */
import path from 'node:path';
import ts from 'typescript';
import type { PreviewInspectorDirectRouteChoice } from './previewInspectorDirectRouteChoiceTypes';
import {
  type ImportedBinding,
  type ParsedRouteModule,
  REACT_ROUTER_PACKAGE_PATTERN,
  ROUTER_DESCRIPTOR_EXPORTS,
} from './previewInspectorDirectRouteModel';
import { readPreviewInspectorNormalizedRouteString } from './previewInspectorRoutePathMetadata';
import { joinPreviewInspectorRouteSegments as joinRouteSegments } from './previewInspectorRoutePattern';

/** Parses import and immutable binding facts shared by JSX, object, and Provider analysis. */
export function parseRouteModule(sourcePath: string, sourceText: string): ParsedRouteModule {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    sourcePath.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports = new Map<string, ImportedBinding>();
  const initializers = new Map<string, ts.Expression>();
  const routerDescriptorBindings = new Set<string>();
  const routerNamespaces = new Set<string>();
  const routerProviderBindings = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined) {
          initializers.set(declaration.name.text, declaration.initializer);
        }
      }
      continue;
    }
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
    ) {
      continue;
    }
    const moduleSpecifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (clause?.name !== undefined) {
      imports.set(clause.name.text, { exportName: 'default', moduleSpecifier, namespace: false });
    }
    const bindings = clause?.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) {
      imports.set(bindings.name.text, { exportName: '*', moduleSpecifier, namespace: true });
      if (REACT_ROUTER_PACKAGE_PATTERN.test(moduleSpecifier)) {
        routerNamespaces.add(bindings.name.text);
      }
      continue;
    }
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      const exportName = (element.propertyName ?? element.name).text;
      imports.set(element.name.text, { exportName, moduleSpecifier, namespace: false });
      if (!REACT_ROUTER_PACKAGE_PATTERN.test(moduleSpecifier)) continue;
      if (ROUTER_DESCRIPTOR_EXPORTS.has(exportName)) {
        routerDescriptorBindings.add(element.name.text);
      }
      if (exportName === 'RouterProvider') routerProviderBindings.add(element.name.text);
    }
  }
  return {
    imports,
    initializers,
    routerDescriptorBindings,
    routerNamespaces,
    routerProviderBindings,
    sourceFile,
  };
}

/** Flattens resolved structural ancestors without changing the selected route's authored pattern. */
export function createDirectRoutePattern(
  routeSegments: readonly string[],
  pathResolution: PreviewInspectorDirectRouteChoice['pathResolution'],
  isIndex: boolean,
): string {
  if (pathResolution === 'unresolved') return joinRouteSegments(routeSegments);
  const lastIndex = routeSegments.length - 1;
  return joinRouteSegments(
    routeSegments.flatMap((segment, index) => {
      const structural = index < lastIndex || (isIndex && index === lastIndex);
      if (!structural) return [segment];
      const base = segment.replace(/(?:^|\/)\*+\/?$/u, '');
      return base.length === 0 ? [] : [base];
    }),
  );
}

/** Distinguishes a same-file component declaration from an unresolved/missing import in edited code. */
export function sourceDeclaresRuntimeName(parsed: ParsedRouteModule, localName: string): boolean {
  if (parsed.initializers.has(localName)) return true;
  return parsed.sourceFile.statements.some(
    (statement) =>
      ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
        statement.name?.text === localName) ||
      (ts.isExportAssignment(statement) &&
        ts.isIdentifier(statement.expression) &&
        statement.expression.text === localName),
  );
}

/** Resolves an identifier/member through local immutable aliases until it reaches one import. */
export function readImportedExpressionBinding(
  expression: ts.Expression | undefined,
  parsed: ParsedRouteModule,
  visited = new Set<string>(),
): ImportedBinding | undefined {
  if (expression === undefined) return undefined;
  const value = unwrapExpression(expression);
  if (ts.isIdentifier(value)) {
    if (visited.has(value.text)) return undefined;
    visited.add(value.text);
    const imported = parsed.imports.get(value.text);
    if (imported !== undefined) return imported;
    const initializer = parsed.initializers.get(value.text);
    return initializer === undefined
      ? undefined
      : readImportedExpressionBinding(initializer, parsed, visited);
  }
  if (ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression)) {
    const namespace = parsed.imports.get(value.expression.text);
    if (namespace?.namespace !== true) return undefined;
    return { ...namespace, exportName: value.name.text };
  }
  return undefined;
}

/** Requires an exact named or namespace import from a React Router package. */
export function isRouterDescriptorCall(
  expression: ts.Expression,
  parsed: ParsedRouteModule,
): boolean {
  if (ts.isIdentifier(expression)) return parsed.routerDescriptorBindings.has(expression.text);
  return (
    ts.isPropertyAccessExpression(expression) &&
    ROUTER_DESCRIPTOR_EXPORTS.has(expression.name.text) &&
    ts.isIdentifier(expression.expression) &&
    parsed.routerNamespaces.has(expression.expression.text)
  );
}

/** Reads a JSX expression attribute from the first matching authored name. */
export function readJsxExpressionAttribute(
  attributes: ts.JsxAttributes,
  names: readonly string[],
): ts.Expression | undefined {
  const attribute = attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) &&
      ts.isIdentifier(property.name) &&
      names.includes(property.name.text),
  );
  return attribute?.initializer !== undefined && ts.isJsxExpression(attribute.initializer)
    ? attribute.initializer.expression
    : undefined;
}

/** Reads the first direct non-Route JSX child or expression returned by a v5 Route. */
export function readJsxRouteChildExpression(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
): ts.Expression | undefined {
  if (!ts.isJsxElement(node)) return undefined;
  for (const child of node.children) {
    if (
      ts.isJsxElement(child) &&
      readJsxTagTerminalName(child.openingElement.tagName) !== 'Route'
    ) {
      return child;
    }
    if (ts.isJsxSelfClosingElement(child) && readJsxTagTerminalName(child.tagName) !== 'Route') {
      return child;
    }
    if (ts.isJsxExpression(child) && child.expression !== undefined) return child.expression;
  }
  return undefined;
}

/** Returns the terminal identifier of a JSX tag independent of namespace/member spelling. */
export function readJsxTagTerminalName(tagName: ts.JsxTagNameExpression): string {
  return tagName.getText().split('.').at(-1) ?? '';
}

/** Finds one exact property assignment from a route descriptor. */
export function findObjectProperty(
  objectLiteral: ts.ObjectLiteralExpression,
  names: readonly string[],
): ts.PropertyAssignment | undefined {
  return objectLiteral.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      names.includes(readObjectPropertyName(property.name) ?? ''),
  );
}

/** Reads a literal descriptor path. */
export function readStaticObjectStringProperty(
  objectLiteral: ts.ObjectLiteralExpression,
  name: string,
): string | undefined {
  const property = findObjectProperty(objectLiteral, [name]);
  return property === undefined
    ? undefined
    : readPreviewInspectorNormalizedRouteString(property.initializer);
}

/** Reads an exact descriptor index flag. */
export function readStaticObjectBooleanProperty(
  objectLiteral: ts.ObjectLiteralExpression,
  name: string,
): boolean | undefined {
  const property = findObjectProperty(objectLiteral, [name]);
  if (property?.initializer.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (property?.initializer.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

/** Normalizes identifier and quoted object keys while rejecting computed keys. */
export function readObjectPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return undefined;
}

/** Removes inert TypeScript wrappers without executing expressions. */
export function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Finds the first literal `import()` request below a lazy route/component expression. */
export function findDynamicImportSpecifier(expression: ts.Expression): string | undefined {
  let result: string | undefined;
  const visit = (node: ts.Node): void => {
    if (result !== undefined) return;
    const firstArgument = ts.isCallExpression(node) ? node.arguments[0] : undefined;
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      firstArgument !== undefined &&
      ts.isStringLiteralLike(firstArgument)
    ) {
      result = firstArgument.text;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return result;
}

/** Derives a short display identity for a lazy route whose component export is deferred. */
export function createComponentNameFromModuleSpecifier(moduleSpecifier: string): string {
  const clean = moduleSpecifier.split(/[?#]/u, 1)[0] ?? moduleSpecifier;
  const parsed = path.posix.parse(clean);
  const stem =
    parsed.name.toLowerCase() === 'index' ? path.posix.basename(parsed.dir) : parsed.name;
  const componentName = stem
    .split(/[^$_\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((segment) => segment.slice(0, 1).toUpperCase() + segment.slice(1))
    .join('');
  return componentName.length === 0 ? 'LazyRoute' : componentName;
}
