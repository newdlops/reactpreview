/**
 * Applies offset-based source replacements shared by preview compatibility transforms.
 *
 * Replacement discovery remains in syntax-specific analyzers; this module owns only ordering,
 * overlap validation, and generated-import placement so the central source transformer stays below
 * the project file-size limit without duplicating text-edit semantics.
 */

/** Error surfaced as an esbuild diagnostic when a compatibility transform cannot remain bounded. */
export class PreviewSourceTransformError extends Error {
  /** Creates a source-specific compatibility failure without exposing parser implementation details. */
  public constructor(message: string) {
    super(message);
    this.name = 'PreviewSourceTransformError';
  }
}

/** One source replacement computed against the original, unmodified module text. */
export interface PreviewSourceReplacement {
  /** Exclusive source offset after the replaced expression. */
  readonly end: number;
  /** Generated expression with equivalent bounded runtime semantics. */
  readonly replacement: string;
  /** Inclusive source offset of the replaced expression. */
  readonly start: number;
}

/**
 * Applies non-overlapping source replacements from right to left to preserve original offsets.
 *
 * @param source Original module text used during every syntax analysis pass.
 * @param replacements Offset edits whose ranges address `source`.
 * @returns Rewritten source with every validated edit applied exactly once.
 */
export function applyPreviewSourceReplacements(
  source: string,
  replacements: readonly PreviewSourceReplacement[],
): string {
  let result = source;
  let lastStart = source.length;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    if (replacement.end > lastStart) {
      throw new PreviewSourceTransformError(
        'Overlapping static resource expressions are unsupported.',
      );
    }
    result = `${result.slice(0, replacement.start)}${replacement.replacement}${result.slice(replacement.end)}`;
    lastStart = replacement.start;
  }
  return result;
}

/**
 * Appends generated ESM imports after directives while relying on normal import hoisting semantics.
 *
 * @param source Rewritten project source whose original line prefix should remain stable.
 * @param imports Generated static imports and registration statements in deterministic order.
 * @returns Source with a single separator and trailing newline when generated code exists.
 */
export function appendPreviewSourceImports(source: string, imports: readonly string[]): string {
  if (imports.length === 0) {
    return source;
  }
  const separator = source.endsWith('\n') ? '' : '\n';
  return `${source}${separator}${imports.join('\n')}\n`;
}
