/**
 * Summarizes bounded local helper calls that require object-compatible parameters.
 *
 * The Context-hook fallback analyzer uses this module to follow a derived leaf through a direct
 * local function call such as `getKeys(errors)`, where `getKeys` calls `Object.keys(errors)`.
 * Analysis is syntax-only, prototype-safe, bounded, and never evaluates the helper body.
 */
import ts from 'typescript';

const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_FUNCTIONS = 128;
const MAX_PATHS_PER_FUNCTION = 128;
const MAX_PATH_DEPTH = 16;
const MAX_PROPERTY_NAME_LENGTH = 128;
const OBJECT_INSPECTION_METHODS = new Set(['entries', 'keys', 'values']);

/** Immutable object-path evidence grouped by a local helper's zero-based parameter index. */
export interface LocalFunctionSummary {
  /** Object paths required below each parameter before the helper can execute safely. */
  readonly objectPathsByParameter: ReadonlyMap<number, readonly (readonly string[])[]>;
}

/** Runtime functions supported by the bounded local summary pass. */
type RuntimeFunction = ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression;

/** Mutable fixed-point state retained only while summaries are being computed. */
interface MutableFunctionSummary {
  /** Unique paths keyed by parameter index and null-separated path identity. */
  readonly objectPathsByParameter: Map<number, Map<string, readonly string[]>>;
}

/**
 * Summarizes `Object.keys/values/entries(parameter)` and direct local-helper forwarding.
 * Recursive helpers converge through a bounded fixed point; ambiguous duplicate function names
 * are excluded so a call can never be attributed to the wrong declaration.
 *
 * @param sourceFile Parsed project module whose local helper declarations are inspected.
 * @returns Immutable summaries keyed by unambiguous local function identifier.
 */
export function collectLocalFunctionSummaries(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, LocalFunctionSummary> {
  if (isGlobalObjectShadowed(sourceFile)) return new Map();
  const functions = collectNamedLocalFunctions(sourceFile);
  const mutable = new Map<string, MutableFunctionSummary>();
  for (const name of functions.keys()) mutable.set(name, { objectPathsByParameter: new Map() });

  for (let pass = 0; pass < functions.size + 1; pass += 1) {
    let changed = false;
    for (const [name, functionLike] of functions) {
      const summary = mutable.get(name);
      if (summary === undefined) continue;
      changed ||= collectDirectObjectEvidence(functionLike, summary, mutable);
    }
    if (!changed) break;
  }

  const summaries = new Map<string, LocalFunctionSummary>();
  for (const [name, summary] of mutable) {
    const pathsByParameter = new Map<number, readonly (readonly string[])[]>();
    for (const [parameterIndex, paths] of summary.objectPathsByParameter) {
      pathsByParameter.set(parameterIndex, Object.freeze([...paths.values()]));
    }
    summaries.set(name, { objectPathsByParameter: pathsByParameter });
  }
  return summaries;
}

/** Recognizes an unshadowed `Object.keys`, `Object.values`, or `Object.entries` call. */
export function isObjectInspectionCall(call: ts.CallExpression): boolean {
  const callee = unwrapExpression(call.expression);
  return (
    call.questionDotToken === undefined &&
    call.arguments.length >= 1 &&
    ts.isPropertyAccessExpression(callee) &&
    callee.questionDotToken === undefined &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'Object' &&
    OBJECT_INSPECTION_METHODS.has(callee.name.text)
  );
}

/** Resolves a direct unambiguous local helper call to its immutable object-demand summary. */
export function readLocalFunctionSummary(
  expression: ts.Expression,
  summaries: ReadonlyMap<string, LocalFunctionSummary>,
): LocalFunctionSummary | undefined {
  const callee = unwrapExpression(expression);
  return ts.isIdentifier(callee) ? summaries.get(callee.text) : undefined;
}

/** Conservatively disables global Object evidence when any authored binding shadows `Object`. */
export function isGlobalObjectShadowed(sourceFile: ts.SourceFile): boolean {
  let shadowed = false;
  const visit = (node: ts.Node): void => {
    if (shadowed) return;
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
      bindingContainsName(node.name, 'Object')
    ) {
      shadowed = true;
      return;
    }
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name?.text === 'Object'
    ) {
      shadowed = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return shadowed;
}

/** Collects unique named runtime functions without crossing the configured module-wide bound. */
function collectNamedLocalFunctions(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, RuntimeFunction> {
  const functions = new Map<string, RuntimeFunction>();
  const ambiguous = new Set<string>();
  const add = (name: string, functionLike: RuntimeFunction): void => {
    if (functions.has(name)) {
      functions.delete(name);
      ambiguous.add(name);
    } else if (!ambiguous.has(name) && functions.size < MAX_FUNCTIONS) {
      functions.set(name, functionLike);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      add(node.name.text, node);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const initializer = unwrapExpression(node.initializer);
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
        add(node.name.text, initializer);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return functions;
}

/** Collects direct global-Object evidence and forwards already known helper summaries. */
function collectDirectObjectEvidence(
  functionLike: RuntimeFunction,
  destination: MutableFunctionSummary,
  summaries: ReadonlyMap<string, MutableFunctionSummary>,
): boolean {
  const parameterIndexes = new Map<string, number>();
  for (const [index, parameter] of functionLike.parameters.entries()) {
    if (ts.isIdentifier(parameter.name)) parameterIndexes.set(parameter.name.text, index);
  }
  let changed = false;
  visitDirectScopeNodes(functionLike, (node) => {
    if (!ts.isCallExpression(node)) return;
    if (isObjectInspectionCall(node)) {
      const argument = node.arguments[0];
      const parameterPath =
        argument === undefined ? undefined : readParameterPath(argument, parameterIndexes);
      if (parameterPath !== undefined) {
        changed ||= addSummaryPath(destination, parameterPath.index, parameterPath.path);
      }
      return;
    }
    const calleeSummary = readMutableSummary(node.expression, summaries);
    if (calleeSummary === undefined) return;
    for (const [calleeParameterIndex, paths] of calleeSummary.objectPathsByParameter) {
      const argument = node.arguments[calleeParameterIndex];
      const parameterPath =
        argument === undefined ? undefined : readParameterPath(argument, parameterIndexes);
      if (parameterPath === undefined) continue;
      for (const relativePath of paths.values()) {
        changed ||= addSummaryPath(destination, parameterPath.index, [
          ...parameterPath.path,
          ...relativePath,
        ]);
      }
    }
  });
  return changed;
}

/** Resolves a direct parameter or non-optional property path rooted at that parameter. */
function readParameterPath(
  expression: ts.Expression,
  parameterIndexes: ReadonlyMap<string, number>,
): { readonly index: number; readonly path: readonly string[] } | undefined {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) {
    const index = parameterIndexes.get(unwrapped.text);
    return index === undefined ? undefined : { index, path: [] };
  }
  if (
    ts.isPropertyAccessExpression(unwrapped) &&
    unwrapped.questionDotToken === undefined &&
    isSafePropertyName(unwrapped.name.text)
  ) {
    const owner = readParameterPath(unwrapped.expression, parameterIndexes);
    if (owner === undefined || owner.path.length >= MAX_PATH_DEPTH) return undefined;
    return { index: owner.index, path: [...owner.path, unwrapped.name.text] };
  }
  return undefined;
}

/** Adds one prototype-safe path while enforcing the per-helper summary budget. */
function addSummaryPath(
  summary: MutableFunctionSummary,
  parameterIndex: number,
  path_: readonly string[],
): boolean {
  if (!isSafePath(path_)) return false;
  let paths = summary.objectPathsByParameter.get(parameterIndex);
  if (paths === undefined) {
    paths = new Map();
    summary.objectPathsByParameter.set(parameterIndex, paths);
  }
  const identity = path_.join('\0');
  if (paths.has(identity)) return false;
  const pathCount = [...summary.objectPathsByParameter.values()].reduce(
    (total, parameterPaths) => total + parameterPaths.size,
    0,
  );
  if (pathCount >= MAX_PATHS_PER_FUNCTION) return false;
  paths.set(identity, Object.freeze([...path_]));
  return true;
}

/** Resolves a direct local helper while summary fixed-point inference remains mutable. */
function readMutableSummary(
  expression: ts.Expression,
  summaries: ReadonlyMap<string, MutableFunctionSummary>,
): MutableFunctionSummary | undefined {
  const callee = unwrapExpression(expression);
  return ts.isIdentifier(callee) ? summaries.get(callee.text) : undefined;
}

/** Visits nodes owned by one helper and excludes nested functions from its parameter summary. */
function visitDirectScopeNodes(scope: RuntimeFunction, visitor: (node: ts.Node) => void): void {
  const visit = (node: ts.Node): void => {
    if (node !== scope && isRuntimeFunction(node)) return;
    if (node !== scope) visitor(node);
    ts.forEachChild(node, visit);
  };
  visit(scope);
}

/** Narrows a node to one supported runtime function body. */
function isRuntimeFunction(node: ts.Node): node is RuntimeFunction {
  return (
    ts.isArrowFunction(node) || ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
  );
}

/** Recursively checks whether a binding pattern contains one exact identifier. */
function bindingContainsName(name: ts.BindingName, expectedName: string): boolean {
  if (ts.isIdentifier(name)) return name.text === expectedName;
  return name.elements.some(
    (element) =>
      !ts.isOmittedExpression(element) && bindingContainsName(element.name, expectedName),
  );
}

/** Validates bounded path segments and blocks prototype-pollution sensitive keys. */
function isSafePath(path_: readonly string[]): boolean {
  return path_.length <= MAX_PATH_DEPTH && path_.every(isSafePropertyName);
}

/** Narrows a property name to the helper summary's bounded key contract. */
function isSafePropertyName(propertyName: string | undefined): propertyName is string {
  return (
    propertyName !== undefined &&
    propertyName.length > 0 &&
    propertyName.length <= MAX_PROPERTY_NAME_LENGTH &&
    !BLOCKED_PROPERTY_NAMES.has(propertyName)
  );
}

/** Removes syntax-only wrappers without evaluating application expressions. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
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
