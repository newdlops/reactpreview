/**
 * Provides shared TypeScript syntax predicates for conservative styled-components transforms.
 * The helpers recognize only runtime imports and tagged templates rooted in those exact bindings;
 * ordinary objects named `theme`, application expressions, and parser-recovered editor text remain
 * outside the preview compatibility boundary.
 */
import ts from 'typescript';

const STYLED_COMPONENTS_SPECIFIER = 'styled-components';

/** Static import bindings that can own a styled-components tagged template. */
export interface PreviewStyledTemplateBindings {
  /** Default and named runtime imports such as `styled`, `css`, and `createGlobalStyle`. */
  readonly direct: ReadonlySet<string>;
  /** Namespace imports used as `Styled.css` or another tagged member. */
  readonly namespaces: ReadonlySet<string>;
}

/** Creates one parent-linked source tree using the grammar implied by the authored file suffix. */
export function createPreviewStyledTemplateSourceFile(
  sourcePath: string,
  sourceText: string,
): ts.SourceFile {
  return ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    selectPreviewStyledTemplateScriptKind(sourcePath),
  );
}

/** Refuses parser-recovered source so a half-written editor buffer is never partially rewritten. */
export function hasPreviewStyledTemplateParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return diagnostics !== undefined && diagnostics.length > 0;
}

/** Collects non-erased bindings imported from the styled-components runtime package. */
export function collectPreviewStyledTemplateBindings(
  sourceFile: ts.SourceFile,
): PreviewStyledTemplateBindings {
  const direct = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== STYLED_COMPONENTS_SPECIFIER
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause === undefined || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
    if (clause.name !== undefined) direct.add(clause.name.text);
    const namedBindings = clause.namedBindings;
    if (namedBindings !== undefined && ts.isNamespaceImport(namedBindings)) {
      namespaces.add(namedBindings.name.text);
      continue;
    }
    for (const element of namedBindings?.elements ?? []) {
      if (!element.isTypeOnly) direct.add(element.name.text);
    }
  }
  return { direct, namespaces };
}

/** Reports whether a node is nested in a tagged template owned by an imported styled binding. */
export function isInsidePreviewStyledTemplate(
  node: ts.Node,
  bindings: PreviewStyledTemplateBindings,
): boolean {
  let current = node.parent;
  while (!ts.isSourceFile(current)) {
    if (ts.isTaggedTemplateExpression(current)) {
      return isPreviewStyledTag(current.tag, bindings);
    }
    if (ts.isStatement(current)) return false;
    current = current.parent;
  }
  return false;
}

/** Reads dot syntax or a literal element-access key without evaluating computed expressions. */
export function readPreviewStaticPropertyName(
  expression: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): string | undefined {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  const argument = expression.argumentExpression;
  return ts.isStringLiteral(argument) || ts.isNumericLiteral(argument) ? argument.text : undefined;
}

/** Rejects optional access because a generated resolver must not alter its short-circuit semantics. */
export function hasPreviewOptionalPropertyChain(expression: ts.Expression): boolean {
  let current = expression;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    if (current.questionDotToken !== undefined) return true;
    current = unwrapPreviewStyledExpression(current.expression);
  }
  return false;
}

/** Removes syntax-only wrappers while retaining the original source span for generated code. */
export function unwrapPreviewStyledExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Traces a compound tag such as `styled(Component).attrs({})` to an imported styled root. */
function isPreviewStyledTag(
  expression: ts.Expression,
  bindings: PreviewStyledTemplateBindings,
): boolean {
  const root = readPreviewExpressionRoot(unwrapPreviewStyledExpression(expression));
  return (
    root !== undefined && (bindings.direct.has(root.text) || bindings.namespaces.has(root.text))
  );
}

/** Returns the leftmost identifier across calls and static property access in one template tag. */
function readPreviewExpressionRoot(expression: ts.Expression): ts.Identifier | undefined {
  let current = expression;
  for (;;) {
    if (ts.isCallExpression(current)) {
      current = unwrapPreviewStyledExpression(current.expression);
      continue;
    }
    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      current = unwrapPreviewStyledExpression(current.expression);
      continue;
    }
    return ts.isIdentifier(current) ? current : undefined;
  }
}

/** Maps supported workspace suffixes to TypeScript's matching parser grammar. */
function selectPreviewStyledTemplateScriptKind(sourcePath: string): ts.ScriptKind {
  const normalized = sourcePath.toLowerCase();
  if (normalized.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (normalized.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (normalized.endsWith('.js')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
