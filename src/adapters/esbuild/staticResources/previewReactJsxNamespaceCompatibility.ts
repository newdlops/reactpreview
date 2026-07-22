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
const REACT_CLASSIC_FACTORY = 'React.createElement';
const REACT_CLASSIC_FRAGMENT_FACTORY = 'React.Fragment';

/**
 * Creates a namespace import for React-authored JSX that may be lowered by a classic tsconfig.
 *
 * The fallback requires JSX, no top-level runtime declaration owning `React`, and either an exact
 * module-local React import or inert package-manifest proof that this project uses React. The latter
 * covers generated Storybook modules that rely entirely on Babel's automatic runtime. Explicit
 * source-level Preact/custom-runtime evidence takes precedence over package-wide metadata, while
 * automatic React-runtime builds tree-shake the extra binding.
 *
 * @param analysis Shared, syntax-validated source analysis for the workspace module.
 * @param projectUsesReactRuntime Whether the nearest inert manifest declares the React runtime.
 * @param projectUsesAlternativeJsxRuntime Lazy nearest-config evidence for another runtime.
 * @returns One ESM import statement when the classic JSX namespace is demonstrably missing.
 */
export function createPreviewReactJsxNamespaceCompatibilityImport(
  analysis: StaticSourceAnalysis,
  projectUsesReactRuntime = false,
  projectUsesAlternativeJsxRuntime: boolean | (() => boolean) = false,
): string | undefined {
  const sourceFile = analysis.getSourceFile();
  if (!containsJsx(sourceFile)) return undefined;
  if (
    hasExplicitAlternativeJsxRuntime(sourceFile) ||
    resolveAlternativeJsxRuntimeEvidence(projectUsesAlternativeJsxRuntime) ||
    (!projectUsesReactRuntime && !hasRuntimeReactImport(analysis)) ||
    hasTopLevelRuntimeBinding(sourceFile, REACT_NAMESPACE_BINDING)
  ) {
    return undefined;
  }

  return `import * as ${REACT_NAMESPACE_BINDING} from ${JSON.stringify(REACT_MODULE_SPECIFIER)};`;
}

/** Evaluates config discovery only after the module has proven JSX that could need a namespace. */
function resolveAlternativeJsxRuntimeEvidence(evidence: boolean | (() => boolean)): boolean {
  return typeof evidence === 'function' ? evidence() : evidence;
}

/**
 * Gives module-local JSX ownership stronger precedence than a package-level React declaration.
 * Hybrid repositories commonly retain React for one application while compiling another package
 * with Preact or a custom classic factory. Injecting React into those files can either pull a second
 * renderer into the graph or hide the actual missing factory, so ambiguous evidence fails closed.
 */
function hasExplicitAlternativeJsxRuntime(sourceFile: ts.SourceFile): boolean {
  if (hasAlternativeLeadingJsxPragma(sourceFile)) return true;
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.importClause?.phaseModifier !== undefined
    ) {
      continue;
    }
    const moduleSpecifier = statement.moduleSpecifier.text;
    if (isReactJsxRuntimeModule(moduleSpecifier)) continue;
    if (isAlternativeJsxRuntimeModule(moduleSpecifier)) return true;
  }
  return false;
}

/**
 * Reads only the trivia before the first statement, matching where JSX compilers recognize pragmas.
 * Restricting the scan to this preamble prevents strings and documentation examples deeper in the
 * module from accidentally changing preview ownership.
 */
function hasAlternativeLeadingJsxPragma(sourceFile: ts.SourceFile): boolean {
  const firstStatement = sourceFile.statements[0];
  const preambleEnd = firstStatement?.getStart(sourceFile, false) ?? sourceFile.end;
  const preamble = sourceFile.getFullText().slice(0, preambleEnd);
  return (
    hasPragmaValueOtherThan(preamble, /@jsxImportSource\s+([^\s*]+)/gu, REACT_MODULE_SPECIFIER) ||
    hasPragmaValueOtherThan(preamble, /@jsx(?![A-Za-z])\s+([^\s*]+)/gu, REACT_CLASSIC_FACTORY) ||
    hasPragmaValueOtherThan(preamble, /@jsxFrag\s+([^\s*]+)/gu, REACT_CLASSIC_FRAGMENT_FACTORY)
  );
}

/** Reports whether any leading pragma selects a value other than React's conventional value. */
function hasPragmaValueOtherThan(source: string, pattern: RegExp, expectedValue: string): boolean {
  return [...source.matchAll(pattern)].some((match) => match[1] !== expectedValue);
}

/** Reports whether an exact module specifier belongs to React's classic or automatic runtime. */
function isReactJsxRuntimeModule(moduleSpecifier: string): boolean {
  return (
    moduleSpecifier === REACT_MODULE_SPECIFIER ||
    moduleSpecifier === 'react/jsx-runtime' ||
    moduleSpecifier === 'react/jsx-dev-runtime'
  );
}

/** Recognizes explicit automatic-runtime imports, plus Preact's classic runtime package. */
function isAlternativeJsxRuntimeModule(moduleSpecifier: string): boolean {
  return (
    moduleSpecifier === 'preact' ||
    moduleSpecifier.startsWith('preact/') ||
    /\/jsx(?:-dev)?-runtime$/u.test(moduleSpecifier)
  );
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
  if (hasSourceFileScopedVarBinding(sourceFile, bindingName)) return true;
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

/**
 * Finds function-scoped `var` declarations that belong to the source file even when they are nested
 * in a top-level loop, switch, or conditional block. ES module imports and such `var` declarations
 * share one binding scope, so overlooking `for (var React of values)` would make the generated React
 * namespace import a duplicate declaration. Function, class, and namespace bodies establish their
 * own runtime scope and are deliberately not traversed.
 */
function hasSourceFileScopedVarBinding(sourceFile: ts.SourceFile, bindingName: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node !== sourceFile && isIndependentRuntimeVarScope(node)) return;
    if (
      ts.isVariableDeclarationList(node) &&
      (node.flags & ts.NodeFlags.BlockScoped) === 0 &&
      node.declarations.some((declaration) => bindingNameContains(declaration.name, bindingName))
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** Reports syntax whose nested `var` declarations cannot collide with a source-file import. */
function isIndependentRuntimeVarScope(node: ts.Node): boolean {
  return (
    ts.isFunctionLike(node) ||
    ts.isClassDeclaration(node) ||
    ts.isClassExpression(node) ||
    ts.isModuleDeclaration(node)
  );
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
