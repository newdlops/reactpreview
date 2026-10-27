/**
 * Selects page-shaped source identities for fast shared-component reverse discovery.
 *
 * The package inventory contains paths only, so this module can rank likely consumers without
 * parsing unrelated application code. Every returned file remains merely a candidate: the fast
 * corridor's exact resolver and semantic import analysis must still prove a path to the selected
 * component before that page is published.
 */
import path from 'node:path';

const SOURCE_FILE_PATTERN = /\.[cm]?[jt]sx?$/iu;
const PAGE_SHELL_FILE_PATTERN =
  /(?:^|[-_.])(?:apps?|layouts?|pages?|routes?|routers?|screens?|shells?|templates?|views?)(?:[-_.]|$)/iu;
const PAGE_DIRECTORY_PATTERN =
  /^(?:app|layouts?|pages?|routes?|routers?|screens?|shells?|templates?|views?)$/iu;
const TOOLING_DIRECTORY_PATTERN =
  /^(?:__tests__|tests?|stories?|storybook|examples?|demos?|fixtures?|mocks?)$/iu;
const TOOLING_SOURCE_FILE_PATTERN = /\.(?:test|spec|stories?|story)\.[cm]?[jt]sx?$/iu;
const MAXIMUM_AFFINITY_PREFIX_PATHS = 192;
const MAXIMUM_REVERSE_AFFINITY_PREFIX_PATHS = 1_536;
const MAXIMUM_REVERSE_PROBE_PATHS = 2_048;
const REVERSE_PROBES_PER_PAGE_CONSUMER = 1;
const STRUCTURAL_PATH_TOKENS = new Set([
  'app',
  'apps',
  'common',
  'component',
  'components',
  'index',
  'layout',
  'layouts',
  'package',
  'packages',
  'page',
  'pages',
  'route',
  'routes',
  'screen',
  'screens',
  'shell',
  'shells',
  'src',
  'template',
  'templates',
  'view',
  'views',
]);

/** Request-owned path facts reused while several reverse pivots inspect the same finite inventory. */
export interface PreviewInspectorFastPageCandidateIndex {
  /** Returns the existing page-affinity order for one target, without filesystem observations. */
  readonly selectPageConsumers: (documentPath: string) => readonly string[];
  /** Returns the existing diversified reverse order for each target-side pivot. */
  readonly selectReverseProbes: (documentPath: string) => readonly string[];
}

/**
 * Shares normalized path arithmetic and token sets across one corridor's page and reverse searches.
 * The copied inventory owns no source text or filesystem facts and is released with the request.
 */
export function createPreviewInspectorFastPageCandidateIndex(
  sourcePaths: readonly string[],
  projectRoot: string,
): PreviewInspectorFastPageCandidateIndex {
  const inventory = [...sourcePaths];
  const normalizedRoot = path.resolve(projectRoot);
  const readPathFacts = createPathFactsReader(normalizedRoot);
  let pageConsumers: readonly string[] | undefined;
  let reverseProbes: readonly string[] | undefined;
  let reverseCollationRanks: ReadonlyMap<string, number> | undefined;
  return Object.freeze({
    selectPageConsumers: (documentPath: string) => {
      pageConsumers ??= inventory.filter((sourcePath) =>
        isLikelyPageConsumer(sourcePath, readPathFacts),
      );
      return rankPageConsumerPaths(pageConsumers, normalizedRoot, documentPath, readPathFacts);
    },
    selectReverseProbes: (documentPath: string) => {
      reverseProbes ??= inventory
        .map((sourcePath) => path.normalize(sourcePath))
        .filter((sourcePath) => isProbeEligibleSource(sourcePath, readPathFacts));
      reverseCollationRanks ??= createPathCollationRanks(reverseProbes);
      return rankReverseProbePaths(
        reverseProbes,
        normalizedRoot,
        documentPath,
        readPathFacts,
        reverseCollationRanks,
      );
    },
  });
}

/**
 * Returns likely authored pages in target-affinity order.
 *
 * Shared components often have consumers in several feature folders. Common package path prefixes
 * therefore outrank unrelated pages, while deterministic lexical ordering keeps cache and test
 * results stable when two candidates have equal evidence.
 */
export function selectPreviewInspectorFastPageConsumerPaths(
  sourcePaths: readonly string[],
  projectRoot: string,
  documentPath: string,
): readonly string[] {
  const normalizedRoot = path.resolve(projectRoot);
  const readPathFacts = createPathFactsReader(normalizedRoot);
  return selectPageConsumerPaths(sourcePaths, normalizedRoot, documentPath, readPathFacts);
}

/** Applies the existing page ranking to the exact caller spellings with request-owned path facts. */
function selectPageConsumerPaths(
  sourcePaths: readonly string[],
  normalizedRoot: string,
  documentPath: string,
  readPathFacts: ReadPathFacts,
): readonly string[] {
  return rankPageConsumerPaths(
    sourcePaths.filter((sourcePath) => isLikelyPageConsumer(sourcePath, readPathFacts)),
    normalizedRoot,
    documentPath,
    readPathFacts,
  );
}

/** Scores admitted path-only consumers for the current target without repeating eligibility. */
function rankPageConsumerPaths(
  sourcePaths: readonly string[],
  normalizedRoot: string,
  documentPath: string,
  readPathFacts: ReadPathFacts,
): readonly string[] {
  const targetSegments = relativeSegments(normalizedRoot, documentPath);
  const rankedPaths = sourcePaths
    .map((sourcePath) => ({
      score: scorePageConsumer(sourcePath, readPathFacts, targetSegments),
      sourcePath,
    }))
    .sort(
      (left, right) => right.score - left.score || left.sourcePath.localeCompare(right.sourcePath),
    )
    .map((candidate) => candidate.sourcePath);
  return diversifyPageConsumerPaths(rankedPaths, readPathFacts);
}

/**
 * Reserves a deterministic target-affine tranche for non-JSX value consumers before page shells.
 *
 * A component can be carried through a column, route, plugin, or other configuration value before
 * an enclosing page renders it. The inventory is still path-only: exact resolution and semantic
 * value-flow analysis in the corridor decide whether a probe is an authentic owner.
 */
export function selectPreviewInspectorFastReverseProbePaths(
  sourcePaths: readonly string[],
  projectRoot: string,
  documentPath: string,
): readonly string[] {
  const normalizedRoot = path.resolve(projectRoot);
  const readPathFacts = createPathFactsReader(normalizedRoot);
  return selectReverseProbePaths(
    sourcePaths.map((sourcePath) => path.normalize(sourcePath)),
    normalizedRoot,
    documentPath,
    readPathFacts,
  );
}

/** Re-ranks the same normalized inventory for each pivot without repeating path and token parsing. */
function selectReverseProbePaths(
  sourcePaths: readonly string[],
  normalizedRoot: string,
  documentPath: string,
  readPathFacts: ReadPathFacts,
): readonly string[] {
  return rankReverseProbePaths(
    sourcePaths.filter((sourcePath) => isProbeEligibleSource(sourcePath, readPathFacts)),
    normalizedRoot,
    documentPath,
    readPathFacts,
  );
}

/** Recomputes pivot-specific scores and target exclusion over the request's admitted paths. */
function rankReverseProbePaths(
  sourcePaths: readonly string[],
  normalizedRoot: string,
  documentPath: string,
  readPathFacts: ReadPathFacts,
  collationRanks?: ReadonlyMap<string, number>,
): readonly string[] {
  const targetSegments = relativeSegments(normalizedRoot, documentPath);
  const targetTokens = collectMeaningfulPathTokens(targetSegments);
  const normalizedDocumentPath = path.normalize(documentPath);
  const rankedPaths = sourcePaths
    .filter((sourcePath) => sourcePath !== normalizedDocumentPath)
    .map((sourcePath) => ({
      score: scoreReverseProbe(sourcePath, readPathFacts, targetSegments, targetTokens),
      sourcePath,
      collationRank: collationRanks?.get(sourcePath),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        (left.collationRank !== undefined && right.collationRank !== undefined
          ? left.collationRank - right.collationRank
          : left.sourcePath.localeCompare(right.sourcePath)),
    )
    .map((candidate) => candidate.sourcePath);
  return Object.freeze(
    diversifyReverseProbePaths(rankedPaths, readPathFacts).slice(0, MAXIMUM_REVERSE_PROBE_PATHS),
  );
}

/**
 * Computes native locale ordering once while preserving equal-collation stable-sort ties.
 * @param sourcePaths Immutable admitted reverse paths for one request.
 * @returns Dense order groups; distinct spellings that compare equal receive the same rank.
 */
function createPathCollationRanks(sourcePaths: readonly string[]): ReadonlyMap<string, number> {
  const orderedPaths = [...new Set(sourcePaths)].sort((left, right) => left.localeCompare(right));
  const ranks = new Map<string, number>();
  let rank = 0;
  let previous: string | undefined;
  for (const sourcePath of orderedPaths) {
    if (previous !== undefined && previous.localeCompare(sourcePath) !== 0) rank += 1;
    ranks.set(sourcePath, rank);
    previous = sourcePath;
  }
  return ranks;
}

/**
 * Interleaves selected pages with target-affine probes inside the existing aggregate ceiling.
 *
 * Alternating slots give target owners and their selected page consumers equal access to the
 * aggregate ceiling. Exhausted tranches donate their remaining capacity, and normalized first
 * occurrence wins so ordering and deduplication stay deterministic.
 */
export function schedulePreviewInspectorFastReverseCandidatePaths(
  reverseProbePaths: readonly string[],
  pageConsumerPaths: readonly string[],
): readonly string[] {
  const pages = [...new Set(pageConsumerPaths.map((sourcePath) => path.normalize(sourcePath)))];
  const probes = [...new Set(reverseProbePaths.map((sourcePath) => path.normalize(sourcePath)))];
  const emitted = new Set<string>();
  const scheduled: string[] = [];
  const emit = (sourcePath: string | undefined): void => {
    if (
      sourcePath === undefined ||
      emitted.has(sourcePath) ||
      scheduled.length >= MAXIMUM_REVERSE_PROBE_PATHS
    ) {
      return;
    }
    emitted.add(sourcePath);
    scheduled.push(sourcePath);
  };
  let pageIndex = 0;
  let probeIndex = 0;
  while (
    scheduled.length < MAXIMUM_REVERSE_PROBE_PATHS &&
    (pageIndex < pages.length || probeIndex < probes.length)
  ) {
    for (
      let offset = 0;
      offset < REVERSE_PROBES_PER_PAGE_CONSUMER &&
      probeIndex < probes.length &&
      scheduled.length < MAXIMUM_REVERSE_PROBE_PATHS;
      offset += 1
    ) {
      const sourcePath = probes[probeIndex];
      probeIndex += 1;
      emit(sourcePath);
    }
    const pagePath = pages[pageIndex];
    if (pagePath !== undefined) pageIndex += 1;
    emit(pagePath);
  }
  return Object.freeze(scheduled);
}

/** Round-robins target-affine paths across generic feature roots after the strongest prefix. */
function diversifyReverseProbePaths(
  rankedPaths: readonly string[],
  readPathFacts: ReadPathFacts,
): readonly string[] {
  const affinityPrefix = rankedPaths.slice(0, MAXIMUM_REVERSE_AFFINITY_PREFIX_PATHS);
  if (affinityPrefix.length === rankedPaths.length) return Object.freeze([...affinityPrefix]);
  const pathsByFeature = new Map<string, string[]>();
  for (const sourcePath of rankedPaths.slice(affinityPrefix.length)) {
    const featureKey = reverseProbeFeatureKey(readPathFacts, sourcePath);
    const featurePaths = pathsByFeature.get(featureKey) ?? [];
    featurePaths.push(sourcePath);
    pathsByFeature.set(featureKey, featurePaths);
  }
  const diversifiedPaths: string[] = [...affinityPrefix];
  for (let index = 0; diversifiedPaths.length < rankedPaths.length; index += 1) {
    let appended = false;
    for (const featurePaths of pathsByFeature.values()) {
      const sourcePath = featurePaths[index];
      if (sourcePath === undefined) continue;
      diversifiedPaths.push(sourcePath);
      appended = true;
    }
    if (!appended) break;
  }
  return Object.freeze(diversifiedPaths);
}

/** Uses a product-feature root so one large application namespace cannot starve its siblings. */
function reverseProbeFeatureKey(readPathFacts: ReadPathFacts, sourcePath: string): string {
  const facts = readPathFacts(sourcePath);
  if (facts.reverseFeatureKey !== undefined) return facts.reverseFeatureKey;
  const segments = facts.segments;
  const sourceOffset = segments[0]?.toLowerCase() === 'src' ? 1 : 0;
  const directorySegments = segments.slice(sourceOffset, -1);
  const pageDirectoryIndex = directorySegments.findIndex((segment) =>
    PAGE_DIRECTORY_PATTERN.test(segment),
  );
  let featureDepth = Math.min(3, directorySegments.length);
  if (pageDirectoryIndex >= 0) {
    featureDepth = Math.min(directorySegments.length, pageDirectoryIndex + 2);
    if (/^(?:component|components)$/iu.test(directorySegments[featureDepth] ?? '')) {
      featureDepth += 1;
    }
  }
  const key = directorySegments
    .slice(0, featureDepth)
    .map((segment) => segment.toLowerCase())
    .join('/');
  facts.reverseFeatureKey = key;
  return key;
}

/** Includes authored TS/JS consumers regardless of whether their own file contains JSX. */
function isProbeEligibleSource(sourcePath: string, readPathFacts: ReadPathFacts): boolean {
  if (
    !SOURCE_FILE_PATTERN.test(sourcePath) ||
    TOOLING_SOURCE_FILE_PATTERN.test(path.basename(sourcePath)) ||
    !isRelativePathInsideRoot(readPathFacts(sourcePath).relativePath)
  ) {
    return false;
  }
  return !readPathFacts(sourcePath).segments.some((segment) =>
    TOOLING_DIRECTORY_PATTERN.test(segment),
  );
}

/** Scores meaningful target stem and path-token overlap anywhere in an authored source identity. */
function scoreReverseProbe(
  sourcePath: string,
  readPathFacts: ReadPathFacts,
  targetSegments: readonly string[],
  targetTokens: ReadonlySet<string>,
): number {
  const facts = readPathFacts(sourcePath);
  const candidateSegments = facts.segments;
  const candidateTokens = (facts.tokens ??= collectMeaningfulPathTokens(candidateSegments));
  let sharedPrefixLength = 0;
  while (
    sharedPrefixLength < candidateSegments.length &&
    sharedPrefixLength < targetSegments.length &&
    candidateSegments[sharedPrefixLength] === targetSegments[sharedPrefixLength]
  ) {
    sharedPrefixLength += 1;
  }
  let sharedTokens = 0;
  for (const token of candidateTokens) {
    if (targetTokens.has(token)) sharedTokens += 1;
  }
  return (
    sharedTokens * 400 +
    sharedPrefixLength * 100 +
    Math.abs(candidateSegments.length - targetSegments.length)
  );
}

/** Drops separators, extensions, and short connective fragments from path affinity evidence. */
function collectMeaningfulPathTokens(segments: readonly string[]): ReadonlySet<string> {
  const tokens = new Set<string>();
  for (const segment of segments) {
    for (const token of segment.toLowerCase().split(/[^a-z0-9]+/iu)) {
      if (token.length >= 3 && !STRUCTURAL_PATH_TOKENS.has(token)) tokens.add(token);
    }
  }
  return tokens;
}

/**
 * Retains a strong target-affinity prefix, then round-robins feature roots.
 *
 * A shared component may be consumed by `staff/` or `legal/` while living below `common/`. Pure
 * prefix sorting lets thousands of unrelated `common/pages` exhaust the reverse-read budget before
 * that real consumer is inspected. Feature diversity changes ordering only: every candidate still
 * requires exact resolver and semantic JSX evidence before it can enter the authored corridor.
 */
function diversifyPageConsumerPaths(
  rankedPaths: readonly string[],
  readPathFacts: ReadPathFacts,
): readonly string[] {
  const affinityPrefix = rankedPaths.slice(0, MAXIMUM_AFFINITY_PREFIX_PATHS);
  if (affinityPrefix.length === rankedPaths.length) return Object.freeze([...affinityPrefix]);
  const pathsByFeature = new Map<string, string[]>();
  for (const sourcePath of rankedPaths.slice(affinityPrefix.length)) {
    const featureKey = pageConsumerFeatureKey(readPathFacts, sourcePath);
    const featurePaths = pathsByFeature.get(featureKey) ?? [];
    featurePaths.push(sourcePath);
    pathsByFeature.set(featureKey, featurePaths);
  }
  const diversifiedPaths = [...affinityPrefix];
  for (let index = 0; diversifiedPaths.length < rankedPaths.length; index += 1) {
    let appended = false;
    for (const featurePaths of pathsByFeature.values()) {
      const sourcePath = featurePaths[index];
      if (sourcePath === undefined) continue;
      diversifiedPaths.push(sourcePath);
      appended = true;
    }
    if (!appended) break;
  }
  return Object.freeze(diversifiedPaths);
}

/** Groups common packages and product feature roots without encoding application-specific names. */
function pageConsumerFeatureKey(readPathFacts: ReadPathFacts, sourcePath: string): string {
  const facts = readPathFacts(sourcePath);
  if (facts.pageFeatureKey !== undefined) return facts.pageFeatureKey;
  const segments = facts.segments;
  const sourceOffset = segments[0]?.toLowerCase() === 'src' ? 1 : 0;
  const namespace = segments[sourceOffset]?.toLowerCase() ?? '';
  const featureDepth =
    namespace === 'common' && segments[sourceOffset + 1]?.toLowerCase() === 'packages' ? 3 : 2;
  const key = segments
    .slice(sourceOffset, sourceOffset + featureDepth)
    .map((segment) => segment.toLowerCase())
    .join('/');
  facts.pageFeatureKey = key;
  return key;
}

/** Uses path conventions only to avoid eagerly reading ordinary helpers and tooling fixtures. */
function isLikelyPageConsumer(sourcePath: string, readPathFacts: ReadPathFacts): boolean {
  if (
    !SOURCE_FILE_PATTERN.test(sourcePath) ||
    TOOLING_SOURCE_FILE_PATTERN.test(path.basename(sourcePath)) ||
    !isRelativePathInsideRoot(readPathFacts(sourcePath).relativePath)
  ) {
    return false;
  }
  const segments = readPathFacts(sourcePath).segments;
  if (segments.some((segment) => TOOLING_DIRECTORY_PATTERN.test(segment))) return false;
  return (
    PAGE_SHELL_FILE_PATTERN.test(path.basename(sourcePath)) ||
    segments.slice(0, -1).some((segment) => PAGE_DIRECTORY_PATTERN.test(segment))
  );
}

/** Favors the selected feature and explicit page naming while mildly penalizing distant depth. */
function scorePageConsumer(
  sourcePath: string,
  readPathFacts: ReadPathFacts,
  targetSegments: readonly string[],
): number {
  const candidateSegments = readPathFacts(sourcePath).segments;
  let sharedPrefixLength = 0;
  while (
    sharedPrefixLength < candidateSegments.length &&
    sharedPrefixLength < targetSegments.length &&
    candidateSegments[sharedPrefixLength] === targetSegments[sharedPrefixLength]
  ) {
    sharedPrefixLength += 1;
  }
  return (
    sharedPrefixLength * 1_000 +
    Number(PAGE_SHELL_FILE_PATTERN.test(path.basename(sourcePath))) * 300 -
    Math.abs(candidateSegments.length - targetSegments.length) * 10
  );
}

/** Produces portable relative segments for deterministic semantic path comparisons. */
function relativeSegments(projectRoot: string, sourcePath: string): readonly string[] {
  return path
    .relative(path.resolve(projectRoot), path.resolve(sourcePath))
    .split(path.sep)
    .filter((segment) => segment.length > 0);
}

/** Segment-aware containment prevents sibling package prefixes from entering the inventory. */
function isRelativePathInsideRoot(relativePath: string): boolean {
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

/** Relative path evidence kept only for one candidate selection or its enclosing corridor request. */
interface PathFacts {
  /** Target-independent grouping retained only after page diversification needs it. */
  pageFeatureKey?: string;
  /** Target-independent grouping retained only after reverse diversification needs it. */
  reverseFeatureKey?: string;
  /** Native relative path retaining the exact containment semantics. */
  readonly relativePath: string;
  /** Unchanged path components used by scoring and diversification. */
  readonly segments: readonly string[];
  /** Meaningful lexical tokens reused when target-side pivots change. */
  tokens?: ReadonlySet<string>;
}
/** Path evidence reader owned by one synchronous candidate selection. */
type ReadPathFacts = (sourcePath: string) => PathFacts;

/**
 * Reuses path arithmetic within one selection or request without retaining cross-build state.
 *
 * @param projectRoot Absolute normalized root selected by the public entry point.
 * @returns Reader sharing containment and scoring evidence for each exact input path.
 * @throws TypeError when a caller supplies a non-string path, matching native path operations.
 */
function createPathFactsReader(projectRoot: string): ReadPathFacts {
  const entries = new Map<string, PathFacts>();
  return (sourcePath) => {
    const cached = entries.get(sourcePath);
    if (cached !== undefined) return cached;
    const relativePath = path.relative(projectRoot, path.resolve(sourcePath));
    const segments = relativePath.split(path.sep).filter((segment) => segment.length > 0);
    const facts = {
      relativePath,
      segments,
    };
    entries.set(sourcePath, facts);
    return facts;
  };
}
