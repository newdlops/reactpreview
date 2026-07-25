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
 * compatible child/base pattern for the splat before falling back to a visible `preview` segment.
 */
export function materializePreviewInspectorRoutePattern(
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
  return normalizePreviewInspectorRoutePattern(materialized) ?? '/';
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
