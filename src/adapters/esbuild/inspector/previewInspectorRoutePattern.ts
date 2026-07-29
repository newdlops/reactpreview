/**
 * Normalizes and materializes inert React Router path evidence for Page Inspector.
 *
 * Route discovery and candidate planning both need identical handling for nested paths, dynamic
 * parameters, regular-expression constraints, and splats. Keeping those rules in this data-only
 * module prevents route-factory choice support from duplicating path semantics or growing the
 * syntax collector beyond the project's maintained-file limit.
 */

/** Joins nested route keys while treating the conventional `index` key as no path segment. */
export function joinPreviewInspectorRouteSegments(segments: readonly string[]): string {
  const meaningful = segments.flatMap((segment) =>
    segment === 'index' || segment.length === 0 ? [] : [segment],
  );
  return `/${meaningful.join('/')}`;
}

/** Rejects URLs and cleans duplicate separators without changing authored route tokens. */
export function normalizePreviewInspectorRoutePattern(pattern: string): string | undefined {
  const trimmed = pattern.trim();
  if (trimmed.length === 0 || /^[a-z][a-z\d+.-]*:/iu.test(trimmed)) return undefined;
  const pathname = (trimmed.startsWith('/') ? trimmed : `/${trimmed}`)
    .split(/[?#]/u, 1)[0]
    ?.replace(/\/{2,}/gu, '/')
    .replace(/\/$/u, '');
  return pathname === undefined || pathname.length === 0 ? '/' : pathname;
}

/** Adds one normalized supporting pattern while preserving deterministic discovery order. */
export function addPreviewInspectorSupportingRoutePattern(
  routePatterns: string[],
  pattern: string,
): boolean {
  const normalized = normalizePreviewInspectorRoutePattern(pattern);
  if (normalized === undefined) return false;
  if (!routePatterns.includes(normalized)) routePatterns.push(normalized);
  return true;
}

interface RouteParameterEvidence {
  /** Authored parameter identifier without its prefix or constraint. */
  readonly name: string;
  /** Structural segment position used to compare nested path contracts safely. */
  readonly segmentIndex: number;
  /** Complete parameter token, including an optional regular-expression suffix. */
  readonly token: string;
}

/**
 * Replaces route params and splats with deterministic values suitable for a static preview.
 *
 * A router owner often declares `:id/*`, while the selected app module separately declares
 * `:id(\\d+)`. Materialization merges those same-position parameter contracts and uses a concrete
 * compatible child/base pattern for the splat before allowing a terminal splat to consume zero
 * segments; unsupported nonterminal splats retain a visible `preview` segment.
 */
export function materializePreviewInspectorRoutePattern(
  pattern: string,
  supportingPatterns: readonly string[] = [],
): string {
  const concretePattern = selectConcreteWildcardPattern(pattern, supportingPatterns) ?? pattern;
  const evidencePatterns = [pattern, concretePattern, ...supportingPatterns];
  const parameterized = concretePattern.replace(
    /:([$_\p{ID_Start}][$_\u200C\u200D\p{ID_Continue}]*)(?:\((?:\\.|[^)])*\))?\??/gu,
    (token, name: string) =>
      selectPreviewInspectorRouteParameterValue(token, name, pattern, evidencePatterns),
  );
  const materialized = parameterized.replace(/(?:^|\/)\*+\/?$/u, '').replace(/\*+/gu, 'preview');
  return normalizePreviewInspectorRoutePattern(materialized) ?? '/';
}

/**
 * Recovers the concrete values paired with authored `:param` segments.
 *
 * React Router normally produces this record while matching. Retaining the same values in the
 * execution recipe also makes detached route state coherent for wrappers that read params before
 * the selected Route element mounts.
 */
export function collectPreviewInspectorRouteParameterValues(
  pattern: string,
  pathname: string,
): Readonly<Record<string, string>> {
  const patternSegments = splitPreviewInspectorRoutePattern(pattern);
  const pathnameSegments = splitPreviewInspectorRoutePattern(pathname);
  const values: Record<string, string> = {};
  for (const [segmentIndex, segment] of patternSegments.entries()) {
    const parameters = collectRouteParameterEvidence(`/${segment}`);
    if (parameters.length !== 1) continue;
    const parameter = parameters[0];
    const value = pathnameSegments[segmentIndex];
    if (parameter === undefined || value === undefined) continue;
    values[parameter.name] = decodeRouteParameterValue(value);
  }
  return Object.freeze(values);
}

/**
 * Removes v5-only regular-expression suffixes while retaining names and optional markers.
 *
 * React Router v6 matches `:id` but treats `:id(\\d+)` as literal syntax. The concrete pathname
 * already satisfies the authored constraint, so the generated isolated v6 Route needs only the
 * portable named parameter to expose the same `useParams()` value.
 */
export function createPreviewInspectorV6RoutePattern(pattern: string): string {
  return pattern.replace(
    /:([$_\p{ID_Start}][$_\u200C\u200D\p{ID_Continue}]*)(?:\((?:\\.|[^)])*\))(\??)/gu,
    ':$1$2',
  );
}

/** Chooses a source-evidenced value before falling back to generic identifier semantics. */
function selectPreviewInspectorRouteParameterValue(
  token: string,
  name: string,
  candidatePattern: string,
  evidencePatterns: readonly string[],
): string {
  const constraint = readRouteParameterConstraint(token);
  const constrainedValue =
    constraint === undefined ? undefined : materializeRouteParameterConstraint(constraint);
  if (constrainedValue !== undefined) return constrainedValue;
  if (hasCompatibleNumericParameterConstraint(candidatePattern, name, evidencePatterns)) return '1';
  const normalizedName = name.replace(/[_-]/gu, '').toLowerCase();
  if (normalizedName.endsWith('uuid') || normalizedName.endsWith('guid'))
    return '00000000-0000-4000-8000-000000000000';
  if (
    normalizedName.endsWith('id') ||
    /^(?:count|day|index|limit|month|number|offset|page|step|version|year)$/u.test(normalizedName)
  ) {
    return '1';
  }
  return 'preview';
}

/** Reads the balanced-enough constraint already accepted by the route-token scanner. */
function readRouteParameterConstraint(token: string): string | undefined {
  const start = token.indexOf('(');
  const end = token.lastIndexOf(')');
  return start < 0 || end <= start ? undefined : token.slice(start + 1, end);
}

/** Materializes common regex contracts without executing an authored regular expression. */
function materializeRouteParameterConstraint(constraint: string): string | undefined {
  const normalized = constraint.replace(/^\^/u, '').replace(/\$$/u, '');
  const quantifiedLengths = [...normalized.matchAll(/\{(\d+)(?:,\d*)?\}/gu)].map((match) =>
    Number.parseInt(match[1] ?? '', 10),
  );
  if (
    /uuid|guid/iu.test(normalized) ||
    (quantifiedLengths.slice(0, 5).join(',') === '8,4,4,4,12' &&
      normalized.includes('-') &&
      /[a-f]/iu.test(normalized) &&
      /0-9|\\d/iu.test(normalized))
  ) {
    return '00000000-0000-4000-8000-000000000000';
  }
  const numericLength = /(?:\\d|\[0-9\])\{(\d+)(?:,\d*)?\}/iu.exec(normalized)?.[1];
  if (numericLength !== undefined) {
    return '1'.repeat(normalizePreviewParameterLength(numericLength));
  }
  if (/\\d|\[0-9\]|digit/iu.test(normalized)) return '1';
  const hexadecimalLength = /\[(?:[a-f]-[fA-F]|[a-fA-F0-9-])+\]\{(\d+)(?:,\d*)?\}/u.exec(
    normalized,
  )?.[1];
  if (hexadecimalLength !== undefined) {
    return 'a'.repeat(normalizePreviewParameterLength(hexadecimalLength));
  }
  const literalAlternative = normalized
    .split('|')
    .map((value) => value.replace(/\\([._~-])/gu, '$1'))
    .find((value) => /^[A-Za-z0-9._~-]+$/u.test(value));
  return literalAlternative;
}

/** Keeps synthesized values small even when an authored quantifier is unexpectedly large. */
function normalizePreviewParameterLength(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? Math.max(1, Math.min(parsed, 64)) : 1;
}

/** Decodes a browser path segment while keeping malformed authored escapes inspectable. */
function decodeRouteParameterValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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
  const candidateSegments = splitPreviewInspectorRoutePattern(pattern);
  const wildcardIndex = candidateSegments.findIndex((segment) => segment.includes('*'));
  if (wildcardIndex < 0) return undefined;
  const prefix = candidateSegments.slice(0, wildcardIndex);
  if (prefix.length === 0) return undefined;

  return supportingPatterns
    .filter((supportingPattern) => !supportingPattern.includes('*'))
    .filter((supportingPattern) => {
      const supportingSegments = splitPreviewInspectorRoutePattern(supportingPattern);
      return (
        supportingSegments.length >= prefix.length &&
        prefix.every((segment, index) =>
          routeSegmentsAreCompatible(segment, supportingSegments[index] ?? ''),
        )
      );
    })
    .sort((left, right) => {
      const leftLength = splitPreviewInspectorRoutePattern(left).length;
      const rightLength = splitPreviewInspectorRoutePattern(right).length;
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
  return splitPreviewInspectorRoutePattern(pattern).flatMap((segment, segmentIndex) =>
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
  const leftSegments = splitPreviewInspectorRoutePattern(leftPattern);
  const rightSegments = splitPreviewInspectorRoutePattern(rightPattern);
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
export function splitPreviewInspectorRoutePattern(pattern: string): readonly string[] {
  return pattern.split('/').filter(Boolean);
}

/** Identifies a splat with no authored prefix, which is weaker than an exact factory base path. */
export function isPreviewInspectorRootWildcardRoutePattern(pattern: string): boolean {
  const segments = splitPreviewInspectorRoutePattern(pattern);
  return segments.length > 0 && segments.every((segment) => /^\*+$/u.test(segment));
}
