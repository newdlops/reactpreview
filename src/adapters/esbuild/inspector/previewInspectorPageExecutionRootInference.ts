/** Restores neutral props for pinned page roots and explicitly composed authored siblings. */
import path from 'node:path';
import ts from 'typescript';
import { PreviewRuntimeHookChildPropDemandCatalogBuilder } from '../staticResources/previewRuntimeHookChildPropDemand';
import {
  collectReactExportPropInference,
  collectReactLocalComponentPropInference,
  type PreviewInferredExportProps,
  type PreviewPropInferenceOptions,
} from '../staticResources/reactExportPropInference';
import type { PreviewInspectorPageExecutionCandidate } from './previewInspectorPageExecutionTypes';

const MAXIMUM_EXECUTION_ROOT_SOURCE_BYTES = 1024 * 1024;

export interface InferPreviewInspectorPageExecutionRootPropsOptions {
  readonly candidates: readonly PreviewInspectorPageExecutionCandidate[];
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly resolveModule: (specifier: string, importer: string) => string | undefined;
  /** Dirty editor snapshots available synchronously to transitive child-prop inference. */
  readonly snapshotSourceByPath?: ReadonlyMap<string, string>;
  readonly workspaceRoot: string;
}

/**
 * Adds inference to candidate roots pinned after ancestry analysis and detached sibling surfaces.
 *
 * The original candidate inference belongs to a different source/export and is deliberately
 * removed by Page Execution. This pass reads the exact admitted root and its reached JSX child
 * contracts, so generated props describe the component that will actually be mounted. Sibling
 * inference uses the same source/export cache, never the target's props or optional route inventory.
 */
export async function inferPreviewInspectorPageExecutionRootProps(
  options: InferPreviewInspectorPageExecutionRootPropsOptions,
): Promise<readonly PreviewInspectorPageExecutionCandidate[]> {
  const sourceByPath = new Map<string, string>();
  for (const [sourcePath, sourceText] of options.snapshotSourceByPath ?? []) {
    sourceByPath.set(path.normalize(sourcePath), sourceText);
  }
  const missingRoots = new Map<
    string,
    { readonly exportName: string; readonly sourcePath: string }
  >();
  for (const candidate of options.candidates) {
    if (candidate.browserCandidate.rootInference === undefined) {
      const root = candidate.browserCandidate.root;
      missingRoots.set(createRootIdentity(root.sourcePath, root.exportName), root);
    }
    const siblingIds = collectSiblingSurfaceIds(candidate);
    for (const surface of candidate.criticalSurfaces) {
      if (siblingIds.has(surface.id) && surface.propInference === undefined) {
        missingRoots.set(createRootIdentity(surface.sourcePath, surface.exportName), surface);
      }
    }
  }
  await Promise.all(
    [...new Set([...missingRoots.values()].map((root) => path.normalize(root.sourcePath)))].map(
      async (normalizedPath) => {
        if (sourceByPath.has(normalizedPath)) return;
        const sourceText = await options.readSource(normalizedPath);
        if (
          sourceText !== undefined &&
          Buffer.byteLength(sourceText, 'utf8') <= MAXIMUM_EXECUTION_ROOT_SOURCE_BYTES
        ) {
          sourceByPath.set(normalizedPath, sourceText);
        }
      },
    ),
  );
  const childPropDemands = new PreviewRuntimeHookChildPropDemandCatalogBuilder({
    readSource: (sourcePath) => sourceByPath.get(path.normalize(sourcePath)),
    resolveModule: options.resolveModule,
    workspaceRoot: options.workspaceRoot,
  });
  const inferenceByRoot = new Map<string, PreviewInferredExportProps | undefined>();
  for (const root of missingRoots.values()) {
    const identity = createRootIdentity(root.sourcePath, root.exportName);
    const normalizedPath = path.normalize(root.sourcePath);
    const sourceText = sourceByPath.get(normalizedPath);
    if (sourceText === undefined) {
      inferenceByRoot.set(identity, undefined);
      continue;
    }
    const demands = childPropDemands.collect(normalizedPath, sourceText);
    const inferenceOptions: PreviewPropInferenceOptions = {
      ...(demands.size === 0 ? {} : { childPropDemands: demands }),
      resolveImport(moduleSpecifier, importerPath) {
        const importedPath = options.resolveModule(moduleSpecifier, importerPath);
        if (importedPath === undefined) return undefined;
        const normalizedImportedPath = path.normalize(importedPath);
        const importedSource =
          sourceByPath.get(normalizedImportedPath) ?? ts.sys.readFile(importedPath);
        return importedSource === undefined
          ? undefined
          : { sourcePath: normalizedImportedPath, sourceText: importedSource };
      },
    };
    const inference =
      collectReactExportPropInference(normalizedPath, sourceText, inferenceOptions)[
        root.exportName
      ] ??
      collectReactLocalComponentPropInference(
        normalizedPath,
        sourceText,
        [root.exportName],
        inferenceOptions,
      )[root.exportName];
    inferenceByRoot.set(identity, inference);
  }
  return Object.freeze(
    options.candidates.map((candidate) => {
      const root = candidate.browserCandidate.root;
      const inference =
        candidate.browserCandidate.rootInference ??
        inferenceByRoot.get(createRootIdentity(root.sourcePath, root.exportName));
      const siblingIds = collectSiblingSurfaceIds(candidate);
      const criticalSurfaces = candidate.criticalSurfaces.map((surface) => {
        if (!siblingIds.has(surface.id) || surface.propInference !== undefined) return surface;
        const propInference = inferenceByRoot.get(
          createRootIdentity(surface.sourcePath, surface.exportName),
        );
        return propInference === undefined ? surface : Object.freeze({ ...surface, propInference });
      });
      if (
        inference === candidate.browserCandidate.rootInference &&
        criticalSurfaces.every((surface, index) => surface === candidate.criticalSurfaces[index])
      )
        return candidate;
      return Object.freeze({
        ...candidate,
        criticalSurfaces: Object.freeze(criticalSurfaces),
        browserCandidate:
          inference === undefined
            ? candidate.browserCandidate
            : Object.freeze({
                ...candidate.browserCandidate,
                rootInference: inference,
              }),
      });
    }),
  );
}

/** Identifies only explicit sibling mounts, excluding roots, exact targets, and authored children. */
function collectSiblingSurfaceIds(
  candidate: PreviewInspectorPageExecutionCandidate,
): ReadonlySet<string> {
  return new Set(
    candidate.compositionEdges
      .filter(
        (edge) =>
          (edge.mode === 'sibling-before' || edge.mode === 'sibling-after') &&
          edge.childSurfaceId !== candidate.executionRootSurfaceId &&
          edge.childSurfaceId !== candidate.runtimeTargetSurfaceId,
      )
      .map((edge) => edge.childSurfaceId),
  );
}

/** Creates a stable source/export key without exposing it to browser metadata. */
function createRootIdentity(sourcePath: string, exportName: string): string {
  return JSON.stringify([path.normalize(sourcePath), exportName]);
}
