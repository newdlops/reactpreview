/**
 * Refines portal-host evidence from the exact module graph that esbuild loaded successfully.
 * Reverse React ownership intentionally omits transitive application imports; the metafile closes
 * that gap without executing project code and supports Yarn PnP virtual workspace identities.
 */
import type { Metafile } from 'esbuild';
import type { PreviewBuildRequest } from '../../domain/preview';
import { collectPreviewBuildDependencies } from './previewBuildResult';
import {
  collectPreviewPortalHostIds,
  type ReadPreviewPortalHostSource,
} from './previewPortalHostDiscovery';
import { resolvePreviewYarnVirtualPath } from './previewYarnVirtualPath';

const MAX_REFINED_PORTAL_HOST_IDS = 64;
const MAX_REACHED_PORTAL_IMPLEMENTATIONS = 192;
const MAX_PORTAL_IMPLEMENTATION_SOURCE_BYTES = 256 * 1024;
const PORTAL_IMPLEMENTATION_PATH_PATTERN =
  /(?:dialog|drawer|modal|overlay|pop-?up|portal|sheet|toast)/iu;
const SOURCE_EXTENSION_PATTERN = /\.[cm]?[jt]sx?$/iu;

/** Inputs from the preliminary static scan, current build plan, and loaded esbuild graph. */
export interface RefinePreviewPortalHostsOptions {
  /** Static host evidence that remains valid independently of the current output split. */
  readonly baselineHostIds: readonly string[];
  /** Host set embedded in the build whose metafile is being inspected. */
  readonly currentHostIds: readonly string[];
  /** Successful esbuild metadata containing every source actually loaded for this page root. */
  readonly metafile: Metafile;
  /** Compiler-cached source reader that never evaluates application modules. */
  readonly readSource: ReadPreviewPortalHostSource;
  /** Original request used to restore relative and private metafile input identities. */
  readonly request: PreviewBuildRequest;
}

/** Exact refinement result used to decide whether the adaptive build needs one final pass. */
export interface RefinedPreviewPortalHosts {
  /** True only when the generated entry must be rebuilt with a different host set. */
  readonly changed: boolean;
  /** Sorted host IDs proven by static preparation or the reached runtime module graph. */
  readonly hostIds: readonly string[];
}

/**
 * Discovers portal roots from real bundle inputs and compares them with the preliminary entry.
 * Yarn virtual inputs are converted to their physical workspace sources before the bounded parser
 * reads them. Discovery remains proof-based: an ID is accepted only beside a real ReactDOM portal.
 *
 * @param options Successful graph metadata and the host evidence already embedded in that graph.
 * @returns Immutable exact IDs plus whether one adaptive rebuild is required.
 */
export async function refinePreviewPortalHostsFromBuild(
  options: RefinePreviewPortalHostsOptions,
): Promise<RefinedPreviewPortalHosts> {
  const physicalDependencies = collectPreviewBuildDependencies(options.request, options.metafile)
    .map((sourcePath) => resolvePreviewYarnVirtualPath(sourcePath, options.request.workspaceRoot))
    .filter((sourcePath): sourcePath is string => sourcePath !== undefined);
  const graphHostIds = await collectReachedPortalImplementationHostIds(
    physicalDependencies,
    options.readSource,
  );
  const hostIds = normalizePreviewPortalHostIds([...options.baselineHostIds, ...graphHostIds]);
  return Object.freeze({
    changed: !haveEqualPreviewPortalHostIds(hostIds, options.currentHostIds),
    hostIds,
  });
}

/**
 * Reads only portal-like reached modules and accepts IDs declared beside their exact portal call.
 * A full build graph may contain thousands of ordinary form IDs. Graph-wide import correlation is
 * useful for the narrow pre-build ownership corridor, but would turn those unrelated IDs into false
 * document hosts here. Requiring the declaration and `react-dom.createPortal` call in one module is
 * the conservative post-build proof used for transitive application-shell packages.
 */
async function collectReachedPortalImplementationHostIds(
  dependencyPaths: readonly string[],
  readSource: ReadPreviewPortalHostSource,
): Promise<readonly string[]> {
  const implementationPaths = [
    ...new Set(
      dependencyPaths.filter(
        (sourcePath) =>
          SOURCE_EXTENSION_PATTERN.test(sourcePath) &&
          PORTAL_IMPLEMENTATION_PATH_PATTERN.test(sourcePath),
      ),
    ),
  ]
    .sort()
    .slice(0, MAX_REACHED_PORTAL_IMPLEMENTATIONS);
  const hostIds = new Set<string>();
  for (let offset = 0; offset < implementationPaths.length; offset += 24) {
    const pathBatch = implementationPaths.slice(offset, offset + 24);
    const sourceBatch = await Promise.all(
      pathBatch.map(async (sourcePath) => ({
        sourcePath,
        sourceText: await readSource(sourcePath, MAX_PORTAL_IMPLEMENTATION_SOURCE_BYTES),
      })),
    );
    for (const { sourcePath, sourceText } of sourceBatch) {
      if (sourceText === undefined) continue;
      for (const hostId of collectPreviewPortalHostIds(sourcePath, sourceText)) {
        hostIds.add(hostId);
        if (hostIds.size >= MAX_REFINED_PORTAL_HOST_IDS) {
          return normalizePreviewPortalHostIds([...hostIds]);
        }
      }
    }
  }
  return normalizePreviewPortalHostIds([...hostIds]);
}

/** Merges cached and current static evidence before the first build of a hot revision. */
export function mergePreviewPortalHostIds(
  ...hostIdGroups: readonly (readonly string[])[]
): readonly string[] {
  return normalizePreviewPortalHostIds(hostIdGroups.flat());
}

/** Creates one stable bounded identity suitable for entry source and adaptive-plan caching. */
function normalizePreviewPortalHostIds(hostIds: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(hostIds)].sort().slice(0, MAX_REFINED_PORTAL_HOST_IDS));
}

/** Compares normalized ID lists without allocating another set for every hot build. */
function haveEqualPreviewPortalHostIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((hostId, index) => hostId === right[index]);
}
