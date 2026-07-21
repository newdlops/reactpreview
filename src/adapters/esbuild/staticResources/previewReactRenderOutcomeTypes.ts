/**
 * JSON-safe public contracts produced by the syntax-only React render-outcome analyzer.
 *
 * Keeping transport types separate from AST traversal makes the graph boundary explicit: no
 * TypeScript node, function, symbol, or `undefined` value can accidentally enter the webview
 * descriptor. Every concrete result is recursively frozen by the analyzer before publication.
 */

/** Render-result categories that do not require executing the selected component. */
export type PreviewReactRenderOutcomeKind = 'empty' | 'jsx' | 'unknown';

/** Supported authored control-flow families represented by a graph edge. */
export type PreviewReactRenderConditionKind = 'if' | 'logical-and' | 'switch' | 'ternary';

/** The selected side of an authored render condition. */
export type PreviewReactRenderConditionBranch = 'case' | 'default' | 'falsy' | 'truthy';

/** JSON-safe switch values that a runtime resolver can select without evaluating case code. */
export type PreviewReactRenderSwitchValue = boolean | number | string | null;

/** One condition edge on the path from an exported component to a render outcome. */
export interface PreviewReactRenderConditionEdge {
  /** Selected authored side of the condition. */
  readonly branch: PreviewReactRenderConditionBranch;
  /** One-based source column of the condition expression. */
  readonly column: number;
  /** Bounded source text for the condition or switch discriminant. */
  readonly expression: string;
  /** SHA-256 of the complete trimmed expression, retained beyond the display-text boundary. */
  readonly expressionFingerprint?: string;
  /** Stable source-derived identity usable as a graph edge key. */
  readonly id: string;
  /** Syntax family that introduced this choice. */
  readonly kind: PreviewReactRenderConditionKind;
  /** Human-readable branch label such as `truthy` or `case "ready"`. */
  readonly label: string;
  /** Total ordered guards in the owning logical-AND chain. */
  readonly logicalAndGuardCount?: number;
  /** Zero-based evaluation index inside the owning logical-AND chain. */
  readonly logicalAndGuardIndex?: number;
  /** Stable source identity shared by every visible/hidden edge from one logical-AND site. */
  readonly logicalAndGroupId?: string;
  /** One-based source line of the condition expression. */
  readonly line: number;
  /** Whether an automatic resolver can safely force this exact edge. */
  readonly selectable: boolean;
  /** Source identity retained for editor navigation. */
  readonly sourcePath: string;
  /** Exact switch-case primitive; absent for dynamic cases and non-switch conditions. */
  readonly value?: PreviewReactRenderSwitchValue;
}

/** One React component occurrence or deferred DOM/text placeholder in a returned JSX hierarchy. */
export interface PreviewReactRenderComponentNode {
  /** Nested React components, with host elements and Fragments transparently skipped. */
  readonly children: readonly PreviewReactRenderComponentNode[];
  /** One-based source column of the JSX tag. */
  readonly column: number;
  /** One-based source line of the JSX tag. */
  readonly line: number;
  /** PascalCase/member tag name, or `#deferred-host-output` for a callback-only host subtree. */
  readonly name: string;
  /**
   * Indicates that this occurrence is returned by a function-valued JSX slot.
   *
   * The component is authored output, but it does not enter React's live tree until the receiving
   * component invokes the callback. Keeping that distinction prevents a loader owned by the
   * receiver from being mistaken for the selected file's completed output.
   */
  readonly renderMode?: 'deferred-callback';
  /** Module containing this JSX occurrence when bounded cross-module DFS has resolved it. */
  readonly sourcePath?: string;
}

/** One statically distinguishable JSX, empty, or unknown return result. */
export interface PreviewReactRenderOutcome {
  /** Ordered, de-duplicated DFS projection of `componentTree`. */
  readonly componentNames: readonly string[];
  /** JSX component hierarchy used to collect just the page pieces required by this outcome. */
  readonly componentTree: readonly PreviewReactRenderComponentNode[];
  /** Conditions that must be selected, in outer-to-inner order, to reach this result. */
  readonly conditions: readonly PreviewReactRenderConditionEdge[];
  /** Export whose invocation can produce this result. */
  readonly exportName: string;
  /** Stable source-and-path-derived graph node identity. */
  readonly id: string;
  /** Broad render-result category. */
  readonly kind: PreviewReactRenderOutcomeKind;
  /** Bounded label intended for a compact choice node. */
  readonly label: string;
  /** One-based source column of the returned render expression. */
  readonly column: number;
  /** One-based source line of the returned render expression. */
  readonly line: number;
  /** Source identity retained for editor navigation. */
  readonly sourcePath: string;
}

/** Complete bounded outcome inventory for one exported component. */
export interface PreviewReactRenderOutcomePlan {
  /** Runtime export key (`default` or the authored named export). */
  readonly exportName: string;
  /** All proven outcomes up to the public safety budget. */
  readonly outcomes: readonly PreviewReactRenderOutcome[];
  /** Source identity shared by every outcome and condition edge. */
  readonly sourcePath: string;
  /** Whether additional paths were intentionally omitted after reaching a safety budget. */
  readonly truncated: boolean;
}
