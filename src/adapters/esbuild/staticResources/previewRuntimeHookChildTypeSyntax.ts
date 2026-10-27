/** Reads tuple, component, property, and module syntax for child contracts. */
import ts from 'typescript';

/** Removes tuple optional/rest/named wrappers before element-shape inference. */
export function readTupleElementType(typeNode: ts.TypeNode): ts.TypeNode {
  if (ts.isNamedTupleMember(typeNode)) return typeNode.type;
  if (ts.isOptionalTypeNode(typeNode) || ts.isRestTypeNode(typeNode)) return typeNode.type;
  return typeNode;
}

/** Recognizes common React constructor contracts without importing React declarations. */
export function isReactComponentType(typeNode: ts.TypeNode): boolean {
  if (!ts.isTypeReferenceNode(typeNode)) return false;
  const name = ts.isIdentifier(typeNode.typeName)
    ? typeNode.typeName.text
    : typeNode.typeName.right.text;
  return /^(?:ComponentType|ElementType|FC|FunctionComponent|VFC|VoidFunctionComponent)$/u.test(
    name,
  );
}

/** Reads the props argument of a contextual React function-component variable type. */
export function readReactComponentPropsType(
  typeNode: ts.TypeNode | undefined,
): ts.TypeNode | undefined {
  if (typeNode === undefined || !ts.isTypeReferenceNode(typeNode)) return undefined;
  const name = ts.isIdentifier(typeNode.typeName)
    ? typeNode.typeName.text
    : typeNode.typeName.right.text;
  return /^(?:FC|FunctionComponent|VFC|VoidFunctionComponent)$/u.test(name)
    ? typeNode.typeArguments?.[0]
    : undefined;
}

/** Unwraps syntax-only expression wrappers without evaluating project code. */
export function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  )
    current = current.expression;
  return current;
}

/** Unwraps parenthesized type syntax while preserving authored type identity. */
export function unwrapTypeNode(typeNode: ts.TypeNode): ts.TypeNode {
  return ts.isParenthesizedTypeNode(typeNode) ? unwrapTypeNode(typeNode.type) : typeNode;
}

/** Reads a static prototype-safe object member name. */
export function readPropertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

/** Reports direct `export` syntax without relying on internal compiler flags. */
export function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
        false)
    : false;
}

/** Reports the `default` partner of an exported declaration. */
export function hasDefaultModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ??
        false)
    : false;
}

/** Selects the JSX-aware grammar for one supported workspace source. */
export function readScriptKind(sourcePath: string): ts.ScriptKind {
  const lower = sourcePath.toLowerCase();
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts'))
    return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

/** Rejects parser recovery before source identities participate in inference. */
export function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return (diagnostics?.length ?? 0) > 0;
}
