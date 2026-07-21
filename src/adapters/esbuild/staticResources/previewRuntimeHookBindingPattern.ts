/**
 * Keeps object-binding syntax policy separate from runtime hook-call instrumentation.
 *
 * Object rest bindings are especially important for query results: in
 * `{ loading, data, ...result }`, the named fields and the properties later read from `result`
 * describe one shared object. Rejecting the whole pattern because it contains rest discards all of
 * that evidence and can make a renderer return `null` even though its JSX body is statically known.
 */
import ts from 'typescript';

/** Minimal structural fallback accepted from the recursive binding analyzer. */
interface PreviewRuntimeHookBindingFallback {
  readonly expression: string;
  readonly requiredPaths?: readonly string[];
}

/** Serializable object-spread contribution produced for one rest binding. */
export interface PreviewRuntimeHookObjectRestFallback {
  readonly expression?: string;
  readonly requiredPaths: readonly string[];
}

/** Reads a safe static key from one ordinary object-binding element. */
export function readPreviewRuntimeHookBindingPropertyName(
  element: ts.BindingElement,
): string | undefined {
  const propertyName = element.propertyName;
  if (propertyName === undefined && ts.isIdentifier(element.name)) return element.name.text;
  if (
    propertyName !== undefined &&
    (ts.isIdentifier(propertyName) || ts.isStringLiteral(propertyName))
  ) {
    return propertyName.text;
  }
  return undefined;
}

/**
 * Flattens the inferred rest carrier into its source object instead of nesting it under the local
 * rest variable name. An unknown rest binding contributes nothing but never invalidates named
 * fields already proven by the same destructuring pattern.
 */
export function createPreviewRuntimeHookObjectRestFallback(
  fallback: PreviewRuntimeHookBindingFallback | undefined,
): PreviewRuntimeHookObjectRestFallback {
  return fallback === undefined
    ? { requiredPaths: [] }
    : {
        expression: `...(${fallback.expression})`,
        requiredPaths: fallback.requiredPaths ?? [],
      };
}
