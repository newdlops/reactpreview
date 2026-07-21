/**
 * Reads bounded property chains rooted at one locally bound runtime-hook result.
 *
 * Keeping this syntax helper separate prevents the hook instrumentation coordinator from owning
 * collection vocabulary and AST traversal details. The helper never resolves symbols or evaluates
 * computed keys; callers can still retain the last statically named receiver before such a key.
 */
import ts from 'typescript';
import { unwrapPreviewRuntimeExpression } from './previewRuntimeHookSyntax';

const ARRAY_USAGE_PROPERTIES = new Set([
  'at',
  'every',
  'filter',
  'find',
  'findIndex',
  'flatMap',
  'forEach',
  'length',
  'map',
  'reduce',
  'some',
]);

/** One statically named property chain and whether any receiver used optional access. */
export interface PreviewRuntimeHookPropertyUsage {
  /** Property names ordered from the hook-bound identifier toward the reached leaf. */
  readonly names: readonly string[];
  /** True when the authored chain may short-circuit before reaching its final leaf. */
  readonly optional: boolean;
}

/** Reads one property path without following calls, imports, or computed element keys. */
export function readPreviewRuntimeHookPropertyUsage(
  expression: ts.PropertyAccessExpression,
  identifierName: string,
): PreviewRuntimeHookPropertyUsage | undefined {
  const names: string[] = [];
  let optional = false;
  let current: ts.Expression = expression;
  while (ts.isPropertyAccessExpression(current)) {
    optional = optional || current.questionDotToken !== undefined;
    names.unshift(current.name.text);
    current = unwrapPreviewRuntimeExpression(current.expression);
  }
  return ts.isIdentifier(current) && current.text === identifierName
    ? { names, optional }
    : undefined;
}

/** Reports whether a named terminal property proves an Array-style receiver in preview code. */
export function isPreviewRuntimeHookArrayUsageProperty(propertyName: string | undefined): boolean {
  return propertyName !== undefined && ARRAY_USAGE_PROPERTIES.has(propertyName);
}

/**
 * Decides whether an optional nested failure shape may enter a synthesized containing object.
 * Remote-data carrier fields need their collection receivers after a swallowed hook failure;
 * ordinary optional Context children remain absent so the authored short circuit keeps its meaning.
 */
export function shouldMaterializePreviewRuntimeHookNestedFallback(
  fallback:
    | {
        readonly preserveNullish?: boolean;
        readonly requiredPaths?: readonly string[];
      }
    | undefined,
  propertyName: string,
): boolean {
  if (fallback === undefined) return false;
  if (fallback.preserveNullish !== true || (fallback.requiredPaths?.length ?? 0) > 0) return true;
  return /^(?:data|payload|response|result)$/iu.test(propertyName);
}
