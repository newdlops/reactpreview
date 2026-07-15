/**
 * Selects the one runtime export rendered by a React preview without evaluating workspace code.
 * TypeScript's TSX-aware parser distinguishes value declarations from erased types, allowing the
 * target bridge to preserve default-only tree shaking even when a component uses a named export.
 */
import path from 'node:path';
import ts from 'typescript';
import { PreviewCompilationError, type PreviewDiagnostic } from '../../domain/preview';

/** Immutable export choice consumed by the virtual target bridge. */
export interface PreviewTargetExportSelection {
  /** Runtime export name that the bridge must expose as its own default export. */
  readonly exportName: string;
}

/** Runtime named export together with the source node used for actionable diagnostics. */
interface RuntimeNamedExport {
  /** Identifier visible to modules importing the selected source file. */
  readonly name: string;
  /** Exporting syntax whose start position belongs to the selected source file. */
  readonly node: ts.Node;
}

/** Complete non-evaluating inventory needed by the deterministic selection policy. */
interface RuntimeExportInventory {
  /** First syntax node that supplies a runtime default export, when present. */
  readonly defaultExportNode?: ts.Node;
  /** Runtime named exports in stable source order with duplicate names removed. */
  readonly namedExports: readonly RuntimeNamedExport[];
}

/**
 * Chooses a default or unambiguous PascalCase named export for the selected preview document.
 * The caller supplies the current editor text, so unsaved export changes participate immediately.
 * Selection order is deliberately narrow: runtime default, filename-derived exact name, then the
 * only PascalCase named runtime export. Arbitrary first-export selection is never performed.
 *
 * @param documentPath Absolute selected-document path used for grammar and diagnostics.
 * @param sourceText Current editor source, which may be newer than the filesystem copy.
 * @returns Export name that the target bridge should re-export as `default`.
 * @throws PreviewCompilationError when syntax is invalid or no deterministic component exists.
 */
export function selectPreviewTargetExport(
  documentPath: string,
  sourceText: string,
): PreviewTargetExportSelection {
  const sourceFile = createSourceFile(documentPath, sourceText);
  assertSyntacticallyValid(sourceFile, documentPath);
  const inventory = collectRuntimeExports(sourceFile);
  if (inventory.defaultExportNode !== undefined) {
    return { exportName: 'default' };
  }

  const pascalCaseExports = inventory.namedExports.filter((candidate) =>
    isPascalCaseIdentifier(candidate.name),
  );
  const filenameExportName = createPascalCaseBasename(documentPath);
  const filenameMatch = pascalCaseExports.find(
    (candidate) => candidate.name === filenameExportName,
  );
  if (filenameMatch !== undefined) {
    return { exportName: filenameMatch.name };
  }
  if (pascalCaseExports.length === 1) {
    return { exportName: pascalCaseExports[0]?.name ?? 'default' };
  }

  throw createSelectionError(documentPath, sourceFile, inventory, pascalCaseExports);
}

/** Creates one TSX-aware source file without resolving modules or executing configuration. */
function createSourceFile(documentPath: string, sourceText: string): ts.SourceFile {
  return ts.createSourceFile(
    documentPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(documentPath),
  );
}

/** Maps supported source suffixes to the parser grammar used by the compiler loader policy. */
function getScriptKind(documentPath: string): ts.ScriptKind {
  const normalizedPath = documentPath.toLowerCase();
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
  return ts.ScriptKind.JSX;
}

/**
 * Rejects TypeScript parser recovery before an incomplete AST can produce a misleading export error.
 */
function assertSyntacticallyValid(sourceFile: ts.SourceFile, documentPath: string): void {
  const diagnostics = (
    sourceFile as ts.SourceFile & {
      readonly parseDiagnostics?: readonly ts.DiagnosticWithLocation[];
    }
  ).parseDiagnostics;
  const diagnostic = diagnostics?.[0];
  if (diagnostic === undefined) {
    return;
  }

  const position = sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  const previewDiagnostic: PreviewDiagnostic = {
    location: {
      column: position.character,
      file: documentPath,
      line: position.line + 1,
    },
    message,
    severity: 'error',
  };
  throw new PreviewCompilationError(
    `React Preview could not parse ${path.basename(documentPath)}: ${message}`,
    [previewDiagnostic],
  );
}

/** Inventories top-level ESM runtime exports while excluding erased and ambient declarations. */
function collectRuntimeExports(sourceFile: ts.SourceFile): RuntimeExportInventory {
  const runtimeBindings = collectRuntimeBindings(sourceFile);
  const namedExports: RuntimeNamedExport[] = [];
  const seenNames = new Set<string>();
  let defaultExportNode: ts.Node | undefined;

  /** Records one named runtime export once while preserving source order. */
  function addNamedExport(name: string, node: ts.Node): void {
    if (seenNames.has(name)) {
      return;
    }
    seenNames.add(name);
    namedExports.push({ name, node });
  }

  for (const statement of sourceFile.statements) {
    if (isRuntimeDefaultExport(statement, runtimeBindings)) {
      defaultExportNode ??= statement;
    }
    collectDirectNamedExports(statement, runtimeBindings, addNamedExport);
  }

  return defaultExportNode === undefined ? { namedExports } : { defaultExportNode, namedExports };
}

/** Collects top-level value bindings that a local export clause can reference at runtime. */
function collectRuntimeBindings(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const bindings = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (hasDeclareModifier(statement)) {
      continue;
    }

    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isModuleDeclaration(statement)
    ) {
      if (statement.name !== undefined && ts.isIdentifier(statement.name)) {
        bindings.add(statement.name.text);
      }
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectBindingNames(declaration.name, bindings);
      }
      continue;
    }
    if (ts.isImportDeclaration(statement)) {
      collectImportBindings(statement, bindings);
      continue;
    }
    if (ts.isImportEqualsDeclaration(statement) && !statement.isTypeOnly) {
      bindings.add(statement.name.text);
    }
  }
  return bindings;
}

/** Recursively extracts identifiers from object and array variable binding patterns. */
function collectBindingNames(bindingName: ts.BindingName, bindings: Set<string>): void {
  if (ts.isIdentifier(bindingName)) {
    bindings.add(bindingName.text);
    return;
  }
  for (const element of bindingName.elements) {
    if (!ts.isOmittedExpression(element)) {
      collectBindingNames(element.name, bindings);
    }
  }
}

/** Adds non-type-only ES import bindings that may later be exported from the target module. */
function collectImportBindings(statement: ts.ImportDeclaration, bindings: Set<string>): void {
  const clause = statement.importClause;
  if (clause === undefined || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) {
    return;
  }
  if (clause.name !== undefined) {
    bindings.add(clause.name.text);
  }
  const namedBindings = clause.namedBindings;
  if (namedBindings === undefined) {
    return;
  }
  if (ts.isNamespaceImport(namedBindings)) {
    bindings.add(namedBindings.name.text);
    return;
  }
  for (const element of namedBindings.elements) {
    if (!element.isTypeOnly) {
      bindings.add(element.name.text);
    }
  }
}

/** Reports whether one top-level statement supplies a non-erased ESM default export. */
function isRuntimeDefaultExport(
  statement: ts.Statement,
  runtimeBindings: ReadonlySet<string>,
): boolean {
  if (ts.isExportAssignment(statement)) {
    return true;
  }
  if (isCommonJsDefaultAssignment(statement)) {
    return true;
  }
  if (
    (ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement)) &&
    !hasDeclareModifier(statement)
  ) {
    return (
      hasModifier(statement, ts.SyntaxKind.ExportKeyword) &&
      hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
    );
  }
  if (!ts.isExportDeclaration(statement) || statement.exportClause === undefined) {
    return false;
  }
  if (statement.isTypeOnly || !ts.isNamedExports(statement.exportClause)) {
    return false;
  }
  return statement.exportClause.elements.some((element) => {
    if (element.isTypeOnly || element.name.text !== 'default') {
      return false;
    }
    return (
      statement.moduleSpecifier !== undefined ||
      runtimeBindings.has((element.propertyName ?? element.name).text)
    );
  });
}

/** Recognizes the conventional top-level `module.exports = value` CommonJS default boundary. */
function isCommonJsDefaultAssignment(statement: ts.Statement): boolean {
  if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) {
    return false;
  }

  const assignment = statement.expression;
  if (assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
    return false;
  }
  const target = assignment.left;
  if (ts.isPropertyAccessExpression(target)) {
    return (
      ts.isIdentifier(target.expression) &&
      target.expression.text === 'module' &&
      target.name.text === 'exports'
    );
  }
  if (!ts.isElementAccessExpression(target) || !ts.isIdentifier(target.expression)) {
    return false;
  }

  const propertyName = target.argumentExpression;
  return (
    target.expression.text === 'module' &&
    ts.isStringLiteralLike(propertyName) &&
    propertyName.text === 'exports'
  );
}

/**
 * Adds named value exports from declarations, clauses, and namespace re-exports.
 *
 * @param statement Top-level syntax being classified.
 * @param runtimeBindings Local value bindings used to reject `export { SomeType }`.
 * @param addNamedExport Stable collector owned by the inventory function.
 */
function collectDirectNamedExports(
  statement: ts.Statement,
  runtimeBindings: ReadonlySet<string>,
  addNamedExport: (name: string, node: ts.Node) => void,
): void {
  if (hasDeclareModifier(statement) || !hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
    if (ts.isExportDeclaration(statement)) {
      collectExportClauseNames(statement, runtimeBindings, addNamedExport);
    }
    return;
  }

  if (
    (ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isModuleDeclaration(statement)) &&
    !hasModifier(statement, ts.SyntaxKind.DefaultKeyword) &&
    statement.name !== undefined &&
    ts.isIdentifier(statement.name)
  ) {
    addNamedExport(statement.name.text, statement.name);
    return;
  }
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      const names = new Set<string>();
      collectBindingNames(declaration.name, names);
      for (const name of names) {
        addNamedExport(name, declaration.name);
      }
    }
    return;
  }
  if (ts.isImportEqualsDeclaration(statement) && !statement.isTypeOnly) {
    addNamedExport(statement.name.text, statement.name);
  }
}

/** Adds runtime names exposed by `export { ... }` and `export * as Name from ...` clauses. */
function collectExportClauseNames(
  statement: ts.ExportDeclaration,
  runtimeBindings: ReadonlySet<string>,
  addNamedExport: (name: string, node: ts.Node) => void,
): void {
  const clause = statement.exportClause;
  if (statement.isTypeOnly || clause === undefined) {
    return;
  }
  if (ts.isNamespaceExport(clause)) {
    if (ts.isIdentifier(clause.name)) {
      addNamedExport(clause.name.text, clause.name);
    }
    return;
  }
  for (const element of clause.elements) {
    if (element.isTypeOnly || element.name.text === 'default' || !ts.isIdentifier(element.name)) {
      continue;
    }
    const localName = element.propertyName ?? element.name;
    if (statement.moduleSpecifier !== undefined || runtimeBindings.has(localName.text)) {
      addNamedExport(element.name.text, element.name);
    }
  }
}

/** Reports whether a declaration carries TypeScript's ambient `declare` modifier. */
function hasDeclareModifier(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.DeclareKeyword);
}

/** Reads declaration modifiers through TypeScript's public compatibility helpers. */
function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) === true
  );
}

/** Converts the selected filename stem from kebab/snake/dot form into a PascalCase identifier. */
function createPascalCaseBasename(documentPath: string): string {
  const filename = path.basename(documentPath);
  const extension = path.extname(filename);
  const stem = filename.slice(0, filename.length - extension.length);
  return stem
    .split(/[^\p{L}\p{N}]+/u)
    .filter((part) => part.length > 0)
    .map(capitalizeFirstCodePoint)
    .join('');
}

/** Uppercases one Unicode code point while preserving the remaining identifier spelling. */
function capitalizeFirstCodePoint(value: string): string {
  const firstCodePointValue = value.codePointAt(0);
  if (firstCodePointValue === undefined) {
    return '';
  }
  const firstCodePoint = String.fromCodePoint(firstCodePointValue);
  return `${firstCodePoint.toLocaleUpperCase('en-US')}${value.slice(firstCodePoint.length)}`;
}

/** Restricts implicit component candidates to identifier-shaped names beginning with an uppercase letter. */
function isPascalCaseIdentifier(name: string): boolean {
  return /^\p{Lu}[$_\p{L}\p{N}\u200C\u200D]*$/u.test(name);
}

/** Creates a domain failure whose diagnostic identifies the real target and ambiguous candidates. */
function createSelectionError(
  documentPath: string,
  sourceFile: ts.SourceFile,
  inventory: RuntimeExportInventory,
  pascalCaseExports: readonly RuntimeNamedExport[],
): PreviewCompilationError {
  const ambiguous = pascalCaseExports.length > 1;
  const namedExports = inventory.namedExports.map((candidate) => candidate.name);
  const candidates = ambiguous
    ? pascalCaseExports.map((candidate) => candidate.name)
    : namedExports;
  const candidateText = candidates.length === 0 ? 'none' : candidates.join(', ');
  const message = ambiguous
    ? `The selected module has no runtime default export and multiple PascalCase component candidates: ${candidateText}. Add a default export to select one component.`
    : `The selected module has no runtime default export or unambiguous PascalCase component export. Named runtime exports: ${candidateText}. Export the preview component as default.`;
  const locationNode = pascalCaseExports[0]?.node ?? inventory.namedExports[0]?.node;
  const position = sourceFile.getLineAndCharacterOfPosition(
    locationNode?.getStart(sourceFile) ?? 0,
  );
  const diagnostic: PreviewDiagnostic = {
    location: {
      column: position.character,
      file: documentPath,
      line: position.line + 1,
    },
    message,
    severity: 'error',
  };
  return new PreviewCompilationError(
    `React Preview could not choose a component export from ${path.basename(documentPath)}.`,
    [diagnostic],
  );
}
