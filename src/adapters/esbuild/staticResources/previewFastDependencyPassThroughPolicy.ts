/**
 * Owns the fast-preparation decision for project dependency source modules.
 *
 * Keeping this policy separate from the resource transformer makes the selected editor document an
 * explicit boundary: dependencies may use esbuild's native parser, while the selected file always
 * receives JSX scenario, compatibility, and runtime instrumentation.
 */
import path from 'node:path';
import { requiresFastDependencyCompatibility } from './previewFastDependencyCompatibility';

/** Minimal build options required to decide whether a module can bypass compatibility analysis. */
export interface PreviewFastDependencyPassThroughOptions {
  /** Exact editor document that must always use the complete transform pipeline. */
  readonly documentPath?: string;
  /** Whether the compilation is the latency-sensitive provisional first paint. */
  readonly fastPreparation?: boolean;
  /** Whether reached source may depend on Next.js compatibility replacements. */
  readonly projectUsesNextRuntime?: boolean;
}

/**
 * Reports whether an ordinary dependency can go directly to esbuild's native parser.
 *
 * The selected document, full preparation, and source that requires a framework/runtime adapter all
 * fail closed. Paths are normalized without resolving symlinks so the compiler retains its existing
 * workspace identity and does not add filesystem I/O to the hot path.
 */
export function canUsePreviewFastDependencyPassThrough(
  sourcePath: string,
  sourceText: string,
  options: PreviewFastDependencyPassThroughOptions,
): boolean {
  if (options.fastPreparation !== true) return false;
  if (
    options.documentPath !== undefined &&
    path.normalize(sourcePath) === path.normalize(options.documentPath)
  ) {
    return false;
  }
  return !requiresFastDependencyCompatibility(sourceText, options.projectUsesNextRuntime);
}
