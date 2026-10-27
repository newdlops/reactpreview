/** Indexes immutable render evidence without retaining source text or joining unrelated paths. */
import path from 'node:path';
import type { PreviewRenderChainCandidate } from '../renderGraph';
import { normalizeComponentIdentity } from './previewInspectorRouteLocationEvidence';

/** Queries normalized source paths and component identities within one immutable graph. */
export interface PreviewInspectorRoutePathIndex {
  /** Tests exact source/label ancestry across the graph's existing paths. */
  readonly hasAncestor: (sourcePath: string, identities: ReadonlySet<string>) => boolean;
  /** Tests a transparent corridor from the first document occurrence in the same path. */
  readonly hasTransparentCorridor: (
    sourcePath: string,
    identities: ReadonlySet<string>,
    documentPath: string,
  ) => boolean;
}

/** One occurrence's position and count of nontransparent edges strictly before it. */
interface RoutePathOccurrence {
  /** Zero-based path ordinal; evidence never crosses this boundary. */
  readonly pathIndex: number;
  /** Zero-based step ordinal within its path. */
  readonly position: number;
  /** Number of ordinary edges before this step, including any earlier target edge. */
  readonly blockersBefore: number;
  /** Normalized step label, excluding unrelated invocation and wrapper names. */
  readonly identity: string | undefined;
}

/** Primitive evidence grouped by normalized source, scoped to the weakly owned graph. */
interface RouteSourceEvidence {
  /** All normalized step labels from this source. */
  readonly identities: Set<string>;
  /** Every occurrence, preserving path and step order. */
  readonly occurrences: RoutePathOccurrence[];
  /** First source occurrence in each path, matching the original findIndex semantics. */
  readonly firstByPath: Map<number, RoutePathOccurrence>;
}

const indexes = new WeakMap<
  readonly PreviewRenderChainCandidate[],
  PreviewInspectorRoutePathIndex
>();

/**
 * Returns reusable primitive evidence only when all observed graph fields are immutable data.
 * Mutable or accessor-backed input returns undefined so callers keep their live traversal.
 * The weak key releases the index with its exact paths array; no filesystem state is cached.
 */
export function readPreviewInspectorRoutePathIndex(
  paths: readonly PreviewRenderChainCandidate[],
): PreviewInspectorRoutePathIndex | undefined {
  const retained = indexes.get(paths);
  if (retained !== undefined) return retained;
  if (!isFrozenDataArray(paths)) return undefined;
  for (const candidate of paths) {
    if (!Object.isFrozen(candidate) || !hasOwnDataProperty(candidate, 'steps')) return undefined;
    if (!isFrozenDataArray(candidate.steps)) return undefined;
    for (const step of candidate.steps) {
      if (
        !Object.isFrozen(step) ||
        !hasOwnDataProperty(step, 'sourcePath') ||
        !hasOwnDataProperty(step, 'label') ||
        !hasOwnDataProperty(step, 'kind')
      ) {
        return undefined;
      }
    }
  }
  const index = createRoutePathIndex(paths);
  indexes.set(paths, index);
  return index;
}

/** Rejects frozen getters and sparse arrays whose observable values could still change. */
function isFrozenDataArray(values: readonly unknown[]): boolean {
  if (!Object.isFrozen(values)) return false;
  for (let index = 0; index < values.length; index += 1) {
    if (!hasOwnDataProperty(values, index)) return false;
  }
  return true;
}

/** Tests descriptor shape without invoking a user-supplied getter. */
function hasOwnDataProperty(value: object, key: PropertyKey): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && Object.hasOwn(descriptor, 'value');
}

/** Materializes normalized primitive facts once, without truncating existing paths or steps. */
function createRoutePathIndex(
  paths: readonly PreviewRenderChainCandidate[],
): PreviewInspectorRoutePathIndex {
  const sources = new Map<string, RouteSourceEvidence>();
  for (const [pathIndex, candidate] of paths.entries()) {
    let blockersBefore = 0;
    for (const [position, step] of candidate.steps.entries()) {
      const sourcePath = path.normalize(step.sourcePath);
      const identity = normalizeComponentIdentity(step.label);
      let evidence = sources.get(sourcePath);
      if (evidence === undefined) {
        evidence = { identities: new Set(), occurrences: [], firstByPath: new Map() };
        sources.set(sourcePath, evidence);
      }
      const occurrence = { pathIndex, position, blockersBefore, identity };
      if (identity !== undefined) evidence.identities.add(identity);
      evidence.occurrences.push(occurrence);
      if (!evidence.firstByPath.has(pathIndex)) evidence.firstByPath.set(pathIndex, occurrence);
      if (step.kind !== 'react-lazy' && step.kind !== 're-export') blockersBefore += 1;
    }
  }
  return Object.freeze({
    hasAncestor(sourcePath: string, identities: ReadonlySet<string>): boolean {
      const evidence = sources.get(sourcePath);
      if (evidence === undefined) return false;
      for (const identity of identities) {
        if (evidence.identities.has(identity)) return true;
      }
      return false;
    },
    hasTransparentCorridor(
      sourcePath: string,
      identities: ReadonlySet<string>,
      documentPath: string,
    ): boolean {
      const component = sources.get(sourcePath);
      const target = sources.get(documentPath);
      if (component === undefined || target === undefined) return false;
      return component.occurrences.some((occurrence) => {
        if (occurrence.identity === undefined || !identities.has(occurrence.identity)) return false;
        const firstTarget = target.firstByPath.get(occurrence.pathIndex);
        // Equal monotone counts prove every edge in [target, component) is transparent.
        // A later matching component cannot recover transparency lost before an earlier match.
        return (
          firstTarget !== undefined &&
          occurrence.position > firstTarget.position &&
          occurrence.blockersBefore === firstTarget.blockersBefore
        );
      });
    },
  });
}
