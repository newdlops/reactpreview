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
import { inferPreviewRuntimeSemanticFallback } from './previewRuntimeHookSemantics';

const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const MAXIMUM_ALIAS_COUNT = 32;
const MAXIMUM_ALIAS_DEPTH = 8;
const MAXIMUM_ALIAS_PASSES = 8;
const MAXIMUM_CHOICE_PATHS = 4;
const MAXIMUM_USAGE_PATHS = 64;

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
  /** String-only method proving the preceding leaf should be generated as text. */
  readonly stringProperty?: string;
  /** Side-effect-free scalar expression proven by a reached child component's render contract. */
  readonly valueExpression?: string;
}

/** One local alias may originate from a small logical or conditional choice. */
type AliasPathCatalog = ReadonlyMap<string, readonly (readonly string[])[]>;

/**
 * Returns required paths observed below immutable aliases of one hook-bound identifier.
 *
 * Only simple `const` identifiers, property access, `||`, `??`, and ternary value choices are
 * admitted. Calls, assignments, computed keys, defaults, and mutable bindings stop propagation.
 */
export function readPreviewRuntimeHookAliasUsagePaths(
  identifier: ts.Identifier,
  owner: PreviewRuntimeFunction,
): readonly PreviewRuntimeHookAliasUsagePath[] {
  const declarations = collectOwnerConstDeclarations(owner);
  const bindingCounts = countSimpleBindingNames(declarations);
  const aliases = propagateAliasPaths(identifier.text, declarations, bindingCounts);
  if (aliases.size <= 1) return [];

  const usages = new Map<string, PreviewRuntimeHookAliasUsagePath>();
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
    if (ts.isPropertyAccessExpression(node) && !ts.isPropertyAccessExpression(node.parent)) {
      const access = readAliasAccess(node, aliases);
      if (access !== undefined && access.aliasName !== identifier.text) {
        for (const names of access.names) {
          const usage = normalizeAliasUsage(node, names, identifier.text);
          if (usage === undefined) continue;
          const terminalKind =
            usage.collectionProperty ?? usage.stringProperty ?? (usage.called ? 'call' : 'value');
          usages.set(`${usage.names.join('.')}\0${terminalKind}`, usage);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  return Object.freeze([...usages.values()]);
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
function countSimpleBindingNames(
  declarations: readonly ts.VariableDeclaration[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const declaration of declarations) {
    if (!ts.isIdentifier(declaration.name)) continue;
    counts.set(declaration.name.text, (counts.get(declaration.name.text) ?? 0) + 1);
  }
  return counts;
}

/** Repeats a small fixed-point pass until every supported alias has its hook-relative origins. */
function propagateAliasPaths(
  rootName: string,
  declarations: readonly ts.VariableDeclaration[],
  bindingCounts: ReadonlyMap<string, number>,
): AliasPathCatalog {
  const aliases = new Map<string, readonly (readonly string[])[]>([[rootName, [[]]]]);
  for (let pass = 0; pass < MAXIMUM_ALIAS_PASSES && aliases.size < MAXIMUM_ALIAS_COUNT; pass += 1) {
    let changed = false;
    for (const declaration of declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.initializer === undefined ||
        aliases.has(declaration.name.text) ||
        bindingCounts.get(declaration.name.text) !== 1
      ) {
        continue;
      }
      const paths = readChoicePaths(declaration.initializer, aliases, 0);
      if (paths.length === 0) continue;
      aliases.set(declaration.name.text, paths);
      changed = true;
      if (aliases.size >= MAXIMUM_ALIAS_COUNT) break;
    }
    if (!changed) break;
  }
  return aliases;
}

/** Resolves safe identity choices while retaining only paths rooted at an already-known alias. */
function readChoicePaths(
  expression: ts.Expression,
  aliases: AliasPathCatalog,
  depth: number,
): readonly (readonly string[])[] {
  if (depth > MAXIMUM_ALIAS_DEPTH) return [];
  const value = unwrapPreviewRuntimeExpression(expression);
  if (ts.isBinaryExpression(value) && isValueChoiceOperator(value.operatorToken.kind)) {
    return deduplicatePaths([
      ...readChoicePaths(value.left, aliases, depth + 1),
      ...readChoicePaths(value.right, aliases, depth + 1),
    ]);
  }
  if (ts.isConditionalExpression(value)) {
    return deduplicatePaths([
      ...readChoicePaths(value.whenTrue, aliases, depth + 1),
      ...readChoicePaths(value.whenFalse, aliases, depth + 1),
    ]);
  }
  return readIdentityPaths(value, aliases);
}

/** Resolves an identifier/property chain, allowing optional reads but rejecting computed keys. */
function readIdentityPaths(
  expression: ts.Expression,
  aliases: AliasPathCatalog,
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
  aliases: AliasPathCatalog,
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

/** Converts one reached terminal into the collection/string/call shape used by serialization. */
function normalizeAliasUsage(
  expression: ts.PropertyAccessExpression,
  names: readonly string[],
  rootName: string,
): PreviewRuntimeHookAliasUsagePath | undefined {
  if (names.length === 0 || names.length > 12) return undefined;
  const terminal = names.at(-1);
  const called =
    ts.isCallExpression(expression.parent) && expression.parent.expression === expression;
  const collection = isPreviewRuntimeHookArrayUsageProperty(terminal);
  const stringReceiver =
    called &&
    isPreviewRuntimeHookStringUsageProperty(terminal) &&
    inferPreviewRuntimeSemanticFallback(names.at(-2) ?? rootName)?.label !== 'generated object';
  return Object.freeze({
    called: !collection && !stringReceiver && called,
    ...(collection && terminal !== undefined ? { collectionProperty: terminal } : {}),
    names: Object.freeze(collection || stringReceiver ? names.slice(0, -1) : [...names]),
    ...(stringReceiver ? { stringProperty: terminal ?? '' } : {}),
  });
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
