/**
 * Recognizes store hooks a module creates itself with zustand.
 *
 * `export const useToastStore = create<ToastStore>((set) => ({ items: [] }))` is called by the
 * same module's components exactly like an imported store hook, but its initializer is a factory
 * call rather than a function, so the local-hook inventory would otherwise skip it.
 */
import ts from 'typescript';

/**
 * Module identity of such a hook. Runtime keeps its authored value off the target corridor, so a
 * host every page mounts (a toast list) gains sample items only when that host is the target.
 */
export const PREVIEW_RUNTIME_LOCAL_STORE_MODULE = 'local-store';
const ZUSTAND_MODULE_PATTERN = /^zustand(?:\/[A-Za-z0-9_-]+)?$/u;
const ZUSTAND_FACTORY_EXPORTS = new Set(['create', 'createWithEqualityFn']);

/** Collects local names bound to zustand store factories, including zustand 3's default export. */
export function collectPreviewRuntimeStoreFactoryNames(
  sourceFile: ts.SourceFile,
): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !ZUSTAND_MODULE_PATTERN.test(statement.moduleSpecifier.text) ||
      statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause?.name !== undefined && statement.moduleSpecifier.text === 'zustand') {
      names.add(clause.name.text);
    }
    const bindings = clause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const exportName = element.propertyName?.text ?? element.name.text;
      if (!element.isTypeOnly && ZUSTAND_FACTORY_EXPORTS.has(exportName)) {
        names.add(element.name.text);
      }
    }
  }
  return names;
}

/** Reports whether an initializer creates a store hook: `create(...)` or curried `create<T>()(...)`. */
function isPreviewRuntimeStoreFactoryCall(
  expression: ts.Expression,
  factoryNames: ReadonlySet<string>,
): boolean {
  if (factoryNames.size === 0 || !ts.isCallExpression(expression)) return false;
  const callee = ts.isCallExpression(expression.expression)
    ? expression.expression.expression
    : expression.expression;
  return ts.isIdentifier(callee) && factoryNames.has(callee.text);
}

/**
 * Reads a conventional top-level local hook declaration without following assigned expressions:
 * a hook function, or a store hook a zustand factory creates in this module.
 */
export function readPreviewRuntimeLocalHookDeclaration(
  statement: ts.Statement,
  storeFactoryNames: ReadonlySet<string>,
  hookNamePattern: RegExp,
): { readonly hookName: string; readonly moduleSpecifier: string } | undefined {
  if (
    ts.isFunctionDeclaration(statement) &&
    statement.name !== undefined &&
    hookNamePattern.test(statement.name.text)
  ) {
    return { hookName: statement.name.text, moduleSpecifier: 'local' };
  }
  if (!ts.isVariableStatement(statement)) return undefined;
  for (const declaration of statement.declarationList.declarations) {
    const initializer = declaration.initializer;
    if (
      !ts.isIdentifier(declaration.name) ||
      !hookNamePattern.test(declaration.name.text) ||
      initializer === undefined
    ) {
      continue;
    }
    if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
      return { hookName: declaration.name.text, moduleSpecifier: 'local' };
    }
    if (isPreviewRuntimeStoreFactoryCall(initializer, storeFactoryNames)) {
      return {
        hookName: declaration.name.text,
        moduleSpecifier: PREVIEW_RUNTIME_LOCAL_STORE_MODULE,
      };
    }
  }
  return undefined;
}
