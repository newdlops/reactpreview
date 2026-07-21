/**
 * Traces collection demand through bounded, side-effect-free aliases of one runtime-hook result.
 *
 * Query results are often retained as an object, projected through React `useMemo`, and destructured
 * only afterwards. The primary hook analyzer cannot see that `genres.map(...)` belongs to
 * `userQuery.data` once those local names diverge. This helper follows only immutable identity
 * projections and object bindings; calls, computed keys, defaults, mutations, and unknown memo
 * implementations fail closed so preview completion never guesses through application logic.
 */
import ts from 'typescript';
import {
  isPreviewRuntimeFunction,
  unwrapPreviewRuntimeExpression,
} from './previewRuntimeHookSyntax';
import type { PreviewRuntimeFunction } from './previewRuntimeHookSyntax';
import { isPreviewRuntimeHookArrayUsageProperty } from './previewRuntimeHookPropertyUsage';

const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_ALIAS_COUNT = 32;
const MAX_ALIAS_DEPTH = 8;
const MAX_ALIAS_PASSES = 8;
const MAX_COLLECTION_USAGES = 32;

/** One Array-style receiver proven below an immutable alias of the original hook result. */
export interface PreviewRuntimeHookIdentityAliasCollectionUsage {
  /** Array method or `length` property that proved the receiver kind. */
  readonly collectionProperty: string;
  /** Receiver path relative to the original hook result, excluding the Array operation. */
  readonly names: readonly string[];
  /** True when the final alias-rooted access can short-circuit through optional chaining. */
  readonly optional: boolean;
}

/** Internal path carried by one unique local name. */
interface IdentityAliasPath {
  readonly names: readonly string[];
}

/** React import bindings that can identify the real `useMemo` without name-only guessing. */
interface ReactMemoBindings {
  readonly direct: ReadonlySet<string>;
  readonly namespaces: ReadonlySet<string>;
}

/** Resolved access path plus the local alias that rooted the authored expression. */
interface ResolvedAliasAccess {
  readonly aliasName: string;
  readonly names: readonly string[];
  readonly optional: boolean;
}

/**
 * Finds Array-style uses reached through `const` identity aliases and React `useMemo` identities.
 *
 * The search stays inside the hook owner's lexical function, admits at most eight propagation
 * passes, and rejects duplicate binding names. Nested callbacks may consume an alias, but a callback
 * that declares the same name is skipped wholesale because syntax alone cannot resolve that shadow.
 */
export function readPreviewRuntimeHookIdentityAliasCollectionUsages(
  identifier: ts.Identifier,
  owner: PreviewRuntimeFunction,
): readonly PreviewRuntimeHookIdentityAliasCollectionUsage[] {
  if (!isConstBindingIdentifier(identifier)) return [];
  const declarations = collectOwnerConstDeclarations(owner);
  const bindingCounts = countOwnerBindingNames(declarations);
  if (bindingCounts.get(identifier.text) !== 1) return [];

  const memoBindings = collectReactMemoBindings(identifier.getSourceFile());
  const aliases = propagateIdentityAliases(
    identifier.text,
    declarations,
    bindingCounts,
    memoBindings,
  );
  if (aliases.size <= 1) return [];
  return collectAliasedCollectionUsages(owner, identifier.text, aliases);
}

/** Confirms that the original hook result itself is held by one immutable local. */
function isConstBindingIdentifier(identifier: ts.Identifier): boolean {
  const declaration = identifier.parent;
  return (
    ts.isVariableDeclaration(declaration) &&
    declaration.name === identifier &&
    ts.isVariableDeclarationList(declaration.parent) &&
    (declaration.parent.flags & ts.NodeFlags.Const) !== 0
  );
}

/** Collects only declarations owned by the component, excluding declarations inside callbacks. */
function collectOwnerConstDeclarations(
  owner: PreviewRuntimeFunction,
): readonly ts.VariableDeclaration[] {
  const declarations: ts.VariableDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== owner && isPreviewRuntimeFunction(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      declarations.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  return declarations;
}

/** Counts every local binding so ambiguous block/scope reuse fails closed before propagation. */
function countOwnerBindingNames(
  declarations: readonly ts.VariableDeclaration[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const declaration of declarations) {
    appendBindingNames(declaration.name, (name) => counts.set(name, (counts.get(name) ?? 0) + 1));
  }
  return counts;
}

/** Visits identifier leaves in an object/array binding without interpreting defaults. */
function appendBindingNames(binding: ts.BindingName, append: (name: string) => void): void {
  if (ts.isIdentifier(binding)) {
    append(binding.text);
    return;
  }
  for (const element of binding.elements) {
    if (!ts.isOmittedExpression(element)) appendBindingNames(element.name, append);
  }
}

/** Indexes named, aliased, namespace, and default React imports that can call `useMemo`. */
function collectReactMemoBindings(sourceFile: ts.SourceFile): ReactMemoBindings {
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
    const bindings = importClause?.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === 'useMemo') {
        direct.add(element.name.text);
      }
    }
  }
  return { direct, namespaces };
}

/** Resolves immutable aliases in a small fixed point so identity and later destructuring can chain. */
function propagateIdentityAliases(
  rootName: string,
  declarations: readonly ts.VariableDeclaration[],
  bindingCounts: ReadonlyMap<string, number>,
  memoBindings: ReactMemoBindings,
): ReadonlyMap<string, IdentityAliasPath> {
  const aliases = new Map<string, IdentityAliasPath>([[rootName, { names: [] }]]);
  for (let pass = 0; pass < MAX_ALIAS_PASSES && aliases.size < MAX_ALIAS_COUNT; pass += 1) {
    let changed = false;
    for (const declaration of declarations) {
      const additions = resolveIdentityAliasDeclaration(
        declaration,
        aliases,
        bindingCounts,
        memoBindings,
      );
      if (additions === undefined || aliases.size + additions.size > MAX_ALIAS_COUNT) continue;
      for (const [name, aliasPath] of additions) {
        if (aliases.has(name)) continue;
        aliases.set(name, aliasPath);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return aliases;
}

/** Converts one direct alias or object binding into staged mappings, never partial mappings. */
function resolveIdentityAliasDeclaration(
  declaration: ts.VariableDeclaration,
  aliases: ReadonlyMap<string, IdentityAliasPath>,
  bindingCounts: ReadonlyMap<string, number>,
  memoBindings: ReactMemoBindings,
): ReadonlyMap<string, IdentityAliasPath> | undefined {
  const initializer = declaration.initializer;
  if (initializer === undefined) return undefined;
  const sourcePath =
    readIdentityExpressionPath(initializer, aliases) ??
    readReactMemoIdentityPath(initializer, aliases, memoBindings);
  if (sourcePath === undefined || sourcePath.length > MAX_ALIAS_DEPTH) return undefined;
  const additions = new Map<string, IdentityAliasPath>();
  const supported = appendIdentityBindingAliases(
    declaration.name,
    sourcePath,
    additions,
    bindingCounts,
    0,
  );
  return supported ? additions : undefined;
}

/** Reads an identifier/property identity rooted at an already-proven alias. */
function readIdentityExpressionPath(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, IdentityAliasPath>,
): readonly string[] | undefined {
  const suffix: string[] = [];
  let current = unwrapPreviewRuntimeExpression(expression);
  while (ts.isPropertyAccessExpression(current)) {
    if (current.questionDotToken !== undefined || BLOCKED_PROPERTY_NAMES.has(current.name.text)) {
      return undefined;
    }
    suffix.unshift(current.name.text);
    current = unwrapPreviewRuntimeExpression(current.expression);
  }
  if (!ts.isIdentifier(current)) return undefined;
  const prefix = aliases.get(current.text)?.names;
  return prefix === undefined ? undefined : [...prefix, ...suffix];
}

/** Reads the returned identity from React's imported `useMemo`, rejecting computed callbacks. */
function readReactMemoIdentityPath(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, IdentityAliasPath>,
  memoBindings: ReactMemoBindings,
): readonly string[] | undefined {
  const call = unwrapPreviewRuntimeExpression(expression);
  if (!ts.isCallExpression(call) || call.questionDotToken !== undefined) return undefined;
  const callee = unwrapPreviewRuntimeExpression(call.expression);
  const directMemo = ts.isIdentifier(callee) && memoBindings.direct.has(callee.text);
  const namespaceReceiver = ts.isPropertyAccessExpression(callee)
    ? unwrapPreviewRuntimeExpression(callee.expression)
    : undefined;
  const namespaceMemo =
    ts.isPropertyAccessExpression(callee) &&
    callee.questionDotToken === undefined &&
    callee.name.text === 'useMemo' &&
    namespaceReceiver !== undefined &&
    ts.isIdentifier(namespaceReceiver) &&
    memoBindings.namespaces.has(namespaceReceiver.text);
  if (!directMemo && !namespaceMemo) return undefined;
  const callback = call.arguments[0];
  if (callback === undefined) return undefined;
  const returned = readPureIdentityCallbackReturn(callback);
  return returned === undefined ? undefined : readIdentityExpressionPath(returned, aliases);
}

/** Accepts only a zero-argument synchronous callback that does nothing except return one expression. */
function readPureIdentityCallbackReturn(expression: ts.Expression): ts.Expression | undefined {
  const callback = unwrapPreviewRuntimeExpression(expression);
  if (
    (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) ||
    callback.parameters.length !== 0 ||
    callback.asteriskToken !== undefined ||
    callback.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) === true
  ) {
    return undefined;
  }
  if (!ts.isBlock(callback.body)) return callback.body;
  if (callback.body.statements.length !== 1) return undefined;
  const statement = callback.body.statements[0];
  return statement !== undefined && ts.isReturnStatement(statement)
    ? statement.expression
    : undefined;
}

/** Maps one strict object binding to source paths while rejecting rest/default/computed semantics. */
function appendIdentityBindingAliases(
  binding: ts.BindingName,
  sourcePath: readonly string[],
  additions: Map<string, IdentityAliasPath>,
  bindingCounts: ReadonlyMap<string, number>,
  depth: number,
): boolean {
  if (depth > MAX_ALIAS_DEPTH) return false;
  if (ts.isIdentifier(binding)) {
    if (bindingCounts.get(binding.text) !== 1) return false;
    additions.set(binding.text, { names: sourcePath });
    return true;
  }
  if (!ts.isObjectBindingPattern(binding)) return false;
  for (const element of binding.elements) {
    if (element.dotDotDotToken !== undefined || element.initializer !== undefined) return false;
    const propertyName = readStaticBindingPropertyName(element);
    if (propertyName === undefined) return false;
    if (
      !appendIdentityBindingAliases(
        element.name,
        [...sourcePath, propertyName],
        additions,
        bindingCounts,
        depth + 1,
      )
    ) {
      return false;
    }
  }
  return true;
}

/** Reads an identifier/string key and rejects prototype-sensitive or oversized property names. */
function readStaticBindingPropertyName(element: ts.BindingElement): string | undefined {
  const property = element.propertyName;
  const name =
    property === undefined && ts.isIdentifier(element.name)
      ? element.name.text
      : property !== undefined && (ts.isIdentifier(property) || ts.isStringLiteral(property))
        ? property.text
        : undefined;
  return name !== undefined && name.length <= 128 && !BLOCKED_PROPERTY_NAMES.has(name)
    ? name
    : undefined;
}

/** Collects collection terminals while respecting nested callback shadowing and fixed budgets. */
function collectAliasedCollectionUsages(
  owner: PreviewRuntimeFunction,
  rootName: string,
  aliases: ReadonlyMap<string, IdentityAliasPath>,
): readonly PreviewRuntimeHookIdentityAliasCollectionUsage[] {
  const usages = new Map<string, PreviewRuntimeHookIdentityAliasCollectionUsage>();
  const aliasNames = new Set(aliases.keys());
  const visit = (node: ts.Node): void => {
    if (usages.size >= MAX_COLLECTION_USAGES) return;
    if (
      node !== owner &&
      isPreviewRuntimeFunction(node) &&
      functionShadowsTrackedAlias(node, aliasNames)
    ) {
      return;
    }
    if (ts.isPropertyAccessExpression(node) && !ts.isPropertyAccessExpression(node.parent)) {
      const access = readAliasedPropertyAccess(node, aliases);
      const collectionProperty = access?.names.at(-1);
      if (
        access !== undefined &&
        access.aliasName !== rootName &&
        access.names.length > 1 &&
        isPreviewRuntimeHookArrayUsageProperty(collectionProperty)
      ) {
        const names = access.names.slice(0, -1);
        const usage = {
          collectionProperty: collectionProperty ?? 'length',
          names,
          optional: access.optional,
        };
        usages.set(
          `${names.join('.')}\u0000${usage.collectionProperty}\u0000${usage.optional ? 'optional' : 'required'}`,
          usage,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  return [...usages.values()];
}

/** Resolves a property chain through a derived alias and preserves optional-access evidence. */
function readAliasedPropertyAccess(
  expression: ts.PropertyAccessExpression,
  aliases: ReadonlyMap<string, IdentityAliasPath>,
): ResolvedAliasAccess | undefined {
  const suffix: string[] = [];
  let optional = false;
  let current: ts.Expression = expression;
  while (ts.isPropertyAccessExpression(current)) {
    optional = optional || current.questionDotToken !== undefined;
    if (BLOCKED_PROPERTY_NAMES.has(current.name.text)) return undefined;
    suffix.unshift(current.name.text);
    current = unwrapPreviewRuntimeExpression(current.expression);
  }
  if (!ts.isIdentifier(current)) return undefined;
  const prefix = aliases.get(current.text)?.names;
  return prefix === undefined
    ? undefined
    : { aliasName: current.text, names: [...prefix, ...suffix], optional };
}

/** Rejects a nested callback when its parameters or local declarations hide any tracked alias. */
function functionShadowsTrackedAlias(
  scope: PreviewRuntimeFunction,
  aliasNames: ReadonlySet<string>,
): boolean {
  if (
    scope.parameters.some((parameter) => bindingContainsTrackedName(parameter.name, aliasNames))
  ) {
    return true;
  }
  let shadows = false;
  const visit = (node: ts.Node): void => {
    if (shadows || (node !== scope && isPreviewRuntimeFunction(node))) return;
    if (ts.isVariableDeclaration(node) && bindingContainsTrackedName(node.name, aliasNames)) {
      shadows = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  if (scope.body !== undefined) visit(scope.body);
  return shadows;
}

/** Reports whether any identifier leaf in a binding belongs to the tracked alias set. */
function bindingContainsTrackedName(
  binding: ts.BindingName,
  aliasNames: ReadonlySet<string>,
): boolean {
  if (ts.isIdentifier(binding)) return aliasNames.has(binding.text);
  return binding.elements.some(
    (element) =>
      !ts.isOmittedExpression(element) && bindingContainsTrackedName(element.name, aliasNames),
  );
}
