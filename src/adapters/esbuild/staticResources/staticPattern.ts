/**
 * Expands bounded relative filesystem glob patterns for preview-only static resource discovery.
 * The walker excludes dependency metadata trees and enforces hard scan/match limits so a dynamic
 * expression cannot accidentally bundle an entire monorepo or `node_modules` directory.
 */
import { opendir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MAX_MATCHES = 256;
const DEFAULT_MAX_SCANNED_ENTRIES = 4096;
const MAX_DIRECTORY_DEPTH = 20;
const MAX_PATTERNS_PER_EXPANSION = 128;
const MAX_PATTERN_LENGTH = 512;
const EXCLUDED_DIRECTORY_NAMES = new Set(['.git', '.hg', '.svn', 'node_modules']);

/** One deterministic filesystem match and the relative import key exposed to runtime source. */
export interface StaticPatternMatch {
  /** Vite/Webpack-style relative key such as `./pages/Home.tsx`. */
  readonly key: string;
  /** Literal import specifier generated into the transformed module. */
  readonly specifier: string;
}

/** Result of one bounded pattern expansion. */
export interface StaticPatternExpansion {
  /** Sorted files that survived positive and negative patterns. */
  readonly matches: readonly StaticPatternMatch[];
  /** Directories whose future additions should trigger preview reconsideration. */
  readonly watchDirectories: readonly string[];
}

/** Mutable scan counter shared by every expansion performed during one preview compilation. */
export interface StaticScanBudget {
  /** Maximum filesystem entries permitted across the complete build. */
  readonly maximum: number;
  /** Entries already visited by earlier or current expansions. */
  visited: number;
}

/** Input policy for one static pattern expansion. */
export interface StaticPatternOptions {
  /** Optional build-wide budget layered on top of the per-expansion entry limit. */
  readonly aggregateScanBudget?: StaticScanBudget;
  /** Absolute source module path used to resolve relative patterns. */
  readonly importerPath: string;
  /** Optional pure key predicate applied before the returned-module limit is enforced. */
  readonly matchFilter?: (relativeKey: string) => boolean;
  /** Maximum returned modules across all positive patterns. */
  readonly maxMatches?: number;
  /** Maximum filesystem entries visited before aborting. */
  readonly maxScannedEntries?: number;
  /** Positive patterns and optional `!`-prefixed exclusions. */
  readonly patterns: readonly string[];
  /** Optional Vite project root used to resolve and key `/src/...`-style patterns. */
  readonly rootRelativeBaseDirectory?: string;
  /** Trusted workspace boundary that every discovered path must remain inside. */
  readonly workspaceRoot: string;
}

/** Validated pattern translated into the importer's relative filesystem coordinate space. */
interface PreparedStaticPattern {
  /** Original literal without a leading exclusion marker, retained for diagnostics. */
  readonly authoredPattern: string;
  /** Pattern used for filesystem traversal and matching against relative import specifiers. */
  readonly relativePattern: string;
  /** Whether runtime keys must remain project-root-relative, as required by Vite. */
  readonly rootRelative: boolean;
}

/** Error raised when a static expression is unsafe or exceeds a discovery boundary. */
export class StaticPatternError extends Error {
  /** Creates an actionable static-discovery failure. */
  public constructor(message: string) {
    super(message);
    this.name = 'StaticPatternError';
  }
}

/**
 * Expands relative glob literals without evaluating project configuration or arbitrary JavaScript.
 * Callers may explicitly provide a project root to enable Vite's `/...` glob coordinate space;
 * those patterns remain confined to that project root even inside a larger monorepo workspace.
 *
 * @param options Importer, patterns, and hard resource limits.
 * @returns Sorted matches and the finite directories traversed during discovery.
 * @throws StaticPatternError for absolute/bare patterns or exceeded limits.
 */
export async function expandStaticPatterns(
  options: StaticPatternOptions,
): Promise<StaticPatternExpansion> {
  if (options.patterns.length > MAX_PATTERNS_PER_EXPANSION) {
    throw new StaticPatternError(
      `Static resource discovery accepts at most ${MAX_PATTERNS_PER_EXPANSION.toString()} patterns per macro.`,
    );
  }
  const oversizedPattern = options.patterns.find((pattern) => pattern.length > MAX_PATTERN_LENGTH);
  if (oversizedPattern !== undefined) {
    throw new StaticPatternError(
      `Static resource patterns must be at most ${MAX_PATTERN_LENGTH.toString()} characters.`,
    );
  }

  const authoredPositivePatterns = options.patterns.filter((pattern) => !pattern.startsWith('!'));
  const authoredNegativePatterns = options.patterns
    .filter((pattern) => pattern.startsWith('!'))
    .map((pattern) => pattern.slice(1));
  if (authoredPositivePatterns.length === 0) {
    throw new StaticPatternError(
      'Static resource discovery requires at least one positive pattern.',
    );
  }

  const importerDirectory = path.dirname(options.importerPath);
  const lexicalWorkspaceRoot = path.resolve(options.workspaceRoot);
  const canonicalWorkspaceRoot = await resolveCanonicalPath(lexicalWorkspaceRoot);
  const lexicalRootRelativeBase =
    options.rootRelativeBaseDirectory === undefined
      ? undefined
      : path.resolve(options.rootRelativeBaseDirectory);
  const canonicalRootRelativeBase =
    lexicalRootRelativeBase === undefined
      ? undefined
      : await resolveCanonicalPath(lexicalRootRelativeBase);
  if (lexicalRootRelativeBase !== undefined && canonicalRootRelativeBase !== undefined) {
    assertInsideWorkspace(lexicalWorkspaceRoot, lexicalRootRelativeBase, '/');
    assertInsideWorkspace(canonicalWorkspaceRoot, canonicalRootRelativeBase, '/');
  }

  const positivePatterns = authoredPositivePatterns.map((pattern) =>
    prepareStaticPattern(pattern, importerDirectory, lexicalRootRelativeBase),
  );
  const negativePatterns = authoredNegativePatterns.map((pattern) =>
    prepareStaticPattern(pattern, importerDirectory, lexicalRootRelativeBase),
  );
  for (const pattern of [...positivePatterns, ...negativePatterns]) {
    const searchRoot = resolveSearchRoot(importerDirectory, pattern.relativePattern);
    const lexicalBoundary = selectPatternBoundary(
      pattern,
      lexicalWorkspaceRoot,
      lexicalRootRelativeBase,
    );
    const canonicalBoundary = selectPatternBoundary(
      pattern,
      canonicalWorkspaceRoot,
      canonicalRootRelativeBase,
    );
    assertInsideWorkspace(lexicalBoundary, searchRoot, pattern.authoredPattern);
    const canonicalSearchRoot = await resolveCanonicalPath(searchRoot);
    assertInsideWorkspace(canonicalBoundary, canonicalSearchRoot, pattern.authoredPattern);
  }

  const candidateFiles = new Set<string>();
  const watchDirectories = new Set<string>();
  const traversalBySearchRoot = new Map<
    string,
    {
      canonicalBoundary: string;
      maximumDepth: number;
      reportDepthOverflow: boolean;
      searchRoot: string;
    }
  >();
  const scanBudget = {
    maximum: options.maxScannedEntries ?? DEFAULT_MAX_SCANNED_ENTRIES,
    visited: 0,
  };

  for (const pattern of positivePatterns) {
    const searchRoot = resolveSearchRoot(importerDirectory, pattern.relativePattern);
    const lexicalBoundary = selectPatternBoundary(
      pattern,
      lexicalWorkspaceRoot,
      lexicalRootRelativeBase,
    );
    const canonicalBoundary = selectPatternBoundary(
      pattern,
      canonicalWorkspaceRoot,
      canonicalRootRelativeBase,
    );
    assertInsideWorkspace(lexicalBoundary, searchRoot, pattern.authoredPattern);
    const canonicalSearchRoot = await resolveCanonicalPath(searchRoot);
    assertInsideWorkspace(canonicalBoundary, canonicalSearchRoot, pattern.authoredPattern);
    watchDirectories.add(searchRoot);
    if (!containsGlobSyntax(pattern.relativePattern)) {
      consumeScanBudget(scanBudget, options.aggregateScanBudget);
      const candidatePath = path.resolve(importerDirectory, pattern.relativePattern);
      if (await isRegularFile(candidatePath)) {
        const canonicalCandidatePath = await resolveCanonicalPath(candidatePath);
        assertInsideWorkspace(canonicalBoundary, canonicalCandidatePath, pattern.authoredPattern);
        candidateFiles.add(candidatePath);
      }
      continue;
    }
    const traversal = resolveTraversalPolicy(pattern.relativePattern);
    const traversalKey = `${canonicalBoundary}\0${searchRoot}`;
    const previousTraversal = traversalBySearchRoot.get(traversalKey);
    traversalBySearchRoot.set(traversalKey, {
      canonicalBoundary,
      maximumDepth: Math.max(previousTraversal?.maximumDepth ?? 0, traversal.maximumDepth),
      reportDepthOverflow:
        (previousTraversal?.reportDepthOverflow ?? false) || traversal.reportDepthOverflow,
      searchRoot,
    });
  }

  for (const traversal of traversalBySearchRoot.values()) {
    await collectFiles(
      traversal.searchRoot,
      0,
      traversal.maximumDepth,
      traversal.reportDepthOverflow,
      candidateFiles,
      scanBudget,
      options.aggregateScanBudget,
      traversal.canonicalBoundary,
      new Set<string>(),
    );
  }

  const positiveMatchers = positivePatterns.map((pattern) => ({
    matcher: globToRegExp(pattern.relativePattern),
    pattern,
  }));
  const negativeMatchers = negativePatterns.map((pattern) => globToRegExp(pattern.relativePattern));
  const matchedFiles = new Map<string, StaticPatternMatch>();
  for (const filePath of candidateFiles) {
    const relativeKey = createRelativeSpecifier(importerDirectory, filePath);
    if (
      negativeMatchers.some((matcher) => matcher.test(relativeKey)) ||
      !(options.matchFilter?.(relativeKey) ?? true)
    ) {
      continue;
    }
    for (const { matcher, pattern } of positiveMatchers) {
      if (!matcher.test(relativeKey)) {
        continue;
      }
      if (pattern.rootRelative && canonicalRootRelativeBase !== undefined) {
        const canonicalCandidatePath = await resolveCanonicalPath(filePath);
        assertInsideWorkspace(
          canonicalRootRelativeBase,
          canonicalCandidatePath,
          pattern.authoredPattern,
        );
      }
      const key = pattern.rootRelative
        ? createRootRelativeSpecifier(
            requireRootRelativeBase(pattern, lexicalRootRelativeBase),
            filePath,
          )
        : relativeKey;
      matchedFiles.set(`${key}\0${relativeKey}`, { key, specifier: relativeKey });
    }
  }
  const sortedMatches = [...matchedFiles.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  );

  const maximumMatches = options.maxMatches ?? DEFAULT_MAX_MATCHES;
  if (sortedMatches.length > maximumMatches) {
    throw new StaticPatternError(
      `Static resource pattern matched ${sortedMatches.length.toString()} files; the preview limit is ${maximumMatches.toString()}.`,
    );
  }

  return {
    matches: sortedMatches,
    watchDirectories: [...watchDirectories].sort(),
  };
}

/** Recursively collects regular files while enforcing excluded names, depth, and scan limits. */
async function collectFiles(
  directoryPath: string,
  depth: number,
  maximumDepth: number,
  reportDepthOverflow: boolean,
  files: Set<string>,
  budget: { maximum: number; visited: number },
  aggregateBudget: StaticScanBudget | undefined,
  canonicalWorkspaceRoot: string,
  ancestorDirectories: ReadonlySet<string>,
): Promise<void> {
  if (depth > MAX_DIRECTORY_DEPTH) {
    throw new StaticPatternError(
      `Static resource discovery exceeded ${MAX_DIRECTORY_DEPTH.toString()} directory levels.`,
    );
  }

  const canonicalDirectory = await resolveCanonicalPath(directoryPath);
  assertInsideWorkspace(canonicalWorkspaceRoot, canonicalDirectory, directoryPath);
  if (ancestorDirectories.has(canonicalDirectory)) {
    return;
  }
  const nestedAncestors = new Set(ancestorDirectories);
  nestedAncestors.add(canonicalDirectory);

  let directory;
  try {
    directory = await opendir(directoryPath);
  } catch (error) {
    if (isMissingPathError(error)) {
      return;
    }
    throw error;
  }

  for await (const entry of directory) {
    consumeScanBudget(budget, aggregateBudget);

    const entryPath = path.join(directoryPath, entry.name);
    if (EXCLUDED_DIRECTORY_NAMES.has(entry.name.toLowerCase())) {
      continue;
    }

    let isDirectory = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      let canonicalEntryPath: string;
      try {
        canonicalEntryPath = await realpath(entryPath);
        assertInsideWorkspace(canonicalWorkspaceRoot, canonicalEntryPath, entryPath);
        const target = await stat(entryPath);
        isDirectory = target.isDirectory();
        isFile = target.isFile();
      } catch (error) {
        if (isMissingPathError(error)) {
          continue;
        }
        throw error;
      }
    }

    if (isDirectory) {
      if (depth >= maximumDepth) {
        if (reportDepthOverflow) {
          throw new StaticPatternError(
            `Static resource discovery exceeded ${MAX_DIRECTORY_DEPTH.toString()} directory levels.`,
          );
        }
        continue;
      }
      await collectFiles(
        entryPath,
        depth + 1,
        maximumDepth,
        reportDepthOverflow,
        files,
        budget,
        aggregateBudget,
        canonicalWorkspaceRoot,
        nestedAncestors,
      );
    } else if (isFile) {
      files.add(entryPath);
    }
  }
}

/** Charges one directory entry or exact-path filesystem probe to local and build-wide limits. */
function consumeScanBudget(
  budget: { maximum: number; visited: number },
  aggregateBudget: StaticScanBudget | undefined,
): void {
  budget.visited += 1;
  if (budget.visited > budget.maximum) {
    throw new StaticPatternError(
      `Static resource discovery scanned more than ${budget.maximum.toString()} filesystem entries.`,
    );
  }
  if (aggregateBudget === undefined) {
    return;
  }
  aggregateBudget.visited += 1;
  if (aggregateBudget.visited > aggregateBudget.maximum) {
    throw new StaticPatternError(
      `Static resource discovery scanned more than ${aggregateBudget.maximum.toString()} filesystem entries across one preview build.`,
    );
  }
}

/** Computes the fixed directory prefix before the first wildcard-bearing path segment. */
function resolveSearchRoot(importerDirectory: string, pattern: string): string {
  const normalizedPattern = pattern.replaceAll('\\', '/');
  const segments = normalizedPattern.split('/');
  const wildcardSegmentIndex = segments.findIndex(containsGlobSyntax);
  const fixedSegments =
    wildcardSegmentIndex < 0 ? segments.slice(0, -1) : segments.slice(0, wildcardSegmentIndex);
  return path.resolve(importerDirectory, ...fixedSegments);
}

/**
 * Computes how far below the fixed search root a pattern can match without unnecessary recursion.
 * A globstar in either a directory or terminal segment receives the global safety depth because it
 * can consume any number of directories; ordinary wildcard segments consume exactly one level.
 *
 * @param pattern Valid relative pattern containing at least one glob token.
 * @returns Required depth and whether a globstar must report content beyond the safety boundary.
 */
function resolveTraversalPolicy(pattern: string): {
  readonly maximumDepth: number;
  readonly reportDepthOverflow: boolean;
} {
  const segments = pattern.replaceAll('\\', '/').split('/');
  const wildcardSegmentIndex = segments.findIndex(containsGlobSyntax);
  const dynamicSegments = segments.slice(wildcardSegmentIndex);
  if (dynamicSegments.some((segment) => segment === '**')) {
    return { maximumDepth: MAX_DIRECTORY_DEPTH, reportDepthOverflow: true };
  }
  return {
    maximumDepth: Math.max(0, dynamicSegments.length - 1),
    reportDepthOverflow: false,
  };
}

/** Converts one supported glob pattern into a regular expression over relative import specifiers. */
function globToRegExp(pattern: string): RegExp {
  const normalizedPattern = pattern.replaceAll('\\', '/');
  let expression = '^';
  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const character = normalizedPattern[index];
    const nextCharacter = normalizedPattern[index + 1];
    const isCompleteGlobstar =
      character === '*' &&
      nextCharacter === '*' &&
      (index === 0 || normalizedPattern[index - 1] === '/') &&
      (index + 2 === normalizedPattern.length || normalizedPattern[index + 2] === '/');
    if (isCompleteGlobstar) {
      const followedBySlash = normalizedPattern[index + 2] === '/';
      expression += followedBySlash ? '(?:.*/)?' : '.*';
      index += followedBySlash ? 2 : 1;
    } else if (character === '*') {
      expression += '[^/]*';
    } else if (character === '?') {
      expression += '[^/]';
    } else if (character === '{') {
      const closingBrace = normalizedPattern.indexOf('}', index + 1);
      if (closingBrace < 0) {
        expression += '\\{';
      } else {
        const choices = normalizedPattern
          .slice(index + 1, closingBrace)
          .split(',')
          .map(escapeRegularExpression)
          .join('|');
        expression += `(?:${choices})`;
        index = closingBrace;
      }
    } else {
      expression += escapeRegularExpression(character ?? '');
    }
  }
  return new RegExp(`${expression}$`, 'u');
}

/** Produces a forward-slash relative specifier with the explicit `./` prefix when needed. */
function createRelativeSpecifier(importerDirectory: string, filePath: string): string {
  const relativePath = path.relative(importerDirectory, filePath).replaceAll(path.sep, '/');
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

/** Produces the Vite object key for a file addressed from the configured project root. */
function createRootRelativeSpecifier(rootDirectory: string, filePath: string): string {
  const relativePath = path.relative(rootDirectory, filePath).replaceAll(path.sep, '/');
  return `/${relativePath}`;
}

/** Chooses the workspace or stricter project boundary attached to one prepared pattern. */
function selectPatternBoundary(
  pattern: PreparedStaticPattern,
  workspaceBoundary: string,
  rootRelativeBoundary: string | undefined,
): string {
  return pattern.rootRelative
    ? requireRootRelativeBase(pattern, rootRelativeBoundary)
    : workspaceBoundary;
}

/** Returns the project-root boundary proven during preparation or reports an internal invariant. */
function requireRootRelativeBase(
  pattern: PreparedStaticPattern,
  rootRelativeBaseDirectory: string | undefined,
): string {
  if (rootRelativeBaseDirectory === undefined) {
    throw new StaticPatternError(
      `Static resource pattern has no configured project root: ${pattern.authoredPattern}`,
    );
  }
  return rootRelativeBaseDirectory;
}

/**
 * Translates one optional Vite root pattern into the importer's matching coordinate space.
 * The original root-relative shape is retained separately so generated object keys stay compatible.
 */
function prepareStaticPattern(
  pattern: string,
  importerDirectory: string,
  rootRelativeBaseDirectory: string | undefined,
): PreparedStaticPattern {
  if (!pattern.startsWith('/')) {
    assertRelativePattern(pattern);
    return { authoredPattern: pattern, relativePattern: pattern, rootRelative: false };
  }
  if (rootRelativeBaseDirectory === undefined || pattern.startsWith('//')) {
    throw new StaticPatternError(
      `Static resource pattern must start with "./" or "../": ${pattern}`,
    );
  }
  const absolutePattern = path.resolve(rootRelativeBaseDirectory, `.${pattern}`);
  return {
    authoredPattern: pattern,
    relativePattern: createRelativeSpecifier(importerDirectory, absolutePattern),
    rootRelative: true,
  };
}

/** Rejects aliases and bare patterns that do not prove a finite local search root. */
function assertRelativePattern(pattern: string): void {
  if (!pattern.startsWith('./') && !pattern.startsWith('../')) {
    throw new StaticPatternError(
      `Static resource pattern must start with "./" or "../": ${pattern}`,
    );
  }
}

/**
 * Rejects lexical traversal and existing symlink targets outside the selected workspace boundary.
 *
 * @param workspaceRoot Absolute lexical or canonical workspace root.
 * @param candidatePath Absolute discovery root or exact file path.
 * @param pattern User-authored pattern included in the actionable diagnostic.
 */
function assertInsideWorkspace(
  workspaceRoot: string,
  candidatePath: string,
  pattern: string,
): void {
  const relativePath = path.relative(workspaceRoot, candidatePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new StaticPatternError(
      `Static resource pattern must stay inside the workspace: ${pattern}`,
    );
  }
}

/** Reports whether a path contains supported wildcard or brace syntax. */
function containsGlobSyntax(value: string): boolean {
  return /[*?{]/u.test(value);
}

/** Escapes one literal fragment for insertion into a regular expression. */
function escapeRegularExpression(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/gu, '\\$&');
}

/** Checks one exact non-glob path without surfacing normal missing-file cases. */
async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }
    throw error;
  }
}

/**
 * Resolves existing symlinks for boundary validation while retaining missing glob roots lexically.
 *
 * @param filePath Absolute file or directory candidate.
 * @returns Canonical existing path, or a canonical nearest ancestor plus the missing suffix.
 */
async function resolveCanonicalPath(filePath: string): Promise<string> {
  try {
    return await realpath(filePath);
  } catch (error) {
    if (isMissingPathError(error)) {
      const lexicalPath = path.resolve(filePath);
      const parentPath = path.dirname(lexicalPath);
      return parentPath === lexicalPath
        ? lexicalPath
        : path.join(await resolveCanonicalPath(parentPath), path.basename(lexicalPath));
    }
    throw error;
  }
}

/** Narrows unknown filesystem errors to normal missing-path failures. */
function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'ENOENT'
  );
}
