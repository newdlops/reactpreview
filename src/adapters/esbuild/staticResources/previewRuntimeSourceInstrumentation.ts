/**
 * Composes render-only source instrumentation in one deterministic order.
 *
 * Deferred event handlers are discovered against authored offsets before conditional JSX expands
 * expressions, and React effects are isolated last so earlier replacements keep their callback
 * boundaries.
 * Keeping that ordering outside the central resource transformer also gives each instrumentation
 * adapter a clear input/output boundary and keeps the compilation coordinator below 1,000 lines.
 */
import { instrumentPreviewDeferredUiTriggers } from './previewDeferredUiTriggerInstrumentation';
import { instrumentPreviewReactEffects } from './previewReactEffectInstrumentation';
import { isolatePreviewAsyncReactComponents } from './previewAsyncReactComponentIsolation';
import {
  applyPreviewSourceReplacements,
  selectCompatiblePreviewSourceReplacements,
} from './previewSourceReplacement';
import { instrumentReactConditionalRendering } from './reactConditionalRendering';

/** Feature switches inherited from the enclosing preview compilation request. */
export interface PreviewRuntimeSourceInstrumentationOptions {
  /** Wraps React effects with the render-only side-effect boundary. */
  readonly isolateEffects: boolean;
  /** Enables JSX branches, deferred UI discovery, and async client-component isolation. */
  readonly renderConditions: boolean;
}

/** Fully rewritten source plus inert module-scope registrations to append after it. */
export interface PreviewRuntimeSourceInstrumentationResult {
  /** Metadata-only statements that never invoke project handlers. */
  readonly registrations: readonly string[];
  /** Source after condition, deferred-trigger, and effect transforms. */
  readonly source: string;
}

/** Applies cooperating runtime transforms without allowing authored-offset analyses to drift. */
export function instrumentPreviewRuntimeSource(
  sourcePath: string,
  sourceText: string,
  options: PreviewRuntimeSourceInstrumentationOptions,
): PreviewRuntimeSourceInstrumentationResult {
  const deferred = options.renderConditions
    ? instrumentPreviewDeferredUiTriggers(sourcePath, sourceText)
    : { registrations: [], replacements: [] };
  const deferredSource = applyPreviewSourceReplacements(
    sourceText,
    selectCompatiblePreviewSourceReplacements(deferred.replacements),
  );
  const conditionSource = options.renderConditions
    ? instrumentReactConditionalRendering(sourcePath, deferredSource)
    : deferredSource;
  const effectSource = options.isolateEffects
    ? instrumentPreviewReactEffects(sourcePath, conditionSource)
    : conditionSource;
  return {
    registrations: deferred.registrations,
    source: options.renderConditions
      ? isolatePreviewAsyncReactComponents(sourcePath, effectSource)
      : effectSource,
  };
}
