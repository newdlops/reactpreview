/** Proves that an imported path helper returns one exact route-catalog lookup. */
import ts from 'typescript';
import type { PreviewInspectorDirectRouteCatalogHelperReference } from './previewInspectorDirectRoutePathEvidence';

/** Catalog binding read by the helper's returned expression. */
export interface PreviewInspectorResolvedDirectRouteCatalogHelper {
  readonly bindingKind: 'local';
  readonly bindingName: string;
  readonly sourcePath: string;
}

/**
 * Resolves only an exported function whose returned value reads `catalog[firstParameter]`.
 * The helper is parsed as data; neither it nor its imports are evaluated.
 */
export async function resolvePreviewInspectorDirectRouteCatalogHelper(options: {
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly reference: PreviewInspectorDirectRouteCatalogHelperReference;
}): Promise<PreviewInspectorResolvedDirectRouteCatalogHelper | undefined> {
  const sourceText = await options.readSource(options.reference.helperSourcePath);
  if (sourceText === undefined) return undefined;
  const sourceFile = ts.createSourceFile(
    options.reference.helperSourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    options.reference.helperSourcePath.toLowerCase().endsWith('x')
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS,
  );
  const helper = readExportedFunctionLike(sourceFile, options.reference.helperExportName);
  const firstParameter = helper?.parameters[0]?.name;
  if (helper === undefined || firstParameter === undefined || !ts.isIdentifier(firstParameter)) {
    return undefined;
  }
  const catalogNames = new Set<string>();
  for (const expression of readReturnedExpressions(helper)) {
    collectReturnedCatalogNames(expression, firstParameter.text, catalogNames);
  }
  if (catalogNames.size !== 1) return undefined;
  const bindingName = [...catalogNames][0];
  if (bindingName === undefined || !hasTopLevelValueBinding(sourceFile, bindingName)) return undefined;
  return Object.freeze({
    bindingKind: 'local' as const,
    bindingName,
    sourcePath: options.reference.helperSourcePath,
  });
}

/** Finds the exact local function-like value named by one public export. */
function readExportedFunctionLike(
  sourceFile: ts.SourceFile,
  exportName: string,
): ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression | undefined {
  let localName = exportName;
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.moduleSpecifier !== undefined ||
      statement.exportClause === undefined ||
      !ts.isNamedExports(statement.exportClause)
    ) {
      continue;
    }
    const exported = statement.exportClause.elements.find((item) => item.name.text === exportName);
    if (exported !== undefined) localName = (exported.propertyName ?? exported.name).text;
  }
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === localName &&
      isExportedAs(statement, sourceFile, localName, exportName)
    ) {
      return statement;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === localName &&
        declaration.initializer !== undefined &&
        (ts.isArrowFunction(declaration.initializer) ||
          ts.isFunctionExpression(declaration.initializer)) &&
        isExportedAs(statement, sourceFile, localName, exportName)
      ) {
        return declaration.initializer;
      }
    }
  }
  return undefined;
}

/** Requires either a direct export modifier or one exact same-file export specifier. */
function isExportedAs(
  declaration: ts.Node,
  sourceFile: ts.SourceFile,
  localName: string,
  exportName: string,
): boolean {
  if (
    localName === exportName &&
    ts.canHaveModifiers(declaration) &&
    (ts.getModifiers(declaration)?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    ) ?? false)
  ) {
    return true;
  }
  return sourceFile.statements.some(
    (statement) =>
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause) &&
      statement.exportClause.elements.some(
        (item) =>
          item.name.text === exportName && (item.propertyName ?? item.name).text === localName,
      ),
  );
}

/** Reads returned expressions without descending into nested function declarations. */
function readReturnedExpressions(
  helper: ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression,
): readonly ts.Expression[] {
  if (ts.isArrowFunction(helper) && ts.isExpression(helper.body)) return [helper.body];
  const expressions: ts.Expression[] = [];
  const body = helper.body;
  if (body === undefined) return expressions;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && node !== helper) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      expressions.push(node.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return expressions;
}

/** Collects top-level catalog receivers indexed by the helper's first parameter. */
function collectReturnedCatalogNames(
  expression: ts.Expression,
  parameterName: string,
  names: Set<string>,
): void {
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isElementAccessExpression(node)) {
      const receiver = unwrap(node.expression);
      const argument =
        node.argumentExpression === undefined ? undefined : unwrap(node.argumentExpression);
      if (
        ts.isIdentifier(receiver) &&
        argument !== undefined &&
        ts.isIdentifier(argument) &&
        argument.text === parameterName
      ) {
        names.add(receiver.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
}

/** Ensures the inferred catalog receiver is an immutable local value or runtime import. */
function hasTopLevelValueBinding(sourceFile: ts.SourceFile, name: string): boolean {
  return sourceFile.statements.some((statement) => {
    if (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly !== true) {
      const clause = statement.importClause;
      if (clause?.name?.text === name) return true;
      const bindings = clause?.namedBindings;
      return (
        bindings !== undefined &&
        ts.isNamedImports(bindings) &&
        bindings.elements.some((element) => !element.isTypeOnly && element.name.text === name)
      );
    }
    if (
      ts.isVariableStatement(statement) &&
      (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
    ) {
      return statement.declarationList.declarations.some(
        (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name,
      );
    }
    return false;
  });
}

/** Removes only inert TypeScript expression wrappers. */
function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}
