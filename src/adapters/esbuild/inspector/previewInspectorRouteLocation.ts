/**
 * Infers a safe browser location for one statically proven Page Inspector render path.
 *
 * A detached application shell mounted under MemoryRouter at `/` often renders its login, error,
 * or index branch even though the target page is present deeper in that shell. This analyzer reads
 * only authored syntax and route-catalog JSON; it never imports a router, executes configuration,
 * or starts the application. Dynamic parameters receive obvious neutral preview values.
 */
import path from 'node:path';
import ts from 'typescript';
import type { PreviewRenderChainPlan, ResolvePreviewRenderGraphModule } from '../renderGraph';
import { collectPreviewRenderModuleFacts } from '../renderGraph/previewRenderModuleFacts';

const MAX_ROUTE_REGISTRY_SOURCES = 48;
const MAX_ROUTE_CATALOGS = 16;
const MAX_ROUTE_CANDIDATES = 128;
const ROUTE_REGISTRY_SOURCE_PATTERN =
  /^(?:(?:page|route|router|routing)s?|(?:page|route)[-_.](?:map|paths?|config|registry))(?:[-_.](?:map|paths?|config|registry))?\.[cm]?[jt]sx?$/iu;
const COMPONENT_IDENTITY_PATTERN = /^[$_\p{Lu}][$_\u200C\u200D\p{ID_Continue}]*$/u;

/** Static evidence retained with the inferred location for diagnostics and hot reload. */
export interface PreviewInspectorRouteLocation {
  /** Component/export spelling whose catalog leaf or Route element matched the target. */
  readonly componentName: string;
  /** Kind of inert source evidence used to choose the route. */
  readonly evidenceKind: 'route-catalog' | 'route-jsx';
  /** Every source whose route pattern participated in the materialized browser pathname. */
  readonly dependencyPaths: readonly string[];
  /** Browser-ready path with every dynamic segment replaced by a neutral preview value. */
  readonly pathname: string;
  /** Authored route pattern before neutral dynamic values were substituted. */
  readonly pattern: string;
  /** Absolute authored source that should invalidate this inference during hot reload. */
  readonly sourcePath: string;
}

/** Inputs kept independent from the ancestor planner so route inference is unit-testable. */
export interface CollectPreviewInspectorRouteLocationOptions {
  /** Selected source module in the editor. */
  readonly documentPath: string;
  /** Selected runtime export, including `default`. */
  readonly exportName: string;
  /** Snapshot-aware, package-bounded source reader owned by the caller. */
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  /** Optional project-aware resolver used for relative and workspace-alias JSON catalog imports. */
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  /** Exact target-to-entry evidence already computed for Page Inspector. */
  readonly renderChain: PreviewRenderChainPlan;
  /** Existing bounded authored source inventory; no second directory walk is performed. */
  readonly sourcePaths: readonly string[];
}

interface RouteLocationCandidate extends Omit<PreviewInspectorRouteLocation, 'dependencyPaths'> {
  readonly identityOrder: number;
  readonly score: number;
}

/**
 * Finds the most specific exact route for the selected component.
 *
 * Conventional route registry source names are used as a cheap index into large repositories.
 * Their relative JSON imports are then parsed as data, while JSX Route declarations are inspected
 * directly along the already-proven render path. Ambiguous candidates are ranked deterministically.
 */
export async function collectPreviewInspectorRouteLocation(
  options: CollectPreviewInspectorRouteLocationOptions,
): Promise<PreviewInspectorRouteLocation | undefined> {
  const sourceCache = new Map<string, Promise<string | undefined>>();
  const targetText = await readCachedSource(options.documentPath, options.readSource, sourceCache);
  const identities = collectTargetIdentities(options, targetText);
  if (identities.length === 0) return undefined;

  const pathSources = collectRenderPathSourcePaths(options.renderChain);
  const registrySources = options.sourcePaths
    .map((sourcePath) => path.normalize(sourcePath))
    .filter((sourcePath) => ROUTE_REGISTRY_SOURCE_PATTERN.test(path.basename(sourcePath)))
    .sort((left, right) => compareRouteRegistryPaths(left, right, options.documentPath))
    .slice(0, MAX_ROUTE_REGISTRY_SOURCES);
  // The target module can carry a factory base path even when the proven owner step lives in a
  // different module. Keep it in the bounded source set so an outer `:id/*` candidate can inherit
  // the target factory's stricter `:id(\\d+)` contract without walking another directory.
  const analysisSources = [
    ...new Set([path.normalize(options.documentPath), ...pathSources, ...registrySources]),
  ];
  const candidates: RouteLocationCandidate[] = [];
  const routePatterns: string[] = [];
  const supportingSourcePaths = new Set<string>();
  const catalogPaths = new Set<string>();
  const catalogImportersByPath = new Map<string, Set<string>>();

  for (const sourcePath of analysisSources) {
    const sourceText = await readCachedSource(sourcePath, options.readSource, sourceCache);
    if (sourceText === undefined) continue;
    const contributedRoutePattern = collectSourceRouteCandidates(
      sourcePath,
      sourceText,
      identities,
      options.documentPath,
      candidates,
      routePatterns,
    );
    if (contributedRoutePattern) supportingSourcePaths.add(sourcePath);
    if (!ROUTE_REGISTRY_SOURCE_PATTERN.test(path.basename(sourcePath))) continue;
    for (const moduleSpecifier of collectJsonCatalogSpecifiers(sourcePath, sourceText)) {
      if (catalogPaths.size >= MAX_ROUTE_CATALOGS) break;
      const catalogPath = resolveRouteCatalogPath(
        moduleSpecifier,
        sourcePath,
        options.resolveModule,
      );
      if (catalogPath === undefined) continue;
      catalogPaths.add(catalogPath);
      const catalogImporters = catalogImportersByPath.get(catalogPath) ?? new Set<string>();
      catalogImporters.add(sourcePath);
      catalogImportersByPath.set(catalogPath, catalogImporters);
    }
  }

  for (const catalogPath of catalogPaths) {
    const catalogText = await readCachedSource(catalogPath, options.readSource, sourceCache);
    if (catalogText === undefined) continue;
    collectJsonCatalogCandidates(
      catalogPath,
      catalogText,
      identities,
      options.documentPath,
      candidates,
    );
    if (candidates.length >= MAX_ROUTE_CANDIDATES) break;
  }

  const selected = candidates.sort(compareRouteCandidates)[0];
  const selectedCatalogImporters =
    selected?.evidenceKind === 'route-catalog'
      ? (catalogImportersByPath.get(selected.sourcePath) ?? [])
      : [];
  return selected === undefined
    ? undefined
    : Object.freeze({
        componentName: selected.componentName,
        dependencyPaths: Object.freeze(
          [
            ...new Set([
              selected.sourcePath,
              ...supportingSourcePaths,
              ...selectedCatalogImporters,
            ]),
          ].sort(),
        ),
        evidenceKind: selected.evidenceKind,
        pathname: materializeRoutePattern(selected.pattern, routePatterns),
        pattern: selected.pattern,
        sourcePath: selected.sourcePath,
      });
}

/** Builds exact target aliases from the selected export, local declaration, filename, and graph. */
function collectTargetIdentities(
  options: CollectPreviewInspectorRouteLocationOptions,
  targetText: string | undefined,
): readonly string[] {
  const identities: string[] = [];
  const add = (candidate: string | undefined): void => {
    const normalized = normalizeComponentIdentity(candidate);
    if (normalized !== undefined && !identities.includes(normalized)) identities.push(normalized);
  };
  if (options.exportName !== 'default') add(options.exportName);
  if (targetText !== undefined) {
    const facts = collectPreviewRenderModuleFacts(options.documentPath, targetText);
    const selectedExports = facts.exports.filter(
      (fact) => fact.exportName === options.exportName && fact.localName !== undefined,
    );
    for (const exportFact of selectedExports) {
      add(exportFact.localName);
      for (const value of facts.values) {
        if (value.localName === exportFact.localName) add(value.label);
      }
    }
    for (const value of facts.values) add(value.label);
  }
  for (const renderPath of options.renderChain.paths) {
    // Render paths are stored target-to-entry (inner-to-outer). Preserve that order so a concrete
    // page owner outranks the application shell's broad `/*` or index route.
    for (const step of renderPath.steps) {
      add(step.label);
      for (const wrapperName of step.wrapperNames) add(wrapperName);
    }
  }
  add(toPascalCase(path.basename(options.documentPath).replace(/\.[^.]+$/u, '')));
  return Object.freeze(identities);
}

/** Accepts only plain component identifiers and removes graph labels around an identifier. */
function normalizeComponentIdentity(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const direct = value.trim();
  if (COMPONENT_IDENTITY_PATTERN.test(direct) && /^[$_\p{Lu}]/u.test(direct)) return direct;
  const matches = direct.match(/[$_\p{Lu}][$_\u200C\u200D\p{ID_Continue}]*/gu) ?? [];
  return matches.find((candidate) => COMPONENT_IDENTITY_PATTERN.test(candidate));
}

/** Converts a kebab/snake/dotted source stem into the conventional component export spelling. */
function toPascalCase(value: string): string {
  return value
    .split(/[^$_\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((segment) => segment.slice(0, 1).toUpperCase() + segment.slice(1))
    .join('');
}

/** Keeps exact render-path sources first because they are the cheapest and strongest evidence. */
function collectRenderPathSourcePaths(renderChain: PreviewRenderChainPlan): readonly string[] {
  return [
    ...new Set(
      renderChain.paths.flatMap((renderPath) => [
        ...renderPath.steps.map((step) => path.normalize(step.sourcePath)),
        ...(renderPath.entryPoint === undefined
          ? []
          : [path.normalize(renderPath.entryPoint.sourcePath)]),
      ]),
    ),
  ];
}

/** Counts common normalized path segments so the target's monorepo package is inspected first. */
function scoreRouteRegistryLocality(sourcePath: string, documentPath: string): number {
  const sourceSegments = path.normalize(sourcePath).split(path.sep).filter(Boolean);
  const documentSegments = path.normalize(documentPath).split(path.sep).filter(Boolean);
  let score = 0;
  while (
    score < sourceSegments.length &&
    score < documentSegments.length &&
    sourceSegments[score] === documentSegments[score]
  ) {
    score += 1;
  }
  return score;
}

/** Prefers target-local registries, then explicit maps/configs and stable path order. */
function compareRouteRegistryPaths(left: string, right: string, documentPath: string): number {
  const score = (sourcePath: string): number =>
    /[-_.](?:map|paths?|config|registry)\./iu.test(path.basename(sourcePath)) ? 0 : 1;
  return (
    scoreRouteRegistryLocality(right, documentPath) -
      scoreRouteRegistryLocality(left, documentPath) ||
    score(left) - score(right) ||
    left.localeCompare(right)
  );
}

/** Extracts inert JSON imports while rejecting URLs, absolute paths, and Node protocol modules. */
function collectJsonCatalogSpecifiers(sourcePath: string, sourceText: string): readonly string[] {
  return collectPreviewRenderModuleFacts(sourcePath, sourceText)
    .imports.map((fact) => fact.moduleSpecifier)
    .filter((specifier) => {
      const cleanSpecifier = specifier.split(/[?#]/u, 1)[0];
      return (
        cleanSpecifier !== undefined &&
        cleanSpecifier.toLowerCase().endsWith('.json') &&
        !path.isAbsolute(cleanSpecifier) &&
        !/^[a-z][a-z\d+.-]*:/iu.test(cleanSpecifier)
      );
    });
}

/** Resolves relative or alias JSON catalogs through the caller's package-bounded module resolver. */
function resolveRouteCatalogPath(
  moduleSpecifier: string,
  consumerPath: string,
  resolveModule: ResolvePreviewRenderGraphModule | undefined,
): string | undefined {
  const cleanSpecifier = moduleSpecifier.split(/[?#]/u, 1)[0];
  if (!cleanSpecifier?.toLowerCase().endsWith('.json')) {
    return undefined;
  }
  const relative = cleanSpecifier.startsWith('./') || cleanSpecifier.startsWith('../');
  const resolved =
    resolveModule?.(cleanSpecifier, consumerPath) ??
    (relative ? path.resolve(path.dirname(consumerPath), cleanSpecifier) : undefined);
  return resolved === undefined ? undefined : path.normalize(resolved);
}

/** Parses one JSON route tree and records exact string leaves matching a target identity. */
function collectJsonCatalogCandidates(
  sourcePath: string,
  sourceText: string,
  identities: readonly string[],
  documentPath: string,
  candidates: RouteLocationCandidate[],
): void {
  let catalog: unknown;
  try {
    catalog = JSON.parse(sourceText) as unknown;
  } catch {
    return;
  }
  walkCatalog(catalog, [], (segments, componentName) => {
    const identityOrder = identities.indexOf(componentName);
    if (identityOrder < 0 || candidates.length >= MAX_ROUTE_CANDIDATES) return;
    addRouteCandidate(candidates, {
      componentName,
      documentPath,
      evidenceKind: 'route-catalog',
      identityOrder,
      pattern: joinRouteSegments(segments),
      sourcePath,
    });
  });
}

/** Walks nested path-keyed objects plus common array/object route descriptor shapes. */
function walkCatalog(
  value: unknown,
  segments: readonly string[],
  visit: (segments: readonly string[], componentName: string) => void,
): void {
  if (typeof value === 'string') {
    visit(segments, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkCatalog(item, segments, visit);
    return;
  }
  if (!isRecord(value)) return;
  const routePath = typeof value.path === 'string' ? value.path : undefined;
  const descriptorSegments = routePath === undefined ? segments : [...segments, routePath];
  for (const key of ['component', 'element', 'page', 'pageName', 'screen'] as const) {
    if (typeof value[key] === 'string') visit(descriptorSegments, value[key]);
  }
  for (const [key, child] of Object.entries(value)) {
    if (['component', 'element', 'page', 'pageName', 'path', 'screen'].includes(key)) continue;
    walkCatalog(child, [...segments, key], visit);
  }
}

/**
 * Finds route evidence in one authored module without evaluating its router configuration.
 *
 * Both JSX `<Route>` trees and the object descriptors consumed by `useRoutes` are common in the
 * same application. Factory base paths are retained as supporting patterns: they need not render
 * the target directly, but often hold a stricter dynamic-parameter contract than an outer splat.
 */
function collectSourceRouteCandidates(
  sourcePath: string,
  sourceText: string,
  identities: readonly string[],
  documentPath: string,
  candidates: RouteLocationCandidate[],
  routePatterns: string[],
): boolean {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    sourcePath.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  let contributedRoutePattern = false;
  const visitJsx = (node: ts.Node, parentSegments: readonly string[]): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tagName = opening.tagName.getText(sourceFile).split('.').at(-1);
      if (tagName === 'Route') {
        const routePath = readStaticJsxAttribute(opening.attributes, 'path', sourceFile);
        const inheritedSegments =
          parentSegments.length > 0
            ? parentSegments
            : (readEnclosingRouteFactoryBasePath(node, sourceFile) ?? []);
        const routeSegments =
          routePath === undefined
            ? inheritedSegments
            : routePath.startsWith('/')
              ? [routePath]
              : [...inheritedSegments, routePath];
        contributedRoutePattern =
          addSupportingRoutePattern(routePatterns, joinRouteSegments(routeSegments)) ||
          contributedRoutePattern;
        const renderEvidence = collectJsxRouteRenderEvidence(node, opening, sourceFile);
        for (const [identityOrder, componentName] of identities.entries()) {
          const identityPattern = new RegExp(
            `\\b${escapeRegularExpression(componentName)}\\b`,
            'u',
          );
          if (identityPattern.test(renderEvidence)) {
            addRouteCandidate(candidates, {
              componentName,
              documentPath,
              evidenceKind: 'route-jsx',
              identityOrder,
              pattern: joinRouteSegments(routeSegments),
              sourcePath,
            });
          }
        }
        if (ts.isJsxElement(node)) {
          for (const child of node.children) visitJsx(child, routeSegments);
        }
        return;
      }
    }
    ts.forEachChild(node, (child) => {
      visitJsx(child, parentSegments);
    });
  };
  visitJsx(sourceFile, []);

  contributedRoutePattern =
    collectObjectRouteCandidates(
      sourceFile,
      identities,
      documentPath,
      sourcePath,
      candidates,
      routePatterns,
    ) || contributedRoutePattern;
  return collectRouteFactoryBasePatterns(sourceFile, routePatterns) || contributedRoutePattern;
}

/**
 * Reads the component rendered directly by a React Router v5 Route.
 *
 * Nested Route subtrees are deliberately excluded: their own visitor pass owns their pathname,
 * while ordinary child expressions such as `{ready && <Page />}` remain valid render evidence.
 */
function collectJsxRouteRenderEvidence(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  opening: ts.JsxOpeningLikeElement,
  sourceFile: ts.SourceFile,
): string {
  const evidence = [opening.attributes.getText(sourceFile)];
  if (!ts.isJsxElement(node)) return evidence.join('\n');
  for (const child of node.children) {
    if (ts.isJsxElement(child)) {
      const childTag = child.openingElement.tagName.getText(sourceFile).split('.').at(-1);
      if (childTag !== 'Route') evidence.push(child.openingElement.getText(sourceFile));
    } else if (ts.isJsxSelfClosingElement(child)) {
      const childTag = child.tagName.getText(sourceFile).split('.').at(-1);
      if (childTag !== 'Route') evidence.push(child.getText(sourceFile));
    } else if (ts.isJsxExpression(child) && child.expression !== undefined) {
      evidence.push(child.expression.getText(sourceFile));
    }
  }
  return evidence.join('\n');
}

/**
 * Reads literal object route descriptors such as `{ path: "team/:id/*", element: <TeamApp /> }`.
 *
 * Only `children` arrays inherit the parent route. Other nested objects are visited independently
 * so unrelated component props cannot accidentally become route descendants.
 */
function collectObjectRouteCandidates(
  sourceFile: ts.SourceFile,
  identities: readonly string[],
  documentPath: string,
  sourcePath: string,
  candidates: RouteLocationCandidate[],
  routePatterns: string[],
): boolean {
  const descriptorRoots = collectRouterDescriptorRoots(sourceFile);
  let contributedRoutePattern = false;
  const visit = (node: ts.Node, parentSegments: readonly string[]): void => {
    if (!ts.isObjectLiteralExpression(node)) {
      ts.forEachChild(node, (child) => {
        visit(child, parentSegments);
      });
      return;
    }

    const routePath = readStaticObjectStringProperty(node, 'path');
    const isIndexRoute = readStaticObjectBooleanProperty(node, 'index') === true;
    const ownsRoute = routePath !== undefined || isIndexRoute;
    const routeSegments =
      routePath === undefined
        ? parentSegments
        : routePath.startsWith('/')
          ? [routePath]
          : [...parentSegments, routePath];

    if (ownsRoute) {
      const pattern = joinRouteSegments(routeSegments);
      contributedRoutePattern =
        addSupportingRoutePattern(routePatterns, pattern) || contributedRoutePattern;
      const renderEvidence = node.properties
        .filter(
          (property): property is ts.PropertyAssignment =>
            ts.isPropertyAssignment(property) &&
            ['Component', 'component', 'element'].includes(
              readObjectPropertyName(property.name) ?? '',
            ),
        )
        .map((property) => property.initializer.getText(sourceFile))
        .join('\n');
      for (const [identityOrder, componentName] of identities.entries()) {
        const identityPattern = new RegExp(`\\b${escapeRegularExpression(componentName)}\\b`, 'u');
        if (!identityPattern.test(renderEvidence)) continue;
        addRouteCandidate(candidates, {
          componentName,
          documentPath,
          evidenceKind: 'route-jsx',
          identityOrder,
          pattern,
          sourcePath,
        });
      }
    }

    const childrenProperty = node.properties.find(
      (property): property is ts.PropertyAssignment =>
        ts.isPropertyAssignment(property) && readObjectPropertyName(property.name) === 'children',
    );
    if (childrenProperty !== undefined) visit(childrenProperty.initializer, routeSegments);

    for (const property of node.properties) {
      if (property === childrenProperty) continue;
      // A nested route descriptor outside `children` starts a separate route branch. Passing the
      // old parent prevents ordinary element/config objects from inheriting this descriptor path.
      ts.forEachChild(property, (child) => {
        visit(child, parentSegments);
      });
    }
  };
  for (const descriptorRoot of descriptorRoots) visit(descriptorRoot, []);
  return contributedRoutePattern;
}

/** React Router functions whose first argument is an authored route descriptor tree. */
const ROUTER_DESCRIPTOR_FUNCTION_NAMES = new Set([
  'createBrowserRouter',
  'createHashRouter',
  'createMemoryRouter',
  'useRoutes',
]);

/** Finds descriptor expressions passed to exact imports from React Router packages. */
function collectRouterDescriptorRoots(sourceFile: ts.SourceFile): readonly ts.Expression[] {
  const directBindings = new Set<string>();
  const namespaceBindings = new Set<string>();
  const variableInitializers = new Map<string, ts.Expression>();
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined) {
          variableInitializers.set(declaration.name.text, declaration.initializer);
        }
      }
    }
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !/^(?:@remix-run\/react|react-router(?:-dom)?)$/u.test(statement.moduleSpecifier.text)
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaceBindings.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      if (ROUTER_DESCRIPTOR_FUNCTION_NAMES.has((element.propertyName ?? element.name).text)) {
        directBindings.add(element.name.text);
      }
    }
  }

  const roots: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isRouterDescriptorCall(node.expression)) {
      const firstArgument = node.arguments[0];
      const root =
        firstArgument !== undefined && ts.isIdentifier(firstArgument)
          ? variableInitializers.get(firstArgument.text)
          : firstArgument;
      if (root !== undefined) roots.push(unwrapRouterDescriptorExpression(root));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return roots;

  /** Requires either an exact named import or a method on an exact namespace import. */
  function isRouterDescriptorCall(expression: ts.Expression): boolean {
    if (ts.isIdentifier(expression)) return directBindings.has(expression.text);
    return (
      ts.isPropertyAccessExpression(expression) &&
      ROUTER_DESCRIPTOR_FUNCTION_NAMES.has(expression.name.text) &&
      ts.isIdentifier(expression.expression) &&
      namespaceBindings.has(expression.expression.text)
    );
  }
}

/** Removes inert TypeScript wrappers around a route descriptor expression. */
function unwrapRouterDescriptorExpression(expression: ts.Expression): ts.Expression {
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

/** Retains absolute base paths from conventional inert app/router factory calls. */
function collectRouteFactoryBasePatterns(
  sourceFile: ts.SourceFile,
  routePatterns: string[],
): boolean {
  let contributedRoutePattern = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const basePath = readRouteFactoryBasePath(node, sourceFile);
      if (basePath !== undefined) {
        contributedRoutePattern =
          addSupportingRoutePattern(routePatterns, basePath) || contributedRoutePattern;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return contributedRoutePattern;
}

/** Reads a literal string property without following spreads, identifiers, or accessors. */
function readStaticObjectStringProperty(
  objectLiteral: ts.ObjectLiteralExpression,
  name: string,
): string | undefined {
  const property = objectLiteral.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) && readObjectPropertyName(candidate.name) === name,
  );
  return property !== undefined && ts.isStringLiteralLike(property.initializer)
    ? property.initializer.text
    : undefined;
}

/** Reads the conventional boolean `index` marker on an object route descriptor. */
function readStaticObjectBooleanProperty(
  objectLiteral: ts.ObjectLiteralExpression,
  name: string,
): boolean | undefined {
  const property = objectLiteral.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) && readObjectPropertyName(candidate.name) === name,
  );
  if (property?.initializer.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (property?.initializer.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

/** Normalizes identifier and quoted object keys while rejecting computed keys. */
function readObjectPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return ts.isNumericLiteral(name) ? name.text : undefined;
}

/**
 * Recovers an absolute base path from a surrounding inert app/router module factory call.
 *
 * Modular routers frequently declare `createAppModule('/company/:id', ..., () => <Route
 * path="child" />)`. The JSX tree alone exposes only `/child`; climbing the syntax parents and
 * accepting a conventionally named create/define factory with a literal absolute first argument
 * composes the browser location without importing or executing project routing code.
 */
function readEnclosingRouteFactoryBasePath(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): readonly string[] | undefined {
  let current = node.parent;
  while (!ts.isSourceFile(current)) {
    if (ts.isCallExpression(current)) {
      const basePath = readRouteFactoryBasePath(current, sourceFile);
      if (basePath !== undefined) return [basePath];
    }
    current = current.parent;
  }
  return undefined;
}

/** Recognizes a literal absolute mount path passed to a conventional create/define route factory. */
function readRouteFactoryBasePath(
  callExpression: ts.CallExpression,
  sourceFile: ts.SourceFile,
): string | undefined {
  const calleeName = callExpression.expression.getText(sourceFile).split('.').at(-1) ?? '';
  const firstArgument = callExpression.arguments[0];
  return /^(?:create|define)[$_\p{L}\p{N}]*(?:App|Application|Module|Router|Routes)$/u.test(
    calleeName,
  ) &&
    firstArgument !== undefined &&
    ts.isStringLiteralLike(firstArgument) &&
    firstArgument.text.startsWith('/')
    ? firstArgument.text
    : undefined;
}

/** Reads a literal JSX attribute without evaluating templates or expressions. */
function readStaticJsxAttribute(
  attributes: ts.JsxAttributes,
  name: string,
  sourceFile: ts.SourceFile,
): string | undefined {
  const attribute = attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText(sourceFile) === name,
  );
  if (attribute?.initializer === undefined) return undefined;
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  const expression = ts.isJsxExpression(attribute.initializer)
    ? attribute.initializer.expression
    : undefined;
  return expression !== undefined && ts.isStringLiteralLike(expression)
    ? expression.text
    : undefined;
}

/** Adds one normalized route and attaches a specificity score without duplicating candidates. */
function addRouteCandidate(
  candidates: RouteLocationCandidate[],
  input: Omit<RouteLocationCandidate, 'pathname' | 'score'> & { readonly documentPath: string },
): void {
  const pattern = normalizeRoutePattern(input.pattern);
  if (pattern === undefined) return;
  const pathname = materializeRoutePattern(pattern);
  if (
    candidates.some(
      (candidate) =>
        candidate.pathname === pathname && candidate.componentName === input.componentName,
    )
  ) {
    return;
  }
  candidates.push({
    componentName: input.componentName,
    evidenceKind: input.evidenceKind,
    identityOrder: input.identityOrder,
    pathname,
    pattern,
    score: scoreRoutePattern(pattern, input.documentPath, input.identityOrder, input.evidenceKind),
    sourcePath: path.normalize(input.sourcePath),
  });
}

/** Joins nested route keys while treating the conventional `index` key as no path segment. */
function joinRouteSegments(segments: readonly string[]): string {
  const meaningful = segments.flatMap((segment) =>
    segment === 'index' || segment.length === 0 ? [] : [segment],
  );
  return `/${meaningful.join('/')}`;
}

/** Rejects URLs and cleans duplicate separators without changing authored route tokens. */
function normalizeRoutePattern(pattern: string): string | undefined {
  const trimmed = pattern.trim();
  if (trimmed.length === 0 || /^[a-z][a-z\d+.-]*:/iu.test(trimmed)) return undefined;
  const pathname = (trimmed.startsWith('/') ? trimmed : `/${trimmed}`)
    .split(/[?#]/u, 1)[0]
    ?.replace(/\/{2,}/gu, '/')
    .replace(/\/$/u, '');
  return pathname === undefined || pathname.length === 0 ? '/' : pathname;
}

/** Adds one normalized supporting pattern while preserving deterministic discovery order. */
function addSupportingRoutePattern(routePatterns: string[], pattern: string): boolean {
  const normalized = normalizeRoutePattern(pattern);
  if (normalized === undefined) return false;
  if (!routePatterns.includes(normalized)) routePatterns.push(normalized);
  return true;
}

interface RouteParameterEvidence {
  readonly name: string;
  readonly segmentIndex: number;
  readonly token: string;
}

/**
 * Replaces route params and splats with deterministic values suitable for a static preview.
 *
 * A router owner often declares `:id/*`, while the selected app module separately declares
 * `:id(\\d+)`. Materialization merges those same-position parameter contracts and uses a concrete
 * compatible child/base pattern for the splat before falling back to a visible `preview` segment.
 */
function materializeRoutePattern(
  pattern: string,
  supportingPatterns: readonly string[] = [],
): string {
  const concretePattern = selectConcreteWildcardPattern(pattern, supportingPatterns) ?? pattern;
  const evidencePatterns = [pattern, concretePattern, ...supportingPatterns];
  const materialized = concretePattern
    .replace(
      /:([$_\p{ID_Start}][$_\u200C\u200D\p{ID_Continue}]*)(?:\((?:\\.|[^)])*\))?\??/gu,
      (token, name: string) =>
        hasCompatibleNumericParameterConstraint(pattern, name, evidencePatterns) ||
        /\\d|\[0-9\]|digit/iu.test(token)
          ? '1'
          : 'preview',
    )
    .replace(/\*+/gu, 'preview');
  return normalizeRoutePattern(materialized) ?? '/';
}

/**
 * Selects the shortest concrete route that can satisfy a terminal splat candidate.
 *
 * Reusing a proven base/default route keeps `/partner/:id/*` at `/partner/1`; reusing a concrete
 * child yields `/partner/1/dashboard`. A root-only `/*` has no identifying prefix, so it is never
 * specialized with an unrelated route from another branch.
 */
function selectConcreteWildcardPattern(
  pattern: string,
  supportingPatterns: readonly string[],
): string | undefined {
  const candidateSegments = splitRoutePattern(pattern);
  const wildcardIndex = candidateSegments.findIndex((segment) => segment.includes('*'));
  if (wildcardIndex < 0) return undefined;
  const prefix = candidateSegments.slice(0, wildcardIndex);
  if (prefix.length === 0) return undefined;

  return supportingPatterns
    .filter((supportingPattern) => !supportingPattern.includes('*'))
    .filter((supportingPattern) => {
      const supportingSegments = splitRoutePattern(supportingPattern);
      return (
        supportingSegments.length >= prefix.length &&
        prefix.every((segment, index) =>
          routeSegmentsAreCompatible(segment, supportingSegments[index] ?? ''),
        )
      );
    })
    .sort((left, right) => {
      const leftLength = splitRoutePattern(left).length;
      const rightLength = splitRoutePattern(right).length;
      return leftLength - rightLength || right.length - left.length || left.localeCompare(right);
    })[0];
}

/** Finds whether any route in the same structural parameter position requires a numeric value. */
function hasCompatibleNumericParameterConstraint(
  candidatePattern: string,
  parameterName: string,
  evidencePatterns: readonly string[],
): boolean {
  const candidateEvidence = collectRouteParameterEvidence(candidatePattern).find(
    (evidence) => evidence.name === parameterName,
  );
  if (candidateEvidence === undefined) return false;
  return evidencePatterns.some((evidencePattern) => {
    const evidence = collectRouteParameterEvidence(evidencePattern).find(
      (candidate) =>
        candidate.name === parameterName &&
        candidate.segmentIndex === candidateEvidence.segmentIndex,
    );
    return (
      evidence !== undefined &&
      /\\d|\[0-9\]|digit/iu.test(evidence.token) &&
      routePrefixesAreCompatible(candidatePattern, evidencePattern, candidateEvidence.segmentIndex)
    );
  });
}

/** Extracts named dynamic parameters with their structural segment positions. */
function collectRouteParameterEvidence(pattern: string): readonly RouteParameterEvidence[] {
  return splitRoutePattern(pattern).flatMap((segment, segmentIndex) =>
    [
      ...segment.matchAll(
        /:([$_\p{ID_Start}][$_\u200C\u200D\p{ID_Continue}]*)(?:\((?:\\.|[^)])*\))?\??/gu,
      ),
    ].map((match) => ({
      name: match[1] ?? '',
      segmentIndex,
      token: match[0],
    })),
  );
}

/** Requires all static/dynamic segments before one shared parameter to describe the same branch. */
function routePrefixesAreCompatible(
  leftPattern: string,
  rightPattern: string,
  endIndex: number,
): boolean {
  const leftSegments = splitRoutePattern(leftPattern);
  const rightSegments = splitRoutePattern(rightPattern);
  for (let index = 0; index < endIndex; index += 1) {
    if (!routeSegmentsAreCompatible(leftSegments[index] ?? '', rightSegments[index] ?? '')) {
      return false;
    }
  }
  return true;
}

/** Treats same-name parameters as compatible even when only one route carries a regex suffix. */
function routeSegmentsAreCompatible(left: string, right: string): boolean {
  if (left === right) return true;
  const leftParameter = collectRouteParameterEvidence(`/${left}`)[0];
  const rightParameter = collectRouteParameterEvidence(`/${right}`)[0];
  return leftParameter?.name !== undefined && leftParameter.name === rightParameter?.name;
}

/** Splits a normalized route into non-empty authored segments for structural comparisons. */
function splitRoutePattern(pattern: string): readonly string[] {
  return pattern.split('/').filter(Boolean);
}

/** Favors exact identities, catalog evidence, and routes whose words agree with the target path. */
function scoreRoutePattern(
  pattern: string,
  documentPath: string,
  identityOrder: number,
  evidenceKind: PreviewInspectorRouteLocation['evidenceKind'],
): number {
  const documentWords = new Set(
    documentPath
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 2),
  );
  const routeWords = pattern
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const overlappingWords = routeWords.filter((word) => documentWords.has(word)).length;
  return (
    10_000 -
    identityOrder * 100 +
    overlappingWords * 25 +
    (evidenceKind === 'route-catalog' ? 20 : 0) +
    Math.min(routeWords.length, 20)
  );
}

/** Orders by evidence score, then specificity and lexical identity for deterministic rebuilds. */
function compareRouteCandidates(
  left: RouteLocationCandidate,
  right: RouteLocationCandidate,
): number {
  return (
    right.score - left.score ||
    right.pattern.length - left.pattern.length ||
    left.pattern.localeCompare(right.pattern) ||
    left.sourcePath.localeCompare(right.sourcePath)
  );
}

/** Escapes a proven identifier before embedding it in a short source-text regular expression. */
function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** Reuses bounded source reads while keeping rejected/missing files cached as absence. */
function readCachedSource(
  sourcePath: string,
  readSource: (sourcePath: string) => Promise<string | undefined>,
  cache: Map<string, Promise<string | undefined>>,
): Promise<string | undefined> {
  const normalizedPath = path.normalize(sourcePath);
  let sourcePromise = cache.get(normalizedPath);
  if (sourcePromise === undefined) {
    sourcePromise = readSource(normalizedPath);
    cache.set(normalizedPath, sourcePromise);
  }
  return sourcePromise;
}

/** Narrows parsed JSON without invoking inherited values or accessors. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
