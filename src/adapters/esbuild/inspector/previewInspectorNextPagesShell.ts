/**
 * Discovers the implicit `_app` shell and pathname of a Next.js Pages Router page.
 *
 * Next never expresses `_app -> Component` as an import edge: the framework injects the selected
 * page through props. A generic reverse-import graph therefore stops at the page and omits global
 * providers, headers, navigation, and styles. This module handles only the strict filesystem
 * convention where a default page export lives below `pages` and that same directory owns `_app`.
 */
import path from 'node:path';

const NEXT_PAGES_APP_PATTERN = /^_app\.[cm]?[jt]sx?$/iu;
const NEXT_PAGES_PAGE_PATTERN = /\.[cm]?[jt]sx?$/iu;

/** Filesystem route evidence emitted for one conventional Pages Router module. */
export interface PreviewInspectorNextPagesRouteLocation {
  readonly componentName: 'NextPagesPage';
  /** Distinguishes an authored route leaf from the bounded no-page `_app` fallback. */
  readonly evidenceKind: 'next-pages-filesystem' | 'next-pages-synthetic';
  readonly pathname: string;
  readonly pattern: string;
  readonly sourcePath: string;
}

/** Implicit framework wrapper attached to an otherwise ordinary authored page candidate. */
export interface PreviewInspectorNextPagesShell {
  readonly app: {
    readonly exportName: 'default';
    readonly sourcePath: string;
  };
  readonly routeLocation: PreviewInspectorNextPagesRouteLocation;
  /** Uses an extension-owned empty page only when the selected `_app` has no safe authored leaf. */
  readonly syntheticPage?: true;
}

/** Inputs bounded by the ancestor planner's existing project source inventory. */
export interface CollectPreviewInspectorNextPagesShellOptions {
  /** Optional static-record evidence for dynamic filesystem parameters. */
  readonly dynamicParameterValues?: Readonly<Record<string, string>>;
  readonly exportName: string;
  readonly pagePath: string;
  readonly sourcePaths: readonly string[];
}

/**
 * Returns the same-project `_app` wrapper and a neutralized filesystem pathname.
 *
 * API routes, Next special pages, non-default exports, and coincidental folders without `_app`
 * fail closed. Dynamic segments use their short key as a visibly synthetic local value.
 */
export function collectPreviewInspectorNextPagesShell(
  options: CollectPreviewInspectorNextPagesShellOptions,
): PreviewInspectorNextPagesShell | undefined {
  const pagePath = path.normalize(options.pagePath);
  if (
    options.exportName !== 'default' ||
    !NEXT_PAGES_PAGE_PATTERN.test(path.basename(pagePath)) ||
    NEXT_PAGES_APP_PATTERN.test(path.basename(pagePath))
  ) {
    return undefined;
  }
  const pagesRoot = findPagesRoot(path.dirname(pagePath));
  if (pagesRoot === undefined) return undefined;
  const relativePagePath = path.relative(pagesRoot, pagePath);
  const relativeSegments = relativePagePath.split(path.sep).filter(Boolean);
  const firstSegment = relativeSegments[0]?.toLowerCase();
  const pageStem = path.basename(pagePath).replace(NEXT_PAGES_PAGE_PATTERN, '');
  if (
    firstSegment === 'api' ||
    /^_(?:document|error)$/iu.test(pageStem) ||
    /^(?:404|500)$/u.test(pageStem)
  ) {
    return undefined;
  }
  const appPath = selectNextPagesAppPath(pagesRoot, options.sourcePaths);
  if (appPath === undefined) return undefined;
  const patternSegments = relativeSegments.map((segment, index) =>
    index === relativeSegments.length - 1 ? segment.replace(NEXT_PAGES_PAGE_PATTERN, '') : segment,
  );
  if (patternSegments.at(-1)?.toLowerCase() === 'index') patternSegments.pop();
  const pathnameSegments = patternSegments.flatMap((segment) =>
    materializeNextPagesSegment(segment, options.dynamicParameterValues),
  );
  const pattern = joinSegments(patternSegments);
  const pathname = joinSegments(pathnameSegments);
  return Object.freeze({
    app: Object.freeze({ exportName: 'default', sourcePath: appPath }),
    routeLocation: Object.freeze({
      componentName: 'NextPagesPage',
      evidenceKind: 'next-pages-filesystem',
      pathname,
      pattern,
      sourcePath: pagePath,
    }),
  });
}

/** Finds the nearest conventional pages directory without escaping the filesystem root. */
function findPagesRoot(startDirectory: string): string | undefined {
  let current = startDirectory;
  while (path.dirname(current) !== current) {
    if (path.basename(current).toLowerCase() === 'pages') return current;
    current = path.dirname(current);
  }
  return path.basename(current).toLowerCase() === 'pages' ? current : undefined;
}

/** Selects the preferred TSX/JSX/TS/JS `_app` module from the existing bounded inventory. */
function selectNextPagesAppPath(
  pagesRoot: string,
  sourcePaths: readonly string[],
): string | undefined {
  const extensionRank = new Map([
    ['.tsx', 0],
    ['.jsx', 1],
    ['.ts', 2],
    ['.js', 3],
  ]);
  return sourcePaths
    .map((sourcePath) => path.normalize(sourcePath))
    .filter(
      (sourcePath) =>
        path.dirname(sourcePath) === pagesRoot &&
        NEXT_PAGES_APP_PATTERN.test(path.basename(sourcePath)),
    )
    .sort(
      (left, right) =>
        (extensionRank.get(path.extname(left).toLowerCase()) ?? 4) -
          (extensionRank.get(path.extname(right).toLowerCase()) ?? 4) || left.localeCompare(right),
    )[0];
}

/** Converts one literal/dynamic Pages segment into a deterministic browser pathname segment. */
function materializeNextPagesSegment(
  segment: string,
  parameterValues: Readonly<Record<string, string>> | undefined,
): readonly string[] {
  const optionalCatchAll = /^\[\[\.\.\.([^\]]+)\]\]$/u.exec(segment);
  if (optionalCatchAll !== null) return [];
  const catchAll = /^\[\.\.\.([^\]]+)\]$/u.exec(segment);
  if (catchAll !== null) return [materializeParameterValue(catchAll[1], parameterValues)];
  const dynamic = /^\[([^\]]+)\]$/u.exec(segment);
  return dynamic === null ? [segment] : [materializeParameterValue(dynamic[1], parameterValues)];
}

/** Encodes a proven record key or falls back to the short visible parameter name. */
function materializeParameterValue(
  parameterName: string | undefined,
  parameterValues: Readonly<Record<string, string>> | undefined,
): string {
  const inferred = parameterName === undefined ? undefined : parameterValues?.[parameterName];
  if (
    typeof inferred === 'string' &&
    inferred.length > 0 &&
    inferred.length <= 64 &&
    !/[\\/\u0000-\u001f\u007f]/u.test(inferred) &&
    inferred !== '.' &&
    inferred !== '..'
  ) {
    return encodeURIComponent(inferred);
  }
  return normalizeParameterName(parameterName);
}

/** Keeps generated dynamic values short enough to avoid distorting page layout. */
function normalizeParameterName(value: string | undefined): string {
  const normalized = value?.replace(/[^\p{L}\p{N}_-]+/gu, '').slice(0, 32);
  return normalized === undefined || normalized.length === 0 ? 'preview' : normalized;
}

/** Joins route segments without ever producing a protocol-relative location. */
function joinSegments(segments: readonly string[]): string {
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}
