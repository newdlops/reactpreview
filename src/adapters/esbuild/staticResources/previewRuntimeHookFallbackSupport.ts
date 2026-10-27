/** Builds callback and direct-property fallback requirements and semantic demand metadata. */
import ts from 'typescript';
import type {
  PreviewRuntimeHookBinding,
  PreviewRuntimeHookCandidate,
  PreviewRuntimeHookFallback,
  PreviewRuntimeHookSemanticValueDemand,
  PreviewRuntimeHookSmartPathValueExpression,
  PreviewRuntimeHookValueFallback,
} from './previewRuntimeHookModel';
import { shouldMaterializePreviewRuntimeHookNestedFallback } from './previewRuntimeHookPropertyUsage';
import {
  findNearestPreviewRuntimeFunction as findNearestRuntimeFunction,
  isPreviewRuntimeFunction as isRuntimeFunction,
  readPreviewRuntimeFunctionName,
  unwrapPreviewRuntimeExpression as unwrapExpression,
} from './previewRuntimeHookSyntax';
import { PREVIEW_RUNTIME_STORAGE_READ_MODULE } from './previewRuntimeStorageRead';

/**
 * Preserves a lower-case hook/facade wrapper's return so its instrumented caller can supply shape.
 * React components conventionally begin with an uppercase name; their direct rendered hook result
 * continues through the existing empty-render branch instead of being classified as delegation.
 */
export function isPreviewRuntimeDirectHookWrapperReturn(expression: ts.Expression): boolean {
  const owner = findNearestRuntimeFunction(expression);
  const ownerName = readPreviewRuntimeFunctionName(owner);
  if (owner === undefined || ownerName === undefined || /^[A-Z]/u.test(ownerName)) return false;
  if (ts.isArrowFunction(owner) && !ts.isBlock(owner.body)) {
    return unwrapExpression(owner.body) === expression;
  }
  const parent = expression.parent;
  return ts.isReturnStatement(parent) && parent.expression === expression;
}

/**
 * Preserves an authored callback when a callback-wrapper hook is unavailable in a projected module.
 *
 * Hooks such as `useEventCallback(() => ++key.current)` return a stable callable rather than a
 * no-op. Losing its return value can corrupt registration identities before any UI mounts. Returning
 * the callback itself retains the exact closure and defers execution to the same consumer call site;
 * no project code is invoked while the fallback is created.
 */
export function createPreviewRuntimeHookCallbackIdentityFallback(
  call: ts.CallExpression,
  hook: PreviewRuntimeHookBinding,
  sourceFile: ts.SourceFile,
  sourceText: string,
): PreviewRuntimeHookFallback | undefined {
  if (!/(?:Callback|EventHandler)$/u.test(hook.hookName)) return undefined;
  const argument = call.arguments[0];
  if (argument === undefined || ts.isSpreadElement(argument)) return undefined;
  const callback = unwrapExpression(argument);
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return undefined;
  const originalCallback = sourceText.slice(argument.getStart(sourceFile), argument.end);
  return {
    evidence: 'authored callback passed to a callback-preserving hook',
    expression: `Object.freeze(${originalCallback})`,
    label: 'authored callback identity',
    requiredPaths: ['<root>()'],
  };
}

/**
 * Keeps an authored empty collection neutral when the same hook value crosses an opaque helper.
 *
 * Local JSX evidence can prove an item shape such as `{ id, role }`, but a package helper may
 * require additional fields that syntax-only analysis cannot see. Populating that collection would
 * replace a valid empty branch with an invalid synthetic item. The empty Array still satisfies the
 * destructuring/container contract and lets the opaque helper observe the hook's safest value.
 */
export function createPreviewRuntimeHookProjectionSafeFallback(
  fallback: PreviewRuntimeHookValueFallback,
): PreviewRuntimeHookValueFallback {
  if (fallback.neutralCollectionOnOpaqueCall !== true) {
    return fallback;
  }
  return {
    ...fallback,
    expression: 'Object.freeze([])',
    failurePaths: [],
    renderGuardPaths: [],
    requiredPaths: ['<root>'],
    smartPathValueExpressions: [],
  };
}

/** Keeps a child's failure shape available when its containing hook result must be synthesized. */
export function readNestedPreviewRuntimeHookExpression(
  fallback: PreviewRuntimeHookValueFallback | undefined,
  propertyName: string,
): string {
  return shouldMaterializePreviewRuntimeHookNestedFallback(fallback, propertyName)
    ? (fallback?.expression ?? 'undefined')
    : 'undefined';
}

/** Prefixes child demand paths while keeping a root requirement readable in Inspector diagnostics. */
export function prefixPreviewRuntimeHookPaths(
  paths: readonly string[] | undefined,
  propertyName: string,
): readonly string[] {
  /*
   * `undefined` means the child supplied no usage analysis, so destructuring itself is the only
   * proof that the property must exist. An empty array is different: the child was analyzed and
   * every downstream read was optional. Reintroducing the property in that case turns safe code
   * such as `data?.pages` into `{ data: {} }`, bypasses the authored short circuit, and lets a later
   * collection call fail. Keep the child absent until a non-optional descendant proves demand.
   */
  if (paths === undefined) return [propertyName];
  if (paths.length === 0) return [];
  return paths.map((path_) => {
    if (path_ === '<root>') return propertyName;
    if (path_ === '<root>()') return `${propertyName}()`;
    return `${propertyName}.${path_}`;
  });
}

/** Prefixes target-only Smart values through one tuple/object destructuring segment. */
export function prefixPreviewRuntimeHookSmartPathValues(
  values: readonly PreviewRuntimeHookSmartPathValueExpression[],
  propertyName: string,
): readonly PreviewRuntimeHookSmartPathValueExpression[] {
  return values.map((value) =>
    Object.freeze({
      expression: value.expression,
      path: value.path === '<root>' ? propertyName : `${propertyName}.${value.path}`,
      ...(value.deterministicRank === undefined
        ? {}
        : { deterministicRank: value.deterministicRank }),
      ...(value.role === undefined ? {} : { role: value.role }),
    }),
  );
}

/** Counts parameter and local names below one nested function without traversing another scope. */
export function forEachBindingInRuntimeFunction(
  scope: ReturnType<typeof findNearestRuntimeFunction>,
  consume: (binding: ts.BindingName) => void,
): void {
  if (scope === undefined) return;
  for (const parameter of scope.parameters) consume(parameter.name);
  const visit = (node: ts.Node): void => {
    if (node !== scope && isRuntimeFunction(node)) return;
    if (ts.isVariableDeclaration(node)) consume(node.name);
    ts.forEachChild(node, visit);
  };
  visit(scope);
}

/**
 * Turns a literal identity-field argument into bounded cross-hook value evidence.
 *
 * This is deliberately package agnostic: any admitted hook whose locally proven result exposes a
 * value leaf can carry the evidence. A literal field name ending in an `id`/`uuid` token is enough
 * to distinguish an identity reference from ordinary free text without retaining the field name in
 * runtime model state.
 */
export function inferPreviewRuntimeHookSemanticValueDemand(
  call: ts.CallExpression,
  fallback: PreviewRuntimeHookFallback,
): PreviewRuntimeHookSemanticValueDemand | undefined {
  const argument = call.arguments[0];
  if (argument === undefined) return undefined;
  const expression = unwrapExpression(argument);
  let fieldName: string | undefined;
  if (ts.isStringLiteralLike(expression)) {
    fieldName = expression.text;
  } else if (ts.isObjectLiteralExpression(expression)) {
    for (const property of expression.properties) {
      if (!ts.isPropertyAssignment(property)) {
        continue;
      }
      const propertyName =
        ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)
          ? property.name.text
          : undefined;
      if (propertyName !== 'name') continue;
      const initializer = unwrapExpression(property.initializer);
      if (ts.isStringLiteralLike(initializer)) fieldName = initializer.text;
      break;
    }
  }
  if (fieldName === undefined || !hasPreviewRuntimeIdentityFieldSuffix(fieldName)) {
    return undefined;
  }
  const valuePath = (fallback.requiredPaths ?? []).find((rawPath) => {
    const pathWithoutCall = rawPath.endsWith('()') ? rawPath.slice(0, -2) : rawPath;
    const segments = pathWithoutCall
      .replace(/\[(\d*)\]/gu, (_match, index: string) => '.' + (index.length === 0 ? '0' : index))
      .split('.')
      .filter(Boolean);
    return segments.at(-1) === 'value';
  });
  return valuePath === undefined ? undefined : { kind: 'identity', path: valuePath };
}

/** Requires an actual identifier token so words such as `valid` are not misclassified. */
export function hasPreviewRuntimeIdentityFieldSuffix(fieldName: string): boolean {
  const tokens = fieldName
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .split(/[^A-Za-z0-9]+/gu)
    .filter(Boolean)
    .map((token) => token.toLowerCase());
  return tokens.at(-1) === 'id' || tokens.at(-1) === 'uuid';
}

/**
 * Uses the raw Context as the identity carrier for direct React useContext reads. Other hooks keep
 * their exact imported function identity. Only an identifier argument is repeated in the thunk.
 */
export function readPreviewRuntimeHookIdentityExpression(
  candidate: PreviewRuntimeHookCandidate,
  sourceFile: ts.SourceFile,
  sourceText: string,
): string {
  // Every storage parse calls the same JSON.parse; sharing state by that identity would mix keys.
  if (candidate.hook.moduleSpecifier === PREVIEW_RUNTIME_STORAGE_READ_MODULE) return 'undefined';
  const contextArgument = candidate.call.arguments[0];
  if (
    candidate.hook.moduleSpecifier === 'react' &&
    candidate.hook.hookName === 'useContext' &&
    candidate.call.arguments.length === 1 &&
    contextArgument !== undefined &&
    !ts.isSpreadElement(contextArgument) &&
    ts.isIdentifier(unwrapExpression(contextArgument))
  ) {
    return sourceText.slice(contextArgument.getStart(sourceFile), contextArgument.end);
  }
  return sourceText.slice(
    candidate.call.expression.getStart(sourceFile),
    candidate.call.expression.end,
  );
}
