/**
 * Inventories previewable runtime exports and an optional imported styled-components theme.
 * TypeScript's TSX-aware parser lets the compiler use the current editor snapshot without
 * evaluating workspace modules, while one statement-order pass preserves the author's export
 * order for the sequential component gallery.
 */
import path from 'node:path';
import ts from 'typescript';
import { PreviewCompilationError, type PreviewDiagnostic } from '../../domain/preview';
import { collectPreviewGraphqlDocumentExportNames } from './previewGraphqlDocumentExports';

/** One statically named runtime export that the target bridge can import directly. */
export interface PreviewExplicitTargetExportSlot {
  /** Discriminator used by the bridge when generating a direct import. */
  readonly kind: 'explicit';
  /** Name visible on the selected module's runtime namespace. */
  readonly exportName: string;
  /** Human-readable component label shown above this gallery entry. */
  readonly displayName: string;
}

/** Position occupied by a bare `export *` whose names are unavailable in the active-file AST. */
export interface PreviewWildcardTargetExportSlot {
  /** Discriminator instructing the bridge to discover eligible namespace values at runtime. */
  readonly kind: 'wildcard';
}

/** Ordered export syntax consumed by the plural target bridge. */
export type PreviewTargetExportSlot =
  PreviewExplicitTargetExportSlot | PreviewWildcardTargetExportSlot;

/** Suffixes that strongly identify rendered React owners without project naming configuration. */
const PRIMARY_COMPONENT_NAME_PATTERN =
  /(?:App|Page|Screen|View|Layout|Template|Section|Panel|Modal|Dialog|Drawer|Form|Field|Input|Select|Button|Link|Table|List|Item|Row|Card|Header|Footer|Nav|Menu|Sidebar|Content|Container|Provider|Boundary|Renderer|Preview|Target)$/u;

/** Runtime values commonly exported beside components but never mounted as React element types. */
const NON_COMPONENT_NAME_PATTERN =
  /(?:Fragment|Query|Mutation|Subscription|Context|Config|Theme|Schema|Enum|Options|Constants?)$/u;

/** Exact theme export that can be imported without loading an application bootstrap module. */
export interface PreviewThemeImportSelection {
  /** Default or named export selected from the theme module. */
  readonly exportName: 'default' | 'theme';
  /** Unmodified module specifier already resolved successfully by the target source. */
  readonly moduleSpecifier: string;
}

/** Callback used by statement collectors to append one eligible explicit export exactly once. */
type AddExplicitExport = (exportName: string, displayName?: string) => void;

/**
 * Selects every statically identifiable component-shaped runtime export in source order.
 * Runtime defaults are always retained because default exports have no naming convention. Named
 * values must use PascalCase; erased declarations, ambient values, and lowercase helpers are
 * excluded. Bare value `export *` declarations remain positional wildcard slots for the bridge.
 *
 * @param documentPath Absolute selected-document path used for grammar and diagnostics.
 * @param sourceText Current editor source, which may be newer than the filesystem copy.
 * @returns Readonly gallery slots in top-level statement and export-clause order.
 * @throws PreviewCompilationError only when the current editor source is syntactically invalid.
 */
export function selectPreviewTargetExports(
  documentPath: string,
  sourceText: string,
): readonly PreviewTargetExportSlot[] {
  const sourceFile = createSourceFile(documentPath, sourceText);
  assertSyntacticallyValid(sourceFile, documentPath);
  const runtimeBindings = collectRuntimeBindings(sourceFile);
  const graphqlDocumentExports = collectPreviewGraphqlDocumentExportNames(sourceFile);
  const slots: PreviewTargetExportSlot[] = [];
  const seenExportNames = new Set<string>();

  /** Adds one default or PascalCase named export while preserving its first syntax position. */
  const addExplicitExport: AddExplicitExport = (exportName, displayName = exportName): void => {
    if (
      seenExportNames.has(exportName) ||
      graphqlDocumentExports.has(exportName) ||
      (exportName !== 'default' && !isPascalCaseIdentifier(exportName))
    ) {
      return;
    }
    seenExportNames.add(exportName);
    slots.push({ displayName, exportName, kind: 'explicit' });
  };

  for (const statement of sourceFile.statements) {
    collectStatementExportSlots(statement, runtimeBindings, slots, addExplicitExport);
  }
  return slots;
}

/**
 * Chooses the export whose callers should seed Page Inspector's application-path search.
 * Default remains authoritative. Otherwise component-role suffixes outrank neutral PascalCase
 * names. Statically proven GraphQL documents have already been removed from `slots`; unresolved
 * Context objects and screaming-snake values remain last-resort candidates so unusual component
 * naming never turns a valid file into an empty preview.
 */
export function selectPreviewPrimaryTargetExport(
  slots: readonly PreviewTargetExportSlot[],
): string | undefined {
  const explicit = slots.filter(
    (slot): slot is PreviewExplicitTargetExportSlot => slot.kind === 'explicit',
  );
  const defaultExport = explicit.find((slot) => slot.exportName === 'default');
  if (defaultExport !== undefined) return defaultExport.exportName;
  return [...explicit].sort(
    (left, right) =>
      scorePrimaryPreviewExport(right.exportName) - scorePrimaryPreviewExport(left.exportName),
  )[0]?.exportName;
}

/** Assigns only broad React-role evidence while preserving source order for equal candidates. */
function scorePrimaryPreviewExport(exportName: string): number {
  if (/^[A-Z][A-Z0-9_]*$/u.test(exportName) || NON_COMPONENT_NAME_PATTERN.test(exportName)) {
    return -1;
  }
  return PRIMARY_COMPONENT_NAME_PATTERN.test(exportName) ? 1 : 0;
}

/**
 * Finds one unambiguous theme already imported by a file that uses styled-components at runtime.
 * The conservative contract recognizes `import { theme }` by its imported export name, including
 * aliases, and `import theme` by its local name. It deliberately returns no choice when zero or
 * several candidates exist instead of guessing which object is the active styled theme.
 *
 * @param sourceText Current TSX-compatible editor source inspected without module resolution.
 * @returns Exact theme export and module specifier, or `undefined` when selection is unsafe.
 */
export function selectPreviewThemeImport(
  sourceText: string,
): PreviewThemeImportSelection | undefined {
  const sourceFile = createSourceFile('react-preview-theme-import.tsx', sourceText);
  if (!hasStyledComponentsValueImport(sourceFile)) {
    return undefined;
  }

  const candidates: PreviewThemeImportSelection[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
      continue;
    }
    collectThemeImportCandidates(statement, candidates);
  }
  return candidates.length === 1 ? candidates[0] : undefined;
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

/** Rejects parser recovery before an incomplete AST can produce misleading gallery slots. */
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

/**
 * Adds every eligible export contributed by one statement without reordering clause elements.
 *
 * @param statement Top-level syntax currently occupying the next source-order position.
 * @param runtimeBindings Local value names used to reject erased local export clauses.
 * @param slots Mutable result owned by the public selector.
 * @param addExplicitExport Deduplicating explicit-slot collector.
 */
function collectStatementExportSlots(
  statement: ts.Statement,
  runtimeBindings: ReadonlySet<string>,
  slots: PreviewTargetExportSlot[],
  addExplicitExport: AddExplicitExport,
): void {
  if (ts.isExportAssignment(statement)) {
    addExplicitExport('default', readExpressionDisplayName(statement.expression));
    return;
  }

  const commonJsExpression = readCommonJsDefaultExpression(statement);
  if (commonJsExpression !== undefined) {
    addExplicitExport('default', readExpressionDisplayName(commonJsExpression));
    return;
  }

  if (ts.isExportDeclaration(statement)) {
    collectExportDeclarationSlots(statement, runtimeBindings, slots, addExplicitExport);
    return;
  }

  if (hasDeclareModifier(statement) || !hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
    return;
  }

  if (
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isEnumDeclaration(statement)
  ) {
    if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
      addExplicitExport('default', statement.name?.text ?? 'default');
    } else if (statement.name !== undefined) {
      addExplicitExport(statement.name.text);
    }
    return;
  }

  if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)) {
    addExplicitExport(statement.name.text);
    return;
  }

  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      const names: string[] = [];
      collectBindingNames(declaration.name, names);
      for (const name of names) {
        addExplicitExport(name);
      }
    }
    return;
  }

  if (ts.isImportEqualsDeclaration(statement) && !statement.isTypeOnly) {
    addExplicitExport(statement.name.text);
  }
}

/** Adds an explicit clause in element order or records one unresolved bare star position. */
function collectExportDeclarationSlots(
  statement: ts.ExportDeclaration,
  runtimeBindings: ReadonlySet<string>,
  slots: PreviewTargetExportSlot[],
  addExplicitExport: AddExplicitExport,
): void {
  if (statement.isTypeOnly) {
    return;
  }
  const clause = statement.exportClause;
  if (clause === undefined) {
    slots.push({ kind: 'wildcard' });
    return;
  }
  if (ts.isNamespaceExport(clause)) {
    if (ts.isIdentifier(clause.name)) {
      addExplicitExport(clause.name.text);
    }
    return;
  }

  for (const element of clause.elements) {
    if (element.isTypeOnly || !ts.isIdentifier(element.name)) {
      continue;
    }
    const localName = element.propertyName ?? element.name;
    if (statement.moduleSpecifier === undefined && !runtimeBindings.has(localName.text)) {
      continue;
    }
    if (element.name.text === 'default') {
      addExplicitExport('default', localName.text);
    } else {
      addExplicitExport(element.name.text);
    }
  }
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

/** Recursively extracts identifiers from object and array binding patterns in lexical order. */
function collectBindingNames(bindingName: ts.BindingName, bindings: Set<string> | string[]): void {
  if (ts.isIdentifier(bindingName)) {
    if (Array.isArray(bindings)) {
      bindings.push(bindingName.text);
    } else {
      bindings.add(bindingName.text);
    }
    return;
  }
  for (const element of bindingName.elements) {
    if (!ts.isOmittedExpression(element)) {
      collectBindingNames(element.name, bindings);
    }
  }
}

/** Adds non-type-only ES import bindings that may later appear in a local export clause. */
function collectImportBindings(statement: ts.ImportDeclaration, bindings: Set<string>): void {
  const clause = statement.importClause;
  if (clause === undefined || isTypeOnlyImportClause(clause)) {
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

/** Returns the right-hand side of conventional `module.exports = value` syntax when present. */
function readCommonJsDefaultExpression(statement: ts.Statement): ts.Expression | undefined {
  if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) {
    return undefined;
  }
  const assignment = statement.expression;
  if (assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
    return undefined;
  }
  const target = assignment.left;
  if (ts.isPropertyAccessExpression(target)) {
    return ts.isIdentifier(target.expression) &&
      target.expression.text === 'module' &&
      target.name.text === 'exports'
      ? assignment.right
      : undefined;
  }
  if (!ts.isElementAccessExpression(target) || !ts.isIdentifier(target.expression)) {
    return undefined;
  }
  const propertyName = target.argumentExpression;
  return target.expression.text === 'module' &&
    ts.isStringLiteralLike(propertyName) &&
    propertyName.text === 'exports'
    ? assignment.right
    : undefined;
}

/** Derives a useful default-export label from a named expression without guessing through calls. */
function readExpressionDisplayName(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (
    (ts.isFunctionExpression(expression) || ts.isClassExpression(expression)) &&
    expression.name !== undefined
  ) {
    return expression.name.text;
  }
  return 'default';
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

/** Restricts implicit component candidates to identifiers beginning with an uppercase letter. */
function isPascalCaseIdentifier(name: string): boolean {
  return /^\p{Lu}[$_\p{L}\p{N}\u200C\u200D]*$/u.test(name);
}

/** Detects a non-erased import of the exact package whose ThemeProvider can share context. */
function hasStyledComponentsValueImport(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'styled-components'
    ) {
      return false;
    }
    const clause = statement.importClause;
    if (clause === undefined) {
      return true;
    }
    if (isTypeOnlyImportClause(clause) || clause.name !== undefined) {
      return !isTypeOnlyImportClause(clause);
    }
    const namedBindings = clause.namedBindings;
    if (namedBindings === undefined || ts.isNamespaceImport(namedBindings)) {
      return namedBindings !== undefined;
    }
    return (
      namedBindings.elements.length === 0 ||
      namedBindings.elements.some((element) => !element.isTypeOnly)
    );
  });
}

/** Adds exact named-theme and local-default-theme candidates from one value import declaration. */
function collectThemeImportCandidates(
  statement: ts.ImportDeclaration,
  candidates: PreviewThemeImportSelection[],
): void {
  const clause = statement.importClause;
  if (
    clause === undefined ||
    isTypeOnlyImportClause(clause) ||
    !ts.isStringLiteralLike(statement.moduleSpecifier)
  ) {
    return;
  }
  const moduleSpecifier = statement.moduleSpecifier.text;
  if (clause.name?.text === 'theme') {
    candidates.push({ exportName: 'default', moduleSpecifier });
  }
  const namedBindings = clause.namedBindings;
  if (namedBindings === undefined || !ts.isNamedImports(namedBindings)) {
    return;
  }
  for (const element of namedBindings.elements) {
    if (element.isTypeOnly) {
      continue;
    }
    const importedName = element.propertyName ?? element.name;
    if (importedName.text === 'theme') {
      candidates.push({ exportName: 'theme', moduleSpecifier });
    }
  }
}

/** Uses the non-deprecated phase marker to recognize an entire `import type` clause. */
function isTypeOnlyImportClause(clause: ts.ImportClause): boolean {
  return clause.phaseModifier === ts.SyntaxKind.TypeKeyword;
}
