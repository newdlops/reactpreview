/**
 * Selects and applies condition-expression replacements produced by React preview analysis.
 *
 * Syntax candidates can overlap when a complete render decision contains another render-shaped
 * condition. The complete outer expression is the identity recorded by static render outcomes, so
 * replacement selection deliberately keeps that source-wide decision and discards its nested
 * controls. Keeping this policy outside the analyzer prevents the already-large collector module
 * from crossing the project's one-thousand-line file limit.
 */

/** One replacement whose offsets address the original, unmodified module source. */
export interface PreviewReactConditionalReplacement {
  /** Exclusive source offset immediately after the authored condition. */
  readonly end: number;
  /** Generated resolver call that replaces the authored condition. */
  readonly replacement: string;
  /** Inclusive source offset at the beginning of the authored condition. */
  readonly start: number;
}

/**
 * Removes overlapping candidates while retaining the widest authored decision at each position.
 *
 * TypeScript expression ranges are nested or disjoint. Sorting by descending width therefore makes
 * the static outcome's outer condition win without changing the source order of independent gates.
 */
export function selectOutermostPreviewReactConditionalReplacements(
  replacements: readonly PreviewReactConditionalReplacement[],
): readonly PreviewReactConditionalReplacement[] {
  const selected: PreviewReactConditionalReplacement[] = [];
  const widestFirst = [...replacements].sort(
    (left, right) => right.end - right.start - (left.end - left.start) || left.start - right.start,
  );
  for (const replacement of widestFirst) {
    const overlapsSelected = selected.some(
      (current) => replacement.start < current.end && replacement.end > current.start,
    );
    if (!overlapsSelected) selected.push(replacement);
  }
  return selected.sort((left, right) => left.start - right.start);
}

/** Applies original-source replacements right-to-left so parser offsets remain stable. */
export function applyPreviewReactConditionalReplacements(
  sourceText: string,
  replacements: readonly PreviewReactConditionalReplacement[],
): string {
  let transformed = sourceText;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    transformed =
      transformed.slice(0, replacement.start) +
      replacement.replacement +
      transformed.slice(replacement.end);
  }
  return transformed;
}
