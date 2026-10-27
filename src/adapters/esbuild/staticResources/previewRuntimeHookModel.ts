/** Hook fallback contracts, private per-source analysis caches, and traversal limits. */
import ts from 'typescript';
import type { PreviewTypedCallValue } from '../typeOracle/previewTypeOracle';
import {
  type ResolvePreviewRuntimeHookImportedHelperItemFallback,
  type ResolvePreviewRuntimeHookImportedHelperPropertyFallback,
} from './previewRuntimeHookAliasUsage';
import type { PreviewRuntimeHookArrayLengthConstraintMetadata } from './previewRuntimeHookArrayLengthConstraints';
import {
  type PreviewRuntimeHookChildPropDemandSource,
  type PreviewRuntimeHookLocalTypeFallback,
} from './previewRuntimeHookChildPropDemand';

export const INSPECTOR_API_SYMBOL = 'newdlops.react-file-preview.page-inspector';

export const MAX_HOOKS_PER_MODULE = 96;

export const MAX_METADATA_TEXT_LENGTH = 180;

export const CUSTOM_HOOK_PATTERN = /^use[A-Z0-9_$][A-Za-z0-9_$]*$/u;

export const STORE_HOOK_PATTERN = /^use[A-Z0-9_$][A-Za-z0-9_$]*Store$/u;

export const LAZY_QUERY_HOOK_PATTERN = /^use(?:[A-Z0-9_$][A-Za-z0-9_$]*)?LazyQuery$/u;

export const QUERY_PARAM_MODULE = 'use-query-params';

export const REACT_CONTEXT_HOOK = 'useContext';

export const REACT_MODULE = 'react';

export const INDEXED_ITEM_ALIAS_DYNAMIC_KEYS = new Set(['0']);

export const REDUCE_IDENTITY_CARRIER_METHODS = new Set([
  'filter',
  'slice',
  'toReversed',
  'toSorted',
]);

export const DATA_HOOK_FACADE_METHODS = new Set([
  'delete',
  'get',
  'mutation',
  'patch',
  'post',
  'put',
  'query',
]);

export const EXCLUDED_MODULES = new Set([
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-dev-runtime',
  'react/jsx-runtime',
  'styled-components',
  'use-immer',
]);

/** Cross-module JSX demand is scoped to its parser tree and released after compilation. */
export const childPropDemandsBySourceFile = new WeakMap<
  ts.SourceFile,
  PreviewRuntimeHookChildPropDemandSource
>();

/** Imported/local type expansion available only during the current source transformation. */
export const localTypeFallbackBySourceFile = new WeakMap<
  ts.SourceFile,
  (typeNode: ts.TypeNode) => PreviewRuntimeHookLocalTypeFallback | undefined
>();

/** Direct imported-helper parameter contracts available only during the current transformation. */
export const importedHelperItemFallbackBySourceFile = new WeakMap<
  ts.SourceFile,
  ResolvePreviewRuntimeHookImportedHelperItemFallback
>();

/** Imported helper object-property contracts available only during the current transformation. */
export const importedHelperPropertyFallbackBySourceFile = new WeakMap<
  ts.SourceFile,
  ResolvePreviewRuntimeHookImportedHelperPropertyFallback
>();

/** Imported Array-callback parameter contracts available only during the current transformation. */
export const importedCollectionCallbackItemFallbackBySourceFile = new WeakMap<
  ts.SourceFile,
  ResolvePreviewRuntimeHookImportedHelperItemFallback
>();

/** Import or local-declaration evidence for one callable custom hook binding. */
export interface PreviewRuntimeHookBinding {
  /** Authored hook name shown in Inspector diagnostics. */
  readonly hookName: string;
  /** Static module specifier, or `local` for a same-module hook declaration. */
  readonly moduleSpecifier: string;
}

/** Namespace import and its static module specifier used by hook isolation policy. */
export type PreviewRuntimeHookNamespace = Readonly<{ moduleSpecifier: string }>;

export interface PreviewRuntimeHookInventory {
  /** Local call identifiers mapped to their authored hook identities. */
  readonly direct: ReadonlyMap<string, PreviewRuntimeHookBinding>;
  /** Namespace import identifiers mapped to their source modules. */
  readonly namespaces: ReadonlyMap<string, PreviewRuntimeHookNamespace>;
}

/** Bounded static fallback emitted beside one hook call. */
export interface PreviewRuntimeHookFallback extends PreviewRuntimeHookArrayLengthConstraintMetadata {
  /** Human-readable inference description exposed to the user. */
  readonly evidence: string;
  /** TypeScript expression evaluated lazily only after a nullish value or failure. */
  readonly expression: string;
  /** Concise generated-value description that does not execute the expression. */
  readonly label: string;
  /** Optional-only reads materialized after a thrown hook, never over a real nullish sentinel. */
  readonly failurePaths?: readonly string[];
  /** Marks an ignored result as an isolated side effect instead of a visible render blocker. */
  readonly passive?: boolean;
  /** Keeps an authored nullish sentinel when every proven local use is guarded by optional access. */
  readonly preserveNullish?: boolean;
  /** Keeps a compiler-serialized authored value intact during minimum-path convergence. */
  readonly preserveSmartValue?: true;
  /** Prevents replacing the hook module when its result also crosses an opaque value-flow edge. */
  readonly projectionUnsafe?: true;
  /** Relative scalar paths whose compiler-proven value is required to pass an early render guard. */
  readonly renderGuardPaths?: readonly string[];
  /** Compiler-proven target-only Smart values, kept separate from the dormant Auto fallback. */
  readonly smartPathValueExpressions?: readonly PreviewRuntimeHookSmartPathValueExpression[];
  /** Property paths whose absence would stop rendering at this exact hook edge. */
  readonly requiredPaths?: readonly string[];
  /** Takes an early return that renders the selected target; declared types must not override. */
  readonly targetExit?: true;
}

/** Shared scalar/container fallback shape used while recursively walking one binding pattern. */
export interface PreviewRuntimeHookValueFallback {
  /** Side-effect-free expression evaluated only inside the preview runtime boundary. */
  readonly expression: string;
  /** Human-readable generated-value family. */
  readonly label: string;
  /** Optional-only paths used to shape a caught failure without completing a real object. */
  readonly failurePaths?: readonly string[];
  /** Keeps an authored nullish sentinel when every proven local use is guarded by optional access. */
  readonly preserveNullish?: boolean;
  /** True when the fallback covers local reads but not every opaque consumer of this value. */
  readonly projectionUnsafe?: true;
  /** Keeps a generated collection empty when it is passed to a syntax-opaque helper call. */
  readonly neutralCollectionOnOpaqueCall?: true;
  /** Relative scalar paths whose compiler-proven value is required to pass an early render guard. */
  readonly renderGuardPaths?: readonly string[];
  /** Compiler-proven target-only Smart values, kept separate from the dormant Auto fallback. */
  readonly smartPathValueExpressions?: readonly PreviewRuntimeHookSmartPathValueExpression[];
  /** Paths relative to this value that local syntax proves are required. */
  readonly requiredPaths?: readonly string[];
}

/** One side-effect-free authored scalar keyed by its hook-result-relative property path. */
export interface PreviewRuntimeHookSmartPathValueExpression {
  readonly deterministicRank?: number;
  readonly expression: string;
  readonly path: string;
  readonly role?: 'collection-filter-predicate' | 'render-state';
}

/** Parsed hook call and inferred fallback before a stable identity is serialized. */
export interface PreviewRuntimeHookCandidate {
  /** Exact call expression replaced without changing its arguments. */
  readonly call: ts.CallExpression;
  /** Proven binding metadata for diagnostics and package policy. */
  readonly hook: PreviewRuntimeHookBinding;
  /** Static fallback selected from local syntax. */
  readonly fallback: PreviewRuntimeHookFallback;
  /** Declared result-type value, when the analysis program resolved the call. */
  readonly typed?: PreviewTypedCallValue;
  /** True when only the declared type (no local syntax evidence) justified instrumentation. */
  readonly typedOnly?: boolean;
}

/** Compiler-proven semantic family for one hook-result value leaf. */
export interface PreviewRuntimeHookSemanticValueDemand {
  readonly kind: 'identity';
  readonly path: string;
}

/**
 * Identifies one direct imported hook call that the runtime fallback transformer can safely cut.
 *
 * The shallow Page Inspector corridor consumes this syntax-only evidence before bundling. Matching
 * by both local name and source offset prevents an unrelated call in the same module from
 * authorizing projection of a hook reference used by the selected page shell.
 */
export interface PreviewRuntimeHookProjectionEvidence {
  /** Consumer-local import binding used as the direct call target. */
  readonly localName: string;
  /** Source offset of the exact hook identifier admitted by fallback inference. */
  readonly occurrenceStart: number;
}
