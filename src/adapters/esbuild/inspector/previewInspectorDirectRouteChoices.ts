/**
 * Extracts inert route choices from standard React Router syntax and delegated router modules.
 *
 * The analyzer never imports or evaluates application code. It follows only exact React Router
 * imports, literal route descriptors, JSX Route elements, and a RouterProvider's statically
 * imported router value. Page modules are resolved to paths as metadata but are not read here.
 */
import path from 'node:path';
import ts from 'typescript';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';
import {
  joinPreviewInspectorRouteSegments as joinRouteSegments,
  normalizePreviewInspectorRoutePattern as normalizeRoutePattern,
} from './previewInspectorRoutePattern';
import { readPreviewInspectorRouteFactoryBasePath } from './previewInspectorRouteFactory';

const MAXIMUM_DIRECT_ROUTE_CHOICES = 4_096;
const MAXIMUM_ROUTER_DELEGATE_MODULES = 16;
const REACT_ROUTER_PACKAGE_PATTERN = /^(?:@remix-run\/react|react-router(?:-dom)?)$/u;
const ROUTER_DESCRIPTOR_EXPORTS = new Set([
  'createBrowserRouter',
  'createHashRouter',
  'createMemoryRouter',
  'useRoutes',
]);

/** Resolved source identity for a component rendered by one direct route. */
export interface PreviewInspectorDirectRouteComponentReference {
  /** Public ESM export requested by the route owner. */
  readonly exportName: string;
  /** Resolved local/workspace module path; the module is not loaded during analysis. */
  readonly sourcePath: string;
}

/** One path/component pair offered by standard React Router syntax. */
export interface PreviewInspectorDirectRouteChoice {
  /** Component label shown in the route explorer. */
  readonly componentName: string;
  /** Optional page module retained only after this choice becomes active. */
  readonly reference?: PreviewInspectorDirectRouteComponentReference;
  /** Normalized authored route pattern. */
  readonly pattern: string;
  /** Router source that provided this exact path. */
  readonly sourcePath: string;
}

/** Standard route choices plus router configuration files needed for hot reload. */
export interface PreviewInspectorDirectRouteChoiceInventory {
  /** Every exact route found in the selected owner and delegated router configurations. */
  readonly choices: readonly PreviewInspectorDirectRouteChoice[];
  /** Files parsed to obtain route metadata; page component files are deliberately excluded. */
  readonly dependencyPaths: readonly string[];
}

/** Capabilities supplied by the existing package-bounded Inspector planner. */
export interface CollectPreviewInspectorDirectRouteChoicesOptions {
  /** Snapshot-aware reader that must return no content outside caller policy. */
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  /** Optional project-aware module resolver. */
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  /** Selected route owner source. */
  readonly sourcePath: string;
  /** Already-read selected source snapshot. */
  readonly sourceText: string | undefined;
}

/** Inputs for one already-read source pass without following RouterProvider configuration imports. */
export interface CollectPreviewInspectorDirectRouteChoicesFromSourceOptions {
  /** Optional project-aware resolver used only to attach page module identities. */
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  /** Authored router or render-path source. */
  readonly sourcePath: string;
  /** Current source snapshot. */
  readonly sourceText: string;
}

/** One imported runtime binding, including namespace imports used by route configurations. */
interface ImportedBinding {
  readonly exportName: string;
  readonly moduleSpecifier: string;
  readonly namespace: boolean;
}

/** Mutable facts for one parsed route owner or delegated router configuration module. */
interface ParsedRouteModule {
  readonly imports: ReadonlyMap<string, ImportedBinding>;
  readonly initializers: ReadonlyMap<string, ts.Expression>;
  readonly routerDescriptorBindings: ReadonlySet<string>;
  readonly routerNamespaces: ReadonlySet<string>;
  readonly routerProviderBindings: ReadonlySet<string>;
  readonly sourceFile: ts.SourceFile;
}

/** Work item used by the bounded RouterProvider/import delegation queue. */
interface RouteModuleWorkItem {
  /** Imported export that may itself be a route descriptor aggregate. */
  readonly descriptorExportName?: string;
  readonly sourcePath: string;
  readonly sourceText?: string;
}

/**
 * Collects a large route catalog as metadata while following only router-configuration imports.
 *
 * A RouterProvider can receive an imported router or a router factory can receive an imported
 * descriptor array. Those imports are parser inputs, not visible pages, so following them remains
 * cheap and lets the branch planner continue through provider-only intermediate modules.
 */
export async function collectPreviewInspectorDirectRouteChoices(
  options: CollectPreviewInspectorDirectRouteChoicesOptions,
): Promise<PreviewInspectorDirectRouteChoiceInventory> {
  const choices: PreviewInspectorDirectRouteChoice[] = [];
  const dependencyPaths = new Set<string>();
  const queuedItems = new Set<string>();
  const queue: RouteModuleWorkItem[] = [];
  enqueue(options.sourcePath, options.sourceText);
  let processedItems = 0;

  while (queue.length > 0 && processedItems < MAXIMUM_ROUTER_DELEGATE_MODULES) {
    const workItem = queue.shift();
    if (workItem === undefined) break;
    processedItems += 1;
    const sourcePath = path.normalize(workItem.sourcePath);
    const sourceText = workItem.sourceText ?? (await options.readSource(sourcePath));
    if (sourceText === undefined) continue;
    dependencyPaths.add(sourcePath);
    const parsed = parseRouteModule(sourcePath, sourceText);
    for (const choice of collectPreviewInspectorDirectRouteChoicesFromParsedSource(
      parsed,
      sourcePath,
      options.resolveModule,
      enqueueDelegate,
      workItem.descriptorExportName,
    )) {
      addChoice(choices, choice);
    }
    collectRouterProviderDelegates(parsed, sourcePath, enqueueDelegate);
  }

  return Object.freeze({
    choices: Object.freeze(choices),
    dependencyPaths: Object.freeze([...dependencyPaths].sort()),
  });

  /** Queues one exact resolver result at most once without reading it eagerly. */
  function enqueue(sourcePath: string, sourceText?: string, descriptorExportName?: string): void {
    const normalizedPath = path.normalize(sourcePath);
    const key = `${normalizedPath}\0${descriptorExportName ?? ''}`;
    if (queuedItems.has(key)) return;
    queuedItems.add(key);
    queue.push({
      ...(descriptorExportName === undefined ? {} : { descriptorExportName }),
      sourcePath: normalizedPath,
      ...(sourceText === undefined ? {} : { sourceText }),
    });
  }

  /** Resolves an imported router/config value and queues only its owning source module. */
  function enqueueDelegate(binding: ImportedBinding, consumerPath: string): void {
    const resolvedPath = options.resolveModule?.(binding.moduleSpecifier, consumerPath);
    if (resolvedPath !== undefined) enqueue(resolvedPath, undefined, binding.exportName);
  }
}

/**
 * Collects direct JSX/object route choices from one source without following router imports.
 *
 * The route-location analyzer uses this overload for sources already present on a proven render
 * path, avoiding duplicate reads and keeping imported configuration traversal under one root pass.
 */
export function collectPreviewInspectorDirectRouteChoicesFromSource(
  options: CollectPreviewInspectorDirectRouteChoicesFromSourceOptions,
): readonly PreviewInspectorDirectRouteChoice[] {
  const parsed = parseRouteModule(options.sourcePath, options.sourceText);
  return Object.freeze(
    collectPreviewInspectorDirectRouteChoicesFromParsedSource(
      parsed,
      options.sourcePath,
      options.resolveModule,
      () => undefined,
      undefined,
    ),
  );
}

/** Shares one parsed syntax pass between the recursive and already-read public entry points. */
function collectPreviewInspectorDirectRouteChoicesFromParsedSource(
  parsed: ParsedRouteModule,
  sourcePath: string,
  resolveModule: ResolvePreviewRenderGraphModule | undefined,
  enqueueDelegate: (binding: ImportedBinding, consumerPath: string) => void,
  descriptorExportName: string | undefined,
): PreviewInspectorDirectRouteChoice[] {
  const choices: PreviewInspectorDirectRouteChoice[] = [];
  collectJsxRouteChoices(parsed, sourcePath, choices, resolveModule);
  collectObjectRouteChoices(
    parsed,
    sourcePath,
    choices,
    resolveModule,
    enqueueDelegate,
    descriptorExportName,
  );
  return choices;
}

/** Parses import and immutable binding facts shared by JSX, object, and Provider analysis. */
function parseRouteModule(sourcePath: string, sourceText: string): ParsedRouteModule {
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

/** Collects nested JSX Route paths and their directly rendered component expressions. */
function collectJsxRouteChoices(
  parsed: ParsedRouteModule,
  sourcePath: string,
  choices: PreviewInspectorDirectRouteChoice[],
  resolveModule: ResolvePreviewRenderGraphModule | undefined,
): void {
  const visit = (node: ts.Node, parentSegments: readonly string[]): void => {
    if (choices.length >= MAXIMUM_DIRECT_ROUTE_CHOICES) return;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      if (readJsxTagTerminalName(opening.tagName) === 'Route') {
        const routePath = readStaticJsxStringAttribute(opening.attributes, 'path');
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
        const componentExpression =
          readJsxExpressionAttribute(opening.attributes, ['element', 'Component', 'component']) ??
          readJsxRouteChildExpression(node);
        const ownsNestedRoutes = jsxRouteOwnsNestedRoutes(node);
        if (
          (!ownsNestedRoutes || isIndex) &&
          (routePath !== undefined || isIndex || componentExpression !== undefined)
        ) {
          addExpressionChoice(
            componentExpression,
            joinRouteSegments(routeSegments),
            parsed,
            sourcePath,
            choices,
            resolveModule,
          );
        }
        if (ts.isJsxElement(node)) {
          for (const child of node.children) visit(child, routeSegments);
        }
        return;
      }
    }
    ts.forEachChild(node, (child) => {
      visit(child, parentSegments);
    });
  };
  visit(parsed.sourceFile, []);
}

/** Recovers an absolute base passed to a surrounding conventional app/router factory. */
function readEnclosingRouteFactorySegments(
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
function jsxRouteOwnsNestedRoutes(node: ts.JsxElement | ts.JsxSelfClosingElement): boolean {
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

/** Collects descriptor arrays passed to exact React Router factory/useRoutes imports. */
function collectObjectRouteChoices(
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
  const visitDescriptor = (node: ts.Node, parentSegments: readonly string[]): void => {
    if (choices.length >= MAXIMUM_DIRECT_ROUTE_CHOICES || visited.has(node)) return;
    visited.add(node);
    const expression = ts.isExpression(node) ? unwrapExpression(node) : node;
    if (ts.isIdentifier(expression)) {
      const initializer = parsed.initializers.get(expression.text);
      if (initializer !== undefined) visitDescriptor(initializer, parentSegments);
      return;
    }
    if (ts.isArrayLiteralExpression(expression)) {
      for (const element of expression.elements) {
        visitDescriptor(ts.isSpreadElement(element) ? element.expression : element, parentSegments);
      }
      return;
    }
    if (!ts.isObjectLiteralExpression(expression)) return;
    const routePath = readStaticObjectStringProperty(expression, 'path');
    const isIndex = readStaticObjectBooleanProperty(expression, 'index') === true;
    const routeSegments =
      routePath === undefined
        ? parentSegments
        : routePath.startsWith('/')
          ? [routePath]
          : [...parentSegments, routePath];
    const componentProperty = findObjectProperty(expression, ['Component', 'component', 'element']);
    const lazyProperty = findObjectProperty(expression, ['lazy']);
    const childrenProperty = findObjectProperty(expression, ['children']);
    if (
      (childrenProperty === undefined || isIndex) &&
      (routePath !== undefined || isIndex || componentProperty !== undefined)
    ) {
      addExpressionChoice(
        componentProperty?.initializer,
        joinRouteSegments(routeSegments),
        parsed,
        sourcePath,
        choices,
        resolveModule,
      );
      if (componentProperty === undefined && lazyProperty !== undefined) {
        addDynamicImportChoice(
          lazyProperty.initializer,
          joinRouteSegments(routeSegments),
          sourcePath,
          choices,
          resolveModule,
        );
      }
    }
    if (childrenProperty !== undefined) {
      visitDescriptor(childrenProperty.initializer, routeSegments);
    }
    for (const property of expression.properties) {
      if (ts.isSpreadAssignment(property)) visitDescriptor(property.expression, parentSegments);
    }
  };
  for (const root of roots) visitDescriptor(root, []);
}

/** Finds an imported descriptor aggregate's exact named/default export without evaluating it. */
function readExportedDescriptorExpression(
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
function collectRouterProviderDelegates(
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

/** Adds one component expression choice after resolving its local/imported source identity. */
function addExpressionChoice(
  expression: ts.Expression | undefined,
  rawPattern: string,
  parsed: ParsedRouteModule,
  sourcePath: string,
  choices: PreviewInspectorDirectRouteChoice[],
  resolveModule: ResolvePreviewRenderGraphModule | undefined,
): void {
  if (expression === undefined) return;
  const identity = readComponentIdentity(expression, parsed);
  if (identity === undefined) return;
  const pattern = normalizeRoutePattern(rawPattern);
  if (pattern === undefined) return;
  const reference = resolveComponentReference(identity, parsed, sourcePath, resolveModule);
  addChoice(choices, {
    componentName: identity.componentName,
    pattern,
    ...(reference === undefined ? {} : { reference }),
    sourcePath,
  });
}

/** Adds a React Router lazy descriptor using its exact dynamic-import module as the page identity. */
function addDynamicImportChoice(
  expression: ts.Expression,
  rawPattern: string,
  sourcePath: string,
  choices: PreviewInspectorDirectRouteChoice[],
  resolveModule: ResolvePreviewRenderGraphModule | undefined,
): void {
  const moduleSpecifier = findDynamicImportSpecifier(expression);
  const pattern = normalizeRoutePattern(rawPattern);
  if (moduleSpecifier === undefined || pattern === undefined) return;
  const componentName = createComponentNameFromModuleSpecifier(moduleSpecifier);
  const resolvedPath = resolveModule?.(moduleSpecifier, sourcePath);
  addChoice(choices, {
    componentName,
    pattern,
    ...(resolvedPath === undefined
      ? {}
      : {
          reference: Object.freeze({
            exportName: 'default',
            sourcePath: path.normalize(resolvedPath),
          }),
        }),
    sourcePath,
  });
}

/** Component spelling plus importer-local binding used to resolve its source module. */
interface ComponentIdentity {
  readonly componentName: string;
  readonly exportName?: string;
  readonly localName: string;
}

/** Reads JSX, identifier, member, createElement, and render-callback component expressions. */
function readComponentIdentity(
  expression: ts.Expression,
  parsed: ParsedRouteModule,
): ComponentIdentity | undefined {
  const value = unwrapExpression(expression);
  if (ts.isJsxElement(value) || ts.isJsxSelfClosingElement(value)) {
    const opening = ts.isJsxElement(value) ? value.openingElement : value;
    return readTagComponentIdentity(opening.tagName);
  }
  if (ts.isIdentifier(value) && /^[A-Z_$]/u.test(value.text)) {
    return { componentName: value.text, localName: value.text };
  }
  if (ts.isPropertyAccessExpression(value)) {
    return readMemberComponentIdentity(value);
  }
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
    if (ts.isExpression(value.body)) return readComponentIdentity(value.body, parsed);
    for (const statement of value.body.statements) {
      if (ts.isReturnStatement(statement) && statement.expression !== undefined) {
        const identity = readComponentIdentity(statement.expression, parsed);
        if (identity !== undefined) return identity;
      }
    }
  }
  if (ts.isCallExpression(value) && value.arguments[0] !== undefined) {
    const callee = value.expression.getText(parsed.sourceFile).split('.').at(-1);
    if (callee === 'createElement') return readComponentIdentity(value.arguments[0], parsed);
  }
  return undefined;
}

/** Reads a JSX tag while preserving namespace-import member exports. */
function readTagComponentIdentity(tagName: ts.JsxTagNameExpression): ComponentIdentity | undefined {
  if (ts.isIdentifier(tagName) && /^[A-Z_$]/u.test(tagName.text)) {
    return { componentName: tagName.text, localName: tagName.text };
  }
  return ts.isPropertyAccessExpression(tagName) ? readMemberComponentIdentity(tagName) : undefined;
}

/** Maps `Screens.Home` to the namespace binding plus exact `Home` export. */
function readMemberComponentIdentity(
  expression: ts.PropertyAccessExpression,
): ComponentIdentity | undefined {
  let root: ts.Expression = expression.expression;
  while (ts.isPropertyAccessExpression(root)) root = root.expression;
  if (!ts.isIdentifier(root) || !/^[A-Z_$]/u.test(expression.name.text)) return undefined;
  return {
    componentName: expression.name.text,
    exportName: expression.name.text,
    localName: root.text,
  };
}

/** Resolves direct imports, namespace members, lazy bindings, or same-file component declarations. */
function resolveComponentReference(
  identity: ComponentIdentity,
  parsed: ParsedRouteModule,
  sourcePath: string,
  resolveModule: ResolvePreviewRenderGraphModule | undefined,
): PreviewInspectorDirectRouteComponentReference | undefined {
  const imported = parsed.imports.get(identity.localName);
  if (imported !== undefined) {
    const resolvedPath = resolveModule?.(imported.moduleSpecifier, sourcePath);
    if (resolvedPath === undefined) return undefined;
    return Object.freeze({
      exportName: identity.exportName ?? imported.exportName,
      sourcePath: path.normalize(resolvedPath),
    });
  }
  const initializer = parsed.initializers.get(identity.localName);
  const dynamicSpecifier =
    initializer === undefined ? undefined : findDynamicImportSpecifier(initializer);
  if (dynamicSpecifier !== undefined) {
    const resolvedPath = resolveModule?.(dynamicSpecifier, sourcePath);
    if (resolvedPath !== undefined) {
      return Object.freeze({
        exportName: identity.exportName ?? 'default',
        sourcePath: path.normalize(resolvedPath),
      });
    }
  }
  return sourceDeclaresRuntimeName(parsed, identity.localName)
    ? Object.freeze({ exportName: identity.exportName ?? identity.localName, sourcePath })
    : undefined;
}

/** Distinguishes a same-file component declaration from an unresolved/missing import in edited code. */
function sourceDeclaresRuntimeName(parsed: ParsedRouteModule, localName: string): boolean {
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
function readImportedExpressionBinding(
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
function isRouterDescriptorCall(expression: ts.Expression, parsed: ParsedRouteModule): boolean {
  if (ts.isIdentifier(expression)) return parsed.routerDescriptorBindings.has(expression.text);
  return (
    ts.isPropertyAccessExpression(expression) &&
    ROUTER_DESCRIPTOR_EXPORTS.has(expression.name.text) &&
    ts.isIdentifier(expression.expression) &&
    parsed.routerNamespaces.has(expression.expression.text)
  );
}

/** Reads a JSX expression attribute from the first matching authored name. */
function readJsxExpressionAttribute(
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

/** Reads a literal path attribute without evaluating templates or project constants. */
function readStaticJsxStringAttribute(
  attributes: ts.JsxAttributes,
  name: string,
): string | undefined {
  const attribute = attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && property.name.text === name,
  );
  if (attribute?.initializer === undefined) return undefined;
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  return ts.isJsxExpression(attribute.initializer) &&
    attribute.initializer.expression !== undefined &&
    ts.isStringLiteralLike(attribute.initializer.expression)
    ? attribute.initializer.expression.text
    : undefined;
}

/** Reads `<Route index>` and exact boolean JSX expressions. */
function readStaticJsxBooleanAttribute(
  attributes: ts.JsxAttributes,
  name: string,
): boolean | undefined {
  const attribute = attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && property.name.text === name,
  );
  if (attribute === undefined) return undefined;
  if (attribute.initializer === undefined) return true;
  const expression = ts.isJsxExpression(attribute.initializer)
    ? attribute.initializer.expression
    : undefined;
  if (expression?.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expression?.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

/** Reads the first direct non-Route JSX child or expression returned by a v5 Route. */
function readJsxRouteChildExpression(
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
function readJsxTagTerminalName(tagName: ts.JsxTagNameExpression): string {
  return tagName.getText().split('.').at(-1) ?? '';
}

/** Finds one exact property assignment from a route descriptor. */
function findObjectProperty(
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
function readStaticObjectStringProperty(
  objectLiteral: ts.ObjectLiteralExpression,
  name: string,
): string | undefined {
  const property = findObjectProperty(objectLiteral, [name]);
  return property !== undefined && ts.isStringLiteralLike(property.initializer)
    ? property.initializer.text
    : undefined;
}

/** Reads an exact descriptor index flag. */
function readStaticObjectBooleanProperty(
  objectLiteral: ts.ObjectLiteralExpression,
  name: string,
): boolean | undefined {
  const property = findObjectProperty(objectLiteral, [name]);
  if (property?.initializer.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (property?.initializer.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

/** Normalizes identifier and quoted object keys while rejecting computed keys. */
function readObjectPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return undefined;
}

/** Removes inert TypeScript wrappers without executing expressions. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
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
function findDynamicImportSpecifier(expression: ts.Expression): string | undefined {
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
function createComponentNameFromModuleSpecifier(moduleSpecifier: string): string {
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

/** Adds one deterministic, duplicate-free choice under the global metadata-only ceiling. */
function addChoice(
  choices: PreviewInspectorDirectRouteChoice[],
  choice: PreviewInspectorDirectRouteChoice,
): void {
  if (
    choices.length >= MAXIMUM_DIRECT_ROUTE_CHOICES ||
    choices.some(
      (candidate) =>
        candidate.pattern === choice.pattern &&
        candidate.componentName === choice.componentName &&
        candidate.sourcePath === choice.sourcePath,
    )
  ) {
    return;
  }
  choices.push(
    Object.freeze({
      componentName: choice.componentName,
      pattern: choice.pattern,
      ...(choice.reference === undefined ? {} : { reference: Object.freeze(choice.reference) }),
      sourcePath: path.normalize(choice.sourcePath),
    }),
  );
}
