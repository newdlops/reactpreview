/** Immutable virtual-page identities, path steps, shells, and emitted recipes. */
import type { PreviewInspectorPageCandidate } from './previewInspectorAncestorTypes';

/** How the generated page obtains its executable body. */
export type PreviewInspectorVirtualPageMode =
  'authored-root' | 'next-app-filesystem' | 'next-pages-filesystem' | 'static-page-checkpoint';

/** One omitted outer path step retained as VirtualPage composition evidence. */
export interface PreviewInspectorVirtualPagePathStep {
  /** Static confidence attached to the authored render edge. */
  readonly certainty: 'conditional' | 'confirmed';
  /** React/value-flow relationship used by the application path. */
  readonly kind: string;
  /** Local component, route, or wrapper label shown by Inspector diagnostics. */
  readonly label: string;
  /** Component-valued prop or slot crossed by this edge, when statically known. */
  readonly slotName?: string;
  /** Authored source identity retained for navigation and hot reload. */
  readonly sourcePath: string;
  /** Local HOC/styled/memo wrappers crossed by this exact step. */
  readonly wrapperNames: readonly string[];
}

/** One importable layout boundary selected from inert one-hop JSX evidence. */
export interface PreviewInspectorVirtualPageShell {
  /** Module whose selected render outcome placed this shell around or beside the route child. */
  readonly importerPath: string;
  /** Exact component export imported by the generated VirtualPage module. */
  readonly root: PreviewInspectorPageCandidate['root'];
  /**
   * Static composition relationship retained for diagnostics and runtime placement.
   *
   * `owner` is a proven corridor component that already renders the inner route itself. It runs as
   * an authentic page root and falls back to the next inner frame only when it throws.
   */
  readonly relation: 'owner' | 'sibling' | 'wrapper';
  /**
   * Sibling position around the selected page slot. Wrappers omit this and contain the whole group.
   */
  readonly placement?: 'after' | 'before';
}

/**
 * JSON-safe recipe emitted beside a generated VirtualPage loader.
 *
 * `authoredRoot` remains the statically proven application-side root. `contentRoot` is the smaller
 * executable checkpoint that can render without running unrelated application initialization.
 */
export interface PreviewInspectorVirtualPageRecipe {
  /** Proven outer root that would normally own the complete authored application flow. */
  readonly authoredRoot: PreviewInspectorPageCandidate['root'];
  /** Number of outer render steps intentionally represented as static composition evidence. */
  readonly bypassedStepCount: number;
  /** Real component module imported as the live VirtualPage body. */
  readonly contentRoot: PreviewInspectorPageCandidate['root'];
  /** Stable strategy label consumed by browser diagnostics and regression logs. */
  readonly mode: PreviewInspectorVirtualPageMode;
  /** Outer-to-inner application steps between the authored root and live content checkpoint. */
  readonly omittedOuterPath: readonly PreviewInspectorVirtualPagePathStep[];
  /** Static render-path identity shared by authored and content roots, when available. */
  readonly renderPathId?: string;
  /** Outer-to-inner layout components composed around the live page body. */
  readonly shells: readonly PreviewInspectorVirtualPageShell[];
}

/** Build-time pairing used by the root source generator. */
export interface PreviewInspectorVirtualPageCandidate {
  /** Highest-ranked authored application candidate that supplied path provenance. */
  readonly authoredCandidate: PreviewInspectorPageCandidate;
  /** Browser-facing candidate whose root and props describe the executable VirtualPage body. */
  readonly browserCandidate: PreviewInspectorPageCandidate;
  /** Candidate imported by the generated VirtualPage module. */
  readonly contentCandidate: PreviewInspectorPageCandidate;
  /** Serializable VirtualPage composition recipe. */
  readonly recipe: PreviewInspectorVirtualPageRecipe;
}
