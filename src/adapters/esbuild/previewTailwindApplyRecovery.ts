/**
 * Keeps one unknown `@apply` class from discarding a whole stylesheet.
 *
 * Tailwind aborts the entire file when `@apply` names a class it cannot generate, for example a
 * utility from a plugin the preview never executes or a theme value the static configuration
 * reader could not evaluate. The stylesheet then reached the page uncompiled and every utility on
 * the page was missing. This helper removes only the reported class from `@apply` lists and
 * compiles again, a bounded number of times, so the rest of the stylesheet still applies.
 */

const MAX_REMOVED_CLASSES = 16;
const UNKNOWN_CLASS_PATTERNS = [
  /The `([^`]+)` class does not exist/u,
  /`([^`]+)` class does not exist/u,
  /Cannot apply unknown utility class `([^`]+)`/u,
];
const APPLY_DIRECTIVE_PATTERN = /@apply\s+([^;{}]+?)(\s*!important)?\s*(;|(?=\}))/gu;

/** Compiled output plus the classes removed to reach it. */
export interface PreviewTailwindApplyRecoveryResult<T> {
  readonly removedClasses: readonly string[];
  readonly result: T;
}

/**
 * Runs one Tailwind compilation, removing unknown `@apply` classes until it succeeds.
 *
 * @param source Stylesheet source passed to Tailwind.
 * @param process Runs one compilation of the given source.
 * @returns First successful result and every class removed on the way.
 * @throws The original error when it is not an unknown-class failure or the bound is reached.
 */
export async function processPreviewTailwindWithApplyRecovery<T>(
  source: string,
  process: (source: string) => Promise<T>,
): Promise<PreviewTailwindApplyRecoveryResult<T>> {
  const removedClasses: string[] = [];
  let current = source;
  for (;;) {
    try {
      return { removedClasses, result: await process(current) };
    } catch (error) {
      const className = readUnknownApplyClass(error);
      const next =
        className === undefined || removedClasses.length >= MAX_REMOVED_CLASSES
          ? current
          : removePreviewTailwindApplyClass(current, className);
      if (className === undefined || next === current) throw error;
      removedClasses.push(className);
      current = next;
    }
  }
}

/**
 * Removes one class from every `@apply` list; an emptied directive disappears entirely.
 *
 * @param source Stylesheet source.
 * @param className Exact class token reported by Tailwind.
 * @returns Source without that token in `@apply` lists.
 */
export function removePreviewTailwindApplyClass(source: string, className: string): string {
  return source.replace(
    APPLY_DIRECTIVE_PATTERN,
    (_directive, classes: string, important: string | undefined, terminator: string) => {
      const kept = classes.split(/\s+/u).filter((token) => token.length > 0 && token !== className);
      return kept.length === 0 ? '' : `@apply ${kept.join(' ')}${important ?? ''}${terminator}`;
    },
  );
}

/** Reads the class name from Tailwind v2, v3, and v4 unknown-class errors. */
function readUnknownApplyClass(error: unknown): string | undefined {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
  if (message === undefined) return undefined;
  for (const pattern of UNKNOWN_CLASS_PATTERNS) {
    const className = pattern.exec(message)?.[1];
    if (className !== undefined && className.length > 0) return className;
  }
  return undefined;
}
