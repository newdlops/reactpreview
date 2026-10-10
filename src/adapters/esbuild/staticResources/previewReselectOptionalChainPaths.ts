/**
 * Reads optional member chains a Reselect projector applies to one selected input.
 *
 * State containers are seeded only from non-optional dereferences, so a selector that reads
 * `getCallBanReportResult?.dataAggregatedAt?.value` saw no value even when another selector had
 * already seeded `getCallBanReportResult`; the project's own fallback ('-' or -1) then reached the
 * screen as "Invalid DateTime" or "-1건". Each chain records the receiver of its first `?.`, so a
 * later pass can add the chain only where that receiver exists anyway, as component props do for
 * optional uses. The receiver of an array method call (`…?.infos.map(fn)`) is recorded as a
 * collection, because a container created for a sibling chain would otherwise turn that call into a
 * TypeError. Other method calls, computed or numeric keys, and nested callbacks are skipped.
 */
import ts from 'typescript';

/** One optional chain relative to the selected input value. */
export interface PreviewReselectOptionalChainPath {
  /** Property path from the selected input value to the chain's last member. */
  readonly path: readonly string[];
  /** Length of the path prefix that must already exist before the first optional member. */
  readonly receiverLength: number;
  /** The chain is the receiver of an array method call, so it must be a collection. */
  readonly collection?: true;
}

type ProjectorFunction = ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression;

const MAX_OPTIONAL_CHAINS = 64;
const MAX_CHAIN_DEPTH = 16;
const MAX_PROPERTY_NAME_LENGTH = 128;
const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const ARRAY_METHOD_NAMES = new Set([
  'every',
  'filter',
  'find',
  'findIndex',
  'flatMap',
  'forEach',
  'includes',
  'join',
  'map',
  'reduce',
  'slice',
  'some',
]);

/**
 * Collects optional chains rooted at one projector parameter or its destructured properties.
 *
 * @param projector Reselect result function.
 * @param parameter Parameter receiving the selected input value.
 * @returns Chains containing at least one `?.`, in source order and bounded in count.
 */
export function collectPreviewReselectOptionalChainPaths(
  projector: ProjectorFunction,
  parameter: ts.ParameterDeclaration,
): readonly PreviewReselectOptionalChainPath[] {
  const roots = new Map<string, readonly string[]>();
  collectBindingRoots(parameter.name, [], roots);
  const body = projector.body;
  if (roots.size === 0 || body === undefined) return [];
  const chains = new Map<string, PreviewReselectOptionalChainPath>();
  /** Visits the synchronous projector body; nested callbacks may run after selection. */
  const visit = (node: ts.Node): void => {
    if (chains.size >= MAX_OPTIONAL_CHAINS || (node !== body && ts.isFunctionLike(node))) return;
    if (isMemberAccess(node)) {
      const collection = isArrayMethodCallee(node);
      const chain = collection
        ? readOptionalChain(node.expression, roots)
        : isOutermostMemberAccess(node)
          ? readOptionalChain(node, roots)
          : undefined;
      if (chain !== undefined) {
        chains.set(chain.path.join('\0'), collection ? { ...chain, collection: true } : chain);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return [...chains.values()];
}

/** Maps a parameter name, or each destructured property name, to its path in the input value. */
function collectBindingRoots(
  binding: ts.BindingName,
  parentPath: readonly string[],
  roots: Map<string, readonly string[]>,
): void {
  if (ts.isIdentifier(binding)) {
    roots.set(binding.text, parentPath);
    return;
  }
  if (!ts.isObjectBindingPattern(binding) || parentPath.length >= MAX_CHAIN_DEPTH) return;
  for (const element of binding.elements) {
    if (element.dotDotDotToken !== undefined) continue;
    const property = element.propertyName ?? element.name;
    const name =
      ts.isIdentifier(property) || ts.isStringLiteral(property) ? property.text : undefined;
    if (name === undefined || !isSafePropertyName(name)) continue;
    collectBindingRoots(element.name, [...parentPath, name], roots);
  }
}

/** Narrows to dot or bracket member access. */
function isMemberAccess(
  node: ts.Node,
): node is ts.ElementAccessExpression | ts.PropertyAccessExpression {
  return ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
}

/** Accepts the last member of a chain that is read, not called. */
function isOutermostMemberAccess(
  node: ts.ElementAccessExpression | ts.PropertyAccessExpression,
): boolean {
  let current: ts.Node = node;
  while (ts.isParenthesizedExpression(current.parent) || ts.isNonNullExpression(current.parent)) {
    current = current.parent;
  }
  const parent = current.parent;
  if (isMemberAccess(parent) && parent.expression === current) return false;
  return !(ts.isCallExpression(parent) && parent.expression === current);
}

/** Recognizes `receiver.map(…)`-style calls whose receiver must be an array. */
function isArrayMethodCallee(
  node: ts.ElementAccessExpression | ts.PropertyAccessExpression,
): node is ts.PropertyAccessExpression {
  if (!ts.isPropertyAccessExpression(node) || !ARRAY_METHOD_NAMES.has(node.name.text)) return false;
  let current: ts.Node = node;
  while (ts.isParenthesizedExpression(current.parent) || ts.isNonNullExpression(current.parent)) {
    current = current.parent;
  }
  return ts.isCallExpression(current.parent) && current.parent.expression === current;
}

/** Reads one root-bound chain with at least one optional member and only safe string keys. */
function readOptionalChain(
  access: ts.Expression,
  roots: ReadonlyMap<string, readonly string[]>,
): PreviewReselectOptionalChainPath | undefined {
  const members: string[] = [];
  let firstOptional: number | undefined;
  let current = unwrapChainLink(access);
  while (isMemberAccess(current)) {
    const member = ts.isPropertyAccessExpression(current)
      ? current.name.text
      : ts.isStringLiteral(current.argumentExpression)
        ? current.argumentExpression.text
        : undefined;
    if (member === undefined || !isSafePropertyName(member)) return undefined;
    members.unshift(member);
    if (current.questionDotToken !== undefined) firstOptional = 0;
    else if (firstOptional !== undefined) firstOptional += 1;
    current = unwrapChainLink(current.expression);
  }
  if (firstOptional === undefined || !ts.isIdentifier(current)) return undefined;
  const root = roots.get(current.text);
  if (root === undefined || root.length + members.length > MAX_CHAIN_DEPTH) return undefined;
  // Members were read from the end; `firstOptional` counts the members before the optional one.
  return { path: [...root, ...members], receiverLength: root.length + firstOptional };
}

/** Skips parentheses and non-null assertions between two links of a member chain. */
function unwrapChainLink(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current)) {
    current = current.expression;
  }
  return current;
}

/** Rejects empty, oversized, and prototype-bearing property names. */
function isSafePropertyName(name: string): boolean {
  return (
    name.length > 0 && name.length <= MAX_PROPERTY_NAME_LENGTH && !BLOCKED_PROPERTY_NAMES.has(name)
  );
}
