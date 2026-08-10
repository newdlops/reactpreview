/** Restores neutral props when Page Execution pins a safer root below the analysis candidate. */
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
 * Adds inference only to candidate roots that were pinned after ancestry analysis.
 *
 * The original candidate inference belongs to a different source/export and is deliberately
 * removed by Page Execution. This pass reads the exact admitted root and its reached JSX child
 * contracts, so generated props describe the component that will actually be mounted.
 */
export async function inferPreviewInspectorPageExecutionRootProps(
  options: InferPreviewInspectorPageExecutionRootPropsOptions,
): Promise<readonly PreviewInspectorPageExecutionCandidate[]> {
  const sourceByPath = new Map<string, string>();
  for (const [sourcePath, sourceText] of options.snapshotSourceByPath ?? []) {
    sourceByPath.set(path.normalize(sourcePath), sourceText);
  }
  const missingRoots = new Map<string, { readonly exportName: string; readonly sourcePath: string }>();
  for (const candidate of options.candidates) {
    if (candidate.browserCandidate.rootInference !== undefined) continue;
    const root = candidate.browserCandidate.root;
    missingRoots.set(createRootIdentity(root.sourcePath, root.exportName), root);
  }
  await Promise.all(
    [...missingRoots.values()].map(async (root) => {
      const normalizedPath = path.normalize(root.sourcePath);
      if (sourceByPath.has(normalizedPath)) return;
      const sourceText = await options.readSource(normalizedPath);
      if (
        sourceText !== undefined &&
        Buffer.byteLength(sourceText, 'utf8') <= MAXIMUM_EXECUTION_ROOT_SOURCE_BYTES
      ) {
        sourceByPath.set(normalizedPath, sourceText);
      }
    }),
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
        const importedSource = sourceByPath.get(normalizedImportedPath) ?? ts.sys.readFile(importedPath);
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
      if (candidate.browserCandidate.rootInference !== undefined) return candidate;
      const root = candidate.browserCandidate.root;
      const inference = inferenceByRoot.get(createRootIdentity(root.sourcePath, root.exportName));
      if (inference === undefined) return candidate;
      return Object.freeze({
        ...candidate,
        browserCandidate: Object.freeze({
          ...candidate.browserCandidate,
          rootInference: inference,
        }),
      });
    }),
  );
}

/** Creates a stable source/export key without exposing it to browser metadata. */
function createRootIdentity(sourcePath: string, exportName: string): string {
  return JSON.stringify([path.normalize(sourcePath), exportName]);
}
