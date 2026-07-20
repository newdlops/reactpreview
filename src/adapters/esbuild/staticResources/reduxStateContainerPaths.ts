/**
 * Collects Redux state object containers proven by reachable, non-optional selector dereferences.
 *
 * The collector is syntax-only and filesystem-free. It never executes a selector, imports a store,
 * invokes a reducer, or invents leaf values. A path is returned only when JavaScript would already
 * require that prefix to be a non-null object before reading the next direct property. Runtime code
 * may therefore promote absent or `null` automatic-state branches to plain objects while leaving
 * setup-owned state and every unproven leaf untouched.
 */
import path from 'node:path';
import ts from 'typescript';
import { collectPreviewReselectStateContainerPaths } from './previewReselectStateContainerPaths';

const MAX_ANALYSIS_SCOPES = 512;
const MAX_BINDINGS_PER_SCOPE = 256;
const MAX_CONTAINER_PATHS = 256;
const MAX_PATH_DEPTH = 16;
const MAX_PROPERTY_NAME_LENGTH = 128;
const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const SELECTOR_HOOK_PATTERN = /^use[A-Za-z0-9_$]*Selector$/u;

/** Selector-like hook bindings proven by a static import and conventional hook name. */
interface SelectorImports {
  /** Direct named or default hook imports. */
  readonly direct: ReadonlySet<string>;
  /** Namespace imports admitted only through their `.useSelector` member. */
  readonly namespaces: ReadonlySet<string>;
}

/** Mutable collection state shared by nested lexical-scope analysis. */
interface CollectionContext {
  /** Number of source/function scopes visited under the global safety bound. */
  scopeCount: number;
  /** Canonical paths keyed by a null-separated representation. */
  readonly paths: Map<string, readonly string[]>;
  /** Project selector imports available before local shadow filtering. */
  readonly selectorImports: SelectorImports;
}

/** Path resolution result and the container prefixes consumed while resolving an expression. */
interface BoundExpression {
  /** Complete state path represented by the expression's runtime value. */
  readonly statePath: readonly string[];
  /** Containers that must exist for the expression's direct property reads to complete. */
  readonly requiredContainers: readonly (readonly string[])[];
}

/**
 * Returns state container paths proven by direct useSelector-result dereferences in one source.
 *
 * Accepted examples include `const company = useSelector(s => s.company)` followed by
 * `company.subscription.isSuspended`, and const aliases or object destructuring derived from that
 * result. Optional chains, dynamic element access, method calls, writes, dynamic callbacks, array
 * bindings, and hooks without a statically imported selector-like name fail closed. String and
 * numeric literal element access is equivalent to a direct JavaScript property and is accepted.
 *
 * Paths are unique, shortest-first, deterministic, and deeply frozen. Leaf properties are omitted:
 * the example above returns `company` and `company.subscription`, never `isSuspended`.
 *
 * @param sourcePath Source identity used only to select JS, JSX, TS, or TSX parser grammar.
 * @param sourceText Reachable project source text, including an unsaved editor snapshot if present.
 * @returns Immutable object-container paths relative to the Redux root state.
 */
export function collectPreviewReduxStateContainerPaths(
  sourcePath: string,
  sourceText: string,
): readonly (readonly string[])[] {
  if (!sourceText.includes('Selector')) return [];
  const reselectPaths = collectPreviewReselectStateContainerPaths(sourcePath, sourceText);
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    selectScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) return reselectPaths;
  const selectorImports = collectSelectorImports(sourceFile);
  if (selectorImports.direct.size === 0 && selectorImports.namespaces.size === 0) {
    return reselectPaths;
  }

  const context: CollectionContext = {
    paths: new Map(),
    scopeCount: 0,
    selectorImports,
  };
  analyzeScope(sourceFile, new Map(), context);
  for (const containerPath of reselectPaths) addContainerPath(containerPath, context);
  const paths = [...context.paths.values()].sort(compareContainerPaths);
  return Object.freeze(paths.map((containerPath) => Object.freeze([...containerPath])));
}

/** Selects parser grammar from the authored extension without loading project configuration. */
function selectScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/** Reads parser diagnostics through TypeScript's stable source-file implementation field. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return (diagnostics?.length ?? 0) > 0;
}

/**
 * Collects conventionally named selector hooks from static imports.
 * Project wrappers are commonly exported from neutral paths such as `app/hooks`, so module names
 * are not treated as Redux proof. The callback and subsequent direct dereferences provide stronger
 * syntax evidence; an unrelated matching hook can at most register value-free object containers.
 */
function collectSelectorImports(sourceFile: ts.SourceFile): SelectorImports {
  const direct = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.importClause?.phaseModifier !== undefined
    ) {
      continue;
    }
    const importClause = statement.importClause;
    if (importClause?.name !== undefined && SELECTOR_HOOK_PATTERN.test(importClause.name.text)) {
      direct.add(importClause.name.text);
    }
    const namedBindings = importClause?.namedBindings;
    if (namedBindings === undefined) continue;
    if (ts.isNamespaceImport(namedBindings)) {
      namespaces.add(namedBindings.name.text);
      continue;
    }
    for (const element of namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (!element.isTypeOnly && SELECTOR_HOOK_PATTERN.test(importedName)) {
        direct.add(element.name.text);
      }
    }
  }
  return { direct, namespaces };
}

/**
 * Analyzes one source or function scope, then recursively analyzes nested functions with inherited
 * state aliases. Local declarations shadow inherited aliases before any expressions are inspected.
 */
function analyzeScope(
  scope: ts.SourceFile | ts.FunctionLikeDeclaration,
  inheritedBindings: ReadonlyMap<string, readonly string[]>,
  context: CollectionContext,
): void {
  context.scopeCount += 1;
  if (context.scopeCount > MAX_ANALYSIS_SCOPES || context.paths.size >= MAX_CONTAINER_PATHS) return;
  const localDeclarations = collectScopeVariableDeclarations(scope);
  const shadowedNames = collectScopeBindingNames(scope, localDeclarations);
  const bindings = new Map(inheritedBindings);
  for (const shadowedName of shadowedNames) bindings.delete(shadowedName);
  const selectorImports = filterShadowedSelectorImports(context.selectorImports, shadowedNames);

  inferConstBindings(localDeclarations, selectorImports, bindings, context);
  collectScopePropertyReads(scope, bindings, context);
  for (const nestedFunction of collectDirectNestedFunctions(scope)) {
    analyzeScope(nestedFunction, bindings, context);
  }
}

/** Collects variable declarations owned by a scope while excluding every nested function body. */
function collectScopeVariableDeclarations(
  scope: ts.SourceFile | ts.FunctionLikeDeclaration,
): readonly ts.VariableDeclaration[] {
  const declarations: ts.VariableDeclaration[] = [];
  visitScopeChildren(scope, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0 &&
      node.initializer !== undefined
    ) {
      declarations.push(node);
    }
  });
  return declarations.slice(0, MAX_BINDINGS_PER_SCOPE);
}

/** Collects parameters and local declarations that shadow inherited state or selector bindings. */
function collectScopeBindingNames(
  scope: ts.SourceFile | ts.FunctionLikeDeclaration,
  declarations: readonly ts.VariableDeclaration[],
): ReadonlySet<string> {
  const names = new Set<string>();
  if (!ts.isSourceFile(scope)) {
    for (const parameter of scope.parameters) collectBindingNames(parameter.name, names);
  }
  for (const declaration of declarations) collectBindingNames(declaration.name, names);
  visitScopeChildren(scope, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) names.add(node.name.text);
    if (ts.isClassDeclaration(node) && node.name !== undefined) names.add(node.name.text);
  });
  return names;
}

/** Recursively records identifiers declared by object or array binding patterns. */
function collectBindingNames(bindingName: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(bindingName)) {
    names.add(bindingName.text);
    return;
  }
  for (const element of bindingName.elements) {
    if (!ts.isOmittedExpression(element)) collectBindingNames(element.name, names);
  }
}

/** Removes project selector imports shadowed by a parameter or local declaration in this scope. */
function filterShadowedSelectorImports(
  imports: SelectorImports,
  shadowedNames: ReadonlySet<string>,
): SelectorImports {
  return {
    direct: new Set([...imports.direct].filter((name) => !shadowedNames.has(name))),
    namespaces: new Set([...imports.namespaces].filter((name) => !shadowedNames.has(name))),
  };
}

/** Resolves selector results and const aliases in bounded fixed-point passes. */
function inferConstBindings(
  declarations: readonly ts.VariableDeclaration[],
  selectorImports: SelectorImports,
  bindings: Map<string, readonly string[]>,
  context: CollectionContext,
): void {
  const unresolved = new Set(declarations);
  for (let pass = 0; pass < declarations.length && unresolved.size > 0; pass += 1) {
    let changed = false;
    for (const declaration of [...unresolved]) {
      const resolved = resolveDeclaration(declaration, selectorImports, bindings);
      if (resolved === undefined) continue;
      for (const containerPath of resolved.requiredContainers)
        addContainerPrefixes(containerPath, context);
      if (!bindDeclarationName(declaration.name, resolved.statePath, bindings, context)) continue;
      unresolved.delete(declaration);
      changed = true;
    }
    if (!changed) return;
  }
}

/** Resolves a declaration initializer as a selector call or an existing state-bound expression. */
function resolveDeclaration(
  declaration: ts.VariableDeclaration,
  selectorImports: SelectorImports,
  bindings: ReadonlyMap<string, readonly string[]>,
): BoundExpression | undefined {
  const initializer = declaration.initializer;
  if (initializer === undefined) return undefined;
  const unwrapped = unwrapExpression(initializer);
  if (ts.isCallExpression(unwrapped)) {
    const statePath = readSelectorPath(unwrapped, selectorImports);
    return statePath === undefined
      ? undefined
      : {
          requiredContainers: createContainerPrefixes(statePath.slice(0, -1)),
          statePath,
        };
  }
  return readBoundExpression(unwrapped, bindings);
}

/** Binds identifiers or object patterns and records destructuring container requirements. */
function bindDeclarationName(
  bindingName: ts.BindingName,
  statePath: readonly string[],
  bindings: Map<string, readonly string[]>,
  context: CollectionContext,
): boolean {
  if (ts.isIdentifier(bindingName)) {
    bindings.set(bindingName.text, statePath);
    return true;
  }
  if (!ts.isObjectBindingPattern(bindingName)) return false;
  addContainerPrefixes(statePath, context);
  for (const element of bindingName.elements) {
    if (
      element.dotDotDotToken !== undefined ||
      element.initializer !== undefined ||
      !ts.isIdentifier(element.name)
    ) {
      continue;
    }
    const propertyName =
      element.propertyName === undefined
        ? element.name.text
        : readPropertyName(element.propertyName);
    if (propertyName !== undefined && !BLOCKED_PROPERTY_NAMES.has(propertyName)) {
      bindings.set(element.name.text, [...statePath, propertyName]);
    }
  }
  return true;
}

/** Reads a direct selector callback path such as `state => state.company`. */
function readSelectorPath(
  call: ts.CallExpression,
  imports: SelectorImports,
): readonly string[] | undefined {
  if (!isSelectorCallee(call.expression, imports)) return undefined;
  const callbackArgument = call.arguments[0];
  if (callbackArgument === undefined) return undefined;
  const callback = unwrapExpression(callbackArgument);
  if (
    (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) ||
    callback.parameters.length !== 1 ||
    callback.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
  ) {
    return undefined;
  }
  const parameter = callback.parameters[0];
  if (parameter === undefined || !ts.isIdentifier(parameter.name)) return undefined;
  const returnedExpression = readCallbackReturnExpression(callback.body);
  if (returnedExpression === undefined) return undefined;
  const reference = readDirectPropertyReference(returnedExpression);
  return reference?.rootName === parameter.name.text ? reference.members : undefined;
}

/** Proves a direct selector import or namespace `.useSelector` call. */
function isSelectorCallee(expression: ts.Expression, imports: SelectorImports): boolean {
  const callee = unwrapExpression(expression);
  return ts.isIdentifier(callee)
    ? imports.direct.has(callee.text)
    : ts.isPropertyAccessExpression(callee) &&
        callee.questionDotToken === undefined &&
        ts.isIdentifier(callee.expression) &&
        imports.namespaces.has(callee.expression.text) &&
        callee.name.text === 'useSelector';
}

/** Reads an expression body or a block containing exactly one return statement. */
function readCallbackReturnExpression(body: ts.ConciseBody): ts.Expression | undefined {
  if (!ts.isBlock(body)) return body;
  const onlyStatement = body.statements[0];
  return body.statements.length === 1 &&
    onlyStatement !== undefined &&
    ts.isReturnStatement(onlyStatement)
    ? onlyStatement.expression
    : undefined;
}

/** Resolves an identifier or non-optional direct property chain rooted in a known state binding. */
function readBoundExpression(
  expression: ts.Expression,
  bindings: ReadonlyMap<string, readonly string[]>,
): BoundExpression | undefined {
  const reference = readDirectPropertyReference(expression);
  if (reference === undefined) return undefined;
  const selectedPath = bindings.get(reference.rootName);
  if (selectedPath === undefined) return undefined;
  const statePath = [...selectedPath, ...reference.members];
  return {
    requiredContainers: createContainerPrefixes(statePath.slice(0, -1)),
    statePath,
  };
}

/** A direct member access whose property name can potentially be proven without evaluation. */
type DirectMemberAccessExpression = ts.PropertyAccessExpression | ts.ElementAccessExpression;

/** Collects non-optional member reads rooted at state aliases while excluding method calls/writes. */
function collectScopePropertyReads(
  scope: ts.SourceFile | ts.FunctionLikeDeclaration,
  bindings: ReadonlyMap<string, readonly string[]>,
  context: CollectionContext,
): void {
  visitScopeChildren(scope, (node) => {
    if (
      !isDirectMemberAccessExpression(node) ||
      isNestedMemberAccess(node) ||
      isCalledMember(node) ||
      isMemberWrite(node)
    ) {
      return;
    }
    const resolved = readBoundExpression(node, bindings);
    if (resolved === undefined) return;
    for (const containerPath of resolved.requiredContainers)
      addContainerPath(containerPath, context);
  });
}

/** Narrows syntax nodes to dot access or bracket access before validating the member name. */
function isDirectMemberAccessExpression(node: ts.Node): node is DirectMemberAccessExpression {
  return ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
}

/**
 * Reads only identifier-rooted member chains with statically known, non-optional segments.
 *
 * Bracket access is safe only for authored string and numeric literals. Identifiers, template
 * expressions, binary expressions, and other computed keys are rejected because evaluating them
 * would require project runtime state and could point at an unrelated or prototype-bearing key.
 */
function readDirectPropertyReference(
  expression: ts.Expression,
): { readonly members: readonly string[]; readonly rootName: string } | undefined {
  let current = unwrapExpression(expression);
  const members: string[] = [];
  while (isDirectMemberAccessExpression(current)) {
    const member = readDirectMemberName(current);
    if (member === undefined) return undefined;
    members.unshift(member);
    current = unwrapExpression(current.expression);
  }
  return ts.isIdentifier(current) ? { members, rootName: current.text } : undefined;
}

/** Returns the canonical property key for one safe, non-optional direct member segment. */
function readDirectMemberName(access: DirectMemberAccessExpression): string | undefined {
  if (access.questionDotToken !== undefined) return undefined;
  const member = ts.isPropertyAccessExpression(access)
    ? access.name.text
    : readLiteralElementAccessName(access.argumentExpression);
  return member !== undefined && isSafePropertyName(member) ? member : undefined;
}

/** Reads an element-access key only when its runtime property name is a literal constant. */
function readLiteralElementAccessName(argument: ts.Expression | undefined): string | undefined {
  if (argument === undefined) return undefined;
  const unwrapped = unwrapExpression(argument);
  return ts.isStringLiteral(unwrapped) || ts.isNumericLiteral(unwrapped)
    ? unwrapped.text
    : undefined;
}

/** Applies the shared bounds and prototype-pollution guard to every direct member segment. */
function isSafePropertyName(member: string): boolean {
  return (
    member.length > 0 &&
    member.length <= MAX_PROPERTY_NAME_LENGTH &&
    !BLOCKED_PROPERTY_NAMES.has(member)
  );
}

/** Returns every non-empty prefix of one already-proven container path. */
function createContainerPrefixes(containerPath: readonly string[]): readonly (readonly string[])[] {
  const prefixes: (readonly string[])[] = [];
  for (let length = 1; length <= containerPath.length && length <= MAX_PATH_DEPTH; length += 1) {
    prefixes.push(containerPath.slice(0, length));
  }
  return prefixes;
}

/** Adds every parent prefix required to reach one direct container. */
function addContainerPrefixes(containerPath: readonly string[], context: CollectionContext): void {
  for (const prefix of createContainerPrefixes(containerPath)) addContainerPath(prefix, context);
}

/** Adds one bounded, safe, canonical container path. */
function addContainerPath(containerPath: readonly string[], context: CollectionContext): void {
  if (
    containerPath.length === 0 ||
    containerPath.length > MAX_PATH_DEPTH ||
    context.paths.size >= MAX_CONTAINER_PATHS ||
    containerPath.some(
      (segment) =>
        segment.length === 0 ||
        segment.length > MAX_PROPERTY_NAME_LENGTH ||
        BLOCKED_PROPERTY_NAMES.has(segment),
    )
  ) {
    return;
  }
  const key = containerPath.join('\0');
  if (!context.paths.has(key)) context.paths.set(key, [...containerPath]);
}

/** Reads one identifier, string, numeric, or computed literal property name. */
function readPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) {
    const expression = unwrapExpression(name.expression);
    if (ts.isStringLiteral(expression) || ts.isNumericLiteral(expression)) return expression.text;
  }
  return undefined;
}

/** Keeps only the outermost direct member chain so nested prefixes are not analyzed as leaves. */
function isNestedMemberAccess(access: DirectMemberAccessExpression): boolean {
  return isDirectMemberAccessExpression(access.parent) && access.parent.expression === access;
}

/** Rejects a member chain used as a function or constructor target. */
function isCalledMember(access: DirectMemberAccessExpression): boolean {
  return (
    (ts.isCallExpression(access.parent) && access.parent.expression === access) ||
    (ts.isNewExpression(access.parent) && access.parent.expression === access)
  );
}

/** Rejects assignment, increment, decrement, and delete targets as read evidence. */
function isMemberWrite(access: DirectMemberAccessExpression): boolean {
  const parent = access.parent;
  if (ts.isBinaryExpression(parent) && parent.left === access) {
    return (
      parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    );
  }
  return (
    ts.isPostfixUnaryExpression(parent) ||
    (ts.isPrefixUnaryExpression(parent) &&
      (parent.operator === ts.SyntaxKind.PlusPlusToken ||
        parent.operator === ts.SyntaxKind.MinusMinusToken)) ||
    (ts.isDeleteExpression(parent) && parent.expression === access)
  );
}

/** Recursively visits one scope while treating nested functions as separate analysis boundaries. */
function visitScopeChildren(
  scope: ts.SourceFile | ts.FunctionLikeDeclaration,
  visitor: (node: ts.Node) => void,
): void {
  /** Visits children but stops before a nested function's parameters or body. */
  const visit = (node: ts.Node): void => {
    if (node !== scope && isAnalyzableFunction(node)) return;
    visitor(node);
    ts.forEachChild(node, visit);
  };
  if (ts.isSourceFile(scope)) {
    ts.forEachChild(scope, visit);
  } else {
    for (const parameter of scope.parameters) visit(parameter);
    if (scope.body !== undefined) visit(scope.body);
  }
}

/** Collects direct nested functions so inherited state aliases can be analyzed lexically. */
function collectDirectNestedFunctions(
  scope: ts.SourceFile | ts.FunctionLikeDeclaration,
): readonly ts.FunctionLikeDeclaration[] {
  const functions: ts.FunctionLikeDeclaration[] = [];
  /** Captures the first nested function and does not enter its body. */
  const visit = (node: ts.Node): void => {
    if (node !== scope && isAnalyzableFunction(node)) {
      functions.push(node);
      return;
    }
    ts.forEachChild(node, visit);
  };
  if (ts.isSourceFile(scope)) {
    ts.forEachChild(scope, visit);
  } else if (scope.body !== undefined) {
    ts.forEachChild(scope.body, visit);
  }
  return functions;
}

/** Narrows AST function nodes to declarations that own an executable body or parameter scope. */
function isAnalyzableFunction(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isArrowFunction(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

/** Removes syntax-only TypeScript wrappers without admitting calls, element access, or operators. */
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

/** Sorts parent containers before children and uses lexical order for unrelated paths. */
function compareContainerPaths(left: readonly string[], right: readonly string[]): number {
  const depthOrder = left.length - right.length;
  return depthOrder === 0 ? left.join('.').localeCompare(right.join('.')) : depthOrder;
}
