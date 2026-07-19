/**
 * Built-in Array prototype calls that prove their receiver must be a collection.
 *
 * Static analyzers and browser runtimes share this list so `items.filter()` cannot be interpreted as
 * an ordinary object containing a callback in one layer and as an array in another. The collection
 * fallback may remain immutable even for mutating method evidence; the method call is type evidence,
 * not permission for preview application code to mutate extension-owned fixture state.
 */
export const PREVIEW_COLLECTION_METHOD_NAMES = Object.freeze([
  'at',
  'concat',
  'copyWithin',
  'entries',
  'every',
  'fill',
  'filter',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'flat',
  'flatMap',
  'forEach',
  'includes',
  'indexOf',
  'join',
  'keys',
  'lastIndexOf',
  'map',
  'pop',
  'push',
  'reduce',
  'reduceRight',
  'reverse',
  'shift',
  'slice',
  'some',
  'sort',
  'splice',
  'toReversed',
  'toSorted',
  'toSpliced',
  'unshift',
  'values',
  'with',
] as const);

/** Compile-time union used by analyzers that retain the exact observed method name. */
export type PreviewCollectionMethodName = (typeof PREVIEW_COLLECTION_METHOD_NAMES)[number];
