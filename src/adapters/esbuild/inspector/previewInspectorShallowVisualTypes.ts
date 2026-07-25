/**
 * Defines JSON-safe shallow visual-path evidence shared by fast context discovery and later plans.
 *
 * These contracts deliberately contain no TypeScript nodes, resolver callbacks, or application
 * values. They can therefore be frozen by the collector and passed through compiler planning
 * without creating a dependency cycle between syntax analysis, esbuild plugins, and webview code.
 */
import type { PreviewRenderInvocation } from '../renderGraph';

/** How one authored module first enters a shallow visual path. */
export type PreviewInspectorShallowVisualImportKind = 'react-lazy' | 'static';

/**
 * Visual relationship between the selected corridor child and a collected component occurrence.
 *
 * Route alternatives are retained as explicit evidence so diagnostics can explain why they were
 * omitted, while the fast artifact admits only authored siblings, wrappers, and composition slots.
 */
export type PreviewInspectorShallowVisualRelation =
  'component-prop' | 'route-alternative' | 'sibling' | 'wrapper';

/** Supported local component transports between an import/lazy binding and its rendered alias. */
export type PreviewInspectorShallowVisualLocalEdgeKind = 'alias' | 'hoc' | 'memo' | 'styled';

/** One bounded local value-flow edge retained without retaining its source AST. */
export interface PreviewInspectorShallowVisualLocalEdge {
  /** Static transport recognized at the authored reference. */
  readonly kind: PreviewInspectorShallowVisualLocalEdgeKind;
  /** Inner component binding supplied to the local wrapper. */
  readonly fromLocalName: string;
  /** Outer local binding eventually referenced by JSX or a component-valued prop. */
  readonly toLocalName: string;
  /** Zero-based offset of the authored local transport reference. */
  readonly occurrenceStart: number;
}

/**
 * One admitted module path that visibly shares a bounded render outcome with a corridor child.
 *
 * `moduleSpecifier` and `exportName` preserve exact esbuild import demand, while `sourcePath`
 * preserves the resolver result. `localEdges` explains only current-module aliases/HOCs and never
 * crosses into the imported component's own dependency graph.
 */
export interface PreviewInspectorOneHopVisualPath {
  /** Runtime export requested from the admitted authored module. */
  readonly exportName: string;
  /** Corridor module containing the selected child and collected occurrence. */
  readonly importerPath: string;
  /** Static ESM import or import-proven React.lazy origin. */
  readonly importKind: PreviewInspectorShallowVisualImportKind;
  /**
   * Exact React transport that placed this component beside the selected corridor child.
   *
   * Render callbacks are materially different from ordinary component-valued props: their returned
   * JSX belongs to the callback owner's page contract and cannot be mounted by passing a ReactNode
   * to the callback receiver. Retaining the transport lets VirtualPage execute that authentic owner
   * instead of flattening its provider/layout callback into invalid standalone components.
   */
  readonly invocation?: PreviewRenderInvocation;
  /** Bounded inner-to-outer local transports, in authored value-flow order. */
  readonly localEdges: readonly PreviewInspectorShallowVisualLocalEdge[];
  /** Exact authored module spelling consumed by the importer. */
  readonly moduleSpecifier: string;
  /** Zero-based offset of the collected JSX/component-prop occurrence. */
  readonly occurrenceStart: number;
  /**
   * Zero-based offset of the selected corridor-child occurrence in the same render outcome.
   *
   * Comparing this value with `occurrenceStart` preserves whether a visual sibling appeared before
   * or after the live page slot. Older persisted plans may omit it; consumers must then use the
   * conservative before-slot order.
   */
  readonly selectedOccurrenceStart?: number;
  /** How this occurrence contributes beside or around the selected child. */
  readonly relation: PreviewInspectorShallowVisualRelation;
  /** Local alias finally observed by the render-outcome analyzer. */
  readonly renderedLocalName: string;
  /** Zero-based offset of the shared JSX return/outcome boundary. */
  readonly renderBoundaryStart: number;
  /** Next proven module on the selected entry-to-target corridor. */
  readonly selectedChildPath: string;
  /** Resolved authored component module admitted after workspace filtering. */
  readonly sourcePath: string;
}
