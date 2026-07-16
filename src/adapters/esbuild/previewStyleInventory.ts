/**
 * Collects conservative styled-components theme evidence from one parsed workspace module.
 * The inventory records syntax only: it does not resolve modules, read project configuration, or
 * execute theme code. A later graph coordinator can combine signals from reachable source files.
 */
import path from 'node:path';
import ts from 'typescript';
import type { PreviewThemeImportSelection } from './previewTargetExports';

const STYLED_COMPONENTS_SPECIFIER = 'styled-components';
const MAX_STYLE_SIGNALS_PER_SOURCE = 32;
const MAX_GRAPH_SIGNALS = 256;
const MAX_GRAPH_CANDIDATES = 64;
const MAX_MODULE_SPECIFIER_LENGTH = 2_048;
const SOURCE_EXTENSION_PATTERN = /\.(?:[cm]?[jt]sx?)$/iu;

/** Confidence attached to one import whose runtime theme value may be reused by the preview. */
export type PreviewThemeSignalConfidence = 'type' | 'value';

/**
 * Immutable evidence that a styled source associates one exact import with its component theme.
 * `moduleSpecifier` is absolute and extensionless for relative imports, while aliases and packages
 * remain unchanged for the compiler's normal project resolver.
 */
export interface PreviewStyleSignal {
  /** Source module containing both the styled-components import and theme reference. */
  readonly importerPath: string;
  /** Normalized import request identifying the candidate theme module. */
  readonly moduleSpecifier: string;
  /** Runtime export that a private preview bridge may import after graph selection. */
  readonly exportName: 'default' | 'theme';
  /** Value imports are stronger evidence than erased type-shape references. */
  readonly confidence: PreviewThemeSignalConfidence;
}

/** Mutable evidence totals kept private while graph candidates are ranked. */
interface ThemeCandidateScore {
  /** Exact selection returned when this candidate has the unique highest score. */
  readonly selection: PreviewThemeImportSelection;
  /** Importing modules already counted as type-only evidence. */
  readonly typeImporters: Set<string>;
  /** Importing modules already counted as runtime value evidence. */
  readonly valueImporters: Set<string>;
}

/**
 * Extracts exact theme imports only when the same source uses styled-components at runtime.
 * Named `theme` imports may be value or type-only and may use a local alias. Default imports are
 * eligible only when their local binding is literally `theme`, matching the existing direct-file
 * convention. Parser recovery, unrelated imports, and excessive evidence produce no partial plan.
 *
 * @param sourcePath File identity used for grammar selection and relative-request normalization.
 * @param sourceText Current source snapshot, including unsaved editor contents.
 * @returns Bounded theme signals suitable for later target-rooted graph aggregation.
 */
export function collectPreviewStyleSignals(
  sourcePath: string,
  sourceText: string,
): readonly PreviewStyleSignal[] {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile) || !hasStyledComponentsRuntimeImport(sourceFile)) {
    return [];
  }

  const importerPath = path.normalize(sourcePath);
  const signals: PreviewStyleSignal[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
      continue;
    }
    collectThemeSignals(statement, importerPath, signals);
    if (signals.length > MAX_STYLE_SIGNALS_PER_SOURCE) {
      return [];
    }
  }
  return signals;
}

/**
 * Selects one graph-wide theme through bounded, importer-deduplicated evidence scoring.
 * Any value signal outranks every possible type-only total. Repeated signals for the same
 * candidate from different reachable modules accumulate, while an exact top-score tie remains
 * ambiguous and deliberately returns no theme.
 *
 * @param signals Style signals collected from target-reachable source modules.
 * @returns Existing bridge selection contract when one candidate wins uniquely.
 */
export function selectPreviewGraphTheme(
  signals: readonly PreviewStyleSignal[],
): PreviewThemeImportSelection | undefined {
  if (signals.length === 0 || signals.length > MAX_GRAPH_SIGNALS) {
    return undefined;
  }

  const candidates = new Map<string, ThemeCandidateScore>();
  for (const signal of signals) {
    const candidateKey = JSON.stringify([signal.moduleSpecifier, signal.exportName]);
    let candidate = candidates.get(candidateKey);
    if (candidate === undefined) {
      if (candidates.size >= MAX_GRAPH_CANDIDATES) {
        return undefined;
      }
      candidate = {
        selection: {
          exportName: signal.exportName,
          moduleSpecifier: signal.moduleSpecifier,
        },
        typeImporters: new Set<string>(),
        valueImporters: new Set<string>(),
      };
      candidates.set(candidateKey, candidate);
    }
    const evidence =
      signal.confidence === 'value' ? candidate.valueImporters : candidate.typeImporters;
    evidence.add(signal.importerPath);
  }

  let winner: ThemeCandidateScore | undefined;
  let winnerScore = -1;
  let tied = false;
  for (const candidate of candidates.values()) {
    const score = scoreThemeCandidate(candidate);
    if (score > winnerScore) {
      winner = candidate;
      winnerScore = score;
      tied = false;
    } else if (score === winnerScore) {
      tied = true;
    }
  }
  return tied ? undefined : winner?.selection;
}

/** Maps a supported source suffix to the matching TypeScript parser grammar. */
function getScriptKind(sourcePath: string): ts.ScriptKind {
  const normalizedPath = sourcePath.toLowerCase();
  if (normalizedPath.endsWith('.tsx')) {
    return ts.ScriptKind.TSX;
  }
  if (
    normalizedPath.endsWith('.ts') ||
    normalizedPath.endsWith('.mts') ||
    normalizedPath.endsWith('.cts')
  ) {
    return ts.ScriptKind.TS;
  }
  return normalizedPath.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.JS;
}

/** Reports parser recovery so incomplete editor text cannot create misleading partial evidence. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & {
      readonly parseDiagnostics?: readonly ts.Diagnostic[];
    }
  ).parseDiagnostics;
  return diagnostics !== undefined && diagnostics.length > 0;
}

/** Detects a non-erased import of the project package that owns styled-components context. */
function hasStyledComponentsRuntimeImport(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== STYLED_COMPONENTS_SPECIFIER
    ) {
      return false;
    }
    const clause = statement.importClause;
    if (clause === undefined) {
      return true;
    }
    if (isTypeOnlyImportClause(clause)) {
      return false;
    }
    if (clause.name !== undefined || clause.namedBindings === undefined) {
      return true;
    }
    return (
      ts.isNamespaceImport(clause.namedBindings) ||
      clause.namedBindings.elements.some((element) => !element.isTypeOnly)
    );
  });
}

/** Appends exact default-value, named-value, and named type-only theme evidence. */
function collectThemeSignals(
  statement: ts.ImportDeclaration,
  importerPath: string,
  signals: PreviewStyleSignal[],
): void {
  const clause = statement.importClause;
  if (clause === undefined || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
    return;
  }
  const moduleSpecifier = normalizeThemeSpecifier(importerPath, statement.moduleSpecifier.text);
  if (moduleSpecifier === undefined) {
    return;
  }

  const clauseIsTypeOnly = isTypeOnlyImportClause(clause);
  if (!clauseIsTypeOnly && clause.name?.text === 'theme') {
    signals.push({
      confidence: 'value',
      exportName: 'default',
      importerPath,
      moduleSpecifier,
    });
  }
  const namedBindings = clause.namedBindings;
  if (namedBindings === undefined || !ts.isNamedImports(namedBindings)) {
    return;
  }
  for (const element of namedBindings.elements) {
    const importedName = element.propertyName ?? element.name;
    if (importedName.text !== 'theme') {
      continue;
    }
    signals.push({
      confidence: clauseIsTypeOnly || element.isTypeOnly ? 'type' : 'value',
      exportName: 'theme',
      importerPath,
      moduleSpecifier,
    });
  }
}

/** Resolves relative syntax lexically while leaving aliases and package requests untouched. */
function normalizeThemeSpecifier(
  importerPath: string,
  moduleSpecifier: string,
): string | undefined {
  if (
    moduleSpecifier.length === 0 ||
    moduleSpecifier.length > MAX_MODULE_SPECIFIER_LENGTH ||
    moduleSpecifier.includes('\0')
  ) {
    return undefined;
  }
  if (!moduleSpecifier.startsWith('./') && !moduleSpecifier.startsWith('../')) {
    return moduleSpecifier;
  }
  const absoluteSpecifier = path.resolve(path.dirname(importerPath), moduleSpecifier);
  return absoluteSpecifier.replace(SOURCE_EXTENSION_PATTERN, '');
}

/** Uses TypeScript's phase marker to distinguish an entire `import type` declaration. */
function isTypeOnlyImportClause(clause: ts.ImportClause): boolean {
  return clause.phaseModifier === ts.SyntaxKind.TypeKeyword;
}

/** Produces a score where one value importer exceeds every bounded type-only candidate. */
function scoreThemeCandidate(candidate: ThemeCandidateScore): number {
  return candidate.valueImporters.size * (MAX_GRAPH_SIGNALS + 1) + candidate.typeImporters.size;
}
