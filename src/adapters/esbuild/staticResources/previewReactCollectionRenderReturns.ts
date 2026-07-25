/**
 * Resolves render expressions returned by a direct Array map or flatMap callback.
 *
 * Collection callbacks are part of React's authored output even when preview data currently leaves
 * the collection empty. The render-outcome analyzer uses these expressions to preserve nested JSX
 * condition lineage without inventing an item, invoking a callback, or evaluating its receiver.
 */
import ts from 'typescript';
import type { PreviewReactRenderLocalBindingEvidence } from './previewReactRenderOutcomeComponents';
import { collectPreviewRenderCallbackReturns } from './previewReactRenderTerminal';
import { unwrapPreviewRenderExpression } from './previewReactRenderOutcomeSyntax';

type PreviewCollectionRenderFunction =
  ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression;

/**
 * Returns bounded callback results for a syntactically proven map/flatMap render expression.
 *
 * Direct functions and one exact same-module identifier binding are accepted. Member callbacks,
 * calls, reassigned bindings, and non-collection methods fail closed because their returned values
 * cannot be proven without application execution.
 */
export function readPreviewReactCollectionRenderReturns(
  expression_: ts.Expression,
  bindings: ReadonlyMap<string, PreviewReactRenderLocalBindingEvidence>,
): readonly ts.Expression[] | undefined {
  const expression = unwrapPreviewRenderExpression(expression_);
  if (
    !ts.isCallExpression(expression) ||
    !ts.isPropertyAccessExpression(expression.expression) ||
    !['map', 'flatMap'].includes(expression.expression.name.text)
  ) {
    return undefined;
  }
  const callbackExpression = expression.arguments[0];
  if (callbackExpression === undefined) return undefined;
  const unwrappedCallback = unwrapPreviewRenderExpression(callbackExpression);
  let callback: PreviewCollectionRenderFunction | undefined;
  if (ts.isArrowFunction(unwrappedCallback) || ts.isFunctionExpression(unwrappedCallback)) {
    callback = unwrappedCallback;
  } else if (ts.isIdentifier(unwrappedCallback)) {
    const binding = bindings.get(unwrappedCallback.text);
    const boundExpression =
      binding?.expression === undefined
        ? undefined
        : unwrapPreviewRenderExpression(binding.expression);
    if (
      boundExpression !== undefined &&
      (ts.isArrowFunction(boundExpression) || ts.isFunctionExpression(boundExpression))
    ) {
      callback = boundExpression;
    } else {
      callback = binding?.functionLike;
    }
  }
  return callback === undefined ? undefined : collectPreviewRenderCallbackReturns(callback);
}
