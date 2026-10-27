/** Coordinates bounded authored-source analysis for previewRuntimeHookAliasUsage. */
import ts from 'typescript';
import {
  collectAliasCollectionReceiverPaths,
  collectOwnerConstDeclarations,
  collectReactMemoBindings,
  countBindingNames,
  propagateAliasPaths,
  readAliasAccess,
  readForwardedObjectLiteral,
  readForwardedObjectProperty,
  readIdentityPaths,
} from './previewRuntimeHookAliasBindings';
import {
  COLLECTION_ITEM_CALLBACK_METHODS,
  COLLECTION_UTILITY_CALLBACK_ARGUMENTS,
  MAXIMUM_ALIAS_DEPTH,
  MAXIMUM_USAGE_PATHS,
  type PreviewRuntimeHookAliasPathCatalog,
  type PreviewRuntimeHookAliasUsagePath,
  type PreviewRuntimeHookImportedHelperItemFallback,
  type ReactMemoBindings,
  type ResolvePreviewRuntimeHookImportedHelperItemFallback,
  type ResolvePreviewRuntimeHookImportedHelperPropertyFallback,
} from './previewRuntimeHookAliasModel';
import {
  functionShadowsTrackedAlias,
  normalizeAliasUsage,
} from './previewRuntimeHookAliasNormalization';
import { inferPreviewRuntimeHookLocalScalarFallback } from './previewRuntimeHookLocalScalarDemand';
import {
  isPreviewRuntimeFunction,
  unwrapPreviewRuntimeExpression,
  type PreviewRuntimeFunction,
} from './previewRuntimeHookSyntax';

/**
 * Returns required paths observed below immutable aliases of one hook-bound identifier.
 *
 * Only simple `const` identifiers, property access, `||`, `??`, ternary choices, and identity-only
 * callbacks passed to the exact React `useMemo` import are admitted. Other calls, assignments,
 * computed keys, defaults, and mutable bindings stop propagation.
 */
export function readPreviewRuntimeHookAliasUsagePaths(
  identifier: ts.Identifier,
  owner: PreviewRuntimeFunction,
  resolveImportedHelperItem?: ResolvePreviewRuntimeHookImportedHelperItemFallback,
  resolveImportedHelperProperty?: ResolvePreviewRuntimeHookImportedHelperPropertyFallback,
  resolveImportedCollectionCallbackItem?: ResolvePreviewRuntimeHookImportedHelperItemFallback,
  externallyProvenCollectionPaths?: ReadonlySet<string>,
  includeRootUsages = false,
  inferCollectionItem?: (
    access: ts.PropertyAccessExpression,
  ) => PreviewRuntimeHookImportedHelperItemFallback | undefined,
): readonly PreviewRuntimeHookAliasUsagePath[] {
  const declarations = collectOwnerConstDeclarations(owner);
  const bindingCounts = countBindingNames(declarations);
  const memoBindings = collectReactMemoBindings(identifier.getSourceFile());
  const aliases = collectPreviewRuntimeHookAliasPaths(identifier, owner);
  const provenCollectionPaths = collectAliasCollectionReceiverPaths(
    owner,
    aliases,
    externallyProvenCollectionPaths,
  );
  if (
    aliases.size <= 1 &&
    resolveImportedHelperItem === undefined &&
    resolveImportedHelperProperty === undefined &&
    resolveImportedCollectionCallbackItem === undefined &&
    !includeRootUsages
  ) {
    return [];
  }

  const usages = new Map<string, PreviewRuntimeHookAliasUsagePath>();
  appendClosedScalarAliasUsages(identifier, aliases, declarations, bindingCounts, usages);
  const aliasNames = new Set(aliases.keys());
  const visit = (node: ts.Node): void => {
    if (usages.size >= MAXIMUM_USAGE_PATHS) return;
    if (
      node !== owner &&
      isPreviewRuntimeFunction(node) &&
      functionShadowsTrackedAlias(node, aliasNames)
    ) {
      return;
    }
    if (
      ts.isIdentifier(node) &&
      (includeRootUsages || node.text !== identifier.text) &&
      ts.isCallExpression(node.parent) &&
      node.parent.expression === node
    ) {
      const aliasPaths = aliases.get(node.text);
      if (aliasPaths !== undefined) {
        for (const names of aliasPaths) {
          if (names.length > MAXIMUM_ALIAS_DEPTH) continue;
          const usage: PreviewRuntimeHookAliasUsagePath = Object.freeze({
            called: true,
            names: Object.freeze([...names]),
          });
          usages.set(`${names.join('.')}\0call`, usage);
        }
      }
    }
    if (ts.isPropertyAccessExpression(node) && !ts.isPropertyAccessExpression(node.parent)) {
      const access = readAliasAccess(node, aliases);
      if (access !== undefined && (includeRootUsages || access.aliasName !== identifier.text)) {
        for (const names of access.names) {
          const usage = normalizeAliasUsage(
            node,
            names,
            identifier.text,
            identifier.getStart(),
            provenCollectionPaths,
            inferCollectionItem,
          );
          if (usage === undefined) continue;
          const terminalKind =
            usage.collectionProperty ?? usage.stringProperty ?? (usage.called ? 'call' : 'value');
          // Let the shared usage tree merge distinct callback readers instead of keeping only the last.
          const occurrence =
            usage.collectionItemExpression === undefined ? '' : `\0${String(node.pos)}`;
          usages.set(`${usage.names.join('.')}\0${terminalKind}${occurrence}`, usage);
        }
      }
    }
    if (ts.isCallExpression(node) && resolveImportedHelperItem !== undefined) {
      appendImportedHelperAliasUsages(node, aliases, resolveImportedHelperItem, usages);
    }
    if (ts.isCallExpression(node) && resolveImportedCollectionCallbackItem !== undefined) {
      appendImportedCollectionCallbackAliasUsage(
        node,
        aliases,
        resolveImportedCollectionCallbackItem,
        usages,
      );
    }
    if (ts.isCallExpression(node) && resolveImportedHelperProperty !== undefined) {
      appendImportedHelperPropertyUsages(
        node,
        aliases,
        resolveImportedHelperProperty,
        usages,
        declarations,
        bindingCounts,
        memoBindings,
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  return Object.freeze([...usages.values()]);
}

/**
 * Carries a closed-domain scalar selected from an alias's exhaustive control flow back to the hook
 * path. This is deliberately limited to values marked as render guards by the scalar analyzer;
 * ordinary comparison-safe placeholders must not overwrite an authored backend value.
 */
function appendClosedScalarAliasUsages(
  root: ts.Identifier,
  aliases: PreviewRuntimeHookAliasPathCatalog,
  declarations: readonly ts.VariableDeclaration[],
  bindingCounts: ReadonlyMap<string, number>,
  usages: Map<string, PreviewRuntimeHookAliasUsagePath>,
): void {
  for (const [aliasName, paths] of aliases) {
    if (
      aliasName === root.text ||
      bindingCounts.get(aliasName) !== 1 ||
      usages.size >= MAXIMUM_USAGE_PATHS
    ) {
      continue;
    }
    const identifier = declarations
      .flatMap((declaration) => collectBindingIdentifiers(declaration.name))
      .find((candidate) => candidate.text === aliasName);
    if (identifier === undefined) continue;
    const fallback = inferPreviewRuntimeHookLocalScalarFallback(
      identifier,
      identifier.getSourceFile(),
    );
    if (fallback?.renderGuard !== true) continue;
    for (const names of paths) {
      if (names.length === 0 || names.length > MAXIMUM_ALIAS_DEPTH) continue;
      const usage: PreviewRuntimeHookAliasUsagePath = Object.freeze({
        called: false,
        names: Object.freeze([...names]),
        renderGuard: true,
        valueExpression: fallback.expression,
      });
      usages.set(`${names.join('.')}\0closed-scalar`, usage);
    }
  }
}

/** Returns identifier leaves from one immutable binding without following initializers. */
function collectBindingIdentifiers(binding: ts.BindingName): readonly ts.Identifier[] {
  if (ts.isIdentifier(binding)) return [binding];
  return binding.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : collectBindingIdentifiers(element.name),
  );
}

/** Adds item structure proven by an exact imported function used as an Array callback. */
function appendImportedCollectionCallbackAliasUsage(
  call: ts.CallExpression,
  aliases: PreviewRuntimeHookAliasPathCatalog,
  resolveItem: ResolvePreviewRuntimeHookImportedHelperItemFallback,
  usages: Map<string, PreviewRuntimeHookAliasUsagePath>,
): void {
  if (call.questionDotToken !== undefined) return;
  const callee = unwrapPreviewRuntimeExpression(call.expression);
  if (
    ts.isPropertyAccessExpression(callee) &&
    callee.questionDotToken === undefined &&
    COLLECTION_ITEM_CALLBACK_METHODS.has(callee.name.text)
  ) {
    appendImportedCallbackCollectionUsage(
      callee.expression,
      call.arguments[0],
      callee.name.text,
      aliases,
      resolveItem,
      usages,
    );
    return;
  }
  const utilityName = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee) && callee.questionDotToken === undefined
      ? callee.name.text
      : undefined;
  const utilityArguments =
    utilityName === undefined ? undefined : COLLECTION_UTILITY_CALLBACK_ARGUMENTS.get(utilityName);
  if (utilityName === undefined || utilityArguments === undefined) return;
  const [collectionIndex, callbackIndex] = utilityArguments;
  const collection = call.arguments[collectionIndex];
  if (collection === undefined || ts.isSpreadElement(collection)) return;
  appendImportedCallbackCollectionUsage(
    collection,
    call.arguments[callbackIndex],
    utilityName,
    aliases,
    resolveItem,
    usages,
  );
}

/** Applies one exact imported callback contract to a syntax-proven collection origin. */
function appendImportedCallbackCollectionUsage(
  collection: ts.Expression,
  callback: ts.Expression | undefined,
  operationName: string,
  aliases: PreviewRuntimeHookAliasPathCatalog,
  resolveItem: ResolvePreviewRuntimeHookImportedHelperItemFallback,
  usages: Map<string, PreviewRuntimeHookAliasUsagePath>,
): void {
  if (callback === undefined || ts.isSpreadElement(callback)) return;
  const callbackValue = unwrapPreviewRuntimeExpression(callback);
  if (!ts.isIdentifier(callbackValue)) return;
  const item = resolveItem(callbackValue.text, 0);
  if (item === undefined) return;
  for (const names of readIdentityPaths(collection, aliases)) {
    if (names.length > MAXIMUM_ALIAS_DEPTH || usages.size >= MAXIMUM_USAGE_PATHS) continue;
    const usage = Object.freeze({
      called: false,
      collectionItemExpression: item.expression,
      ...(item.requiredPaths === undefined
        ? {}
        : { collectionItemRequiredPaths: Object.freeze([...item.requiredPaths]) }),
      collectionProperty: operationName,
      names: Object.freeze([...names]),
    });
    usages.set(`${names.join('.')}\0${operationName}\0imported-callback`, usage);
  }
}

/**
 * Resolves immutable aliases back to one hook-bound identifier for adjacent analyzers.
 *
 * Object destructuring is retained as a path projection, including a value-choice carrier such as
 * `const { user } = data || { user: null }`. The literal alternative supplies no hook origin, while
 * the `data.user` branch remains an exact syntax-proven path.
 */
export function collectPreviewRuntimeHookAliasPaths(
  identifier: ts.Identifier,
  owner: PreviewRuntimeFunction,
): PreviewRuntimeHookAliasPathCatalog {
  const declarations = collectOwnerConstDeclarations(owner);
  const bindingCounts = countBindingNames(declarations);
  const memoBindings = collectReactMemoBindings(identifier.getSourceFile());
  return propagateAliasPaths(identifier.text, owner, declarations, bindingCounts, memoBindings);
}

/**
 * Carries a hook identity through a static object argument into an imported helper's typed field.
 *
 * A shorthand such as `buildMenu({ pagePath })` is passive in the caller, but an imported
 * `{ pagePath: (...) => string }` parameter proves the value is callable. This is type-shape
 * completion only: the helper remains authentic and no project function is executed here.
 */
function appendImportedHelperPropertyUsages(
  call: ts.CallExpression,
  aliases: PreviewRuntimeHookAliasPathCatalog,
  resolveProperty: ResolvePreviewRuntimeHookImportedHelperPropertyFallback,
  usages: Map<string, PreviewRuntimeHookAliasUsagePath>,
  declarations: readonly ts.VariableDeclaration[],
  bindingCounts: ReadonlyMap<string, number>,
  memoBindings: ReactMemoBindings,
): void {
  const callee = unwrapPreviewRuntimeExpression(call.expression);
  if (!ts.isIdentifier(callee)) return;
  for (const [parameterIndex, argument] of call.arguments.entries()) {
    const object = readForwardedObjectLiteral(argument, declarations, bindingCounts, memoBindings);
    if (object === undefined) continue;
    for (const property of object.properties) {
      if (usages.size >= MAXIMUM_USAGE_PATHS) return;
      const propertyBinding = readForwardedObjectProperty(property, aliases, memoBindings);
      if (propertyBinding === undefined) continue;
      const fallback = resolveProperty(callee.text, parameterIndex, propertyBinding.propertyName);
      if (fallback === undefined) continue;
      for (const names of propertyBinding.paths) {
        if (names.length > MAXIMUM_ALIAS_DEPTH) continue;
        if ((fallback.nestedUsages?.length ?? 0) > 0) {
          for (const nested of fallback.nestedUsages ?? []) {
            const nestedNames = [...names, ...nested.names];
            if (nestedNames.length > MAXIMUM_ALIAS_DEPTH) continue;
            const usage: PreviewRuntimeHookAliasUsagePath = Object.freeze({
              ...nested,
              names: Object.freeze(nestedNames),
            });
            const terminalKind =
              usage.collectionProperty ??
              usage.stringProperty ??
              (usage.valueExpression !== undefined
                ? 'imported-helper-expression'
                : usage.called
                  ? 'imported-helper-callable'
                  : 'imported-helper-value');
            usages.set(`${nestedNames.join('.')}\0${terminalKind}`, usage);
          }
          continue;
        }
        const usage: PreviewRuntimeHookAliasUsagePath = Object.freeze({
          called: fallback.kind === 'function',
          names: Object.freeze([...names]),
          ...(fallback.kind === 'function' ? {} : { valueExpression: fallback.expression }),
          ...(fallback.kind === 'function' || fallback.requiredPaths === undefined
            ? {}
            : { valueRequiredPaths: Object.freeze([...fallback.requiredPaths]) }),
        });
        const terminal =
          fallback.kind === 'function' ? 'imported-helper-callable' : 'imported-helper-value';
        usages.set(`${names.join('.')}\0${terminal}`, usage);
      }
    }
  }
}

/** Adds collection structure proven by a direct imported helper's typed Array parameter. */
function appendImportedHelperAliasUsages(
  call: ts.CallExpression,
  aliases: PreviewRuntimeHookAliasPathCatalog,
  resolveItem: ResolvePreviewRuntimeHookImportedHelperItemFallback,
  usages: Map<string, PreviewRuntimeHookAliasUsagePath>,
): void {
  const callee = unwrapPreviewRuntimeExpression(call.expression);
  if (!ts.isIdentifier(callee)) return;
  for (const [parameterIndex, argument] of call.arguments.entries()) {
    if (usages.size >= MAXIMUM_USAGE_PATHS) return;
    const value = unwrapPreviewRuntimeExpression(argument);
    const paths = readIdentityPaths(value, aliases);
    if (paths.length === 0) continue;
    const item = resolveItem(callee.text, parameterIndex);
    if (item === undefined) continue;
    for (const names of paths) {
      if (names.length === 0 || names.length > MAXIMUM_ALIAS_DEPTH) continue;
      const usage = Object.freeze({
        called: false,
        collectionItemExpression: item.expression,
        ...(item.requiredPaths === undefined
          ? {}
          : { collectionItemRequiredPaths: Object.freeze([...item.requiredPaths]) }),
        collectionProperty: 'imported-helper-array-parameter',
        names: Object.freeze([...names]),
      });
      usages.set(`${names.join('.')}\0imported-helper-array-parameter`, usage);
    }
  }
}
export type {
  PreviewRuntimeHookAliasPathCatalog,
  PreviewRuntimeHookAliasUsagePath,
  PreviewRuntimeHookImportedHelperItemFallback,
  PreviewRuntimeHookImportedHelperNestedUsage,
  ResolvePreviewRuntimeHookImportedHelperItemFallback,
  ResolvePreviewRuntimeHookImportedHelperParameterFallback,
  ResolvePreviewRuntimeHookImportedHelperPropertyFallback,
} from './previewRuntimeHookAliasModel';
export { inferPreviewRuntimeHookCallableSmartValue } from './previewRuntimeHookAliasNormalization';
