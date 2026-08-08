/**
 * Classifies consumer-local bindings before Page Inspector treats them as visual React branches.
 *
 * JSX/value-flow analysis can place helpers, GraphQL documents, and constants beside genuine
 * component-valued props. This lexical guard is deliberately conservative: an uncertain binding
 * stays in its authentic owner module instead of becoming a generated shallow component.
 */

/**
 * Reports whether a local binding has the authored shape of a React component.
 *
 * Leading `$`/`_` markers used by styled wrappers are ignored. Lowercase helpers and screaming
 * snake constants are rejected because projecting either as JSX changes executable page logic.
 * Short acronym components such as `A1` remain valid; member expressions use their import root.
 */
export function isPreviewInspectorComponentShapedBinding(localName: string): boolean {
  const rootName = localName.split('.', 1)[0] ?? '';
  const normalizedName = rootName.replace(/^[$_]+/u, '');
  if (!/^\p{Lu}/u.test(normalizedName)) return false;
  return !(normalizedName.includes('_') && /^[\p{Lu}\p{N}_$]+$/u.test(normalizedName));
}

/**
 * Applies the stricter boundary rule used when replacing a visual child with a shallow projection.
 *
 * Runtime infrastructure must remain authentic even when its local name is PascalCase, because a
 * placeholder Provider, Router, Context, or Boundary would silently remove descendant semantics.
 */
export function isPreviewInspectorSafeShallowVisualBinding(localName: string): boolean {
  if (!isPreviewInspectorComponentShapedBinding(localName)) return false;
  const nameSegments = localName.split('.');
  const rootName = nameSegments[0] ?? '';
  const memberName = nameSegments.at(-1) ?? '';
  const normalizedName = rootName.replace(/^[$_]+/u, '');
  return (
    !/(?:Boundary|Context|Consumer|Provider|Route|Router)$/u.test(normalizedName) &&
    !/^(?:Consumer|Provider)$/u.test(memberName)
  );
}
