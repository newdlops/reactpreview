/** Bounded ESM/local-const tracer shared by route factory readers. */
import path from 'node:path';
import ts from 'typescript';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';
import type { PreviewInspectorStaticValueReference } from './previewInspectorStaticValueReference';

/**
 *
 */
/** Resolves one exact export through bounded local aliases and ESM re-exports. */
export async function resolvePreviewInspectorStaticExport(options: {
  readonly exportName: string;
  readonly maximumEdges?: number;
  readonly maximumModules?: number;
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  readonly sourcePath: string;
}): Promise<PreviewInspectorStaticValueReference | undefined> {
  const seen = new Set<string>();
  let edges = 0;
  const maxEdges = options.maximumEdges ?? 32;
  const maxModules = options.maximumModules ?? 8;
  const follow = async (
    sourcePath: string,
    exportName: string,
  ): Promise<PreviewInspectorStaticValueReference | undefined> => {
    const normalized = path.normalize(sourcePath);
    const key = `${normalized}\0${exportName}`;
    if (seen.has(key) || seen.size >= maxModules || edges >= maxEdges) return undefined;
    seen.add(key);
    const text = await options.readSource(normalized);
    if (text === undefined) return undefined;
    const sourceFile = ts.createSourceFile(
      normalized,
      text,
      ts.ScriptTarget.Latest,
      true,
      normalized.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const reExport = readReExport(sourceFile, exportName);
    if (reExport !== undefined && options.resolveModule !== undefined) {
      const next = options.resolveModule(reExport.specifier, normalized);
      if (next !== undefined) {
        edges += 1;
        return follow(next, reExport.exportName);
      }
    }
    const expression = readExportExpression(sourceFile, exportName);
    if (expression === undefined) return undefined;
    const unwrapped = unwrap(expression);
    if (ts.isIdentifier(unwrapped)) {
      const local = readImmutableInitializer(sourceFile, unwrapped.text);
      if (local !== undefined)
        return { expression: unwrap(local), sourceFile, sourcePath: normalized };
      const binding = readImportedBinding(sourceFile, unwrapped.text);
      if (binding !== undefined && options.resolveModule !== undefined) {
        const next = options.resolveModule(binding.specifier, normalized);
        if (next !== undefined) {
          edges += 1;
          return follow(next, binding.exportName);
        }
      }
    }
    return { expression: unwrapped, sourceFile, sourcePath: normalized, exportName };
  };
  return follow(options.sourcePath, options.exportName);
}

/**
 *
 */
/** Reads a named ESM re-export without loading its target module. */
function readReExport(
  sourceFile: ts.SourceFile,
  exportName: string,
): { exportName: string; specifier: string } | undefined {
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.exportClause === undefined ||
      !ts.isNamedExports(statement.exportClause)
    )
      continue;
    const moduleSpecifier = statement.moduleSpecifier;
    if (moduleSpecifier === undefined || !ts.isStringLiteralLike(moduleSpecifier)) continue;
    const item = statement.exportClause.elements.find(
      (candidate) => candidate.name.text === exportName,
    );
    if (item !== undefined)
      return { exportName: (item.propertyName ?? item.name).text, specifier: moduleSpecifier.text };
  }
  return undefined;
}

/**
 *
 */
/** Finds the expression assigned to one public export in the current source file. */
function readExportExpression(
  sourceFile: ts.SourceFile,
  exportName: string,
): ts.Expression | undefined {
  for (const statement of sourceFile.statements) {
    if (exportName === 'default' && ts.isExportAssignment(statement)) return statement.expression;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === exportName &&
          declaration.initializer !== undefined &&
          isExported(statement)
        )
          return declaration.initializer;
      }
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const item of statement.exportClause.elements) {
        if (item.name.text !== exportName) continue;
        if (statement.moduleSpecifier === undefined)
          return ts.factory.createIdentifier((item.propertyName ?? item.name).text);
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 *
 */
/** Tests whether a variable declaration statement is a public runtime export. */
function isExported(statement: ts.VariableStatement): boolean {
  return (
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}

/**
 *
 */
/** Finds one unique immutable top-level initializer by local identifier. */
function readImmutableInitializer(
  sourceFile: ts.SourceFile,
  name: string,
): ts.Expression | undefined {
  const matches: ts.Expression[] = [];
  for (const statement of sourceFile.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      (statement.declarationList.flags & ts.NodeFlags.Const) === 0
    )
      continue;
    for (const declaration of statement.declarationList.declarations)
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === name &&
        declaration.initializer !== undefined
      )
        matches.push(declaration.initializer);
  }
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 *
 */
/** Finds an ESM import binding used by a local alias. */
function readImportedBinding(
  sourceFile: ts.SourceFile,
  localName: string,
): { exportName: string; specifier: string } | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier))
      continue;
    const clause = statement.importClause;
    if (clause?.name?.text === localName)
      return { exportName: 'default', specifier: statement.moduleSpecifier.text };
    if (clause?.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
      const element = clause.namedBindings.elements.find(
        (candidate) => candidate.name.text === localName,
      );
      if (element !== undefined)
        return {
          exportName: (element.propertyName ?? element.name).text,
          specifier: statement.moduleSpecifier.text,
        };
    }
  }
  return undefined;
}

/**
 *
 */
/** Removes non-runtime type wrappers before structural inspection. */
function unwrap(expression: ts.Expression): ts.Expression {
  let value = expression;
  while (
    ts.isParenthesizedExpression(value) ||
    ts.isAsExpression(value) ||
    ts.isSatisfiesExpression(value) ||
    ts.isNonNullExpression(value) ||
    ts.isTypeAssertionExpression(value)
  )
    value = value.expression;
  return value;
}
