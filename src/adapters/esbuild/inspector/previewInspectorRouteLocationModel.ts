/** Bounded route-location evidence limits and immutable candidate contracts. */
import {
  type PreviewInspectorDirectRouteChoice,
  type PreviewInspectorDirectRouteComponentReference,
} from './previewInspectorDirectRouteChoices';
import type { PreviewInspectorRouteLocation } from './previewInspectorRouteLocationTypes';

export const MAX_ROUTE_REGISTRY_SOURCES = 48;

export const MAX_ROUTE_CATALOGS = 16;

export const MAX_CONTEXTUAL_FACTORY_MANIFESTS = 16;

/*
 * Candidates are inert path/component records. The branch planner admits only one active choice to
 * the bundle corridor, so retaining a large application catalog here does not bundle every page.
 */
export const MAX_ROUTE_CANDIDATES = 4_096;

export const FACTORY_BASE_EVIDENCE_PENALTY = 25;

export const DIRECT_ROUTE_OCCURRENCE_EVIDENCE_BONUS = 30;

export const ROOT_WILDCARD_EVIDENCE_PENALTY = 100;

export const COMPONENT_IDENTITY_PATTERN = /^[$_\p{Lu}][$_\u200C\u200D\p{ID_Continue}]*$/u;

export interface RouteLocationCandidate extends Omit<
  PreviewInspectorRouteLocation,
  'dependencyPaths'
> {
  readonly choiceOccurrenceIdentity?: string;
  readonly dependencyPaths?: readonly string[];
  readonly identityOrder: number;
  readonly provenanceIdentity?: string;
  readonly score: number;
}

export interface ResolvedDirectRouteChoice {
  readonly candidate: RouteLocationCandidate;
  readonly choice: PreviewInspectorDirectRouteChoice;
}

export interface DuplicateDirectRouteChoice extends ResolvedDirectRouteChoice {
  readonly choice: PreviewInspectorDirectRouteChoice & {
    readonly reference: PreviewInspectorDirectRouteComponentReference;
  };
}
