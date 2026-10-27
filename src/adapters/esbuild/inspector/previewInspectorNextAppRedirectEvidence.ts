/** Reads unconditional literal Next redirects as route evidence without evaluating project code. */
import { Buffer } from 'node:buffer';
import ts from 'typescript';

const MAX_REDIRECT_SOURCE_BYTES = 128 * 1024;

/**
 * Returns the local pathname from a default component's first executable redirect statement.
 * Conditional, computed, shadowed, external and query-dependent navigation remains runtime-owned.
 */
export function readPreviewInspectorNextAppRedirectDestination(
  sourcePath: string,
  sourceText: string | undefined,
): string | undefined {
  if (sourceText === undefined || Buffer.byteLength(sourceText, 'utf8') > MAX_REDIRECT_SOURCE_BYTES)
    return undefined;
  let source: ts.SourceFile;
  try {
    source = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true);
  } catch {
    return undefined;
  }
  const diagnostics = (
    source as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if ((diagnostics?.length ?? 0) > 0) return undefined;
  const redirectNames = new Set<string>();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'next/navigation' ||
      statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const item of bindings.elements) {
      if (
        !item.isTypeOnly &&
        ['redirect', 'permanentRedirect'].includes((item.propertyName ?? item.name).text)
      )
        redirectNames.add(item.name.text);
    }
  }
  if (redirectNames.size === 0) return undefined;
  const component = readDefaultComponent(source);
  if (
    component?.body === undefined ||
    component.parameters.some((parameter) => bindingContainsName(parameter.name, redirectNames)) ||
    containsShadowingBinding(component.body, redirectNames) ||
    (component.name !== undefined &&
      ts.isIdentifier(component.name) &&
      redirectNames.has(component.name.text))
  )
    return undefined;
  const body = component.body;
  const first = ts.isBlock(body)
    ? body.statements.find(
        (statement) =>
          !ts.isEmptyStatement(statement) &&
          !(ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)),
      )
    : body;
  const expression =
    first === undefined
      ? undefined
      : ts.isReturnStatement(first)
        ? first.expression
        : ts.isExpressionStatement(first)
          ? first.expression
          : ts.isExpression(first)
            ? first
            : undefined;
  if (
    expression === undefined ||
    !ts.isCallExpression(expression) ||
    !ts.isIdentifier(expression.expression) ||
    !redirectNames.has(expression.expression.text) ||
    expression.arguments.length !== 1
  )
    return undefined;
  const argument = expression.arguments[0];
  if (argument === undefined || !ts.isStringLiteralLike(argument)) return undefined;
  const destination = argument.text;
  return destination.length <= 2048 &&
    destination.startsWith('/') &&
    !destination.startsWith('//') &&
    !/[\\\u0000-\u001f\u007f?#]/u.test(destination)
    ? destination
    : undefined;
}

/** Locates direct default functions and default-exported local function/arrow declarations. */
function readDefaultComponent(source: ts.SourceFile): ts.FunctionLikeDeclaration | undefined {
  for (const statement of source.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
    )
      return statement.asteriskToken === undefined ? statement : undefined;
    if (!ts.isExportAssignment(statement) || statement.isExportEquals) continue;
    let expression: ts.Expression | undefined = statement.expression;
    if (ts.isIdentifier(expression)) {
      const name = expression.text;
      const declaration = source.statements.find(
        (item) => ts.isFunctionDeclaration(item) && item.name?.text === name,
      );
      if (declaration !== undefined && ts.isFunctionDeclaration(declaration))
        return declaration.asteriskToken === undefined ? declaration : undefined;
      expression = source.statements
        .flatMap((item) =>
          ts.isVariableStatement(item) ? [...item.declarationList.declarations] : [],
        )
        .find((item) => ts.isIdentifier(item.name) && item.name.text === name)?.initializer;
    }
    if (
      expression !== undefined &&
      (ts.isArrowFunction(expression) ||
        (ts.isFunctionExpression(expression) && expression.asteriskToken === undefined))
    )
      return expression;
  }
  return undefined;
}

/** Rejects component parameters that locally shadow an imported redirect binding. */
function bindingContainsName(binding: ts.BindingName, names: ReadonlySet<string>): boolean {
  return ts.isIdentifier(binding)
    ? names.has(binding.text)
    : binding.elements.some(
        (element) => !ts.isOmittedExpression(element) && bindingContainsName(element.name, names),
      );
}

/** Refuses local bindings, including declarations hoisted from after the redirect statement. */
function containsShadowingBinding(node: ts.Node, names: ReadonlySet<string>): boolean {
  if (
    (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) &&
    bindingContainsName(node.name, names)
  )
    return true;
  if (
    (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) &&
    node.name !== undefined &&
    names.has(node.name.text)
  )
    return true;
  // Nested scopes are conservatively refused; uncertain pages retain runtime navigation.
  return (
    ts.forEachChild(node, (child) => containsShadowingBinding(child, names) || undefined) === true
  );
}
