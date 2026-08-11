/**
 * Selects and applies condition-expression replacements produced by React preview analysis.
 *
 * Syntax candidates can overlap when a complete render decision contains another render-shaped
 * condition. Wrapping the original source range, instead of replacing it, lets those controls
 * compose while each authored expression is still evaluated exactly once.
 */

/** One replacement whose offsets address the original, unmodified module source. */
export interface PreviewReactConditionalReplacement {
  /** Exclusive source offset immediately after the authored condition. */
  readonly end: number;
  /** Generated source emitted immediately before the authored range. */
  readonly prefix: string;
  /** Inclusive source offset at the beginning of the authored condition. */
  readonly start: number;
  /** Generated source emitted immediately after the authored range. */
  readonly suffix: string;
}

/**
 * Applies balanced range wrappers without changing their original-source offsets.
 *
 * Ranges must be nested or disjoint; crossing ranges cannot be represented without changing source
 * semantics and therefore fail closed. At one boundary, closers precede openers, while wrappers
 * sharing a start/end are ordered outer-to-inner/inner-to-outer respectively.
 */
export function applyPreviewReactConditionalReplacements(
  sourceText: string,
  replacements: readonly PreviewReactConditionalReplacement[],
): string {
  const unique = [...new Map(
    replacements.map((replacement) => [
      `${replacement.start}:${replacement.end}:${replacement.prefix}:${replacement.suffix}`,
      replacement,
    ]),
  ).values()];
  const ordered = unique.sort(
    (left, right) => left.start - right.start || right.end - left.end || left.prefix.localeCompare(right.prefix),
  );
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (current.start < previous.end && current.end > previous.end) return sourceText;
  }
  const opens = new Map<number, PreviewReactConditionalReplacement[]>();
  const closes = new Map<number, PreviewReactConditionalReplacement[]>();
  for (const replacement of ordered) {
    if (replacement.start < 0 || replacement.end < replacement.start || replacement.end > sourceText.length) {
      return sourceText;
    }
    const opening = opens.get(replacement.start) ?? [];
    opening.push(replacement);
    opens.set(replacement.start, opening);
    const closing = closes.get(replacement.end) ?? [];
    closing.push(replacement);
    closes.set(replacement.end, closing);
  }
  const boundaries = [...new Set([...opens.keys(), ...closes.keys()])].sort((left, right) => left - right);
  let cursor = 0;
  let transformed = '';
  for (const boundary of boundaries) {
    transformed += sourceText.slice(cursor, boundary);
    transformed += (closes.get(boundary) ?? [])
      .sort((left, right) => right.start - left.start || left.suffix.localeCompare(right.suffix))
      .map((replacement) => replacement.suffix)
      .join('');
    transformed += (opens.get(boundary) ?? [])
      .sort((left, right) => right.end - left.end || left.prefix.localeCompare(right.prefix))
      .map((replacement) => replacement.prefix)
      .join('');
    cursor = boundary;
  }
  return transformed + sourceText.slice(cursor);
}
