/** Proves next-themes UI controllers without admitting application IO or arbitrary browser work. */
import ts from 'typescript';

type Kind = 'value' | 'setter' | 'action' | 'transition';
type Bindings = ReadonlyMap<string, Kind>;
type Hook = ts.FunctionDeclaration | ts.ArrowFunction;

/**
 * Retains only demanded, synchronous theme controllers whose actions update the real provider.
 * Imports, declarations, free values and calls are checked without evaluating project code.
 * Unrecognized effects, stores, networking, globals and module initialization fail closed.
 */
export function hasPreviewInspectorThemeUiHookInSourceFile(
  source: ts.SourceFile,
  exportNames: readonly string[],
): boolean {
  if (exportNames.length === 0 || exportNames.some((name) => !/^use[A-Z0-9_$]/u.test(name)))
    return false;
  const imports = new Map<string, string>();
  const functions = new Map<string, Hook>();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause === undefined) return false;
      if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
      if (
        clause.name !== undefined ||
        clause.namedBindings === undefined ||
        !ts.isNamedImports(clause.namedBindings)
      )
        return false;
      const moduleName = ts.isStringLiteralLike(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : '';
      for (const element of clause.namedBindings.elements) {
        if (element.isTypeOnly) continue;
        const name = (element.propertyName ?? element.name).text;
        if (!(
          (moduleName === 'next-themes' && name === 'useTheme') ||
          (moduleName === 'react-dom' && name === 'flushSync')
        ))
          return false;
        if (imports.has(element.name.text) || ['window', 'document'].includes(element.name.text))
          return false;
        imports.set(element.name.text, name);
      }
      continue;
    }
    if (
      ts.isTypeAliasDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      (ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression))
    )
      continue;
    if (
      !ts.canHaveModifiers(statement) ||
      !ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    )
      return false;
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      functions.set(statement.name.text, statement);
    } else if (
      ts.isVariableStatement(statement) &&
      (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          !ts.isIdentifier(declaration.name) ||
          declaration.initializer === undefined ||
          !ts.isArrowFunction(declaration.initializer)
        )
          return false;
        functions.set(declaration.name.text, declaration.initializer);
      }
    } else return false;
  }
  if (functions.size !== new Set(exportNames).size) return false;
  return exportNames.every((name) => {
    const owner = functions.get(name);
    if (
      owner === undefined ||
      !synchronous(owner) ||
      owner.parameters.length > 0 ||
      owner.body === undefined ||
      !ts.isBlock(owner.body)
    )
      return false;
    const bindings = new Map<string, Kind>();
    let provider = false;
    let returned = false;
    for (const statement of owner.body.statements) {
      if (returned) return false;
      if (ts.isVariableStatement(statement)) {
        if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) return false;
        for (const declaration of statement.declarationList.declarations) {
          const value = declaration.initializer;
          if (
            value !== undefined &&
            ts.isCallExpression(value) &&
            ts.isIdentifier(value.expression) &&
            imports.get(value.expression.text) === 'useTheme'
          ) {
            if (
              provider ||
              value.arguments.length !== 0 ||
              !ts.isObjectBindingPattern(declaration.name)
            )
              return false;
            for (const element of declaration.name.elements) {
              const property = element.propertyName ?? element.name;
              if (
                !ts.isIdentifier(property) ||
                !ts.isIdentifier(element.name) ||
                element.initializer !== undefined ||
                element.dotDotDotToken !== undefined ||
                !['theme', 'resolvedTheme', 'systemTheme', 'setTheme'].includes(property.text) ||
                !bind(
                  bindings,
                  imports,
                  element.name.text,
                  property.text === 'setTheme' ? 'setter' : 'value',
                )
              )
                return false;
            }
            provider = true;
          } else if (!local(declaration, bindings, imports)) return false;
        }
      } else if (
        ts.isReturnStatement(statement) &&
        statement.expression !== undefined &&
        ts.isObjectLiteralExpression(statement.expression)
      ) {
        const kinds: Kind[] = [];
        for (const property of statement.expression.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            !ts.isIdentifier(property.name) &&
            !ts.isStringLiteral(property.name)
          )
            return false;
          if (
            ts.isShorthandPropertyAssignment(property) &&
            property.objectAssignmentInitializer !== undefined
          )
            return false;
          const value = ts.isShorthandPropertyAssignment(property)
            ? property.name
            : ts.isPropertyAssignment(property)
              ? property.initializer
              : undefined;
          if (value === undefined || !ts.isIdentifier(value)) return false;
          const kind = bindings.get(value.text);
          if (kind !== 'value' && kind !== 'action') return false;
          kinds.push(kind);
        }
        returned = kinds.includes('value') && kinds.includes('action');
        if (!returned) return false;
      } else return false;
    }
    return provider && returned;
  });
}

/** Registers a single immutable local without masking imports or browser identities. */
function bind(
  bindings: Map<string, Kind>,
  imports: ReadonlyMap<string, string>,
  name: string,
  kind: Kind,
): boolean {
  if (bindings.has(name) || imports.has(name) || ['document', 'window', 'undefined'].includes(name))
    return false;
  bindings.set(name, kind);
  return true;
}

/** Derives local action/transition identities only from already checked declarations. */
function local(
  declaration: ts.VariableDeclaration,
  bindings: Map<string, Kind>,
  imports: ReadonlyMap<string, string>,
): boolean {
  if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) return false;
  const value = declaration.initializer;
  let kind: Kind;
  if (ts.isArrowFunction(value)) {
    if (!action(value, bindings, imports)) return false;
    kind = 'action';
  } else if (
    ts.isCallExpression(value) &&
    member(value.expression) === 'document.startViewTransition'
  ) {
    if (!call(value, bindings, imports)) return false;
    kind = 'transition';
  } else {
    if (!read(value, bindings)) return false;
    kind = 'value';
  }
  return bind(bindings, imports, declaration.name.text, kind);
}

/** Allows only provider updates and their optional synchronous visual-transition envelope. */
function action(
  callback: ts.ArrowFunction,
  outer: Bindings,
  imports: ReadonlyMap<string, string>,
): boolean {
  if (!synchronous(callback) || callback.parameters.length > 0) return false;
  const statement = (node: ts.Statement, bindings: Map<string, Kind>): boolean => {
    if (ts.isBlock(node)) return block(node, new Map(bindings));
    if (ts.isIfStatement(node))
      return (
        read(node.expression, bindings) &&
        statement(node.thenStatement, new Map(bindings)) &&
        (node.elseStatement === undefined || statement(node.elseStatement, new Map(bindings)))
      );
    if (ts.isVariableStatement(node))
      return (
        (node.declarationList.flags & ts.NodeFlags.Const) !== 0 &&
        node.declarationList.declarations.every((declaration) =>
          local(declaration, bindings, imports),
        )
      );
    if (ts.isExpressionStatement(node)) return call(node.expression, bindings, imports);
    return (
      ts.isReturnStatement(node) &&
      (node.expression === undefined || call(node.expression, bindings, imports))
    );
  };
  const block = (node: ts.Block, bindings: Map<string, Kind>): boolean =>
    node.statements.every((child) => statement(child, bindings));
  const bindings = new Map(outer);
  return ts.isBlock(callback.body)
    ? block(callback.body, bindings)
    : call(callback.body, bindings, imports);
}

/** Reads only theme values, static operators, the applied class and motion/API availability. */
function read(node: ts.Expression, bindings: Bindings): boolean {
  if (ts.isIdentifier(node))
    return node.text === 'undefined' || bindings.get(node.text) === 'value';
  if (
    ts.isStringLiteralLike(node) ||
    ts.isNumericLiteral(node) ||
    [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(
      node.kind,
    )
  )
    return true;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node))
    return read(node.expression, bindings);
  if (ts.isConditionalExpression(node))
    return (
      read(node.condition, bindings) &&
      read(node.whenTrue, bindings) &&
      read(node.whenFalse, bindings)
    );
  if (ts.isBinaryExpression(node))
    return (
      [
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(node.operatorToken.kind) &&
      read(node.left, bindings) &&
      read(node.right, bindings)
    );
  if (ts.isPrefixUnaryExpression(node))
    return node.operator === ts.SyntaxKind.ExclamationToken && read(node.operand, bindings);
  if (ts.isTypeOfExpression(node))
    return member(node.expression) === 'document.startViewTransition';
  if (ts.isCallExpression(node)) {
    const argument = node.arguments[0];
    return (
      member(node.expression) === 'document.documentElement.classList.contains' &&
      node.arguments.length === 1 &&
      argument !== undefined &&
      ts.isStringLiteral(argument) &&
      argument.text === 'dark'
    );
  }
  if (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === 'matches' &&
    ts.isCallExpression(node.expression)
  ) {
    const query = node.expression;
    const argument = query.arguments[0];
    return (
      member(query.expression) === 'window.matchMedia' &&
      query.arguments.length === 1 &&
      argument !== undefined &&
      ts.isStringLiteral(argument) &&
      /^\(prefers-(?:reduced-motion: reduce|color-scheme: dark)\)$/u.test(argument.text)
    );
  }
  return false;
}

/** Every admitted call remains local to the theme provider or the browser's visual transition. */
function call(
  node: ts.Expression,
  bindings: Bindings,
  imports: ReadonlyMap<string, string>,
): boolean {
  if (!ts.isCallExpression(node)) return false;
  const target = node.expression;
  if (ts.isIdentifier(target)) {
    if (bindings.get(target.text) === 'setter') {
      const argument = node.arguments[0];
      return node.arguments.length === 1 && argument !== undefined && read(argument, bindings);
    }
    if (bindings.get(target.text) === 'action') return node.arguments.length === 0;
    if (imports.get(target.text) !== 'flushSync') return false;
  } else if (member(target) !== 'document.startViewTransition') {
    if (
      !ts.isPropertyAccessExpression(target) ||
      target.name.text !== 'catch' ||
      !ts.isPropertyAccessExpression(target.expression) ||
      target.expression.name.text !== 'ready' ||
      !ts.isIdentifier(target.expression.expression) ||
      bindings.get(target.expression.expression.text) !== 'transition'
    )
      return false;
    const callback = node.arguments[0];
    return (
      node.arguments.length === 1 &&
      callback !== undefined &&
      ts.isArrowFunction(callback) &&
      synchronous(callback) &&
      callback.parameters.length === 0 &&
      ts.isBlock(callback.body) &&
      callback.body.statements.length === 0
    );
  }
  const callback = node.arguments[0];
  return (
    node.arguments.length === 1 &&
    callback !== undefined &&
    ((ts.isIdentifier(callback) && bindings.get(callback.text) === 'action') ||
      (ts.isArrowFunction(callback) && action(callback, bindings, imports)))
  );
}

/** Static property chains cannot hide computed access or callable getters from unknown objects. */
function member(node: ts.Expression): string | undefined {
  if (ts.isIdentifier(node)) return node.text;
  if (!ts.isPropertyAccessExpression(node) || node.questionDotToken !== undefined) return undefined;
  const owner = member(node.expression);
  return owner === undefined ? undefined : owner + '.' + node.name.text;
}

/** Rejects delayed or generator work in both render and event callbacks. */
function synchronous(node: Hook): boolean {
  return (
    !ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) &&
    !(ts.isFunctionDeclaration(node) && node.asteriskToken !== undefined)
  );
}
