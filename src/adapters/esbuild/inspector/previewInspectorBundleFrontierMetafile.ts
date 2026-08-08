/** Verifies that esbuild did not materialize an authored source outside the frozen frontier. */
import { readFileSync } from 'node:fs';
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
import { resolvePreviewYarnVirtualPath } from '../previewYarnVirtualPath';

const SOURCE_MODULE_PATTERN = /(?:\.d)?\.[cm]?[jt]sx?$/iu;

export interface VerifyPreviewInspectorBundleFrontierMetafileOptions {
  readonly activity: PreviewCompilerBundleFrontierActivity;
  readonly authenticSourcePaths: readonly string[];
  readonly packageDemandSourcePaths?: readonly string[];
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
  const packageDemandSourcePaths = new Set(
    (options.packageDemandSourcePaths ?? []).map((sourcePath) =>
      canonicalizeExistingPath(sourcePath),
    ),
  );
  const metafileInputs = Object.keys(options.metafile.inputs)
    .filter(isAuthoredMetafileInputPath)
    .map((sourcePath) => normalizeAuthoredMetafileInput(workspaceRoot, sourcePath));
  const admittedYarnVirtualPackageRoots = collectAdmittedYarnVirtualPackageRoots(
    options,
    workspaceRoot,
    authenticSourcePaths,
    packageDemandSourcePaths,
  );
  const unexpectedInputs = [
    ...new Set(
      metafileInputs
        .filter(
          (input) =>
            isAuthoredWorkspaceSource(workspaceRoot, input.sourcePath) &&
            !authenticSourcePaths.has(input.sourcePath) &&
            !isAdmittedYarnVirtualPackageInput(input, admittedYarnVirtualPackageRoots),
        )
        .map((input) => input.sourcePath),
    ),
  ].sort();
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
        ...(incomingEdge ?? {}),
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
    const importerPath = normalizeAuthoredMetafileInput(workspaceRoot, inputPath).sourcePath;
    if (!isAuthoredWorkspaceSource(workspaceRoot, importerPath)) continue;
    for (const imported of input.imports) {
      if (imported.external === true || !isAuthoredMetafileInputPath(imported.path)) continue;
      const importedPath = normalizeAuthoredMetafileInput(workspaceRoot, imported.path).sourcePath;
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
    return (
      normalizeAuthoredMetafileInput(options.workspaceRoot, inputPath).sourcePath === sourcePath
    );
  });
}

interface NormalizedAuthoredMetafileInput {
  readonly sourcePath: string;
  readonly yarnVirtual: boolean;
}

/** Uses the authored filesystem identity while retaining proof that esbuild used a Yarn locator. */
function normalizeAuthoredMetafileInput(
  workspaceRoot: string,
  sourcePath: string,
): NormalizedAuthoredMetafileInput {
  const lexicalPath = path.resolve(workspaceRoot, sourcePath);
  const physicalPath = resolvePreviewYarnVirtualPath(lexicalPath, workspaceRoot);
  return {
    sourcePath: canonicalizeExistingPath(physicalPath ?? lexicalPath),
    yarnVirtual:
      physicalPath !== undefined && path.normalize(physicalPath) !== path.normalize(lexicalPath),
  };
}

/**
 * Admits only virtual workspace packages reached through a frozen package-demand source.
 *
 * A PnP locator is dependency materialization, but its physical target may be authored source in a
 * monorepo. Requiring both the approved importer and a matching package manifest keeps that source
 * distinguishable from an arbitrary authored frontier escape. Relative children remain confined to
 * the proven package root; nested workspace packages require their own bare package edge.
 */
function collectAdmittedYarnVirtualPackageRoots(
  options: VerifyPreviewInspectorBundleFrontierMetafileOptions,
  workspaceRoot: string,
  authenticSourcePaths: ReadonlySet<string>,
  packageDemandSourcePaths: ReadonlySet<string>,
): ReadonlySet<string> {
  const packageRoots = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [inputPath, input] of Object.entries(options.metafile.inputs)) {
      if (!isAuthoredMetafileInputPath(inputPath)) continue;
      const importer = normalizeAuthoredMetafileInput(workspaceRoot, inputPath);
      const authenticPackageDemand =
        authenticSourcePaths.has(importer.sourcePath) &&
        packageDemandSourcePaths.has(importer.sourcePath);
      if (!authenticPackageDemand && !isAdmittedYarnVirtualPackageInput(importer, packageRoots)) {
        continue;
      }
      for (const imported of input.imports) {
        const moduleSpecifier = imported.original;
        if (
          imported.external === true ||
          moduleSpecifier === undefined ||
          !isBarePackageSpecifier(moduleSpecifier) ||
          !isAuthoredMetafileInputPath(imported.path)
        ) {
          continue;
        }
        const target = normalizeAuthoredMetafileInput(workspaceRoot, imported.path);
        if (!target.yarnVirtual) continue;
        const packageRoot = findMatchingWorkspacePackageRoot(
          workspaceRoot,
          target.sourcePath,
          readPackageName(moduleSpecifier),
        );
        if (packageRoot !== undefined && !packageRoots.has(packageRoot)) {
          packageRoots.add(packageRoot);
          changed = true;
        }
      }
    }
  }
  return packageRoots;
}

/** Accepts a virtual input only while its resolved source remains in a proven package boundary. */
function isAdmittedYarnVirtualPackageInput(
  input: NormalizedAuthoredMetafileInput,
  packageRoots: ReadonlySet<string>,
): boolean {
  return (
    input.yarnVirtual &&
    [...packageRoots].some((packageRoot) => isPathInside(packageRoot, input.sourcePath))
  );
}

/** Returns the package portion of a bare specifier without accepting URLs or relative paths. */
function readPackageName(moduleSpecifier: string): string | undefined {
  if (
    moduleSpecifier.startsWith('.') ||
    moduleSpecifier.startsWith('/') ||
    path.isAbsolute(moduleSpecifier) ||
    moduleSpecifier.includes(':')
  ) {
    return undefined;
  }
  const [firstSegment, secondSegment] = moduleSpecifier.split('/');
  if (firstSegment === undefined || firstSegment.length === 0) return undefined;
  if (!moduleSpecifier.startsWith('@')) return firstSegment;
  return secondSegment === undefined || secondSegment.length === 0
    ? undefined
    : `${firstSegment}/${secondSegment}`;
}

/** Reports whether the import specifier names a package rather than a path or URL. */
function isBarePackageSpecifier(moduleSpecifier: string): boolean {
  return readPackageName(moduleSpecifier) !== undefined;
}

/** Finds a physical workspace package whose declared name proves the bare PnP edge. */
function findMatchingWorkspacePackageRoot(
  workspaceRoot: string,
  sourcePath: string,
  packageName: string | undefined,
): string | undefined {
  if (packageName === undefined || !isPathInside(workspaceRoot, sourcePath)) return undefined;
  let directoryPath = path.dirname(sourcePath);
  while (isPathInside(workspaceRoot, directoryPath)) {
    try {
      const manifest = JSON.parse(
        readFileSync(path.join(directoryPath, 'package.json'), 'utf8'),
      ) as {
        readonly name?: unknown;
      };
      if (manifest.name === packageName) return canonicalizeExistingPath(directoryPath);
    } catch {
      // Missing or invalid manifests are not package identity evidence; keep walking to the root.
    }
    if (path.normalize(directoryPath) === path.normalize(workspaceRoot)) break;
    directoryPath = path.dirname(directoryPath);
  }
  return undefined;
}

/** Checks containment without admitting sibling paths that merely share a string prefix. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative.length === 0 ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
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
