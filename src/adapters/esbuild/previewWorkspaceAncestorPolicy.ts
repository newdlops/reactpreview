/**
 * Decides whether a package-local negative Page Inspector result merits monorepo-wide escalation.
 * A workspace containing only the selected package cannot provide a sibling consumer, so avoiding
 * its repository-wide source scan saves substantial CPU, memory, and filesystem traffic.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024;

/** Minimal inert package manifest fields needed for ancestor-search scope selection. */
interface PreviewWorkspaceManifest {
  /** Dependency maps that can prove the workspace root itself consumes the selected package. */
  readonly dependencies?: Readonly<Record<string, unknown>>;
  /** Optional package name used to match a root-level consumer dependency. */
  readonly name?: string;
  /** npm/yarn workspace declarations in array or object form. */
  readonly workspaces?: readonly string[] | { readonly packages?: readonly string[] };
}

/**
 * Reports whether another package or root consumer can plausibly own the selected component.
 *
 * @param projectRoot Nearest package boundary containing the selected source.
 * @param workspaceRoot VS Code workspace and possible monorepo root.
 * @returns `false` only when bounded manifest evidence proves no sibling/root consumer exists.
 */
export async function shouldEscalatePreviewAncestorSearch(
  projectRoot: string,
  workspaceRoot: string,
): Promise<boolean> {
  if (path.normalize(projectRoot) === path.normalize(workspaceRoot)) {
    return false;
  }
  const [workspaceManifest, projectManifest] = await Promise.all([
    readManifest(workspaceRoot),
    readManifest(projectRoot),
  ]);
  if (workspaceManifest === undefined) {
    return true;
  }
  const projectName = projectManifest?.name;
  if (
    projectName !== undefined &&
    workspaceManifest.dependencies !== undefined &&
    projectName in workspaceManifest.dependencies
  ) {
    return true;
  }
  const workspaceDeclarations = workspaceManifest.workspaces;
  const patterns = isWorkspacePatternObject(workspaceDeclarations)
    ? workspaceDeclarations.packages
    : workspaceDeclarations;
  if (patterns === undefined || patterns.length === 0) {
    return true;
  }
  return patterns.some(
    (pattern) =>
      containsGlobToken(pattern) ||
      path.normalize(path.resolve(workspaceRoot, pattern)) !== path.normalize(projectRoot),
  );
}

/** Reads one bounded JSON manifest without executing package code or surfacing optional failures. */
async function readManifest(packageRoot: string): Promise<PreviewWorkspaceManifest | undefined> {
  try {
    const contents = await readFile(path.join(packageRoot, 'package.json'));
    if (contents.byteLength > MAX_PACKAGE_MANIFEST_BYTES) {
      return undefined;
    }
    const parsed = JSON.parse(contents.toString('utf8')) as unknown;
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Narrows object-form workspace declarations without widening readonly arrays to `any[]`. */
function isWorkspacePatternObject(
  value: PreviewWorkspaceManifest['workspaces'],
): value is { readonly packages?: readonly string[] } {
  return value !== undefined && !Array.isArray(value);
}

/** Detects workspace patterns whose expansion may contain an unknown sibling package. */
function containsGlobToken(pattern: string): boolean {
  return pattern.includes('*') || pattern.includes('?') || pattern.includes('[');
}
