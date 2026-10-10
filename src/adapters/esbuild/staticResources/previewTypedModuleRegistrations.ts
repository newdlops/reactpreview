/**
 * Collects every declared-response registration one module appends in Page Inspector builds:
 * typed GraphQL documents and typed REST calls. The transformer appends them both to fully
 * instrumented modules and to dependencies that otherwise pass through unchanged.
 */
import type { PreviewTypeOracleView } from '../typeOracle/previewTypeOracle';
import { createPreviewTypedDocumentRegistrations } from './previewTypedDocumentRegistrations';
import { createPreviewTypedRestEndpointRegistrations } from './previewTypedRestEndpointRegistrations';

/**
 * Creates the module-end statements that register declared response shapes.
 *
 * @param oracle Build-scoped declared-type oracle, absent outside Page Inspector builds.
 * @param sourcePath Absolute module path.
 * @param sourceText Transform input text.
 * @returns Guarded statements; empty when the module declares nothing typed.
 */
export function createPreviewTypedModuleRegistrations(
  oracle: PreviewTypeOracleView | undefined,
  sourcePath: string,
  sourceText: string,
): readonly string[] {
  if (oracle === undefined) return [];
  return [
    ...createPreviewTypedDocumentRegistrations(oracle, sourcePath),
    ...createPreviewTypedRestEndpointRegistrations(oracle, sourcePath, sourceText),
  ];
}
