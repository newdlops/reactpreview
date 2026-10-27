/** Bounded hook alias contracts, callback categories, and traversal limits. */
import ts from 'typescript';

export const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

export const MAXIMUM_ALIAS_COUNT = 32;

export const MAXIMUM_ALIAS_DEPTH = 8;

export const MAXIMUM_ALIAS_PASSES = 8;

export const MAXIMUM_CHOICE_PATHS = 4;

export const MAXIMUM_USAGE_PATHS = 64;

export const COLLECTION_IDENTITY_METHODS = new Set(['filter', 'slice', 'toReversed', 'toSorted']);

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

export const COLLECTION_UTILITY_CALLBACK_ARGUMENTS = new Map<string, readonly [number, number]>([
  ['countBy', [0, 1]],
  ['every', [0, 1]],
  ['filter', [0, 1]],
  ['find', [0, 1]],
  ['flatMap', [0, 1]],
  ['forEach', [0, 1]],
  ['groupBy', [0, 1]],
  ['keyBy', [0, 1]],
  ['map', [0, 1]],
  ['maxBy', [0, 1]],
  ['minBy', [0, 1]],
  ['some', [0, 1]],
  ['sortBy', [0, 1]],
  ['sumBy', [0, 1]],
  ['uniqBy', [0, 1]],
]);

export const COLLECTION_ONLY_USAGE_PROPERTIES = new Set([
  'every',
  'filter',
  'find',
  'findIndex',
  'flatMap',
  'forEach',
  'map',
  'reduce',
  'some',
]);

/** One downstream use already normalized for the hook fallback usage-tree serializer. */
export interface PreviewRuntimeHookAliasUsagePath {
  /** True when the reached terminal property is called as a function. */
  readonly called: boolean;
  /** Static return expression required by a destructuring consumer of the called property. */
  readonly callResultExpression?: string;
  /** Static expression inferred from fields read on the collection callback's first parameter. */
  readonly collectionItemExpression?: string;
  /** A synthetic display string is used as the callback's JSX key and needs distinct samples. */
  readonly collectionItemStringIdentity?: true;
  /** Callback-item paths propagated into the enclosing hook fallback requirement list. */
  readonly collectionItemRequiredPaths?: readonly string[];
  /** Array operation proving the receiver should be generated as a collection. */
  readonly collectionProperty?: string;
  /** Property path relative to the original hook-bound identifier. */
  readonly names: readonly string[];
  /** The compiler-proven scalar must replace an authored first-state value to pass a render guard. */
  readonly renderGuard?: true;
  /** Candidate scalar returned by a generated callable, selected later by the local learner. */
  readonly smartValueExpression?: string;
  /** Bounded semantic role used as a neural feature; it never selects the candidate by itself. */
  readonly smartValueRole?: 'collection-filter-predicate' | 'render-state';
  /** String-only method proving the preceding leaf should be generated as text. */
  readonly stringProperty?: string;
  /** Side-effect-free scalar expression proven by a reached child component's render contract. */
  readonly valueExpression?: string;
  /** Nested paths retained when `valueExpression` is a structured imported-helper contract. */
  readonly valueRequiredPaths?: readonly string[];
}

/** Item fallback supplied by the bounded imported-helper type resolver. */
export interface PreviewRuntimeHookImportedHelperItemFallback {
  readonly expression: string;
  /** Present only when local callback syntax proves a generated string is a JSX display key. */
  readonly generatedStringIdentity?: true;
  readonly kind?:
    | 'array'
    | 'boolean'
    | 'component'
    | 'element'
    | 'function'
    | 'graphql-document'
    | 'null'
    | 'number'
    | 'object'
    | 'string';
  /** Structured child usages retained when an imported object parameter has nested contracts. */
  readonly nestedUsages?: readonly PreviewRuntimeHookImportedHelperNestedUsage[];
  readonly requiredPaths?: readonly string[];
}

/** One helper-relative usage ready to be prefixed by the caller's hook alias path. */
export interface PreviewRuntimeHookImportedHelperNestedUsage {
  readonly called: boolean;
  readonly collectionItemExpression?: string;
  readonly collectionItemRequiredPaths?: readonly string[];
  readonly collectionProperty?: string;
  readonly names: readonly string[];
  readonly renderGuard?: true;
  readonly stringProperty?: string;
  readonly valueExpression?: string;
}

/** Resolves one exact direct-import call argument to an Array item contract. */
export type ResolvePreviewRuntimeHookImportedHelperItemFallback = (
  localName: string,
  parameterIndex: number,
) => PreviewRuntimeHookImportedHelperItemFallback | undefined;

/** Resolves the complete shape consumed by one exact direct-import helper parameter. */
export type ResolvePreviewRuntimeHookImportedHelperParameterFallback = (
  localName: string,
  parameterIndex: number,
) => PreviewRuntimeHookImportedHelperItemFallback | undefined;

/** Resolves one exact property of an object parameter accepted by a direct imported helper. */
export type ResolvePreviewRuntimeHookImportedHelperPropertyFallback = (
  localName: string,
  parameterIndex: number,
  propertyName: string,
) => PreviewRuntimeHookImportedHelperItemFallback | undefined;

/** One local alias may originate from a small logical or conditional choice. */
export type PreviewRuntimeHookAliasPathCatalog = ReadonlyMap<
  string,
  readonly (readonly string[])[]
>;

/** Exact React imports admitted for identity-only `useMemo` projections. */
export interface ReactMemoBindings {
  readonly direct: ReadonlySet<string>;
  readonly namespaces: ReadonlySet<string>;
}

/** Keeps only logical operators that select a value without executing application code. */
export function isValueChoiceOperator(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.BarBarToken || kind === ts.SyntaxKind.QuestionQuestionToken;
}

/** Bounds and de-duplicates alternate hook-relative origins in stable source order. */
export function deduplicatePaths(
  paths: readonly (readonly string[])[],
): readonly (readonly string[])[] {
  const retained = new Map<string, readonly string[]>();
  for (const path of paths) {
    if (path.length > MAXIMUM_ALIAS_DEPTH) continue;
    const key = path.join('.');
    if (!retained.has(key)) retained.set(key, Object.freeze([...path]));
    if (retained.size >= MAXIMUM_CHOICE_PATHS) break;
  }
  return Object.freeze([...retained.values()]);
}
