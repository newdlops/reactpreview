/**
 * Owns the selected-corridor pass-through decision for project dependency source modules.
 *
 * Keeping this policy separate from the resource transformer makes the selected editor document an
 * explicit boundary: dependencies may use esbuild's native parser, while the selected file always
 * receives JSX scenario, compatibility, and runtime instrumentation.
 */
import path from 'node:path';
import { requiresPreviewDependencyCompatibility } from './previewDependencyCompatibility';
import { mayRequirePreviewRuntimeSourceInstrumentation } from './previewRuntimeSourceInstrumentation';

/** Minimal build options required to decide whether a module can bypass compatibility analysis. */
export interface PreviewDependencyPassThroughOptions {
  /** Compiler-proven Page Execution source paths that must retain composition transforms. */
  readonly criticalSurfaceSourcePaths?: readonly string[];
  /** Exact editor document that must always use the complete transform pipeline. */
  readonly documentPath?: string;
  /** Whether selected-corridor compilation may bypass preview-insensitive dependencies. */
  readonly selectiveDependencyPassThrough?: boolean;
  /** Whether reached JSX must expose conditional branches and deferred UI controls. */
  readonly instrumentRenderConditions?: boolean;
  /** Whether reached source may depend on Next.js compatibility replacements. */
  readonly projectUsesNextRuntime?: boolean;
}

/**
 * Reports whether an ordinary selected-corridor dependency can use esbuild's native parser.
 *
 * The selected document, full preparation, and source that requires a framework/runtime adapter all
 * fail closed. Paths are normalized without resolving symlinks so the compiler retains its existing
 * workspace identity and does not add filesystem I/O to the hot path.
 */
export function canPassThroughPreviewDependency(
  sourcePath: string,
  sourceText: string,
  options: PreviewDependencyPassThroughOptions,
): boolean {
  if (options.selectiveDependencyPassThrough !== true) return false;
  if (
    options.documentPath !== undefined &&
    path.normalize(sourcePath) === path.normalize(options.documentPath)
  ) {
    return false;
  }
  if (
    options.criticalSurfaceSourcePaths?.some(
      (criticalSurfacePath) => path.normalize(sourcePath) === path.normalize(criticalSurfacePath),
    ) === true
  ) {
    return false;
  }
  if (
    options.instrumentRenderConditions === true &&
    mayRequirePreviewRuntimeSourceInstrumentation(sourcePath, sourceText)
  ) {
    return false;
  }
  return !requiresPreviewDependencyCompatibility(sourceText, options.projectUsesNextRuntime);
}
