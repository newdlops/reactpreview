/**
 * Finds a bounded Next App Router route for a directly selected example/demo source.
 *
 * Example galleries commonly keep leaf components outside `app` and select them through one
 * generated lazy registry. A normal reverse import walk can prove the registry edge, but it cannot
 * discover Next's filesystem-only page/layout ancestry. This adapter follows only the selected
 * auxiliary route anchor and target-shaped dynamic segments, so a gallery with thousands of
 * siblings does not become a package-wide first-paint scan.
 */
import { readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { throwIfPreviewBuildCancelled } from '../../../domain/previewBuildExecution';

const MAXIMUM_ROUTE_DIRECTORIES = 128;
const MAXIMUM_ROUTE_PAGES = 8;
const MAXIMUM_UNMATCHED_DEPTH = 4;
const AUXILIARY_ROUTE_SEGMENT_PATTERN = /^(?:examples?|demos?|playgrounds?|sandboxes?)$/iu;
const NEXT_ROUTE_CONTEXT_PATTERN = /^(?:default|layout|page|template)\.[cm]?[jt]sx?$/iu;
const NEXT_PAGE_PATTERN = /^page\.[cm]?[jt]sx?$/iu;
const SOURCE_EXTENSION_PATTERN = /\.[cm]?[jt]sx?$/iu;

/** Filesystem evidence retained for the ordinary import-graph validator. */
export interface PreviewInspectorAuxiliaryNextAppRouteEvidence {
  /** Selected auxiliary directory; only this subtree may bypass normal tooling-path demotion. */
  readonly auxiliaryRootPath: string;
  /** Candidate page modules that must still prove an import path to the selected leaf. */
  readonly pagePaths: readonly string[];
  /** Candidate pages plus their exact implicit layout/template ancestry. */
  readonly sourcePaths: readonly string[];
}

/** Inputs for one target-affine, convention-only App Router lookup. */
export interface CollectPreviewInspectorAuxiliaryNextAppRouteOptions {
  readonly documentPath: string;
  readonly projectRoot: string;
  readonly signal?: AbortSignal;
}

/** One prioritized route-directory state; suffix offsets model dynamic route consumption. */
interface RouteDirectoryCandidate {
  readonly anchorMatched: boolean;
  readonly appRoot: string;
  readonly depth: number;
  readonly directoryPath: string;
  readonly suffixOffset: number;
}

/**
 * Locates an auxiliary App Router page without enumerating unrelated example/demo leaves.
 *
 * Returned pages remain candidates: the caller accepts one only when its authored imports reach
 * the selected registry/leaf chain. This keeps the filesystem convention useful without inventing
 * a project-specific relationship.
 */
export async function collectPreviewInspectorAuxiliaryNextAppRoute(
  options: CollectPreviewInspectorAuxiliaryNextAppRouteOptions,
): Promise<PreviewInspectorAuxiliaryNextAppRouteEvidence | undefined> {
  const projectRoot = path.resolve(options.projectRoot);
  const documentPath = path.resolve(options.documentPath);
  const selection = findAuxiliarySelection(documentPath, projectRoot);
  if (selection === undefined) return undefined;

  const pending: RouteDirectoryCandidate[] = [
    createRootCandidate(path.join(projectRoot, 'app')),
    createRootCandidate(path.join(projectRoot, 'src', 'app')),
  ];
  const visited = new Set<string>();
  const pagePaths = new Set<string>();
  let visitedDirectories = 0;
  while (
    pending.length > 0 &&
    visitedDirectories < MAXIMUM_ROUTE_DIRECTORIES &&
    pagePaths.size < MAXIMUM_ROUTE_PAGES
  ) {
    throwIfPreviewBuildCancelled(options.signal);
    pending.sort(compareRouteCandidates);
    const current = pending.shift();
    if (current === undefined || visited.has(current.directoryPath)) continue;
    visited.add(current.directoryPath);
    visitedDirectories += 1;
    const entries = await readDirectory(current.directoryPath);
    if (current.anchorMatched && current.suffixOffset >= selection.targetSuffix.length) {
      for (const entry of entries) {
        if (entry.isFile() && NEXT_PAGE_PATTERN.test(entry.name)) {
          pagePaths.add(path.join(current.directoryPath, entry.name));
        }
      }
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !isTraversableRouteDirectory(entry.name)) continue;
      const next = advanceRouteCandidate(current, entry.name, selection);
      if (next !== undefined && !visited.has(next.directoryPath)) pending.push(next);
    }
  }
  if (pagePaths.size === 0) return undefined;

  const sourcePaths = new Set<string>(pagePaths);
  for (const pagePath of pagePaths) {
    const appRoot = [...visited]
      .filter((candidate) => isPathInside(candidate, pagePath))
      .sort((left, right) => left.length - right.length)
      .find(
        (candidate) =>
          candidate === path.join(projectRoot, 'app') ||
          candidate === path.join(projectRoot, 'src', 'app'),
      );
    if (appRoot === undefined) continue;
    for (const directoryPath of collectAncestorDirectories(appRoot, path.dirname(pagePath))) {
      for (const entry of await readDirectory(directoryPath)) {
        if (entry.isFile() && NEXT_ROUTE_CONTEXT_PATTERN.test(entry.name)) {
          sourcePaths.add(path.join(directoryPath, entry.name));
        }
      }
    }
  }
  return Object.freeze({
    auxiliaryRootPath: selection.auxiliaryRootPath,
    pagePaths: Object.freeze([...pagePaths].sort()),
    sourcePaths: Object.freeze([...sourcePaths].sort()),
  });
}

/** Returns the selected auxiliary subtree boundary without accepting a sibling gallery. */
export function findPreviewInspectorSelectedAuxiliaryRoot(
  documentPath: string,
  projectRoot: string,
): string | undefined {
  return findAuxiliarySelection(path.resolve(documentPath), path.resolve(projectRoot))
    ?.auxiliaryRootPath;
}

/** Extracts the route anchor plus filename-shaped values following that anchor. */
function findAuxiliarySelection(
  documentPath: string,
  projectRoot: string,
):
  | {
      readonly auxiliaryRootPath: string;
      readonly routeAnchor: string;
      readonly targetSuffix: readonly string[];
    }
  | undefined {
  const relativePath = path.relative(projectRoot, documentPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return undefined;
  const segments = relativePath.split(path.sep).filter(Boolean);
  const anchorIndex = segments.findIndex((segment) =>
    AUXILIARY_ROUTE_SEGMENT_PATTERN.test(segment),
  );
  if (anchorIndex < 0) return undefined;
  const routeAnchor = segments[anchorIndex];
  if (routeAnchor === undefined) return undefined;
  const suffix = segments.slice(anchorIndex + 1);
  const last = suffix.at(-1);
  if (last !== undefined) suffix[suffix.length - 1] = last.replace(SOURCE_EXTENSION_PATTERN, '');
  return Object.freeze({
    auxiliaryRootPath: path.join(projectRoot, ...segments.slice(0, anchorIndex + 1)),
    routeAnchor,
    targetSuffix: Object.freeze(suffix.filter(Boolean)),
  });
}

/** Creates an unmatched App Router root candidate. Missing roots fail closed on their first read. */
function createRootCandidate(appRoot: string): RouteDirectoryCandidate {
  return Object.freeze({
    anchorMatched: false,
    appRoot,
    depth: 0,
    directoryPath: appRoot,
    suffixOffset: 0,
  });
}

/** Advances through route groups, the auxiliary anchor, and target-shaped static/dynamic segments. */
function advanceRouteCandidate(
  current: RouteDirectoryCandidate,
  directoryName: string,
  selection: {
    readonly routeAnchor: string;
    readonly targetSuffix: readonly string[];
  },
): RouteDirectoryCandidate | undefined {
  const routeGroup = /^\([^/]+\)$/u.test(directoryName);
  if (!current.anchorMatched) {
    if (directoryName === selection.routeAnchor) {
      return freezeChildCandidate(current, directoryName, true, 0);
    }
    if (routeGroup || current.depth < MAXIMUM_UNMATCHED_DEPTH) {
      return freezeChildCandidate(current, directoryName, false, 0);
    }
    return undefined;
  }
  if (routeGroup) {
    return freezeChildCandidate(current, directoryName, true, current.suffixOffset);
  }
  const remaining = selection.targetSuffix.slice(current.suffixOffset);
  if (/^\[\[?\.\.\.[^\]]+\]\]?$/u.test(directoryName)) {
    return freezeChildCandidate(current, directoryName, true, selection.targetSuffix.length);
  }
  if (/^\[[^\]]+\]$/u.test(directoryName) && remaining.length > 0) {
    return freezeChildCandidate(current, directoryName, true, current.suffixOffset + 1);
  }
  if (directoryName === remaining[0]) {
    return freezeChildCandidate(current, directoryName, true, current.suffixOffset + 1);
  }
  return undefined;
}

/** Freezes one child state so traversal queues cannot accidentally mutate route evidence. */
function freezeChildCandidate(
  current: RouteDirectoryCandidate,
  directoryName: string,
  anchorMatched: boolean,
  suffixOffset: number,
): RouteDirectoryCandidate {
  return Object.freeze({
    anchorMatched,
    appRoot: current.appRoot,
    depth: current.depth + 1,
    directoryPath: path.join(current.directoryPath, directoryName),
    suffixOffset,
  });
}

/** Prioritizes a matched anchor and the greatest target-suffix progress before broad siblings. */
function compareRouteCandidates(
  left: RouteDirectoryCandidate,
  right: RouteDirectoryCandidate,
): number {
  return (
    Number(right.anchorMatched) - Number(left.anchorMatched) ||
    right.suffixOffset - left.suffixOffset ||
    left.depth - right.depth ||
    left.directoryPath.localeCompare(right.directoryPath)
  );
}

/** Collects an inclusive root-to-leaf directory chain for exact implicit layout discovery. */
function collectAncestorDirectories(rootPath: string, leafPath: string): readonly string[] {
  const relativePath = path.relative(rootPath, leafPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return Object.freeze([]);
  const directories = [rootPath];
  let current = rootPath;
  for (const segment of relativePath.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    directories.push(current);
  }
  return Object.freeze(directories);
}

/** Keeps normal route groups/dynamic segments while rejecting private/tooling directories. */
function isTraversableRouteDirectory(directoryName: string): boolean {
  return (
    directoryName !== 'node_modules' &&
    !directoryName.startsWith('.') &&
    !directoryName.startsWith('_') &&
    !directoryName.startsWith('@')
  );
}

/** Reads a changing hot-reload directory fail-closed and in deterministic order. */
async function readDirectory(directoryPath: string): Promise<readonly Dirent[]> {
  try {
    return (await readdir(directoryPath, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  } catch {
    return Object.freeze([]);
  }
}

/** Segment-aware containment prevents one package sibling from becoming route evidence. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}
