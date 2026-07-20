/**
 * Built-in Array prototype calls that prove their receiver must be a collection.
 *
 * Static analyzers and browser runtimes share this list so `items.filter()` cannot be interpreted as
 * an ordinary object containing a callback in one layer and as an array in another. Ambiguous API
 * verbs are deliberately absent: `router.push()` is substantially more common in page shells than
 * an untyped mutation of a hook-returned array, so `push()` alone must remain a callable object
 * property unless separate compiler evidence emits an array-item path.
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
