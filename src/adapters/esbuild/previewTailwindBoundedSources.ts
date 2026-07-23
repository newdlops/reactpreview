/**
 * Narrows Tailwind v4 source discovery to source text already admitted by React Preview.
 * The transform changes only Tailwind's candidate-discovery directives: authored imports, theme
 * declarations, layers, CSS variables, selectors, and declarations remain byte-for-byte intact.
 */
import { parsePreviewCssImports } from './previewCssImportParser';

/** Result of replacing package-wide discovery with bounded in-memory candidate input. */
export interface PreviewTailwindBoundedSourceResult {
  /** Whether at least one discovery directive was safely narrowed. */
  readonly changed: boolean;
  /** CSS retaining authored visual rules while disabling filesystem candidate enumeration. */
  readonly source: string;
}

/**
 * Adds `source(none)` to Tailwind root imports and removes quoted filesystem `@source` rules.
 * Exact parser ranges prevent import-like text in comments and strings from being rewritten. The
 * removed statements are replaced with spaces, preserving newlines and source locations used by
 * esbuild diagnostics. Existing inline sources remain active because they contain already bounded
 * literal candidates rather than a filesystem glob.
 *
 * @param source Authored Tailwind entry CSS.
 * @returns Rewritten CSS and whether source-discovery behavior changed.
 */
export function boundPreviewTailwindSourceDiscovery(
  source: string,
): PreviewTailwindBoundedSourceResult {
  const parsedImports = parsePreviewCssImports(source);
  if (parsedImports.unsafeReason !== undefined) return { changed: false, source };

  let output = source;
  let changed = false;
  const replacements: {
    readonly end: number;
    readonly start: number;
    readonly text: string;
  }[] = [];
  for (const cssImport of parsedImports.imports) {
    if (cssImport.specifier !== 'tailwindcss' && !cssImport.specifier.startsWith('tailwindcss/')) {
      continue;
    }
    if (/\bsource\s*\(\s*none\s*\)/iu.test(cssImport.modifiers)) continue;
    const modifiersWithoutSource = cssImport.modifiers.replace(
      /\bsource\s*\(\s*(?:["'][^"']*["']|[^)]*)\s*\)/giu,
      '',
    );
    replacements.push({
      end: cssImport.statementEnd,
      start: cssImport.statementStart,
      text: `@import ${JSON.stringify(cssImport.specifier)} source(none)${
        modifiersWithoutSource.trim().length === 0 ? '' : ` ${modifiersWithoutSource.trim()}`
      };`,
    });
  }
  for (const replacement of replacements.reverse()) {
    output = output.slice(0, replacement.start) + replacement.text + output.slice(replacement.end);
    changed = true;
  }

  const explicitSources = removeExplicitFilesystemSources(output);
  output = explicitSources.source;
  changed ||= explicitSources.changed;
  return { changed, source: output };
}

/** Removes only real quoted `@source` statements outside CSS comments and string values. */
function removeExplicitFilesystemSources(source: string): PreviewTailwindBoundedSourceResult {
  const ranges: { readonly end: number; readonly start: number }[] = [];
  let index = 0;
  while (index < source.length) {
    if (source.startsWith('/*', index)) {
      const commentEnd = source.indexOf('*/', index + 2);
      if (commentEnd < 0) break;
      index = commentEnd + 2;
      continue;
    }
    const character = source[index];
    if (character === '"' || character === "'") {
      index = findCssStringEnd(source, index, character);
      continue;
    }
    if (!startsSourceKeyword(source, index)) {
      index += 1;
      continue;
    }
    let cursor = index + '@source'.length;
    while (/\s/u.test(source[cursor] ?? '')) cursor += 1;
    if (source.slice(cursor, cursor + 'inline'.length).toLowerCase() === 'inline') {
      index = cursor + 'inline'.length;
      continue;
    }
    const quote = source[cursor];
    if (quote !== '"' && quote !== "'") {
      index = cursor + 1;
      continue;
    }
    const stringEnd = findCssStringEnd(source, cursor, quote);
    if (stringEnd <= cursor) break;
    cursor = stringEnd;
    while (/\s/u.test(source[cursor] ?? '')) cursor += 1;
    if (source[cursor] !== ';') {
      index = cursor;
      continue;
    }
    ranges.push({ end: cursor + 1, start: index });
    index = cursor + 1;
  }
  let output = source;
  for (const range of ranges.reverse()) {
    const statement = output.slice(range.start, range.end);
    output =
      output.slice(0, range.start) +
      statement.replaceAll(/[^\r\n]/gu, ' ') +
      output.slice(range.end);
  }
  return { changed: ranges.length > 0, source: output };
}

/** Returns the character after a CSS string, or the source length for malformed input. */
function findCssStringEnd(source: string, start: number, quote: string): number {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1;
      continue;
    }
    if (source[index] === quote) return index + 1;
  }
  return source.length;
}

/** Recognizes the complete `@source` identifier without matching longer custom at-rules. */
function startsSourceKeyword(source: string, index: number): boolean {
  if (source.slice(index, index + '@source'.length).toLowerCase() !== '@source') return false;
  return !/[-_a-z\d]/iu.test(source[index + '@source'.length] ?? '');
}
