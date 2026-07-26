/* eslint-disable jsdoc/require-jsdoc, @typescript-eslint/no-confusing-void-expression, @typescript-eslint/no-unnecessary-boolean-literal-compare, @typescript-eslint/no-unnecessary-condition */
/** Builds a same-file selected-export virtual module without evaluating unrelated top-level code. */
import ts from 'typescript';

const STYLE_IMPORT_PATTERN = /\.(?:css|less|sass|scss)$/iu;
const MAX_SLICE_BINDINGS = 256;

export type PreviewInspectorMountSurfaceSliceFailureReason =
  | 'ambiguous-export'
  | 'dynamic-commonjs-export'
  | 'parse-failure'
  | 'slice-binding-budget'
  | 'top-level-await'
  | 'unresolved-local-binding';

export interface PreviewInspectorMountSurfaceSlice {
  readonly contents: string;
  readonly omittedTopLevelEffectCount: number;
  readonly referencedLocalNames: readonly string[];
}

export type PreviewInspectorMountSurfaceSliceResult =
  | { readonly kind: 'failure'; readonly reason: PreviewInspectorMountSurfaceSliceFailureReason }
  | { readonly kind: 'success'; readonly slice: PreviewInspectorMountSurfaceSlice };

export interface CreatePreviewInspectorSelectedExportSliceOptions {
  readonly exportName: string;
  readonly sourcePath: string;
  readonly sourceText: string;
}

export interface CreatePreviewInspectorLocalComponentSliceOptions {
  readonly localName: string;
  readonly preservedWrapperKinds: readonly ('forward-ref' | 'memo' | 'styled')[];
  readonly sourcePath: string;
  readonly sourceText: string;
}

/** Emits a local binding closure as a default export without re-running project-owned HOCs. */
export function createPreviewInspectorLocalComponentSlice(
  options: CreatePreviewInspectorLocalComponentSliceOptions,
): PreviewInspectorMountSurfaceSliceResult {
  const selected = createPreviewInspectorSelectedExportSlice({
    exportName: options.localName,
    sourcePath: options.sourcePath,
    sourceText: options.sourceText,
  });
  if (selected.kind === 'failure') return selected;
  const expression = options.preservedWrapperKinds.includes('memo')
    ? `memo(${options.localName})`
    : options.localName;
  return Object.freeze({
    kind: 'success',
    slice: Object.freeze({
      ...selected.slice,
      contents: `${selected.slice.contents}\nexport default ${expression};`,
    }),
  });
}

/**
 * Keeps the selected public export's lexical declaration closure. The output intentionally omits
 * arbitrary side-effect-only imports; direct stylesheet imports are retained because they carry
 * component-visible semantics rather than application bootstrap behavior.
 */
export function createPreviewInspectorSelectedExportSlice(
  options: CreatePreviewInspectorSelectedExportSliceOptions,
): PreviewInspectorMountSurfaceSliceResult {
  const sourceFile = ts.createSourceFile(
    options.sourcePath,
    options.sourceText,
    ts.ScriptTarget.Latest,
    true,
    options.sourcePath.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  if (readParseDiagnostics(sourceFile).length > 0) return failure('parse-failure');
  if (sourceFile.statements.some(containsTopLevelAwait)) return failure('top-level-await');
  if (sourceFile.statements.some(isDynamicCommonJsExport))
    return failure('dynamic-commonjs-export');

  const declarations = collectTopLevelDeclarations(sourceFile);
  const imports = collectImportBindings(sourceFile);
  const selected = findSelectedExport(sourceFile, options.exportName, declarations);
  if (selected === undefined) return failure('ambiguous-export');
  const included = new Set<ts.Statement>(selected.statements);
  const pendingNames = new Set(selected.references);
  const referencedLocalNames = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const statement of [...included]) {
      for (const name of collectReferencedIdentifiers(statement)) pendingNames.add(name);
    }
    for (const name of [...pendingNames]) {
      if (referencedLocalNames.has(name)) continue;
      referencedLocalNames.add(name);
      if (referencedLocalNames.size > MAX_SLICE_BINDINGS) return failure('slice-binding-budget');
      const declaration = declarations.get(name);
      if (declaration !== undefined) {
        if (!included.has(declaration)) {
          included.add(declaration);
          changed = true;
        }
        continue;
      }
      const importDeclaration = imports.get(name);
      if (importDeclaration !== undefined && !included.has(importDeclaration)) {
        included.add(importDeclaration);
        changed = true;
      }
    }
  }
  for (const statement of sourceFile.statements) {
    if (isPreservedDirective(statement) || isDirectStyleImport(statement)) included.add(statement);
  }
  const sourceStatements = sourceFile.statements.filter((statement) => included.has(statement));
  const omittedTopLevelEffectCount = sourceFile.statements.filter(
    (statement) => isSideEffectImport(statement) && !included.has(statement),
  ).length;
  const contents = [
    ...sourceStatements.map((statement) => statement.getFullText(sourceFile).trim()),
    ...(selected.syntheticExport === undefined ? [] : [selected.syntheticExport]),
    `//# sourceURL=react-preview-page-surface:${encodeURIComponent(options.sourcePath)}:${encodeURIComponent(options.exportName)}`,
  ]
    .filter(Boolean)
    .join('\n');
  return Object.freeze({
    kind: 'success',
    slice: Object.freeze({
      contents,
      omittedTopLevelEffectCount,
      referencedLocalNames: Object.freeze([...referencedLocalNames].sort()),
    }),
  });
}

function findSelectedExport(
  sourceFile: ts.SourceFile,
  exportName: string,
  declarations: ReadonlyMap<string, ts.Statement>,
):
  | {
      readonly references: readonly string[];
      readonly statements: readonly ts.Statement[];
      readonly syntheticExport?: string;
    }
  | undefined {
  for (const statement of sourceFile.statements) {
    if (exportName === 'default' && ts.isExportAssignment(statement))
      return {
        references: collectReferencedIdentifiers(statement.expression),
        statements: [statement],
      };
    if (hasExportName(statement, exportName)) return { references: [], statements: [statement] };
    if (
      !ts.isExportDeclaration(statement) ||
      statement.moduleSpecifier !== undefined ||
      statement.exportClause === undefined ||
      !ts.isNamedExports(statement.exportClause)
    )
      continue;
    const element = statement.exportClause.elements.find((item) => item.name.text === exportName);
    if (element === undefined || element.isTypeOnly) continue;
    const localName = (element.propertyName ?? element.name).text;
    const declaration = declarations.get(localName);
    if (declaration === undefined) return failureSelection();
    return {
      references: [localName],
      statements: [declaration],
      syntheticExport:
        exportName === 'default'
          ? `export default ${localName};`
          : `export { ${localName} as ${exportName} };`,
    };
  }
  const declaration = declarations.get(exportName);
  return declaration === undefined
    ? undefined
    : {
        references: [exportName],
        statements: [declaration],
        syntheticExport: `export { ${exportName} };`,
      };
}

function failureSelection(): undefined {
  return undefined;
}

function hasExportName(statement: ts.Statement, exportName: string): boolean {
  const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
  const exported = modifiers?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword) === true;
  if (!exported) return false;
  const defaultExport =
    modifiers?.some((item) => item.kind === ts.SyntaxKind.DefaultKeyword) === true;
  if (defaultExport) return exportName === 'default';
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))
    return statement.name?.text === exportName;
  if (ts.isVariableStatement(statement))
    return statement.declarationList.declarations.some(
      (item) => ts.isIdentifier(item.name) && item.name.text === exportName,
    );
  return false;
}

function collectTopLevelDeclarations(sourceFile: ts.SourceFile): ReadonlyMap<string, ts.Statement> {
  const result = new Map<string, ts.Statement>();
  for (const statement of sourceFile.statements) {
    const names =
      ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)
        ? statement.name === undefined
          ? []
          : [statement.name.text]
        : ts.isVariableStatement(statement)
          ? statement.declarationList.declarations.flatMap((item) =>
              ts.isIdentifier(item.name) ? [item.name.text] : [],
            )
          : ts.isInterfaceDeclaration(statement) ||
              ts.isTypeAliasDeclaration(statement) ||
              ts.isEnumDeclaration(statement)
            ? [statement.name.text]
            : [];
    for (const name of names) result.set(name, statement);
  }
  return result;
}

function collectImportBindings(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, ts.ImportDeclaration> {
  const result = new Map<string, ts.ImportDeclaration>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause === undefined) continue;
    const clause = statement.importClause;
    if (clause.name !== undefined) result.set(clause.name.text, statement);
    if (clause.namedBindings === undefined) continue;
    if (ts.isNamespaceImport(clause.namedBindings))
      result.set(clause.namedBindings.name.text, statement);
    else
      for (const element of clause.namedBindings.elements)
        if (!element.isTypeOnly) result.set(element.name.text, statement);
  }
  return result;
}

function collectReferencedIdentifiers(node: ts.Node): readonly string[] {
  const names = new Set<string>();
  const visit = (current: ts.Node): void => {
    if (ts.isIdentifier(current) && !isDeclarationName(current) && !isPropertyName(current))
      names.add(current.text);
    ts.forEachChild(current, visit);
  };
  visit(node);
  return [...names];
}

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isVariableDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent)) &&
    parent.name === node
  );
}
function isPropertyName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node)
  );
}
function isPreservedDirective(statement: ts.Statement): boolean {
  return (
    ts.isExpressionStatement(statement) &&
    ts.isStringLiteral(statement.expression) &&
    (statement.expression.text === 'use client' || statement.expression.text === 'use strict')
  );
}
function isSideEffectImport(statement: ts.Statement): statement is ts.ImportDeclaration {
  return ts.isImportDeclaration(statement) && statement.importClause === undefined;
}
function isDirectStyleImport(statement: ts.Statement): boolean {
  return (
    isSideEffectImport(statement) &&
    ts.isStringLiteralLike(statement.moduleSpecifier) &&
    STYLE_IMPORT_PATTERN.test(statement.moduleSpecifier.text)
  );
}
function containsTopLevelAwait(statement: ts.Statement): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isAwaitExpression(node)) found = true;
    if (!ts.isFunctionLike(node)) ts.forEachChild(node, visit);
  };
  visit(statement);
  return found;
}
function isDynamicCommonJsExport(statement: ts.Statement): boolean {
  return (
    ts.isExpressionStatement(statement) &&
    ts.isBinaryExpression(statement.expression) &&
    ts.isPropertyAccessExpression(statement.expression.left) &&
    ts.isIdentifier(statement.expression.left.expression) &&
    statement.expression.left.expression.text === 'module' &&
    statement.expression.left.name.text === 'exports'
  );
}
function readParseDiagnostics(sourceFile: ts.SourceFile): readonly ts.Diagnostic[] {
  return (
    (sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics ?? []
  );
}
function failure(
  reason: PreviewInspectorMountSurfaceSliceFailureReason,
): PreviewInspectorMountSurfaceSliceResult {
  return Object.freeze({ kind: 'failure', reason });
}
