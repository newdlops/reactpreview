/**
 * Recovers accidental globals used by legacy sloppy-mode CommonJS dependencies.
 * Browser script loaders historically allowed `name = value` to create a window property, while an
 * esbuild ESM output is strict and rejects that same reached package before React can render.
 */
import path from 'node:path';
import ts from 'typescript';
import type { Metafile } from 'esbuild';
import type { PreviewBuildRequest } from '../../domain/preview';
import { collectPreviewBuildDependencies } from './previewBuildResult';
import { resolvePreviewYarnVirtualPath } from './previewYarnVirtualPath';

const MAX_LEGACY_COMMON_JS_GLOBALS = 32;
const MAX_LEGACY_COMMON_JS_SOURCES = 512;
const MAX_LEGACY_COMMON_JS_SOURCE_BYTES = 512 * 1024;
const JAVASCRIPT_SOURCE_PATTERN = /\.(?:cjs|js)$/iu;
const JAVASCRIPT_IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const MINIFIED_JAVASCRIPT_PATTERN = /\.min\.js$/iu;
const NODE_MODULES_PATH_PATTERN = /(?:^|[/\\])node_modules[/\\]/u;

/** Browser and CommonJS bindings that are already provided by their native execution environment. */
const KNOWN_RUNTIME_BINDINGS = new Set([
  'Array',
  'ArrayBuffer',
  'BigInt',
  'Blob',
  'Boolean',
  'Buffer',
  'Date',
  'Error',
  'File',
  'FileReader',
  'Function',
  'Infinity',
  'JSON',
  'Map',
  'Math',
  'NaN',
  'Number',
  'Object',
  'Promise',
  'Proxy',
  'Reflect',
  'RegExp',
  'Set',
  'String',
  'Symbol',
  'URL',
  'URLSearchParams',
  'Uint8Array',
  'WeakMap',
  'WeakSet',
  'arguments',
  'console',
  'crypto',
  'define',
  'document',
  'exports',
  'fetch',
  'global',
  'globalThis',
  'location',
  'module',
  'navigator',
  'process',
  'require',
  'self',
  'undefined',
  'window',
]);

/** Current-source reader shared with other compiler-lifetime bounded syntax analyzers. */
export type ReadPreviewLegacyCommonJsSource = (
  sourcePath: string,
  maximumBytes: number,
) => Promise<string | undefined>;

/** Successful build metadata and prior hot-build plan used by one exact refinement pass. */
export interface DiscoverPreviewLegacyCommonJsGlobalsOptions {
  /** Names already rewritten in the build represented by `metafile`. */
  readonly currentGlobalNames: readonly string[];
  /** Exact esbuild input graph reached by the selected authored page. */
  readonly metafile: Metafile;
  /** Cached, byte-bounded file reader that never evaluates package source. */
  readonly readSource: ReadPreviewLegacyCommonJsSource;
  /** Build request used to restore relative and Yarn virtual input identities. */
  readonly request: PreviewBuildRequest;
}

/** Stable compatibility plan and whether the generated esbuild definitions must be rebuilt. */
export interface PreviewLegacyCommonJsGlobalPlan {
  /** True only when the reached dependency graph proves a different accidental-global set. */
  readonly changed: boolean;
  /** Sorted identifier names whose sloppy writes should target `globalThis`. */
  readonly globalNames: readonly string[];
}

/**
 * Finds assignment-only free identifiers in reached, non-strict CommonJS package modules.
 * Minified files are inspected first because legacy UMD packages commonly publish them as `main`;
 * all reads and accepted names remain bounded to protect large monorepo dependency graphs.
 */
export async function discoverPreviewLegacyCommonJsGlobals(
  options: DiscoverPreviewLegacyCommonJsGlobalsOptions,
): Promise<PreviewLegacyCommonJsGlobalPlan> {
  const sourcePaths = selectLegacyCommonJsSourcePaths(
    collectPreviewBuildDependencies(options.request, options.metafile)
      .map((sourcePath) => resolvePreviewYarnVirtualPath(sourcePath, options.request.workspaceRoot))
      .filter((sourcePath): sourcePath is string => sourcePath !== undefined),
  );
  const globalNames = new Set<string>();
  for (let offset = 0; offset < sourcePaths.length; offset += 24) {
    const pathBatch = sourcePaths.slice(offset, offset + 24);
    const sourceBatch = await Promise.all(
      pathBatch.map(async (sourcePath) => ({
        sourcePath,
        sourceText: await options.readSource(sourcePath, MAX_LEGACY_COMMON_JS_SOURCE_BYTES),
      })),
    );
    for (const { sourcePath, sourceText } of sourceBatch) {
      if (sourceText === undefined) continue;
      for (const globalName of collectLegacyCommonJsGlobalWrites(sourcePath, sourceText)) {
        globalNames.add(globalName);
        if (globalNames.size >= MAX_LEGACY_COMMON_JS_GLOBALS) break;
      }
      if (globalNames.size >= MAX_LEGACY_COMMON_JS_GLOBALS) break;
    }
    if (globalNames.size >= MAX_LEGACY_COMMON_JS_GLOBALS) break;
  }
  const normalizedNames = normalizeLegacyCommonJsGlobalNames([...globalNames]);
  return Object.freeze({
    changed: !haveEqualStringLists(normalizedNames, options.currentGlobalNames),
    globalNames: normalizedNames,
  });
}

/** Creates scope-aware esbuild replacements that preserve the original browser-global semantics. */
export function createPreviewLegacyCommonJsGlobalDefines(
  globalNames: readonly string[],
): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      normalizeLegacyCommonJsGlobalNames(globalNames).map((globalName) => [
        globalName,
        `globalThis.${globalName}`,
      ]),
    ),
  );
}

/** Prioritizes minified/explicit CommonJS files without accepting authored workspace source. */
function selectLegacyCommonJsSourcePaths(dependencyPaths: readonly string[]): readonly string[] {
  return [
    ...new Set(
      dependencyPaths
        .map((sourcePath) => path.normalize(sourcePath))
        .filter(
          (sourcePath) =>
            NODE_MODULES_PATH_PATTERN.test(sourcePath) &&
            JAVASCRIPT_SOURCE_PATTERN.test(sourcePath),
        ),
    ),
  ]
    .sort(
      (left, right) =>
        Number(MINIFIED_JAVASCRIPT_PATTERN.test(right)) -
          Number(MINIFIED_JAVASCRIPT_PATTERN.test(left)) || left.localeCompare(right),
    )
    .slice(0, MAX_LEGACY_COMMON_JS_SOURCES);
}

/** Parses one package script and returns only sloppy, undeclared assignment targets. */
function collectLegacyCommonJsGlobalWrites(
  sourcePath: string,
  sourceText: string,
): readonly string[] {
  if (!sourceText.includes('=') || !/\b(?:exports|module|require)\b/u.test(sourceText)) return [];
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if (
    (parseDiagnostics?.length ?? 0) > 0 ||
    ts.isExternalModule(sourceFile) ||
    hasUseStrictDirective(sourceFile.statements) ||
    !containsCommonJsBoundary(sourceFile)
  ) {
    return [];
  }

  const declaredNames = collectDeclaredNames(sourceFile);
  const globalWrites = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      collectAssignmentTargetNames(node.left, node, declaredNames, globalWrites);
    } else if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      collectAssignmentTargetNames(node.operand, node, declaredNames, globalWrites);
    } else if (
      (ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
      !ts.isVariableDeclarationList(node.initializer)
    ) {
      collectAssignmentTargetNames(node.initializer, node, declaredNames, globalWrites);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return normalizeLegacyCommonJsGlobalNames([...globalWrites]);
}

/** Collects all explicit bindings conservatively; an uncertain shadow prevents automatic rewriting. */
function collectDeclaredNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const declaredNames = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) ||
      ts.isParameter(node) ||
      ts.isBindingElement(node) ||
      ts.isCatchClause(node)
    ) {
      const bindingName = ts.isCatchClause(node) ? node.variableDeclaration?.name : node.name;
      if (bindingName !== undefined) collectBindingName(bindingName, declaredNames);
    } else if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isImportEqualsDeclaration(node)) &&
      node.name !== undefined
    ) {
      declaredNames.add(node.name.text);
    } else if (ts.isImportClause(node) && node.name !== undefined) {
      declaredNames.add(node.name.text);
    } else if (ts.isNamespaceImport(node) || ts.isImportSpecifier(node)) {
      declaredNames.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return declaredNames;
}

/** Expands array/object binding patterns into their actual local identifier declarations. */
function collectBindingName(bindingName: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(bindingName)) {
    names.add(bindingName.text);
    return;
  }
  for (const element of bindingName.elements) {
    if (ts.isBindingElement(element)) collectBindingName(element.name, names);
  }
}

/** Extracts identifiers written by simple or destructuring assignments outside strict scopes. */
function collectAssignmentTargetNames(
  target: ts.Expression,
  writeNode: ts.Node,
  declaredNames: ReadonlySet<string>,
  globalWrites: Set<string>,
): void {
  if (isNodeInStrictScope(writeNode)) return;
  const unwrappedTarget = unwrapAssignmentTarget(target);
  if (ts.isIdentifier(unwrappedTarget)) {
    const name = unwrappedTarget.text;
    if (!declaredNames.has(name) && !KNOWN_RUNTIME_BINDINGS.has(name)) globalWrites.add(name);
    return;
  }
  if (ts.isArrayLiteralExpression(unwrappedTarget)) {
    for (const element of unwrappedTarget.elements) {
      if (!ts.isOmittedExpression(element)) {
        collectAssignmentTargetNames(
          ts.isSpreadElement(element) ? element.expression : element,
          writeNode,
          declaredNames,
          globalWrites,
        );
      }
    }
    return;
  }
  if (!ts.isObjectLiteralExpression(unwrappedTarget)) return;
  for (const property of unwrappedTarget.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      collectAssignmentTargetNames(property.name, writeNode, declaredNames, globalWrites);
    } else if (ts.isPropertyAssignment(property)) {
      collectAssignmentTargetNames(property.initializer, writeNode, declaredNames, globalWrites);
    } else if (ts.isSpreadAssignment(property)) {
      collectAssignmentTargetNames(property.expression, writeNode, declaredNames, globalWrites);
    }
  }
}

/** Removes TypeScript-only wrappers that do not introduce a JavaScript assignment target. */
function unwrapAssignmentTarget(target: ts.Expression): ts.Expression {
  let current = target;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Proves the source actually participates in a CommonJS/UMD module contract. */
function containsCommonJsBoundary(sourceFile: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require'
    ) {
      found = true;
      return;
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ((ts.isIdentifier(node.expression) && node.expression.text === 'module') ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'exports'))
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** Reports strict source/function/class semantics at the exact write location. */
function isNodeInStrictScope(node: ts.Node): boolean {
  for (let current = node.parent; !ts.isSourceFile(current); current = current.parent) {
    if (ts.isClassDeclaration(current) || ts.isClassExpression(current)) return true;
    const statements = getFunctionBodyStatements(current);
    if (statements !== undefined && hasUseStrictDirective(statements)) return true;
  }
  return false;
}

/** Returns directive-bearing statements only for JavaScript function bodies. */
function getFunctionBodyStatements(node: ts.Node): readonly ts.Statement[] | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  ) {
    return node.body !== undefined && ts.isBlock(node.body) ? node.body.statements : undefined;
  }
  return undefined;
}

/** Reads only the directive prologue, so unrelated later string literals cannot disable recovery. */
function hasUseStrictDirective(statements: readonly ts.Statement[]): boolean {
  for (const statement of statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) {
      return false;
    }
    if (statement.expression.text === 'use strict') return true;
  }
  return false;
}

/** Produces a safe, deterministic, bounded list accepted by esbuild's identifier `define` keys. */
function normalizeLegacyCommonJsGlobalNames(globalNames: readonly string[]): readonly string[] {
  return Object.freeze(
    [...new Set(globalNames)]
      .filter((name) => JAVASCRIPT_IDENTIFIER_PATTERN.test(name))
      .sort()
      .slice(0, MAX_LEGACY_COMMON_JS_GLOBALS),
  );
}

/** Compares normalized plans without allocating another set during every hot rebuild. */
function haveEqualStringLists(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}
