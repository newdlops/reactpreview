/**
 * Creates canonical source-path identities for a bounded authored inventory with one realpath call.
 *
 * Project inventory enumeration excludes symbolic-link directory entries, so every listed file
 * shares the same lexical-to-canonical prefix mapping. Resolving each file's parent independently
 * caused thousands of synchronous filesystem calls in large monorepos. Canonicalizing the common
 * inventory root once preserves `/var` → `/private/var` style identities without that cold-start
 * cost. A path outside the captured inventory safely falls back to the shared exact canonicalizer.
 */
import path from 'node:path';
import { canonicalizeExistingPath } from '../../../shared/pathIdentity';

const MAX_EXACT_SMALL_INVENTORY_PATHS = 256;

/** Function that maps one authored path to its canonical, normalized inventory identity. */
export type PreviewRenderCanonicalPathMapper = (sourcePath: string) => string;

/**
 * Builds a lexical-prefix canonicalizer for one immutable source inventory.
 *
 * @param sourcePaths Absolute authored source paths selected by the package/workspace inventory.
 * @returns Mapper that avoids additional filesystem work for paths inside their common root.
 */
export function createPreviewRenderCanonicalPathMapper(
  sourcePaths: readonly string[],
): PreviewRenderCanonicalPathMapper {
  const normalizedPaths = sourcePaths.map((sourcePath) => path.normalize(sourcePath));
  /*
   * Small direct-call fixtures and hand-authored inventories may contain nested symlink aliases
   * that package enumeration would normally skip. Preserve exact behavior there; the optimization
   * matters only for the thousands of files that make synchronous per-directory realpath costly.
   */
  if (normalizedPaths.length <= MAX_EXACT_SMALL_INVENTORY_PATHS) {
    const canonicalPathBySourcePath = new Map<string, string>();
    return (sourcePath: string): string => {
      const normalizedPath = path.normalize(sourcePath);
      let canonicalPath = canonicalPathBySourcePath.get(normalizedPath);
      if (canonicalPath === undefined) {
        canonicalPath = canonicalizeExistingPath(normalizedPath);
        canonicalPathBySourcePath.set(normalizedPath, canonicalPath);
      }
      return canonicalPath;
    };
  }
  const commonRoot = findPreviewRenderCommonDirectory(normalizedPaths);
  if (commonRoot === undefined) return canonicalizeExistingPath;
  const canonicalRoot = canonicalizeExistingPath(commonRoot);
  return (sourcePath: string): string => {
    const normalizedPath = path.normalize(sourcePath);
    const relativePath = path.relative(commonRoot, normalizedPath);
    if (
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      return canonicalizeExistingPath(normalizedPath);
    }
    return path.normalize(path.join(canonicalRoot, relativePath));
  };
}

/** Finds the deepest directory containing every authored source without touching the filesystem. */
function findPreviewRenderCommonDirectory(normalizedPaths: readonly string[]): string | undefined {
  const firstPath = normalizedPaths[0];
  if (firstPath === undefined || !path.isAbsolute(firstPath)) return undefined;
  let candidate = path.dirname(firstPath);
  for (const sourcePath of normalizedPaths.slice(1)) {
    if (!path.isAbsolute(sourcePath)) return undefined;
    while (!isPreviewRenderPathInside(candidate, sourcePath)) {
      const parent = path.dirname(candidate);
      if (parent === candidate) return parent;
      candidate = parent;
    }
  }
  return candidate;
}

/** Tests lexical containment while rejecting sibling-prefix lookalikes. */
function isPreviewRenderPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}
