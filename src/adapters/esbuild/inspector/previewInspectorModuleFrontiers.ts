/**
 * Expands the module identities through which a selected component can be consumed by JSX.
 * Ordinary ESM barrels and `React.lazy(() => import(...))` wrappers are both transparent here:
 * neither is treated as an authored page owner, but both must participate in reverse discovery.
 */
import path from 'node:path';
import ts from 'typescript';
import type { MatchesPreviewParentSliceTargetImport } from '../parentSlice';
import { matchesPreviewParentSliceTargetImport } from '../parentSlice/previewParentSliceImports';
import {
  collectPreviewRenderModuleFactsFromSourceFile,
  type PreviewRenderModuleFacts,
} from '../renderGraph/previewRenderModuleFacts';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';

const MAX_FRONTIER_DEPTH = 10;

/** One already-read package source accepted by the bounded ancestor planner. */
export interface PreviewInspectorFrontierSource {
  readonly sourcePath: string;
  readonly sourceText: string;
}

/** One public module/export identity that eventually evaluates to the selected component. */
export interface PreviewInspectorModuleFrontier {
  /** Barrel/lazy wrapper files that must invalidate the result during hot reload. */
  readonly dependencyPaths: readonly string[];
  /** Runtime names exposed by this exact module. */
  readonly exportNames: readonly string[];
  /** Absolute component, barrel, or lazy-wrapper module path. */
  readonly sourcePath: string;
}

/** Inputs for one bounded transparent-module expansion. */
export interface CollectPreviewInspectorModuleFrontiersOptions {
  readonly acceptedImportSpecifiers: readonly string[];
  readonly matchesTargetImport?: MatchesPreviewParentSliceTargetImport;
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  readonly targetExportNames: readonly string[];
  readonly targetPath: string;
}

/**
 * Collects direct, re-exported, and lazy-re-exported identities without evaluating a module.
 * A hard depth cap and one frontier per normalized path keep cyclic barrels and lazy registries
 * bounded on large monorepos.
 */
export function collectPreviewInspectorModuleFrontiers(
  options: CollectPreviewInspectorModuleFrontiersOptions,
  sources: readonly PreviewInspectorFrontierSource[],
  sourceFileByPath: Map<string, ts.SourceFile>,
): readonly PreviewInspectorModuleFrontier[] {
  const initialFrontier: PreviewInspectorModuleFrontier = {
    dependencyPaths: Object.freeze([]),
    exportNames: Object.freeze([...options.targetExportNames]),
    sourcePath: path.normalize(options.targetPath),
  };
  const frontierByPath = new Map<string, PreviewInspectorModuleFrontier>([
    [initialFrontier.sourcePath, initialFrontier],
  ]);
  const renderFactsByPath = new Map<string, PreviewRenderModuleFacts>();

  for (let depth = 0; depth < MAX_FRONTIER_DEPTH; depth += 1) {
    let changed = false;
    const knownFrontiers = [...frontierByPath.values()];
    for (const source of sources) {
      const normalizedSourcePath = path.normalize(source.sourcePath);
      const sourceFile = readSourceFile(source, sourceFileByPath);
      const previous = frontierByPath.get(normalizedSourcePath);
      const discoveredNames = new Set(previous?.exportNames ?? []);
      const dependencyPaths = new Set(previous?.dependencyPaths ?? []);

      collectReexportedNames(
        options,
        source.sourcePath,
        sourceFile,
        knownFrontiers,
        discoveredNames,
        dependencyPaths,
      );
      collectLazyExportedNames(
        options,
        source.sourcePath,
        sourceFile,
        renderFactsByPath,
        knownFrontiers,
        discoveredNames,
        dependencyPaths,
      );

      if (discoveredNames.size === 0) continue;
      dependencyPaths.add(normalizedSourcePath);
      const nextNames = [...discoveredNames].sort();
      if (
        previous?.exportNames.length === nextNames.length &&
        nextNames.every((name, index) => name === previous.exportNames[index])
      ) {
        continue;
      }
      frontierByPath.set(normalizedSourcePath, {
        dependencyPaths: Object.freeze([...dependencyPaths].sort()),
        exportNames: Object.freeze(nextNames),
        sourcePath: normalizedSourcePath,
      });
      changed = true;
    }
    if (!changed) break;
  }
  return Object.freeze([...frontierByPath.values()]);
}

/** Adds names contributed by `export { X } from` and `export * from` declarations. */
function collectReexportedNames(
  options: CollectPreviewInspectorModuleFrontiersOptions,
  consumerPath: string,
  sourceFile: ts.SourceFile,
  frontiers: readonly PreviewInspectorModuleFrontier[],
  discoveredNames: Set<string>,
  dependencyPaths: Set<string>,
): void {
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.isTypeOnly ||
      statement.moduleSpecifier === undefined ||
      !ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      continue;
    }
    for (const frontier of frontiers) {
      if (
        !doesModuleSpecifierMatch(options, statement.moduleSpecifier.text, consumerPath, frontier)
      ) {
        continue;
      }
      for (const exportedName of readReexportNames(statement, frontier.exportNames)) {
        discoveredNames.add(exportedName);
      }
      addFrontierDependencies(frontier, dependencyPaths);
    }
  }
}

/** Adds public component values created by a statically proven React.lazy dynamic import. */
function collectLazyExportedNames(
  options: CollectPreviewInspectorModuleFrontiersOptions,
  consumerPath: string,
  sourceFile: ts.SourceFile,
  renderFactsByPath: Map<string, PreviewRenderModuleFacts>,
  frontiers: readonly PreviewInspectorModuleFrontier[],
  discoveredNames: Set<string>,
  dependencyPaths: Set<string>,
): void {
  if (
    !sourceFile.text.includes('lazy') ||
    !sourceFile.text.includes('import(') ||
    !mayContainLazyFrontierReference(sourceFile.text, frontiers)
  ) {
    return;
  }
  const normalizedPath = path.normalize(consumerPath);
  let facts = renderFactsByPath.get(normalizedPath);
  if (facts === undefined) {
    facts = collectPreviewRenderModuleFactsFromSourceFile(normalizedPath, sourceFile);
    renderFactsByPath.set(normalizedPath, facts);
  }
  const valueById = new Map(facts.values.map((value) => [value.id, value]));
  for (const lazyImport of facts.lazyImports) {
    const owner = valueById.get(lazyImport.ownerId);
    if (owner === undefined) continue;
    const publicNames = facts.exports
      .filter(
        (exportFact) =>
          exportFact.localName === owner.localName &&
          (exportFact.exportName === 'default' || /^\p{Lu}/u.test(exportFact.exportName)),
      )
      .map((exportFact) => exportFact.exportName);
    if (publicNames.length === 0) continue;
    for (const frontier of frontiers) {
      if (
        !frontier.exportNames.includes(lazyImport.importedName) ||
        !doesModuleSpecifierMatch(options, lazyImport.moduleSpecifier, consumerPath, frontier)
      ) {
        continue;
      }
      for (const publicName of publicNames) discoveredNames.add(publicName);
      addFrontierDependencies(frontier, dependencyPaths);
    }
  }
}

/**
 * Rejects unrelated lazy registries before the richer render-fact pass. Basenames and directory
 * names are only a performance prefilter; exact resolver/import checks still own correctness.
 */
function mayContainLazyFrontierReference(
  sourceText: string,
  frontiers: readonly PreviewInspectorModuleFrontier[],
): boolean {
  return frontiers.some((frontier) => {
    const basename = path.basename(frontier.sourcePath).replace(/(?:\.d)?\.[cm]?[jt]sx?$/iu, '');
    const directoryName = path.basename(path.dirname(frontier.sourcePath));
    return (
      (basename.length > 1 && sourceText.includes(basename)) ||
      (basename === 'index' && directoryName.length > 1 && sourceText.includes(directoryName)) ||
      frontier.exportNames.some(
        (exportName) =>
          exportName !== 'default' && exportName.length > 1 && sourceText.includes(exportName),
      )
    );
  });
}

/** Uses the project resolver first, then the existing exact lexical/alias identity predicate. */
function doesModuleSpecifierMatch(
  options: CollectPreviewInspectorModuleFrontiersOptions,
  moduleSpecifier: string,
  consumerPath: string,
  frontier: PreviewInspectorModuleFrontier,
): boolean {
  const resolvedPath = options.resolveModule?.(moduleSpecifier, consumerPath);
  if (
    resolvedPath !== undefined &&
    path.normalize(resolvedPath) === path.normalize(frontier.sourcePath)
  ) {
    return true;
  }
  const acceptedSpecifiers =
    path.normalize(frontier.sourcePath) === path.normalize(options.targetPath)
      ? new Set(options.acceptedImportSpecifiers)
      : new Set<string>();
  return (
    matchesPreviewParentSliceTargetImport(
      moduleSpecifier,
      consumerPath,
      frontier.sourcePath,
      acceptedSpecifiers,
    ) || options.matchesTargetImport?.(moduleSpecifier, consumerPath, frontier.sourcePath) === true
  );
}

/** Maps source-side frontier names to the public names contributed by one export clause. */
function readReexportNames(
  statement: ts.ExportDeclaration,
  frontierNames: readonly string[],
): readonly string[] {
  const clause = statement.exportClause;
  if (clause === undefined) return frontierNames.filter((name) => name !== 'default');
  if (!ts.isNamedExports(clause)) return [];
  const selectedNames = new Set(frontierNames);
  return clause.elements.flatMap((element) => {
    const importedName = (element.propertyName ?? element.name).text;
    return !element.isTypeOnly && selectedNames.has(importedName) ? [element.name.text] : [];
  });
}

/** Carries all previous transparent wrapper files into the newly discovered frontier. */
function addFrontierDependencies(
  frontier: PreviewInspectorModuleFrontier,
  dependencyPaths: Set<string>,
): void {
  for (const dependencyPath of frontier.dependencyPaths) dependencyPaths.add(dependencyPath);
}

/** Parses one candidate once while preserving the caller-owned bounded AST cache. */
function readSourceFile(
  source: PreviewInspectorFrontierSource,
  sourceFileByPath: Map<string, ts.SourceFile>,
): ts.SourceFile {
  const normalizedPath = path.normalize(source.sourcePath);
  const cached = sourceFileByPath.get(normalizedPath);
  if (cached !== undefined) return cached;
  const sourceFile = ts.createSourceFile(
    normalizedPath,
    source.sourceText,
    ts.ScriptTarget.Latest,
    true,
    normalizedPath.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  sourceFileByPath.set(normalizedPath, sourceFile);
  return sourceFile;
}
