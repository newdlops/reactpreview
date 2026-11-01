/**
 * Resolves deferred JSX handler proof in each reference's own lexical environment.
 *
 * Only immutable syntax facts are retained, weakly owned by the private parser tree. Full write
 * scans run once per statement scope; visibility and declaration order remain per event. Opaque,
 * mutable, ambiguous and hoisted shadowing bindings stop lookup instead of borrowing outer proof.
 * No imports, project functions, getters or runtime values are evaluated here.
 */
import ts from 'typescript';

/** Local syntax whose eventual call target can be checked by the bounded handler analyzer. */
export type PreviewDeferredUiHandlerDeclaration =
  | ts.ArrowFunction
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.Identifier
  | ts.PropertyAccessExpression;

/** An existing binding may deliberately have no admissible handler or setter evidence. */
interface HandlerBinding {
  /** Earliest source position after which a non-hoisted initializer can supply evidence. */
  readonly declaredAt?: number;
  /** Exact immutable initializer or unreassigned function declaration, when proven. */
  readonly handler?: PreviewDeferredUiHandlerDeclaration;
  /** Local state value paired with this exact useState setter binding. */
  readonly stateName?: string;
}

const scopeBindings = new WeakMap<ts.Node, ReadonlyMap<string, HandlerBinding>>();
const scopeWrites = new WeakMap<ts.Node, ReadonlySet<string>>();

/** Returns only the current reference's admissible declaration; unknown bindings stop lookup. */
export function readPreviewDeferredUiHandler(
  reference: ts.Identifier,
  usePosition: number,
): PreviewDeferredUiHandlerDeclaration | undefined {
  return readVisibleBinding(reference, usePosition)?.handler;
}

/** Resolves a setter by binding identity so callback parameters cannot inherit outer tuple proof. */
export function readPreviewDeferredUiStateSetter(
  reference: ts.Identifier,
  usePosition: number,
): string | undefined {
  return readVisibleBinding(reference, usePosition)?.stateName;
}

/** Keeps an extracted setter call in the same lexical bindings when replayed at the JSX event. */
export function canReplayPreviewDeferredUiStateTransition(
  call: ts.CallExpression,
  eventNode: ts.Node,
): boolean {
  const argument = call.arguments[0];
  if (argument === undefined) return false;
  return [unwrapExpression(call.expression), unwrapExpression(argument)].every(
    (value) =>
      !ts.isIdentifier(value) ||
      readVisibleBindingAt(value, value.text) === readVisibleBindingAt(eventNode, value.text),
  );
}

/** Searches lexical owners without treating another closure's use-site scope as its environment. */
function readVisibleBinding(
  reference: ts.Identifier,
  usePosition: number,
): HandlerBinding | undefined {
  const binding = readVisibleBindingAt(reference, reference.text);
  return binding?.declaredAt !== undefined && binding.declaredAt >= usePosition
    ? undefined
    : binding;
}

/** Reads the nearest binding of a name from an exact syntax position, including opaque shadows. */
function readVisibleBindingAt(node: ts.Node, name: string): HandlerBinding | undefined {
  let current = node.parent;
  while (!ts.isSourceFile(current)) {
    if (
      ts.isBlock(current) ||
      ts.isModuleBlock(current) ||
      ts.isClassStaticBlockDeclaration(current) ||
      ts.isCaseBlock(current) ||
      ts.isFunctionLike(current) ||
      ts.isCatchClause(current) ||
      ts.isForStatement(current) ||
      ts.isForInStatement(current) ||
      ts.isForOfStatement(current) ||
      ts.isClassExpression(current)
    ) {
      const bindings = readScopeBindings(current);
      const binding = bindings.get(name);
      if (binding !== undefined) return binding;
    }
    current = current.parent;
  }
  return readScopeBindings(current).get(name);
}

/** Indexes all direct bindings, including names that cannot themselves prove safe activation. */
function readScopeBindings(scope: ts.Node): ReadonlyMap<string, HandlerBinding> {
  const cached = scopeBindings.get(scope);
  if (cached !== undefined) return cached;
  const bindings = new Map<string, HandlerBinding>();
  const admit = (name: string, binding: HandlerBinding): void => {
    bindings.set(name, bindings.has(name) ? {} : binding);
  };
  const mask = (name: ts.BindingName): void => {
    for (const identifier of readBindingNames(name)) admit(identifier, {});
  };
  if (
    ts.isBlock(scope) ||
    ts.isSourceFile(scope) ||
    ts.isModuleBlock(scope) ||
    ts.isCaseBlock(scope)
  ) {
    const statements = ts.isCaseBlock(scope)
      ? scope.clauses.flatMap((clause) => [...clause.statements])
      : scope.statements;
    const writes = readScopeWrites(scope, statements);
    for (const statement of statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
        admit(statement.name.text, writes.has(statement.name.text) ? {} : { handler: statement });
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          const evidence = readVariableEvidence(declaration, statement, writes);
          for (const name of readBindingNames(declaration.name))
            admit(name, evidence.get(name) ?? {});
        }
      } else if (
        (ts.isClassDeclaration(statement) ||
          ts.isEnumDeclaration(statement) ||
          ts.isModuleDeclaration(statement)) &&
        statement.name !== undefined &&
        ts.isIdentifier(statement.name)
      ) {
        admit(statement.name.text, {});
      } else if (ts.isImportDeclaration(statement) && statement.importClause !== undefined) {
        const clause = statement.importClause;
        if (clause.name !== undefined) mask(clause.name);
        if (clause.namedBindings !== undefined) {
          if (ts.isNamespaceImport(clause.namedBindings)) mask(clause.namedBindings.name);
          else for (const element of clause.namedBindings.elements) mask(element.name);
        }
      } else if (ts.isImportEqualsDeclaration(statement)) mask(statement.name);
    }
  } else if (ts.isFunctionLike(scope)) {
    for (const parameter of scope.parameters) mask(parameter.name);
    if (ts.isFunctionExpression(scope) && scope.name !== undefined) mask(scope.name);
    const body = (scope as ts.FunctionLikeDeclaration).body;
    if (body !== undefined) collectHoistedVarNames(body, mask);
  } else if (ts.isClassStaticBlockDeclaration(scope)) {
    collectHoistedVarNames(scope.body, mask);
  } else if (ts.isCatchClause(scope)) {
    if (scope.variableDeclaration !== undefined) mask(scope.variableDeclaration.name);
  } else if (ts.isForStatement(scope) || ts.isForInStatement(scope) || ts.isForOfStatement(scope)) {
    if (scope.initializer !== undefined && ts.isVariableDeclarationList(scope.initializer))
      for (const declaration of scope.initializer.declarations) mask(declaration.name);
  } else if (ts.isClassExpression(scope) && scope.name !== undefined) mask(scope.name);
  if (ts.isSourceFile(scope) || ts.isModuleBlock(scope)) collectHoistedVarNames(scope, mask);
  scopeBindings.set(scope, bindings);
  return bindings;
}

/** Retains const handlers and never-reassigned state tuples with their declaration order. */
function readVariableEvidence(
  declaration: ts.VariableDeclaration,
  statement: ts.VariableStatement,
  writes: ReadonlySet<string>,
): ReadonlyMap<string, HandlerBinding> {
  const evidence = new Map<string, HandlerBinding>();
  const initializer = declaration.initializer;
  const declaredAt = statement.getStart();
  if (
    (statement.declarationList.flags & ts.NodeFlags.Const) !== 0 &&
    ts.isIdentifier(declaration.name) &&
    initializer !== undefined &&
    !writes.has(declaration.name.text) &&
    (ts.isArrowFunction(initializer) ||
      ts.isFunctionExpression(initializer) ||
      ts.isIdentifier(initializer) ||
      ts.isPropertyAccessExpression(initializer))
  )
    evidence.set(declaration.name.text, { declaredAt, handler: initializer });
  if (
    !ts.isArrayBindingPattern(declaration.name) ||
    initializer === undefined ||
    !ts.isCallExpression(initializer)
  )
    return evidence;
  const callee = unwrapExpression(initializer.expression);
  const [state, setter] = declaration.name.elements;
  if (
    ((ts.isIdentifier(callee) && callee.text === 'useState') ||
      (ts.isPropertyAccessExpression(callee) && callee.name.text === 'useState')) &&
    state !== undefined &&
    setter !== undefined &&
    ts.isBindingElement(state) &&
    ts.isBindingElement(setter) &&
    ts.isIdentifier(state.name) &&
    ts.isIdentifier(setter.name) &&
    !writes.has(setter.name.text)
  )
    evidence.set(setter.name.text, { declaredAt, stateName: state.name.text });
  return evidence;
}

/** Removes type-only syntax without changing the executable callee or argument. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  )
    current = current.expression;
  return current;
}

/** Collects destructured declaration names without traversing default-value expressions. */
function readBindingNames(name: ts.BindingName): readonly string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isBindingElement(element) ? readBindingNames(element.name) : [],
  );
}

/** Masks function/source-scoped vars in sibling blocks without entering other functions or classes. */
function collectHoistedVarNames(root: ts.Node, mask: (name: ts.BindingName) => void): void {
  const visit = (node: ts.Node): void => {
    if (
      node !== root &&
      (ts.isFunctionLike(node) || ts.isClassLike(node) || ts.isModuleBlock(node))
    )
      return;
    if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.BlockScoped) === 0)
      for (const declaration of node.declarations) mask(declaration.name);
    ts.forEachChild(node, visit);
  };
  visit(root);
}

/**
 * Caches a complete conservative write scan, including nested callback writes, per lexical scope.
 * Unknown assignment timing must never authorize a replaced function as a visibility handler.
 */
function readScopeWrites(scope: ts.Node, statements: readonly ts.Statement[]): ReadonlySet<string> {
  const cached = scopeWrites.get(scope);
  if (cached !== undefined) return cached;
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      collectAssignedNames(node.left, names);
    } else if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      collectAssignedNames(node.operand, names);
    } else if (
      (ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
      !ts.isVariableDeclarationList(node.initializer)
    ) {
      collectAssignedNames(node.initializer, names);
    }
    ts.forEachChild(node, visit);
  };
  for (const statement of statements) visit(statement);
  scopeWrites.set(scope, names);
  return names;
}

/** Records identifier targets of assignments, updates and nested destructuring without evaluation. */
function collectAssignedNames(node: ts.Expression, names: Set<string>): void {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    collectAssignedNames(node.expression, names);
  } else if (ts.isIdentifier(node)) names.add(node.text);
  else if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  ) {
    collectAssignedNames(node.left, names);
  } else if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) {
      if (!ts.isOmittedExpression(element))
        collectAssignedNames(ts.isSpreadElement(element) ? element.expression : element, names);
    }
  } else if (ts.isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      if (ts.isShorthandPropertyAssignment(property)) names.add(property.name.text);
      else if (ts.isPropertyAssignment(property)) collectAssignedNames(property.initializer, names);
      else if (ts.isSpreadAssignment(property)) collectAssignedNames(property.expression, names);
    }
  }
}
