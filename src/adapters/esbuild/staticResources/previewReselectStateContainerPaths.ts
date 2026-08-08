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
import {
  inferReactFunctionParameterUsageShape,
  type PreviewInferredPropShape,
} from './reactExportPropInference';
import { collectPreviewReduxToolkitInitialStateShapes } from './previewReduxToolkitInitialState';

const MAX_RESELECT_CALLS = 128;
const MAX_SELECTOR_BINDINGS = 256;
const MAX_PATH_DEPTH = 16;
const MAX_PROPERTY_NAME_LENGTH = 128;
const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

type SelectorFunction = ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression;

/** A direct member access whose property key can be validated without executing project code. */
type DirectMemberAccessExpression = ts.PropertyAccessExpression | ts.ElementAccessExpression;

/** One resolved input selector and the Redux path returned to its projector. */
interface ResolvedInputSelector {
  readonly path: readonly string[];
}

/** Syntax-proven neutral value required at one exact Redux selector input path. */
export interface PreviewReselectStateValueRequirement {
  readonly path: readonly string[];
  readonly shape: PreviewInferredPropShape;
}

/** One parse result shared by host prebuild state and reached-module container registration. */
export interface PreviewReselectStateRequirements {
  readonly containerPaths: readonly (readonly string[])[];
  readonly valueRequirements: readonly PreviewReselectStateValueRequirement[];
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
  return collectPreviewReselectStateRequirements(sourcePath, sourceText).containerPaths;
}

/**
 * Returns both required object containers and projector-proven neutral input shapes.
 *
 * This richer form is consumed before React Redux starts rendering. Catching a projector failure
 * around `useSelector` is too late because React Redux may already have consumed a different number
 * of hooks. Empty collections and falsey scalar leaves therefore have to exist in the static store
 * before the first selector call.
 */
export function collectPreviewReselectStateRequirements(
  sourcePath: string,
  sourceText: string,
): PreviewReselectStateRequirements {
  if (!sourceText.includes('createSelector')) return EMPTY_RESELECT_REQUIREMENTS;
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    selectScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) return EMPTY_RESELECT_REQUIREMENTS;
  const createSelectorImports = collectCreateSelectorImports(sourceFile);
  if (createSelectorImports.size === 0) return EMPTY_RESELECT_REQUIREMENTS;
  const selectorBindings = collectSelectorFunctionBindings(sourceFile);
  const collected = new Map<string, readonly string[]>();
  const values = new Map<string, PreviewReselectStateValueRequirement>();
  let callCount = 0;

  /** Visits bounded call sites while leaving project functions completely unevaluated. */
  const visit = (node: ts.Node): void => {
    if (callCount >= MAX_RESELECT_CALLS) return;
    if (ts.isCallExpression(node) && isCreateSelectorCall(node, createSelectorImports)) {
      callCount += 1;
      collectCreateSelectorCallPaths(node, selectorBindings, collected, values);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  mergeReduxToolkitInitialStateRequirements(
    values,
    collectPreviewReduxToolkitInitialStateShapes(sourceFile),
  );

  for (const requirement of values.values()) {
    if (requirement.shape.kind !== 'object') collected.delete(requirement.path.join('\0'));
  }
  const containerPaths = [...collected.values()].sort(compareContainerPaths);
  const valueRequirements = [...values.values()]
    .sort((left, right) => compareContainerPaths(left.path, right.path))
    .map((requirement) =>
      Object.freeze({
        path: Object.freeze([...requirement.path]),
        shape: requirement.shape,
      }),
    );
  return Object.freeze({
    containerPaths: Object.freeze(
      containerPaths.map((containerPath) => Object.freeze([...containerPath])),
    ),
    valueRequirements: Object.freeze(valueRequirements),
  });
}

const EMPTY_RESELECT_REQUIREMENTS: PreviewReselectStateRequirements = Object.freeze({
  containerPaths: Object.freeze([]),
  valueRequirements: Object.freeze([]),
});

/** Refines demanded slice fields with exact JSON literals proven by the local `createSlice`. */
function mergeReduxToolkitInitialStateRequirements(
  values: Map<string, PreviewReselectStateValueRequirement>,
  initialStateShapes: ReadonlyMap<string, PreviewInferredPropShape>,
): void {
  for (const [key, requirement] of values) {
    const sliceName = requirement.path.at(-1);
    const initialState = sliceName === undefined ? undefined : initialStateShapes.get(sliceName);
    if (initialState === undefined) continue;
    values.set(key, {
      path: requirement.path,
      shape: mergeReselectValueShapes(requirement.shape, initialState),
    });
  }
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

/** Maps object-requiring projector paths back to their corresponding input selectors. */
function collectCreateSelectorCallPaths(
  call: ts.CallExpression,
  bindings: ReadonlyMap<string, SelectorFunction>,
  collected: Map<string, readonly string[]>,
  values: Map<string, PreviewReselectStateValueRequirement>,
): void {
  if (call.arguments.length < 2) return;
  const projector = resolveSelectorFunction(call.arguments[call.arguments.length - 1], bindings);
  if (projector === undefined) return;
  const inputs = expandInputSelectorArguments(call.arguments.slice(0, -1));
  for (let index = 0; index < inputs.length && index < projector.parameters.length; index += 1) {
    const parameter = projector.parameters[index];
    const input = inputs[index];
    if (parameter === undefined || input === undefined) {
      continue;
    }
    const resolved = resolveInputSelector(input, bindings);
    if (resolved === undefined) continue;
    const inferredShape = inferReactFunctionParameterUsageShape(projector, index);
    if (inferredShape !== undefined) {
      addReselectValueRequirement(resolved.path, inferredShape, values);
      addParentContainerPrefixes(resolved.path, collected);
    }
    const requiredRelativePaths = collectProjectorParameterObjectPaths(projector, parameter);
    for (const relativePath of requiredRelativePaths) {
      addContainerPrefixes([...resolved.path, ...relativePath], collected);
    }
  }
}

/** Merges compatible projector evidence while retaining a bounded, JSON-only shape. */
function addReselectValueRequirement(
  pathSegments: readonly string[],
  shape: PreviewInferredPropShape,
  values: Map<string, PreviewReselectStateValueRequirement>,
): void {
  if (
    pathSegments.length === 0 ||
    pathSegments.length > MAX_PATH_DEPTH ||
    pathSegments.some((part) => !isSafePropertyName(part))
  ) {
    return;
  }
  const key = pathSegments.join('\0');
  const existing = values.get(key);
  values.set(key, {
    path: pathSegments,
    shape: mergeReselectValueShapes(existing?.shape, shape),
  });
}

/** Recursively combines independent reads of the same selected input without widening its kind. */
function mergeReselectValueShapes(
  primary: PreviewInferredPropShape | undefined,
  secondary: PreviewInferredPropShape,
): PreviewInferredPropShape {
  if (primary === undefined) return secondary;
  if (primary.kind !== secondary.kind) {
    if (primary.kind === 'object' && Object.keys(primary.properties ?? {}).length === 0) {
      return secondary;
    }
    return primary;
  }
  if (primary.kind === 'array') {
    return Object.freeze({
      kind: 'array',
      ...(primary.items === undefined && secondary.items === undefined
        ? {}
        : { items: mergeReselectValueShapes(primary.items, secondary.items ?? primary.items!) }),
    });
  }
  if (primary.kind !== 'object') {
    if (primary.exactValue === true) return primary;
    if (secondary.exactValue === true) return secondary;
    return primary.value === undefined ? secondary : primary;
  }
  const properties: Record<string, PreviewInferredPropShape> = { ...(primary.properties ?? {}) };
  for (const [name, child] of Object.entries(secondary.properties ?? {})) {
    properties[name] = mergeReselectValueShapes(properties[name], child);
  }
  return Object.freeze({ kind: 'object', properties: Object.freeze(properties) });
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
function collectProjectorParameterObjectPaths(
  projector: SelectorFunction,
  parameter: ts.ParameterDeclaration,
): readonly (readonly string[])[] {
  const required = new Map<string, readonly string[]>();
  const add = (pathSegments: readonly string[]): void => {
    if (
      pathSegments.length > MAX_PATH_DEPTH ||
      pathSegments.some((part) => !isSafePropertyName(part))
    ) {
      return;
    }
    const key = pathSegments.join('\0');
    if (!required.has(key)) required.set(key, pathSegments);
  };
  if (ts.isObjectBindingPattern(parameter.name)) {
    add([]);
    collectNestedObjectBindingPaths(parameter.name, [], add);
    return [...required.values()];
  }
  if (!ts.isIdentifier(parameter.name) || projector.body === undefined) return [];
  const parameterName = parameter.name.text;
  /** Avoids nested functions, where the access may occur after projector evaluation. */
  const visit = (node: ts.Node): void => {
    if (node !== projector.body && ts.isFunctionLike(node)) return;
    if (isDirectMemberAccessExpression(node)) {
      const reference = readDirectPropertyReference(node);
      if (reference?.rootName === parameterName && reference.members.length > 0) {
        add([]);
        for (let length = 1; length < reference.members.length; length += 1) {
          add(reference.members.slice(0, length));
        }
        if (isObjectBindingInitializer(node)) add(reference.members);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(projector.body);
  return [...required.values()];
}

/** Records nested object-binding containers beneath a projector's selected input value. */
function collectNestedObjectBindingPaths(
  binding: ts.ObjectBindingPattern,
  parentPath: readonly string[],
  add: (pathSegments: readonly string[]) => void,
): void {
  for (const element of binding.elements) {
    if (!ts.isObjectBindingPattern(element.name)) continue;
    const property = element.propertyName;
    const propertyName =
      property !== undefined &&
      (ts.isIdentifier(property) ||
        ts.isStringLiteralLike(property) ||
        ts.isNumericLiteral(property))
        ? property.text
        : undefined;
    if (propertyName === undefined || !isSafePropertyName(propertyName)) continue;
    const pathSegments = [...parentPath, propertyName];
    add(pathSegments);
    collectNestedObjectBindingPaths(element.name, pathSegments, add);
  }
}

/** Proves that a direct member value is synchronously object-destructured by the projector. */
function isObjectBindingInitializer(expression: ts.Expression): boolean {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current.parent) ||
    ts.isAsExpression(current.parent) ||
    ts.isTypeAssertionExpression(current.parent) ||
    ts.isSatisfiesExpression(current.parent) ||
    ts.isNonNullExpression(current.parent)
  ) {
    current = current.parent;
  }
  return (
    ts.isVariableDeclaration(current.parent) &&
    current.parent.initializer === current &&
    ts.isObjectBindingPattern(current.parent.name)
  );
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

/** Narrows syntax nodes to dot access or bracket access before validating the member name. */
function isDirectMemberAccessExpression(node: ts.Node): node is DirectMemberAccessExpression {
  return ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
}

/**
 * Reads a non-optional identifier-rooted member chain.
 *
 * Literal string and numeric bracket keys are deterministic JavaScript property names. Every
 * other computed expression is rejected because resolving it would require executing project code.
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

/** Reads only string and numeric literals from an element-access argument. */
function readLiteralElementAccessName(argument: ts.Expression | undefined): string | undefined {
  if (argument === undefined) return undefined;
  const unwrapped = unwrapExpression(argument);
  return ts.isStringLiteral(unwrapped) || ts.isNumericLiteral(unwrapped)
    ? unwrapped.text
    : undefined;
}

/** Rejects empty, oversized, and prototype-bearing property segments. */
function isSafePropertyName(member: string): boolean {
  return (
    member.length > 0 &&
    member.length <= MAX_PROPERTY_NAME_LENGTH &&
    !BLOCKED_PROPERTY_NAMES.has(member)
  );
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

/** Adds only the parents of a scalar/collection value so its exact leaf kind remains intact. */
function addParentContainerPrefixes(
  pathSegments: readonly string[],
  collected: Map<string, readonly string[]>,
): void {
  for (let length = 1; length < pathSegments.length && length <= MAX_PATH_DEPTH; length += 1) {
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
