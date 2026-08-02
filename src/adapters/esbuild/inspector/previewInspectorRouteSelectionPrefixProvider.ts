import path from 'node:path';
import type { PreviewInspectorRouteSelectionStep } from '../../../domain/preview';

/** Frozen audit state for one phase-local exact selection-prefix provider. */
export interface PreviewInspectorRouteSelectionPrefixProviderStatistics {
  readonly computations: number;
  readonly entries: number;
  readonly hits: number;
  readonly released: boolean;
  readonly requests: number;
}

/** Retains deeply frozen deterministic states for exact selection prefixes. */
export interface PreviewInspectorRouteSelectionPrefixProvider<State> {
  lookup(
    rootOwner: { readonly sourcePath: string; readonly exportName: string },
    selectionPrefix: readonly PreviewInspectorRouteSelectionStep[],
  ): State | undefined;
  retain(
    rootOwner: { readonly sourcePath: string; readonly exportName: string },
    selectionPrefix: readonly PreviewInspectorRouteSelectionStep[],
    state: State,
  ): State;
  getStatistics(): PreviewInspectorRouteSelectionPrefixProviderStatistics;
  release(): void;
}

interface RetainedPrefix<State> {
  readonly selectionPairs: readonly (readonly [string, string])[];
  readonly state: State;
}

/** Creates one exact-prefix provider whose retained state cannot cross phase release. */
export function createPreviewInspectorRouteSelectionPrefixProvider<State>(
  freezeState: (state: State) => State,
): PreviewInspectorRouteSelectionPrefixProvider<State> {
  const retainedByKey = new Map<string, RetainedPrefix<State>>();
  let computations = 0;
  let hits = 0;
  let released = false;
  let requests = 0;
  const createKey = (
    rootOwner: { readonly sourcePath: string; readonly exportName: string },
    selectionPrefix: readonly PreviewInspectorRouteSelectionStep[],
  ): string =>
    JSON.stringify([
      path.normalize(rootOwner.sourcePath),
      rootOwner.exportName,
      selectionPrefix.map((step) => [step.componentName, step.pattern]),
    ]);
  const assertActive = (): void => {
    if (released)
      throw new Error('Preview Inspector route-selection prefix provider was already released.');
  };
  return Object.freeze({
    getStatistics(): PreviewInspectorRouteSelectionPrefixProviderStatistics {
      return Object.freeze({
        computations,
        entries: retainedByKey.size,
        hits,
        released,
        requests,
      });
    },
    lookup(
      rootOwner: { readonly sourcePath: string; readonly exportName: string },
      selectionPrefix: readonly PreviewInspectorRouteSelectionStep[],
    ): State | undefined {
      assertActive();
      requests += 1;
      const retained = retainedByKey.get(createKey(rootOwner, selectionPrefix));
      if (retained === undefined) {
        computations += 1;
        return undefined;
      }
      hits += 1;
      return retained.state;
    },
    release(): void {
      if (released) return;
      retainedByKey.clear();
      released = true;
    },
    retain(
      rootOwner: { readonly sourcePath: string; readonly exportName: string },
      selectionPrefix: readonly PreviewInspectorRouteSelectionStep[],
      state: State,
    ): State {
      assertActive();
      const key = createKey(rootOwner, selectionPrefix);
      const retained = retainedByKey.get(key);
      if (retained !== undefined) return retained.state;
      const selectionPairs = Object.freeze(
        selectionPrefix.map((step) => Object.freeze([step.componentName, step.pattern] as const)),
      );
      const frozenState = freezeState(state);
      retainedByKey.set(key, Object.freeze({ selectionPairs, state: frozenState }));
      return frozenState;
    },
  });
}
