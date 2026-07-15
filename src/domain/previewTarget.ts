/**
 * Contains the pure filename rules that decide whether an editor can become a React preview.
 * Keeping this decision outside VS Code adapters makes supported source kinds easy to extend and
 * test without starting an extension host.
 */
import type { PreviewSourceLanguage } from './preview';

const SOURCE_LANGUAGE_BY_EXTENSION = {
  '.js': 'jsx',
  '.jsx': 'jsx',
  '.ts': 'ts',
  '.tsx': 'tsx',
} as const satisfies Readonly<Record<string, PreviewSourceLanguage>>;

/**
 * Resolves the esbuild source language for a candidate React module path.
 * Matching is case-insensitive and intentionally limited to the MVP's four documented formats.
 *
 * @param documentPath Candidate absolute or relative document path.
 * @returns A supported source language, or `undefined` when the extension is unsupported.
 */
export function getPreviewSourceLanguage(documentPath: string): PreviewSourceLanguage | undefined {
  const normalizedPath = documentPath.toLowerCase();
  const matchingEntry = Object.entries(SOURCE_LANGUAGE_BY_EXTENSION).find(([extension]) =>
    normalizedPath.endsWith(extension),
  );

  return matchingEntry?.[1];
}

/**
 * Reports whether a path has one of the supported JavaScript or TypeScript extensions.
 *
 * @param documentPath Candidate document path.
 * @returns `true` when the document can be passed to the preview compiler.
 */
export function isPreviewSourcePath(documentPath: string): boolean {
  return getPreviewSourceLanguage(documentPath) !== undefined;
}
