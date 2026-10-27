/** Merges bounded Context scalar, callable, and collection shape requirements. */
import ts from 'typescript';
import { createPreviewRuntimeCallableFallbackExpression } from './previewRuntimeCallableFallback';
import type { PreviewRuntimeHookImportedHelperItemFallback } from './previewRuntimeHookAliasUsage';
import { inferPreviewRuntimeHookAssignmentGuardPassFallback } from './previewRuntimeHookGuardValue';
import {
  createPreviewGeneratedListExpression,
  mergePreviewRuntimeHookCollectionItemExpressions,
} from './previewRuntimeHookUsageTree';
import {
  BLOCKED_PROPERTY_NAMES,
  type FallbackShape,
  type HookFallbackPlan,
  MAX_FALLBACK_PATHS,
  MAX_PATH_DEPTH,
  MAX_PROPERTY_NAME_LENGTH,
  MAX_VALUE_CHOICE_PATHS,
} from './reactContextFallbackModel';

/**
 * Retains an owner-guard scalar only for an exact simple-assignment RHS; ignored and returned
 * results retain the established no-op callable. Every other result consumer fails closed.
 */
export function readCallableResultExpression(
  call: ts.CallExpression,
  plan: HookFallbackPlan,
): string | false | null | undefined {
  const parent = call.parent;
  if (
    ts.isExpressionStatement(parent) ||
    (ts.isReturnStatement(parent) && parent.expression === call)
  ) {
    return undefined;
  }
  if (
    ts.isBinaryExpression(parent) &&
    parent.right === call &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    return (
      inferPreviewRuntimeHookAssignmentGuardPassFallback(parent.left, plan.candidate.owner)
        ?.expression ?? false
    );
  }
  return null;
}

/** Detects assignment, mutation, or deletion against a derived frozen fallback property. */
export function isWriteTarget(expression: ts.PropertyAccessExpression): boolean {
  const parent = expression.parent;
  if (
    ts.isBinaryExpression(parent) &&
    parent.left === expression &&
    parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  ) {
    return true;
  }
  return (
    ts.isPrefixUnaryExpression(parent) ||
    ts.isPostfixUnaryExpression(parent) ||
    (ts.isDeleteExpression(parent) && parent.expression === expression)
  );
}

/** Adds every non-leaf prefix because JavaScript must dereference each as an object. */
export function addProperObjectPrefixes(path_: readonly string[], plan: HookFallbackPlan): boolean {
  for (let length = 1; length < path_.length; length += 1) {
    if (!addObjectContainer(path_.slice(0, length), plan)) return false;
  }
  return true;
}

/** Adds or verifies one prototype-safe plain object path in the candidate fallback tree. */
export function addObjectContainer(path_: readonly string[], plan: HookFallbackPlan): boolean {
  plan.required = true;
  if (!isSafePath(path_) || !reserveShapePath(path_, 'object', plan)) return false;
  let node = plan.shape;
  for (const propertyName of path_) {
    if (node.kind !== 'object') return false;
    let child = node.children.get(propertyName);
    if (child === undefined) {
      child = { children: new Map(), kind: 'object' };
      node.children.set(propertyName, child);
    } else if (child.kind !== 'object') {
      return false;
    }
    node = child;
  }
  return true;
}

/** Adds one frozen empty-array leaf when syntax proves a collection receiver or transfer. */
export function addCollectionLeaf(
  path_: readonly string[],
  plan: HookFallbackPlan,
  item?: PreviewRuntimeHookImportedHelperItemFallback,
  retainExactItem = false,
): boolean {
  if (path_.length === 0 || !isSafePath(path_) || !reserveShapePath(path_, 'collection', plan)) {
    return false;
  }
  let node = plan.shape;
  for (let index = 0; index < path_.length; index += 1) {
    const propertyName = path_[index];
    if (propertyName === undefined || node.kind !== 'object') return false;
    const terminal = index === path_.length - 1;
    let child = node.children.get(propertyName);
    if (terminal) {
      if (child === undefined) {
        child = {
          children: new Map(),
          kind: 'collection',
          ...(item === undefined
            ? {}
            : {
                collectionItemExpression: item.expression,
                collectionItemRequiredPaths: Object.freeze([...(item.requiredPaths ?? [])]),
              }),
          ...(retainExactItem && item !== undefined
            ? { collectionExactItemExpressions: [item.expression] }
            : {}),
        };
        node.children.set(propertyName, child);
      }
      if (child.kind !== 'collection' || child.children.size !== 0) return false;
      if (retainExactItem && item !== undefined) {
        const expressions = child.collectionExactItemExpressions ?? [];
        if (!expressions.includes(item.expression) && expressions.length < MAX_VALUE_CHOICE_PATHS) {
          expressions.push(item.expression);
        }
        child.collectionExactItemExpressions = expressions;
      }
      if (item !== undefined) {
        child.collectionItemExpression =
          mergePreviewRuntimeHookCollectionItemExpressions(
            child.collectionItemExpression,
            item.expression,
          ) ?? item.expression;
        child.collectionItemRequiredPaths = Object.freeze([
          ...new Set([...(child.collectionItemRequiredPaths ?? []), ...(item.requiredPaths ?? [])]),
        ]);
      }
      return true;
    }
    if (child === undefined) {
      child = { children: new Map(), kind: 'object' };
      node.children.set(propertyName, child);
    } else if (child.kind !== 'object') {
      return false;
    }
    node = child;
  }
  return false;
}

/** Adds one frozen no-op function leaf while rejecting object/callable shape conflicts. */
export function addCallableLeaf(
  path_: readonly string[],
  plan: HookFallbackPlan,
  callResultExpression?: string,
): boolean {
  if (path_.length === 0 || !isSafePath(path_) || !reserveShapePath(path_, 'callable', plan)) {
    return false;
  }
  let node = plan.shape;
  for (let index = 0; index < path_.length; index += 1) {
    const propertyName = path_[index];
    if (propertyName === undefined || node.kind !== 'object') return false;
    const terminal = index === path_.length - 1;
    let child = node.children.get(propertyName);
    if (terminal) {
      if (child === undefined) {
        child = {
          children: new Map(),
          kind: 'callable',
          ...(callResultExpression === undefined ? {} : { callResultExpression }),
        };
        node.children.set(propertyName, child);
      }
      return (
        child.kind === 'callable' &&
        child.children.size === 0 &&
        child.callResultExpression === callResultExpression
      );
    }
    if (child === undefined) {
      child = { children: new Map(), kind: 'object' };
      node.children.set(propertyName, child);
    } else if (child.kind !== 'object') {
      return false;
    }
    node = child;
  }
  return false;
}

/** Adds one bounded semantic scalar leaf while rejecting object/callable shape conflicts. */
export function addScalarLeaf(
  path_: readonly string[],
  scalarExpression: string,
  plan: HookFallbackPlan,
): boolean {
  if (path_.length === 0 || !isSafePath(path_) || !reserveShapePath(path_, 'scalar', plan)) {
    return false;
  }
  let node = plan.shape;
  for (let index = 0; index < path_.length; index += 1) {
    const propertyName = path_[index];
    if (propertyName === undefined || node.kind !== 'object') return false;
    const terminal = index === path_.length - 1;
    let child = node.children.get(propertyName);
    if (terminal) {
      if (child === undefined) {
        child = { children: new Map(), kind: 'scalar', scalarExpression };
        node.children.set(propertyName, child);
      }
      return (
        child.kind === 'scalar' &&
        child.children.size === 0 &&
        child.scalarExpression === scalarExpression
      );
    }
    if (child === undefined) {
      child = { children: new Map(), kind: 'object' };
      node.children.set(propertyName, child);
    } else if (child.kind !== 'object') {
      return false;
    }
    node = child;
  }
  return false;
}

/** Enforces a shared path budget while detecting object/callable evidence conflicts. */
export function reserveShapePath(
  path_: readonly string[],
  kind: FallbackShape['kind'],
  plan: HookFallbackPlan,
): boolean {
  const identity = `${path_.join('\0')}\0${kind}`;
  for (const otherKind of ['callable', 'collection', 'object', 'scalar'] as const) {
    if (otherKind !== kind && plan.shapePaths.has(`${path_.join('\0')}\0${otherKind}`)) {
      return false;
    }
  }
  if (plan.shapePaths.has(identity)) return true;
  if (plan.shapePaths.size >= MAX_FALLBACK_PATHS) return false;
  plan.shapePaths.add(identity);
  return true;
}

/** Validates path depth, segment length, and prototype-pollution sensitive names. */
export function isSafePath(path_: readonly string[]): boolean {
  return path_.length <= MAX_PATH_DEPTH && path_.every(isSafePropertyName);
}

/** Narrows an unknown property name to the bounded safe key contract. */
export function isSafePropertyName(propertyName: string | undefined): propertyName is string {
  return (
    propertyName !== undefined &&
    propertyName.length > 0 &&
    propertyName.length <= MAX_PROPERTY_NAME_LENGTH &&
    !BLOCKED_PROPERTY_NAMES.has(propertyName)
  );
}

/** Serializes a deterministic deeply frozen plain object and frozen no-op callable leaves. */
export function serializeFallbackShape(shape: FallbackShape): string {
  if (shape.kind === 'callable') {
    return createPreviewRuntimeCallableFallbackExpression(shape.callResultExpression);
  }
  if (shape.kind === 'collection') {
    const exactItemExpressions = shape.collectionExactItemExpressions;
    if (exactItemExpressions !== undefined && exactItemExpressions.length > 0) {
      return `Object.freeze([${exactItemExpressions.join(', ')}])`;
    }
    return shape.collectionItemExpression === undefined
      ? 'Object.freeze([])'
      : createPreviewGeneratedListExpression(shape.collectionItemExpression);
  }
  if (shape.kind === 'scalar') return shape.scalarExpression ?? 'undefined';
  const properties = [...shape.children]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([propertyName, child]) =>
        `${JSON.stringify(propertyName)}: ${serializeFallbackShape(child)}`,
    );
  return `Object.freeze({${properties.length === 0 ? '' : ` ${properties.join(', ')} `}})`;
}

/** Serializes the same syntax proof as runtime merge paths without exposing internal shape kinds. */
export function collectFallbackRequiredPaths(
  shape: FallbackShape,
  path_: readonly string[] = [],
): readonly string[] {
  if (shape.kind === 'callable') {
    return path_.length === 0 ? ['<root>()'] : [`${path_.join('.')}()`];
  }
  if (shape.kind === 'collection') {
    const base = path_.length === 0 ? '[]' : `${path_.join('.')}.[]`;
    return [
      ...new Set([
        base,
        ...(shape.collectionItemRequiredPaths ?? []).map((itemPath) =>
          itemPath === '<root>' ? base : `${base}.${itemPath}`,
        ),
      ]),
    ];
  }
  if (shape.kind === 'scalar') {
    return path_.length === 0 ? ['<root>'] : [path_.join('.')];
  }
  if (shape.children.size === 0) {
    return path_.length === 0 ? ['<root>'] : [path_.join('.')];
  }
  return [...shape.children]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([propertyName, child]) =>
      collectFallbackRequiredPaths(child, [...path_, propertyName]),
    );
}
