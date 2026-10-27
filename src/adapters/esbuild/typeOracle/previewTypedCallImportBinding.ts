/**
 * Proves that a call receiver still refers to the runtime import selected by a source transform.
 * Uses the build's existing checker: parameters, hoisted declarations, catch bindings, and nested
 * scopes cannot borrow a server contract's synthesized payload merely by sharing its local name.
 * No extra program, import resolution, filesystem access, or project evaluation is performed.
 */
import ts from 'typescript';

/** Runtime import that a caller requires at the root of a property-access call. */
export interface PreviewTypedCallImportBinding {
  /** Decoded local identifier used by the importing module. */
  readonly localName: string;
  /** Authored import specifier of the selected runtime contract. */
  readonly moduleSpecifier: string;
}

/**
 * Checks the receiver's lexical symbol without following its imported value into another module.
 *
 * @param checker Checker that owns the call's admitted source tree.
 * @param call Call selected by exact text and occurrence in that source tree.
 * @param expected Runtime import selected by the transform's contract-path resolver.
 * @returns Whether the receiver has exactly that runtime import declaration; uncertainty is false.
 */
export function isPreviewTypedCallImportBinding(
  checker: ts.TypeChecker,
  call: ts.CallExpression,
  expected: PreviewTypedCallImportBinding,
): boolean {
  let receiver = call.expression;
  if (!ts.isPropertyAccessExpression(receiver)) return false;
  while (ts.isPropertyAccessExpression(receiver)) receiver = receiver.expression;
  if (!ts.isIdentifier(receiver) || receiver.text !== expected.localName) return false;
  const declarations = checker.getSymbolAtLocation(receiver)?.declarations;
  if (declarations?.length !== 1) return false;
  const declaration = declarations[0];
  let clause: ts.ImportClause;
  if (declaration !== undefined && ts.isImportClause(declaration)) {
    if (declaration.name?.text !== expected.localName) return false;
    clause = declaration;
  } else if (declaration !== undefined && ts.isNamespaceImport(declaration)) {
    if (declaration.name.text !== expected.localName) return false;
    clause = declaration.parent;
  } else if (declaration !== undefined && ts.isImportSpecifier(declaration)) {
    if (declaration.isTypeOnly || declaration.name.text !== expected.localName) return false;
    clause = declaration.parent.parent;
  } else {
    return false;
  }
  const imported = clause.parent;
  return (
    clause.phaseModifier !== ts.SyntaxKind.TypeKeyword &&
    ts.isImportDeclaration(imported) &&
    ts.isStringLiteral(imported.moduleSpecifier) &&
    imported.moduleSpecifier.text === expected.moduleSpecifier
  );
}
