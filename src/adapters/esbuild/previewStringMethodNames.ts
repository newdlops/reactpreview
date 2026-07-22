/**
 * Built-in String prototype calls that unambiguously prove their receiver is textual.
 *
 * Methods shared with Array, such as `includes`, `indexOf`, and `slice`, are deliberately absent.
 * A receiver observed only through one of those calls could validly be either kind, so converting it
 * would risk replacing usable authored data. Static prop inference and Page Inspector runtime repair
 * share this conservative list to keep their generated value decisions consistent.
 */
export const PREVIEW_STRING_ONLY_METHOD_NAMES = Object.freeze([
  'charAt',
  'charCodeAt',
  'codePointAt',
  'endsWith',
  'localeCompare',
  'match',
  'matchAll',
  'normalize',
  'padEnd',
  'padStart',
  'repeat',
  'replace',
  'replaceAll',
  'search',
  'split',
  'startsWith',
  'substr',
  'substring',
  'toLocaleLowerCase',
  'toLocaleUpperCase',
  'toLowerCase',
  'toUpperCase',
  'trim',
  'trimEnd',
  'trimLeft',
  'trimRight',
  'trimStart',
] as const);

/** Compile-time union retained by analyzers that need the exact observed String method name. */
export type PreviewStringOnlyMethodName = (typeof PREVIEW_STRING_ONLY_METHOD_NAMES)[number];
