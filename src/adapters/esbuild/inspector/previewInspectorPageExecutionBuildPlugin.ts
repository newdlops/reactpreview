/* eslint-disable jsdoc/require-jsdoc */
/** Creates the optional virtual-surface plugin for one frozen execution candidate. */
import path from 'node:path';
import type { Plugin } from 'esbuild';
import { createPreviewInspectorPageExecutionPlugin } from './previewInspectorPageExecutionPlugin';
import type { PreviewInspectorPageExecutionCandidate } from './previewInspectorPageExecutionTypes';

export function createPreviewInspectorPageExecutionBuildPlugin(
  candidate: PreviewInspectorPageExecutionCandidate | undefined,
  readSource: (sourcePath: string) => string | undefined,
): Plugin | undefined {
  if (candidate === undefined) return undefined;
  const surfaces = candidate.criticalSurfaces
    .filter(
      (surface) =>
        surface.strategy === 'selected-export-slice' ||
        surface.strategy === 'inner-local-component-slice',
    )
    .map((surface) => ({
      exportName: surface.exportName,
      id: surface.id,
      ...(surface.localName === undefined ? {} : { localName: surface.localName }),
      ...(surface.preservedWrapperKinds === undefined
        ? {}
        : { preservedWrapperKinds: surface.preservedWrapperKinds }),
      sourcePath: surface.sourcePath,
    }));
  return surfaces.length === 0
    ? undefined
    : createPreviewInspectorPageExecutionPlugin({
        readSource: (sourcePath) => readSource(path.normalize(sourcePath)),
        surfaces,
      });
}
