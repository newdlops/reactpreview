/** Carries hook-owned object demand through an exact React `useState` transition. */
import ts from 'typescript';
import {
  isPreviewRuntimeFunction,
  unwrapPreviewRuntimeExpression,
  type PreviewRuntimeFunction,
} from './previewRuntimeHookSyntax';

const MAXIMUM_STATE_BINDINGS = 16;
const MAXIMUM_SETTER_ARGUMENTS = 32;
const MAXIMUM_STATE_ORIGINS = 4;

type PreviewRuntimeHookOriginPaths = readonly (readonly string[])[];

interface PreviewRuntimeHookStateBinding {
  readonly setterName: string;
  readonly stateName: string;
}

export interface CollectPreviewRuntimeHookStateAliasesOptions {
  /** Hook-relative identities already proven by ordinary immutable alias propagation. */
  readonly aliases: ReadonlyMap<string, PreviewRuntimeHookOriginPaths>;
  /** Component/custom-hook scope that owns both the hook result and React state. */
  readonly owner: PreviewRuntimeFunction;
  /** Resolves only the caller's already-supported identity/choice expression forms. */
  readonly readOriginPaths: (expression: ts.Expression) => PreviewRuntimeHookOriginPaths;
}

/**
 * Returns state bindings whose setter receives the analyzed hook identity directly or by spread.
 *
 * React state is not an immutable JavaScript alias, but a transition such as
 * `setDraft({ ...query.data })` proves that later `draft.field` reads impose the same field demand on
 * the hook fallback. Exact React import identity, unique tuple bindings, bounded setter calls, and a
 * whole-object carrier are all required; computed field transforms remain opaque.
 */
export function collectPreviewRuntimeHookStateAliases(
  options: CollectPreviewRuntimeHookStateAliasesOptions,
): ReadonlyMap<string, PreviewRuntimeHookOriginPaths> {
  const stateAliases = new Map<string, PreviewRuntimeHookOriginPaths>();
  for (const binding of collectReactStateBindings(options.owner)) {
    if (options.aliases.has(binding.stateName)) continue;
    const origins = collectSetterOriginPaths(binding, options);
    if (origins.length > 0) stateAliases.set(binding.stateName, origins);
  }
  return stateAliases;
}

/** Finds uniquely bound `[state, setter]` tuples created by the exact React `useState` import. */
function collectReactStateBindings(
  owner: PreviewRuntimeFunction,
): readonly PreviewRuntimeHookStateBinding[] {
  const useStateBindings = collectReactUseStateBindings(owner.getSourceFile());
  const bindingCounts = countOwnerBindingNames(owner);
  const bindings: PreviewRuntimeHookStateBinding[] = [];
  const visit = (node: ts.Node): void => {
    if (bindings.length >= MAXIMUM_STATE_BINDINGS) return;
    if (node !== owner && isPreviewRuntimeFunction(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer !== undefined &&
      isExactReactUseStateCall(node.initializer, useStateBindings)
    ) {
      const state = node.name.elements[0];
      const setter = node.name.elements[1];
      if (
        state !== undefined &&
        setter !== undefined &&
        !ts.isOmittedExpression(state) &&
        !ts.isOmittedExpression(setter) &&
        state.dotDotDotToken === undefined &&
        setter.dotDotDotToken === undefined &&
        state.initializer === undefined &&
        setter.initializer === undefined &&
        ts.isIdentifier(state.name) &&
        ts.isIdentifier(setter.name) &&
        bindingCounts.get(state.name.text) === 1 &&
        bindingCounts.get(setter.name.text) === 1
      ) {
        bindings.push({ setterName: setter.name.text, stateName: state.name.text });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  return bindings;
}

interface ReactUseStateBindings {
  readonly direct: ReadonlySet<string>;
  readonly namespaces: ReadonlySet<string>;
}

/** Indexes named, namespace, and default React imports without trusting same-named local functions. */
function collectReactUseStateBindings(sourceFile: ts.SourceFile): ReactUseStateBindings {
  const direct = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'react'
    ) {
      continue;
    }
    const importClause = statement.importClause;
    if (importClause?.name !== undefined) namespaces.add(importClause.name.text);
    const namedBindings = importClause?.namedBindings;
    if (namedBindings === undefined) continue;
    if (ts.isNamespaceImport(namedBindings)) {
      namespaces.add(namedBindings.name.text);
      continue;
    }
    for (const element of namedBindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === 'useState') {
        direct.add(element.name.text);
      }
    }
  }
  return { direct, namespaces };
}

/** Recognizes only direct or namespace-qualified React useState calls. */
function isExactReactUseStateCall(
  expression: ts.Expression,
  bindings: ReactUseStateBindings,
): boolean {
  const value = unwrapPreviewRuntimeExpression(expression);
  if (!ts.isCallExpression(value) || value.questionDotToken !== undefined) return false;
  const callee = unwrapPreviewRuntimeExpression(value.expression);
  if (ts.isIdentifier(callee)) return bindings.direct.has(callee.text);
  if (
    !ts.isPropertyAccessExpression(callee) ||
    callee.questionDotToken !== undefined ||
    callee.name.text !== 'useState'
  ) {
    return false;
  }
  const receiver = unwrapPreviewRuntimeExpression(callee.expression);
  return ts.isIdentifier(receiver) && bindings.namespaces.has(receiver.text);
}

/** Requires each tuple name to denote one owner-scope binding before correlating setter calls. */
function countOwnerBindingNames(owner: PreviewRuntimeFunction): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  const append = (binding: ts.BindingName): void => {
    if (ts.isIdentifier(binding)) {
      counts.set(binding.text, (counts.get(binding.text) ?? 0) + 1);
      return;
    }
    for (const element of binding.elements) {
      if (!ts.isOmittedExpression(element)) append(element.name);
    }
  };
  for (const parameter of owner.parameters) append(parameter.name);
  const visit = (node: ts.Node): void => {
    if (node !== owner && isPreviewRuntimeFunction(node)) return;
    if (ts.isVariableDeclaration(node)) append(node.name);
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) append(node.name);
    ts.forEachChild(node, visit);
  };
  visit(owner);
  return counts;
}

/** Reads bounded whole-value origins from every unshadowed call to the exact state setter. */
function collectSetterOriginPaths(
  binding: PreviewRuntimeHookStateBinding,
  options: CollectPreviewRuntimeHookStateAliasesOptions,
): PreviewRuntimeHookOriginPaths {
  const origins: (readonly string[])[] = [];
  let setterArguments = 0;
  const appendOrigins = (expression: ts.Expression): void => {
    for (const path of readStateValueOriginPaths(expression, options.readOriginPaths)) {
      if (!origins.some((candidate) => haveEqualPaths(candidate, path))) {
        origins.push(Object.freeze([...path]));
      }
      if (origins.length >= MAXIMUM_STATE_ORIGINS) return;
    }
  };
  const visit = (node: ts.Node): void => {
    if (setterArguments >= MAXIMUM_SETTER_ARGUMENTS || origins.length >= MAXIMUM_STATE_ORIGINS) {
      return;
    }
    if (
      node !== options.owner &&
      isPreviewRuntimeFunction(node) &&
      functionBindsName(node, binding.setterName)
    ) {
      return;
    }
    if (ts.isCallExpression(node) && node.questionDotToken === undefined) {
      const callee = unwrapPreviewRuntimeExpression(node.expression);
      if (ts.isIdentifier(callee) && callee.text === binding.setterName) {
        const argument = node.arguments[0];
        if (argument !== undefined && !ts.isSpreadElement(argument)) {
          setterArguments += 1;
          appendOrigins(argument);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(options.owner);
  return Object.freeze(origins);
}

/** Accepts direct state replacement or a plain object that spreads the hook-owned carrier. */
function readStateValueOriginPaths(
  expression: ts.Expression,
  readOriginPaths: (expression: ts.Expression) => PreviewRuntimeHookOriginPaths,
): PreviewRuntimeHookOriginPaths {
  const direct = readOriginPaths(expression);
  if (direct.length > 0) return direct;
  const value = unwrapPreviewRuntimeExpression(expression);
  if (!ts.isObjectLiteralExpression(value)) return [];
  return value.properties.flatMap((property) =>
    ts.isSpreadAssignment(property) ? readOriginPaths(property.expression) : [],
  );
}

/** Rejects a nested callback whose parameter/local declaration replaces the outer setter binding. */
function functionBindsName(scope: PreviewRuntimeFunction, name: string): boolean {
  if (scope.parameters.some((parameter) => bindingContainsName(parameter.name, name))) return true;
  let bound = false;
  const visit = (node: ts.Node): void => {
    if (bound || (node !== scope && isPreviewRuntimeFunction(node))) return;
    if (ts.isVariableDeclaration(node) && bindingContainsName(node.name, name)) bound = true;
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return bound;
}

/** Reports whether a binding pattern introduces the requested identifier. */
function bindingContainsName(binding: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(binding)) return binding.text === name;
  return binding.elements.some(
    (element) => !ts.isOmittedExpression(element) && bindingContainsName(element.name, name),
  );
}

/** Compares two bounded property paths without allocating a serialized form. */
function haveEqualPaths(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}
