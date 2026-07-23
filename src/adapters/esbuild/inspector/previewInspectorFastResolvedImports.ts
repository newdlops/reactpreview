/**
 * Resolves and target-ranks literal project imports for bounded fast page-corridor discovery.
 *
 * The coarse resolver is intentionally separate from semantic React/export analysis: it limits
 * resolver calls before an AST parse is considered, rejects dependencies outside the authored
 * workspace, and preserves the literal specifier required by the export-aware second stage.
 */
import path from 'node:path';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph/previewRenderGraphTypes';
import { collectPreviewRenderModuleSpecifiers } from '../renderGraph/previewRenderSourceAnalysis';

const MAXIMUM_TARGET_AFFINE_IMPORTS = 96;
const MAXIMUM_AFFINITY_MATCHED_IMPORTS = 24;
const SOURCE_FILE_PATTERN = /\.[cm]?[jt]sx?$/iu;
const AUXILIARY_PATH_PATTERN =
  /(?:^|\/)(?:__tests__|tests?|stories?|storybook|examples?|demos?|fixtures?|mocks?|playgrounds?|sandboxes?|generated|dist|build|coverage)(?:\/|$)|\.(?:stories?|spec|test)\.[cm]?[jt]sx?$/iu;
const AUXILIARY_FILE_NAME_PATTERN =
  /(?:^|[-_.])(?:demo|example|fixture|mock|playground|sandbox|story|test)(?:[-_.]|$)/iu;

/** One resolved import edge retained without TypeScript nodes. */
export interface PreviewInspectorFastResolvedImportEdge {
  /** Absolute authored module reached by the literal specifier. */
  readonly childPath: string;
  /** Literal request retained for semantic binding/export analysis. */
  readonly moduleSpecifier: string;
  /** Absolute source containing the import. */
  readonly ownerPath: string;
}

/**
 * Resolves a bounded target-affine import list without evaluating the owner or imported modules.
 *
 * Matching target suffixes are resolved first so generated registries cannot consume the complete
 * first-paint budget. When no affinity exists, the ordinary deterministic lexical slice remains
 * broad enough for application shell discovery.
 */
export function collectPreviewInspectorFastResolvedImports(
  ownerPath: string,
  sourceText: string,
  resolveModule: ResolvePreviewRenderGraphModule,
  workspaceRoot: string,
  options: {
    readonly preferredPath?: string;
    readonly preferredPaths?: readonly string[];
    readonly selectedAuxiliaryRoot?: string;
  } = {},
): readonly PreviewInspectorFastResolvedImportEdge[] {
  const edges: PreviewInspectorFastResolvedImportEdge[] = [];
  const seen = new Set<string>();
  const preferredPaths =
    options.preferredPaths ?? (options.preferredPath === undefined ? [] : [options.preferredPath]);
  const rankedSpecifiers = [...collectPreviewRenderModuleSpecifiers(ownerPath, sourceText)]
    .map((specifier) => ({
      score: Math.max(
        0,
        ...preferredPaths.map((preferredPath) =>
          scoreModuleSpecifierAffinity(preferredPath, specifier),
        ),
      ),
      specifier,
    }))
    .sort(
      (left, right) => right.score - left.score || left.specifier.localeCompare(right.specifier),
    );
  const highestAffinity = rankedSpecifiers[0]?.score ?? 0;
  const maximumSpecifiers =
    highestAffinity > 0 ? MAXIMUM_AFFINITY_MATCHED_IMPORTS : MAXIMUM_TARGET_AFFINE_IMPORTS;
  for (const { specifier } of rankedSpecifiers.slice(0, maximumSpecifiers)) {
    const resolvedPath = resolveModule(specifier, ownerPath);
    if (resolvedPath === undefined) continue;
    const childPath = path.normalize(resolvedPath);
    if (
      seen.has(childPath) ||
      !isProjectSourcePath(childPath, workspaceRoot) ||
      !isAdmittedSourcePath(childPath, workspaceRoot, options.selectedAuxiliaryRoot)
    ) {
      continue;
    }
    seen.add(childPath);
    edges.push(
      Object.freeze({
        childPath,
        moduleSpecifier: specifier,
        ownerPath: path.normalize(ownerPath),
      }),
    );
  }
  return Object.freeze(edges);
}

/**
 * Identifies tooling/example sources without interpreting an ancestor workspace directory name.
 *
 * Selected auxiliary subtrees may still be admitted by the caller; this predicate only supplies
 * the shared generic classification used by entry seeding and resolved-import confinement.
 */
export function isPreviewInspectorFastAuxiliarySourcePath(
  sourcePath: string,
  workspaceRoot: string,
): boolean {
  return (
    AUXILIARY_PATH_PATTERN.test(normalizePortablePath(path.relative(workspaceRoot, sourcePath))) ||
    AUXILIARY_FILE_NAME_PATTERN.test(path.basename(sourcePath))
  );
}

/** Scores lexical target suffixes before any potentially expensive alias resolution occurs. */
function scoreModuleSpecifierAffinity(
  preferredPath: string | undefined,
  moduleSpecifier: string,
): number {
  if (preferredPath === undefined) return 0;
  const targetSegments = normalizePortablePath(preferredPath)
    .replace(SOURCE_FILE_PATTERN, '')
    .split('/')
    .filter(Boolean);
  const specifierSegments = normalizePortablePath(moduleSpecifier)
    .replace(SOURCE_FILE_PATTERN, '')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
  let suffixMatches = 0;
  while (
    suffixMatches < targetSegments.length &&
    suffixMatches < specifierSegments.length &&
    targetSegments.at(-1 - suffixMatches) === specifierSegments.at(-1 - suffixMatches)
  ) {
    suffixMatches += 1;
  }
  const basenameMatch =
    targetSegments.at(-1) !== undefined && targetSegments.at(-1) === specifierSegments.at(-1);
  return Number(basenameMatch) * 10_000 + suffixMatches * 1_000;
}

/** Confines resolved modules to authored JS/TS sources inside the trusted workspace. */
function isProjectSourcePath(sourcePath: string, workspaceRoot: string): boolean {
  const portablePath = normalizePortablePath(path.relative(workspaceRoot, sourcePath));
  return (
    SOURCE_FILE_PATTERN.test(sourcePath) &&
    isPathInside(workspaceRoot, sourcePath) &&
    !/(?:^|\/)(?:node_modules|\.yarn|\.pnpm)(?:\/|$)/u.test(portablePath)
  );
}

/** Keeps normal tooling demotion while admitting the one explicitly selected auxiliary subtree. */
function isAdmittedSourcePath(
  sourcePath: string,
  workspaceRoot: string,
  selectedAuxiliaryRoot: string | undefined,
): boolean {
  const auxiliary = isPreviewInspectorFastAuxiliarySourcePath(sourcePath, workspaceRoot);
  return (
    !auxiliary ||
    (selectedAuxiliaryRoot !== undefined &&
      isPathInside(path.resolve(selectedAuxiliaryRoot), path.resolve(sourcePath)))
  );
}

/** Segment-aware containment prevents a sibling path prefix from crossing the trusted boundary. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

/** Converts platform separators for portable matching without altering filesystem identity. */
function normalizePortablePath(sourcePath: string): string {
  return sourcePath.replaceAll('\\', '/').toLowerCase();
}
