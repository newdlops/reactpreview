/**
 * Serves export-specific virtual modules that compose a target through its selected JSX branch.
 * Discovery remains syntax-only in `parentSlice`; this adapter is the sole boundary that turns an
 * inert wrapper recipe into browser ESM consumed by esbuild's ordinary forward dependency graph.
 */
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import {
  createPreviewParentSliceSource,
  type PreviewParentSlicePlansByExport,
} from './parentSlice';

const PREVIEW_PARENT_SLICE_NAMESPACE = 'react-preview-parent-slice';
const PREVIEW_PARENT_SLICE_SPECIFIER_PREFIX = 'react-preview:parent-slice/';
const MAX_ENCODED_EXPORT_NAME_LENGTH = 2_048;

/** Immutable target and selected export recipes used by one isolated esbuild request. */
export interface PreviewParentSlicePluginOptions {
  /** Active-document path imported as the innermost target component. */
  readonly documentPath: string;
  /** Render-slice plans keyed by the active module's original runtime export name. */
  readonly plansByExport: PreviewParentSlicePlansByExport;
}

/**
 * Encodes one runtime export as the private import consumed by the target gallery bridge.
 *
 * @param exportName Original `default` or named target export.
 * @returns Private virtual module specifier safe to interpolate as a JSON string.
 */
export function createPreviewParentSliceSpecifier(exportName: string): string {
  return `${PREVIEW_PARENT_SLICE_SPECIFIER_PREFIX}${encodeURIComponent(exportName)}`;
}

/**
 * Creates virtual modules for plans selected before the build starts.
 *
 * A request without a matching non-empty plan fails closed instead of silently mounting a direct
 * target under a misleading parent-slice identity. Relative wrapper imports have already been
 * normalized against their consumer by the source generator; package aliases continue through
 * the project's normal esbuild/tsconfig resolution.
 *
 * @param options Active target path and immutable export-specific recipes.
 * @returns Esbuild plugin that resolves only the private parent-slice specifier prefix.
 */
export function createPreviewParentSlicePlugin(options: PreviewParentSlicePluginOptions): Plugin {
  if (!path.isAbsolute(options.documentPath)) {
    throw new RangeError('React preview parent-slice target path must be absolute.');
  }

  /** Resolves a generated export request only when a corresponding safe plan exists. */
  function resolveParentSlice(arguments_: OnResolveArgs): OnResolveResult | undefined {
    const exportName = parsePreviewParentSliceSpecifier(arguments_.path);
    if (exportName === undefined) {
      return undefined;
    }
    const plan = options.plansByExport[exportName];
    if (plan === undefined || plan.frames.length === 0) {
      return {
        errors: [{ text: `React Preview has no wrapper slice for export "${exportName}".` }],
      };
    }
    return { namespace: PREVIEW_PARENT_SLICE_NAMESPACE, path: exportName };
  }

  /** Generates one component that folds the exact selected wrappers around the original target. */
  function loadParentSlice(arguments_: OnLoadArgs): OnLoadResult {
    const plan = options.plansByExport[arguments_.path];
    if (plan === undefined || plan.frames.length === 0) {
      return { errors: [{ text: 'React Preview lost its selected parent-slice plan.' }] };
    }
    return {
      contents: createPreviewParentSliceSource({
        target: {
          consumerSourcePath: options.documentPath,
          exportName: arguments_.path,
          moduleSpecifier: options.documentPath,
        },
        wrappers: plan.frames,
      }),
      loader: 'js',
      resolveDir: path.dirname(options.documentPath),
      watchFiles: [...plan.dependencyPaths],
    };
  }

  return {
    name: 'react-preview-parent-slice',
    setup(build): void {
      build.onResolve({ filter: /^react-preview:parent-slice\// }, resolveParentSlice);
      build.onLoad({ filter: /.*/, namespace: PREVIEW_PARENT_SLICE_NAMESPACE }, loadParentSlice);
    },
  };
}

/** Decodes one bounded private export payload without admitting malformed URI sequences. */
function parsePreviewParentSliceSpecifier(specifier: string): string | undefined {
  if (!specifier.startsWith(PREVIEW_PARENT_SLICE_SPECIFIER_PREFIX)) {
    return undefined;
  }
  const encodedName = specifier.slice(PREVIEW_PARENT_SLICE_SPECIFIER_PREFIX.length);
  if (encodedName.length === 0 || encodedName.length > MAX_ENCODED_EXPORT_NAME_LENGTH) {
    return undefined;
  }
  try {
    const exportName = decodeURIComponent(encodedName);
    return createPreviewParentSliceSpecifier(exportName) === specifier ? exportName : undefined;
  } catch {
    return undefined;
  }
}
