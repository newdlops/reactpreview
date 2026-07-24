/**
 * Composes callable hook fallbacks with statically demanded return-value shapes.
 *
 * The direct-usage walker owns call-site discovery, while the main hook analyzer owns recursive
 * binding inference. This adapter joins those boundaries through a small callback so neither module
 * needs to import the other or duplicate tuple/object inference policy.
 */
import ts from 'typescript';
import { createPreviewRuntimeCallableFallbackExpression } from './previewRuntimeCallableFallback';
import type { PreviewRuntimeHookDirectUsageFallback } from './previewRuntimeHookDirectUsage';
import { readPreviewRuntimeCallResultBinding } from './previewRuntimeHookSyntax';

const MAX_CALL_RESULT_DEPTH = 4;

/** Minimal recursive fallback contract shared without exposing instrumentation-private metadata. */
export interface PreviewRuntimeHookCallResultFallback {
  readonly expression: string;
  readonly label: string;
  readonly requiredPaths?: readonly string[];
}

/** Callback supplied by the hook binding analyzer for one reached result declaration. */
export type PreviewRuntimeHookCallResultFactory = (
  binding: ts.BindingName,
  sourceFile: ts.SourceFile,
  callResultDepth: number,
) => PreviewRuntimeHookCallResultFallback | undefined;

/**
 * Infers one immediate call result from the variable binding initialized by that call.
 *
 * @param call Authored function call whose return is consumed locally.
 * @param sourceFile Parser tree that owns both call and binding.
 * @param depth Current bounded callable-return recursion depth.
 * @param createBindingFallback Recursive tuple/object/scalar inference boundary.
 */
export function createPreviewRuntimeHookCallResultFallback(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  depth: number,
  createBindingFallback: PreviewRuntimeHookCallResultFactory,
): PreviewRuntimeHookCallResultFallback | undefined {
  if (depth > MAX_CALL_RESULT_DEPTH) return undefined;
  const binding = readPreviewRuntimeCallResultBinding(call);
  return binding === undefined ? undefined : createBindingFallback(binding, sourceFile, depth);
}

/**
 * Upgrades a direct no-op callable when one or more calls destructure its return value.
 *
 * The richest bounded binding wins when the same function is called in multiple local branches.
 * Every generated function remains inert; only its static return container becomes observable.
 */
export function createPreviewRuntimeHookCallableFallback(
  usage: PreviewRuntimeHookDirectUsageFallback,
  sourceFile: ts.SourceFile,
  depth: number,
  createBindingFallback: PreviewRuntimeHookCallResultFactory,
): PreviewRuntimeHookCallResultFallback {
  const callResult =
    depth >= MAX_CALL_RESULT_DEPTH
      ? undefined
      : usage.callResultBindings
          ?.map((binding) => createBindingFallback(binding, sourceFile, depth + 1))
          .filter(
            (fallback): fallback is PreviewRuntimeHookCallResultFallback => fallback !== undefined,
          )
          .sort(
            (left, right) => (right.requiredPaths?.length ?? 0) - (left.requiredPaths?.length ?? 0),
          )[0];
  return {
    expression: createPreviewRuntimeCallableFallbackExpression(callResult?.expression),
    label:
      callResult === undefined ? usage.label : `generated callable returning ${callResult.label}`,
    requiredPaths: ['<root>()'],
  };
}
