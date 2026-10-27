/** Propagates authored const, destructuring, memo, and collection identity aliases. */
import ts from 'typescript';
import {
  BLOCKED_PROPERTY_NAMES,
  COLLECTION_IDENTITY_METHODS,
  COLLECTION_ONLY_USAGE_PROPERTIES,
  MAXIMUM_ALIAS_COUNT,
  MAXIMUM_ALIAS_DEPTH,
  MAXIMUM_ALIAS_PASSES,
  deduplicatePaths,
  isValueChoiceOperator,
  type PreviewRuntimeHookAliasPathCatalog,
  type ReactMemoBindings,
} from './previewRuntimeHookAliasModel';
import { collectPreviewRuntimeHookStateAliases } from './previewRuntimeHookStateAlias';
import {
  isPreviewRuntimeFunction,
  unwrapPreviewRuntimeExpression,
  type PreviewRuntimeFunction,
} from './previewRuntimeHookSyntax';

/** Parser identity owns these read-only facts; dropping a tree also releases its inventories. */
const declarationsByOwner = new WeakMap<
  PreviewRuntimeFunction,
  readonly ts.VariableDeclaration[]
>();
const memoBindingsBySourceFile = new WeakMap<ts.SourceFile, ReactMemoBindings>();

/**
 * Resolves an inline object or one immutable object projected by the exact React `useMemo` import.
 * This admits a common typed-carrier pattern without treating arbitrary function calls as identity.
 */
export function readForwardedObjectLiteral(
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
export function readForwardedObjectProperty(
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

/** Reuses immutable owner declarations, preserving source order and skipped callback internals. */
export function collectOwnerConstDeclarations(
  owner: PreviewRuntimeFunction,
): readonly ts.VariableDeclaration[] {
  const retained = declarationsByOwner.get(owner);
  if (retained !== undefined) return retained;
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
  const result = Object.freeze(declarations);
  declarationsByOwner.set(owner, result);
  return result;
}

/** Counts simple bindings so repeated block-local names cannot be conflated by lexical analysis. */
export function countBindingNames(
  declarations: readonly ts.VariableDeclaration[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const declaration of declarations) {
    appendBindingNameCounts(declaration.name, counts);
  }
  return counts;
}

/** Counts every identifier leaf so repeated block-local destructuring cannot be conflated. */
export function appendBindingNameCounts(
  binding: ts.BindingName,
  counts: Map<string, number>,
): void {
  if (ts.isIdentifier(binding)) {
    counts.set(binding.text, (counts.get(binding.text) ?? 0) + 1);
    return;
  }
  for (const element of binding.elements) {
    if (!ts.isOmittedExpression(element)) appendBindingNameCounts(element.name, counts);
  }
}

/** Indexes only authored React imports that can prove the real `useMemo` identity helper. */
export function collectReactMemoBindings(sourceFile: ts.SourceFile): ReactMemoBindings {
  const retained = memoBindingsBySourceFile.get(sourceFile);
  if (retained !== undefined) return retained;
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
  const result = { direct, namespaces };
  memoBindingsBySourceFile.set(sourceFile, result);
  return result;
}

/** Reads a synchronous identity-only callback result from the exact imported React `useMemo`. */
export function readReactMemoValue(
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
export function propagateAliasPaths(
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
export function appendObjectBindingAliasPaths(
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
export function readBindingPropertyName(element: ts.BindingElement): string | undefined {
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
export function readChoicePaths(
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
export function readCollectionIdentityCarrier(
  expression: ts.Expression,
): ts.Expression | undefined {
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
export function readIdentityPaths(
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
export function readAliasAccess(
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

/**
 * Collects exact hook-relative receivers already proven to be Arrays before interpreting
 * `includes`. The shared String methods `at`, `includes`, and `length` deliberately do not prove a
 * collection by themselves; an imported child Array contract may supply the same evidence.
 */
export function collectAliasCollectionReceiverPaths(
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
