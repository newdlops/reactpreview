/**
 * Performs the bounded entry-side half of fast Page Inspector corridor discovery.
 *
 * A breadth-first walk is optimal only when every import edge is equally useful. Large React
 * applications frequently have wide registries several levels above the selected component, so a
 * strict BFS can spend its complete file budget on shallow sibling branches before it reaches the
 * already-known target-side reverse closure. This module retains the same hard budgets while using
 * a bounded A*-style priority: authored graph depth is the travelled cost and filesystem distance
 * to the reverse closure is the conservative heuristic. Shared path segments only break equal-cost
 * ties; they never invent an import relationship.
 */
import path from 'node:path';
import { throwIfPreviewBuildCancelled } from '../../../domain/previewBuildExecution';

/** One application-entry seed whose runtime mounting evidence was proven from source syntax. */
export interface PreviewInspectorFastForwardEntry {
  /** True when the source contains an analyzed ReactDOM render/create-root entry. */
  readonly semanticEntry: boolean;
  /** Absolute authored source path. */
  readonly sourcePath: string;
}

/** Bounded child expansion supplied by the caller's alias-aware source resolver. */
export interface PreviewInspectorFastForwardChildren {
  /** Resolved authored child paths in deterministic source-affinity order. */
  readonly childPaths: readonly string[];
  /** True when the caller omitted additional children to enforce its own fanout budget. */
  readonly truncated: boolean;
}

/** Inputs kept independent of esbuild so this graph search remains deterministic and testable. */
export interface FindPreviewInspectorFastForwardMeetingOptions {
  /** Selected source used only as a target-affinity tie breaker. */
  readonly documentPath: string;
  /** Semantic and conventional application entry seeds. */
  readonly entries: readonly PreviewInspectorFastForwardEntry[];
  /** Resolves and bounds one source module's authored children. */
  readonly getChildren: (sourcePath: string) => Promise<PreviewInspectorFastForwardChildren>;
  /** Maximum graph depth retained from any entry. */
  readonly maximumDepth: number;
  /** Maximum unique files read before yielding to background enrichment. */
  readonly maximumFiles: number;
  /** Target-side owner-to-child relation used to finish the joined corridor. */
  readonly reverseChildByOwner: ReadonlyMap<string, string>;
  /** Already-proven target-side closure. */
  readonly reversePaths: ReadonlySet<string>;
  /** Cancels stale editor revisions between source reads. */
  readonly signal?: AbortSignal;
  /** Trusted workspace boundary used to calculate portable path distance. */
  readonly workspaceRoot: string;
}

/** Successful bounded meeting plus an honest indication that some frontier was deferred. */
export interface PreviewInspectorFastForwardMeeting {
  /** Entry-to-target import corridor in authored order. */
  readonly importPath: readonly string[];
  /** True only when the winning root contains semantic ReactDOM entry evidence. */
  readonly semanticEntry: boolean;
  /** True when a depth, fanout, or file budget deferred reachable alternatives. */
  readonly truncated: boolean;
}

/** Cached priority values avoid repeating path calculations during heap comparisons. */
interface ForwardPriority {
  readonly depth: number;
  readonly estimatedCost: number;
  readonly exactReverseMatch: boolean;
  readonly semanticEntry: boolean;
  readonly sharedNamedSegments: number;
  readonly sharedPrefixSegments: number;
  readonly sourcePath: string;
}

/** One queued graph node retaining its exact winning path for A*-ordered reconstruction. */
interface ForwardCandidate extends ForwardPriority {
  readonly forwardPath: readonly string[];
}

/** Precomputed reverse-side paths used to rank each new candidate exactly once. */
interface ReverseAffinityIndex {
  readonly documentTokens: ReadonlySet<string>;
  /** Shortest reverse directory below each portable ancestor prefix. */
  readonly minimumReverseDepthByPrefix: ReadonlyMap<string, number>;
  readonly reversePaths: ReadonlySet<string>;
}

/**
 * Finds the most target-affine bounded entry-to-reverse meeting.
 *
 * The heuristic is admissible only as a filesystem estimate, not as a claim about graph distance,
 * so correctness still comes exclusively from resolved child edges. Semantic entries remain ahead
 * of filename-only seeds, and exact reverse matches always terminate immediately when popped.
 */
export async function findPreviewInspectorFastForwardMeeting(
  options: FindPreviewInspectorFastForwardMeetingOptions,
): Promise<PreviewInspectorFastForwardMeeting | undefined> {
  const affinity = createReverseAffinityIndex(options);
  const pending = new ForwardCandidateHeap();
  const pendingByPath = new Map<string, ForwardCandidate>();
  const visited = new Set<string>();
  let truncated = false;

  /** Keeps only the strongest deferred path to one module while stale heap entries remain harmless. */
  const enqueue = (candidate: ForwardCandidate): void => {
    const existing = pendingByPath.get(candidate.sourcePath);
    if (existing !== undefined && compareCandidates(existing, candidate) <= 0) return;
    pendingByPath.set(candidate.sourcePath, candidate);
    pending.push(candidate);
  };

  for (const entry of options.entries) {
    enqueue(
      createCandidate({
        affinity,
        depth: 0,
        forwardPath: Object.freeze([entry.sourcePath]),
        semanticEntry: entry.semanticEntry,
        sourcePath: entry.sourcePath,
        workspaceRoot: options.workspaceRoot,
      }),
    );
  }

  while (pending.size > 0 && visited.size < options.maximumFiles) {
    throwIfPreviewBuildCancelled(options.signal);
    const current = pending.pop();
    if (
      current === undefined ||
      pendingByPath.get(current.sourcePath) !== current ||
      visited.has(current.sourcePath)
    ) {
      continue;
    }
    pendingByPath.delete(current.sourcePath);
    visited.add(current.sourcePath);
    if (options.reversePaths.has(current.sourcePath)) {
      return Object.freeze({
        importPath: Object.freeze(
          joinForwardAndReversePaths(current.forwardPath, options.reverseChildByOwner),
        ),
        semanticEntry: current.semanticEntry,
        truncated,
      });
    }
    if (current.depth >= options.maximumDepth) {
      truncated = true;
      continue;
    }

    const children = await options.getChildren(current.sourcePath);
    truncated ||= children.truncated;
    for (const childPath of children.childPaths) {
      if (visited.has(childPath) || current.forwardPath.includes(childPath)) continue;
      enqueue(
        createCandidate({
          affinity,
          depth: current.depth + 1,
          forwardPath: Object.freeze([...current.forwardPath, childPath]),
          semanticEntry: current.semanticEntry,
          sourcePath: childPath,
          workspaceRoot: options.workspaceRoot,
        }),
      );
    }
  }
  if (pending.size > 0) truncated = true;
  return undefined;
}

/** Builds the immutable target-side data shared by every candidate score. */
function createReverseAffinityIndex(
  options: Pick<
    FindPreviewInspectorFastForwardMeetingOptions,
    'documentPath' | 'reversePaths' | 'workspaceRoot'
  >,
): ReverseAffinityIndex {
  const minimumReverseDepthByPrefix = new Map<string, number>();
  for (const sourcePath of options.reversePaths) {
    const segments = relativeDirectorySegments(options.workspaceRoot, sourcePath);
    for (let length = 0; length <= segments.length; length += 1) {
      const prefix = encodePathPrefix(segments, length);
      const previousDepth = minimumReverseDepthByPrefix.get(prefix);
      if (previousDepth === undefined || segments.length < previousDepth) {
        minimumReverseDepthByPrefix.set(prefix, segments.length);
      }
    }
  }
  return Object.freeze({
    documentTokens: new Set(tokenizeRelativePath(options.workspaceRoot, options.documentPath)),
    minimumReverseDepthByPrefix,
    reversePaths: new Set(
      [...options.reversePaths].map((sourcePath) => path.normalize(sourcePath)),
    ),
  });
}

/** Calculates one A*-style score without reading or resolving any additional source. */
function createCandidate(options: {
  readonly affinity: ReverseAffinityIndex;
  readonly depth: number;
  readonly forwardPath: readonly string[];
  readonly semanticEntry: boolean;
  readonly sourcePath: string;
  readonly workspaceRoot: string;
}): ForwardCandidate {
  const sourcePath = path.normalize(options.sourcePath);
  const candidateDirectory = relativeDirectorySegments(options.workspaceRoot, sourcePath);
  let minimumDistance = Number.MAX_SAFE_INTEGER;
  let sharedPrefixSegments = 0;
  for (let length = 0; length <= candidateDirectory.length; length += 1) {
    const reverseDepth = options.affinity.minimumReverseDepthByPrefix.get(
      encodePathPrefix(candidateDirectory, length),
    );
    if (reverseDepth === undefined) continue;
    sharedPrefixSegments = length;
    minimumDistance = Math.min(
      minimumDistance,
      candidateDirectory.length + reverseDepth - length * 2,
    );
  }
  if (!Number.isFinite(minimumDistance) || minimumDistance === Number.MAX_SAFE_INTEGER) {
    minimumDistance = 0;
  }
  const candidateTokens = tokenizeRelativePath(options.workspaceRoot, sourcePath);
  const sharedNamedSegments = candidateTokens.filter((token) =>
    options.affinity.documentTokens.has(token),
  ).length;
  return Object.freeze({
    depth: options.depth,
    estimatedCost: options.depth + minimumDistance,
    exactReverseMatch: options.affinity.reversePaths.has(sourcePath),
    forwardPath: options.forwardPath,
    semanticEntry: options.semanticEntry,
    sharedNamedSegments,
    sharedPrefixSegments,
    sourcePath,
  });
}

/** Reconstructs the proven entry half, then appends the cached reverse owner chain. */
function joinForwardAndReversePaths(
  forwardPath: readonly string[],
  childByOwner: ReadonlyMap<string, string>,
): readonly string[] {
  const result = [...forwardPath];
  let current = result.at(-1);
  if (current === undefined) return result;
  let child = childByOwner.get(current);
  while (child !== undefined && !result.includes(child)) {
    result.push(child);
    current = child;
    child = childByOwner.get(current);
  }
  return result;
}

/** Splits a workspace-relative directory into case-insensitive portable segments. */
function relativeDirectorySegments(workspaceRoot: string, sourcePath: string): readonly string[] {
  return normalizePortablePath(path.relative(workspaceRoot, path.dirname(sourcePath)))
    .split('/')
    .filter(Boolean);
}

/** Extracts stable path words without relying on project-specific directory names. */
function tokenizeRelativePath(workspaceRoot: string, sourcePath: string): readonly string[] {
  return normalizePortablePath(path.relative(workspaceRoot, sourcePath))
    .replace(/\.[^.]+$/u, '')
    .replace(/([a-z\d])([A-Z])/gu, '$1-$2')
    .toLowerCase()
    .split(/[^a-z\d]+/u)
    .filter((token) => token.length > 1);
}

/** Encodes one portable ancestor without allowing adjacent segment strings to collide. */
function encodePathPrefix(segments: readonly string[], length: number): string {
  return segments.slice(0, length).join('\u0000');
}

/** Lower values leave the min-heap first; lexical order keeps equal fixtures reproducible. */
function compareCandidates(left: ForwardCandidate, right: ForwardCandidate): number {
  return (
    Number(right.semanticEntry) - Number(left.semanticEntry) ||
    Number(right.exactReverseMatch) - Number(left.exactReverseMatch) ||
    left.estimatedCost - right.estimatedCost ||
    right.sharedPrefixSegments - left.sharedPrefixSegments ||
    right.sharedNamedSegments - left.sharedNamedSegments ||
    left.depth - right.depth ||
    left.sourcePath.localeCompare(right.sourcePath)
  );
}

/** Small binary min-heap avoids sorting the complete frontier after every graph expansion. */
class ForwardCandidateHeap {
  readonly #items: ForwardCandidate[] = [];

  /** Number of deferred candidates, including duplicate paths not yet popped. */
  get size(): number {
    return this.#items.length;
  }

  /** Adds one candidate and restores heap order toward its parents. */
  push(candidate: ForwardCandidate): void {
    this.#items.push(candidate);
    let index = this.#items.length - 1;
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const parent = this.#items[parentIndex];
      if (parent === undefined || compareCandidates(parent, candidate) <= 0) break;
      this.#items[index] = parent;
      index = parentIndex;
    }
    this.#items[index] = candidate;
  }

  /** Removes the highest-priority candidate while preserving a deterministic heap. */
  pop(): ForwardCandidate | undefined {
    const first = this.#items[0];
    const last = this.#items.pop();
    if (first === undefined || last === undefined || this.#items.length === 0) return first;
    let index = 0;
    for (;;) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      const left = this.#items[leftIndex];
      const right = this.#items[rightIndex];
      if (left === undefined) break;
      const nextIndex =
        right !== undefined && compareCandidates(right, left) < 0 ? rightIndex : leftIndex;
      const next = this.#items[nextIndex];
      if (next === undefined || compareCandidates(last, next) <= 0) break;
      this.#items[index] = next;
      index = nextIndex;
    }
    this.#items[index] = last;
    return first;
  }
}

/** Converts platform separators before any path comparison. */
function normalizePortablePath(sourcePath: string): string {
  return sourcePath.replaceAll(path.sep, '/').toLowerCase();
}
