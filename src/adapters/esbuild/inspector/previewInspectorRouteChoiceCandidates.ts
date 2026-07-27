/**
 * Expands one authored router owner into independently selectable visible route outcomes.
 *
 * Reverse render-graph candidates describe how the selected file is mounted by its application.
 * A Provider/Routes owner can share that same caller path while rendering several mutually
 * exclusive pages. This module keeps those two axes separate: every authored caller path is cloned
 * once per exact static route choice, without changing its component ancestry or executing routing.
 */
import path from 'node:path';
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
  const resolvedChoiceRoots = new Set(
    choices.flatMap((choice) =>
      choice.componentSourcePath === undefined
        ? []
        : [
            createComponentReferenceKey({
              exportName: choice.componentExportName ?? 'default',
              sourcePath: choice.componentSourcePath,
            }),
          ],
    ),
  );
  const existingRoots = new Set(
    candidates.map((candidate) => createComponentReferenceKey(candidate.root)),
  );
  return Object.freeze(
    candidates.flatMap((candidate) =>
      choices.map((routeLocation, choiceIndex) =>
        createRouteChoiceCandidate(
          candidate,
          routeLocation,
          choiceIndex,
          resolvedChoiceRoots,
          existingRoots,
        ),
      ),
    ),
  );
}

/** Promotes a resolved descendant route page when reverse ancestry contains only its router owner. */
function createRouteChoiceCandidate(
  candidate: PreviewInspectorPageCandidate,
  routeLocation: PreviewInspectorRouteLocation,
  choiceIndex: number,
  resolvedChoiceRoots: ReadonlySet<string>,
  existingRoots: ReadonlySet<string>,
): PreviewInspectorPageCandidate {
  const id = createPreviewInspectorRouteChoiceCandidateId(candidate.id, routeLocation, choiceIndex);
  const dependencyPaths = Object.freeze(
    [...new Set([...candidate.dependencyPaths, ...routeLocation.dependencyPaths])].sort(),
  );
  const resolvedRoot =
    routeLocation.componentSourcePath === undefined
      ? undefined
      : Object.freeze({
          exportName: routeLocation.componentExportName ?? 'default',
          sourcePath: routeLocation.componentSourcePath,
        });
  const shouldDetachRouteLeaf =
    resolvedRoot !== undefined &&
    resolvedChoiceRoots.size === 1 &&
    !existingRoots.has(createComponentReferenceKey(resolvedRoot));
  if (!shouldDetachRouteLeaf) {
    return Object.freeze({
      ...candidate,
      dependencyPaths,
      id,
      routeLocation,
    });
  }
  return Object.freeze({
    complete: true,
    dependencyPaths,
    edges: Object.freeze([]),
    id,
    ...(candidate.renderPath === undefined ? {} : { renderPath: candidate.renderPath }),
    root: resolvedRoot,
    rootAutomaticProps: Object.freeze({}),
    rootOwnsRouter: false,
    routeLocation,
    stopReason: 'render-path-checkpoint',
    targetAutomaticProps: candidate.targetAutomaticProps,
  });
}

/** Normalizes a component export identity before comparing route and reverse-graph candidates. */
function createComponentReferenceKey(reference: {
  readonly exportName: string;
  readonly sourcePath: string;
}): string {
  return `${path.normalize(reference.sourcePath)}\0${reference.exportName}`;
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
