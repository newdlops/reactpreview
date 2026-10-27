/**
 * Rechecks CSS at literal dynamic-import call sites, including imports satisfied by the ESM cache.
 * Rewrites depend only on the original JavaScript, so CSS-only edits keep auxiliary bytes stable.
 * A versioned compiler chunk directory separates these bytes from the previous prefix-only format.
 */
import { ImportType, initSync, parse } from 'es-module-lexer';
import { PREVIEW_LAZY_STYLE_LOADER_SYMBOL } from './previewLazyStyleRuntimeSource';

/** esbuild rewrites all internal references when publishing the new stable wrapper format. */
export const PREVIEW_LAZY_STYLE_CHUNK_NAMES = 'chunks/styles-v2/[hash]';
const decoder = new TextDecoder();
const encoder = new TextEncoder();
const closingImportInsertion = encoder.encode(')');

/** One insertion around an unchanged native import expression, including its import options. */
interface ImportInsertion {
  /** UTF-16 position in the original esbuild JavaScript. */
  readonly offset: number;
  /** Encoded opening or closing wrapper, retained without a second full JavaScript string. */
  readonly bytes: Uint8Array;
}

/**
 * Wraps literal relative imports without interpreting application expressions or rewriting options.
 * Call-site globals may be shadowed; only intrinsic import.meta is referenced inside authored code.
 *
 * @param contents Valid esbuild ESM output before revision-specific loader prefixes are attached.
 * @param outputPath Validated artifact path used only for an actionable parse failure.
 * @returns Unchanged bytes when no relative import exists, otherwise stable wrapped ESM bytes.
 * @throws Error if import inspection or exact UTF-8 reconstruction fails.
 */
export function instrumentPreviewLazyStyleImports(
  contents: Uint8Array,
  outputPath: string,
): Uint8Array {
  const source = decoder.decode(contents);
  if (!source.includes('import')) return contents;
  initSync();
  let imports;
  try {
    [imports] = parse(source, outputPath);
  } catch {
    throw new Error(`Preview could not inspect lazy style import boundaries: ${outputPath}`);
  }
  const relativeImports = imports.filter(
    (record) =>
      record.t === ImportType.Dynamic &&
      record.n !== undefined &&
      /^(?:\.\/|\.\.\/)/u.test(record.n) &&
      record.se > record.ss,
  );
  if (relativeImports.length === 0) return contents;
  let property = '__reactPreviewStyledImport_v2';
  if (source.includes(property)) {
    // A long authored suffix must not trigger a full source scan for every underscore.
    const spellings = new Set(source.match(/__reactPreviewStyledImport_v2_*/gu));
    while (spellings.has(property)) property += '_';
  }
  const encodedProperty = JSON.stringify(property);
  const insertions: ImportInsertion[] = [];
  for (const record of relativeImports) {
    insertions.push(
      {
        offset: record.ss,
        bytes: encoder.encode(`import.meta[${encodedProperty}](${JSON.stringify(record.n)}, `),
      },
      { offset: record.se, bytes: closingImportInsertion },
    );
  }
  insertions.sort((left, right) => left.offset - right.offset);
  const prefix = encoder.encode(createImportMetaBoundary(encodedProperty));
  const result = new Uint8Array(
    Buffer.byteLength(source, 'utf8') +
      prefix.byteLength +
      insertions.reduce((total, insertion) => total + insertion.bytes.byteLength, 0),
  );
  result.set(prefix);
  let written = prefix.byteLength;
  let cursor = 0;
  /** Writes one untouched UTF-16 source span directly into its final UTF-8 buffer. */
  const appendSource = (end: number): void => {
    const span = source.slice(cursor, end);
    const encoded = encoder.encodeInto(span, result.subarray(written));
    if (encoded.read !== span.length)
      throw new Error(`Preview could not encode lazy imports: ${outputPath}`);
    written += encoded.written;
    cursor = end;
  };
  for (const insertion of insertions) {
    appendSource(insertion.offset);
    result.set(insertion.bytes, written);
    written += insertion.bytes.byteLength;
  }
  appendSource(source.length);
  if (written !== result.byteLength)
    throw new Error(`Preview lazy import byte count changed: ${outputPath}`);
  return result;
}

/**
 * Keeps an already mounted revision's imports on its committed loader during replacement prepare.
 * Once that loader retires, cached functions resolve through the current revision's registry.
 */
function createImportMetaBoundary(encodedProperty: string): string {
  const key = JSON.stringify(PREVIEW_LAZY_STYLE_LOADER_SYMBOL);
  return `
import.meta[${encodedProperty}] = ((owner) => (specifier, modulePromise) => {
  const current = globalThis[Symbol.for(${key})];
  const loader = owner?.phase === 'committed' && current?.phase === 'preparing' ? owner : current;
  return typeof loader?.import === 'function'
    ? loader.import(specifier, import.meta.url, modulePromise)
    : modulePromise;
})(globalThis[Symbol.for(${key})]);
`;
}
