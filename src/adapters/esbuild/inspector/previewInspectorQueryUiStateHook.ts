/**
 * Proves a small Router query-string controller, without admitting general Router/effect hooks.
 * Every call and free value is checked: effects may only read the query and set local React state;
 * event actions may update that query on the current pathname. No project code is evaluated.
 */
import ts from 'typescript';

type BindingKind = 'value' | 'state' | 'setter' | 'query' | 'location' | 'navigate' | 'action';
type Bindings = Map<string, BindingKind>;
type Mode = 'effect' | 'action';
type HookFunction = ts.FunctionDeclaration | ts.ArrowFunction;

/**
 * Reuses the frontier's one parsed module, retaining only exact demanded query/UI hook exports.
 * Unknown runtime imports, top-level work, arbitrary calls and navigation outside the current
 * pathname fail closed, preserving the normal generated-value boundary.
 */
export function hasPreviewInspectorQueryUiStateHookInSourceFile(
  source: ts.SourceFile,
  exportNames: readonly string[],
): boolean {
  const diagnostics = (
    source as ts.SourceFile & {
      readonly parseDiagnostics?: readonly ts.Diagnostic[];
    }
  ).parseDiagnostics;
  if ((diagnostics?.length ?? 0) > 0) return false;
  if (exportNames.length === 0 || exportNames.some((name) => !/^use[A-Z0-9_$]/u.test(name)))
    return false;
  const hooks = new Map<string, string>();
  const functions = new Map<string, HookFunction>();
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
      for (const binding of clause.namedBindings.elements) {
        if (binding.isTypeOnly) continue;
        const imported = (binding.propertyName ?? binding.name).text;
        if (!(
          (moduleName === 'react' && ['useState', 'useEffect'].includes(imported)) ||
          (moduleName === 'react-router-dom' && ['useLocation', 'useNavigate'].includes(imported))
        ))
          return false;
        if (hooks.has(binding.name.text) || binding.name.text === 'URLSearchParams') return false;
        hooks.set(binding.name.text, imported);
      }
      continue;
    }
    if (
      ts.isTypeAliasDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isEmptyStatement(statement)
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
    return owner !== undefined && proveQueryController(owner, hooks);
  });
}

/** Proves declarations in execution order so forward aliases and shadowed hook names cannot pass. */
function proveQueryController(owner: HookFunction, hooks: ReadonlyMap<string, string>): boolean {
  if (!isSynchronous(owner) || owner.body === undefined || !ts.isBlock(owner.body)) return false;
  const bindings = readParameters(owner, new Map(), hooks);
  if (bindings === undefined) return false;
  let stateCount = 0;
  let locationCount = 0;
  let navigateCount = 0;
  let returned = false;
  for (const statement of owner.body.statements) {
    if (returned) return false;
    if (ts.isVariableStatement(statement)) {
      if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) return false;
      for (const declaration of statement.declarationList.declarations) {
        const value =
          declaration.initializer === undefined ? undefined : unwrap(declaration.initializer);
        if (value === undefined) return false;
        const hook =
          ts.isCallExpression(value) && ts.isIdentifier(value.expression)
            ? hooks.get(value.expression.text)
            : undefined;
        if (hook === 'useState') {
          const initial = ts.isCallExpression(value) ? value.arguments[0] : undefined;
          if (
            !ts.isCallExpression(value) ||
            value.arguments.length !== 1 ||
            initial === undefined ||
            !isRead(initial, bindings) ||
            !ts.isArrayBindingPattern(declaration.name) ||
            declaration.name.elements.length !== 2
          )
            return false;
          const [state, setter] = declaration.name.elements;
          if (
            state === undefined ||
            setter === undefined ||
            !ts.isBindingElement(state) ||
            !ts.isBindingElement(setter) ||
            !ts.isIdentifier(state.name) ||
            !ts.isIdentifier(setter.name) ||
            state.initializer !== undefined ||
            setter.initializer !== undefined ||
            state.dotDotDotToken !== undefined ||
            setter.dotDotDotToken !== undefined
          )
            return false;
          if (
            !bind(bindings, state.name.text, 'state', hooks) ||
            !bind(bindings, setter.name.text, 'setter', hooks)
          )
            return false;
          stateCount += 1;
        } else if (hook === 'useLocation' || hook === 'useNavigate') {
          if (
            !ts.isCallExpression(value) ||
            value.arguments.length !== 0 ||
            !ts.isIdentifier(declaration.name)
          )
            return false;
          if (
            !bind(
              bindings,
              declaration.name.text,
              hook === 'useLocation' ? 'location' : 'navigate',
              hooks,
            )
          )
            return false;
          if (hook === 'useLocation') locationCount += 1;
          else navigateCount += 1;
        } else if (!readLocalDeclaration(declaration, bindings, hooks, 'action')) return false;
      }
    } else if (ts.isExpressionStatement(statement)) {
      const call = statement.expression;
      if (
        !ts.isCallExpression(call) ||
        !ts.isIdentifier(call.expression) ||
        hooks.get(call.expression.text) !== 'useEffect' ||
        call.arguments.length !== 2
      )
        return false;
      const [callback, dependencies] = call.arguments;
      if (
        callback === undefined ||
        !ts.isArrowFunction(callback) ||
        callback.parameters.length !== 0 ||
        !proveAction(callback, bindings, hooks, 'effect') ||
        dependencies === undefined ||
        !ts.isArrayLiteralExpression(dependencies) ||
        !dependencies.elements.every((item) => isRead(item, bindings))
      )
        return false;
    } else if (ts.isReturnStatement(statement) && statement.expression !== undefined) {
      const evidence = { state: false, action: false };
      if (
        !isReturnedUi(statement.expression, bindings, hooks, evidence) ||
        !evidence.state ||
        !evidence.action
      )
        return false;
      returned = true;
    } else return false;
  }
  return returned && stateCount > 0 && locationCount === 1 && navigateCount === 1;
}

/** Local values cannot capture an unknown global or disguise a callable imported dependency. */
function readLocalDeclaration(
  declaration: ts.VariableDeclaration,
  bindings: Bindings,
  hooks: ReadonlyMap<string, string>,
  mode: Mode,
): boolean {
  if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) return false;
  const value = unwrap(declaration.initializer);
  let kind: BindingKind = 'value';
  if (isQueryConstruction(value, bindings)) kind = 'query';
  else if (ts.isArrowFunction(value)) {
    if (mode === 'effect' || !proveAction(value, bindings, hooks, 'action')) return false;
    kind = 'action';
  } else if (!isRead(value, bindings)) return false;
  return bind(bindings, declaration.name.text, kind, hooks);
}

/** An event/effect body consists solely of local declarations, guarded actions and checked calls. */
function proveAction(
  callback: ts.ArrowFunction,
  outer: Bindings,
  hooks: ReadonlyMap<string, string>,
  mode: Mode,
): boolean {
  if (!isSynchronous(callback)) return false;
  const bindings = readParameters(callback, outer, hooks);
  if (bindings === undefined) return false;
  const statement = (node: ts.Statement): boolean => {
    if (ts.isBlock(node)) {
      const local = new Map(bindings);
      const result = node.statements.every(statement);
      bindings.clear();
      for (const [name, kind] of local) bindings.set(name, kind);
      return result;
    }
    if (ts.isIfStatement(node))
      return (
        isRead(node.expression, bindings) &&
        statement(node.thenStatement) &&
        (node.elseStatement === undefined || statement(node.elseStatement))
      );
    if (ts.isVariableStatement(node))
      return (
        (node.declarationList.flags & ts.NodeFlags.Const) !== 0 &&
        node.declarationList.declarations.every((declaration) =>
          readLocalDeclaration(declaration, bindings, hooks, mode),
        )
      );
    if (ts.isExpressionStatement(node)) return isActionCall(node.expression, bindings, mode);
    return (
      ts.isReturnStatement(node) &&
      (node.expression === undefined || isActionCall(node.expression, bindings, mode))
    );
  };
  return ts.isBlock(callback.body)
    ? statement(callback.body)
    : isActionCall(callback.body, bindings, mode);
}

/** Only same-path query navigation is admitted, and never from an effect or render body. */
function isActionCall(expression: ts.Expression, bindings: Bindings, mode: Mode): boolean {
  const call = unwrap(expression);
  if (!ts.isCallExpression(call)) return false;
  const callee = unwrap(call.expression);
  if (ts.isIdentifier(callee)) {
    const kind = bindings.get(callee.text);
    if (kind === 'setter') {
      const argument = call.arguments[0];
      return call.arguments.length === 1 && argument !== undefined && isRead(argument, bindings);
    }
    if (kind === 'action')
      return mode === 'action' && call.arguments.every((argument) => isRead(argument, bindings));
    if (kind === 'navigate') {
      if (mode !== 'action' || call.arguments.length !== 2) return false;
      const [target, options] = call.arguments;
      if (
        target === undefined ||
        options === undefined ||
        !ts.isObjectLiteralExpression(target) ||
        target.properties.length !== 2 ||
        !ts.isObjectLiteralExpression(options) ||
        options.properties.length !== 1
      )
        return false;
      const pathname = readProperty(target, 'pathname');
      const search = readProperty(target, 'search');
      const replace = readProperty(options, 'replace');
      return (
        pathname !== undefined &&
        isLocationRead(pathname, bindings, 'pathname') &&
        search !== undefined &&
        isRead(search, bindings) &&
        replace?.kind === ts.SyntaxKind.TrueKeyword
      );
    }
  }
  return (
    mode === 'action' &&
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    bindings.get(callee.expression.text) === 'query' &&
    callee.name.text === 'set' &&
    call.arguments.length === 2 &&
    call.arguments.every((argument) => isRead(argument, bindings))
  );
}

/** Read expressions are inert scalars, local values and URLSearchParams reads, never arbitrary calls. */
function isRead(expression: ts.Expression, bindings: Bindings): boolean {
  const value = unwrap(expression);
  if (ts.isIdentifier(value)) return ['value', 'state'].includes(bindings.get(value.text) ?? '');
  if (
    ts.isLiteralExpression(value) ||
    [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(
      value.kind,
    )
  )
    return true;
  if (isLocationRead(value, bindings, 'search') || isLocationRead(value, bindings, 'pathname'))
    return true;
  if (ts.isBinaryExpression(value))
    return (
      [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(
        value.operatorToken.kind,
      ) &&
      isRead(value.left, bindings) &&
      isRead(value.right, bindings)
    );
  if (ts.isPrefixUnaryExpression(value))
    return value.operator === ts.SyntaxKind.ExclamationToken && isRead(value.operand, bindings);
  if (ts.isTemplateExpression(value))
    return value.templateSpans.every((span) => isRead(span.expression, bindings));
  if (
    !ts.isCallExpression(value) ||
    !ts.isPropertyAccessExpression(value.expression) ||
    !ts.isIdentifier(value.expression.expression) ||
    bindings.get(value.expression.expression.text) !== 'query'
  )
    return false;
  const method = value.expression.name.text;
  return (
    ((method === 'get' && value.arguments.length === 1) ||
      (method === 'toString' && value.arguments.length === 0)) &&
    value.arguments.every((argument) => isRead(argument, bindings))
  );
}

/** Returned objects/tuples must expose both local state and a proven event action. */
function isReturnedUi(
  expression: ts.Expression,
  bindings: Bindings,
  hooks: ReadonlyMap<string, string>,
  evidence: { state: boolean; action: boolean },
): boolean {
  const value = unwrap(expression);
  if (ts.isIdentifier(value)) {
    const kind = bindings.get(value.text);
    if (kind === 'state') evidence.state = true;
    if (kind === 'action' || kind === 'setter') evidence.action = true;
    return ['value', 'state', 'action', 'setter'].includes(kind ?? '');
  }
  if (ts.isArrowFunction(value)) {
    if (!proveAction(value, bindings, hooks, 'action')) return false;
    evidence.action = true;
    return true;
  }
  if (ts.isArrayLiteralExpression(value))
    return value.elements.every((item) => isReturnedUi(item, bindings, hooks, evidence));
  if (ts.isObjectLiteralExpression(value))
    return value.properties.every((property) =>
      ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name)
        ? isReturnedUi(property.initializer, bindings, hooks, evidence)
        : ts.isShorthandPropertyAssignment(property) &&
          property.objectAssignmentInitializer === undefined &&
          isReturnedUi(property.name, bindings, hooks, evidence),
    );
  return isRead(value, bindings);
}

/** Parameter shadowing replaces its binding kind, so a shadowed setter/navigate cannot be called. */
function readParameters(
  owner: HookFunction,
  outer: Bindings,
  hooks: ReadonlyMap<string, string>,
): Bindings | undefined {
  const bindings = new Map(outer);
  const names = new Set<string>();
  for (const parameter of owner.parameters) {
    if (
      !ts.isIdentifier(parameter.name) ||
      parameter.initializer !== undefined ||
      parameter.dotDotDotToken !== undefined ||
      names.has(parameter.name.text) ||
      hooks.has(parameter.name.text) ||
      parameter.name.text === 'URLSearchParams'
    )
      return undefined;
    names.add(parameter.name.text);
    bindings.set(parameter.name.text, 'value');
  }
  return bindings;
}

/** A fresh local query object may shadow an outer query only inside its lexical block. */
function bind(
  bindings: Bindings,
  name: string,
  kind: BindingKind,
  hooks: ReadonlyMap<string, string>,
): boolean {
  if (
    hooks.has(name) ||
    name === 'URLSearchParams' ||
    (bindings.has(name) && !(kind === 'query' && bindings.get(name) === 'query'))
  )
    return false;
  bindings.set(name, kind);
  return true;
}

/** Construction is limited to a fresh query copied from this Router location. */
function isQueryConstruction(expression: ts.Expression, bindings: Bindings): boolean {
  const argument = ts.isNewExpression(expression) ? expression.arguments?.[0] : undefined;
  return (
    ts.isNewExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'URLSearchParams' &&
    expression.arguments?.length === 1 &&
    argument !== undefined &&
    isLocationRead(argument, bindings, 'search')
  );
}

/** Router identities are never inferred from variable names alone. */
function isLocationRead(expression: ts.Expression, bindings: Bindings, property: string): boolean {
  const value = unwrap(expression);
  return (
    ts.isPropertyAccessExpression(value) &&
    value.questionDotToken === undefined &&
    value.name.text === property &&
    ts.isIdentifier(value.expression) &&
    bindings.get(value.expression.text) === 'location'
  );
}

/** Duplicate/spread/computed navigation properties cannot masquerade as this exact object shape. */
function readProperty(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  const matches = object.properties.filter(
    (property) =>
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) &&
      property.name.text === name,
  );
  const first = matches.length === 1 ? matches[0] : undefined;
  return first !== undefined && ts.isPropertyAssignment(first) ? first.initializer : undefined;
}

/** Only synchronous non-generator functions can be local UI controllers. */
function isSynchronous(owner: HookFunction): boolean {
  return (
    !(ts.isFunctionDeclaration(owner) && owner.asteriskToken !== undefined) &&
    !owner.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
  );
}

/** Erases type assertions and parentheses without following aliases or executing project code. */
function unwrap(expression: ts.Expression): ts.Expression {
  let value = expression;
  while (
    ts.isParenthesizedExpression(value) ||
    ts.isAsExpression(value) ||
    ts.isTypeAssertionExpression(value) ||
    ts.isNonNullExpression(value) ||
    ts.isSatisfiesExpression(value)
  )
    value = value.expression;
  return value;
}
