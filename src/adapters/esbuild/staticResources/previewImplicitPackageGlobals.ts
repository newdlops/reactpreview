/**
 * Discovers missing library globals only when source syntax and package resolution agree.
 *
 * Some browser applications rely on Webpack ProvidePlugin, an HTML bootstrap, or another build
 * convention that makes packages such as `dayjs` available without authored imports. The preview
 * intentionally does not execute those project build configurations. This analyzer provides a
 * narrow compatibility signal instead: a runtime identifier must be lexically free, its exact name
 * must be a valid unscoped package specifier, and the importing module must resolve that specifier
 * into an installed `node_modules` package. No project module or package code is evaluated here.
 */
import path from 'node:path';
import ts from 'typescript';
import type { PreviewStaticModuleResolver } from '../previewStaticModuleResolver';
import { isSafePreviewRuntimeGlobalName } from '../previewRuntimeEnvironment';
import { StaticSourceAnalysis } from './staticCallParser';

/** Maximum package-resolution probes permitted for one authored source module. */
export const MAX_IMPLICIT_PACKAGE_GLOBAL_CANDIDATES = 32;

/** Lowercase exact names accepted as conservative unscoped npm package candidates. */
const PACKAGE_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/u;

/** Standard runtime names that must remain owned by the browser or JavaScript engine. */
const STANDARD_RUNTIME_GLOBALS = new Set([
  'arguments',
  'atob',
  'btoa',
  'console',
  'crypto',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'escape',
  'eval',
  'event',
  'fetch',
  'isFinite',
  'isNaN',
  'localStorage',
  'performance',
  'queueMicrotask',
  'sessionStorage',
  'setImmediate',
  'setInterval',
  'setTimeout',
  'structuredClone',
  'unescape',
  'webkitURL',
]);

/** Static module data required by one bounded implicit-global discovery pass. */
export interface PreviewImplicitPackageGlobalOptions {
  /** Optional exact dependency names used to skip modules with no relevant identifier token. */
  readonly candidateNames?: readonly string[];
  /** Optional lower per-module resolution budget used by focused hosts and tests. */
  readonly maximumCandidates?: number;
  /** Resolver configured with the importing project's nearest tsconfig and node_modules roots. */
  readonly resolver: Pick<PreviewStaticModuleResolver, 'resolve'>;
  /** Absolute project-owned module path used as the package-resolution origin. */
  readonly sourcePath: string;
  /** Current editor snapshot or filesystem source that esbuild will load. */
  readonly sourceText: string;
  /** Optional parser-owned analysis already created by the workspace source transformer. */
  readonly sourceAnalysis?: StaticSourceAnalysis;
}

/** One library global proven by both an unbound value reference and installed package resolution. */
export interface PreviewImplicitPackageGlobal {
  /** Identifier that a later runtime prelude may define on `globalThis`. */
  readonly globalName: string;
  /** Exact bare package specifier to import before evaluating the application module graph. */
  readonly moduleSpecifier: string;
  /** Every approved runtime reference range in the original, unmodified source snapshot. */
  readonly references: readonly PreviewImplicitPackageGlobalReference[];
  /** Canonical package entry returned by the existing static project resolver. */
  readonly resolvedPath: string;
}

/** Source span for one free identifier, suitable for a right-to-left compatibility rewrite. */
export interface PreviewImplicitPackageGlobalReference {
  /** Exclusive UTF-16 source offset immediately after the identifier token. */
  readonly end: number;
  /** Inclusive UTF-16 source offset at the beginning of the identifier token. */
  readonly start: number;
}

/** Immutable discovery outcome including evidence when the per-module safety budget was reached. */
export interface PreviewImplicitPackageGlobalInventory {
  /** Approved package globals ordered deterministically by identifier name. */
  readonly globals: readonly PreviewImplicitPackageGlobal[];
  /** Number of package-shaped free identifiers considered before applying the resolution budget. */
  readonly packageCandidateCount: number;
  /** Whether lower-priority candidates were deliberately left unresolved to bound filesystem work. */
  readonly truncated: boolean;
}

/** Minimal compiler host that binds one already parsed source tree without reading project files. */
interface SingleSourceCompilerHost extends ts.CompilerHost {
  /** Identity of the only source file admitted to the lexical binding program. */
  readonly sourcePath: string;
}

/**
 * Finds installed packages referenced through otherwise unbound runtime identifiers.
 *
 * The TypeScript checker is hosted over exactly one pre-parsed module with `noResolve` and `noLib`.
 * It is used only as a lexical binder, so imports, parameters, nested closures, destructuring, and
 * shadowing are classified correctly without loading a tsconfig, declarations, or dependencies.
 * Browser globals stay unresolved in that tiny program but are rejected by name and, critically,
 * by the installed-package proof. Resolution candidates are sorted before applying the budget so
 * repeated builds produce the same result.
 *
 * @param options Source snapshot, static resolver, and optional conservative candidate budget.
 * @returns Approved globals plus truncation metadata; never imports or executes package code.
 */
export function collectPreviewImplicitPackageGlobals(
  options: PreviewImplicitPackageGlobalOptions,
): PreviewImplicitPackageGlobalInventory {
  const maximumCandidates = normalizeCandidateLimit(options.maximumCandidates);
  const analysis =
    options.sourceAnalysis ?? new StaticSourceAnalysis(options.sourcePath, options.sourceText);
  const candidateNames = normalizeCandidateNames(options.candidateNames);
  if (
    candidateNames !== undefined &&
    ![...candidateNames].some((candidateName) => analysis.hasIdentifier(candidateName))
  ) {
    return Object.freeze({
      globals: Object.freeze([]),
      packageCandidateCount: 0,
      truncated: false,
    });
  }
  const sourceFile = analysis.getSourceFile();
  const checker = createLexicalChecker(options.sourcePath, sourceFile);
  const referencesByName = collectPackageShapedFreeIdentifiers(sourceFile, checker, candidateNames);
  const freeNames = [...referencesByName.keys()].sort();
  const selectedNames = freeNames.slice(0, maximumCandidates);
  const globals: PreviewImplicitPackageGlobal[] = [];

  for (const globalName of selectedNames) {
    const resolvedPath = options.resolver.resolve(globalName, options.sourcePath);
    if (
      resolvedPath === undefined ||
      !isInstalledExactPackageResolution(globalName, resolvedPath)
    ) {
      continue;
    }
    globals.push({
      globalName,
      moduleSpecifier: globalName,
      references: Object.freeze(referencesByName.get(globalName) ?? []),
      resolvedPath,
    });
  }

  return Object.freeze({
    globals: Object.freeze(globals),
    packageCandidateCount: freeNames.length,
    truncated: freeNames.length > selectedNames.length,
  });
}

/**
 * Builds a checker that performs lexical binding only and cannot traverse imports or ambient libs.
 * The source tree comes from `StaticSourceAnalysis`, preserving its TSX grammar and syntax failure
 * policy across every static compatibility analyzer.
 */
function createLexicalChecker(sourcePath: string, sourceFile: ts.SourceFile): ts.TypeChecker {
  const normalizedSourcePath = path.resolve(sourcePath);
  const host: SingleSourceCompilerHost = {
    fileExists: (filePath) => path.resolve(filePath) === normalizedSourcePath,
    getCanonicalFileName: (fileName) =>
      ts.sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase(),
    getCurrentDirectory: () => path.dirname(normalizedSourcePath),
    getDefaultLibFileName: () =>
      path.join(path.dirname(normalizedSourcePath), '__preview_lib__.d.ts'),
    getNewLine: () => '\n',
    getSourceFile: (fileName) =>
      path.resolve(fileName) === normalizedSourcePath ? sourceFile : undefined,
    readFile: (filePath) =>
      path.resolve(filePath) === normalizedSourcePath ? sourceFile.text : undefined,
    sourcePath: normalizedSourcePath,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    writeFile: () => undefined,
  };
  const program = ts.createProgram({
    host,
    options: {
      allowJs: true,
      jsx: ts.JsxEmit.Preserve,
      noLib: true,
      noResolve: true,
      target: ts.ScriptTarget.Latest,
    },
    rootNames: [normalizedSourcePath],
  });
  return program.getTypeChecker();
}

/** Collects deterministic package-shaped names whose value references have no runtime binding. */
function collectPackageShapedFreeIdentifiers(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  candidateNames: ReadonlySet<string> | undefined,
): ReadonlyMap<string, readonly PreviewImplicitPackageGlobalReference[]> {
  const referencesByName = new Map<string, PreviewImplicitPackageGlobalReference[]>();
  const writtenGlobalNames = new Set<string>();

  /** Visits value-bearing syntax while retaining TypeScript's exact lexical symbol classification. */
  function visit(node: ts.Node): void {
    if (
      ts.isIdentifier(node) &&
      isRuntimeIdentifierReference(node) &&
      isPackageGlobalCandidateName(node.text) &&
      (candidateNames === undefined || candidateNames.has(node.text)) &&
      !hasRuntimeLexicalBinding(node, checker)
    ) {
      if (isDirectRuntimeWriteReference(node)) {
        writtenGlobalNames.add(node.text);
      } else {
        const references = referencesByName.get(node.text) ?? [];
        references.push({ end: node.end, start: node.getStart(sourceFile) });
        referencesByName.set(node.text, references);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  for (const writtenGlobalName of writtenGlobalNames) {
    referencesByName.delete(writtenGlobalName);
  }
  return new Map(
    [...referencesByName.entries()]
      .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
      .map(([name, references]) => [name, Object.freeze(references)]),
  );
}

/**
 * Rejects globals that application code rebinds because an injected ESM binding is read-only.
 * Member writes such as `library.locale = value` remain ordinary reads of the library object;
 * only the identifier itself, including a destructuring assignment target, is disqualifying.
 */
function isDirectRuntimeWriteReference(identifier: ts.Identifier): boolean {
  let current: ts.Node = identifier;
  let parent = current.parent;
  while (
    ts.isParenthesizedExpression(parent) ||
    ts.isArrayLiteralExpression(parent) ||
    ts.isObjectLiteralExpression(parent) ||
    ts.isPropertyAssignment(parent) ||
    ts.isShorthandPropertyAssignment(parent) ||
    ts.isSpreadElement(parent)
  ) {
    current = parent;
    parent = current.parent;
  }
  if (
    ts.isBinaryExpression(parent) &&
    parent.left === current &&
    parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  ) {
    return true;
  }
  if (
    (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
    (parent.operator === ts.SyntaxKind.PlusPlusToken ||
      parent.operator === ts.SyntaxKind.MinusMinusToken)
  ) {
    return true;
  }
  return (
    (ts.isDeleteExpression(parent) && parent.expression === current) ||
    ((ts.isForInStatement(parent) || ts.isForOfStatement(parent)) && parent.initializer === current)
  );
}

/** Validates and freezes an optional candidate allow-list without widening package-name policy. */
function normalizeCandidateNames(
  names: readonly string[] | undefined,
): ReadonlySet<string> | undefined {
  if (names === undefined) {
    return undefined;
  }
  return new Set(names.filter(isPackageGlobalCandidateName));
}

/**
 * Reports whether a decoded free identifier can safely double as an exact npm package specifier.
 * Exact lowercase matching avoids guesses such as mapping `Cookies` to `js-cookie` or `React` to
 * `react`; those conventions require an explicit preview setup because package identity is not
 * statically provable from the identifier alone.
 */
function isPackageGlobalCandidateName(name: string): boolean {
  return (
    PACKAGE_IDENTIFIER_PATTERN.test(name) &&
    isSafePreviewRuntimeGlobalName(name) &&
    !STANDARD_RUNTIME_GLOBALS.has(name)
  );
}

/**
 * Uses the lexical checker to reject imports and every local declaration in the correct scope.
 * Symbols made exclusively from ambient/type declarations do not create a runtime value and remain
 * eligible; this supports modules that locally document a build-provided global with `declare`.
 */
function hasRuntimeLexicalBinding(identifier: ts.Identifier, checker: ts.TypeChecker): boolean {
  const symbol = ts.isShorthandPropertyAssignment(identifier.parent)
    ? checker.getShorthandAssignmentValueSymbol(identifier.parent)
    : checker.getSymbolAtLocation(identifier);
  return symbol?.declarations?.some(isRuntimeDeclaration) ?? false;
}

/** Classifies one symbol declaration by whether evaluating this source creates its value binding. */
function isRuntimeDeclaration(declaration: ts.Declaration): boolean {
  if (isTypeOnlyDeclaration(declaration) || isAmbientDeclaration(declaration)) {
    return false;
  }
  if (ts.isImportSpecifier(declaration)) {
    return (
      !declaration.getChildren().some((child) => child.kind === ts.SyntaxKind.TypeKeyword) &&
      declaration.parent.parent.phaseModifier !== ts.SyntaxKind.TypeKeyword
    );
  }
  if (ts.isImportClause(declaration)) {
    return declaration.phaseModifier !== ts.SyntaxKind.TypeKeyword;
  }
  return true;
}

/** Rejects declarations that exist only in TypeScript's erased type namespace. */
function isTypeOnlyDeclaration(declaration: ts.Declaration): boolean {
  return (
    ts.isInterfaceDeclaration(declaration) ||
    ts.isTypeAliasDeclaration(declaration) ||
    ts.isTypeParameterDeclaration(declaration) ||
    (ts.isExportSpecifier(declaration) && declaration.isTypeOnly)
  );
}

/** Detects `declare` on a declaration or its containing variable statement/module declaration. */
function isAmbientDeclaration(declaration: ts.Declaration): boolean {
  let current: ts.Node = declaration;
  while (!ts.isSourceFile(current)) {
    if (ts.canHaveModifiers(current)) {
      const modifiers = ts.getModifiers(current);
      if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword) === true) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

/**
 * Filters identifier tokens that do not read or write runtime values.
 *
 * This removes declaration names, non-computed property keys, labels, import/export syntax, type
 * positions, JSX intrinsic tag names, and standalone `typeof missingName` feature probes. A name
 * used elsewhere in the same module is still collected through that separate value reference.
 */
function isRuntimeIdentifierReference(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if (
    isDeclarationName(identifier) ||
    isNonComputedPropertyName(identifier) ||
    isModuleSyntaxName(parent) ||
    isLabelName(identifier) ||
    isInsideTypeOnlySyntax(identifier) ||
    parent.kind === ts.SyntaxKind.TypeOfExpression ||
    ts.isMetaProperty(parent) ||
    ts.isJsxAttribute(parent)
  ) {
    return false;
  }
  if (isJsxTagIdentifier(identifier)) {
    return !isJsxIntrinsicName(identifier.text);
  }
  return true;
}

/** Recognizes names that introduce bindings instead of consuming existing runtime values. */
function isDeclarationName(identifier: ts.Identifier): boolean {
  let current: ts.Node = identifier;
  let parent = current.parent;
  while (ts.isBindingElement(parent) && parent.name === current) {
    current = parent;
    parent = current.parent;
  }
  return (
    (isRuntimeOrTypeBindingDeclaration(parent) && parent.name === current) ||
    (ts.isImportClause(parent) && parent.name === current) ||
    ts.isNamespaceImport(parent)
  );
}

/** Narrows declarations whose `name` field introduces a local/type binding or declaration key. */
function isRuntimeOrTypeBindingDeclaration(node: ts.Node): node is ts.NamedDeclaration {
  return (
    ts.isVariableDeclaration(node) ||
    ts.isParameter(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isClassDeclaration(node) ||
    ts.isClassExpression(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isTypeParameterDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isModuleDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isEnumMember(node) ||
    ts.isImportEqualsDeclaration(node) ||
    ts.isImportSpecifier(node)
  );
}

/** Rejects `.member` and literal property keys while retaining computed keys and shorthand values. */
function isNonComputedPropertyName(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === identifier) {
    return true;
  }
  if (ts.isShorthandPropertyAssignment(parent)) {
    return false;
  }
  return (
    'name' in parent &&
    (parent as ts.NamedDeclaration).name === identifier &&
    !ts.isComputedPropertyName(identifier)
  );
}

/** Rejects bindings and source/export names that are metadata rather than runtime expressions. */
function isModuleSyntaxName(parent: ts.Node): boolean {
  return (
    ts.isImportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isImportEqualsDeclaration(parent)
  );
}

/** Rejects statement labels and matching `break` or `continue` targets. */
function isLabelName(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  return (
    (ts.isLabeledStatement(parent) && parent.label === identifier) ||
    ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === identifier)
  );
}

/** Walks outward until a statement/expression boundary to reject identifiers in erased types. */
function isInsideTypeOnlySyntax(identifier: ts.Identifier): boolean {
  let current: ts.Node = identifier;
  while (!ts.isSourceFile(current.parent)) {
    const parent = current.parent;
    if (ts.isExpressionWithTypeArguments(parent)) {
      return parent.expression !== current || !isRuntimeClassExtendsClause(parent.parent);
    }
    if (ts.isTypeNode(parent)) {
      return true;
    }
    if (ts.isStatement(parent) || ts.isExpression(parent) || ts.isJsxElement(parent)) {
      return false;
    }
    current = parent;
  }
  return false;
}

/** Accepts the expression side of a class `extends`, but not interfaces or `implements` clauses. */
function isRuntimeClassExtendsClause(node: ts.Node): boolean {
  return (
    ts.isHeritageClause(node) &&
    node.token === ts.SyntaxKind.ExtendsKeyword &&
    ts.isClassLike(node.parent)
  );
}

/** Detects identifier tokens used as opening, self-closing, or closing JSX tag names. */
function isJsxTagIdentifier(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  return (
    ((ts.isJsxOpeningElement(parent) ||
      ts.isJsxSelfClosingElement(parent) ||
      ts.isJsxClosingElement(parent)) &&
      parent.tagName === identifier) ||
    (ts.isJsxNamespacedName(parent) &&
      (parent.name === identifier || parent.namespace === identifier))
  );
}

/** Matches React's lowercase/hyphenated JSX convention for host elements rather than variables. */
function isJsxIntrinsicName(name: string): boolean {
  return /^[a-z]/u.test(name);
}

/**
 * Proves that resolution crossed an exact `node_modules/<specifier>` package boundary.
 * Scanning every `node_modules` segment supports npm, pnpm's nested store, and hoisted monorepos
 * while rejecting tsconfig aliases and same-named workspace source files.
 */
function isInstalledExactPackageResolution(moduleSpecifier: string, resolvedPath: string): boolean {
  const segments = path.resolve(resolvedPath).split(path.sep);
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] === 'node_modules' && segments[index + 1] === moduleSpecifier) {
      return true;
    }
  }
  return false;
}

/** Clamps caller input so no integration can accidentally turn a local scan into unbounded I/O. */
function normalizeCandidateLimit(requestedLimit: number | undefined): number {
  if (requestedLimit === undefined || !Number.isFinite(requestedLimit)) {
    return MAX_IMPLICIT_PACKAGE_GLOBAL_CANDIDATES;
  }
  return Math.max(0, Math.min(MAX_IMPLICIT_PACKAGE_GLOBAL_CANDIDATES, Math.floor(requestedLimit)));
}
