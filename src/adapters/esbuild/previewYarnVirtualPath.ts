/**
 * Converts Yarn Plug'n'Play virtual workspace paths back to their authored filesystem locations.
 * Yarn uses these synthetic identities to distinguish peer-dependency instances, but the paths are
 * not necessarily materialized on disk and therefore cannot be passed directly to Node file APIs.
 */
import path from 'node:path';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';

const MAXIMUM_VIRTUAL_PATH_DEPTH = 128;
const MAXIMUM_NESTED_VIRTUAL_PATHS = 8;
const VIRTUAL_DIRECTORY_NAMES = new Set(['$$virtual', '__virtual__']);

/**
 * Resolves a Yarn virtual path without loading or executing the workspace's `.pnp.cjs` file.
 *
 * Yarn encodes a virtual path as `<base>/__virtual__/<locator>/<depth>/<subpath>`. Its physical
 * target starts at the parent of `__virtual__`, walks up `depth` directories, and appends the
 * remaining subpath. Ordinary paths are returned normalized. Malformed virtual paths and virtual
 * paths that would escape the trusted workspace return `undefined`.
 *
 * @param sourcePath Absolute module path returned by TypeScript or esbuild.
 * @param workspaceRoot Trusted VS Code workspace containing the virtual directory.
 * @returns Normalized physical path, or `undefined` when the virtual identity is unsafe or invalid.
 */
export function resolvePreviewYarnVirtualPath(
  sourcePath: string,
  workspaceRoot: string,
): string | undefined {
  let candidatePath = path.resolve(sourcePath);
  for (let iteration = 0; iteration < MAXIMUM_NESTED_VIRTUAL_PATHS; iteration += 1) {
    const resolved = resolveOneVirtualPath(candidatePath);
    if (resolved === candidatePath) {
      return candidatePath;
    }
    if (
      resolved === undefined ||
      !isPathInside(canonicalizeExistingPath(workspaceRoot), canonicalizeExistingPath(resolved))
    ) {
      return undefined;
    }
    candidatePath = resolved;
  }
  return containsVirtualDirectory(candidatePath) ? undefined : candidatePath;
}

/**
 * Recreates a resolved workspace child's Yarn virtual identity from its virtual importer.
 * Keeping this identity lets PnP bind peer dependencies from the original consuming application,
 * while `resolvePreviewYarnVirtualPath` still supplies a readable disk path to the source loader.
 *
 * @param virtualImporter Synthetic importer identity returned by Yarn-aware esbuild resolution.
 * @param physicalImporter Readable physical source corresponding to the virtual importer.
 * @param physicalTarget Normally resolved relative workspace child.
 * @param workspaceRoot Trusted boundary containing virtual and physical paths.
 * @returns Equivalent virtual child identity, or `undefined` if the mapping cannot be proven exact.
 */
export function createPreviewYarnVirtualSiblingPath(
  virtualImporter: string,
  physicalImporter: string,
  physicalTarget: string,
  workspaceRoot: string,
): string | undefined {
  const normalizedVirtualImporter = path.resolve(virtualImporter);
  const resolvedImporter = resolvePreviewYarnVirtualPath(normalizedVirtualImporter, workspaceRoot);
  if (
    resolvedImporter === undefined ||
    path.normalize(resolvedImporter) === path.normalize(normalizedVirtualImporter)
  ) {
    return undefined;
  }
  const canonicalPhysicalImporter = canonicalizeExistingPath(physicalImporter);
  const canonicalPhysicalTarget = canonicalizeExistingPath(physicalTarget);
  const relativeTarget = path.relative(
    path.dirname(canonicalPhysicalImporter),
    canonicalPhysicalTarget,
  );
  const virtualTarget = path.resolve(path.dirname(normalizedVirtualImporter), relativeTarget);
  const resolvedVirtualTarget = resolvePreviewYarnVirtualPath(virtualTarget, workspaceRoot);
  return resolvedVirtualTarget !== undefined &&
    canonicalizeExistingPath(resolvedVirtualTarget) === canonicalPhysicalTarget
    ? virtualTarget
    : undefined;
}

/** Resolves one innermost Yarn virtual marker while preserving ordinary paths verbatim. */
function resolveOneVirtualPath(sourcePath: string): string | undefined {
  const parsed = path.parse(sourcePath);
  const segments = sourcePath.slice(parsed.root.length).split(path.sep);
  const markerIndex = segments.findIndex((segment) => VIRTUAL_DIRECTORY_NAMES.has(segment));
  if (markerIndex < 0) {
    return sourcePath;
  }
  const depthText = segments[markerIndex + 2];
  if (
    segments[markerIndex + 1] === undefined ||
    depthText === undefined ||
    !/^\d+$/u.test(depthText)
  ) {
    return undefined;
  }
  const depth = Number(depthText);
  if (!Number.isSafeInteger(depth) || depth > MAXIMUM_VIRTUAL_PATH_DEPTH) {
    return undefined;
  }

  const virtualRoot = path.join(parsed.root, ...segments.slice(0, markerIndex + 1));
  let targetRoot = path.dirname(virtualRoot);
  for (let index = 0; index < depth; index += 1) {
    targetRoot = path.dirname(targetRoot);
  }
  return path.resolve(targetRoot, ...segments.slice(markerIndex + 3));
}

/** Reports whether another Yarn virtual identity remains after one resolution pass. */
function containsVirtualDirectory(sourcePath: string): boolean {
  return sourcePath.split(path.sep).some((segment) => VIRTUAL_DIRECTORY_NAMES.has(segment));
}

/** Checks containment without accepting sibling paths that merely share a string prefix. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}
