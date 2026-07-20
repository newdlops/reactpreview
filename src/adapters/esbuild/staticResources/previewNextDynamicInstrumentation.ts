/**
 * Normalizes static `next/dynamic` loader results for esbuild's CommonJS import interop.
 *
 * Next's normal Webpack/SWC pipeline often receives a single `{ default: Component }` namespace.
 * Esbuild correctly wraps some CommonJS packages as `{ default: { default: Component } }`; older
 * Next `dynamic()` implementations unwrap only once and pass the remaining object to React.lazy.
 * This bounded source edit removes at most one extra default layer without importing or executing
 * Next compiler plugins and without changing ordinary React.lazy or dynamic-import semantics.
 */
import path from 'node:path';
import ts from 'typescript';
import type { PreviewSourceReplacement } from './previewSourceReplacement';

const NEXT_DYNAMIC_SPECIFIER = 'next/dynamic';
const MAX_NEXT_DYNAMIC_LOADERS = 128;

/**
 * Wraps literal-import results returned directly by statically imported `next/dynamic` loaders.
 * User-authored `.then()` export selection, computed imports, object loader options, and unrelated
 * `dynamic` identifiers fail closed.
 *
 * @param sourcePath Authored source identity used only to select parser grammar.
 * @param sourceText Original source whose offsets are retained in returned edits.
 * @returns Ordered non-overlapping edits over raw `import("package")` call expressions.
 */
export function createNextDynamicReplacements(
  sourcePath: string,
  sourceText: string,
): readonly PreviewSourceReplacement[] {
  if (!sourceText.includes(NEXT_DYNAMIC_SPECIFIER) || !sourceText.includes('import(')) return [];
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    selectScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) return [];
  const bindings = collectNextDynamicBindings(sourceFile);
  if (bindings.size === 0) return [];
  const replacements: PreviewSourceReplacement[] = [];

  /** Visits call sites but only records an import that is the loader's direct returned value. */
  const visit = (node: ts.Node): void => {
    if (replacements.length >= MAX_NEXT_DYNAMIC_LOADERS) return;
    if (ts.isCallExpression(node) && isNextDynamicCall(node, bindings)) {
      const loaderImport = readDirectLoaderImport(node.arguments[0]);
      if (loaderImport !== undefined) {
        const importText = loaderImport.getText(sourceFile);
        replacements.push({
          end: loaderImport.getEnd(),
          replacement: `${importText}.then((__reactPreviewDynamicModule) => (__reactPreviewDynamicModule?.default?.default ?? __reactPreviewDynamicModule?.default ?? __reactPreviewDynamicModule))`,
          start: loaderImport.getStart(sourceFile),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return replacements.sort((left, right) => left.start - right.start);
}

/** Selects parser grammar without reading project compiler configuration. */
function selectScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/** Rejects parser-recovered buffers before source offsets are used. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return (diagnostics?.length ?? 0) > 0;
}

/** Collects default and `default as` runtime bindings from `next/dynamic`. */
function collectNextDynamicBindings(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const bindings = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== NEXT_DYNAMIC_SPECIFIER
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause === undefined || clause.phaseModifier !== undefined) continue;
    if (clause.name !== undefined) bindings.add(clause.name.text);
    if (clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (!element.isTypeOnly && element.propertyName?.text === 'default') {
          bindings.add(element.name.text);
        }
      }
    }
  }
  return bindings;
}

/** Proves a direct imported call and excludes a nested parameter shadowing the binding. */
function isNextDynamicCall(call: ts.CallExpression, bindings: ReadonlySet<string>): boolean {
  const callee = unwrapExpression(call.expression);
  return (
    ts.isIdentifier(callee) &&
    bindings.has(callee.text) &&
    !isShadowedByAncestorParameter(call, callee.text)
  );
}

/** Detects conventional function-parameter shadowing without attempting whole-program binding. */
function isShadowedByAncestorParameter(node: ts.Node, name: string): boolean {
  let current: ts.Node = node.parent;
  while (!ts.isSourceFile(current)) {
    if (
      ts.isFunctionLike(current) &&
      current.parameters.some((parameter) => bindingContainsName(parameter.name, name))
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/** Recursively checks identifier, object, and array binding patterns. */
function bindingContainsName(binding: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(binding)) return binding.text === name;
  return binding.elements.some(
    (element) => !ts.isOmittedExpression(element) && bindingContainsName(element.name, name),
  );
}

/** Reads a zero-argument loader whose direct return is one literal dynamic import. */
function readDirectLoaderImport(
  loaderExpression: ts.Expression | undefined,
): ts.CallExpression | undefined {
  if (loaderExpression === undefined) return undefined;
  const loader = unwrapExpression(loaderExpression);
  if (
    (!ts.isArrowFunction(loader) && !ts.isFunctionExpression(loader)) ||
    loader.parameters.length !== 0
  ) {
    return undefined;
  }
  const returned = readReturnExpression(loader.body);
  if (returned === undefined) return undefined;
  const candidate = unwrapAwaitExpression(returned);
  const moduleSpecifier = ts.isCallExpression(candidate) ? candidate.arguments[0] : undefined;
  if (
    !ts.isCallExpression(candidate) ||
    candidate.expression.kind !== ts.SyntaxKind.ImportKeyword ||
    candidate.arguments.length !== 1 ||
    moduleSpecifier === undefined ||
    !ts.isStringLiteral(moduleSpecifier)
  ) {
    return undefined;
  }
  return candidate;
}

/** Reads a concise loader or a block containing exactly one return statement. */
function readReturnExpression(body: ts.ConciseBody): ts.Expression | undefined {
  if (!ts.isBlock(body)) return body;
  const statement = body.statements[0];
  return body.statements.length === 1 && statement !== undefined && ts.isReturnStatement(statement)
    ? statement.expression
    : undefined;
}

/** Removes a single await plus syntax-erased wrappers around a returned import. */
function unwrapAwaitExpression(expression: ts.Expression): ts.Expression {
  const unwrapped = unwrapExpression(expression);
  return ts.isAwaitExpression(unwrapped) ? unwrapExpression(unwrapped.expression) : unwrapped;
}

/** Removes syntax-only TypeScript wrappers. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}
