/**
 * Infers Redux object containers required by imported Reselect selectors.
 *
 * Application components commonly call `useSelector(selectValue)` while the actual state access
 * lives in another module. That selector module is still part of the reachable preview graph, so
 * this syntax-only pass recognizes locally declared `createSelector` input selectors and records
 * only paths whose projector immediately dereferences or destructures the selected value. It never
 * executes project code and never guesses a scalar leaf value.
 */
import path from 'node:path';
import ts from 'typescript';

const MAX_RESELECT_CALLS = 128;
const MAX_SELECTOR_BINDINGS = 256;
const MAX_PATH_DEPTH = 16;
const MAX_PROPERTY_NAME_LENGTH = 128;
const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

type SelectorFunction = ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression;

/** One resolved input selector and the Redux path returned to its projector. */
interface ResolvedInputSelector {
  readonly path: readonly string[];
}

/**
 * Returns state paths that must be object containers for reachable Reselect projectors to execute.
 *
 * For `createSelector(s => s.application.fontScale, value => value.fontScale)`, both
 * `application` and `application.fontScale` are returned. If the projector only compares `value`
 * as a scalar, the full input path is deliberately omitted because its object shape is unproven.
 *
 * @param sourcePath Source identity used only to select TypeScript parser grammar.
 * @param sourceText Reachable authored module source.
 * @returns Deterministic, immutable Redux container paths.
 */
export function collectPreviewReselectStateContainerPaths(
  sourcePath: string,
  sourceText: string,
): readonly (readonly string[])[] {
  if (!sourceText.includes('createSelector')) return Object.freeze([]);
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    selectScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) return Object.freeze([]);
  const createSelectorImports = collectCreateSelectorImports(sourceFile);
  if (createSelectorImports.size === 0) return Object.freeze([]);
  const selectorBindings = collectSelectorFunctionBindings(sourceFile);
  const collected = new Map<string, readonly string[]>();
  let callCount = 0;

  /** Visits bounded call sites while leaving project functions completely unevaluated. */
  const visit = (node: ts.Node): void => {
    if (callCount >= MAX_RESELECT_CALLS) return;
    if (ts.isCallExpression(node) && isCreateSelectorCall(node, createSelectorImports)) {
      callCount += 1;
      collectCreateSelectorCallPaths(node, selectorBindings, collected);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  const paths = [...collected.values()].sort(compareContainerPaths);
  return Object.freeze(paths.map((containerPath) => Object.freeze([...containerPath])));
}

/** Selects parser grammar from the authored extension without consulting project configuration. */
function selectScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/** Reads parser recovery diagnostics without depending on an unstable public helper. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return (diagnostics?.length ?? 0) > 0;
}

/** Collects local aliases for a statically imported named `createSelector` binding. */
function collectCreateSelectorImports(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (!element.isTypeOnly && importedName === 'createSelector') names.add(element.name.text);
    }
  }
  return names;
}

/**
 * Indexes uniquely named selector functions. Ambiguous duplicate names are removed so resolution
 * cannot accidentally cross lexical scopes or bind a call to a different declaration.
 */
function collectSelectorFunctionBindings(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, SelectorFunction> {
  const bindings = new Map<string, SelectorFunction>();
  const ambiguous = new Set<string>();
  let bindingCount = 0;
  /** Records one callable binding under the global analysis bound. */
  const record = (name: string, value: SelectorFunction): void => {
    if (bindingCount >= MAX_SELECTOR_BINDINGS || ambiguous.has(name)) return;
    bindingCount += 1;
    if (bindings.has(name)) {
      bindings.delete(name);
      ambiguous.add(name);
      return;
    }
    bindings.set(name, value);
  };
  /** Traverses declarations without interpreting their bodies. */
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined && node.body !== undefined) {
      record(node.name.text, node);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const initializer = unwrapExpression(node.initializer);
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
        record(node.name.text, initializer);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return bindings;
}

/** Proves an unshadowed direct call to the imported Reselect factory. */
function isCreateSelectorCall(call: ts.CallExpression, imports: ReadonlySet<string>): boolean {
  const callee = unwrapExpression(call.expression);
  return (
    ts.isIdentifier(callee) &&
    imports.has(callee.text) &&
    !isShadowedByAncestorParameter(call, callee.text)
  );
}

/** Rejects a nested function parameter that shadows the module's imported factory binding. */
function isShadowedByAncestorParameter(node: ts.Node, name: string): boolean {
  let current: ts.Node = node.parent;
  while (!ts.isSourceFile(current)) {
    if (ts.isFunctionLike(current)) {
      for (const parameter of current.parameters) {
        if (bindingContainsName(parameter.name, name)) return true;
      }
    }
    current = current.parent;
  }
  return false;
}

/** Checks identifier, object, and array parameter bindings without executing default expressions. */
function bindingContainsName(binding: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(binding)) return binding.text === name;
  return binding.elements.some(
    (element) => !ts.isOmittedExpression(element) && bindingContainsName(element.name, name),
  );
}

/** Maps object-requiring projector parameters back to their corresponding input selectors. */
function collectCreateSelectorCallPaths(
  call: ts.CallExpression,
  bindings: ReadonlyMap<string, SelectorFunction>,
  collected: Map<string, readonly string[]>,
): void {
  if (call.arguments.length < 2) return;
  const projector = resolveSelectorFunction(call.arguments[call.arguments.length - 1], bindings);
  if (projector === undefined) return;
  const inputs = expandInputSelectorArguments(call.arguments.slice(0, -1));
  for (let index = 0; index < inputs.length && index < projector.parameters.length; index += 1) {
    const parameter = projector.parameters[index];
    const input = inputs[index];
    if (
      parameter === undefined ||
      input === undefined ||
      !projectorParameterRequiresObject(projector, parameter)
    ) {
      continue;
    }
    const resolved = resolveInputSelector(input, bindings);
    if (resolved === undefined) continue;
    addContainerPrefixes(resolved.path, collected);
  }
}

/** Supports both variadic inputs and the common `createSelector([inputs], projector)` spelling. */
function expandInputSelectorArguments(
  arguments_: readonly ts.Expression[],
): readonly ts.Expression[] {
  if (arguments_.length !== 1) return arguments_;
  const onlyArgument = arguments_[0];
  if (onlyArgument === undefined) return [];
  const unwrapped = unwrapExpression(onlyArgument);
  return ts.isArrayLiteralExpression(unwrapped)
    ? unwrapped.elements.filter(ts.isExpression)
    : arguments_;
}

/** Resolves an inline selector function or a unique local function identifier. */
function resolveSelectorFunction(
  expression: ts.Expression | undefined,
  bindings: ReadonlyMap<string, SelectorFunction>,
): SelectorFunction | undefined {
  if (expression === undefined) return undefined;
  const unwrapped = unwrapExpression(expression);
  if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) return unwrapped;
  return ts.isIdentifier(unwrapped) ? bindings.get(unwrapped.text) : undefined;
}

/**
 * Proves that the projector consumes a parameter as an object. Object destructuring is immediate
 * proof; an identifier must participate in a non-optional direct property access in that projector.
 */
function projectorParameterRequiresObject(
  projector: SelectorFunction,
  parameter: ts.ParameterDeclaration,
): boolean {
  if (ts.isObjectBindingPattern(parameter.name)) return true;
  if (!ts.isIdentifier(parameter.name) || projector.body === undefined) return false;
  const parameterName = parameter.name.text;
  let requiresObject = false;
  /** Avoids nested functions, where the access may occur after projector evaluation. */
  const visit = (node: ts.Node): void => {
    if (requiresObject || (node !== projector.body && ts.isFunctionLike(node))) return;
    if (ts.isPropertyAccessExpression(node) && node.questionDotToken === undefined) {
      const reference = readDirectPropertyReference(node);
      if (reference?.rootName === parameterName && reference.members.length > 0) {
        requiresObject = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(projector.body);
  return requiresObject;
}

/** Resolves one input selector's direct root-state return path. */
function resolveInputSelector(
  expression: ts.Expression,
  bindings: ReadonlyMap<string, SelectorFunction>,
): ResolvedInputSelector | undefined {
  const selector = resolveSelectorFunction(expression, bindings);
  if (selector?.body === undefined || selector.parameters.length !== 1) {
    return undefined;
  }
  const rootParameter = selector.parameters[0];
  if (rootParameter === undefined || !ts.isIdentifier(rootParameter.name)) return undefined;
  const returnedExpression = readFunctionReturnExpression(selector.body);
  if (returnedExpression === undefined) return undefined;
  const reference = readDirectPropertyReference(returnedExpression);
  if (
    reference?.rootName !== rootParameter.name.text ||
    reference.members.length === 0 ||
    reference.members.length > MAX_PATH_DEPTH
  ) {
    return undefined;
  }
  return { path: reference.members };
}

/** Reads a concise body or a block containing exactly one return statement. */
function readFunctionReturnExpression(body: ts.ConciseBody): ts.Expression | undefined {
  if (!ts.isBlock(body)) return body;
  const statement = body.statements[0];
  return body.statements.length === 1 && statement !== undefined && ts.isReturnStatement(statement)
    ? statement.expression
    : undefined;
}

/** Reads a non-optional identifier-rooted property chain. */
function readDirectPropertyReference(
  expression: ts.Expression,
): { readonly members: readonly string[]; readonly rootName: string } | undefined {
  let current = unwrapExpression(expression);
  const members: string[] = [];
  while (ts.isPropertyAccessExpression(current)) {
    if (current.questionDotToken !== undefined) return undefined;
    const member = current.name.text;
    if (
      member.length === 0 ||
      member.length > MAX_PROPERTY_NAME_LENGTH ||
      BLOCKED_PROPERTY_NAMES.has(member)
    ) {
      return undefined;
    }
    members.unshift(member);
    current = unwrapExpression(current.expression);
  }
  return ts.isIdentifier(current) ? { members, rootName: current.text } : undefined;
}

/** Adds every safe parent path, including the selector's object-valued result itself. */
function addContainerPrefixes(
  pathSegments: readonly string[],
  collected: Map<string, readonly string[]>,
): void {
  for (let length = 1; length <= pathSegments.length && length <= MAX_PATH_DEPTH; length += 1) {
    const prefix = pathSegments.slice(0, length);
    const key = prefix.join('\0');
    if (!collected.has(key)) collected.set(key, prefix);
  }
}

/** Removes syntax-only TypeScript wrappers from an expression. */
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

/** Sorts parent paths before children and unrelated paths lexically. */
function compareContainerPaths(left: readonly string[], right: readonly string[]): number {
  const depthOrder = left.length - right.length;
  return depthOrder === 0 ? left.join('.').localeCompare(right.join('.')) : depthOrder;
}
