/**
 * Normalizes a narrow Tailwind fail-soft prelude for esbuild's ordinary CSS loader.
 *
 * Tailwind accepts `@reference` before `@import`, while the CSS grammar requires imports to precede
 * every rule other than `@charset` and layer declarations. When Tailwind compilation fails, passing
 * that authored order to esbuild creates one warning per import and drops useful fallback styles.
 * This module moves only a leading run of static `@reference "...";` rules behind the immediately
 * following import run. It leaves non-prelude CSS and comments byte-for-byte intact, while blanking
 * the original reference ranges so line numbers before the reinsertion point remain stable.
 */
import { parsePreviewCssImports } from './previewCssImportParser';

/** Exact, escape-free reference form that can be moved without interpreting project expressions. */
const STATIC_REFERENCE_PATTERN = /@reference[\t\n\r ]+(?:"[^"\\\r\n]+"|'[^'\\\r\n]+')[\t\n\r ]*;/iy;

/** Source range occupied by one safe leading Tailwind reference rule. */
interface PreviewCssReferenceRange {
  readonly end: number;
  readonly start: number;
}

/**
 * Moves only static leading references behind a contiguous top-level import prelude.
 *
 * @param source Authored CSS returned after an optional Tailwind adapter failure.
 * @returns CSS accepted by esbuild without changing the order of imports or reference rules.
 */
export function normalizePreviewCssFailSoftPrelude(source: string): string {
  const parsedImports = parsePreviewCssImports(source);
  if (parsedImports.unsafeReason !== undefined || parsedImports.imports.length === 0) return source;

  const referenceRanges: PreviewCssReferenceRange[] = [];
  let cursor = skipCssTrivia(source, 0);
  for (;;) {
    STATIC_REFERENCE_PATTERN.lastIndex = cursor;
    const match = STATIC_REFERENCE_PATTERN.exec(source);
    if (match === null) break;
    referenceRanges.push({ end: STATIC_REFERENCE_PATTERN.lastIndex, start: cursor });
    cursor = skipCssTrivia(source, STATIC_REFERENCE_PATTERN.lastIndex);
  }
  if (referenceRanges.length === 0) return source;

  let importCursor = cursor;
  let lastImportEnd: number | undefined;
  for (const cssImport of parsedImports.imports) {
    if (cssImport.statementStart < cursor) continue;
    if (skipCssTrivia(source, importCursor) !== cssImport.statementStart) break;
    lastImportEnd = cssImport.statementEnd;
    importCursor = cssImport.statementEnd;
  }
  if (lastImportEnd === undefined) return source;

  const referenceRules = referenceRanges
    .map((range) => source.slice(range.start, range.end))
    .join('\n');
  let output = source;
  for (const range of [...referenceRanges].reverse()) {
    output =
      output.slice(0, range.start) +
      preserveLineBreaksAsWhitespace(source.slice(range.start, range.end)) +
      output.slice(range.end);
  }
  return `${output.slice(0, lastImportEnd)}\n${referenceRules}\n${output.slice(lastImportEnd)}`;
}

/** Skips only CSS whitespace and complete comments; any authored rule stops prelude recognition. */
function skipCssTrivia(source: string, start: number): number {
  let cursor = start;
  for (;;) {
    while (/[\t\n\f\r ]/u.test(source[cursor] ?? '')) cursor += 1;
    if (!source.startsWith('/*', cursor)) return cursor;
    const commentEnd = source.indexOf('*/', cursor + 2);
    if (commentEnd < 0) return cursor;
    cursor = commentEnd + 2;
  }
}

/** Blanks a moved rule while retaining the original prelude's newline count. */
function preserveLineBreaksAsWhitespace(value: string): string {
  return value.replaceAll(/[^\r\n]/gu, ' ');
}
