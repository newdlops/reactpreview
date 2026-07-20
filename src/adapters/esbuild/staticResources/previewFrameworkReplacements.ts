/**
 * Composes framework-compiler compatibility edits behind one source-transformer boundary.
 * Individual analyzers remain package-specific and fail closed; this façade keeps the central
 * transformer extensible without allowing framework details to cross into resource expansion.
 */
import { createEmotionTargetReplacements } from './previewEmotionStyledTargetInstrumentation';
import { createNextDynamicReplacements } from './previewNextDynamicInstrumentation';
import type { PreviewSourceReplacement } from './previewSourceReplacement';

/** Returns all bounded framework compatibility edits computed against one original source. */
export function createFrameworkReplacements(
  sourcePath: string,
  sourceText: string,
): readonly PreviewSourceReplacement[] {
  return [
    ...createEmotionTargetReplacements(sourcePath, sourceText),
    ...createNextDynamicReplacements(sourcePath, sourceText),
  ];
}
