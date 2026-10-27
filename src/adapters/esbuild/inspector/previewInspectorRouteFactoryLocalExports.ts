/** Maps exact same-file runtime exports to local declarations without interpreting their values. */
import ts from 'typescript';

/** One uniquely declared runtime binding exposed by a direct or aliased ESM export. */
export interface PreviewInspectorRouteFactoryLocalExport {
  /** Local identifier used by the factory argument, independent of its public export spelling. */
  readonly localName: string;
  /** Last source offset that must precede a value use; zero denotes a hoisted function. */
  readonly availableAfter: number;
}

/**
 * Inventories only local runtime declarations and explicit value exports in one parsed snapshot.
 *
 * Let/var, type-only/ambient exports, imports, foreign re-exports, wildcards and duplicate bindings provide
 * no local identity. Default assignments must evaluate an already initialized local identifier.
 * Export clauses remain live bindings and may precede their declaration. Initializers, getters,
 * functions and other workspace expressions are never executed or followed by this reader.
 */
export function collectPreviewInspectorRouteFactoryLocalExports(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, PreviewInspectorRouteFactoryLocalExport> {
  const bindings = new Map<string, PreviewInspectorRouteFactoryLocalExport[]>();
  const mutableBindings = new Set<string>();
  const exports = new Map<string, { localName: string; evaluatedAt?: number }[]>();

  /** Retains duplicates so partially edited declarations cannot silently choose a different value. */
  const declare = (name: string, availableAfter: number): void => {
    const existing = bindings.get(name) ?? [];
    existing.push(Object.freeze({ localName: name, availableAfter }));
    bindings.set(name, existing);
  };
  /** Records syntax only; public-name collisions are rejected after declaration collection. */
  const expose = (publicName: string, localName: string, evaluatedAt?: number): void => {
    const existing = exports.get(publicName) ?? [];
    existing.push({ localName, ...(evaluatedAt === undefined ? {} : { evaluatedAt }) });
    exports.set(publicName, existing);
  };

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      if (statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword))
        continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
        declare(declaration.name.text, declaration.end);
        if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0)
          mutableBindings.add(declaration.name.text);
        if (statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
          expose(declaration.name.text, declaration.name.text);
      }
      continue;
    }
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (
        statement.name === undefined ||
        statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword) ||
        (ts.isFunctionDeclaration(statement) && statement.body === undefined)
      )
        continue;
      declare(statement.name.text, ts.isFunctionDeclaration(statement) ? 0 : statement.end);
      if (statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        expose(
          statement.modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
            ? 'default'
            : statement.name.text,
          statement.name.text,
        );
      }
      continue;
    }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const value = unwrap(statement.expression);
      if (ts.isIdentifier(value)) expose('default', value.text, value.getStart(sourceFile));
      continue;
    }
    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const item of statement.exportClause.elements) {
        if (!item.isTypeOnly) expose(item.name.text, (item.propertyName ?? item.name).text);
      }
    }
  }

  const result = new Map<string, PreviewInspectorRouteFactoryLocalExport>();
  for (const [publicName, entries] of exports) {
    const entry = entries.length === 1 ? entries[0] : undefined;
    if (entry === undefined) continue;
    const declarations = bindings.get(entry.localName);
    const binding = declarations?.length === 1 ? declarations[0] : undefined;
    if (
      binding !== undefined &&
      !mutableBindings.has(entry.localName) &&
      (entry.evaluatedAt === undefined || binding.availableAfter < entry.evaluatedAt)
    )
      result.set(publicName, binding);
  }
  return result;
}

/** Removes only transparent expression wrappers around a default-export identifier. */
function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  )
    current = current.expression;
  return current;
}
