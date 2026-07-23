/**
 * Selects dependency sources that still need the exact compatibility pipeline during provisional
 * first paint. Ordinary TSX can remain on esbuild's native parser, while project runtime boundaries
 * and non-native resource expressions must keep their preview instrumentation before full context
 * enrichment replaces the artifact.
 */

/** Runtime/provider syntax whose omission can prevent the provisional component tree from mounting. */
const RUNTIME_BOUNDARY_TOKENS = [
  'createContext',
  'formik',
  'gql',
  'react-redux',
  'react-router',
  'styled-components',
  'useContext',
] as const;

/**
 * Returns whether one reached dependency needs preview-specific source rewriting in a fast build.
 * The check intentionally uses bounded lexical evidence; false positives cost one exact transform,
 * whereas a false negative could omit a provider, data fallback, or finite resource expansion.
 */
export function requiresFastDependencyCompatibility(
  sourceText: string,
  projectUsesNextRuntime: boolean | undefined,
): boolean {
  if (
    sourceText.includes('import.meta.glob') ||
    sourceText.includes('require.context') ||
    (sourceText.includes('new URL') && sourceText.includes('import.meta.url')) ||
    /\bimport\s*\(\s*(?!["'])/u.test(sourceText) ||
    /\brequire\s*\(\s*(?!["'])/u.test(sourceText)
  ) {
    return true;
  }
  if (
    sourceText.includes('@emotion/styled') ||
    sourceText.includes('next/dynamic') ||
    sourceText.includes('next/font') ||
    /\buse[A-Z_$][\w$]*Context\b/u.test(sourceText) ||
    RUNTIME_BOUNDARY_TOKENS.some((token) => sourceText.includes(token))
  ) {
    return true;
  }
  return (
    projectUsesNextRuntime === true &&
    (sourceText.includes('generateMetadata') ||
      sourceText.includes('generateViewport') ||
      sourceText.includes('export const metadata') ||
      sourceText.includes('export const viewport'))
  );
}
