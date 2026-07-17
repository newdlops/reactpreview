/**
 * Finds a small, entry-reachable source slice before the fallback reverse workspace closure.
 * Semantic ReactDOM evidence remains authoritative: filename conventions only choose which inert
 * files to inspect first, and no discovered entry module is imported or evaluated.
 */
import path from 'node:path';
import { throwIfPreviewBuildCancelled } from '../../../domain/previewBuildExecution';
import { canonicalizeExistingPath } from '../../../shared/pathIdentity';
import type { ResolvePreviewRenderGraphModule } from './previewRenderGraphTypes';
import {
  analyzePreviewRenderSource,
  collectPreviewRenderModuleSpecifiers,
  type AnalyzePreviewRenderSource,
  type CollectPreviewRenderModuleSpecifiers,
} from './previewRenderSourceAnalysis';

const MAX_ENTRY_CANDIDATE_FILES = 2_048;
const MAX_FORWARD_IMPORTS_PER_FILE = 512;
const MAX_FORWARD_MODULE_VISITS_PER_ENTRY = 4_096;
const MAX_FORWARD_PATH_DEPTH = 64;
const MAX_CONCURRENT_ENTRY_SOURCE_READS = 32;
const LIKELY_ENTRY_STEM_PATTERN =
  /(?:^|[.-])(?:bootstrap|client|entry|index|init|main|mount|render|renderer|root|start)(?:[.-]|$)/iu;

/** Source reader shared with the planner's snapshot-aware, byte-bounded cache. */
export type ReadPreviewRenderEntrySource = (sourcePath: string) => Promise<string | undefined>;

/** Inputs for semantic entry discovery and bounded forward import traversal. */
export interface SelectPreviewRenderEntrySourcesOptions {
  /** Optional file-granular AST analyzer shared with exact graph construction. */
  readonly analyzeSource?: AnalyzePreviewRenderSource;
  /** Optional file-granular literal import collector shared with reverse selection. */
  readonly collectModuleSpecifiers?: CollectPreviewRenderModuleSpecifiers;
  /** Current source module that every selected entry path must reach. */
  readonly documentPath: string;
  /** Snapshot-aware source reader; project modules are never executed. */
  readonly readSource: ReadPreviewRenderEntrySource;
  /** Exact tsconfig/package resolver used for both relative and alias imports. */
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  /** Cancels stale candidate and forward-import work between bounded asynchronous steps. */
  readonly signal?: AbortSignal;
  /** Package or workspace source inventory already bounded by the caller. */
  readonly sourcePaths: readonly string[];
}

/**
 * Entry-first selection result. `connectedSourcePaths` is absent when no semantic entry reached the
 * target, while `sourceTextByPath` still lets the reverse fallback reuse already-read candidates.
 */
export interface PreviewRenderEntrySourceSelection {
  /** Union of semantic entry-to-target import paths, when at least one was proven. */
  readonly connectedSourcePaths?: readonly string[];
  /** Semantic ReactDOM entry files that reached the current target. */
  readonly entrySourcePaths: readonly string[];
  /** Source text already read while checking candidates and following imports. */
  readonly sourceTextByPath: ReadonlyMap<string, string>;
  /** Whether a candidate, depth, module, or import budget prevented exhaustive traversal. */
  readonly truncated: boolean;
}

/** One best-first traversal item with an authored predecessor for path reconstruction. */
interface ForwardSourceCandidate {
  readonly depth: number;
  readonly score: number;
  readonly sourceIdentity: string;
  readonly sourcePath: string;
}

/**
 * Proves likely entry files by ReactDOM import/call identity, then follows their authored literal
 * imports toward the selected target. Unrelated stories, tests, and feature trees are never read
 * when a semantic entry can reach the target through this bounded forward slice.
 */
export async function selectPreviewRenderEntrySources(
  options: SelectPreviewRenderEntrySourcesOptions,
): Promise<PreviewRenderEntrySourceSelection> {
  throwIfPreviewBuildCancelled(options.signal);
  const analyzeSource = options.analyzeSource ?? analyzePreviewRenderSource;
  const collectModuleSpecifiers =
    options.collectModuleSpecifiers ?? collectPreviewRenderModuleSpecifiers;
  const sourceTextByPath = new Map<string, string>();
  const unavailablePaths = new Set<string>();
  const authoredPathByIdentity = createAuthoredPathIndex(options.sourcePaths);
  const targetIdentity = normalizeEntrySourceIdentity(options.documentPath);
  const targetPath =
    authoredPathByIdentity.get(targetIdentity) ?? path.normalize(options.documentPath);
  authoredPathByIdentity.set(targetIdentity, targetPath);
  const rankedCandidates = [
    ...new Set(options.sourcePaths.map((sourcePath) => path.normalize(sourcePath))),
  ]
    .filter(isLikelyPreviewEntrySourcePath)
    .sort((left, right) => {
      const scoreDifference = scoreEntryCandidatePath(right) - scoreEntryCandidatePath(left);
      return scoreDifference !== 0 ? scoreDifference : left.localeCompare(right);
    });
  let truncated = rankedCandidates.length > MAX_ENTRY_CANDIDATE_FILES;
  const entryCandidates = rankedCandidates.slice(0, MAX_ENTRY_CANDIDATE_FILES);
  const semanticEntries: string[] = [];

  for (let start = 0; start < entryCandidates.length; start += MAX_CONCURRENT_ENTRY_SOURCE_READS) {
    throwIfPreviewBuildCancelled(options.signal);
    const batch = await Promise.all(
      entryCandidates
        .slice(start, start + MAX_CONCURRENT_ENTRY_SOURCE_READS)
        .map(async (sourcePath) => ({
          sourcePath,
          sourceText: await readCachedSource(sourcePath),
        })),
    );
    throwIfPreviewBuildCancelled(options.signal);
    for (const { sourcePath, sourceText } of batch) {
      if (sourceText === undefined || !mayContainSemanticReactEntry(sourceText)) {
        continue;
      }
      if (analyzeSource(sourcePath, sourceText).entryEvidence.length > 0) {
        semanticEntries.push(sourcePath);
      }
    }
  }

  const connectedPaths = new Set<string>();
  const connectedEntries: string[] = [];
  for (const entryPath of semanticEntries) {
    throwIfPreviewBuildCancelled(options.signal);
    const result = await findForwardEntryPath(entryPath);
    truncated ||= result.truncated;
    if (result.path.length === 0) {
      continue;
    }
    connectedEntries.push(entryPath);
    for (const sourcePath of result.path) {
      connectedPaths.add(sourcePath);
    }
  }

  return Object.freeze({
    ...(connectedPaths.size === 0
      ? {}
      : { connectedSourcePaths: Object.freeze([...connectedPaths].sort()) }),
    entrySourcePaths: Object.freeze(connectedEntries.sort()),
    sourceTextByPath,
    truncated,
  });

  /** Reads one authored module once while retaining dirty editor overlays owned by the caller. */
  async function readCachedSource(sourcePath: string): Promise<string | undefined> {
    const normalizedPath = path.normalize(sourcePath);
    const cached = sourceTextByPath.get(normalizedPath);
    if (cached !== undefined) {
      return cached;
    }
    if (unavailablePaths.has(normalizedPath)) {
      return undefined;
    }
    const sourceText = await options.readSource(normalizedPath);
    if (sourceText === undefined) {
      unavailablePaths.add(normalizedPath);
      return undefined;
    }
    sourceTextByPath.set(normalizedPath, sourceText);
    return sourceText;
  }

  /** Finds one deterministic best-first import path without evaluating any imported module. */
  async function findForwardEntryPath(
    entryPath: string,
  ): Promise<{ readonly path: readonly string[]; readonly truncated: boolean }> {
    const entryIdentity = normalizeEntrySourceIdentity(entryPath);
    const pending: ForwardSourceCandidate[] = [
      {
        depth: 0,
        score: scoreForwardSourcePath(entryPath, targetPath),
        sourceIdentity: entryIdentity,
        sourcePath: entryPath,
      },
    ];
    const parentByIdentity = new Map<string, string>();
    const visited = new Set<string>();
    let traversalTruncated = false;

    while (pending.length > 0) {
      throwIfPreviewBuildCancelled(options.signal);
      pending.sort(compareForwardSourceCandidates);
      const current = pending.shift();
      if (current === undefined || visited.has(current.sourceIdentity)) {
        continue;
      }
      if (
        visited.size >= MAX_FORWARD_MODULE_VISITS_PER_ENTRY ||
        current.depth >= MAX_FORWARD_PATH_DEPTH
      ) {
        traversalTruncated = true;
        continue;
      }
      visited.add(current.sourceIdentity);
      if (current.sourceIdentity === targetIdentity) {
        return {
          path: freezeForwardPath(current.sourceIdentity, parentByIdentity, authoredPathByIdentity),
          truncated: traversalTruncated,
        };
      }
      const sourceText = await readCachedSource(current.sourcePath);
      throwIfPreviewBuildCancelled(options.signal);
      if (sourceText === undefined) {
        traversalTruncated = true;
        continue;
      }
      const specifiers = collectModuleSpecifiers(current.sourcePath, sourceText);
      if (specifiers.length > MAX_FORWARD_IMPORTS_PER_FILE) {
        traversalTruncated = true;
      }
      for (const moduleSpecifier of specifiers.slice(0, MAX_FORWARD_IMPORTS_PER_FILE)) {
        const resolvedPath = options.resolveModule(moduleSpecifier, current.sourcePath);
        if (resolvedPath === undefined) {
          continue;
        }
        const childIdentity = normalizeEntrySourceIdentity(resolvedPath);
        const childPath = authoredPathByIdentity.get(childIdentity);
        if (childPath === undefined || visited.has(childIdentity)) {
          continue;
        }
        if (!parentByIdentity.has(childIdentity)) {
          parentByIdentity.set(childIdentity, current.sourceIdentity);
        }
        if (childIdentity === targetIdentity) {
          return {
            path: freezeForwardPath(childIdentity, parentByIdentity, authoredPathByIdentity),
            truncated: traversalTruncated,
          };
        }
        pending.push({
          depth: current.depth + 1,
          score: scoreForwardSourcePath(childPath, targetPath),
          sourceIdentity: childIdentity,
          sourcePath: childPath,
        });
      }
    }
    return { path: Object.freeze([]), truncated: traversalTruncated };
  }
}

/** Indexes normal and canonical file identities so symlink and macOS private paths converge. */
function createAuthoredPathIndex(sourcePaths: readonly string[]): Map<string, string> {
  const authoredPathByIdentity = new Map<string, string>();
  for (const sourcePath of sourcePaths) {
    const normalizedPath = path.normalize(sourcePath);
    authoredPathByIdentity.set(normalizeEntrySourceIdentity(normalizedPath), normalizedPath);
  }
  return authoredPathByIdentity;
}

/** Uses broad filename conventions only as a cheap candidate filter; semantic evidence decides. */
function isLikelyPreviewEntrySourcePath(sourcePath: string): boolean {
  const stem = path.basename(sourcePath).replace(/(?:\.d)?\.[cm]?[jt]sx?$/iu, '');
  return LIKELY_ENTRY_STEM_PATTERN.test(stem);
}

/** Prioritizes shallow authored source entries and demotes fixtures without excluding them. */
function scoreEntryCandidatePath(sourcePath: string): number {
  const normalized = sourcePath.replaceAll('\\', '/').toLowerCase();
  const stem = path.basename(normalized).replace(/(?:\.d)?\.[cm]?[jt]sx?$/iu, '');
  let score = /^(?:index|main)$/u.test(stem) ? 300 : 200;
  if (/\/src\/(?:[^/]+)$/u.test(normalized)) {
    score += 200;
  }
  if (/(?:__tests__|\.test\.|\.spec\.|\.stories\.|\/fixtures?\/)/u.test(normalized)) {
    score -= 500;
  }
  return score - normalized.split('/').length;
}

/** Cheap package gate avoids parsing ordinary index/barrel modules; the AST proves the exact API. */
function mayContainSemanticReactEntry(sourceText: string): boolean {
  return sourceText.includes('react-dom');
}

/** Target-near paths win the best-first queue without claiming semantic correctness from names. */
function scoreForwardSourcePath(sourcePath: string, targetPath: string): number {
  const sourceParts = sourcePath.replaceAll('\\', '/').split('/');
  const targetParts = targetPath.replaceAll('\\', '/').split('/');
  let sharedPrefixLength = 0;
  while (
    sourceParts[sharedPrefixLength] !== undefined &&
    sourceParts[sharedPrefixLength] === targetParts[sharedPrefixLength]
  ) {
    sharedPrefixLength += 1;
  }
  const targetStem = path.basename(targetPath).replace(/(?:\.d)?\.[cm]?[jt]sx?$/iu, '');
  return sharedPrefixLength * 100 + (path.basename(sourcePath).startsWith(targetStem) ? 10_000 : 0);
}

/** Higher target affinity and then shallower/path order are processed first. */
function compareForwardSourceCandidates(
  left: ForwardSourceCandidate,
  right: ForwardSourceCandidate,
): number {
  const scoreDifference = right.score - left.score;
  if (scoreDifference !== 0) {
    return scoreDifference;
  }
  const depthDifference = left.depth - right.depth;
  return depthDifference !== 0 ? depthDifference : left.sourcePath.localeCompare(right.sourcePath);
}

/** Reconstructs entry-to-target authored modules from one inert import predecessor chain. */
function freezeForwardPath(
  targetIdentity: string,
  parentByIdentity: ReadonlyMap<string, string>,
  authoredPathByIdentity: ReadonlyMap<string, string>,
): readonly string[] {
  const reversedPaths: string[] = [];
  const visited = new Set<string>();
  let currentIdentity: string | undefined = targetIdentity;
  while (currentIdentity !== undefined && !visited.has(currentIdentity)) {
    visited.add(currentIdentity);
    const sourcePath = authoredPathByIdentity.get(currentIdentity);
    if (sourcePath !== undefined) {
      reversedPaths.push(sourcePath);
    }
    currentIdentity = parentByIdentity.get(currentIdentity);
  }
  return Object.freeze(reversedPaths.reverse());
}

/** Canonical extensionless identity shared with exact resolver output and authored inventory paths. */
function normalizeEntrySourceIdentity(sourcePath: string): string {
  return path
    .normalize(canonicalizeExistingPath(sourcePath))
    .replace(/(?:\.d)?\.[cm]?[jt]sx?$/iu, '');
}
