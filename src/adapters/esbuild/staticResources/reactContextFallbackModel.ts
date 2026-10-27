/** Bounded Context fallback contracts, mutable shape state, and traversal limits. */
import ts from 'typescript';
import { PREVIEW_COLLECTION_METHOD_NAMES } from '../previewCollectionMethodNames';
import type { ResolvePreviewRuntimeHookImportedHelperPropertyFallback } from './previewRuntimeHookAliasUsage';

export const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

export const COLLECTION_METHOD_NAMES = new Set<string>(PREVIEW_COLLECTION_METHOD_NAMES);

export const COLLECTION_ITEM_CALLBACK_METHODS = new Set([
  'every',
  'filter',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'flatMap',
  'forEach',
  'map',
  'some',
  'sort',
]);

export const COLLECTION_IDENTITY_METHODS = new Set(['filter', 'slice', 'toReversed', 'toSorted']);

export const CONTEXT_HOOK_NAME_PATTERN = /^use[A-Za-z0-9_$]*Context$/u;

export const MAX_ALIASES_PER_SCOPE = 256;

export const MAX_CANDIDATES_PER_MODULE = 64;

export const MAX_FALLBACK_PATHS = 128;

export const MAX_GENERATED_FALLBACK_LENGTH = 8_192;

export const MAX_PATH_DEPTH = 16;

export const MAX_PROPERTY_NAME_LENGTH = 128;

export const MAX_SCOPES_PER_CANDIDATE = 512;

export const MAX_VALUE_CHOICE_PATHS = 16;

/** One original hook-call replacement suitable for a shared right-to-left source rewrite pass. */
export interface ReactContextHookFallbackReplacement {
  /** Exclusive source offset immediately after the original hook call. */
  readonly end: number;
  /** Module binding that owns the stable deeply frozen fallback. */
  readonly fallbackBinding: string;
  /** Exact-range arbitration weight for a registration-coupled Context fallback. */
  readonly priority: number;
  /** Parenthesized nullish fallback expression containing the unchanged original hook call. */
  readonly replacement: string;
  /** Inclusive source offset at the beginning of the original hook call. */
  readonly start: number;
}

/** One runtime-safe hook/fallback pair used by the exact Context identity bridge. */
export interface ReactContextHookFallbackRegistration {
  /** Module binding that owns the stable deeply frozen fallback shape. */
  readonly fallbackBinding: string;
  /** Original import-proven hook callee expression, such as `useAppContext`. */
  readonly hookExpression: string;
}

/** Complete source additions derived for one project module. */
export interface ReactContextHookFallbackTransform {
  /** Module-level `const` declarations appended once and evaluated before React renders. */
  readonly declarations: readonly string[];
  /** Hook identities and shapes that an automatic outer Context boundary may compose. */
  readonly registrations: readonly ReactContextHookFallbackRegistration[];
  /** Ordered, non-overlapping replacements addressing the original source text. */
  readonly replacements: readonly ReactContextHookFallbackReplacement[];
}

/** Direct and namespace imports proven to expose conventionally named Context hooks. */
export interface ContextHookImports {
  /** Local bindings for named, aliased, or default hook imports. */
  readonly direct: ReadonlySet<string>;
  /** Namespace bindings admitted only through a `use*Context` property. */
  readonly namespaces: ReadonlySet<string>;
}

/** One hook call and the nearest function whose lexical descendants may consume its result. */
export interface HookCandidate {
  /** Original imported-hook call expression replaced after successful inference. */
  readonly call: ts.CallExpression;
  /** Nearest runtime function that owns the hook call. */
  readonly owner: RuntimeFunction;
}

/** Mutable fallback evidence accumulated independently for one hook call. */
export interface HookFallbackPlan {
  /** Candidate whose result aliases are being followed. */
  readonly candidate: HookCandidate;
  /** Whether an unsupported or conflicting operation invalidated the entire candidate. */
  invalid: boolean;
  /** Optional-chain receivers that must remain absent for authored short-circuit semantics. */
  readonly optionalBasePaths: Map<string, readonly string[]>;
  /** Number of lexical function scopes traversed under the per-candidate bound. */
  scopeCount: number;
  /** Whether JavaScript proves a non-nullish root is required. */
  required: boolean;
  /** Exact scalar paths required to avoid an authored exhaustive throw. */
  readonly renderGuardPaths: Set<string>;
  /** Exact imported helper object-property contracts for inline collection callbacks. */
  readonly resolveImportedHelperProperty?: ResolvePreviewRuntimeHookImportedHelperPropertyFallback;
  /** Root plain-object shape serialized only after all evidence is collected. */
  readonly shape: FallbackShape;
  /** Unique materialized paths used to enforce the inference budget. */
  readonly shapePaths: Set<string>;
  /** Leaves printed only through untagged template strings, added after all other evidence. */
  readonly templateTextPaths: Map<string, readonly string[]>;
}

/** A context-derived local value represented by its property path from one hook result. */
export interface HookBoundValue {
  /** Possible static paths relative to the custom hook result after bounded value choices. */
  readonly paths: readonly (readonly string[])[];
}

/** Recursive neutral fallback node; callable and collection nodes cannot own child properties. */
export interface FallbackShape {
  /** Deterministically keyed object children, unused for callable/collection leaves. */
  readonly children: Map<string, FallbackShape>;
  /** Distinct authored membership operands retained as one exact frozen collection scenario. */
  collectionExactItemExpressions?: string[];
  /** Side-effect-free item expression proven by an imported collection callback contract. */
  collectionItemExpression?: string;
  /** Item-relative paths retained for runtime structural completion and diagnostics. */
  collectionItemRequiredPaths?: readonly string[];
  /** Plain object container, frozen no-op function, proven collection, or bounded scalar. */
  kind: 'callable' | 'collection' | 'object' | 'scalar';
  /** Closed scalar expression demanded by every call through this callable path. */
  callResultExpression?: string;
  /** JSON-safe semantic scalar used only after a bound leaf is read by project code. */
  scalarExpression?: string;
}

/** Runtime functions whose bodies can legally contain a React hook call. */
export type RuntimeFunction = ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression;

/** Shared immutable empty result returned for unsupported or irrelevant modules. */
export const EMPTY_TRANSFORM: ReactContextHookFallbackTransform = Object.freeze({
  declarations: Object.freeze([]),
  registrations: Object.freeze([]),
  replacements: Object.freeze([]),
});
