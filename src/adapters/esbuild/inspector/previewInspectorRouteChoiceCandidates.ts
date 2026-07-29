/**
 * Expands one authored router owner into independently selectable visible route outcomes.
 *
 * Reverse render-graph candidates describe how the selected file is mounted by its application.
 * A Provider/Routes owner can share that same caller path while rendering several mutually
 * exclusive pages. This module keeps those two axes separate: every authored caller path is cloned
 * once per exact static route choice, without changing its component ancestry or executing routing.
 */
import type { PreviewInspectorPageCandidate } from './previewInspectorAncestorTypes';
import type { PreviewInspectorRouteLocation } from './previewInspectorRouteLocation';

/**
 * Replaces generic router-base candidates with path-specific page choices.
 *
 * The base candidate is intentionally omitted when at least one exact child route exists: mounting
 * the factory base alone commonly selects a wildcard/NotFound branch and recreates the misleading
 * “no visible element” state. Stable indexed IDs preserve the user's path selection across rebuilds.
 */
export function expandPreviewInspectorRouteChoiceCandidates(
  candidates: readonly PreviewInspectorPageCandidate[],
  choices: readonly PreviewInspectorRouteLocation[],
): readonly PreviewInspectorPageCandidate[] {
  if (choices.length === 0) return candidates;
  return Object.freeze(
    candidates.flatMap((candidate) =>
      choices.map((routeLocation, choiceIndex) =>
        Object.freeze({
          ...candidate,
          dependencyPaths: Object.freeze(
            [...new Set([...candidate.dependencyPaths, ...routeLocation.dependencyPaths])].sort(),
          ),
          id: createPreviewInspectorRouteChoiceCandidateId(
            candidate.id,
            routeLocation,
            choiceIndex,
          ),
          routeLocation,
        }),
      ),
    ),
  );
}

/** Produces a JSON-safe identity that remains stable when unrelated routes are reordered. */
function createPreviewInspectorRouteChoiceCandidateId(
  candidateId: string,
  routeLocation: PreviewInspectorRouteLocation,
  choiceIndex: number,
): string {
  return [
    candidateId,
    'route-choice',
    routeLocation.componentName,
    routeLocation.pattern,
    choiceIndex.toString(),
  ].join(':');
}
