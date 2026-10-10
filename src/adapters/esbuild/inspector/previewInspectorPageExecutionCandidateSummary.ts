/**
 * Summarizes compiler Page Execution candidates for the browser runtime.
 *
 * Besides role identities, each summary carries the declared component name of a default-exported
 * execution or page root (`RootLayout` in `app/layout.tsx`, `MyApp` in `pages/_app.tsx`), so the
 * runtime can verify its live page owners by the name React actually mounts instead of the file
 * name alone. Roots whose name cannot be proven keep the previous summary shape.
 */
import path from 'node:path';
import { readPreviewReactExportComponentName } from '../staticResources/previewReactExportComponentName';
import type { PreviewInspectorPageExecutionCandidate } from './previewInspectorPageExecutionTypes';

/** One browser-facing Page Execution candidate summary. */
export interface PreviewInspectorPageExecutionCandidateSummary {
  readonly authoredOwnerDepth: number;
  readonly executionRootComponentName?: string;
  readonly executionRootExportName: string | undefined;
  readonly executionRootSourcePath: string | undefined;
  readonly executionRootSurfaceId: string;
  readonly fidelity: string;
  readonly id: string;
  readonly nestedMountCount: number;
  readonly ownsGeneratedRouter: boolean;
  readonly pageRootComponentName?: string;
  readonly pageRootExportName: string;
  readonly pageRootSourcePath: string;
  readonly runtimeTargetSurfaceId: string;
  readonly standaloneTarget: boolean | undefined;
  readonly targetRole: string;
}

/** Maps candidates to summaries, reading each default-exported root source at most once. */
export function createPreviewInspectorPageExecutionCandidateSummaries(
  candidates: readonly PreviewInspectorPageExecutionCandidate[] | undefined,
  readSource: (sourcePath: string) => string | undefined,
): readonly PreviewInspectorPageExecutionCandidateSummary[] | undefined {
  if (candidates === undefined) return undefined;
  const componentNames = new Map<string, string | undefined>();
  const readComponentName = (
    reference: { readonly exportName: string; readonly sourcePath: string } | undefined,
  ): string | undefined => {
    if (reference?.exportName !== 'default') return undefined;
    const key = path.normalize(reference.sourcePath);
    if (!componentNames.has(key)) {
      const sourceText = readSource(reference.sourcePath);
      componentNames.set(
        key,
        sourceText === undefined
          ? undefined
          : readPreviewReactExportComponentName({
              exportName: 'default',
              sourcePath: reference.sourcePath,
              sourceText,
            }),
      );
    }
    return componentNames.get(key);
  };
  return candidates.map((candidate) => {
    const executionRoot = candidate.criticalSurfaces.find(
      (surface) => surface.id === candidate.executionRootSurfaceId,
    );
    const executionRootComponentName = readComponentName(executionRoot);
    const pageRootComponentName = readComponentName(candidate.browserCandidate.root);
    return {
      authoredOwnerDepth: candidate.browserCandidate.renderPath?.steps.length ?? 0,
      ...(executionRootComponentName === undefined ? {} : { executionRootComponentName }),
      executionRootExportName: executionRoot?.exportName,
      executionRootSourcePath: executionRoot?.sourcePath,
      executionRootSurfaceId: candidate.executionRootSurfaceId,
      fidelity: candidate.fidelity,
      id: candidate.id,
      nestedMountCount: candidate.routeRecipe?.mounts.length ?? 0,
      ownsGeneratedRouter:
        candidate.routeRecipe !== undefined &&
        !candidate.routeRecipe.rootOwnsRouter &&
        (candidate.routeRecipe.kind === 'react-router-v5' ||
          candidate.routeRecipe.kind === 'react-router-v6'),
      ...(pageRootComponentName === undefined ? {} : { pageRootComponentName }),
      pageRootExportName: candidate.browserCandidate.root.exportName,
      pageRootSourcePath: candidate.browserCandidate.root.sourcePath,
      runtimeTargetSurfaceId: candidate.runtimeTargetSurfaceId,
      standaloneTarget: candidate.standaloneTarget,
      targetRole: candidate.routeRecipe?.targetRole ?? 'element',
    };
  });
}
