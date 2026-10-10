/**
 * Reads the declared component name behind one module export without evaluating the module.
 *
 * Page ownership checks compare live React fiber names with the compiler's page roots. A default
 * export carries no name of its own, and a file-name alias (`layout`, `_app`) rarely matches the
 * component the framework mounts (`RootLayout`, `MyApp`). This resolver follows same-file
 * identifiers and bounded wrapper calls (`withRedux(MyApp)`, `memo(Page)`) to the function or class
 * declaration and returns its name; anonymous or ambiguous exports return undefined.
 */
import ts from 'typescript';

const MAX_EXPORT_NAME_RESOLUTION_DEPTH = 12;

type NamedDeclaration = ts.ClassDeclaration | ts.Expression | ts.FunctionDeclaration;

export interface ReadPreviewReactExportComponentNameOptions {
  readonly exportName: string;
  readonly sourcePath: string;
  readonly sourceText: string;
}

/** Returns the declared component name of one export, or undefined when it cannot be proven. */
export function readPreviewReactExportComponentName(
  options: ReadPreviewReactExportComponentNameOptions,
): string | undefined {
  const sourceFile = ts.createSourceFile(
    options.sourcePath,
    options.sourceText,
    ts.ScriptTarget.Latest,
    true,
    options.sourcePath.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const declarations = collectNamedDeclarations(sourceFile);
  const exported = findExportedDeclaration(sourceFile, options.exportName, declarations);
  return exported === undefined
    ? undefined
    : resolveDeclaredName(exported.node, exported.name, declarations, new Set(), 0);
}

/** Collects unique top-level function, class, and variable declarations by local name. */
function collectNamedDeclarations(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, NamedDeclaration> {
  const declarations = new Map<string, NamedDeclaration>();
  const ambiguous = new Set<string>();
  const add = (name: string, value: NamedDeclaration): void => {
    if (ambiguous.has(name)) return;
    if (declarations.has(name)) {
      declarations.delete(name);
      ambiguous.add(name);
    } else declarations.set(name, value);
  };
  for (const statement of sourceFile.statements) {
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name !== undefined
    )
      add(statement.name.text, statement);
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined)
        add(declaration.name.text, declaration.initializer);
    }
  }
  return declarations;
}

/** Finds the declaration (and its local name, when bound) that one export refers to. */
function findExportedDeclaration(
  sourceFile: ts.SourceFile,
  exportName: string,
  declarations: ReadonlyMap<string, NamedDeclaration>,
): { readonly name?: string; readonly node: NamedDeclaration } | undefined {
  for (const statement of sourceFile.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    const exported = modifiers?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword) === true;
    const isDefault =
      modifiers?.some((item) => item.kind === ts.SyntaxKind.DefaultKeyword) === true;
    if (exportName === 'default' && ts.isExportAssignment(statement) && !statement.isExportEquals)
      return { node: statement.expression };
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      exported &&
      (exportName === 'default' ? isDefault : !isDefault && statement.name?.text === exportName)
    )
      return {
        node: statement,
        ...(statement.name === undefined ? {} : { name: statement.name.text }),
      };
    if (ts.isVariableStatement(statement) && exported && exportName !== 'default') {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === exportName &&
          declaration.initializer !== undefined
        )
          return { name: exportName, node: declaration.initializer };
      }
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      const element = statement.exportClause.elements.find((item) => item.name.text === exportName);
      const localName = (element?.propertyName ?? element?.name)?.text;
      const node = localName === undefined ? undefined : declarations.get(localName);
      if (localName !== undefined && node !== undefined) return { name: localName, node };
    }
  }
  return undefined;
}

/**
 * Follows identifiers and wrapper-call arguments to a named function or class. A variable bound to
 * an anonymous function or class takes the variable's name, as React's function name inference does.
 */
function resolveDeclaredName(
  node: NamedDeclaration,
  boundName: string | undefined,
  declarations: ReadonlyMap<string, NamedDeclaration>,
  active: Set<string>,
  depth: number,
): string | undefined {
  if (depth > MAX_EXPORT_NAME_RESOLUTION_DEPTH) return undefined;
  const current = unwrapExpression(node);
  if (
    ts.isFunctionDeclaration(current) ||
    ts.isClassDeclaration(current) ||
    ts.isFunctionExpression(current) ||
    ts.isClassExpression(current)
  )
    return current.name?.text ?? boundName;
  if (ts.isArrowFunction(current)) return boundName;
  if (ts.isIdentifier(current)) {
    const declaration = declarations.get(current.text);
    if (declaration === undefined || active.has(current.text)) return undefined;
    active.add(current.text);
    const resolved = resolveDeclaredName(
      declaration,
      current.text,
      declarations,
      active,
      depth + 1,
    );
    active.delete(current.text);
    return resolved;
  }
  if (!ts.isCallExpression(current)) return undefined;
  for (const argument of current.arguments) {
    const resolved = resolveDeclaredName(argument, undefined, declarations, active, depth + 1);
    if (resolved !== undefined) return resolved;
  }
  return undefined;
}

/** Removes syntax that does not change the runtime value. */
function unwrapExpression(node: NamedDeclaration): NamedDeclaration {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  )
    current = current.expression;
  return current;
}
