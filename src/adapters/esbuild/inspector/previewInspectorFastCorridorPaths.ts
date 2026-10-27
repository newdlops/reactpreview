/** Scores and confines inert source paths considered by fast-corridor discovery. */
import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { analyzePreviewRenderSource } from '../renderGraph/previewRenderSourceAnalysis';
import {
  ENTRY_FILE_PATTERN,
  PAGE_SHELL_FILE_PATTERN,
  SOURCE_FILE_PATTERN,
} from './previewInspectorFastCorridorModel';
import { isPreviewInspectorFastAuxiliarySourcePath } from './previewInspectorFastResolvedImports';

/** Requires authored router construction evidence before import fanout can trim a path. */
export function hasBroadRouteRegistrySyntax(sourceText: string): boolean {
  return (
    /<Route(?:\s|>)/u.test(sourceText) &&
    /\b(?:createBrowserRouter|createHashRouter|createMemoryRouter|createRoutesFromElements|RouterProvider)\b/u.test(
      sourceText,
    )
  );
}

/** Chooses a page-like reverse owner, or the strongest local JSX consumer when no page exists. */
export function selectProvisionalReversePath(
  documentPath: string,
  childByOwner: ReadonlyMap<string, string>,
  pageProvenancePaths: ReadonlySet<string>,
): readonly string[] {
  const candidates = [...childByOwner.keys()]
    .map((candidate) => {
      const pathToTarget = [candidate];
      let current = candidate;
      let child = childByOwner.get(current);
      while (child !== undefined && !pathToTarget.includes(child)) {
        pathToTarget.push(child);
        current = child;
        child = childByOwner.get(current);
      }
      return Object.freeze({ candidate, pathToTarget: Object.freeze(pathToTarget) });
    })
    .filter((candidate) => candidate.pathToTarget.at(-1) === documentPath)
    .sort((left, right) => {
      const provenanceDifference =
        Number(pageProvenancePaths.has(right.candidate)) -
        Number(pageProvenancePaths.has(left.candidate));
      if (provenanceDifference !== 0) return provenanceDifference;
      const depthDifference = right.pathToTarget.length - left.pathToTarget.length;
      return depthDifference !== 0
        ? depthDifference
        : scoreProvisionalRoot(right.candidate) - scoreProvisionalRoot(left.candidate) ||
            left.candidate.localeCompare(right.candidate);
    });
  for (const { pathToTarget } of candidates) {
    return pathToTarget;
  }
  return Object.freeze([documentPath]);
}

/** Lists direct source ancestors without walking unrelated descendant package trees. */
export function collectSourceAncestorDirectories(
  startDirectory: string,
  projectRoot: string,
): readonly string[] {
  const directories: string[] = [];
  let current = path.normalize(startDirectory);
  const boundary = path.normalize(projectRoot);
  while (isPathInside(boundary, current)) {
    directories.push(current);
    if (current === boundary) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return Object.freeze(directories);
}

/** Semantic entry evidence comes from exact import/call analysis, never from filenames alone. */
export function hasSemanticReactEntry(sourcePath: string, sourceText: string): boolean {
  return (
    sourceText.includes('react-dom') &&
    analyzePreviewRenderSource(sourcePath, sourceText).entryEvidence.length > 0
  );
}

/** Keeps direct page composition broad enough for headers/sidebar components but excludes helpers. */
export function isPageCompositionSource(sourcePath: string): boolean {
  const portablePath = normalizePortablePath(sourcePath);
  return (
    /\.[cm]?[jt]sx$/iu.test(sourcePath) ||
    PAGE_SHELL_FILE_PATTERN.test(path.basename(sourcePath)) ||
    /(?:^|\/)(?:app|components?|layouts?|pages?|routes?|screens?|shells?|views?)(?:\/|$)/iu.test(
      portablePath,
    )
  );
}

/** Allows bounded legacy recursion only through explicitly named page/layout/shell composition. */
export function isExpandablePageShellSource(sourcePath: string): boolean {
  const portablePath = normalizePortablePath(sourcePath);
  return (
    PAGE_SHELL_FILE_PATTERN.test(path.basename(sourcePath)) ||
    /(?:^|\/)(?:layouts?|shells?)(?:\/|$)/u.test(portablePath)
  );
}

/** Conventional filenames only seed traversal; later resolved imports prove every relationship. */
export function isLikelyEntryPath(sourcePath: string, projectRoot: string): boolean {
  return (
    ENTRY_FILE_PATTERN.test(path.basename(sourcePath)) &&
    !isPreviewInspectorFastAuxiliarySourcePath(sourcePath, projectRoot)
  );
}

/** Entry ranking favors semantic conventions at shallow source roots and demotes auxiliaries. */
export function scoreEntryPath(sourcePath: string): number {
  const portablePath = normalizePortablePath(sourcePath);
  const fileName = path.basename(sourcePath).toLowerCase();
  let score = /^(?:main|index)\.[cm]?[jt]sx?$/u.test(fileName) ? 500 : 300;
  if (/\/src\/[^/]+$/u.test(portablePath)) score += 300;
  if (fileName.startsWith('app.')) score += 100;
  return score - portablePath.split('/').length;
}

/** Reverse candidates prioritize page/layout/barrel owners near the active frontier. */
export function scoreReverseCandidate(candidatePath: string, frontierPath: string): number {
  const fileName = path.basename(candidatePath);
  let score = PAGE_SHELL_FILE_PATTERN.test(fileName) ? 500 : 0;
  if (/^index\.[cm]?[jt]sx?$/iu.test(fileName)) score += 300;
  if (path.dirname(candidatePath) === path.dirname(frontierPath)) score += 100;
  return score - path.relative(path.dirname(frontierPath), candidatePath).split(path.sep).length;
}

/** Provisional roots prefer explicit page shells, then owners farther above the target directory. */
export function scoreProvisionalRoot(sourcePath: string): number {
  return (
    (PAGE_SHELL_FILE_PATTERN.test(path.basename(sourcePath)) ? 1_000 : 0) -
    normalizePortablePath(sourcePath).split('/').length
  );
}

/** Rejects generated/build directories before any source read occurs. */
export function isTraversableDirectory(directoryName: string): boolean {
  return (
    directoryName !== 'node_modules' &&
    !directoryName.startsWith('.') &&
    !/^(?:__tests__|tests?|stories?|storybook|examples?|demos?|fixtures?|mocks?|generated|dist|build|coverage)$/iu.test(
      directoryName,
    )
  );
}

/** Reads one directory fail-closed because disappearing hot-reload paths are ordinary. */
export async function readDirectory(directoryPath: string): Promise<readonly Dirent[]> {
  try {
    return await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Confines traversal to authored JS/TS source below the trusted workspace. */
export function isProjectSourcePath(sourcePath: string, workspaceRoot: string): boolean {
  const portablePath = normalizePortableRelativePath(workspaceRoot, sourcePath);
  return (
    SOURCE_FILE_PATTERN.test(sourcePath) &&
    isPathInside(workspaceRoot, sourcePath) &&
    !/(?:^|\/)(?:node_modules|\.yarn|\.pnpm)(?:\/|$)/u.test(portablePath)
  );
}

/**
 * Keeps normal tooling demotion while admitting only the selected example/demo subtree.
 *
 * The exact subtree is safe because every retained relationship still requires a resolved import
 * edge to the selected leaf. Sibling galleries remain excluded and cannot consume first-paint
 * traversal budgets.
 */
export function isAdmittedSourcePath(
  sourcePath: string,
  workspaceRoot: string,
  selectedAuxiliaryRoot: string | undefined,
): boolean {
  return (
    !isPreviewInspectorFastAuxiliarySourcePath(sourcePath, workspaceRoot) ||
    (selectedAuxiliaryRoot !== undefined &&
      isPathInside(path.resolve(selectedAuxiliaryRoot), path.resolve(sourcePath)))
  );
}

/** Segment-aware containment prevents sibling path prefixes from crossing a trusted boundary. */
export function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

/** Normalizes matching-only paths without changing their filesystem identity. */
export function normalizePortablePath(sourcePath: string): string {
  return sourcePath.replaceAll('\\', '/').toLowerCase();
}

/** Produces one workspace-relative path for semantic segment tests. */
export function normalizePortableRelativePath(rootPath: string, sourcePath: string): string {
  return normalizePortablePath(path.relative(rootPath, sourcePath));
}
