/**
 * Owns the selected-corridor pass-through decision for project dependency source modules.
 *
 * Keeping this policy separate from the resource transformer makes the selected editor document an
 * explicit boundary: dependencies may use esbuild's native parser, while the selected file always
 * receives JSX scenario, compatibility, and runtime instrumentation.
 */
import path from 'node:path';
import { requiresPreviewDependencyCompatibility } from './previewDependencyCompatibility';

/** Minimal build options required to decide whether a module can bypass compatibility analysis. */
export interface PreviewDependencyPassThroughOptions {
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
  // Page Inspector searches through authored JSX branches and deferred controls in dependencies,
  // not only in the selected editor file. Passing a JSX-bearing module straight to esbuild would
  // leave those branches invisible to the runtime search and can make a reachable nested target
  // look permanently unrendered.
  if (
    options.instrumentRenderConditions === true &&
    (/[.]jsx?$/iu.test(sourcePath) || /[.]tsx$/iu.test(sourcePath))
  ) {
    return false;
  }
  return !requiresPreviewDependencyCompatibility(sourceText, options.projectUsesNextRuntime);
}
