/**
 * Supplies the classic JSX `React` namespace only when authored source proves React ownership.
 * Some repositories compile JSX with Babel's automatic runtime while retaining `jsx: react` in
 * tsconfig for editor compatibility. Esbuild observes that tsconfig and emits
 * `React.createElement`, even when the source intentionally imports only named React exports.
 */
import ts from 'typescript';
import { parseStaticString, type StaticSourceAnalysis } from './staticCallParser';

const REACT_MODULE_SPECIFIER = 'react';
const REACT_NAMESPACE_BINDING = 'React';

/**
 * Creates a namespace import for React-authored JSX that may be lowered by a classic tsconfig.
 *
 * The fallback requires three independent pieces of syntax evidence: JSX exists, an exact React
 * runtime import already exists, and no top-level runtime declaration owns the `React` name.
 * Consequently it neither introduces React into Preact/custom-runtime modules nor collides with an
 * authored namespace. Automatic-runtime builds simply tree-shake the redundant binding.
 *
 * @param analysis Shared, syntax-validated source analysis for the workspace module.
 * @returns One ESM import statement when the classic JSX namespace is demonstrably missing.
 */
export function createPreviewReactJsxNamespaceCompatibilityImport(
  analysis: StaticSourceAnalysis,
): string | undefined {
  const sourceFile = analysis.getSourceFile();
  if (
    !hasRuntimeReactImport(analysis) ||
    hasTopLevelRuntimeBinding(sourceFile, REACT_NAMESPACE_BINDING) ||
    !containsJsx(sourceFile)
  ) {
    return undefined;
  }

  return `import * as ${REACT_NAMESPACE_BINDING} from ${JSON.stringify(REACT_MODULE_SPECIFIER)};`;
}

/** Reports whether the module already evaluates the exact React package at runtime. */
function hasRuntimeReactImport(analysis: StaticSourceAnalysis): boolean {
  const sourceFile = analysis.getSourceFile();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== REACT_MODULE_SPECIFIER
    ) {
      continue;
    }

    const clause = statement.importClause;
    if (clause === undefined) {
      return true;
    }
    if (clause.phaseModifier !== undefined) {
      continue;
    }
    if (
      clause.name !== undefined ||
      (clause.namedBindings !== undefined && ts.isNamespaceImport(clause.namedBindings))
    ) {
      return true;
    }
    if (clause.namedBindings?.elements.some((element) => !element.isTypeOnly) === true) {
      return true;
    }
  }
  return analysis
    .findCalls('require')
    .some(
      (call) =>
        call.arguments.length === 1 &&
        parseStaticString(call.arguments[0] ?? '') === REACT_MODULE_SPECIFIER,
    );
}

/**
 * Detects value-emitting declarations that would collide with a generated `React` import.
 * Type-only and ambient declarations are deliberately ignored: esbuild erases them and accepts the
 * matching runtime import, while treating them as runtime bindings would leave classic JSX broken.
 */
function hasTopLevelRuntimeBinding(sourceFile: ts.SourceFile, bindingName: string): boolean {
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (importDeclarationBindsRuntimeName(statement, bindingName)) return true;
      continue;
    }
    if (ts.isImportEqualsDeclaration(statement)) {
      if (!statement.isTypeOnly && statement.name.text === bindingName) return true;
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      if (
        !hasDeclareModifier(statement) &&
        statement.declarationList.declarations.some((declaration) =>
          bindingNameContains(declaration.name, bindingName),
        )
      ) {
        return true;
      }
      continue;
    }
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isModuleDeclaration(statement)) &&
      !hasDeclareModifier(statement) &&
      statement.name?.getText(sourceFile) === bindingName
    ) {
      return true;
    }
  }
  return false;
}

/** Reports whether one ESM import clause declares the requested runtime binding. */
function importDeclarationBindsRuntimeName(
  declaration: ts.ImportDeclaration,
  bindingName: string,
): boolean {
  const clause = declaration.importClause;
  if (clause?.phaseModifier !== undefined) return false;
  if (clause?.name?.text === bindingName) return true;
  const bindings = clause?.namedBindings;
  if (bindings === undefined) return false;
  if (ts.isNamespaceImport(bindings)) return bindings.name.text === bindingName;
  return bindings.elements.some(
    (element) => !element.isTypeOnly && element.name.text === bindingName,
  );
}

/** Reads a declaration's explicit `declare` modifier without depending on node subtype fields. */
function hasDeclareModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword) ===
      true
  );
}

/** Recursively searches destructuring declarations for one local binding name. */
function bindingNameContains(name: ts.BindingName, bindingName: string): boolean {
  if (ts.isIdentifier(name)) return name.text === bindingName;
  return name.elements.some(
    (element) => !ts.isOmittedExpression(element) && bindingNameContains(element.name, bindingName),
  );
}

/** Finds real JSX syntax without matching comments, strings, comparisons, or generic parameters. */
function containsJsx(sourceFile: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}
