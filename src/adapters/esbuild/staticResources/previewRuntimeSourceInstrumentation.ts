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
import ts from 'typescript';
import {
  applyPreviewSourceReplacements,
  selectCompatiblePreviewSourceReplacements,
} from './previewSourceReplacement';
import { instrumentReactConditionalRendering } from './reactConditionalRendering';

/** Feature switches inherited from the enclosing preview compilation request. */
export interface PreviewRuntimeSourceInstrumentationOptions {
  /** Wraps React effects with the render-only side-effect boundary. */
  readonly isolateEffects: boolean;
  /** Emits metadata for every condition in the selected editor file before branch execution. */
  readonly registerConditionDefinitions?: boolean;
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

/**
 * Reports whether a source module might require one of the Page Inspector runtime rewrites.
 *
 * A source passes only when the existing deferred-trigger, conditional-render, effect, and async
 * stages all prove to be no-ops. Unsupported grammar, parser recovery, or an inconclusive stage
 * fails closed so native esbuild parsing cannot omit Inspector behavior.
 */
export function mayRequirePreviewRuntimeSourceInstrumentation(
  sourcePath: string,
  sourceText: string,
): boolean {
  const scriptKind = selectRuntimeInstrumentationScriptKind(sourcePath);
  if (scriptKind === undefined) return true;
  try {
    const sourceFile = ts.createSourceFile(
      sourcePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      scriptKind,
    );
    const parseDiagnostics = (
      sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
    ).parseDiagnostics;
    if ((parseDiagnostics?.length ?? 0) > 0) return true;

    const deferred = instrumentPreviewDeferredUiTriggers(sourcePath, sourceText);
    if (deferred.registrations.length > 0 || deferred.replacements.length > 0) return true;
    const deferredSource = applyPreviewSourceReplacements(
      sourceText,
      selectCompatiblePreviewSourceReplacements(deferred.replacements),
    );
    const conditionSource = instrumentReactConditionalRendering(sourcePath, deferredSource);
    if (conditionSource !== deferredSource) return true;
    const effectSource = instrumentPreviewReactEffects(sourcePath, conditionSource);
    if (effectSource !== conditionSource) return true;
    return isolatePreviewAsyncReactComponents(sourcePath, effectSource) !== effectSource;
  } catch {
    return true;
  }
}

/** Aligns the conservative probe with the source grammars accepted by runtime instrumentation. */
function selectRuntimeInstrumentationScriptKind(sourcePath: string): ts.ScriptKind | undefined {
  if (/\.tsx$/iu.test(sourcePath)) return ts.ScriptKind.TSX;
  if (/\.(?:ts|mts|cts)$/iu.test(sourcePath)) return ts.ScriptKind.TS;
  if (/\.(?:jsx|js|mjs|cjs)$/iu.test(sourcePath)) return ts.ScriptKind.JSX;
  return undefined;
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
  const conditionRegistrations = options.registerConditionDefinitions === false ? undefined : [];
  const conditionSource = options.renderConditions
    ? instrumentReactConditionalRendering(sourcePath, deferredSource, conditionRegistrations)
    : deferredSource;
  const effectSource = options.isolateEffects
    ? instrumentPreviewReactEffects(sourcePath, conditionSource)
    : conditionSource;
  return {
    registrations: [...deferred.registrations, ...(conditionRegistrations ?? [])],
    source: options.renderConditions
      ? isolatePreviewAsyncReactComponents(sourcePath, effectSource)
      : effectSource,
  };
}
