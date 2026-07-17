/**
 * Creates reusable syntax-only facts for one authored render-graph module.
 * One TypeScript parse supplies both component/value-flow facts and semantic ReactDOM entry
 * evidence, while a separate lightweight import scan can be cached for coarse graph selection.
 * Application modules are never imported or evaluated by this adapter.
 */
import path from 'node:path';
import ts from 'typescript';
import {
  collectPreviewEntryPointEvidence,
  type PreviewEntryPointEvidence,
} from './previewEntryPointEvidence';
import {
  collectPreviewRenderModuleFactsFromSourceFile,
  type PreviewRenderModuleFacts,
} from './previewRenderModuleFacts';

const LITERAL_MODULE_SPECIFIER_PATTERN =
  /\b(?:from\s*|import\s*\(\s*|import\s*|require\s*\(\s*)(["'`])([^"'`\r\n]+)\1/gu;

/** Immutable AST-derived facts reused by entry discovery and exact render-graph construction. */
export interface PreviewRenderSourceAnalysis {
  /** Import-proven ReactDOM mount calls found in this module. */
  readonly entryEvidence: readonly PreviewEntryPointEvidence[];
  /** Declarations, exports, imports, lazy edges, and local value-flow facts. */
  readonly moduleFacts: PreviewRenderModuleFacts;
}

/** Injectable analyzer used by the project cache without coupling the planner to cache ownership. */
export type AnalyzePreviewRenderSource = (
  sourcePath: string,
  sourceText: string,
) => PreviewRenderSourceAnalysis;

/** Injectable lightweight import collector used by forward and reverse coarse indexes. */
export type CollectPreviewRenderModuleSpecifiers = (
  sourcePath: string,
  sourceText: string,
) => readonly string[];

/**
 * Parses one source module once and extracts every AST-based render fact required downstream.
 *
 * @param sourcePath Absolute authored module path, used to select TS versus TSX grammar.
 * @param sourceText Current disk or editor snapshot text.
 * @returns Frozen facts that retain no TypeScript AST nodes.
 */
export function analyzePreviewRenderSource(
  sourcePath: string,
  sourceText: string,
): PreviewRenderSourceAnalysis {
  const normalizedPath = path.normalize(sourcePath);
  const sourceFile = ts.createSourceFile(
    normalizedPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    normalizedPath.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  return Object.freeze({
    entryEvidence: collectPreviewEntryPointEvidence(normalizedPath, sourceFile),
    moduleFacts: collectPreviewRenderModuleFactsFromSourceFile(normalizedPath, sourceFile),
  });
}

/**
 * Extracts literal ESM, dynamic-import, and CommonJS dependencies without building an AST.
 * Query/hash loader suffixes are removed before caching because neither static resolver accepts
 * them as part of the authored module identity.
 *
 * @param sourcePath Unused path retained in the callback contract for file-scoped cache keys.
 * @param sourceText Current source text inspected without executing expressions.
 * @returns Frozen import specifiers in deterministic authored order.
 */
export function collectPreviewRenderModuleSpecifiers(
  sourcePath: string,
  sourceText: string,
): readonly string[] {
  void sourcePath;
  const specifiers: string[] = [];
  LITERAL_MODULE_SPECIFIER_PATTERN.lastIndex = 0;
  for (const match of sourceText.matchAll(LITERAL_MODULE_SPECIFIER_PATTERN)) {
    const rawSpecifier = match[2];
    const cleanSpecifier = rawSpecifier?.split(/[?#]/u, 1)[0];
    if (cleanSpecifier !== undefined && cleanSpecifier.length > 0) {
      specifiers.push(cleanSpecifier);
    }
  }
  return Object.freeze(specifiers);
}
