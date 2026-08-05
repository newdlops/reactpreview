/** Verifies that esbuild did not materialize an authored source outside the frozen frontier. */
import path from 'node:path';
import type { Metafile } from 'esbuild';
import type { PreviewCompilerBundleFrontierActivity } from '../../../domain/previewCompilerActivity';
import {
  PreviewBuildStalledError,
  type PreviewFrontierMismatchEvidence,
} from '../../../domain/previewBuildExecution';
import { createPreviewInspectorFrontierMismatchEvidence } from './previewInspectorFrontierMismatchEvidence';
import { canonicalizeExistingPath } from '../../../shared/pathIdentity';
import { PREVIEW_INSPECTOR_PAGE_SURFACE_NAMESPACE } from '../previewPluginProtocol';

const SOURCE_MODULE_PATTERN = /(?:\.d)?\.[cm]?[jt]sx?$/iu;

export interface VerifyPreviewInspectorBundleFrontierMetafileOptions {
  readonly activity: PreviewCompilerBundleFrontierActivity;
  readonly authenticSourcePaths: readonly string[];
  readonly executionSurfaces?: readonly {
    readonly id: string;
    readonly sourcePath: string;
    readonly strategy: string;
  }[];
  readonly metafile: Metafile;
  readonly target: string;
  readonly workspaceRoot: string;
}

/** Fails closed when a successful frozen-frontier build exposes a new authored esbuild input. */
export function verifyPreviewInspectorBundleFrontierMetafile(
  options: VerifyPreviewInspectorBundleFrontierMetafileOptions,
): void {
  const workspaceRoot = canonicalizeExistingPath(options.workspaceRoot);
  const authenticSourcePaths = new Set(
    options.authenticSourcePaths.map((sourcePath) => canonicalizeExistingPath(sourcePath)),
  );
  const unexpectedInputs = Object.keys(options.metafile.inputs)
    .filter(isAuthoredMetafileInputPath)
    .map((sourcePath) => canonicalizeExistingPath(path.resolve(workspaceRoot, sourcePath)))
    .sort()
    .filter(
      (sourcePath) =>
        isAuthoredWorkspaceSource(workspaceRoot, sourcePath) &&
        !authenticSourcePaths.has(sourcePath),
    );
  const unexpectedInputSet = new Set(unexpectedInputs);
  const unexpectedWithEdges = unexpectedInputs.map((sourcePath) => ({
      incomingEdge: findIncomingAuthoredEdge(options, workspaceRoot, sourcePath),
      sourcePath,
    }));
  const boundaryEscape =
    unexpectedWithEdges.find(
      ({ incomingEdge }) =>
        incomingEdge !== undefined && authenticSourcePaths.has(incomingEdge.importerPath),
    ) ??
    unexpectedWithEdges.find(
      ({ incomingEdge }) =>
        incomingEdge === undefined || !unexpectedInputSet.has(incomingEdge.importerPath),
    );
  const unexpectedInput = boundaryEscape?.sourcePath ?? unexpectedInputs[0];
  if (unexpectedInput !== undefined) {
    const incomingEdge =
      boundaryEscape?.incomingEdge ??
      findIncomingAuthoredEdge(options, workspaceRoot, unexpectedInput);
    throwFrontierMismatch(
      options,
      createPreviewInspectorFrontierMismatchEvidence({
        cause: 'unexpected-metafile-input',
        sourcePath: unexpectedInput,
        workspaceRoot,
        ...(incomingEdge === undefined ? {} : incomingEdge),
      }),
    );
  }
  const missingExecutionSurface = options.executionSurfaces?.find(
    (surface) => !hasExecutionSurface(options, surface),
  );
  if (missingExecutionSurface !== undefined)
    throwFrontierMismatch(
      options,
      createPreviewInspectorFrontierMismatchEvidence({
        cause: 'missing-execution-surface',
        sourcePath: missingExecutionSurface.sourcePath,
        surfaceId: missingExecutionSurface.id,
        surfaceStrategy: missingExecutionSurface.strategy,
        workspaceRoot,
      }),
    );
}

/** Retains the authored edge that materialized an unplanned input when esbuild exposes it. */
function findIncomingAuthoredEdge(
  options: VerifyPreviewInspectorBundleFrontierMetafileOptions,
  workspaceRoot: string,
  targetPath: string,
): { readonly importerPath: string; readonly moduleSpecifier: string } | undefined {
  for (const [inputPath, input] of Object.entries(options.metafile.inputs).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!isAuthoredMetafileInputPath(inputPath)) continue;
    const importerPath = canonicalizeExistingPath(path.resolve(workspaceRoot, inputPath));
    if (!isAuthoredWorkspaceSource(workspaceRoot, importerPath)) continue;
    for (const imported of input.imports) {
      if (imported.external === true || !isAuthoredMetafileInputPath(imported.path)) continue;
      const importedPath = canonicalizeExistingPath(path.resolve(workspaceRoot, imported.path));
      if (importedPath !== targetPath) continue;
      return {
        importerPath,
        moduleSpecifier: imported.original ?? imported.path,
      };
    }
  }
  return undefined;
}

/** Requires every generated execution surface to survive output tree-shaking and composition. */
function hasExecutionSurface(
  options: VerifyPreviewInspectorBundleFrontierMetafileOptions,
  surface: NonNullable<
    VerifyPreviewInspectorBundleFrontierMetafileOptions['executionSurfaces']
  >[number],
): boolean {
  if (
    surface.strategy === 'selected-export-slice' ||
    surface.strategy === 'inner-local-component-slice'
  ) {
    const expected = `${PREVIEW_INSPECTOR_PAGE_SURFACE_NAMESPACE}:${surface.id}`;
    return Object.keys(options.metafile.inputs).some((inputPath) => inputPath === expected);
  }
  const sourcePath = canonicalizeExistingPath(surface.sourcePath);
  return Object.keys(options.metafile.inputs).some((inputPath) => {
    if (!isAuthoredMetafileInputPath(inputPath)) return false;
    return canonicalizeExistingPath(path.resolve(options.workspaceRoot, inputPath)) === sourcePath;
  });
}

/** Reports one consistency failure without disclosing candidate paths or virtual identifiers. */
function throwFrontierMismatch(
  options: VerifyPreviewInspectorBundleFrontierMetafileOptions,
  frontierMismatchEvidence: PreviewFrontierMismatchEvidence,
): never {
  throw new PreviewBuildStalledError(
    options.target,
    'bundling-modules',
    0,
    'frontier-mismatch',
    options.activity,
    frontierMismatchEvidence,
  );
}

/** Leaves compiler virtual namespaces out of a check that is only meaningful for workspace files. */
function isAuthoredMetafileInputPath(sourcePath: string): boolean {
  return !sourcePath.startsWith('<') && (path.isAbsolute(sourcePath) || !sourcePath.includes(':'));
}

/** Excludes dependency and virtual modules so the assertion models only authored frontier membership. */
function isAuthoredWorkspaceSource(workspaceRoot: string, sourcePath: string): boolean {
  const relative = path.relative(workspaceRoot, sourcePath);
  return (
    path.isAbsolute(sourcePath) &&
    relative.length > 0 &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !relative.split(path.sep).includes('node_modules') &&
    SOURCE_MODULE_PATTERN.test(sourcePath)
  );
}
