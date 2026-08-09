/** Selects a literal deferred module whose path carries one complete route-parameter choice. */
import type { PreviewInspectorAncestorPlan } from './previewInspectorAncestorPlan';
import type { PreviewInspectorPageExecutionCandidate } from './previewInspectorPageExecutionTypes';

/** Candidate-scoped parameter groups retain their boundaries to avoid cross-route unions. */
export type PreviewInspectorRouteParameterGroups = readonly (readonly string[])[];

/** Collects every selectable Next App route parameter group from broad descriptor evidence. */
export function collectPreviewInspectorRouteParameterGroups(
  plan: PreviewInspectorAncestorPlan,
): PreviewInspectorRouteParameterGroups {
  return Object.freeze(
    plan.pageCandidates.flatMap((candidate) => {
      const route = candidate.routeLocation;
      return route?.evidenceKind === 'next-app-filesystem' && 'params' in route
        ? createPreviewInspectorRouteParameterGroup(route.params)
        : [];
    }),
  );
}

/** Collects only the route parameters frozen into the selected Page Execution candidate. */
export function collectPreviewInspectorExecutionRouteParameterGroups(
  candidate: PreviewInspectorPageExecutionCandidate | undefined,
): PreviewInspectorRouteParameterGroups {
  return candidate?.routeRecipe?.kind === 'next-app'
    ? Object.freeze(createPreviewInspectorRouteParameterGroup(candidate.routeRecipe.params))
    : Object.freeze([]);
}

/** Keeps one literal lazy branch when its path contains every value from one route choice. */
export function matchesPreviewInspectorRouteParameterBranch(
  moduleSpecifier: string,
  parameterGroups: PreviewInspectorRouteParameterGroups,
): boolean {
  if (parameterGroups.length === 0) return false;
  const cleanSpecifier = moduleSpecifier.split(/[?#]/u, 1)[0] ?? moduleSpecifier;
  const segments = new Set(
    cleanSpecifier
      .split(/[\\/]/u)
      .map(normalizePreviewInspectorRouteParameterValue)
      .filter(Boolean),
  );
  return parameterGroups.some((group) => group.every((value) => segments.has(value)));
}

/** Converts one route record into zero or one normalized, immutable branch groups. */
function createPreviewInspectorRouteParameterGroup(
  params: Readonly<Record<string, string | readonly string[]>>,
): readonly (readonly string[])[] {
  const values = Object.values(params).flatMap((value) =>
    typeof value === 'string' ? [value] : [...value],
  );
  const normalizedValues = [
    ...new Set(values.map(normalizePreviewInspectorRouteParameterValue).filter(Boolean)),
  ];
  return normalizedValues.length === 0 ? [] : [Object.freeze(normalizedValues)];
}

/** Normalizes path-safe evidence without decoding arbitrary URL or filesystem syntax. */
function normalizePreviewInspectorRouteParameterValue(value: string): string {
  return value.trim().replace(/^['"]|['"]$/gu, '');
}
