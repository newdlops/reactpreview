/** Exposes selected Page Execution surfaces as build-scoped esbuild virtual modules. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import { PREVIEW_INSPECTOR_PAGE_SURFACE_NAMESPACE } from '../previewPluginProtocol';
import {
  createPreviewInspectorSelectedExportSlice,
  createPreviewInspectorLocalComponentSlice,
  type PreviewInspectorMountSurfaceSliceFailureReason,
} from './previewInspectorMountSurfaceSlice';

export const PREVIEW_INSPECTOR_PAGE_SURFACE_SPECIFIER_PREFIX = 'react-preview:page-surface/';

const PREVIEW_INSPECTOR_PAGE_SURFACE_IMPORTER_PATH_KEY =
  'reactPreviewInspectorPageSurfaceImporterPath';

interface PreviewInspectorPageSurfaceImporterData {
  readonly [PREVIEW_INSPECTOR_PAGE_SURFACE_IMPORTER_PATH_KEY]: string;
}

export interface PreviewInspectorPageExecutionPluginSurface {
  readonly exportName: string;
  readonly id: string;
  readonly localName?: string;
  readonly preservedWrapperKinds?: readonly ('forward-ref' | 'memo' | 'styled')[];
  readonly sourcePath: string;
}

export interface PreviewInspectorPageExecutionPluginOptions {
  readonly readSource: (sourcePath: string) => string | undefined;
  readonly surfaces: readonly PreviewInspectorPageExecutionPluginSurface[];
  /** Applies the same compatibility/runtime instrumentation used by authored workspace modules. */
  readonly transformSource?: (
    sourcePath: string,
    sourceText: string,
  ) => Promise<{
    readonly contents: string;
    readonly watchDirectories: readonly string[];
  }>;
}

/** A result captured during virtual source generation for planner diagnostics and tests. */
export interface PreviewInspectorPageExecutionSurfaceLoad {
  readonly failed: boolean;
  readonly surfaceId: string;
  readonly failureReason?: PreviewInspectorMountSurfaceSliceFailureReason;
}

/** Creates the opaque specifier used by generated root/composition source. */
export function createPreviewInspectorPageSurfaceSpecifier(surfaceId: string): string {
  return PREVIEW_INSPECTOR_PAGE_SURFACE_SPECIFIER_PREFIX + encodeURIComponent(surfaceId);
}

/** Recovers the authored module identity carried by a virtual Page Execution slice. */
export function readPreviewInspectorPageSurfaceImporterPath(value: unknown): string | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    !(PREVIEW_INSPECTOR_PAGE_SURFACE_IMPORTER_PATH_KEY in value)
  ) {
    return undefined;
  }
  const sourcePath = value[PREVIEW_INSPECTOR_PAGE_SURFACE_IMPORTER_PATH_KEY];
  return typeof sourcePath === 'string' && path.isAbsolute(sourcePath) ? sourcePath : undefined;
}

/**
 * Provides only declared execution surfaces. It never intercepts ordinary workspace imports, which
 * keeps normal authored source loading and target instrumentation ownership unchanged.
 */
export function createPreviewInspectorPageExecutionPlugin(
  options: PreviewInspectorPageExecutionPluginOptions,
): Plugin {
  const surfaces = new Map(options.surfaces.map((surface) => [surface.id, surface]));
  const loads: PreviewInspectorPageExecutionSurfaceLoad[] = [];
  const resolve = (arguments_: OnResolveArgs): OnResolveResult | undefined => {
    if (!arguments_.path.startsWith(PREVIEW_INSPECTOR_PAGE_SURFACE_SPECIFIER_PREFIX))
      return undefined;
    const surfaceId = decodeURIComponent(
      arguments_.path.slice(PREVIEW_INSPECTOR_PAGE_SURFACE_SPECIFIER_PREFIX.length),
    );
    return surfaces.has(surfaceId)
      ? { namespace: PREVIEW_INSPECTOR_PAGE_SURFACE_NAMESPACE, path: surfaceId }
      : undefined;
  };
  const load = async (arguments_: OnLoadArgs): Promise<OnLoadResult | undefined> => {
    const surface = surfaces.get(arguments_.path);
    if (surface === undefined) return undefined;
    const sourceText = options.readSource(surface.sourcePath) ?? readDiskSource(surface.sourcePath);
    const result =
      sourceText === undefined
        ? undefined
        : surface.localName === undefined
          ? createPreviewInspectorSelectedExportSlice({
              exportName: surface.exportName,
              sourcePath: surface.sourcePath,
              sourceText,
            })
          : createPreviewInspectorLocalComponentSlice({
              localName: surface.localName,
              preservedWrapperKinds: surface.preservedWrapperKinds ?? [],
              sourcePath: surface.sourcePath,
              sourceText,
            });
    if (result?.kind === 'success') {
      loads.push(Object.freeze({ failed: false, surfaceId: surface.id }));
      const transformed =
        options.transformSource === undefined
          ? undefined
          : await options.transformSource(surface.sourcePath, result.slice.contents);
      return {
        contents: transformed?.contents ?? result.slice.contents,
        loader: surface.sourcePath.toLowerCase().endsWith('x') ? 'tsx' : 'ts',
        pluginData: Object.freeze({
          [PREVIEW_INSPECTOR_PAGE_SURFACE_IMPORTER_PATH_KEY]: surface.sourcePath,
        } satisfies PreviewInspectorPageSurfaceImporterData),
        resolveDir: path.dirname(surface.sourcePath),
        ...(transformed?.watchDirectories === undefined
          ? {}
          : { watchDirs: [...transformed.watchDirectories] }),
        watchFiles: [surface.sourcePath],
      };
    }
    loads.push(
      Object.freeze({
        failed: true,
        ...(result?.kind === 'failure' ? { failureReason: result.reason } : {}),
        surfaceId: surface.id,
      }),
    );
    return {
      errors: [
        {
          text: `Unable to create the frozen Page Execution slice for ${surface.id}${result?.kind === 'failure' ? ` (${result.reason})` : ''}.`,
        },
      ],
      resolveDir: path.dirname(surface.sourcePath),
      watchFiles: [surface.sourcePath],
    };
  };
  return {
    name: 'react-preview-page-execution-surface',
    setup(build): void {
      build.onResolve({ filter: /^react-preview:page-surface\// }, resolve);
      build.onLoad({ filter: /.*/, namespace: PREVIEW_INSPECTOR_PAGE_SURFACE_NAMESPACE }, load);
    },
  };
}

/** Uses a bounded disk fallback for unchanged surfaces omitted from editor snapshots. */
function readDiskSource(sourcePath: string): string | undefined {
  try {
    return readFileSync(sourcePath, 'utf8');
  } catch {
    return undefined;
  }
}
