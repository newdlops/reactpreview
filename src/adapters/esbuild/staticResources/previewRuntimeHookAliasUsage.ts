/**
 * Traces render-critical property demand through bounded aliases of a runtime-hook result.
 *
 * Application shells commonly destructure `data` from a query and then select a domain value with
 * `const entity = data?.entity || cachedEntity`. Direct hook analysis sees only `data.entity`, while
 * the JSX branch later reads `entity.permissions.canView`. This module carries those downstream
 * reads back to the original hook path without evaluating either branch or resolving project types.
 */
import ts from 'typescript';
import {
  isPreviewRuntimeHookArrayUsageProperty,
  isPreviewRuntimeHookStringUsageProperty,
} from './previewRuntimeHookPropertyUsage';
import {
  isPreviewRuntimeFunction,
  unwrapPreviewRuntimeExpression,
  type PreviewRuntimeFunction,
} from './previewRuntimeHookSyntax';
import {
  inferPreviewRuntimeHookCollectionLengthGuardPassValue,
  inferPreviewRuntimeHookExpressionGuardPassFallback,
} from './previewRuntimeHookGuardValue';
import { inferPreviewRuntimeHookLocalScalarFallback } from './previewRuntimeHookLocalScalarDemand';
import { inferPreviewRuntimeHookMembershipItemFallback } from './previewRuntimeHookMembershipItem';
import { inferPreviewRuntimeSemanticFallback } from './previewRuntimeHookSemantics';
import {
  isPreviewRuntimeHookEmptyRenderableJsxValue,
  isPreviewRuntimeHookMutableRefJsxValue,
  isPreviewRuntimeHookRenderedJsxValue,
} from './previewRuntimeHookDirectUsage';
import { collectPreviewRuntimeHookStateAliases } from './previewRuntimeHookStateAlias';

const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const MAXIMUM_ALIAS_COUNT = 32;
const MAXIMUM_ALIAS_DEPTH = 8;
const MAXIMUM_ALIAS_PASSES = 8;
const MAXIMUM_CHOICE_PATHS = 4;
const MAXIMUM_USAGE_PATHS = 64;
const COLLECTION_IDENTITY_METHODS = new Set(['filter', 'slice', 'toReversed', 'toSorted']);
const COLLECTION_ITEM_CALLBACK_METHODS = new Set([
  'every',
  'filter',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'flatMap',
  'forEach',
  'map',
  'some',
  'sort',
]);
const COLLECTION_UTILITY_CALLBACK_ARGUMENTS = new Map<string, readonly [number, number]>([
  ['countBy', [0, 1]],
  ['every', [0, 1]],
  ['filter', [0, 1]],
  ['find', [0, 1]],
  ['flatMap', [0, 1]],
  ['forEach', [0, 1]],
  ['groupBy', [0, 1]],
  ['keyBy', [0, 1]],
  ['map', [0, 1]],
  ['maxBy', [0, 1]],
  ['minBy', [0, 1]],
  ['some', [0, 1]],
  ['sortBy', [0, 1]],
  ['sumBy', [0, 1]],
  ['uniqBy', [0, 1]],
]);
const COLLECTION_ONLY_USAGE_PROPERTIES = new Set([
  'every',
  'filter',
  'find',
  'findIndex',
  'flatMap',
  'forEach',
  'map',
  'reduce',
  'some',
]);

/** One downstream use already normalized for the hook fallback usage-tree serializer. */
export interface PreviewRuntimeHookAliasUsagePath {
  /** True when the reached terminal property is called as a function. */
  readonly called: boolean;
  /** Static return expression required by a destructuring consumer of the called property. */
  readonly callResultExpression?: string;
  /** Static expression inferred from fields read on the collection callback's first parameter. */
  readonly collectionItemExpression?: string;
  /** Callback-item paths propagated into the enclosing hook fallback requirement list. */
  readonly collectionItemRequiredPaths?: readonly string[];
  /** Array operation proving the receiver should be generated as a collection. */
  readonly collectionProperty?: string;
  /** Property path relative to the original hook-bound identifier. */
  readonly names: readonly string[];
  /** The compiler-proven scalar must replace an authored first-state value to pass a render guard. */
  readonly renderGuard?: true;
  /** Candidate scalar returned by a generated callable, selected later by the local learner. */
  readonly smartValueExpression?: string;
  /** Bounded semantic role used as a neural feature; it never selects the candidate by itself. */
  readonly smartValueRole?: 'collection-filter-predicate' | 'render-state';
  /** String-only method proving the preceding leaf should be generated as text. */
  readonly stringProperty?: string;
  /** Side-effect-free scalar expression proven by a reached child component's render contract. */
  readonly valueExpression?: string;
  /** Nested paths retained when `valueExpression` is a structured imported-helper contract. */
  readonly valueRequiredPaths?: readonly string[];
}

/** Item fallback supplied by the bounded imported-helper type resolver. */
export interface PreviewRuntimeHookImportedHelperItemFallback {
  readonly expression: string;
  readonly kind?:
    | 'array'
    | 'boolean'
    | 'component'
    | 'element'
    | 'function'
    | 'graphql-document'
    | 'null'
    | 'number'
    | 'object'
    | 'string';
  /** Structured child usages retained when an imported object parameter has nested contracts. */
  readonly nestedUsages?: readonly PreviewRuntimeHookImportedHelperNestedUsage[];
  readonly requiredPaths?: readonly string[];
}

/** One helper-relative usage ready to be prefixed by the caller's hook alias path. */
export interface PreviewRuntimeHookImportedHelperNestedUsage {
  readonly called: boolean;
  readonly collectionItemExpression?: string;
  readonly collectionItemRequiredPaths?: readonly string[];
  readonly collectionProperty?: string;
  readonly names: readonly string[];
  readonly renderGuard?: true;
  readonly stringProperty?: string;
  readonly valueExpression?: string;
}

/** Resolves one exact direct-import call argument to an Array item contract. */
export type ResolvePreviewRuntimeHookImportedHelperItemFallback = (
  localName: string,
  parameterIndex: number,
) => PreviewRuntimeHookImportedHelperItemFallback | undefined;

/** Resolves the complete shape consumed by one exact direct-import helper parameter. */
export type ResolvePreviewRuntimeHookImportedHelperParameterFallback = (
  localName: string,
  parameterIndex: number,
) => PreviewRuntimeHookImportedHelperItemFallback | undefined;

/** Resolves one exact property of an object parameter accepted by a direct imported helper. */
export type ResolvePreviewRuntimeHookImportedHelperPropertyFallback = (
  localName: string,
  parameterIndex: number,
  propertyName: string,
) => PreviewRuntimeHookImportedHelperItemFallback | undefined;

/** One local alias may originate from a small logical or conditional choice. */
export type PreviewRuntimeHookAliasPathCatalog = ReadonlyMap<
  string,
  readonly (readonly string[])[]
>;

/** Exact React imports admitted for identity-only `useMemo` projections. */
interface ReactMemoBindings {
  readonly direct: ReadonlySet<string>;
  readonly namespaces: ReadonlySet<string>;
}

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
          );
          if (usage === undefined) continue;
          const terminalKind =
            usage.collectionProperty ?? usage.stringProperty ?? (usage.called ? 'call' : 'value');
          usages.set(`${usage.names.join('.')}\0${terminalKind}`, usage);
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

/**
 * Resolves an inline object or one immutable object projected by the exact React `useMemo` import.
 * This admits a common typed-carrier pattern without treating arbitrary function calls as identity.
 */
function readForwardedObjectLiteral(
  argument: ts.Expression,
  declarations: readonly ts.VariableDeclaration[],
  bindingCounts: ReadonlyMap<string, number>,
  memoBindings: ReactMemoBindings,
): ts.ObjectLiteralExpression | undefined {
  let value = unwrapPreviewRuntimeExpression(argument);
  if (ts.isIdentifier(value)) {
    const bindingName = value.text;
    if (bindingCounts.get(bindingName) !== 1) return undefined;
    const declaration = declarations.find(
      (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === bindingName,
    );
    if (declaration?.initializer === undefined) return undefined;
    value = unwrapPreviewRuntimeExpression(declaration.initializer);
  }
  const memoValue = readReactMemoValue(value, memoBindings);
  if (memoValue !== undefined) value = unwrapPreviewRuntimeExpression(memoValue);
  return ts.isObjectLiteralExpression(value) ? value : undefined;
}

/** Reads one prototype-safe property whose value still has a hook-relative immutable origin. */
function readForwardedObjectProperty(
  property: ts.ObjectLiteralElementLike,
  aliases: PreviewRuntimeHookAliasPathCatalog,
  memoBindings: ReactMemoBindings,
): { readonly paths: readonly (readonly string[])[]; readonly propertyName: string } | undefined {
  if (ts.isShorthandPropertyAssignment(property)) {
    const paths = aliases.get(property.name.text);
    return paths === undefined ? undefined : { paths, propertyName: property.name.text };
  }
  if (!ts.isPropertyAssignment(property)) return undefined;
  const name = property.name;
  const propertyName =
    ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
      ? name.text
      : undefined;
  if (propertyName === undefined || BLOCKED_PROPERTY_NAMES.has(propertyName)) return undefined;
  const paths = readChoicePaths(property.initializer, aliases, memoBindings, 0);
  return paths.length === 0 ? undefined : { paths, propertyName };
}

/** Collects immutable declarations owned by the component while skipping callback internals. */
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

/** Counts simple bindings so repeated block-local names cannot be conflated by lexical analysis. */
function countBindingNames(
  declarations: readonly ts.VariableDeclaration[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const declaration of declarations) {
    appendBindingNameCounts(declaration.name, counts);
  }
  return counts;
}

/** Counts every identifier leaf so repeated block-local destructuring cannot be conflated. */
function appendBindingNameCounts(binding: ts.BindingName, counts: Map<string, number>): void {
  if (ts.isIdentifier(binding)) {
    counts.set(binding.text, (counts.get(binding.text) ?? 0) + 1);
    return;
  }
  for (const element of binding.elements) {
    if (!ts.isOmittedExpression(element)) appendBindingNameCounts(element.name, counts);
  }
}

/** Indexes only authored React imports that can prove the real `useMemo` identity helper. */
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
    const bindings = statement.importClause?.namedBindings;
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

/** Reads a synchronous identity-only callback result from the exact imported React `useMemo`. */
function readReactMemoValue(
  expression: ts.Expression,
  bindings: ReactMemoBindings,
): ts.Expression | undefined {
  if (!ts.isCallExpression(expression) || expression.questionDotToken !== undefined) {
    return undefined;
  }
  const callee = unwrapPreviewRuntimeExpression(expression.expression);
  const direct = ts.isIdentifier(callee) && bindings.direct.has(callee.text);
  const namespace =
    ts.isPropertyAccessExpression(callee) &&
    callee.questionDotToken === undefined &&
    callee.name.text === 'useMemo' &&
    ts.isIdentifier(unwrapPreviewRuntimeExpression(callee.expression)) &&
    bindings.namespaces.has(
      (unwrapPreviewRuntimeExpression(callee.expression) as ts.Identifier).text,
    );
  if (!direct && !namespace) return undefined;
  const callback = expression.arguments[0];
  if (callback === undefined) return undefined;
  const current = unwrapPreviewRuntimeExpression(callback);
  if (
    (!ts.isArrowFunction(current) && !ts.isFunctionExpression(current)) ||
    current.parameters.length !== 0 ||
    current.asteriskToken !== undefined ||
    current.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) === true
  ) {
    return undefined;
  }
  if (!ts.isBlock(current.body)) return current.body;
  const statement = current.body.statements.length === 1 ? current.body.statements[0] : undefined;
  return statement !== undefined && ts.isReturnStatement(statement)
    ? statement.expression
    : undefined;
}

/** Repeats a small fixed-point pass until every supported alias has its hook-relative origins. */
function propagateAliasPaths(
  rootName: string,
  owner: PreviewRuntimeFunction,
  declarations: readonly ts.VariableDeclaration[],
  bindingCounts: ReadonlyMap<string, number>,
  memoBindings: ReactMemoBindings,
): PreviewRuntimeHookAliasPathCatalog {
  const aliases = new Map<string, readonly (readonly string[])[]>([[rootName, [[]]]]);
  for (let pass = 0; pass < MAXIMUM_ALIAS_PASSES && aliases.size < MAXIMUM_ALIAS_COUNT; pass += 1) {
    let changed = false;
    for (const declaration of declarations) {
      if (declaration.initializer === undefined) continue;
      const paths = readChoicePaths(declaration.initializer, aliases, memoBindings, 0);
      if (paths.length === 0) continue;
      if (ts.isIdentifier(declaration.name)) {
        if (aliases.has(declaration.name.text) || bindingCounts.get(declaration.name.text) !== 1) {
          continue;
        }
        aliases.set(declaration.name.text, paths);
        changed = true;
      } else if (ts.isObjectBindingPattern(declaration.name)) {
        changed =
          appendObjectBindingAliasPaths(declaration.name, paths, aliases, bindingCounts, [], 0) ||
          changed;
      }
      if (aliases.size >= MAXIMUM_ALIAS_COUNT) break;
    }
    for (const [stateName, paths] of collectPreviewRuntimeHookStateAliases({
      aliases,
      owner,
      readOriginPaths: (expression) => readChoicePaths(expression, aliases, memoBindings, 0),
    })) {
      if (aliases.size >= MAXIMUM_ALIAS_COUNT) break;
      if (aliases.has(stateName) || bindingCounts.get(stateName) !== 1) continue;
      aliases.set(stateName, paths);
      changed = true;
    }
    if (!changed) break;
  }
  return aliases;
}

/** Adds supported object-binding leaves below an already resolved hook-relative carrier. */
function appendObjectBindingAliasPaths(
  pattern: ts.ObjectBindingPattern,
  basePaths: readonly (readonly string[])[],
  aliases: Map<string, readonly (readonly string[])[]>,
  bindingCounts: ReadonlyMap<string, number>,
  prefix: readonly string[],
  depth: number,
): boolean {
  if (depth > MAXIMUM_ALIAS_DEPTH || aliases.size >= MAXIMUM_ALIAS_COUNT) return false;
  let changed = false;
  for (const element of pattern.elements) {
    if (
      element.dotDotDotToken !== undefined ||
      element.initializer !== undefined ||
      aliases.size >= MAXIMUM_ALIAS_COUNT
    ) {
      continue;
    }
    const propertyName = readBindingPropertyName(element);
    if (propertyName === undefined) continue;
    const nextPrefix = [...prefix, propertyName];
    if (ts.isObjectBindingPattern(element.name)) {
      changed =
        appendObjectBindingAliasPaths(
          element.name,
          basePaths,
          aliases,
          bindingCounts,
          nextPrefix,
          depth + 1,
        ) || changed;
      continue;
    }
    if (
      !ts.isIdentifier(element.name) ||
      aliases.has(element.name.text) ||
      bindingCounts.get(element.name.text) !== 1
    ) {
      continue;
    }
    aliases.set(
      element.name.text,
      deduplicatePaths(basePaths.map((basePath) => [...basePath, ...nextPrefix])),
    );
    changed = true;
  }
  return changed;
}

/** Reads a non-computed, prototype-safe key from one object binding element. */
function readBindingPropertyName(element: ts.BindingElement): string | undefined {
  const property = element.propertyName;
  const name =
    property === undefined && ts.isIdentifier(element.name)
      ? element.name.text
      : property !== undefined &&
          (ts.isIdentifier(property) ||
            ts.isStringLiteral(property) ||
            ts.isNumericLiteral(property))
        ? property.text
        : undefined;
  return name === undefined || BLOCKED_PROPERTY_NAMES.has(name) ? undefined : name;
}

/** Resolves safe identity choices while retaining only paths rooted at an already-known alias. */
function readChoicePaths(
  expression: ts.Expression,
  aliases: PreviewRuntimeHookAliasPathCatalog,
  memoBindings: ReactMemoBindings,
  depth: number,
): readonly (readonly string[])[] {
  if (depth > MAXIMUM_ALIAS_DEPTH) return [];
  const value = unwrapPreviewRuntimeExpression(expression);
  if (ts.isBinaryExpression(value) && isValueChoiceOperator(value.operatorToken.kind)) {
    return deduplicatePaths([
      ...readChoicePaths(value.left, aliases, memoBindings, depth + 1),
      ...readChoicePaths(value.right, aliases, memoBindings, depth + 1),
    ]);
  }
  if (ts.isConditionalExpression(value)) {
    return deduplicatePaths([
      ...readChoicePaths(value.whenTrue, aliases, memoBindings, depth + 1),
      ...readChoicePaths(value.whenFalse, aliases, memoBindings, depth + 1),
    ]);
  }
  const memoValue = readReactMemoValue(value, memoBindings);
  if (memoValue !== undefined) {
    return readChoicePaths(memoValue, aliases, memoBindings, depth + 1);
  }
  const collectionCarrier = readCollectionIdentityCarrier(value);
  if (collectionCarrier !== undefined) {
    return readChoicePaths(collectionCarrier, aliases, memoBindings, depth + 1);
  }
  return readIdentityPaths(value, aliases);
}

/**
 * Peels only Array transforms that preserve every retained item's authored identity.
 *
 * This lets a local such as `const rows = useMemo(() => query.rows.filter(...), [query])`
 * continue carrying `query.rows` demand into imported JSX children. Mapping and arbitrary calls
 * remain opaque because their result item contract is not provably the receiver's contract.
 */
function readCollectionIdentityCarrier(expression: ts.Expression): ts.Expression | undefined {
  if (!ts.isCallExpression(expression) || expression.questionDotToken !== undefined) {
    return undefined;
  }
  const callee = unwrapPreviewRuntimeExpression(expression.expression);
  if (
    !ts.isPropertyAccessExpression(callee) ||
    callee.questionDotToken !== undefined ||
    !COLLECTION_IDENTITY_METHODS.has(callee.name.text)
  ) {
    return undefined;
  }
  return unwrapPreviewRuntimeExpression(callee.expression);
}

/** Resolves an identifier/property chain, allowing optional reads but rejecting computed keys. */
function readIdentityPaths(
  expression: ts.Expression,
  aliases: PreviewRuntimeHookAliasPathCatalog,
): readonly (readonly string[])[] {
  const suffix: string[] = [];
  let current = unwrapPreviewRuntimeExpression(expression);
  while (ts.isPropertyAccessExpression(current)) {
    if (BLOCKED_PROPERTY_NAMES.has(current.name.text)) return [];
    suffix.unshift(current.name.text);
    current = unwrapPreviewRuntimeExpression(current.expression);
  }
  if (!ts.isIdentifier(current)) return [];
  const prefixes = aliases.get(current.text) ?? [];
  return deduplicatePaths(prefixes.map((prefix) => [...prefix, ...suffix]));
}

/** Reads every hook-relative origin for one property access rooted at a propagated alias. */
function readAliasAccess(
  expression: ts.PropertyAccessExpression,
  aliases: PreviewRuntimeHookAliasPathCatalog,
): { readonly aliasName: string; readonly names: readonly (readonly string[])[] } | undefined {
  const suffix: string[] = [];
  let current: ts.Expression = expression;
  while (ts.isPropertyAccessExpression(current)) {
    if (BLOCKED_PROPERTY_NAMES.has(current.name.text)) return undefined;
    suffix.unshift(current.name.text);
    current = unwrapPreviewRuntimeExpression(current.expression);
  }
  if (!ts.isIdentifier(current)) return undefined;
  const prefixes = aliases.get(current.text);
  return prefixes === undefined
    ? undefined
    : {
        aliasName: current.text,
        names: prefixes.map((prefix) => [...prefix, ...suffix]),
      };
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

/** Converts one reached terminal into the collection/string/call shape used by serialization. */
function normalizeAliasUsage(
  expression: ts.PropertyAccessExpression,
  names: readonly string[],
  rootName: string,
  availableBeforePosition: number,
  provenCollectionPaths: ReadonlySet<string>,
): PreviewRuntimeHookAliasUsagePath | undefined {
  if (names.length === 0 || names.length > 12) return undefined;
  const terminal = names.at(-1);
  const called =
    ts.isCallExpression(expression.parent) && expression.parent.expression === expression;
  const smartCallable = called ? inferPreviewRuntimeHookCallableSmartValue(expression) : undefined;
  const receiverNames = names.slice(0, -1);
  const membershipItem = inferPreviewRuntimeHookMembershipItemFallback(
    expression,
    names.at(-2) ?? rootName,
    expression.getSourceFile(),
    provenCollectionPaths.has(receiverNames.join('.')),
  );
  const collection =
    isPreviewRuntimeHookArrayUsageProperty(terminal) || membershipItem !== undefined;
  const collectionLengthRequiresItem =
    terminal === 'length' &&
    inferPreviewRuntimeHookCollectionLengthGuardPassValue(expression) === true;
  const stringReceiver =
    called &&
    isPreviewRuntimeHookStringUsageProperty(terminal) &&
    inferPreviewRuntimeSemanticFallback(names.at(-2) ?? rootName)?.label !== 'generated object';
  const guardPass =
    !called && !collection && !stringReceiver
      ? inferPreviewRuntimeHookExpressionGuardPassFallback(expression, availableBeforePosition)
      : undefined;
  const mutableRef = isPreviewRuntimeHookMutableRefJsxValue(expression);
  const emptyRenderable = isPreviewRuntimeHookEmptyRenderableJsxValue(expression);
  const rendered = isPreviewRuntimeHookRenderedJsxValue(expression);
  const renderedFallback = rendered
    ? inferPreviewRuntimeSemanticFallback(terminal ?? '')
    : undefined;
  const renderedExpression = rendered
    ? renderedFallback?.kind === 'string' || renderedFallback?.kind === 'number'
      ? renderedFallback.expression
      : JSON.stringify(terminal ?? 'value')
    : undefined;
  return Object.freeze({
    called: !collection && !stringReceiver && called,
    ...(membershipItem === undefined && !collectionLengthRequiresItem
      ? {}
      : {
          collectionItemExpression:
            membershipItem?.expression ?? 'Object.freeze({ id: "preview-id", name: "name" })',
          collectionItemRequiredPaths: Object.freeze([
            ...(membershipItem?.requiredPaths ?? ['id', 'name']),
          ]),
        }),
    ...(collection && terminal !== undefined ? { collectionProperty: terminal } : {}),
    names: Object.freeze(collection || stringReceiver ? names.slice(0, -1) : [...names]),
    ...(guardPass === undefined
      ? {}
      : { renderGuard: true as const, valueExpression: guardPass.expression }),
    ...(mutableRef ? { valueExpression: '({ current: null })' } : {}),
    ...(emptyRenderable ? { valueExpression: 'null' } : {}),
    ...(renderedExpression === undefined || emptyRenderable
      ? {}
      : { valueExpression: renderedExpression }),
    ...(smartCallable === undefined
      ? {}
      : {
          smartValueExpression: smartCallable.expression,
          smartValueRole: smartCallable.role,
        }),
    ...(stringReceiver ? { stringProperty: terminal ?? '' } : {}),
  });
}

/**
 * Describes a callable result that can be explored without baking the result into its fallback.
 *
 * A generated hook method used as the direct predicate of an Array filter is an observable data
 * valve: a falsey no-op drops every generated row, while a truthy result retains the corridor for
 * downstream verification. The compiler emits both the neutral callable and this candidate role;
 * the browser-side residual chooses and learns from the observed invocation outcome.
 */
export function inferPreviewRuntimeHookCallableSmartValue(
  propertyAccess: ts.PropertyAccessExpression,
):
  | {
      readonly expression: 'true';
      readonly role: 'collection-filter-predicate';
    }
  | undefined {
  const call = propertyAccess.parent;
  if (!ts.isCallExpression(call) || call.expression !== propertyAccess) return undefined;
  const callback = findDirectCollectionFilterCallback(call);
  return callback === undefined
    ? undefined
    : Object.freeze({ expression: 'true', role: 'collection-filter-predicate' });
}

/** Finds the exact inline callback whose returned expression contains this generated call. */
function findDirectCollectionFilterCallback(
  expression: ts.Expression,
): ts.ArrowFunction | ts.FunctionExpression | undefined {
  let returned: ts.Node = expression;
  while (
    (ts.isParenthesizedExpression(returned.parent) ||
      ts.isAsExpression(returned.parent) ||
      ts.isTypeAssertionExpression(returned.parent) ||
      ts.isNonNullExpression(returned.parent) ||
      ts.isSatisfiesExpression(returned.parent)) &&
    returned.parent.expression === returned
  ) {
    returned = returned.parent;
  }
  let callback: ts.ArrowFunction | ts.FunctionExpression | undefined;
  if (
    (ts.isArrowFunction(returned.parent) || ts.isFunctionExpression(returned.parent)) &&
    returned.parent.body === returned
  ) {
    callback = returned.parent;
  } else if (ts.isReturnStatement(returned.parent) && returned.parent.expression === returned) {
    const block = returned.parent.parent;
    const owner = block.parent;
    if (
      ts.isBlock(block) &&
      block.statements.length === 1 &&
      (ts.isArrowFunction(owner) || ts.isFunctionExpression(owner)) &&
      owner.body === block
    ) {
      callback = owner;
    }
  }
  if (callback === undefined) return undefined;
  let callbackNode: ts.Node = callback;
  while (
    ts.isParenthesizedExpression(callbackNode.parent) &&
    callbackNode.parent.expression === callbackNode
  ) {
    callbackNode = callbackNode.parent;
  }
  const filterCall = callbackNode.parent;
  if (!ts.isCallExpression(filterCall)) return undefined;
  const callee = unwrapPreviewRuntimeExpression(filterCall.expression);
  const methodFilter =
    ts.isPropertyAccessExpression(callee) &&
    callee.questionDotToken === undefined &&
    callee.name.text === 'filter' &&
    filterCall.arguments[0] === callbackNode;
  const utilityFilter =
    ts.isIdentifier(callee) && callee.text === 'filter' && filterCall.arguments[1] === callbackNode;
  return methodFilter || utilityFilter ? callback : undefined;
}

/**
 * Collects exact hook-relative receivers already proven to be Arrays before interpreting
 * `includes`. The shared String methods `at`, `includes`, and `length` deliberately do not prove a
 * collection by themselves; an imported child Array contract may supply the same evidence.
 */
function collectAliasCollectionReceiverPaths(
  owner: PreviewRuntimeFunction,
  aliases: PreviewRuntimeHookAliasPathCatalog,
  externalPaths: ReadonlySet<string> | undefined,
): ReadonlySet<string> {
  const paths = new Set(externalPaths ?? []);
  const visit = (node: ts.Node): void => {
    if (node !== owner && isPreviewRuntimeFunction(node)) return;
    if (ts.isPropertyAccessExpression(node) && !ts.isPropertyAccessExpression(node.parent)) {
      const access = readAliasAccess(node, aliases);
      if (access !== undefined && COLLECTION_ONLY_USAGE_PROPERTIES.has(node.name.text)) {
        for (const names of access.names) {
          const receiverNames = names.slice(0, -1);
          if (receiverNames.length > 0) paths.add(receiverNames.join('.'));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  return paths;
}

/** Keeps only logical operators that select a value without executing application code. */
function isValueChoiceOperator(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.BarBarToken || kind === ts.SyntaxKind.QuestionQuestionToken;
}

/** Bounds and de-duplicates alternate hook-relative origins in stable source order. */
function deduplicatePaths(paths: readonly (readonly string[])[]): readonly (readonly string[])[] {
  const retained = new Map<string, readonly string[]>();
  for (const path of paths) {
    if (path.length > MAXIMUM_ALIAS_DEPTH) continue;
    const key = path.join('.');
    if (!retained.has(key)) retained.set(key, Object.freeze([...path]));
    if (retained.size >= MAXIMUM_CHOICE_PATHS) break;
  }
  return Object.freeze([...retained.values()]);
}

/** Rejects nested functions whose parameter shadows any alias tracked in the outer component. */
function functionShadowsTrackedAlias(
  scope: PreviewRuntimeFunction,
  aliasNames: ReadonlySet<string>,
): boolean {
  return scope.parameters.some(
    (parameter) => ts.isIdentifier(parameter.name) && aliasNames.has(parameter.name.text),
  );
}
