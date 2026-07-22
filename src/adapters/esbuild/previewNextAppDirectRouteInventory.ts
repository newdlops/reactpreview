/**
 * Collects the small filesystem corridor needed to compose a directly selected Next App route.
 *
 * Fast first paint must not enumerate a whole monorepo merely to find layouts above one page or a
 * nearby page below one selected layout. This adapter stays inside the proven `app`/`src/app`
 * directory, never follows symlinks, and applies hard directory/file caps before returning inert
 * source identities to the existing syntax-only planners.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { throwIfPreviewBuildCancelled } from '../../domain/previewBuildExecution';

const MAXIMUM_DIRECT_ROUTE_DIRECTORIES = 512;
const MAXIMUM_DIRECT_ROUTE_SOURCES = 1_024;
const MAXIMUM_PARALLEL_SLOTS_PER_LAYOUT = 16;
const NEXT_APP_CONTEXT_FILE_PATTERN = /^(?:default|layout|page|template)\.[cm]?[jt]sx?$/u;
const NEXT_APP_PAGE_PATTERN = /^page\.[cm]?[jt]sx?$/u;

/** Inputs supplied from one immutable compiler request. */
export interface CollectPreviewNextAppDirectRouteInventoryOptions {
  /** Dirty editor paths admitted only when they remain below the same App Router root. */
  readonly additionalSourcePaths?: Iterable<string>;
  /** Selected page, layout, or template source. */
  readonly documentPath: string;
  /** Nearest package root used to distinguish `app` and `src/app` from arbitrary nested folders. */
  readonly projectRoot: string;
  /** Cancels a stale bounded directory traversal between filesystem operations. */
  readonly signal?: AbortSignal;
}

/**
 * Returns ancestor shells for a page or a capped route subtree for a selected shell.
 *
 * Page previews perform only one directory read per ancestor. Layout/template previews additionally
 * search their own subtree because Next inserts a descendant page without a JavaScript import.
 * Named-slot `default` files are retained so the page composer can expose neutral slot props.
 */
export async function collectPreviewNextAppDirectRouteInventory(
  options: CollectPreviewNextAppDirectRouteInventoryOptions,
): Promise<readonly string[]> {
  const documentPath = path.resolve(options.documentPath);
  const appRoot = findDirectNextAppRoot(documentPath, options.projectRoot);
  if (appRoot === undefined) return Object.freeze([documentPath]);

  const sources = new Set<string>([documentPath]);
  for (const sourcePath of options.additionalSourcePaths ?? []) {
    if (sources.size >= MAXIMUM_DIRECT_ROUTE_SOURCES) break;
    const normalizedPath = path.resolve(sourcePath);
    if (
      isPathInside(appRoot, normalizedPath) &&
      NEXT_APP_CONTEXT_FILE_PATTERN.test(path.basename(normalizedPath))
    ) {
      sources.add(normalizedPath);
    }
  }

  const documentDirectory = path.dirname(documentPath);
  for (const directoryPath of collectAncestorDirectories(appRoot, documentDirectory)) {
    const childDirectories = await collectRouteFilesInDirectory(
      directoryPath,
      sources,
      options.signal,
    );
    const slotDirectories = childDirectories
      .filter((childPath) => path.basename(childPath).startsWith('@'))
      .slice(0, MAXIMUM_PARALLEL_SLOTS_PER_LAYOUT);
    await Promise.all(
      slotDirectories.map((slotDirectory) =>
        collectRouteFilesInDirectory(slotDirectory, sources, options.signal),
      ),
    );
  }

  if (!NEXT_APP_PAGE_PATTERN.test(path.basename(documentPath))) {
    await collectBoundedRouteSubtree(documentDirectory, sources, options.signal);
  }
  return Object.freeze([...sources].sort());
}

/** Finds only package-root `app` or `src/app`; a nested route segment named app is not a root. */
function findDirectNextAppRoot(documentPath: string, projectRoot: string): string | undefined {
  const root = path.resolve(projectRoot);
  const relativePath = path.relative(root, documentPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return undefined;
  const segments = relativePath.split(path.sep).filter(Boolean);
  const appOffset =
    segments[0] === 'app' ? 0 : segments[0] === 'src' && segments[1] === 'app' ? 1 : -1;
  return appOffset < 0 ? undefined : path.join(root, ...segments.slice(0, appOffset + 1));
}

/** Produces inclusive root-to-leaf directories while retaining the exact App Router boundary. */
function collectAncestorDirectories(appRoot: string, leafDirectory: string): readonly string[] {
  const relativePath = path.relative(appRoot, leafDirectory);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return Object.freeze([]);
  const directories = [appRoot];
  let current = appRoot;
  for (const segment of relativePath.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    directories.push(current);
  }
  return Object.freeze(directories);
}

/** Reads one directory deterministically and keeps only framework route-context source files. */
async function collectRouteFilesInDirectory(
  directoryPath: string,
  sources: Set<string>,
  signal: AbortSignal | undefined,
): Promise<readonly string[]> {
  throwIfPreviewBuildCancelled(signal);
  try {
    const entries = (await readdir(directoryPath, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      if (
        sources.size >= MAXIMUM_DIRECT_ROUTE_SOURCES ||
        !entry.isFile() ||
        !NEXT_APP_CONTEXT_FILE_PATTERN.test(entry.name)
      ) {
        continue;
      }
      sources.add(path.join(directoryPath, entry.name));
    }
    return Object.freeze(
      entries
        .filter((entry) => entry.isDirectory() && isTraversableRouteDirectory(entry.name))
        .slice(0, MAXIMUM_DIRECT_ROUTE_DIRECTORIES)
        .map((entry) => path.join(directoryPath, entry.name)),
    );
  } catch {
    return Object.freeze([]);
  }
}

/** Breadth-first traversal prevents one deep generated branch from starving nearby page leaves. */
async function collectBoundedRouteSubtree(
  rootDirectory: string,
  sources: Set<string>,
  signal: AbortSignal | undefined,
): Promise<void> {
  const pendingDirectories = [rootDirectory];
  let visitedDirectories = 0;
  while (
    pendingDirectories.length > 0 &&
    visitedDirectories < MAXIMUM_DIRECT_ROUTE_DIRECTORIES &&
    sources.size < MAXIMUM_DIRECT_ROUTE_SOURCES
  ) {
    throwIfPreviewBuildCancelled(signal);
    const directoryPath = pendingDirectories.shift();
    if (directoryPath === undefined) break;
    visitedDirectories += 1;
    const children = await collectRouteFilesInDirectory(directoryPath, sources, signal);
    for (const child of children) {
      if (pendingDirectories.length + visitedDirectories >= MAXIMUM_DIRECT_ROUTE_DIRECTORIES) break;
      pendingDirectories.push(child);
    }
  }
}

/** Ignores private/tooling directories while preserving route groups and named parallel slots. */
function isTraversableRouteDirectory(directoryName: string): boolean {
  return (
    directoryName !== 'node_modules' &&
    !directoryName.startsWith('.') &&
    !directoryName.startsWith('_')
  );
}

/** Segment-aware containment prevents sibling path prefixes from entering the route inventory. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relativePath.length === 0 ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== '..' &&
      !path.isAbsolute(relativePath))
  );
}
