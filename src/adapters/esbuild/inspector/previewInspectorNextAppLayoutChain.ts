/**
 * Discovers the implicit layout ancestry of a Next.js App Router page.
 *
 * App Router layouts do not import their child page, so the ordinary JavaScript import graph can
 * never prove this relationship. This module intentionally handles only Next's strict filesystem
 * convention: a nested `page` module below `app` with an existing root `app/layout` module. Both
 * conventions keeps generic React repositories out of this framework-specific path.
 */
import path from 'node:path';

const NEXT_APP_MODULE_PATTERN = /^(?:layout|page)\.[cm]?[jt]sx?$/iu;
const NEXT_APP_PAGE_PATTERN = /^page\.[cm]?[jt]sx?$/iu;

/** One deterministic App Router parameter value safe to serialize into the browser bridge. */
export type PreviewInspectorNextAppParamValue = string | readonly string[];

/** Accumulated dynamic parameters visible at one page or layout segment boundary. */
export type PreviewInspectorNextAppRouteParams = Readonly<
  Record<string, PreviewInspectorNextAppParamValue>
>;

/** One implicit Next layout imported by the generated inspector candidate wrapper. */
export interface PreviewInspectorNextAppLayoutReference {
  /** Next App Router requires the component to be the module's default export. */
  readonly exportName: 'default';
  /** Dynamic route parameters accumulated from the app root through this layout directory. */
  readonly params: PreviewInspectorNextAppRouteParams;
  /** Absolute authored layout path. */
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
  /** Layouts in root-to-leaf order, matching Next's authored nesting order. */
  readonly layouts: readonly PreviewInspectorNextAppLayoutReference[];
  /** File-system route evidence for Next navigation and detached router shims. */
  readonly routeLocation: PreviewInspectorNextAppRouteLocation;
}

/** Inputs for convention-only discovery over the planner's existing bounded inventory. */
export interface CollectPreviewInspectorNextAppLayoutChainOptions {
  /** Candidate export. Next recognizes only the page module's default export as the route leaf. */
  readonly exportName: string;
  /** Candidate source. Only an exact App Router `page` module is accepted. */
  readonly pagePath: string;
  /** Existing project/package inventory; this helper never performs another directory walk. */
  readonly sourcePaths: readonly string[];
}

/**
 * Collects every segment layout from `app/layout` through the page's own directory.
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
  const appRoot = findNextAppRoot(pageDirectory);
  if (appRoot === undefined) return undefined;

  const routeSegments = path.relative(appRoot, pageDirectory).split(path.sep).filter(Boolean);
  // A page below `@slot` or an intercepted segment is not the ordinary children branch. The
  // bounded path inventory cannot prove the simultaneously active sibling slots, so mounting it
  // as `children` would fabricate a page Next never produces. Such candidates deliberately fall
  // back to the direct inspector until a future analyzer can prove and compose every named slot.
  if (routeSegments.some(isNextParallelOrInterceptedSegment)) return undefined;

  const sourceIndex = indexNextAppModules(options.sourcePaths);
  const rootLayout = sourceIndex.get(path.join(appRoot, 'layout'));
  // Every real App Router tree requires a root layout. This guard prevents a coincidental
  // `app/**/page.tsx` file in a framework-neutral project from changing preview semantics.
  if (rootLayout === undefined) return undefined;

  const layouts: PreviewInspectorNextAppLayoutReference[] = [];
  const accumulatedParams: Record<string, PreviewInspectorNextAppParamValue> = {};
  for (const directory of collectAncestorDirectories(appRoot, pageDirectory)) {
    const directorySegment = path
      .relative(appRoot, directory)
      .split(path.sep)
      .filter(Boolean)
      .at(-1);
    const segmentEvidence =
      directorySegment === undefined ? undefined : normalizeNextRouteSegment(directorySegment);
    if (segmentEvidence?.parameter !== undefined) {
      accumulatedParams[segmentEvidence.parameter.name] = segmentEvidence.parameter.value;
    }
    const layoutPath = sourceIndex.get(path.join(directory, 'layout'));
    if (layoutPath === undefined) continue;
    layouts.push(
      Object.freeze({
        exportName: 'default',
        params: freezeNextRouteParams(accumulatedParams),
        sourcePath: layoutPath,
      }),
    );
  }

  const patternSegments: string[] = [];
  const pathnameSegments: string[] = [];
  const pageParams: Record<string, PreviewInspectorNextAppParamValue> = {};
  for (const segment of routeSegments) {
    const routeSegment = normalizeNextRouteSegment(segment);
    if (routeSegment === undefined) continue;
    patternSegments.push(routeSegment.pattern);
    if (routeSegment.pathname !== undefined) pathnameSegments.push(routeSegment.pathname);
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

/** Finds the nearest path segment named `app`, allowing conventional `src/app` and monorepos. */
function findNextAppRoot(pageDirectory: string): string | undefined {
  let current = pageDirectory;
  while (path.dirname(current) !== current) {
    if (path.basename(current).toLowerCase() === 'app') return current;
    current = path.dirname(current);
  }
  return path.basename(current).toLowerCase() === 'app' ? current : undefined;
}

/** Indexes only Next page/layout source names and deterministically prefers TSX over alternatives. */
function indexNextAppModules(sourcePaths: readonly string[]): ReadonlyMap<string, string> {
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
function normalizeNextRouteSegment(segment: string):
  | {
      readonly parameter?: {
        readonly name: string;
        readonly value: PreviewInspectorNextAppParamValue;
      };
      readonly pathname?: string;
      readonly pattern: string;
    }
  | undefined {
  // Route groups and parallel slots shape layout selection but do not appear in the URL.
  if (/^\([^)]*\)$/u.test(segment) || segment.startsWith('@')) return undefined;

  const interceptionStripped = segment.replace(/^(?:\(\.\.\.\)|\(\.\.\)|\(\.\))+/u, '');
  const optionalCatchAll = /^\[\[\.\.\.([^\]]+)\]\]$/u.exec(interceptionStripped);
  if (optionalCatchAll !== null) {
    const name = normalizeNextParameterName(optionalCatchAll[1]);
    // Next may omit this key at runtime. The preview uses an empty array because it preserves the
    // neutral URL while allowing common collection reads such as `.map()` and `.join()` to render.
    return {
      ...(name === undefined ? {} : { parameter: { name, value: Object.freeze([] as string[]) } }),
      pattern: interceptionStripped,
    };
  }
  const catchAll = /^\[\.\.\.([^\]]+)\]$/u.exec(interceptionStripped);
  if (catchAll !== null) {
    const name = normalizeNextParameterName(catchAll[1]);
    const value = previewRouteValue(name);
    // A catch-all always consumes at least one segment, so one visibly synthetic item satisfies
    // both the filesystem pathname and the page/layout array contract without inventing content.
    return {
      ...(name === undefined ? {} : { parameter: { name, value: Object.freeze([value]) } }),
      pathname: value,
      pattern: interceptionStripped,
    };
  }
  const dynamic = /^\[([^\]]+)\]$/u.exec(interceptionStripped);
  if (dynamic !== null) {
    const name = normalizeNextParameterName(dynamic[1]);
    const value = previewRouteValue(name);
    return {
      ...(name === undefined ? {} : { parameter: { name, value } }),
      pathname: value,
      pattern: interceptionStripped,
    };
  }
  return interceptionStripped.length === 0
    ? undefined
    : { pathname: interceptionStripped, pattern: interceptionStripped };
}

/** Uses the parameter key itself to keep generated URLs short and visibly synthetic. */
function previewRouteValue(parameterName: string | undefined): string {
  const normalized = normalizeNextParameterName(parameterName);
  return normalized === undefined || normalized.length === 0 ? 'preview' : normalized;
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
