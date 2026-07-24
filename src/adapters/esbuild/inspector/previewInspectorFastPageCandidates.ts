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
  const targetSegments = relativeSegments(normalizedRoot, documentPath);
  return Object.freeze(
    sourcePaths
      .filter((sourcePath) => isLikelyPageConsumer(sourcePath, normalizedRoot))
      .sort((left, right) => {
        const scoreDifference =
          scorePageConsumer(right, normalizedRoot, targetSegments) -
          scorePageConsumer(left, normalizedRoot, targetSegments);
        return scoreDifference !== 0 ? scoreDifference : left.localeCompare(right);
      }),
  );
}

/** Uses path conventions only to avoid eagerly reading ordinary helpers and tooling fixtures. */
function isLikelyPageConsumer(sourcePath: string, projectRoot: string): boolean {
  if (!SOURCE_FILE_PATTERN.test(sourcePath) || !isPathInside(projectRoot, sourcePath)) return false;
  const segments = relativeSegments(projectRoot, sourcePath);
  if (segments.some((segment) => TOOLING_DIRECTORY_PATTERN.test(segment))) return false;
  return (
    PAGE_SHELL_FILE_PATTERN.test(path.basename(sourcePath)) ||
    segments.slice(0, -1).some((segment) => PAGE_DIRECTORY_PATTERN.test(segment))
  );
}

/** Favors the selected feature and explicit page naming while mildly penalizing distant depth. */
function scorePageConsumer(
  sourcePath: string,
  projectRoot: string,
  targetSegments: readonly string[],
): number {
  const candidateSegments = relativeSegments(projectRoot, sourcePath);
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
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}
