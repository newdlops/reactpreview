/**
 * Collects the small forward source graph that can contribute Tailwind class candidates.
 *
 * Page-context discovery walks from an application root toward the selected component. Tailwind
 * needs the complementary direction as well: a selected component often imports a button, card,
 * or variant helper whose class strings are not present in the ancestor corridor. This module
 * follows only statically named runtime imports and re-exports, prioritizes the selected file, and
 * enforces strict file, depth, and aggregate-byte limits before any text reaches the CSS worker.
 */
import path from 'node:path';
import ts from 'typescript';
import type { PreviewSourceSnapshot } from '../../domain/preview';
import { getPreviewSourceLanguage } from '../../domain/previewTarget';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';

const MAX_CANDIDATE_FILES = 128;
const MAX_CANDIDATE_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_IMPORT_DEPTH = 8;
const MAX_IMPORTS_PER_SOURCE = 32;
const MAX_DYNAMIC_IMPORTS_PER_SOURCE = 16;
const SOURCE_EXTENSION_PATTERN = /\.[cm]?[jt]sx?$/iu;

/** Bounded project-source reader shared with the compiler-lifetime analysis cache. */
export type ReadPreviewTailwindCandidateSource = (options: {
  readonly maximumBytes: number;
  readonly sourcePath: string;
}) => Promise<string | undefined>;

/** Immutable inputs for target-first candidate graph collection. */
export interface CollectPreviewTailwindCandidateSnapshotGraphOptions {
  /** Ancestor/page/layout sources that remain useful after the target closure is exhausted. */
  readonly corridorPaths: readonly string[];
  readonly readSource: ReadPreviewTailwindCandidateSource;
  /** Exact TypeScript-aware project resolver; unresolved and package-external edges are ignored. */
  readonly resolveModule: (moduleSpecifier: string, consumerPath: string) => string | undefined;
  /** Current editor file, always explored before the broader page corridor. */
  readonly targetPath: string;
  /** Canonical trusted boundary that every reached source must remain inside. */
  readonly workspaceRoot: string;
}

interface CandidateWorkItem {
  readonly depth: number;
  readonly sourcePath: string;
}

/**
 * Reads a target-first, statically proven source graph for Tailwind's native string scanner.
 *
 * The selected target receives its own depth-first pass before page/layout seeds. This avoids a
 * large ancestor inventory consuming the 128-file budget before a directly imported UI component
 * is observed. Type-only imports, bare runtime packages, CSS files, and computed dynamic imports
 * never enter this source graph.
 */
export async function collectPreviewTailwindCandidateSnapshotGraph(
  options: CollectPreviewTailwindCandidateSnapshotGraphOptions,
): Promise<readonly PreviewSourceSnapshot[]> {
  const workspaceRoot = canonicalizeExistingPath(options.workspaceRoot);
  const snapshots: PreviewSourceSnapshot[] = [];
  const visited = new Set<string>();
  let totalBytes = 0;

  /**
   * Explores one seed depth-first. Newly discovered imports are placed ahead of later corridor
   * seeds, while authored import order remains stable for deterministic CSS candidate output.
   */
  async function exploreSeed(seedPath: string): Promise<void> {
    const work: CandidateWorkItem[] = [{ depth: 0, sourcePath: seedPath }];
    while (
      work.length > 0 &&
      snapshots.length < MAX_CANDIDATE_FILES &&
      totalBytes < MAX_CANDIDATE_BYTES
    ) {
      const item = work.shift();
      if (item === undefined) break;
      const canonicalPath = canonicalizeExistingPath(item.sourcePath);
      if (
        visited.has(canonicalPath) ||
        !SOURCE_EXTENSION_PATTERN.test(canonicalPath) ||
        !isPathInside(workspaceRoot, canonicalPath)
      ) {
        continue;
      }
      visited.add(canonicalPath);

      const remainingBytes = MAX_CANDIDATE_BYTES - totalBytes;
      const sourceText = await options.readSource({
        maximumBytes: Math.min(MAX_SOURCE_BYTES, remainingBytes),
        sourcePath: canonicalPath,
      });
      if (sourceText === undefined) continue;
      const sourceBytes = Buffer.byteLength(sourceText, 'utf8');
      if (sourceBytes > remainingBytes) break;

      totalBytes += sourceBytes;
      snapshots.push(
        Object.freeze({
          documentPath: canonicalPath,
          language: readPreviewSourceLanguage(canonicalPath),
          sourceText,
        }),
      );
      if (item.depth >= MAX_IMPORT_DEPTH) continue;

      const imports = collectRuntimeModuleSpecifiers(canonicalPath, sourceText)
        .map((specifier) => options.resolveModule(specifier, canonicalPath))
        .filter((resolvedPath): resolvedPath is string => resolvedPath !== undefined)
        .filter((resolvedPath) => SOURCE_EXTENSION_PATTERN.test(resolvedPath));
      work.unshift(
        ...imports.map((sourcePath) => ({
          depth: item.depth + 1,
          sourcePath,
        })),
      );
    }
  }

  await exploreSeed(options.targetPath);
  for (const corridorPath of options.corridorPaths) {
    await exploreSeed(corridorPath);
    if (snapshots.length >= MAX_CANDIDATE_FILES || totalBytes >= MAX_CANDIDATE_BYTES) {
      break;
    }
  }
  return Object.freeze(snapshots);
}

/**
 * Extracts only module specifiers whose runtime evaluation is statically explicit.
 *
 * Literal `import()` calls are included because React.lazy commonly owns the visible child graph;
 * registries with hundreds of lazy entries remain bounded by the outer file/byte ceilings.
 */
function collectRuntimeModuleSpecifiers(sourcePath: string, sourceText: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    readScriptKind(sourcePath),
  );
  const staticSpecifiers: string[] = [];
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      statement.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword &&
      ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      staticSpecifiers.push(statement.moduleSpecifier.text);
      continue;
    }
    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      staticSpecifiers.push(statement.moduleSpecifier.text);
    }
  }
  const dynamicSpecifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    const firstArgument = ts.isCallExpression(node) ? node.arguments[0] : undefined;
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      firstArgument !== undefined &&
      ts.isStringLiteralLike(firstArgument)
    ) {
      dynamicSpecifiers.push(firstArgument.text);
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  // A generated lazy registry can contain thousands of unrelated entries. The selected target is
  // already the first graph seed, so a high-cardinality registry contributes no useful candidate
  // evidence and must not consume the bounded source budget.
  const admittedDynamicSpecifiers =
    dynamicSpecifiers.length <= MAX_DYNAMIC_IMPORTS_PER_SOURCE ? dynamicSpecifiers : [];
  return Object.freeze(
    [...new Set([...staticSpecifiers, ...admittedDynamicSpecifiers])].slice(
      0,
      MAX_IMPORTS_PER_SOURCE,
    ),
  );
}

/** Maps an admitted source extension to the domain snapshot language. */
function readPreviewSourceLanguage(sourcePath: string): PreviewSourceSnapshot['language'] {
  // The shared preview policy intentionally treats .js/.mjs/.cjs as JSX-capable. Candidate
  // snapshots also participate in the workspace overlay map, so using plain `js` here would
  // accidentally override that established loader while merely preparing Tailwind strings.
  return getPreviewSourceLanguage(sourcePath) ?? 'jsx';
}

/** Selects a parser mode that preserves JSX nodes for candidate-bearing component sources. */
function readScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension.endsWith('tsx')) return ts.ScriptKind.TSX;
  if (extension.endsWith('jsx')) return ts.ScriptKind.JSX;
  if (extension.endsWith('ts')) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

/** Segment-aware containment prevents symlinked imports from escaping the trusted workspace. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative.length === 0 || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
