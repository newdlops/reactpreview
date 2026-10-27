/** Collects and ranks source and JSON route catalog evidence without executing registries. */
import path from 'node:path';
import ts from 'typescript';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';
import { collectPreviewRenderModuleFacts } from '../renderGraph/previewRenderModuleFacts';
import { collectPreviewInspectorRouteFactoryEvidence } from './previewInspectorRouteFactory';
import {
  COMPONENT_IDENTITY_PATTERN,
  FACTORY_BASE_EVIDENCE_PENALTY,
  MAX_ROUTE_CANDIDATES,
  ROOT_WILDCARD_EVIDENCE_PENALTY,
  type RouteLocationCandidate,
} from './previewInspectorRouteLocationModel';
import type { PreviewInspectorRouteLocation } from './previewInspectorRouteLocationTypes';
import {
  addPreviewInspectorSupportingRoutePattern as addSupportingRoutePattern,
  isPreviewInspectorRootWildcardRoutePattern as isRootWildcardRoutePattern,
  joinPreviewInspectorRouteSegments as joinRouteSegments,
  materializePreviewInspectorRoutePattern as materializeRoutePattern,
  normalizePreviewInspectorRoutePattern as normalizeRoutePattern,
} from './previewInspectorRoutePattern';

/** Accepts only plain component identifiers and removes graph labels around an identifier. */
export function normalizeComponentIdentity(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const direct = value.trim();
  if (COMPONENT_IDENTITY_PATTERN.test(direct) && /^[$_\p{Lu}]/u.test(direct)) return direct;
  const matches = direct.match(/[$_\p{Lu}][$_\u200C\u200D\p{ID_Continue}]*/gu) ?? [];
  return matches.find((candidate) => COMPONENT_IDENTITY_PATTERN.test(candidate));
}

/** Converts a kebab/snake/dotted source stem into the conventional component export spelling. */
export function toPascalCase(value: string): string {
  return value
    .split(/[^$_\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((segment) => segment.slice(0, 1).toUpperCase() + segment.slice(1))
    .join('');
}

/** Counts common normalized path segments so the target's monorepo package is inspected first. */
export function scoreRouteRegistryLocality(sourcePath: string, documentPath: string): number {
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
export function compareRouteRegistryPaths(
  left: string,
  right: string,
  documentPath: string,
): number {
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
export function collectJsonCatalogSpecifiers(
  sourcePath: string,
  sourceText: string,
): readonly string[] {
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
export function resolveRouteCatalogPath(
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
export function collectJsonCatalogCandidates(
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
export function walkCatalog(
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
export function collectSourceRouteCandidates(
  sourcePath: string,
  sourceText: string,
  identities: readonly string[],
  factoryOwnerIdentities: ReadonlySet<string>,
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
  for (const factory of collectPreviewInspectorRouteFactoryEvidence(sourceFile)) {
    contributedRoutePattern =
      addSupportingRoutePattern(routePatterns, factory.basePath) || contributedRoutePattern;
    const identityOrder =
      factory.componentName === undefined ? -1 : identities.indexOf(factory.componentName);
    if (
      identityOrder < 0 ||
      factory.componentName === undefined ||
      !factoryOwnerIdentities.has(factory.componentName)
    ) {
      continue;
    }
    // A nested app/module may have no direct catalog leaf. Its own absolute factory path is still
    // exact route evidence when the render graph proves that exported owner lies on the target path.
    addRouteCandidate(candidates, {
      componentName: factory.componentName,
      documentPath,
      evidenceKind: 'route-jsx',
      identityOrder,
      pattern: factory.basePath,
      scoreAdjustment: -FACTORY_BASE_EVIDENCE_PENALTY,
      sourcePath,
    });
  }
  return contributedRoutePattern;
}

/** Adds one normalized route and keeps distinct authored patterns even when paths materialize alike. */
export function addRouteCandidate(
  candidates: RouteLocationCandidate[],
  input: Omit<RouteLocationCandidate, 'pathname' | 'score'> & {
    readonly documentPath: string;
    readonly scoreAdjustment?: number;
  },
): void {
  if (candidates.length >= MAX_ROUTE_CANDIDATES) return;
  const pattern = normalizeRoutePattern(input.pattern);
  if (pattern === undefined) return;
  const pathname = materializeRoutePattern(pattern);
  if (
    candidates.some(
      (candidate) =>
        candidate.pattern === pattern &&
        candidate.componentName === input.componentName &&
        (candidate.choiceOccurrenceIdentity === input.choiceOccurrenceIdentity ||
          (candidate.choiceOccurrenceIdentity === undefined &&
            input.choiceOccurrenceIdentity === undefined)),
    )
  ) {
    return;
  }
  candidates.push({
    ...(input.choiceOccurrenceIdentity === undefined
      ? {}
      : { choiceOccurrenceIdentity: input.choiceOccurrenceIdentity }),
    componentName: input.componentName,
    ...(input.dependencyPaths === undefined ? {} : { dependencyPaths: input.dependencyPaths }),
    ...(input.directRouteOwnerSourcePath === undefined
      ? {}
      : { directRouteOwnerSourcePath: path.normalize(input.directRouteOwnerSourcePath) }),
    evidenceKind: input.evidenceKind,
    identityOrder: input.identityOrder,
    pathname,
    pattern,
    ...(input.provenanceIdentity === undefined
      ? {}
      : { provenanceIdentity: input.provenanceIdentity }),
    score:
      scoreRoutePattern(pattern, input.documentPath, input.identityOrder, input.evidenceKind) +
      (input.scoreAdjustment ?? 0),
    sourcePath: path.normalize(input.sourcePath),
  });
}

/** Favors exact identities, catalog evidence, and routes whose words agree with the target path. */
export function scoreRoutePattern(
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
    Math.min(routeWords.length, 20) -
    (isRootWildcardRoutePattern(pattern) ? ROOT_WILDCARD_EVIDENCE_PENALTY : 0)
  );
}

/** Orders by evidence score, then specificity and lexical identity for deterministic rebuilds. */
export function compareRouteCandidates(
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

/** Reuses bounded source reads while keeping rejected/missing files cached as absence. */
export function readCachedSource(
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
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
