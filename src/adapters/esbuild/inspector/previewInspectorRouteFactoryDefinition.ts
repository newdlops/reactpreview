/**
 * Resolves the static contract of a curried route factory.
 *
 * The resolver follows only ESM aliases and immutable initializers. It never runs a factory: when
 * a wrapper/dataflow relationship cannot be proven within the fixed budget it returns undefined.
 */
import path from 'node:path';
import ts from 'typescript';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';

const MAXIMUM_MODULES = 8;
const MAXIMUM_EDGES = 32;

/** Names that connect a selected factory call to its generated route-slot implementation. */
export interface PreviewInspectorRouteFactoryDefinition {
  readonly baseParameterName: string;
  readonly catalogBindingName?: string;
  readonly dependencyPaths: readonly string[];
  readonly pageCollectionParameterName: string;
  readonly pageSlotPropertyName: string;
  readonly submoduleCollectionParameterName: string;
  readonly submoduleSlotPropertyName: string;
  readonly wrapperParameterName: string;
}

/** Resolves a curried factory definition through a bounded import/export alias trace. */
export async function resolvePreviewInspectorRouteFactoryDefinition(options: {
  readonly callExpression: ts.CallExpression;
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  readonly sourceFile: ts.SourceFile;
  readonly sourcePath: string;
}): Promise<PreviewInspectorRouteFactoryDefinition | undefined> {
  const imported = readImportedBinding(options.callExpression.expression, options.sourceFile);
  if (imported === undefined || options.resolveModule === undefined) return undefined;
  const initialPath = options.resolveModule(imported.moduleSpecifier, options.sourcePath);
  if (initialPath === undefined) return undefined;
  const dependencies = new Set<string>([path.normalize(options.sourcePath)]);
  const visited = new Set<string>();
  let edges = 0;

  const follow = async (
    sourcePath: string,
    exportName: string,
    inheritedCatalogBinding?: string,
  ): Promise<PreviewInspectorRouteFactoryDefinition | undefined> => {
    if (visited.size >= MAXIMUM_MODULES || edges >= MAXIMUM_EDGES) return undefined;
    const normalizedPath = path.normalize(sourcePath);
    const key = `${normalizedPath}\0${exportName}`;
    if (visited.has(key)) return undefined;
    visited.add(key);
    dependencies.add(normalizedPath);
    const sourceText = await options.readSource(normalizedPath);
    if (sourceText === undefined) return undefined;
    const sourceFile = parseSource(normalizedPath, sourceText);
    const exportedFunction = findExportFunction(sourceFile, exportName);
    if (exportedFunction !== undefined) {
      const contract = readFactoryFunctionContract(exportedFunction, inheritedCatalogBinding);
      return contract === undefined
        ? undefined
        : Object.freeze({ ...contract, dependencyPaths: Object.freeze([...dependencies]) });
    }
    const initializer = findExportInitializer(sourceFile, exportName);
    if (initializer === undefined) return undefined;
    edges += 1;
    const unwrapped = unwrap(initializer);
    if (ts.isCallExpression(unwrapped)) {
      const contract = readFactoryImplementationContract(
        unwrapped,
        sourceFile,
        inheritedCatalogBinding,
      );
      if (contract !== undefined) {
        return Object.freeze({ ...contract, dependencyPaths: Object.freeze([...dependencies]) });
      }
      const alias = readImportedBinding(unwrapped.expression, sourceFile);
      if (alias === undefined || options.resolveModule === undefined) return undefined;
      const nextPath = options.resolveModule(alias.moduleSpecifier, normalizedPath);
      if (nextPath === undefined) return undefined;
      const firstArgument = unwrapped.arguments[0];
      const catalogBinding =
        firstArgument !== undefined && ts.isIdentifier(firstArgument)
          ? firstArgument.text
          : inheritedCatalogBinding;
      return follow(nextPath, alias.exportName, catalogBinding);
    }
    if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
      const contract = readFactoryFunctionContract(unwrapped, inheritedCatalogBinding);
      return contract === undefined
        ? undefined
        : Object.freeze({ ...contract, dependencyPaths: Object.freeze([...dependencies]) });
    }
    if (ts.isIdentifier(unwrapped)) {
      const alias = readImportedBinding(unwrapped, sourceFile);
      if (alias === undefined || options.resolveModule === undefined) return undefined;
      const nextPath = options.resolveModule(alias.moduleSpecifier, normalizedPath);
      return nextPath === undefined
        ? undefined
        : follow(nextPath, alias.exportName, inheritedCatalogBinding);
    }
    return undefined;
  };

  return follow(initialPath, imported.exportName);
}

/** Finds an exported function declaration when a factory is not represented by a const initializer. */
function findExportFunction(
  sourceFile: ts.SourceFile,
  exportName: string,
): ts.FunctionDeclaration | undefined {
  return sourceFile.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === exportName,
  );
}

/** Reads the returned callable from a curried factory declaration such as `(catalog) => (...) =>`. */
function readFactoryFunctionContract(
  factory: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
  catalogBindingName: string | undefined,
): Omit<PreviewInspectorRouteFactoryDefinition, 'dependencyPaths'> | undefined {
  if (factory.body === undefined) return undefined;
  const returned = findReturnedFunction(factory.body);
  if (returned === undefined) return undefined;
  const baseParameter = returned.parameters[0];
  const pagesParameter = returned.parameters[1];
  const submodulesParameter = returned.parameters[2];
  const wrapperParameter = returned.parameters[3];
  if (
    baseParameter === undefined ||
    pagesParameter === undefined ||
    submodulesParameter === undefined ||
    wrapperParameter === undefined
  ) {
    return undefined;
  }
  const baseParameterName = readIdentifierParameter(baseParameter);
  const pageCollectionParameterName = readIdentifierParameter(pagesParameter);
  const submoduleCollectionParameterName = readIdentifierParameter(submodulesParameter);
  const wrapperParameterName = readIdentifierParameter(wrapperParameter);
  if (
    baseParameterName === undefined ||
    pageCollectionParameterName === undefined ||
    submoduleCollectionParameterName === undefined ||
    wrapperParameterName === undefined
  ) {
    return undefined;
  }
  const object = findObjectPassedToIdentifier(returned.body, wrapperParameterName);
  const slots =
    object === undefined
      ? undefined
      : readGeneratedRouteSlots(
          object,
          pageCollectionParameterName,
          submoduleCollectionParameterName,
        );
  if (slots === undefined) return undefined;
  return Object.freeze({
    baseParameterName,
    ...(catalogBindingName === undefined ? {} : { catalogBindingName }),
    pageCollectionParameterName,
    pageSlotPropertyName: slots.page,
    submoduleCollectionParameterName,
    submoduleSlotPropertyName: slots.submodule,
    wrapperParameterName,
  });
}

/** Reads the factory function's parameters and the generated map slots supplied to its wrapper. */
function readFactoryImplementationContract(
  expression: ts.CallExpression,
  sourceFile: ts.SourceFile,
  catalogBindingName: string | undefined,
): Omit<PreviewInspectorRouteFactoryDefinition, 'dependencyPaths'> | undefined {
  const callback = expression.arguments.find(
    (argument): argument is ts.ArrowFunction | ts.FunctionExpression =>
      ts.isArrowFunction(argument) || ts.isFunctionExpression(argument),
  );
  const baseParameter = callback?.parameters[0];
  const pageCollectionParameter = callback?.parameters[1];
  const submoduleCollectionParameter = callback?.parameters[2];
  if (
    callback === undefined ||
    baseParameter === undefined ||
    pageCollectionParameter === undefined ||
    submoduleCollectionParameter === undefined
  )
    return undefined;
  const baseParameterName = readIdentifierParameter(baseParameter);
  const pageCollectionParameterName = readIdentifierParameter(pageCollectionParameter);
  const submoduleCollectionParameterName = readIdentifierParameter(submoduleCollectionParameter);
  if (
    baseParameterName === undefined ||
    pageCollectionParameterName === undefined ||
    submoduleCollectionParameterName === undefined
  ) {
    return undefined;
  }
  const wrapper = findReturnedFunction(callback.body);
  const wrapperParameterName =
    wrapper?.parameters[0] === undefined
      ? undefined
      : readIdentifierParameter(wrapper.parameters[0]);
  if (wrapper === undefined || wrapperParameterName === undefined) return undefined;
  const object = findObjectPassedToIdentifier(wrapper.body, wrapperParameterName);
  if (object === undefined) return undefined;
  const slots = readGeneratedRouteSlots(
    object,
    pageCollectionParameterName,
    submoduleCollectionParameterName,
  );
  if (slots === undefined) return undefined;
  return Object.freeze({
    baseParameterName,
    ...(catalogBindingName === undefined ? {} : { catalogBindingName }),
    pageCollectionParameterName,
    pageSlotPropertyName: slots.page,
    submoduleCollectionParameterName,
    submoduleSlotPropertyName: slots.submodule,
    wrapperParameterName,
  });
}

/** Finds a returned arrow/function body without evaluating HOCs or callback invocations. */
function findReturnedFunction(
  body: ts.ConciseBody,
): ts.ArrowFunction | ts.FunctionExpression | undefined {
  if (ts.isArrowFunction(body) || ts.isFunctionExpression(body)) return body;
  if (!ts.isBlock(body)) return undefined;
  for (const statement of body.statements) {
    if (ts.isReturnStatement(statement) && statement.expression !== undefined) {
      const value = unwrap(statement.expression);
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return value;
    }
  }
  return undefined;
}

/** Finds the first object literal that is supplied directly to the factory wrapper parameter. */
function findObjectPassedToIdentifier(
  body: ts.ConciseBody,
  identifier: string,
): ts.ObjectLiteralExpression | undefined {
  let found: ts.ObjectLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (
      ts.isCallExpression(node) &&
      node.arguments.some((argument) => expressionContainsWrapperParameter(argument, identifier, 0))
    ) {
      const object =
        node.arguments.find((argument): argument is ts.ObjectLiteralExpression =>
          ts.isObjectLiteralExpression(unwrap(argument)),
        ) ??
        (ts.isCallExpression(node.expression)
          ? node.expression.arguments.find((argument): argument is ts.ObjectLiteralExpression =>
              ts.isObjectLiteralExpression(unwrap(argument)),
            )
          : undefined);
      if (object !== undefined) found = object;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

/** Accepts only transparent fallback expressions such as `Component || DefaultWrapper`. */
function expressionContainsWrapperParameter(
  expression: ts.Expression,
  parameterName: string,
  depth: number,
): boolean {
  if (depth > 6) return false;
  const value = unwrap(expression);
  if (ts.isIdentifier(value)) return value.text === parameterName;
  if (
    ts.isBinaryExpression(value) &&
    (value.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return (
      expressionContainsWrapperParameter(value.left, parameterName, depth + 1) ||
      expressionContainsWrapperParameter(value.right, parameterName, depth + 1)
    );
  }
  return ts.isConditionalExpression(value)
    ? expressionContainsWrapperParameter(value.whenTrue, parameterName, depth + 1) ||
        expressionContainsWrapperParameter(value.whenFalse, parameterName, depth + 1)
    : false;
}

/** Recognizes immutable generated page/submodule `.map` values in a wrapper props object. */
function readGeneratedRouteSlots(
  object: ts.ObjectLiteralExpression,
  pages: string,
  submodules: string,
): { readonly page: string; readonly submodule: string } | undefined {
  let page: string | undefined;
  let submodule: string | undefined;
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue;
    const receiver = readMapReceiver(property.initializer);
    if (receiver === pages) page = property.name.text;
    if (receiver === submodules) submodule = property.name.text;
  }
  return page === undefined || submodule === undefined
    ? undefined
    : Object.freeze({ page, submodule });
}

/** Reads the receiver name from `Object.entries(pages).map(...)` or `submodules.map(...)`. */
function readMapReceiver(expression: ts.Expression): string | undefined {
  const value = unwrap(expression);
  if (
    !ts.isCallExpression(value) ||
    !ts.isPropertyAccessExpression(value.expression) ||
    value.expression.name.text !== 'map'
  )
    return undefined;
  const receiver = value.expression.expression;
  if (ts.isIdentifier(receiver)) return receiver.text;
  if (
    ts.isCallExpression(receiver) &&
    ts.isPropertyAccessExpression(receiver.expression) &&
    receiver.expression.name.text === 'entries' &&
    receiver.arguments[0] !== undefined &&
    ts.isIdentifier(receiver.arguments[0])
  )
    return receiver.arguments[0].text;
  return undefined;
}

/** Resolves one import binding without TypeScript checker state. */
function readImportedBinding(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): { readonly exportName: string; readonly moduleSpecifier: string } | undefined {
  if (!ts.isIdentifier(expression)) return undefined;
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier))
      continue;
    if (statement.importClause?.name?.text === expression.text)
      return { exportName: 'default', moduleSpecifier: statement.moduleSpecifier.text };
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || ts.isNamespaceImport(bindings)) continue;
    const element = bindings.elements.find((candidate) => candidate.name.text === expression.text);
    if (element !== undefined)
      return {
        exportName: (element.propertyName ?? element.name).text,
        moduleSpecifier: statement.moduleSpecifier.text,
      };
  }
  return undefined;
}

/** Finds an exported const/function/default expression by its public ESM name. */
function findExportInitializer(
  sourceFile: ts.SourceFile,
  exportName: string,
): ts.Expression | undefined {
  for (const statement of sourceFile.statements) {
    if (exportName === 'default' && ts.isExportAssignment(statement)) return statement.expression;
    if (
      !ts.isVariableStatement(statement) ||
      !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    )
      continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === exportName &&
        declaration.initializer !== undefined
      )
        return declaration.initializer;
    }
  }
  return undefined;
}

/** Accepts only identifier parameters because destructuring/mutation has no stable alias contract. */
function readIdentifierParameter(parameter: ts.ParameterDeclaration): string | undefined {
  return ts.isIdentifier(parameter.name) ? parameter.name.text : undefined;
}

/** Parses TS/TSX according to the supplied extension without touching compiler program state. */
function parseSource(sourcePath: string, sourceText: string): ts.SourceFile {
  return ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    sourcePath.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** Removes transparent TypeScript wrappers before testing syntax shape. */
function unwrap(expression: ts.Expression): ts.Expression {
  let value = expression;
  while (
    ts.isParenthesizedExpression(value) ||
    ts.isAsExpression(value) ||
    ts.isSatisfiesExpression(value) ||
    ts.isTypeAssertionExpression(value)
  )
    value = value.expression;
  return value;
}
