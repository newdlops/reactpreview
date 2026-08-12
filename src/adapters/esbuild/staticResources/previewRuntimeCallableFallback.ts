/**
 * Defines the transport contract for generated functions whose return value is statically known.
 *
 * A plain no-op is sufficient for event handlers, but it violates authored code such as
 * `const [allowed] = checkPermission()`. The generated function therefore keeps its inert return
 * value in a non-enumerable global-Symbol descriptor. Inspector JSON adapters can preserve that
 * descriptor without invoking project code, then rematerialize the same callable after Smart Fill.
 */

/** Cross-realm marker used only on extension-generated, side-effect-free callable fallbacks. */
export const PREVIEW_RUNTIME_CALL_RESULT_MARKER_KEY =
  'newdlops.react-file-preview.generated-call-result';

/** Marks generated callables whose authored consumers require a Promise return contract. */
export const PREVIEW_RUNTIME_PROMISE_RESULT_MARKER_KEY =
  'newdlops.react-file-preview.generated-promise-result';

/**
 * Creates an expression for an inert callable, optionally retaining one static return expression.
 *
 * The IIFE evaluates the bounded return expression once and closes over the exact value. This keeps
 * tuple/object identity stable across repeated calls and lets the Inspector read the marker through
 * a data descriptor without ever calling the function.
 *
 * @param resultExpression Side-effect-free generated expression, or `undefined` for a plain no-op.
 * @param promiseReturning Whether the authored consumer directly requires Promise chaining.
 * @returns Browser-safe JavaScript expression suitable for an esbuild source replacement.
 */
export function createPreviewRuntimeCallableFallbackExpression(
  resultExpression?: string,
  promiseReturning = false,
): string {
  if (resultExpression === undefined) {
    if (!promiseReturning) return 'Object.freeze(() => undefined)';
    const promiseMarker = JSON.stringify(PREVIEW_RUNTIME_PROMISE_RESULT_MARKER_KEY);
    return [
      'Object.freeze(Object.defineProperty(',
      '() => Promise.resolve(undefined),',
      `Symbol.for(${promiseMarker}),`,
      '{ value: true }',
      '))',
    ].join(' ');
  }
  const marker = JSON.stringify(PREVIEW_RUNTIME_CALL_RESULT_MARKER_KEY);
  const promiseMarker = JSON.stringify(PREVIEW_RUNTIME_PROMISE_RESULT_MARKER_KEY);
  const returnedResult = promiseReturning
    ? 'Promise.resolve(generatedCallResult)'
    : 'generatedCallResult';
  return [
    '(() => {',
    `const generatedCallResult = (${resultExpression});`,
    'const generatedCallable = Object.defineProperty(',
    `() => ${returnedResult},`,
    `Symbol.for(${marker}),`,
    '{ value: generatedCallResult }',
    ');',
    ...(promiseReturning
      ? [
          'Object.defineProperty(',
          'generatedCallable,',
          `Symbol.for(${promiseMarker}),`,
          '{ value: true }',
          ');',
        ]
      : []),
    'return Object.freeze(generatedCallable);',
    '})()',
  ].join(' ');
}
