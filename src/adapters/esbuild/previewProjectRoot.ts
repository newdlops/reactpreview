/**
 * Locates the nearest package boundary for project conventions such as a Vite-style public folder.
 * The resolver reads only package-file metadata, never executes configuration, and never climbs
 * above the trusted VS Code workspace used as the broader module-resolution boundary.
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Finds the closest ancestor with `package.json`, falling back to the selected workspace root.
 *
 * @param documentPath Absolute preview target path inside the workspace.
 * @param workspaceRoot Trusted VS Code workspace folder that bounds the upward search.
 * @returns Nearest package directory or the normalized workspace root when none is present.
 */
export async function findPreviewProjectRoot(
  documentPath: string,
  workspaceRoot: string,
): Promise<string> {
  const normalizedWorkspaceRoot = path.resolve(workspaceRoot);
  let candidateDirectory = path.dirname(path.resolve(documentPath));
  if (!isPathInside(normalizedWorkspaceRoot, candidateDirectory)) {
    return normalizedWorkspaceRoot;
  }

  while (isPathInside(normalizedWorkspaceRoot, candidateDirectory)) {
    if (await isRegularFile(path.join(candidateDirectory, 'package.json'))) {
      return candidateDirectory;
    }
    if (candidateDirectory === normalizedWorkspaceRoot) {
      break;
    }
    candidateDirectory = path.dirname(candidateDirectory);
  }
  return normalizedWorkspaceRoot;
}

/** Reports whether one absolute directory is equal to or below the workspace boundary. */
function isPathInside(workspaceRoot: string, candidatePath: string): boolean {
  const relativePath = path.relative(workspaceRoot, candidatePath);
  return (
    relativePath.length === 0 || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
}

/** Reads package metadata existence without surfacing normal missing-file cases. */
async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { readonly code?: unknown }).code === 'ENOENT'
    ) {
      return false;
    }
    throw error;
  }
}
