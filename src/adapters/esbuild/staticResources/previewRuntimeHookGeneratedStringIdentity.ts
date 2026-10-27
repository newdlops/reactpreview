/** Proves when a synthetic display string also supplies a JSX list key; authored values stay intact. */
import ts from 'typescript';
import { createPreviewRuntimeHookRenderedTextExpression } from './previewRuntimeHookDirectUsage';
import { inferPreviewRuntimeHookLocalScalarFallback } from './previewRuntimeHookLocalScalarDemand';
import {
  isPreviewRuntimeFunction,
  unwrapPreviewRuntimeExpression,
} from './previewRuntimeHookSyntax';

const DISPLAY_PROPS = new Set(['children', 'label', 'name', 'title']);

/**
 * Admits only a generated literal matching a direct display use and a key of the callback item.
 * Literal comparisons, computed identifiers, and shadowed nested functions cannot acquire this hint.
 *
 * @param callback Collection callback already proven by the hook usage analyzer.
 * @param expression Compiler-owned item expression; application expressions are never evaluated.
 * @returns Whether repeated generated strings need independently numbered display identities.
 */
export function hasPreviewRuntimeHookGeneratedStringIdentity(
  callback: ts.ArrowFunction | ts.FunctionExpression,
  expression: string,
): boolean {
  if (!expression.startsWith('"') || !expression.endsWith('"')) return false;
  const parameter = callback.parameters[0];
  // A declared item type may be a finite enum; syntax-only sampling must not number its literals.
  if (parameter?.type !== undefined) return false;
  const binding = parameter?.name;
  if (binding === undefined || !ts.isIdentifier(binding)) return false;
  const displayExpressions = new Set<string>();
  const evidence = { keyed: false };
  let visited = 0;
  const visit = (node: ts.Node): void => {
    if (++visited > 512 || (node !== callback && isPreviewRuntimeFunction(node))) return;
    if (ts.isJsxExpression(node) && node.expression !== undefined) {
      const value = unwrapPreviewRuntimeExpression(node.expression);
      if (ts.isIdentifier(value) && value.text === binding.text) {
        const parent = node.parent;
        if (ts.isJsxAttribute(parent) && ts.isIdentifier(parent.name)) {
          if (parent.name.text === 'key') evidence.keyed = true;
          else if (DISPLAY_PROPS.has(parent.name.text)) {
            displayExpressions.add(
              createPreviewRuntimeHookRenderedTextExpression(parent.name.text),
            );
          }
        } else if (ts.isJsxElement(parent) || ts.isJsxFragment(parent)) {
          displayExpressions.add(createPreviewRuntimeHookRenderedTextExpression(binding.text));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(callback);
  return (
    visited <= 512 &&
    evidence.keyed &&
    displayExpressions.has(expression) &&
    inferPreviewRuntimeHookLocalScalarFallback(binding, binding.getSourceFile()) === undefined
  );
}
