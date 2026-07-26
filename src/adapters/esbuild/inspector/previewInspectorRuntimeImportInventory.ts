/** Collects literal runtime ESM/CommonJS edges without evaluating authored application code. */
import ts from 'typescript';
import type { PreviewInspectorRuntimeImportEdge } from './previewInspectorBundleFrontierTypes';

/** Returns stable source-ordered runtime imports; type-only and computed requests are excluded. */
export function collectPreviewInspectorRuntimeImportInventory(
  sourcePath: string,
  sourceText: string,
): readonly PreviewInspectorRuntimeImportEdge[] {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    sourcePath.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const edges: PreviewInspectorRuntimeImportEdge[] = [];
  const add = (
    kind: PreviewInspectorRuntimeImportEdge['kind'],
    moduleSpecifier: string,
    occurrenceStart: number,
    importedNames: readonly string[] = [],
  ): void => {
    edges.push(
      Object.freeze({
        importedNames: Object.freeze([...new Set(importedNames)].sort()),
        kind,
        moduleSpecifier,
        occurrenceStart,
        typeOnly: false,
      }),
    );
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      if (node.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword) {
        add(
          'import',
          node.moduleSpecifier.text,
          node.moduleSpecifier.getStart(sourceFile),
          readImportNames(node),
        );
      }
    } else if (ts.isExportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (
        !node.isTypeOnly &&
        moduleSpecifier !== undefined &&
        ts.isStringLiteralLike(moduleSpecifier)
      ) {
        add(
          'export',
          moduleSpecifier.text,
          moduleSpecifier.getStart(sourceFile),
          readExportNames(node),
        );
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const expression = node.moduleReference.expression;
      if (ts.isStringLiteralLike(expression)) {
        const occurrenceStart = node.getStart(sourceFile);
        add('import-equals', expression.text, occurrenceStart, [node.name.text]);
      }
    } else if (ts.isCallExpression(node)) {
      const argument = node.arguments[0];
      if (argument !== undefined && ts.isStringLiteralLike(argument)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          add('dynamic-import', argument.text, argument.getStart(sourceFile));
        } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
          add('require', argument.text, argument.getStart(sourceFile));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return Object.freeze(
    edges.sort(
      (left, right) =>
        left.occurrenceStart - right.occurrenceStart ||
        left.moduleSpecifier.localeCompare(right.moduleSpecifier) ||
        left.kind.localeCompare(right.kind),
    ),
  );
}

/** Reads the runtime value bindings exposed by one non-type import declaration. */
function readImportNames(node: ts.ImportDeclaration): readonly string[] {
  const clause = node.importClause;
  if (clause === undefined) return [];
  const names = clause.name === undefined ? [] : [clause.name.text];
  const bindings = clause.namedBindings;
  if (bindings === undefined) return names;
  if (ts.isNamespaceImport(bindings)) return [...names, '*'];
  return [
    ...names,
    ...bindings.elements.filter((item) => !item.isTypeOnly).map((item) => item.name.text),
  ];
}

/** Reads the runtime export names re-exported from one literal module specifier. */
function readExportNames(node: ts.ExportDeclaration): readonly string[] {
  const clause = node.exportClause;
  if (clause === undefined || !ts.isNamedExports(clause)) return clause === undefined ? ['*'] : [];
  return clause.elements.filter((item) => !item.isTypeOnly).map((item) => item.name.text);
}
