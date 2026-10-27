/** Reads inert deferred-export transport without executing application loaders or factories. */
import ts from 'typescript';
import type { PreviewRenderLazyFact } from './previewRenderModuleFacts';

/** A declaration's already-parsed expression and stable graph identity. */
interface DeferredImportOwner {
  readonly analysisNode: ts.Node;
  readonly id: string;
}

/** React import aliases needed to prove that a dynamic import is actually consumed by React.lazy. */
interface ReactLazyBindings {
  readonly directNames: ReadonlySet<string>;
  readonly namespaceNames: ReadonlySet<string>;
}

/** Keeps established React/Next lazy edges beside explicit factory-loader value transport. */
export function collectPreviewRenderDeferredImportFacts(
  sourceFile: ts.SourceFile,
  values: readonly DeferredImportOwner[],
): readonly PreviewRenderLazyFact[] {
  const bindings = collectReactLazyBindings(sourceFile);
  return values.flatMap((value) => [
    ...collectLazyFacts(value, bindings),
    ...collectFactoryLoaderFacts(value, bindings),
  ]);
}

/**
 * Carries an explicitly selected export from a direct factory-loader argument to its result.
 * The edge is conditional value flow, like passing a static component binding to a factory.
 * Arbitrary nested imports, unselected module namespaces and callback effects prove no export.
 */
function collectFactoryLoaderFacts(
  value: DeferredImportOwner,
  bindings: ReactLazyBindings,
): readonly PreviewRenderLazyFact[] {
  const call = value.analysisNode;
  if (
    !ts.isCallExpression(call) ||
    !ts.isIdentifier(call.expression) ||
    isReactLazyCall(call, bindings)
  )
    return [];
  const facts: PreviewRenderLazyFact[] = [];
  for (const argument of call.arguments) {
    if (
      (!ts.isArrowFunction(argument) && !ts.isFunctionExpression(argument)) ||
      argument.parameters.length !== 0
    )
      continue;
    const body = readSingleReturnedExpression(argument.body);
    if (
      body === undefined ||
      !ts.isCallExpression(body) ||
      body.arguments.length !== 1 ||
      !ts.isPropertyAccessExpression(body.expression) ||
      body.expression.name.text !== 'then'
    )
      continue;
    const imported = body.expression.expression;
    if (
      !ts.isCallExpression(imported) ||
      imported.expression.kind !== ts.SyntaxKind.ImportKeyword ||
      imported.arguments.length !== 1
    )
      continue;
    const specifier = imported.arguments[0];
    const selection = body.arguments[0];
    if (
      specifier === undefined ||
      !ts.isStringLiteralLike(specifier) ||
      selection === undefined ||
      (!ts.isArrowFunction(selection) && !ts.isFunctionExpression(selection)) ||
      selection.parameters.length !== 1
    )
      continue;
    const parameter = selection.parameters[0];
    const result = readSingleReturnedExpression(selection.body);
    if (
      parameter === undefined ||
      !ts.isIdentifier(parameter.name) ||
      result === undefined ||
      !ts.isPropertyAccessExpression(result) ||
      !ts.isIdentifier(result.expression) ||
      result.expression.text !== parameter.name.text
    )
      continue;
    facts.push({
      importedName: result.name.text,
      kind: 'value-flow',
      moduleSpecifier: specifier.text,
      occurrenceStart: call.getStart(),
      ownerId: value.id,
    });
  }
  return facts;
}

/** Requires one unambiguous return; guarded, effectful, and multi-statement loaders stay opaque. */
function readSingleReturnedExpression(body: ts.ConciseBody): ts.Expression | undefined {
  if (!ts.isBlock(body)) return body;
  const statement = body.statements[0];
  return body.statements.length === 1 && statement !== undefined && ts.isReturnStatement(statement)
    ? statement.expression
    : undefined;
}

/**
 * Reads aliases that prove a call expression is React.lazy, a React namespace lazy member, or
 * Next's `dynamic` (the default export of `next/dynamic`). `dynamic(() => import('./Page'))`
 * renders that module's component exactly like a lazy boundary, so a page whose only child is a
 * dynamic `MainImpl` keeps it in the render chain instead of reading it as an unrelated branch.
 */
function collectReactLazyBindings(sourceFile: ts.SourceFile): ReactLazyBindings {
  const directNames = new Set<string>();
  const namespaceNames = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
    ) {
      continue;
    }
    if (statement.moduleSpecifier.text === 'next/dynamic') {
      const dynamicName = statement.importClause?.name;
      if (dynamicName !== undefined) directNames.add(dynamicName.text);
      continue;
    }
    if (statement.moduleSpecifier.text !== 'react') continue;
    const clause = statement.importClause;
    if (clause?.name !== undefined) {
      namespaceNames.add(clause.name.text);
    }
    const bindings = clause?.namedBindings;
    if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
      namespaceNames.add(bindings.name.text);
    } else if (bindings !== undefined) {
      for (const element of bindings.elements) {
        if (!element.isTypeOnly && (element.propertyName ?? element.name).text === 'lazy') {
          directNames.add(element.name.text);
        }
      }
    }
  }
  return { directNames, namespaceNames };
}

/** Finds literal dynamic imports owned by a proven React.lazy call within one declaration. */
function collectLazyFacts(
  value: DeferredImportOwner,
  bindings: ReactLazyBindings,
): PreviewRenderLazyFact[] {
  const facts: PreviewRenderLazyFact[] = [];
  visit(value.analysisNode);
  return facts;

  /** Visits only syntax beneath this declaration and records each exact lazy import once. */
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && isReactLazyCall(node, bindings)) {
      const selection = readLazyImportSelection(node.arguments[0]);
      if (selection !== undefined) {
        facts.push({ ...selection, ownerId: value.id, occurrenceStart: node.getStart() });
      }
      return;
    }
    ts.forEachChild(node, visit);
  }
}

/** Proves a lazy call through a direct named import or a React namespace/default import. */
function isReactLazyCall(call: ts.CallExpression, bindings: ReactLazyBindings): boolean {
  const expression = call.expression;
  return (
    (ts.isIdentifier(expression) && bindings.directNames.has(expression.text)) ||
    (ts.isPropertyAccessExpression(expression) &&
      expression.name.text === 'lazy' &&
      ts.isIdentifier(expression.expression) &&
      bindings.namespaceNames.has(expression.expression.text))
  );
}

/** Resolves the default or `.then`-selected export from one React.lazy loader callback. */
function readLazyImportSelection(
  loader: ts.Expression | undefined,
): { readonly importedName: string; readonly moduleSpecifier: string } | undefined {
  if (loader === undefined || (!ts.isArrowFunction(loader) && !ts.isFunctionExpression(loader))) {
    return undefined;
  }
  const body = ts.isBlock(loader.body)
    ? loader.body.statements.find(ts.isReturnStatement)?.expression
    : loader.body;
  if (body === undefined) {
    return undefined;
  }
  const importCall = findDynamicImportCall(body);
  const specifier = importCall?.arguments[0];
  if (importCall === undefined || specifier === undefined || !ts.isStringLiteralLike(specifier)) {
    return undefined;
  }
  return {
    importedName: readLazySelectedExport(body) ?? 'default',
    moduleSpecifier: specifier.text,
  };
}

/** Finds the literal `import()` call under a bounded lazy loader expression. */
function findDynamicImportCall(node: ts.Node): ts.CallExpression | undefined {
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return node;
  }
  let selected: ts.CallExpression | undefined;
  ts.forEachChild(node, (child) => {
    selected ??= findDynamicImportCall(child);
  });
  return selected;
}

/** Recognizes common `then(module => module.Named)` and `{ default: module.Named }` adapters. */
function readLazySelectedExport(body: ts.Expression): string | undefined {
  if (
    !ts.isCallExpression(body) ||
    !ts.isPropertyAccessExpression(body.expression) ||
    body.expression.name.text !== 'then'
  ) {
    return undefined;
  }
  const callback = body.arguments[0];
  if (
    callback === undefined ||
    (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
  ) {
    return undefined;
  }
  const parameterName = callback.parameters[0]?.name;
  if (parameterName === undefined || !ts.isIdentifier(parameterName)) {
    return undefined;
  }
  const result = ts.isBlock(callback.body)
    ? callback.body.statements.find(ts.isReturnStatement)?.expression
    : callback.body;
  return result === undefined ? undefined : readSelectedModuleProperty(result, parameterName.text);
}

/** Reads a module property directly or from an object literal's `default` adapter property. */
function readSelectedModuleProperty(
  expression: ts.Expression,
  moduleName: string,
): string | undefined {
  const unwrapped = ts.isParenthesizedExpression(expression) ? expression.expression : expression;
  if (
    ts.isPropertyAccessExpression(unwrapped) &&
    ts.isIdentifier(unwrapped.expression) &&
    unwrapped.expression.text === moduleName
  ) {
    return unwrapped.name.text;
  }
  if (!ts.isObjectLiteralExpression(unwrapped)) {
    return undefined;
  }
  const defaultProperty = unwrapped.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && readPropertyName(property.name) === 'default',
  );
  return defaultProperty === undefined
    ? undefined
    : readSelectedModuleProperty(defaultProperty.initializer, moduleName);
}

/** Reads only a direct literal property name; computed values remain opaque. */
function readPropertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;
}
