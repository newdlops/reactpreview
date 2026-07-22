/**
 * Parses Tailwind's static `@reference "...";` dependencies without executing CSS tooling.
 * References participate in the same safety preflight as imports because Tailwind recursively loads
 * them before compilation and can otherwise reach uninspected `@source`, `@plugin`, or `@config`
 * directives. Ambiguous reference syntax fails closed to the caller's authored-CSS fallback.
 */

/** One statically proven Tailwind reference and its exact authored source range. */
export interface PreviewCssReference {
  /** Offset immediately after the terminating semicolon. */
  readonly statementEnd: number;
  /** Offset of the `@` beginning this reference. */
  readonly statementStart: number;
  /** Escape-free relative or bare stylesheet request. */
  readonly specifier: string;
}

/** Complete static parse result; an unsafe reason prevents Tailwind adapter execution. */
export interface PreviewCssReferenceParseResult {
  readonly references: readonly PreviewCssReference[];
  readonly unsafeReason?: string;
}

/**
 * Finds reference rules outside comments and strings while rejecting dynamic or malformed forms.
 *
 * @param source CSS that may contain Tailwind reference directives.
 * @returns Safe static references or one bounded fail-closed reason.
 */
export function parsePreviewCssReferences(source: string): PreviewCssReferenceParseResult {
  const references: PreviewCssReference[] = [];
  let index = 0;
  while (index < source.length) {
    if (source.startsWith('/*', index)) {
      const commentEnd = source.indexOf('*/', index + 2);
      if (commentEnd < 0) return invalidReference(references, 'an unterminated CSS comment');
      index = commentEnd + 2;
      continue;
    }
    const character = source[index];
    if (character === '"' || character === "'") {
      const stringEnd = findCssStringEnd(source, index, character);
      if (stringEnd < 0) return invalidReference(references, 'an unterminated CSS string');
      index = stringEnd;
      continue;
    }
    if (!startsReferenceKeyword(source, index)) {
      index += 1;
      continue;
    }

    const match = readStaticReference(source, index);
    if (match === undefined) {
      return invalidReference(references, 'an unsupported or malformed @reference rule');
    }
    references.push(match);
    index = match.statementEnd;
  }
  return { references };
}

/** Reads the single quoted-path grammar supported by Tailwind's documented reference directive. */
function readStaticReference(source: string, startIndex: number): PreviewCssReference | undefined {
  let index = startIndex + '@reference'.length;
  if (!/[\t\n\f\r ]/u.test(source[index] ?? '')) return undefined;
  while (/[\t\n\f\r ]/u.test(source[index] ?? '')) index += 1;
  const quote = source[index];
  if (quote !== '"' && quote !== "'") return undefined;
  const stringEnd = findCssStringEnd(source, index, quote);
  if (stringEnd < 0) return undefined;
  const specifier = source.slice(index + 1, stringEnd - 1);
  if (specifier.length === 0 || /[\\\u0000\r\n]/u.test(specifier)) return undefined;
  index = stringEnd;
  while (/[\t\n\f\r ]/u.test(source[index] ?? '')) index += 1;
  if (source[index] !== ';') return undefined;
  return { specifier, statementEnd: index + 1, statementStart: startIndex };
}

/** Returns the offset after a closing quote, skipping escaped text only to report it as unsafe. */
function findCssStringEnd(source: string, startIndex: number, quote: string): number {
  for (let index = startIndex + 1; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1;
      continue;
    }
    if (source[index] === quote) return index + 1;
  }
  return -1;
}

/** Recognizes the exact at-rule keyword without accepting identifiers such as `@references`. */
function startsReferenceKeyword(source: string, index: number): boolean {
  if (source.slice(index, index + 10).toLowerCase() !== '@reference') return false;
  return !/[-_a-z\d]/iu.test(source[index + 10] ?? '');
}

/** Preserves already parsed evidence for diagnostics while requiring the caller to fail closed. */
function invalidReference(
  references: readonly PreviewCssReference[],
  reason: string,
): PreviewCssReferenceParseResult {
  return {
    references,
    unsafeReason: `Tailwind CSS reference preflight found ${reason}.`,
  };
}
