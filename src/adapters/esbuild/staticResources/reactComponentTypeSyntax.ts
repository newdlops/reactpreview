/**
 * Recognizes standard React element-constructor type syntax without resolving imported modules.
 * The result is used only to create a render-only `null` component for a required missing prop;
 * authored parent/setup values always retain higher priority at the preview boundary.
 */
import ts from 'typescript';

const REACT_COMPONENT_TYPE_NAMES = new Set([
  'ComponentClass',
  'ComponentType',
  'ElementType',
  'FC',
  'FunctionComponent',
]);

/**
 * Reports whether a type node explicitly names a conventional React component constructor.
 * Both qualified forms (`React.ComponentType`) and imported aliases (`ComponentType`) are accepted.
 *
 * @param typeNode Syntax-only prop type from the selected source file.
 * @returns `true` only for a bounded, well-known React component type name.
 */
export function isReactComponentTypeSyntax(typeNode: ts.TypeNode): boolean {
  const unwrapped = ts.isParenthesizedTypeNode(typeNode) ? typeNode.type : typeNode;
  if (!ts.isTypeReferenceNode(unwrapped)) return false;
  const rightmostName = ts.isIdentifier(unwrapped.typeName)
    ? unwrapped.typeName.text
    : unwrapped.typeName.right.text;
  return REACT_COMPONENT_TYPE_NAMES.has(rightmostName);
}
