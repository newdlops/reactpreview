/** Reduces local artifact transfer and browser parsing without renaming React or recovery functions. */
import type { BuildOptions } from 'esbuild';

/**
 * Whitespace-only compaction preserves development branches, function/class names, JSX source
 * metadata, and module evaluation order. Syntax and identifier minification stay explicitly off
 * because the Inspector uses authored names and source-shaped runtime evidence for recovery.
 */
export const PREVIEW_BROWSER_OUTPUT_OPTIONS = Object.freeze({
  minifyIdentifiers: false,
  minifySyntax: false,
  minifyWhitespace: true,
} satisfies Pick<BuildOptions, 'minifyIdentifiers' | 'minifySyntax' | 'minifyWhitespace'>);
