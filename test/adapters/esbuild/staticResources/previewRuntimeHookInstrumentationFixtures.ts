/** Shared deterministic fixtures for previewRuntimeHookInstrumentation regression scenarios. */
import { createPreviewRuntimeHookReplacements } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookInstrumentation';

/** Applies test replacements with the same right-to-left offset policy as the source transformer. */
export function applyHookReplacements(
  source: string,
  replacements: ReturnType<typeof createPreviewRuntimeHookReplacements>,
): string {
  let transformed = source;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    transformed = `${transformed.slice(0, replacement.start)}${replacement.replacement}${transformed.slice(replacement.end)}`;
  }
  return transformed;
}
