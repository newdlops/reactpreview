/** Prepares compile-scoped prop inference with unsaved snapshot precedence and bounded child demands. */
import path from 'node:path';
import ts from 'typescript';
import type { PreviewBuildRequest } from '../../domain/preview';
import type { PreviewStaticModuleResolver } from './previewStaticModuleResolver';
import { createPreviewTargetPropInferenceMemo } from './previewTargetPropInferenceMemo';
import { PreviewRuntimeHookChildPropDemandCatalogBuilder } from './staticResources/previewRuntimeHookChildPropDemand';
import {
  collectReactExportPropInference,
  type PreviewInferredPropsByExport,
} from './staticResources/reactExportPropInference';

/** Reads inert source only, reuses successful exact-source results, and never evaluates a module. */
export function createPreviewCompilerPropInference(
  request: PreviewBuildRequest,
  canonicalWorkspaceRoot: string,
  analysisStaticModuleResolver: PreviewStaticModuleResolver,
): (sourcePath: string, sourceText: string) => PreviewInferredPropsByExport {
  const propInferenceSnapshotSourceByPath = new Map(
    [
      ...request.dependencySnapshots,
      {
        documentPath: request.documentPath,
        language: request.language,
        sourceText: request.sourceText,
      },
    ].map((snapshot) => [path.normalize(snapshot.documentPath), snapshot.sourceText] as const),
  );
  const readPropInferenceSource = (sourcePath: string): string | undefined =>
    propInferenceSnapshotSourceByPath.get(path.normalize(sourcePath)) ??
    ts.sys.readFile(sourcePath);
  const childPropDemandBuilder = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
    readSource: readPropInferenceSource,
    resolveModule: analysisStaticModuleResolver.resolve,
    workspaceRoot: canonicalWorkspaceRoot,
  });
  const collectTargetInferredProps = createPreviewTargetPropInferenceMemo(
    (sourcePath: string, sourceText: string): ReturnType<typeof collectReactExportPropInference> =>
      collectReactExportPropInference(sourcePath, sourceText, {
        childPropDemands: () => childPropDemandBuilder.collect(sourcePath, sourceText),
        resolveImport: (moduleSpecifier, importerPath) => {
          const resolvedPath = analysisStaticModuleResolver.resolve(moduleSpecifier, importerPath);
          const resolvedSourceText =
            resolvedPath === undefined ? undefined : readPropInferenceSource(resolvedPath);
          return resolvedPath === undefined || resolvedSourceText === undefined
            ? undefined
            : { sourcePath: resolvedPath, sourceText: resolvedSourceText };
        },
      }),
  );
  return collectTargetInferredProps;
}
