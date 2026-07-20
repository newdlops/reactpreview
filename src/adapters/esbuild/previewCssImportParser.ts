/**
 * Parses CSS `@import` rules for Tailwind's non-executing safety preflight. The parser deliberately
 * accepts only the static string and `url(...)` forms React Preview can inspect on disk. Ambiguous
 * or malformed imports fail closed instead of being handed to a project-owned PostCSS adapter.
 */

/** One statically inspectable CSS import and the optional layer/supports/media suffix after it. */
export interface PreviewCssImport {
  /** Unescaped local or bare package request. */
  readonly specifier: string;
  /** Authored tokens following the request, such as Tailwind's `source(...)` modifier. */
  readonly modifiers: string;
}

/** Complete parse result; `unsafeReason` means no adapter may process this stylesheet. */
export interface PreviewCssImportParseResult {
  /** Imports found outside comments and strings, in source order. */
  readonly imports: readonly PreviewCssImport[];
  /** Bounded explanation for an import that cannot be inspected with certainty. */
  readonly unsafeReason?: string;
}

/**
 * Collects static CSS imports while ignoring import-like text inside comments and strings.
 *
 * A small scanner is used instead of a permissive regular expression so unquoted
 * `@import url(./nested.css)` rules cannot bypass recursive directive inspection. CSS escapes are
 * rejected because decoding their complete grammar incorrectly would be less safe than retaining
 * the authored stylesheet through the caller's fail-soft path.
 */
export function parsePreviewCssImports(source: string): PreviewCssImportParseResult {
  const imports: PreviewCssImport[] = [];
  let index = 0;
  while (index < source.length) {
    if (source.startsWith('/*', index)) {
      const commentEnd = source.indexOf('*/', index + 2);
      if (commentEnd < 0) return invalidImport(imports, 'an unterminated CSS comment');
      index = commentEnd + 2;
      continue;
    }
    const character = source[index];
    if (character === '"' || character === "'") {
      const stringEnd = findCssStringEnd(source, index, character);
      if (stringEnd < 0) return invalidImport(imports, 'an unterminated CSS string');
      index = stringEnd;
      continue;
    }
    if (!startsImportKeyword(source, index)) {
      index += 1;
      continue;
    }

    const statement = readImportStatement(source, index + '@import'.length);
    if (statement.unsafeReason !== undefined) return invalidImport(imports, statement.unsafeReason);
    const parsed = parseImportBody(statement.body ?? '');
    if (parsed.unsafeReason !== undefined) return invalidImport(imports, parsed.unsafeReason);
    if (parsed.import !== undefined) imports.push(parsed.import);
    index = statement.nextIndex ?? source.length;
  }
  return { imports };
}

/** Reads through the top-level semicolon without mistaking parentheses, strings, or comments. */
function readImportStatement(
  source: string,
  bodyStart: number,
): { readonly body?: string; readonly nextIndex?: number; readonly unsafeReason?: string } {
  let index = bodyStart;
  let parenthesisDepth = 0;
  while (index < source.length) {
    if (source.startsWith('/*', index)) {
      const commentEnd = source.indexOf('*/', index + 2);
      if (commentEnd < 0) return { unsafeReason: 'an unterminated comment in @import' };
      index = commentEnd + 2;
      continue;
    }
    const character = source[index];
    if (character === '"' || character === "'") {
      const stringEnd = findCssStringEnd(source, index, character);
      if (stringEnd < 0) return { unsafeReason: 'an unterminated string in @import' };
      index = stringEnd;
      continue;
    }
    if (character === '(') parenthesisDepth += 1;
    if (character === ')') {
      parenthesisDepth -= 1;
      if (parenthesisDepth < 0) return { unsafeReason: 'an unmatched parenthesis in @import' };
    }
    if (character === ';' && parenthesisDepth === 0) {
      return { body: source.slice(bodyStart, index), nextIndex: index + 1 };
    }
    index += 1;
  }
  return { unsafeReason: 'an unterminated @import rule' };
}

/** Parses one import request and leaves its optional modifiers untouched for policy validation. */
function parseImportBody(body: string): {
  readonly import?: PreviewCssImport;
  readonly unsafeReason?: string;
} {
  const value = body.trimStart();
  if (value.length === 0) return { unsafeReason: 'an empty @import rule' };
  const first = value[0];
  if (first === '"' || first === "'") {
    const request = readStaticString(value, 0, first);
    if (request.unsafeReason !== undefined) return request;
    return {
      import: {
        modifiers: value.slice(request.nextIndex ?? value.length).trim(),
        specifier: request.value ?? '',
      },
    };
  }
  if (!/^url\(/iu.test(value)) return { unsafeReason: 'an unsupported @import request' };
  let index = value.indexOf('(') + 1;
  while (/\s/u.test(value[index] ?? '')) index += 1;
  const quote = value[index];
  let specifier: string;
  if (quote === '"' || quote === "'") {
    const request = readStaticString(value, index, quote);
    if (request.unsafeReason !== undefined) return request;
    specifier = request.value ?? '';
    index = request.nextIndex ?? value.length;
    while (/\s/u.test(value[index] ?? '')) index += 1;
  } else {
    const closeIndex = value.indexOf(')', index);
    if (closeIndex < 0) return { unsafeReason: 'an unterminated url() in @import' };
    specifier = value.slice(index, closeIndex).trim();
    if (/['"()\\\u0000-\u0020\u007f]/u.test(specifier)) {
      return { unsafeReason: 'an ambiguous unquoted url() in @import' };
    }
    index = closeIndex;
  }
  if (value[index] !== ')') return { unsafeReason: 'an unterminated url() in @import' };
  return {
    import: { modifiers: value.slice(index + 1).trim(), specifier },
  };
}

/** Reads a request string while refusing CSS escapes that could conceal a different path. */
function readStaticString(
  source: string,
  startIndex: number,
  quote: string,
): { readonly value?: string; readonly nextIndex?: number; readonly unsafeReason?: string } {
  const endIndex = findCssStringEnd(source, startIndex, quote);
  if (endIndex < 0) return { unsafeReason: 'an unterminated string in @import' };
  const value = source.slice(startIndex + 1, endIndex - 1);
  if (value.length === 0 || /[\\\u0000\r\n]/u.test(value)) {
    return { unsafeReason: 'an empty or escaped path in @import' };
  }
  return { nextIndex: endIndex, value };
}

/** Returns the position after a closing quote, or `-1` for an incomplete string. */
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

/** Recognizes the exact at-rule keyword without accepting identifiers such as `@important`. */
function startsImportKeyword(source: string, index: number): boolean {
  if (source.slice(index, index + 7).toLowerCase() !== '@import') return false;
  return !/[-_a-z\d]/iu.test(source[index + 7] ?? '');
}

/** Preserves already parsed evidence only for diagnostics; callers must reject the entire graph. */
function invalidImport(
  imports: readonly PreviewCssImport[],
  reason: string,
): PreviewCssImportParseResult {
  return { imports, unsafeReason: `Tailwind CSS import preflight found ${reason}.` };
}
