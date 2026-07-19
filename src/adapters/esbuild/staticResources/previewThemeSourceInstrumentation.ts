/**
 * Composes the conservative styled-components source transforms behind one module boundary.
 * The source transformer should decide only whether a module reaches styled-components; this
 * adapter owns callable helper repair, non-callable token repair, and theme-candidate registration.
 */
import { createPreviewThemeRegistrationStatements } from '../previewThemeRegistration';
import { createPreviewThemeHelperTransform } from './previewThemeHelperInstrumentation';
import type { PreviewSourceReplacement } from './previewSourceReplacement';
import { createPreviewThemeValueTransform } from './previewThemeValueInstrumentation';

/** Generated imports and safe source edits contributed by all theme compatibility passes. */
export interface PreviewThemeSourceInstrumentation {
  /** Runtime resolver imports followed by target-reachable theme registration statements. */
  readonly imports: readonly string[];
  /** Complete non-overlapping helper and value expressions eligible for source rewriting. */
  readonly replacements: readonly PreviewSourceReplacement[];
}

/** Callback supplied by the parent transformer to avoid generated identifier collisions. */
export type PreviewThemeSourceBindingAllocator = (kind: string) => string;

/**
 * Runs both styled-template passes against the same authored source and returns one contribution.
 * Each child pass independently refuses malformed or ambiguous syntax, so combining their empty
 * results never broadens the set of project expressions modified by the preview compiler.
 */
export function createPreviewThemeSourceInstrumentation(
  sourcePath: string,
  sourceText: string,
  allocateBinding: PreviewThemeSourceBindingAllocator,
): PreviewThemeSourceInstrumentation {
  const helperTransform = createPreviewThemeHelperTransform(
    sourcePath,
    sourceText,
    allocateBinding,
  );
  const valueTransform = createPreviewThemeValueTransform(sourcePath, sourceText, allocateBinding);
  return {
    imports: [
      ...helperTransform.imports,
      ...valueTransform.imports,
      ...createPreviewThemeRegistrationStatements(sourcePath, sourceText, allocateBinding),
    ],
    replacements: [...helperTransform.replacements, ...valueTransform.replacements],
  };
}
