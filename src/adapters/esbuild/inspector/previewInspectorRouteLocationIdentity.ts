/** Stable compiler-only identities and source ordering shared by route-location planning. */
import path from 'node:path';
import type { PreviewRenderChainPlan } from '../renderGraph';

/** Keeps factory-disabled rows distinct without exposing parser nodes to the branch protocol. */
export function createPreviewInspectorFactoryUnresolvedOccurrenceIdentity(
  sourcePath: string,
  kind: 'page' | 'submodule',
  componentName: string,
  occurrenceStart: number,
): string {
  return JSON.stringify({
    componentName,
    kind,
    occurrenceStart,
    ownerSourcePath: path.normalize(sourcePath),
  });
}

/** Keeps exact render-path sources first because they are the cheapest and strongest evidence. */
export function collectPreviewInspectorRenderPathSourcePaths(
  renderChain: PreviewRenderChainPlan,
): readonly string[] {
  return [
    ...new Set(
      renderChain.paths.flatMap((renderPath) => [
        ...renderPath.steps.map((step) => path.normalize(step.sourcePath)),
        ...(renderPath.entryPoint === undefined
          ? []
          : [path.normalize(renderPath.entryPoint.sourcePath)]),
      ]),
    ),
  ];
}
