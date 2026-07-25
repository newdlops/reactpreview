/**
 * Extends one generated collection item with demand proven by same-file helper calls.
 *
 * Collection callbacks frequently delegate their real field reads to a small local formatter,
 * route builder, or permission helper. Looking only at the callback body then produces an item such
 * as `{ id }` even though the helper immediately reads `item.my.role`. This module follows only
 * direct identifier arguments into uniquely declared same-file functions. It never resolves imports
 * or executes code, and fixed traversal limits keep large modules inexpensive.
 */
import ts from 'typescript';
import { unwrapPreviewRuntimeExpression } from './previewRuntimeHookSyntax';

/** Minimal structural fallback contract shared with the hook instrumentation coordinator. */
export interface PreviewRuntimeLocalHelperItemFallback {
  /** Side-effect-free JavaScript expression emitted into the preview bundle. */
  readonly expression: string;
  /** Human-readable description shown for generated data. */
  readonly label: string;
  /** Property paths relative to the collection item that are required during rendering. */
  readonly requiredPaths?: readonly string[];
}

/** Callback used to reuse the coordinator's existing binding-demand analyzer. */
export type CreatePreviewRuntimeLocalHelperBindingFallback = (
  binding: ts.BindingName,
  sourceFile: ts.SourceFile,
) => PreviewRuntimeLocalHelperItemFallback | undefined;

type RuntimeFunction = ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression;

interface HelperParameterDemand {
  readonly owner: RuntimeFunction;
  readonly parameter: ts.ParameterDeclaration;
}

const MAX_LOCAL_HELPER_STATES = 16;

/**
 * Infers an array callback item and follows exact item arguments into local helper parameters.
 *
 * Multiple object-shaped candidates are shallowly combined. Each candidate already contains its
 * own recursively materialized nested branches, while top-level combination preserves direct
 * callback fields beside helper-only fields. Richer candidates are applied last deterministically.
 */
export function inferPreviewRuntimeLocalHelperArrayItemFallback(
  propertyAccess: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
  createBindingFallback: CreatePreviewRuntimeLocalHelperBindingFallback,
): PreviewRuntimeLocalHelperItemFallback | undefined {
  const call = propertyAccess.parent;
  if (!ts.isCallExpression(call) || call.expression !== propertyAccess) return undefined;
  const callbackArgument = call.arguments[0];
  if (callbackArgument === undefined) return undefined;
  const callback = unwrapPreviewRuntimeExpression(callbackArgument);
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return undefined;
  const itemParameter = callback.parameters[0];
  if (itemParameter === undefined || itemParameter.dotDotDotToken !== undefined) return undefined;

  const candidates: PreviewRuntimeLocalHelperItemFallback[] = [];
  appendUniqueFallback(candidates, createBindingFallback(itemParameter.name, sourceFile));
  if (ts.isIdentifier(itemParameter.name)) {
    for (const demand of collectLocalHelperParameterDemands(
      callback,
      itemParameter.name.text,
      sourceFile,
    )) {
      appendUniqueFallback(candidates, createBindingFallback(demand.parameter.name, sourceFile));
    }
  }
  return combineLocalHelperItemFallbacks(candidates);
}

/** Adds one structurally distinct candidate without letting repeated helper calls inflate output. */
function appendUniqueFallback(
  candidates: PreviewRuntimeLocalHelperItemFallback[],
  fallback: PreviewRuntimeLocalHelperItemFallback | undefined,
): void {
  if (
    fallback !== undefined &&
    !candidates.some((candidate) => candidate.expression === fallback.expression)
  ) {
    candidates.push(fallback);
  }
}

/** Follows exact parameter forwarding through a bounded graph of uniquely named local helpers. */
function collectLocalHelperParameterDemands(
  callback: RuntimeFunction,
  parameterName: string,
  sourceFile: ts.SourceFile,
): readonly HelperParameterDemand[] {
  const declarations = collectUniqueLocalRuntimeFunctions(sourceFile);
  const pending: { readonly owner: RuntimeFunction; readonly parameterName: string }[] = [
    { owner: callback, parameterName },
  ];
  const visited = new Set<string>();
  const demands: HelperParameterDemand[] = [];
  while (pending.length > 0 && visited.size < MAX_LOCAL_HELPER_STATES) {
    const current = pending.shift();
    if (current === undefined) break;
    const stateKey = `${String(current.owner.pos)}:${current.parameterName}`;
    if (visited.has(stateKey)) continue;
    visited.add(stateKey);
    for (const demand of readDirectLocalHelperParameterDemands(
      current.owner,
      current.parameterName,
      declarations,
    )) {
      const demandKey = createHelperParameterKey(demand);
      if (!demands.some((candidate) => createHelperParameterKey(candidate) === demandKey)) {
        demands.push(demand);
      }
      if (ts.isIdentifier(demand.parameter.name)) {
        pending.push({ owner: demand.owner, parameterName: demand.parameter.name.text });
      }
    }
  }
  return Object.freeze(demands);
}

/**
 * Indexes only unambiguous function declarations and function-valued local variables.
 * Duplicate names are discarded because choosing between shadowed declarations would require a
 * semantic checker and could introduce project-specific behavior.
 */
function collectUniqueLocalRuntimeFunctions(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, RuntimeFunction> {
  const candidates = new Map<string, RuntimeFunction[]>();
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      appendNamedFunction(candidates, node.name.text, node);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const initializer = unwrapPreviewRuntimeExpression(node.initializer);
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
        appendNamedFunction(candidates, node.name.text, initializer);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return new Map(
    [...candidates]
      .filter(([, functions]) => functions.length === 1)
      .flatMap(([name, functions]) => {
        const declaration = functions[0];
        return declaration === undefined ? [] : ([[name, declaration]] as const);
      }),
  );
}

/** Creates a stable parser-tree identity for one helper parameter without semantic resolution. */
function createHelperParameterKey(demand: HelperParameterDemand): string {
  return `${String(demand.owner.pos)}:${String(demand.parameter.pos)}`;
}

/** Appends one named declaration to the ambiguity-aware local index. */
function appendNamedFunction(
  candidates: Map<string, RuntimeFunction[]>,
  name: string,
  declaration: RuntimeFunction,
): void {
  const values = candidates.get(name) ?? [];
  values.push(declaration);
  candidates.set(name, values);
}

/** Reads direct `helper(parameter)` forwarding while skipping deferred nested function bodies. */
function readDirectLocalHelperParameterDemands(
  owner: RuntimeFunction,
  parameterName: string,
  declarations: ReadonlyMap<string, RuntimeFunction>,
): readonly HelperParameterDemand[] {
  const result: HelperParameterDemand[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== owner && isRuntimeFunction(node)) return;
    if (ts.isCallExpression(node)) {
      const callee = unwrapPreviewRuntimeExpression(node.expression);
      if (ts.isIdentifier(callee)) {
        const helper = declarations.get(callee.text);
        if (helper !== undefined && helper !== owner) {
          for (const [argumentIndex, argument] of node.arguments.entries()) {
            const value = unwrapPreviewRuntimeExpression(argument);
            if (!ts.isIdentifier(value) || value.text !== parameterName) continue;
            const parameter = helper.parameters[argumentIndex];
            if (parameter !== undefined && parameter.dotDotDotToken === undefined) {
              result.push({ owner: helper, parameter });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  return result;
}

/** Narrows runtime function nodes admitted by the same-file helper graph. */
function isRuntimeFunction(node: ts.Node): node is RuntimeFunction {
  return (
    ts.isArrowFunction(node) || ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
  );
}

/** Combines direct and delegated object evidence while retaining deterministic required paths. */
function combineLocalHelperItemFallbacks(
  candidates: readonly PreviewRuntimeLocalHelperItemFallback[],
): PreviewRuntimeLocalHelperItemFallback | undefined {
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  const ordered = [...candidates].sort(
    (left, right) => (left.requiredPaths?.length ?? 0) - (right.requiredPaths?.length ?? 0),
  );
  const objectCandidates = ordered.filter((candidate) =>
    candidate.expression.startsWith('Object.freeze({'),
  );
  if (objectCandidates.length < 2) return ordered.at(-1);
  const requiredPaths = [
    ...new Set(objectCandidates.flatMap((candidate) => candidate.requiredPaths ?? [])),
  ];
  return {
    expression: `Object.freeze(Object.assign({}, ${objectCandidates
      .map((candidate) => candidate.expression)
      .join(', ')}))`,
    label: 'generated collection item from local helper demand',
    requiredPaths: Object.freeze(requiredPaths),
  };
}
