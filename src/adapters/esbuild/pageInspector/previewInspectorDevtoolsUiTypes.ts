/** Public data-only contracts consumed by React Page Inspector tree collectors and UI adapters. */

/** Source location exposed to the UI without prescribing an extension-host transport. */
export interface PreviewInspectorUiSourceLocation {
  /** Optional one-based source column. */
  readonly column?: number;
  /** Human-readable file label; collectors may omit the absolute path from this value. */
  readonly displayName?: string;
  /** Optional one-based source line. */
  readonly line?: number;
  /** Optional collector byte/character offset used to disambiguate repeated component names. */
  readonly occurrenceStart?: number;
  /** Collector-owned source identity forwarded unchanged to `openSource`. */
  readonly path?: string;
  /** Compatibility spelling emitted by static/Fiber source evidence before UI normalization. */
  readonly sourcePath?: string;
}

/** One read-only React component node accepted by the Inspector UI. */
export interface PreviewInspectorUiTreeNode {
  /** Nested React component children; HTML host nodes should be omitted or marked as `host`. */
  readonly children: readonly PreviewInspectorUiTreeNode[];
  /** Compiler-issued switch metadata present only on editable multi-way render-choice rows. */
  readonly choice?: unknown;
  /** Stable compiler-issued identity present only on multi-way render-choice rows. */
  readonly choiceId?: string;
  /** Render-graph certainty retained only on inert entry, route, lazy, or wrapper context nodes. */
  readonly certainty?: 'conditional' | 'confirmed';
  /** Compiler-issued condition metadata present only on editable conditional-render pseudo nodes. */
  readonly condition?: unknown;
  /** Stable compiler-issued identity present only on conditional-render pseudo nodes. */
  readonly conditionId?: string;
  /** True for data-only route/entry/group nodes that do not claim a mounted Fiber identity. */
  readonly contextOnly?: boolean;
  /** Marks a component export declared by the source file whose preview tab is pinned. */
  readonly currentFileExport?: boolean;
  /** Static render-graph relationship represented by a context-only node. */
  readonly edgeKind?: string;
  /** Export identity when the node is an instrumented editable target or ancestor root. */
  readonly exportName?: string;
  /** Stable identity for selection across collector refreshes. */
  readonly id: string;
  /** Collector classification such as `component`, `target`, `root`, or `host`. */
  readonly kind: string;
  /** Component display name shown in the tree. */
  readonly name: string;
  /** Distinguishes a live export from one retained only in the current-file inventory. */
  readonly mounted?: boolean;
  /** Mounted/dormant state supplied only for overlay components and portals. */
  readonly overlayState?: 'dormant' | 'mounted';
  /** Read-only props snapshot; only instrumented target/root props are editable. */
  readonly props?: unknown;
  /** Structural presentation role proven by the collector. */
  readonly role?: 'overlay' | 'transparent-wrapper';
  /** Source location suitable for the optional source-opening adapter. */
  readonly source?: PreviewInspectorUiSourceLocation;
  /** Read-only class, hook, or collector-defined state snapshot. */
  readonly state?: unknown;
}

/** Bounded component-tree snapshot returned by the optional live collector. */
export interface PreviewInspectorUiTreeSnapshot {
  /** React component roots currently mounted below the preview root. */
  readonly roots: readonly PreviewInspectorUiTreeNode[];
  /** Collector-selected node, when selection originated from host picking or another adapter. */
  readonly selectedId?: string;
  /** Optional collector capability or freshness note shown above the tree. */
  readonly status?: string;
  /** Whether a collector visit bound omitted deeper or later component nodes. */
  readonly truncated?: boolean;
}

/** Small browser contract between the UI shell and an independently implemented tree collector. */
export interface PreviewInspectorUiAdapter {
  /** Returns a current read-only React component tree. */
  collectTree(): PreviewInspectorUiTreeSnapshot;
  /** Mirrors a tree-row selection back into the live collector with optional export identity. */
  selectNode?(id: string, exportName?: string): void;
  /** Subscribes to React commits; returning cleanup follows React effect conventions. */
  subscribeTree?(listener: () => void): (() => void) | undefined;
}
