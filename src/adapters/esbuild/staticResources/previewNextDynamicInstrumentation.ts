/**
 * Normalizes static `next/dynamic` loader results for esbuild's CommonJS import interop.
 *
 * Next's normal Webpack/SWC pipeline often receives a single `{ default: Component }` namespace.
 * Esbuild correctly wraps some CommonJS packages as `{ default: { default: Component } }`; older
 * Next `dynamic()` implementations unwrap only once and pass the remaining object to React.lazy.
 * This bounded source edit removes at most one extra default layer. Conventional named-export
 * selectors also retain the module default as a last-resort inert corridor placeholder, because
 * Page Inspector deliberately replaces unrelated lazy routes with a default-only module.
 */
import path from 'node:path';
import ts from 'typescript';
import type { PreviewSourceReplacement } from './previewSourceReplacement';

const NEXT_DYNAMIC_SPECIFIER = 'next/dynamic';
const MAX_NEXT_DYNAMIC_LOADERS = 128;

/**
 * Wraps literal-import results returned by statically imported `next/dynamic` loaders.
 * A conventional `.then((module) => module.Component)` keeps its authored component first and adds
 * only a nullish default fallback. Computed imports, transforming callbacks, and unrelated dynamic
 * identifiers fail closed.
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
      const loader = readNextDynamicLoader(node.arguments[0]);
      if (loader?.selection !== undefined) {
        const moduleName = loader.selection.moduleParameter.text;
        const selectionText = loader.selection.expression.getText(sourceFile);
        replacements.push({
          end: loader.selection.expression.getEnd(),
          replacement: `(${selectionText} ?? ${moduleName}?.default?.default ?? ${moduleName}?.default ?? (() => null))`,
          start: loader.selection.expression.getStart(sourceFile),
        });
      } else if (loader !== undefined) {
        const importText = loader.importCall.getText(sourceFile);
        replacements.push({
          end: loader.importCall.getEnd(),
          replacement: `${importText}.then((__reactPreviewDynamicModule) => (__reactPreviewDynamicModule?.default?.default ?? __reactPreviewDynamicModule?.default ?? __reactPreviewDynamicModule))`,
          start: loader.importCall.getStart(sourceFile),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return replacements.sort((left, right) => left.start - right.start);
}

/** One statically proven loader and its optional conventional named-export selector. */
interface NextDynamicLoaderAnalysis {
  readonly importCall: ts.CallExpression;
  readonly selection?: {
    readonly expression: ts.Expression;
    readonly moduleParameter: ts.Identifier;
  };
}

/**
 * Lists literal modules assigned through `next/dynamic` and rendered as JSX in the same source.
 * The corridor plugin uses this conservative evidence to retain real page-local lazy components
 * without retaining broad route registries that merely declare many deferred branches.
 */
export function collectRenderedNextDynamicSpecifiers(
  sourcePath: string,
  sourceText: string,
): ReadonlySet<string> {
  if (!sourceText.includes(NEXT_DYNAMIC_SPECIFIER) || !sourceText.includes('import(')) {
    return new Set();
  }
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    selectScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) return new Set();
  const bindings = collectNextDynamicBindings(sourceFile);
  if (bindings.size === 0) return new Set();
  const renderedBindings = collectJsxComponentBindings(sourceFile);
  const specifiers = new Set<string>();

  /** Retains only a direct variable binding that appears as a JSX component in this module. */
  const visit = (node: ts.Node): void => {
    if (specifiers.size >= MAX_NEXT_DYNAMIC_LOADERS) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const initializer = unwrapExpression(node.initializer);
      if (
        ts.isCallExpression(initializer) &&
        isNextDynamicCall(initializer, bindings) &&
        renderedBindings.has(node.name.text)
      ) {
        const loader = readNextDynamicLoader(initializer.arguments[0]);
        const moduleSpecifier = loader?.importCall.arguments[0];
        if (moduleSpecifier !== undefined && ts.isStringLiteral(moduleSpecifier)) {
          specifiers.add(moduleSpecifier.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return specifiers;
}

/** Collects root identifiers from authored JSX element names. */
function collectJsxComponentBindings(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const bindings = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      let tagName: ts.JsxTagNameExpression = node.tagName;
      while (ts.isPropertyAccessExpression(tagName)) tagName = tagName.expression;
      if (ts.isIdentifier(tagName) && /^[A-Z]/u.test(tagName.text)) bindings.add(tagName.text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return bindings;
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

/** Reads a zero-argument loader returning a literal import or conventional named selection. */
function readNextDynamicLoader(
  loaderExpression: ts.Expression | undefined,
): NextDynamicLoaderAnalysis | undefined {
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
  if (isLiteralDynamicImport(candidate)) return { importCall: candidate };
  if (!ts.isCallExpression(candidate) || candidate.arguments.length !== 1) return undefined;
  const thenExpression = unwrapExpression(candidate.expression);
  if (!ts.isPropertyAccessExpression(thenExpression) || thenExpression.name.text !== 'then') {
    return undefined;
  }
  const importCall = unwrapExpression(thenExpression.expression);
  if (!isLiteralDynamicImport(importCall)) return undefined;
  const callbackExpression = candidate.arguments[0];
  if (callbackExpression === undefined) return undefined;
  const callback = unwrapExpression(callbackExpression);
  if (
    (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) ||
    callback.parameters.length !== 1
  ) {
    return undefined;
  }
  const parameter = callback.parameters[0];
  if (parameter === undefined || !ts.isIdentifier(parameter.name)) return undefined;
  const selection = readReturnExpression(callback.body);
  if (
    selection === undefined ||
    !isDirectModuleMemberSelection(unwrapExpression(selection), parameter.name.text)
  ) {
    return undefined;
  }
  return {
    importCall,
    selection: {
      expression: unwrapExpression(selection),
      moduleParameter: parameter.name,
    },
  };
}

/** Proves an `import("literal")` call without accepting computed or multi-argument proposals. */
function isLiteralDynamicImport(expression: ts.Expression): expression is ts.CallExpression {
  const moduleSpecifier = ts.isCallExpression(expression) ? expression.arguments[0] : undefined;
  return (
    ts.isCallExpression(expression) &&
    expression.expression.kind === ts.SyntaxKind.ImportKeyword &&
    expression.arguments.length === 1 &&
    moduleSpecifier !== undefined &&
    ts.isStringLiteral(moduleSpecifier)
  );
}

/** Accepts only `module.Name` or `module["Name"]`, never an arbitrary transforming callback. */
function isDirectModuleMemberSelection(expression: ts.Expression, moduleName: string): boolean {
  if (ts.isPropertyAccessExpression(expression)) {
    const receiver = unwrapExpression(expression.expression);
    return ts.isIdentifier(receiver) && receiver.text === moduleName;
  }
  if (!ts.isElementAccessExpression(expression)) return false;
  const receiver = unwrapExpression(expression.expression);
  return (
    ts.isIdentifier(receiver) &&
    receiver.text === moduleName &&
    ts.isStringLiteral(expression.argumentExpression)
  );
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
