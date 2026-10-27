/**
 * Detects a package hook result that the component hands back to the same package.
 *
 * `useEditor({ immediatelyRender: false })` from `@tiptap/react` returns null on the first render and
 * the real editor after mount; the component passes it to `<EditorContent editor={editor} />` from
 * the same package. A generated shape cannot stand in for that package's own instance: the
 * package's consumer writes and calls members the component never reads (`EditorContent` sets
 * `isEditorContentInitialized` and calls `view.setProps`), so a frozen sample throws. When the
 * result returns to its own package, the authored nullish result is the value to keep.
 */
import ts from 'typescript';

type RuntimeFunction =
  ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression | ts.MethodDeclaration;

/** Local names one module import brings in. */
interface PreviewPackageImportNames {
  /** Named and default bindings. */
  readonly direct: ReadonlySet<string>;
  /** Namespace bindings (`import * as Tiptap`). */
  readonly namespaces: ReadonlySet<string>;
}

/**
 * Reports whether a hook result binding is passed to a component or function imported from the
 * hook's own package.
 *
 * @param name Binding the hook result is assigned to.
 * @param moduleSpecifier Package the hook is imported from.
 * @param sourceFile File containing the hook call.
 * @returns True when a JSX attribute or call argument of a same-package import receives the result.
 */
export function isPreviewRuntimeHookResultReturnedToPackage(
  name: ts.BindingName,
  moduleSpecifier: string,
  sourceFile: ts.SourceFile,
): boolean {
  if (!ts.isIdentifier(name) || !isBarePackageSpecifier(moduleSpecifier)) return false;
  const owner = findNearestRuntimeFunction(name);
  if (owner === undefined) return false;
  const imports = readPackageImportNames(sourceFile, moduleSpecifier);
  if (imports.direct.size === 0 && imports.namespaces.size === 0) return false;
  let returned = false;
  const visit = (node: ts.Node): void => {
    if (returned) return;
    if (node !== owner && isRuntimeFunction(node) && functionShadowsName(node, name.text)) return;
    if (ts.isIdentifier(node) && node !== name && node.text === name.text) {
      returned = isReceivedByPackage(node, imports);
      if (returned) return;
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  return returned;
}

/** Checks whether one reference flows into a same-package JSX element or call. */
function isReceivedByPackage(
  reference: ts.Identifier,
  imports: PreviewPackageImportNames,
): boolean {
  const value = unwrapTransparentParents(reference);
  const parent = value.parent;
  if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) {
    const element = parent.parent.parent.parent;
    return (
      (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)) &&
      isPackageReference(element.tagName, imports)
    );
  }
  if (ts.isCallExpression(parent) && parent.arguments.some((argument) => argument === value)) {
    return isPackageReference(parent.expression, imports);
  }
  // `useEditorState({ editor })` passes the result inside an options object literal.
  const property =
    ts.isShorthandPropertyAssignment(parent) ||
    (ts.isPropertyAssignment(parent) && parent.initializer === value)
      ? parent
      : undefined;
  const options = property?.parent;
  if (options === undefined || !ts.isObjectLiteralExpression(options)) return false;
  const call = unwrapTransparentParents(options).parent;
  return (
    ts.isCallExpression(call) &&
    call.arguments.some((argument) => unwrapTransparentExpression(argument) === options) &&
    isPackageReference(call.expression, imports)
  );
}

/** Resolves a tag name or callee to a binding imported from the package. */
function isPackageReference(
  expression: ts.Expression | ts.JsxTagNameExpression,
  imports: PreviewPackageImportNames,
): boolean {
  if (ts.isIdentifier(expression)) return imports.direct.has(expression.text);
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    imports.namespaces.has(expression.expression.text)
  );
}

/** Collects the local names of every value import from one module. */
function readPackageImportNames(
  sourceFile: ts.SourceFile,
  moduleSpecifier: string,
): PreviewPackageImportNames {
  const direct = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== moduleSpecifier
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause === undefined || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
    if (clause.name !== undefined) direct.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      if (!element.isTypeOnly) direct.add(element.name.text);
    }
  }
  return { direct, namespaces };
}

/** Reports whether a specifier names a package rather than a relative path or project alias. */
function isBarePackageSpecifier(moduleSpecifier: string): boolean {
  return /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:\/.*)?$/iu.test(moduleSpecifier);
}

/** Returns the outermost expression around a node reached through transparent wrappers. */
function unwrapTransparentParents(node: ts.Node): ts.Node {
  let current = node;
  while (
    ts.isParenthesizedExpression(current.parent) ||
    ts.isAsExpression(current.parent) ||
    ts.isNonNullExpression(current.parent) ||
    ts.isSatisfiesExpression(current.parent)
  ) {
    current = current.parent;
  }
  return current;
}

/** Removes transparent wrappers from an argument expression. */
function unwrapTransparentExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Locates the closest runtime function containing the binding. */
function findNearestRuntimeFunction(node: ts.Node): RuntimeFunction | undefined {
  let current = node.parent;
  while (!ts.isSourceFile(current)) {
    if (isRuntimeFunction(current)) return current;
    current = current.parent;
  }
  return undefined;
}

/** Narrows function-like nodes that can own hook calls. */
function isRuntimeFunction(node: ts.Node): node is RuntimeFunction {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node)
  );
}

/** Detects a nested function parameter that replaces the analyzed binding. */
function functionShadowsName(scope: RuntimeFunction, identifierName: string): boolean {
  return scope.parameters.some((parameter) => bindingContainsName(parameter.name, identifierName));
}

/** Checks one parameter pattern for the analyzed name. */
function bindingContainsName(binding: ts.BindingName, identifierName: string): boolean {
  if (ts.isIdentifier(binding)) return binding.text === identifierName;
  return binding.elements.some(
    (element) =>
      !ts.isOmittedExpression(element) && bindingContainsName(element.name, identifierName),
  );
}
