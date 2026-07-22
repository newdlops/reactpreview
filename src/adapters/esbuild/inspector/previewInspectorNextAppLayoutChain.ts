/**
 * Discovers the implicit layout ancestry of a Next.js App Router page.
 *
 * App Router layouts do not import their child page, so the ordinary JavaScript import graph can
 * never prove this relationship. This module intentionally handles only Next's strict filesystem
 * convention: a nested `page` module below `app` with an existing root layout. A root layout may
 * live directly below `app`, or below an initial route-group chain when the application authors
 * multiple roots. These conventions keep generic React repositories out of this path.
 */
import path from 'node:path';

const NEXT_APP_MODULE_PATTERN = /^(?:layout|page|template)\.[cm]?[jt]sx?$/iu;
const NEXT_APP_PAGE_PATTERN = /^page\.[cm]?[jt]sx?$/iu;

/** One deterministic App Router parameter value safe to serialize into the browser bridge. */
export type PreviewInspectorNextAppParamValue = string | readonly string[];

/** Accumulated dynamic parameters visible at one page or layout segment boundary. */
export type PreviewInspectorNextAppRouteParams = Readonly<
  Record<string, PreviewInspectorNextAppParamValue>
>;

/** One implicit Next layout-compatible wrapper imported by the generated candidate shell. */
export interface PreviewInspectorNextAppLayoutReference {
  /** Next App Router requires the component to be the module's default export. */
  readonly exportName: 'default';
  /** Dynamic route parameters accumulated from the app root through this layout directory. */
  readonly params: PreviewInspectorNextAppRouteParams;
  /** Absolute authored `layout` or `template` path. */
  readonly sourcePath: string;
}

/** Filesystem-derived route evidence used when no authored route registry exists. */
export interface PreviewInspectorNextAppRouteLocation {
  /** Stable framework-facing identity displayed in route diagnostics. */
  readonly componentName: 'NextAppPage';
  /** Exact evidence discriminator reserved for the App Router filesystem convention. */
  readonly evidenceKind: 'next-app-filesystem';
  /** Browser-ready path with bounded values substituted for dynamic segments. */
  readonly pathname: string;
  /** Deterministic dynamic values supplied to the detached page component. */
  readonly params: PreviewInspectorNextAppRouteParams;
  /** Next segment pattern before dynamic values were substituted. */
  readonly pattern: string;
  /** Empty by default because filesystem evidence cannot prove URL query values. */
  readonly searchParams: Readonly<Record<string, string | readonly string[]>>;
  /** Page module that proves the implicit route. */
  readonly sourcePath: string;
}

/** Complete implicit shell surrounding one independently mountable Next page. */
export interface PreviewInspectorNextAppLayoutChain {
  /** Layouts and templates in root-to-leaf wrapper order, matching Next's authored nesting. */
  readonly layouts: readonly PreviewInspectorNextAppLayoutReference[];
  /** File-system route evidence for Next navigation and detached router shims. */
  readonly routeLocation: PreviewInspectorNextAppRouteLocation;
}

/** Reusable convention index keyed by absolute directory plus `layout`/`page`/`template` stem. */
export type PreviewInspectorNextAppModuleIndex = ReadonlyMap<string, string>;

/** Inputs for convention-only discovery over the planner's existing bounded inventory. */
export interface CollectPreviewInspectorNextAppLayoutChainOptions {
  /** Optional authored static-parameter values that replace visibly synthetic segment keys. */
  readonly dynamicParameterValues?: PreviewInspectorNextAppRouteParams;
  /** Candidate export. Next recognizes only the page module's default export as the route leaf. */
  readonly exportName: string;
  /** Candidate source. Only an exact App Router `page` module is accepted. */
  readonly pagePath: string;
  /** Optional shared index avoids sorting the same package inventory for every page candidate. */
  readonly sourceIndex?: PreviewInspectorNextAppModuleIndex;
  /** Existing project/package inventory; this helper never performs another directory walk. */
  readonly sourcePaths: readonly string[];
}

/**
 * Collects every layout/template from the branch's root layout through the page directory.
 *
 * @param options Candidate page and already-bounded source inventory.
 * @returns An immutable chain, or `undefined` outside a proven Next App Router tree.
 */
export function collectPreviewInspectorNextAppLayoutChain(
  options: CollectPreviewInspectorNextAppLayoutChainOptions,
): PreviewInspectorNextAppLayoutChain | undefined {
  const pagePath = path.normalize(options.pagePath);
  if (options.exportName !== 'default' || !NEXT_APP_PAGE_PATTERN.test(path.basename(pagePath))) {
    return undefined;
  }

  const pageDirectory = path.dirname(pagePath);
  const sourceIndex =
    options.sourceIndex ?? createPreviewInspectorNextAppModuleIndex(options.sourcePaths);
  const appRoot = findNextAppRoot(pageDirectory, sourceIndex);
  if (appRoot === undefined) return undefined;

  const routeSegments = path.relative(appRoot, pageDirectory).split(path.sep).filter(Boolean);
  // A private folder is deliberately removed from Next's route tree. Treating a page nested below
  // it as public would invent a route and is especially confusing for co-located `_components`.
  if (routeSegments.some((segment) => segment.startsWith('_'))) return undefined;
  // A page below `@slot` or an intercepted segment is not the ordinary children branch. The
  // bounded path inventory cannot prove the simultaneously active sibling slots, so mounting it
  // as `children` would fabricate a page Next never produces. Such candidates deliberately fall
  // back to the direct inspector until a future analyzer can prove and compose every named slot.
  if (routeSegments.some(isNextParallelOrInterceptedSegment)) return undefined;

  const layouts: PreviewInspectorNextAppLayoutReference[] = [];
  let layoutCount = 0;
  const accumulatedParams: Record<string, PreviewInspectorNextAppParamValue> = {};
  for (const directory of collectAncestorDirectories(appRoot, pageDirectory)) {
    const directorySegment = path
      .relative(appRoot, directory)
      .split(path.sep)
      .filter(Boolean)
      .at(-1);
    const segmentEvidence =
      directorySegment === undefined
        ? undefined
        : normalizeNextRouteSegment(directorySegment, options.dynamicParameterValues);
    if (segmentEvidence?.parameter !== undefined) {
      accumulatedParams[segmentEvidence.parameter.name] = segmentEvidence.parameter.value;
    }
    // Next places a segment template inside its layout and outside the next child segment. Keeping
    // this deterministic order lets the generic reverse composer reproduce that nesting exactly.
    for (const moduleKind of ['layout', 'template'] as const) {
      const wrapperPath = sourceIndex.get(path.join(directory, moduleKind));
      if (wrapperPath === undefined) continue;
      // In a multiple-root tree the first route-group layout is the actual document root. A stray
      // higher template cannot wrap it because no parent layout exists to own that template slot.
      if (moduleKind === 'template' && layoutCount === 0) continue;
      if (moduleKind === 'layout') layoutCount += 1;
      layouts.push(
        Object.freeze({
          exportName: 'default',
          params: freezeNextRouteParams(accumulatedParams),
          sourcePath: wrapperPath,
        }),
      );
    }
  }
  // Every real App Router branch must cross one root layout. Templates alone are not sufficient
  // evidence, while a layout under an initial route group is a legal multiple-root application.
  if (layoutCount === 0) return undefined;

  const patternSegments: string[] = [];
  const pathnameSegments: string[] = [];
  const pageParams: Record<string, PreviewInspectorNextAppParamValue> = {};
  for (const segment of routeSegments) {
    const routeSegment = normalizeNextRouteSegment(segment, options.dynamicParameterValues);
    if (routeSegment === undefined) continue;
    patternSegments.push(routeSegment.pattern);
    if (routeSegment.pathnameSegments !== undefined) {
      pathnameSegments.push(...routeSegment.pathnameSegments);
    }
    if (routeSegment.parameter !== undefined) {
      pageParams[routeSegment.parameter.name] = routeSegment.parameter.value;
    }
  }
  const pattern = joinRouteSegments(patternSegments);
  const pathname = joinRouteSegments(pathnameSegments);

  return Object.freeze({
    layouts: Object.freeze(layouts),
    routeLocation: Object.freeze({
      componentName: 'NextAppPage',
      evidenceKind: 'next-app-filesystem',
      pathname,
      params: freezeNextRouteParams(pageParams),
      pattern,
      searchParams: Object.freeze({}),
      sourcePath: pagePath,
    }),
  });
}

/**
 * Finds the outermost structurally proven App Router root above one page.
 *
 * Choosing the nearest directory named `app` breaks valid URLs such as `/download/app`: that
 * ordinary route segment is not a second router root. Conversely, blindly choosing the outermost
 * `app` breaks repositories whose own directory happens to have that name. A candidate therefore
 * needs either a direct layout or a root layout reached solely through leading route groups.
 */
function findNextAppRoot(
  pageDirectory: string,
  sourceIndex: ReadonlyMap<string, string>,
): string | undefined {
  const candidates: string[] = [];
  let current = pageDirectory;
  while (path.dirname(current) !== current) {
    if (path.basename(current).toLowerCase() === 'app') candidates.push(current);
    current = path.dirname(current);
  }
  if (path.basename(current).toLowerCase() === 'app') candidates.push(current);
  return candidates
    .reverse()
    .find((candidate) => hasProvenNextAppRootLayout(candidate, pageDirectory, sourceIndex));
}

/** Accepts a direct root layout or a multiple-root layout below only leading route groups. */
function hasProvenNextAppRootLayout(
  appRoot: string,
  pageDirectory: string,
  sourceIndex: ReadonlyMap<string, string>,
): boolean {
  if (sourceIndex.has(path.join(appRoot, 'layout'))) return true;
  let current = appRoot;
  const relative = path.relative(appRoot, pageDirectory);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    if (!/^\([^)]*\)$/u.test(segment)) return false;
    current = path.join(current, segment);
    if (sourceIndex.has(path.join(current, 'layout'))) return true;
  }
  return false;
}

/** Indexes only Next page/shell source names and deterministically prefers TSX alternatives. */
export function createPreviewInspectorNextAppModuleIndex(
  sourcePaths: readonly string[],
): PreviewInspectorNextAppModuleIndex {
  const index = new Map<string, string>();
  const sources = [...new Set(sourcePaths.map((sourcePath) => path.normalize(sourcePath)))].sort(
    compareNextModulePaths,
  );
  for (const sourcePath of sources) {
    const basename = path.basename(sourcePath);
    if (!NEXT_APP_MODULE_PATTERN.test(basename)) continue;
    const stem = basename.replace(/\.[^.]+$/u, '').toLowerCase();
    const key = path.join(path.dirname(sourcePath), stem);
    if (!index.has(key)) index.set(key, sourcePath);
  }
  return index;
}

/** Orders duplicate convention modules by the extensions Next projects most commonly author. */
function compareNextModulePaths(left: string, right: string): number {
  const extensionRank = (sourcePath: string): number => {
    const extension = path.extname(sourcePath).toLowerCase();
    if (extension === '.tsx') return 0;
    if (extension === '.jsx') return 1;
    if (extension === '.ts') return 2;
    if (extension === '.js') return 3;
    return 4;
  };
  return extensionRank(left) - extensionRank(right) || left.localeCompare(right);
}

/** Produces inclusive root-to-leaf directories without escaping the proven App Router root. */
function collectAncestorDirectories(appRoot: string, pageDirectory: string): readonly string[] {
  const relative = path.relative(appRoot, pageDirectory);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return [];
  const directories = [appRoot];
  let current = appRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    directories.push(current);
  }
  return directories;
}

/** Converts one Next route segment into authored and browser-ready representations. */
function normalizeNextRouteSegment(
  segment: string,
  dynamicParameterValues?: PreviewInspectorNextAppRouteParams,
):
  | {
      readonly parameter?: {
        readonly name: string;
        readonly value: PreviewInspectorNextAppParamValue;
      };
      readonly pathnameSegments?: readonly string[];
      readonly pattern: string;
    }
  | undefined {
  // Route groups and parallel slots shape layout selection but do not appear in the URL.
  if (/^\([^)]*\)$/u.test(segment) || segment.startsWith('@')) return undefined;

  const interceptionStripped = segment.replace(/^(?:\(\.\.\.\)|\(\.\.\)|\(\.\))+/u, '');
  const optionalCatchAll = /^\[\[\.\.\.([^\]]+)\]\]$/u.exec(interceptionStripped);
  if (optionalCatchAll !== null) {
    const name = normalizeNextParameterName(optionalCatchAll[1]);
    const values = previewCatchAllRouteValues(name, dynamicParameterValues, true);
    // Next may omit this key at runtime. Without authored evidence the empty array preserves the
    // neutral URL while allowing common collection reads such as `.map()` and `.join()` to render.
    return {
      ...(name === undefined ? {} : { parameter: { name, value: values } }),
      ...(values.length === 0 ? {} : { pathnameSegments: values }),
      pattern: interceptionStripped,
    };
  }
  const catchAll = /^\[\.\.\.([^\]]+)\]$/u.exec(interceptionStripped);
  if (catchAll !== null) {
    const name = normalizeNextParameterName(catchAll[1]);
    const values = previewCatchAllRouteValues(name, dynamicParameterValues, false);
    // Preserve every safe authored item because each one occupies a real URL segment. The fallback
    // still uses one visibly synthetic item so the required catch-all contract remains valid.
    return {
      ...(name === undefined ? {} : { parameter: { name, value: values } }),
      pathnameSegments: values,
      pattern: interceptionStripped,
    };
  }
  const dynamic = /^\[([^\]]+)\]$/u.exec(interceptionStripped);
  if (dynamic !== null) {
    const name = normalizeNextParameterName(dynamic[1]);
    const value = previewRouteValue(name, dynamicParameterValues);
    return {
      ...(name === undefined ? {} : { parameter: { name, value } }),
      pathnameSegments: Object.freeze([value]),
      pattern: interceptionStripped,
    };
  }
  const publicSegment = interceptionStripped.replace(/^%5f/iu, '_');
  return publicSegment.length === 0
    ? undefined
    : { pathnameSegments: Object.freeze([publicSegment]), pattern: publicSegment };
}

/** Preserves a safe authored catch-all array, or supplies the smallest valid neutral fallback. */
function previewCatchAllRouteValues(
  parameterName: string | undefined,
  dynamicParameterValues: PreviewInspectorNextAppRouteParams | undefined,
  optional: boolean,
): readonly string[] {
  const normalized = normalizeNextParameterName(parameterName);
  const authored = normalized === undefined ? undefined : dynamicParameterValues?.[normalized];
  const authoredValues = isNextAppParameterArray(authored)
    ? authored.filter(isSafeNextRouteValue).slice(0, 16)
    : typeof authored === 'string' && isSafeNextRouteValue(authored)
      ? [authored]
      : [];
  if (authoredValues.length > 0) return Object.freeze(authoredValues);
  return optional
    ? Object.freeze([])
    : Object.freeze([normalized === undefined || normalized.length === 0 ? 'preview' : normalized]);
}

/** Prefers safe authored evidence, then uses the key itself as a visibly synthetic fallback. */
function previewRouteValue(
  parameterName: string | undefined,
  dynamicParameterValues?: PreviewInspectorNextAppRouteParams,
): string {
  const normalized = normalizeNextParameterName(parameterName);
  const authored = normalized === undefined ? undefined : dynamicParameterValues?.[normalized];
  const authoredScalar = isNextAppParameterArray(authored) ? authored[0] : authored;
  if (typeof authoredScalar === 'string' && isSafeNextRouteValue(authoredScalar)) {
    return authoredScalar;
  }
  return normalized === undefined || normalized.length === 0 ? 'preview' : normalized;
}

/** Narrows readonly catch-all values without leaking `Array.isArray`'s mutable-any signature. */
function isNextAppParameterArray(
  value: PreviewInspectorNextAppParamValue | undefined,
): value is readonly string[] {
  return Array.isArray(value);
}

/** Rejects evidence that could escape one pathname segment or inject browser control bytes. */
function isSafeNextRouteValue(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 64 &&
    !/[\\/\u0000-\u001f\u007f]/u.test(value) &&
    value !== '.' &&
    value !== '..'
  );
}

/** Normalizes a parameter key once so the pathname and props cannot disagree. */
function normalizeNextParameterName(parameterName: string | undefined): string | undefined {
  const normalized = parameterName?.replace(/[^\p{L}\p{N}_-]+/gu, '').slice(0, 32);
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

/** Detects branches whose page is a named slot or an intercepted route rather than `children`. */
function isNextParallelOrInterceptedSegment(segment: string): boolean {
  return segment.startsWith('@') || /^(?:\(\.\)|\(\.\.\)|\(\.\.\.\))/u.test(segment);
}

/** Freezes a copy so later segment accumulation cannot mutate an earlier layout's parameters. */
function freezeNextRouteParams(
  params: Readonly<Record<string, PreviewInspectorNextAppParamValue>>,
): PreviewInspectorNextAppRouteParams {
  return Object.freeze({ ...params });
}

/** Joins normalized segments into an absolute pathname without producing a protocol-relative URL. */
function joinRouteSegments(segments: readonly string[]): string {
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}
