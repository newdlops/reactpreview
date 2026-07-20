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

interface RouteLocationCandidate extends PreviewInspectorRouteLocation {
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
  const analysisSources = [...new Set([...pathSources, ...registrySources])];
  const candidates: RouteLocationCandidate[] = [];
  const catalogPaths = new Set<string>();

  for (const sourcePath of analysisSources) {
    const sourceText = await readCachedSource(sourcePath, options.readSource, sourceCache);
    if (sourceText === undefined) continue;
    collectJsxRouteCandidates(sourcePath, sourceText, identities, options.documentPath, candidates);
    if (!ROUTE_REGISTRY_SOURCE_PATTERN.test(path.basename(sourcePath))) continue;
    for (const moduleSpecifier of collectJsonCatalogSpecifiers(sourcePath, sourceText)) {
      if (catalogPaths.size >= MAX_ROUTE_CATALOGS) break;
      const catalogPath = resolveRouteCatalogPath(
        moduleSpecifier,
        sourcePath,
        options.resolveModule,
      );
      if (catalogPath !== undefined) catalogPaths.add(catalogPath);
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
  return selected === undefined
    ? undefined
    : Object.freeze({
        componentName: selected.componentName,
        evidenceKind: selected.evidenceKind,
        pathname: selected.pathname,
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

/** Finds nested JSX Route declarations and exact target Component/element attributes. */
function collectJsxRouteCandidates(
  sourcePath: string,
  sourceText: string,
  identities: readonly string[],
  documentPath: string,
  candidates: RouteLocationCandidate[],
): void {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    sourcePath.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const visit = (node: ts.Node, parentSegments: readonly string[]): void => {
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
        const attributeText = opening.attributes.getText(sourceFile);
        for (const [identityOrder, componentName] of identities.entries()) {
          const identityPattern = new RegExp(
            `\\b${escapeRegularExpression(componentName)}\\b`,
            'u',
          );
          if (identityPattern.test(attributeText)) {
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
          for (const child of node.children) visit(child, routeSegments);
        }
        return;
      }
    }
    ts.forEachChild(node, (child) => {
      visit(child, parentSegments);
    });
  };
  visit(sourceFile, []);
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
      const calleeName = current.expression.getText(sourceFile).split('.').at(-1) ?? '';
      const firstArgument = current.arguments[0];
      if (
        /^(?:create|define)[$_\p{L}\p{N}]*(?:App|Application|Module|Router|Routes)$/u.test(
          calleeName,
        ) &&
        firstArgument !== undefined &&
        ts.isStringLiteralLike(firstArgument) &&
        firstArgument.text.startsWith('/')
      ) {
        return [firstArgument.text];
      }
    }
    current = current.parent;
  }
  return undefined;
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

/** Replaces route params and splats with deterministic values suitable for a static preview. */
function materializeRoutePattern(pattern: string): string {
  return pattern
    .replace(
      /:[$_\p{ID_Start}][$_\u200C\u200D\p{ID_Continue}]*(?:\((?:\\.|[^)])*\))?\??/gu,
      (token) => (/\\d|\[0-9\]|digit/iu.test(token) ? '1' : 'preview'),
    )
    .replace(/\*+/gu, 'preview');
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
