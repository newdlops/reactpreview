/**
 * Discovers exported styled-components global styles along one proven application render corridor.
 * The traversal follows only component bindings used by the selected path, never executes project
 * code, and stays bounded so a large route catalog cannot turn style recovery into a project scan.
 */
import path from 'node:path';
import ts from 'typescript';
import type { PreviewRenderChainCandidate } from './renderGraph/previewRenderGraphTypes';
import type { ReadPreviewStyleContextSource } from './preparePreviewStyleContext';
import type { PreviewStaticModuleResolver } from './previewStaticModuleResolver';

const MAX_GLOBAL_STYLE_SOURCE_BYTES = 1024 * 1024;
const MAX_GLOBAL_STYLE_MODULES = 32;
const MAX_GLOBAL_STYLE_IMPORTS = 8;
const MAX_PENDING_STYLE_MODULES = 128;

/** One exact exported `createGlobalStyle` value safe to mount inside the preview theme boundary. */
export interface PreviewGlobalStyleImportSelection {
  /** Runtime export name used by the generated inspector root import. */
  readonly exportName: string;
  /** Absolute resolved project module containing the global style component. */
  readonly moduleSpecifier: string;
}

/** Inputs for bounded component-binding traversal from an entry-connected render candidate. */
export interface SelectPreviewGlobalStylesOptions {
  /** Highest-ranked target-to-entry path selected by Page Inspector. */
  readonly renderPath?: PreviewRenderChainCandidate;
  /** Cached, size-bounded source reader shared with theme discovery. */
  readonly readSource: ReadPreviewStyleContextSource;
  /** Project-aware alias and extension resolver that never evaluates configuration code. */
  readonly resolveModule: PreviewStaticModuleResolver['resolve'];
}

/** One pending source module plus the exports or local declarations relevant to the render path. */
interface PendingStyleModule {
  /** Imported export names or corridor declaration names to inspect. */
  readonly activeNames: readonly string[];
  /** Absolute project source path. */
  readonly sourcePath: string;
}

/** Static import binding used to continue traversal into one project module. */
interface ComponentImportBinding {
  /** Export name expected in the resolved child module. */
  readonly exportName: string;
  /** Local identifier referenced by the current component body. */
  readonly localName: string;
  /** Authored module request resolved by the project-aware static resolver. */
  readonly moduleSpecifier: string;
}

/** Parsed source facts needed for one small component-flow step. */
interface GlobalStyleSourceFacts {
  /** Import bindings keyed by their local identifier. */
  readonly importsByLocalName: ReadonlyMap<string, ComponentImportBinding>;
  /** Local declarations used to expand wrapper factories such as `nest(AppBase, ...)`. */
  readonly localDeclarations: ReadonlyMap<string, ts.Node>;
  /** Local identifier corresponding to each public export name. */
  readonly localNameByExport: ReadonlyMap<string, string>;
  /** Local bindings imported as styled-components `createGlobalStyle`. */
  readonly createGlobalStyleNames: ReadonlySet<string>;
  /** Namespace bindings imported from styled-components. */
  readonly styledComponentNamespaces: ReadonlySet<string>;
}

/**
 * Finds global style components used by the app wrappers above the selected safe page root.
 *
 * @param options Primary render corridor plus cached source and module-resolution boundaries.
 * @returns Deduplicated exact imports in deterministic module/export order.
 */
export async function selectPreviewGlobalStyleImports(
  options: SelectPreviewGlobalStylesOptions,
): Promise<readonly PreviewGlobalStyleImportSelection[]> {
  if (options.renderPath === undefined) return [];
  const pending = createInitialStyleModules(options.renderPath);
  const processedNamesByPath = new Map<string, Set<string>>();
  const selectionByIdentity = new Map<string, PreviewGlobalStyleImportSelection>();
  let inspectedModules = 0;

  while (
    pending.length > 0 &&
    inspectedModules < MAX_GLOBAL_STYLE_MODULES &&
    selectionByIdentity.size < MAX_GLOBAL_STYLE_IMPORTS
  ) {
    pending.sort(comparePendingStyleModules);
    const current = pending.shift();
    if (current === undefined) break;
    const normalizedPath = path.normalize(current.sourcePath);
    const processedNames = processedNamesByPath.get(normalizedPath) ?? new Set<string>();
    const unprocessedNames = current.activeNames.filter((name) => !processedNames.has(name));
    if (unprocessedNames.length === 0) continue;
    for (const name of unprocessedNames) processedNames.add(name);
    processedNamesByPath.set(normalizedPath, processedNames);

    const sourceText = await options.readSource({
      maximumBytes: MAX_GLOBAL_STYLE_SOURCE_BYTES,
      sourcePath: normalizedPath,
    });
    if (sourceText === undefined) continue;
    inspectedModules += 1;
    const sourceFile = createSourceFile(normalizedPath, sourceText);
    if (hasParseDiagnostics(sourceFile)) continue;
    const facts = collectGlobalStyleSourceFacts(sourceFile);
    const relevantLocalNames = collectRelevantLocalNames(unprocessedNames, facts);

    for (const exportName of unprocessedNames) {
      const localName = facts.localNameByExport.get(exportName) ?? exportName;
      const declaration = facts.localDeclarations.get(localName);
      if (declaration === undefined || !isGlobalStyleDeclaration(declaration, facts)) continue;
      const selection = { exportName, moduleSpecifier: normalizedPath };
      selectionByIdentity.set(JSON.stringify([normalizedPath, exportName]), selection);
    }

    const relevantImports = [...relevantLocalNames]
      .flatMap((localName) => {
        const imported = facts.importsByLocalName.get(localName);
        return imported === undefined ? [] : [imported];
      })
      .sort(compareComponentImportBindings);
    for (const imported of relevantImports) {
      const resolvedPath = options.resolveModule(imported.moduleSpecifier, normalizedPath);
      if (resolvedPath === undefined) continue;
      pending.push({ activeNames: [imported.exportName], sourcePath: resolvedPath });
      if (pending.length >= MAX_PENDING_STYLE_MODULES) break;
    }
  }

  return [...selectionByIdentity.values()].sort((left, right) => {
    const moduleOrder = compareText(left.moduleSpecifier, right.moduleSpecifier);
    return moduleOrder === 0 ? compareText(left.exportName, right.exportName) : moduleOrder;
  });
}

/** Seeds each corridor source with the declarations and wrappers proven at that exact step. */
function createInitialStyleModules(renderPath: PreviewRenderChainCandidate): PendingStyleModule[] {
  const namesByPath = new Map<string, Set<string>>();
  for (const step of renderPath.steps) {
    const names = namesByPath.get(step.sourcePath) ?? new Set<string>();
    if (isIdentifierName(step.label)) names.add(step.label);
    for (const wrapperName of step.wrapperNames) {
      if (isIdentifierName(wrapperName)) names.add(wrapperName);
    }
    namesByPath.set(step.sourcePath, names);
  }
  if (renderPath.entryPoint !== undefined) {
    const names = namesByPath.get(renderPath.entryPoint.sourcePath) ?? new Set<string>();
    for (const wrapperName of renderPath.entryPoint.wrapperNames) {
      if (isIdentifierName(wrapperName)) names.add(wrapperName);
    }
    namesByPath.set(renderPath.entryPoint.sourcePath, names);
  }
  return [...namesByPath.entries()]
    .filter(([, names]) => names.size > 0)
    .map(([sourcePath, names]) => ({ activeNames: [...names], sourcePath }));
}

/** Parses one project source with its exact JS/TS and JSX/TSX grammar. */
function createSourceFile(sourcePath: string, sourceText: string): ts.SourceFile {
  const extension = path.extname(sourcePath).toLowerCase();
  const scriptKind =
    extension === '.tsx'
      ? ts.ScriptKind.TSX
      : extension === '.jsx'
        ? ts.ScriptKind.JSX
        : extension === '.js' || extension === '.mjs' || extension === '.cjs'
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS;
  return ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
}

/** Rejects parser-recovered sources so incomplete editor text cannot create partial style imports. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  return (
    ((
      sourceFile as ts.SourceFile & {
        readonly parseDiagnostics?: readonly ts.Diagnostic[];
      }
    ).parseDiagnostics?.length ?? 0) > 0
  );
}

/** Collects imports, exports, declarations, and styled-components factory bindings. */
function collectGlobalStyleSourceFacts(sourceFile: ts.SourceFile): GlobalStyleSourceFacts {
  const importsByLocalName = new Map<string, ComponentImportBinding>();
  const localDeclarations = new Map<string, ts.Node>();
  const localNameByExport = new Map<string, string>();
  const createGlobalStyleNames = new Set<string>();
  const styledComponentNamespaces = new Set<string>();

  for (const statement of sourceFile.statements) {
    collectImportFacts(
      statement,
      importsByLocalName,
      createGlobalStyleNames,
      styledComponentNamespaces,
    );
    collectDeclarationFacts(statement, localDeclarations, localNameByExport);
    collectExportFacts(statement, localNameByExport);
  }
  return {
    createGlobalStyleNames,
    importsByLocalName,
    localDeclarations,
    localNameByExport,
    styledComponentNamespaces,
  };
}

/** Records local/imported names while retaining styled-components factory identity. */
function collectImportFacts(
  statement: ts.Statement,
  importsByLocalName: Map<string, ComponentImportBinding>,
  createGlobalStyleNames: Set<string>,
  styledComponentNamespaces: Set<string>,
): void {
  if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
    return;
  }
  const moduleSpecifier = statement.moduleSpecifier.text;
  const clause = statement.importClause;
  if (clause?.name !== undefined) {
    importsByLocalName.set(clause.name.text, {
      exportName: 'default',
      localName: clause.name.text,
      moduleSpecifier,
    });
  }
  const bindings = clause?.namedBindings;
  if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
    importsByLocalName.set(bindings.name.text, {
      exportName: '*',
      localName: bindings.name.text,
      moduleSpecifier,
    });
    if (moduleSpecifier === 'styled-components') styledComponentNamespaces.add(bindings.name.text);
  }
  if (bindings === undefined || !ts.isNamedImports(bindings)) return;
  for (const element of bindings.elements) {
    const importedName = (element.propertyName ?? element.name).text;
    importsByLocalName.set(element.name.text, {
      exportName: importedName,
      localName: element.name.text,
      moduleSpecifier,
    });
    if (moduleSpecifier === 'styled-components' && importedName === 'createGlobalStyle') {
      createGlobalStyleNames.add(element.name.text);
    }
  }
}

/** Records top-level declarations and their direct public export names. */
function collectDeclarationFacts(
  statement: ts.Statement,
  localDeclarations: Map<string, ts.Node>,
  localNameByExport: Map<string, string>,
): void {
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
    if (statement.name !== undefined) {
      localDeclarations.set(statement.name.text, statement);
      if (hasExportModifier(statement))
        localNameByExport.set(statement.name.text, statement.name.text);
      if (hasDefaultModifier(statement)) localNameByExport.set('default', statement.name.text);
    }
    return;
  }
  if (!ts.isVariableStatement(statement)) return;
  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name)) continue;
    localDeclarations.set(declaration.name.text, declaration);
    if (hasExportModifier(statement)) {
      localNameByExport.set(declaration.name.text, declaration.name.text);
    }
  }
}

/** Records named re-exports and `export default LocalBinding` aliases. */
function collectExportFacts(statement: ts.Statement, localNameByExport: Map<string, string>): void {
  if (
    ts.isExportAssignment(statement) &&
    !statement.isExportEquals &&
    ts.isIdentifier(statement.expression)
  ) {
    localNameByExport.set('default', statement.expression.text);
    return;
  }
  if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier !== undefined) return;
  const clause = statement.exportClause;
  if (clause === undefined || !ts.isNamedExports(clause)) return;
  for (const element of clause.elements) {
    localNameByExport.set(element.name.text, (element.propertyName ?? element.name).text);
  }
}

/**
 * Expands active declarations through local wrapper factories, then returns used import bindings.
 * Only identifiers reachable from the selected component declarations are followed.
 */
function collectRelevantLocalNames(
  activeNames: readonly string[],
  facts: GlobalStyleSourceFacts,
): ReadonlySet<string> {
  const relevantNames = new Set<string>();
  const pendingNodes: ts.Node[] = [];
  for (const activeName of activeNames) {
    const localName = facts.localNameByExport.get(activeName) ?? activeName;
    const declaration = facts.localDeclarations.get(localName);
    if (declaration !== undefined) pendingNodes.push(declaration);
  }
  const expandedDeclarations = new Set<string>();
  while (pendingNodes.length > 0) {
    const node = pendingNodes.pop();
    if (node === undefined) continue;
    visitIdentifiers(node, (identifier) => relevantNames.add(identifier.text));
    for (const localName of [...relevantNames]) {
      if (expandedDeclarations.has(localName)) continue;
      const declaration = facts.localDeclarations.get(localName);
      if (declaration === undefined) continue;
      expandedDeclarations.add(localName);
      pendingNodes.push(declaration);
    }
  }
  return relevantNames;
}

/** Visits identifier references below a selected declaration without crossing into other files. */
function visitIdentifiers(node: ts.Node, visit: (identifier: ts.Identifier) => void): void {
  if (ts.isIdentifier(node)) visit(node);
  ts.forEachChild(node, (child) => {
    visitIdentifiers(child, visit);
  });
}

/** Reports whether a selected declaration is initialized by the proven styled-components factory. */
function isGlobalStyleDeclaration(declaration: ts.Node, facts: GlobalStyleSourceFacts): boolean {
  const initializer = ts.isVariableDeclaration(declaration) ? declaration.initializer : undefined;
  if (initializer === undefined) return false;
  const factory = ts.isTaggedTemplateExpression(initializer)
    ? initializer.tag
    : ts.isCallExpression(initializer)
      ? initializer.expression
      : undefined;
  if (factory === undefined) return false;
  if (ts.isIdentifier(factory)) return facts.createGlobalStyleNames.has(factory.text);
  return (
    ts.isPropertyAccessExpression(factory) &&
    factory.name.text === 'createGlobalStyle' &&
    ts.isIdentifier(factory.expression) &&
    facts.styledComponentNamespaces.has(factory.expression.text)
  );
}

/** Reports a normal ECMAScript identifier suitable for declaration lookup. */
function isIdentifierName(candidate: string): boolean {
  return /^[$_\p{ID_Start}][$\u200C\u200D\p{ID_Continue}]*$/u.test(candidate);
}

/** Detects direct `export` modifiers on declarations and variable statements. */
function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ===
      true
  );
}

/** Detects direct `default` modifiers on named function or class declarations. */
function hasDefaultModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ===
      true
  );
}

/** Stable code-point comparison independent of host locale. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Prioritizes app shells, providers, themes, and global styles before unrelated routed branches. */
function comparePendingStyleModules(left: PendingStyleModule, right: PendingStyleModule): number {
  const priorityOrder =
    scoreStyleIdentity(left.activeNames.join(' '), left.sourcePath) -
    scoreStyleIdentity(right.activeNames.join(' '), right.sourcePath);
  return priorityOrder === 0 ? compareText(left.sourcePath, right.sourcePath) : priorityOrder;
}

/** Applies the same style-focused order before resolved child modules enter the bounded queue. */
function compareComponentImportBindings(
  left: ComponentImportBinding,
  right: ComponentImportBinding,
): number {
  const priorityOrder =
    scoreStyleIdentity(left.localName, left.moduleSpecifier) -
    scoreStyleIdentity(right.localName, right.moduleSpecifier);
  return priorityOrder === 0
    ? compareText(left.moduleSpecifier, right.moduleSpecifier)
    : priorityOrder;
}

/** Returns a small generic relevance rank without relying on any project-specific identifier. */
function scoreStyleIdentity(name: string, moduleSpecifier: string): number {
  const identity = `${name} ${moduleSpecifier}`;
  if (/global[-_ ]?style|style[-_ ]?global/iu.test(identity)) return 0;
  if (/app[-_ ]?base|theme[-_ ]?provider/iu.test(identity)) return 1;
  if (/provider|layout|shell|root|app(?:\.[cm]?[jt]sx?)?$/iu.test(identity)) return 2;
  return 10;
}
