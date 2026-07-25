/**
 * Compares authored route patterns without evaluating router code.
 *
 * Factory modules commonly retain regular-expression parameter constraints while React Router
 * receives unconstrained relative paths. These helpers keep that conversion and concrete URL
 * localization deterministic. Unsupported URLs, hashes, and incompatible patterns fail closed.
 */

const PARAMETER_SEGMENT_PATTERN =
  /^:([$_\p{ID_Start}][$_\u200C\u200D\p{ID_Continue}]*)(?:\((.*)\))?\??$/u;

interface RoutePatternParameter {
  /** Parameter spelling without the leading colon. */
  readonly name: string;
  /** Optional authored regular-expression constraint. */
  readonly constraint?: string;
}

/** Removes only parameter constraints, leaving every static and dynamic segment intact. */
export function stripPreviewInspectorRouteConstraints(pattern: string): string {
  return splitRoutePattern(pattern)
    .map((segment) => {
      const parameter = readRoutePatternParameter(segment);
      return parameter === undefined
        ? segment
        : `:${parameter.name}${segment.endsWith('?') ? '?' : ''}`;
    })
    .join('/');
}

/**
 * Converts an absolute child route to the relative path accepted by its owning Router.
 *
 * The owner and child must describe the same prefix. Parameter constraints may be supplied by
 * either side, but parameter names and static segments must match exactly.
 */
export function relativizePreviewInspectorRoutePattern(
  ownerBasePattern: string,
  absoluteChildPattern: string,
): string | undefined {
  const ownerSegments = splitRoutePattern(ownerBasePattern);
  const childSegments = splitRoutePattern(absoluteChildPattern);
  if (childSegments.length < ownerSegments.length) return undefined;
  for (let index = 0; index < ownerSegments.length; index += 1) {
    if (
      !routePatternSegmentsAreCompatible(ownerSegments[index] ?? '', childSegments[index] ?? '')
    ) {
      return undefined;
    }
  }
  return stripPreviewInspectorRouteConstraints(childSegments.slice(ownerSegments.length).join('/'));
}

/**
 * Removes an authored route-owner prefix from a concrete pathname for a nested MemoryRouter.
 *
 * Query/hash-bearing input and a non-matching dynamic constraint return `undefined`; callers then
 * retain their existing pathname instead of manufacturing an unsafe route.
 */
export function localizePreviewInspectorRoutePathname(
  ownerBasePattern: string,
  concretePathname: string,
): string | undefined {
  if (/[?#]/u.test(concretePathname)) return undefined;
  const ownerSegments = splitRoutePattern(ownerBasePattern);
  const pathnameSegments = splitRoutePattern(concretePathname);
  if (pathnameSegments.length < ownerSegments.length) return undefined;
  for (let index = 0; index < ownerSegments.length; index += 1) {
    if (!concreteSegmentMatchesPattern(pathnameSegments[index] ?? '', ownerSegments[index] ?? '')) {
      return undefined;
    }
  }
  const remainder = pathnameSegments.slice(ownerSegments.length);
  return remainder.length === 0 ? '/' : `/${remainder.join('/')}`;
}

/** Splits route text into authored segments while accepting either absolute or relative patterns. */
function splitRoutePattern(pattern: string): readonly string[] {
  return pattern.split('/').filter(Boolean);
}

/** Parses one full dynamic segment; mixed static/dynamic syntax deliberately remains unsupported. */
function readRoutePatternParameter(segment: string): RoutePatternParameter | undefined {
  const match = PARAMETER_SEGMENT_PATTERN.exec(segment);
  if (match === null) return undefined;
  return Object.freeze({
    name: match[1] ?? '',
    ...(match[2] === undefined ? {} : { constraint: match[2] }),
  });
}

/** Requires exact static text or an identically named parameter on both authored route prefixes. */
function routePatternSegmentsAreCompatible(left: string, right: string): boolean {
  const leftParameter = readRoutePatternParameter(left);
  const rightParameter = readRoutePatternParameter(right);
  if (leftParameter === undefined || rightParameter === undefined) return left === right;
  return leftParameter.name === rightParameter.name;
}

/** Matches one concrete browser segment against one static or constrained dynamic route segment. */
function concreteSegmentMatchesPattern(concrete: string, pattern: string): boolean {
  const parameter = readRoutePatternParameter(pattern);
  if (parameter === undefined) return concrete === pattern;
  if (parameter.constraint !== undefined && /\\d|\[0-9\]|digit/iu.test(parameter.constraint)) {
    return /^\d+$/u.test(concrete);
  }
  return concrete.length > 0;
}
