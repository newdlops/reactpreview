/** Verifies that esbuild did not materialize an authored source outside the frozen frontier. */
import path from 'node:path';
import type { Metafile } from 'esbuild';
import type { PreviewCompilerBundleFrontierActivity } from '../../../domain/previewCompilerActivity';
import { PreviewBuildStalledError } from '../../../domain/previewBuildExecution';
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

/** Fails closed when a successful bounded build exposes a new authored esbuild input. */
export function verifyPreviewInspectorBundleFrontierMetafile(
  options: VerifyPreviewInspectorBundleFrontierMetafileOptions,
): void {
  const workspaceRoot = canonicalizeExistingPath(options.workspaceRoot);
  const authenticSourcePaths = new Set(
    options.authenticSourcePaths.map((sourcePath) => canonicalizeExistingPath(sourcePath)),
  );
  const unexpectedInput = Object.keys(options.metafile.inputs)
    .filter(isAuthoredMetafileInputPath)
    .map((sourcePath) => canonicalizeExistingPath(path.resolve(workspaceRoot, sourcePath)))
    .sort()
    .find(
      (sourcePath) =>
        isAuthoredWorkspaceSource(workspaceRoot, sourcePath) &&
        !authenticSourcePaths.has(sourcePath),
    );
  if (unexpectedInput !== undefined) throwFrontierMismatch(options);
  if (options.executionSurfaces?.some((surface) => !hasExecutionSurface(options, surface)))
    throwFrontierMismatch(options);
}

/** Requires every generated execution surface to survive output tree-shaking and composition. */
function hasExecutionSurface(
  options: VerifyPreviewInspectorBundleFrontierMetafileOptions,
  surface: NonNullable<VerifyPreviewInspectorBundleFrontierMetafileOptions['executionSurfaces']>[number],
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

/** Reports one uniform bounded failure without disclosing candidate paths or virtual identifiers. */
function throwFrontierMismatch(options: VerifyPreviewInspectorBundleFrontierMetafileOptions): never {
  throw new PreviewBuildStalledError(
    options.target,
    'bundling-modules',
    0,
    'graph-budget',
    options.activity,
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
