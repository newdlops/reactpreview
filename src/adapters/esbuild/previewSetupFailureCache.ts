/**
 * Caches a recoverable automatic Storybook setup failure until its exact filesystem evidence moves.
 * This prevents every hot reload from paying for the same known-broken optional graph while exact
 * missing-module candidates and setup/config edits still invalidate the fallback automatically.
 */
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { PreviewSourceSnapshot } from '../../domain/preview';
import { throwIfPreviewBuildCancelled } from '../../domain/previewBuildExecution';

const MAX_CACHED_SETUP_FAILURES = 32;

/** Fallback inputs retained after a failed optional setup build. */
export interface PreviewSetupFailurePlan {
  /** Existing and future exact paths that route hot reload and invalidate this decision. */
  readonly dependencyPaths: readonly string[];
  /** Original warning emitted only when the failure is first discovered. */
  readonly diagnosticMessage: string;
  /** Narrow recursive watchers needed to observe a newly created missing module. */
  readonly watchDirectories: readonly string[];
}

/** Filesystem state for one existing or future setup dependency. */
interface PreviewSetupDependencyStamp {
  /** Normalized exact dependency identity. */
  readonly filePath: string;
  /** Last modification time, or `-1` while the candidate does not exist. */
  readonly modifiedAt: number;
  /** File length, or `-1` while the candidate does not exist. */
  readonly size: number;
}

/** Immutable cached plan and the evidence that made its optional setup unusable. */
interface PreviewSetupFailureEntry {
  /** Exact dependency metadata captured immediately after failure. */
  readonly dependencyStamps: readonly PreviewSetupDependencyStamp[];
  /** Fallback publication metadata. */
  readonly plan: PreviewSetupFailurePlan;
  /** Hashes of unsaved dependency overlays used during the failed build. */
  readonly snapshotFingerprints: Readonly<Record<string, string>>;
}

/** Bounded compiler-lifetime cache for trackable automatic setup failures. */
export class PreviewSetupFailureCache {
  private readonly entries = new Map<string, PreviewSetupFailureEntry>();

  /**
   * Returns a fallback only while files and unsaved setup overlays exactly match prior failure.
   *
   * @param cacheKey Stable Storybook setup/project identity.
   * @param snapshots Current dirty workspace source overlays.
   * @param signal Owning build cancellation signal.
   * @returns Prior fallback plan, or `undefined` after any relevant evidence change.
   */
  public async read(
    cacheKey: string,
    snapshots: readonly PreviewSourceSnapshot[],
    signal?: AbortSignal,
  ): Promise<PreviewSetupFailurePlan | undefined> {
    const entry = this.entries.get(cacheKey);
    if (entry === undefined) {
      return undefined;
    }
    const currentStamps = await readDependencyStamps(entry.plan.dependencyPaths, signal);
    const currentSnapshots = createSnapshotFingerprints(entry.plan.dependencyPaths, snapshots);
    if (
      !haveEqualDependencyStamps(entry.dependencyStamps, currentStamps) ||
      !haveEqualFingerprints(entry.snapshotFingerprints, currentSnapshots)
    ) {
      this.entries.delete(cacheKey);
      return undefined;
    }
    this.entries.delete(cacheKey);
    this.entries.set(cacheKey, entry);
    return entry.plan;
  }

  /**
   * Records one trackable setup failure after reading exact existing/missing dependency state.
   *
   * @param cacheKey Stable Storybook setup/project identity.
   * @param plan Dependency, watcher, and diagnostic metadata for setup-free fallback.
   * @param snapshots Current dirty workspace source overlays.
   * @param signal Owning build cancellation signal.
   */
  public async write(
    cacheKey: string,
    plan: PreviewSetupFailurePlan,
    snapshots: readonly PreviewSourceSnapshot[],
    signal?: AbortSignal,
  ): Promise<void> {
    const dependencyPaths = [
      ...new Set(plan.dependencyPaths.map((filePath) => path.normalize(filePath))),
    ].sort();
    const normalizedPlan = Object.freeze({
      ...plan,
      dependencyPaths: Object.freeze(dependencyPaths),
      watchDirectories: Object.freeze(
        [...new Set(plan.watchDirectories.map((filePath) => path.normalize(filePath)))].sort(),
      ),
    });
    const entry = Object.freeze({
      dependencyStamps: await readDependencyStamps(dependencyPaths, signal),
      plan: normalizedPlan,
      snapshotFingerprints: createSnapshotFingerprints(dependencyPaths, snapshots),
    });
    this.entries.delete(cacheKey);
    this.entries.set(cacheKey, entry);
    while (this.entries.size > MAX_CACHED_SETUP_FAILURES) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.entries.delete(oldestKey);
    }
  }

  /** Removes all workspace identities during compiler shutdown. */
  public clear(): void {
    this.entries.clear();
  }
}

/** Reads deterministic file-or-missing metadata for exact fallback dependency candidates. */
async function readDependencyStamps(
  dependencyPaths: readonly string[],
  signal?: AbortSignal,
): Promise<readonly PreviewSetupDependencyStamp[]> {
  throwIfPreviewBuildCancelled(signal);
  const stamps = await Promise.all(
    dependencyPaths.map(async (filePath): Promise<PreviewSetupDependencyStamp> => {
      try {
        const metadata = await stat(filePath);
        return {
          filePath: path.normalize(filePath),
          modifiedAt: metadata.mtimeMs,
          size: metadata.size,
        };
      } catch {
        return { filePath: path.normalize(filePath), modifiedAt: -1, size: -1 };
      }
    }),
  );
  throwIfPreviewBuildCancelled(signal);
  return stamps;
}

/** Hashes only dirty overlays that intersect the optional setup failure boundary. */
function createSnapshotFingerprints(
  dependencyPaths: readonly string[],
  snapshots: readonly PreviewSourceSnapshot[],
): Readonly<Record<string, string>> {
  const dependencySet = new Set(dependencyPaths.map((filePath) => path.normalize(filePath)));
  return Object.fromEntries(
    snapshots
      .filter((snapshot) => dependencySet.has(path.normalize(snapshot.documentPath)))
      .map(
        (snapshot) =>
          [
            path.normalize(snapshot.documentPath),
            createHash('sha256').update(snapshot.sourceText).digest('hex'),
          ] as const,
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

/** Reports whether every ordered filesystem stamp remains identical. */
function haveEqualDependencyStamps(
  previous: readonly PreviewSetupDependencyStamp[],
  current: readonly PreviewSetupDependencyStamp[],
): boolean {
  return (
    previous.length === current.length &&
    previous.every((stamp, index) => {
      const candidate = current[index];
      return (
        stamp.filePath === candidate?.filePath &&
        stamp.modifiedAt === candidate.modifiedAt &&
        stamp.size === candidate.size
      );
    })
  );
}

/** Compares complete path-to-source hash records without retaining editor source text. */
function haveEqualFingerprints(
  previous: Readonly<Record<string, string>>,
  current: Readonly<Record<string, string>>,
): boolean {
  const previousEntries = Object.entries(previous);
  const currentEntries = Object.entries(current);
  return (
    previousEntries.length === currentEntries.length &&
    previousEntries.every(([filePath, fingerprint]) => current[filePath] === fingerprint)
  );
}
