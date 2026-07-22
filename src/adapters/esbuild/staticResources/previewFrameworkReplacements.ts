/**
 * Composes framework-compiler compatibility edits behind one source-transformer boundary.
 * Individual analyzers remain package-specific and fail closed; this façade keeps the central
 * transformer extensible without allowing framework details to cross into resource expansion.
 */
import { createEmotionTargetReplacements } from './previewEmotionStyledTargetInstrumentation';
import { createNextAppDocumentElementReplacements } from './previewNextAppDocumentElementIsolation';
import { createNextAppMetadataReplacements } from './previewNextAppMetadataIsolation';
import { createNextDynamicReplacements } from './previewNextDynamicInstrumentation';
import {
  applyPreviewSourceReplacements,
  type PreviewSourceReplacement,
} from './previewSourceReplacement';
import type { PreviewSourceTransformerOptions } from './previewSourceTransformerOptions';

/**
 * Applies framework-owned module-evaluation isolation before any nested resource analyzer runs.
 * This separate phase is intentionally limited to proven Next metadata: otherwise a smaller
 * `new URL`, dynamic import, or resource macro inside the initializer could win the normal overlap
 * policy and keep server-only metadata executable.
 *
 * @param sourcePath Workspace source identity used for strict App Router path evidence.
 * @param sourceText Original module contents whose source offsets must remain stable.
 * @param options Compiler-proven nearest-project Next runtime evidence.
 * @returns Source with only server-owned Next metadata initialization made inert.
 */
export function prepareFrameworkSource(
  sourcePath: string,
  sourceText: string,
  options: Pick<PreviewSourceTransformerOptions, 'projectUsesNextRuntime'> = {},
): string {
  return applyPreviewSourceReplacements(sourceText, [
    ...createNextAppMetadataReplacements(sourcePath, sourceText, options.projectUsesNextRuntime),
    ...createNextAppDocumentElementReplacements(
      sourcePath,
      sourceText,
      options.projectUsesNextRuntime,
    ),
  ]);
}

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
