/**
 * Recognizes self-contained React hooks that own only local visual state and its UI actions.
 *
 * VirtualPage replaces most project hooks with inert, demand-shaped values so network, session,
 * permission, and application stores cannot block a static preview. That policy must not replace a
 * modal/drawer controller such as `useModalActions`: its `show()` callback and `show` value form one
 * coherent local state machine. This analyzer proves that narrow shape without executing authored
 * code, allowing the corridor plugin to retain only safe React-local controllers verbatim.
 */
import ts from 'typescript';

const STATE_HOOK_NAME = 'useState';
const CALLBACK_HOOK_NAME = 'useCallback';

type HookFunction = ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression;

/** React import identities needed to distinguish hooks from similarly named project functions. */
interface ReactHookBindings {
  /** Local identifiers imported as React's `useCallback`. */
  readonly callbackHooks: ReadonlySet<string>;
  /** Default or namespace React bindings that may own `.useState` and `.useCallback`. */
  readonly namespaces: ReadonlySet<string>;
  /** Local identifiers imported as React's `useState`. */
  readonly stateHooks: ReadonlySet<string>;
}

/** One local state slot and the setter that is allowed to mutate only that slot. */
interface LocalStateBinding {
  readonly setterName: string;
  readonly stateName: string;
}

/**
 * Returns true when every demanded export is a self-contained local UI-state controller.
 *
 * Proof is intentionally strict:
 * - runtime imports may come only from React;
 * - the hook must bind `useState`;
 * - returned actions must be direct callbacks that call the local setter with a static value; and
 * - the return value must expose both the state and at least one such action.
 *
 * A hook using effects, stores, queries, fetches, unknown helpers, or non-React runtime imports is
 * rejected and continues through the normal generated-value boundary.
 *
 * @param sourcePath Absolute source identity used only to choose the parser mode.
 * @param sourceText Dirty-editor or filesystem source snapshot; it is parsed but never evaluated.
 * @param exportNames Exact runtime hook exports demanded by the retained visual component.
 */
export function hasPreviewInspectorLocalUiStateHook(
  sourcePath: string,
  sourceText: string,
  exportNames: readonly string[],
): boolean {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    readScriptKind(sourcePath),
  );
  return hasPreviewInspectorLocalUiStateHookInSourceFile(sourceFile, exportNames);
}

/**
 * Reuses an already parsed source file when a broader authored-hook policy evaluates the module.
 *
 * @param sourceFile Inert TypeScript syntax tree owned by the current build evidence cache.
 * @param exportNames Exact runtime hook exports demanded by the retained visual component.
 */
export function hasPreviewInspectorLocalUiStateHookInSourceFile(
  sourceFile: ts.SourceFile,
  exportNames: readonly string[],
): boolean {
  const demandedExports = [...new Set(exportNames)];
  if (
    demandedExports.length === 0 ||
    demandedExports.some((exportName) => !/^use[A-Z0-9_$]/u.test(exportName))
  ) {
    return false;
  }
  const reactBindings = collectReactHookBindings(sourceFile);
  if (reactBindings === undefined || hasUnsafeTopLevelRuntime(sourceFile)) return false;
  const functionsByExport = collectExportedHookFunctions(sourceFile);
  return demandedExports.every((exportName) => {
    const hookFunction = functionsByExport.get(exportName);
    return (
      hookFunction !== undefined && isSelfContainedLocalUiStateHook(hookFunction, reactBindings)
    );
  });
}

/**
 * Collects React hook bindings while rejecting every project/package runtime dependency.
 *
 * Type-only imports remain safe because TypeScript erases them before module evaluation. Bare
 * side-effect imports and mixed non-type bindings are runtime work and therefore fail the proof.
 */
function collectReactHookBindings(sourceFile: ts.SourceFile): ReactHookBindings | undefined {
  const callbackHooks = new Set<string>();
  const namespaces = new Set<string>();
  const stateHooks = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const moduleName = ts.isStringLiteralLike(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : '';
    const clause = statement.importClause;
    if (clause === undefined) return undefined;
    if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
    if (moduleName !== 'react') {
      if (clause.name !== undefined) return undefined;
      const bindings = clause.namedBindings;
      if (
        bindings === undefined ||
        ts.isNamespaceImport(bindings) ||
        bindings.elements.some((element) => !element.isTypeOnly)
      ) {
        return undefined;
      }
      continue;
    }
    if (clause.name !== undefined) namespaces.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      const importedName = (element.propertyName ?? element.name).text;
      if (importedName === STATE_HOOK_NAME) stateHooks.add(element.name.text);
      if (importedName === CALLBACK_HOOK_NAME) callbackHooks.add(element.name.text);
    }
  }
  return { callbackHooks, namespaces, stateHooks };
}

/**
 * Rejects module-initialization behavior that could escape the local hook proof.
 *
 * Function declarations and function-valued variables are inert until called. Other top-level
 * initializers may contain static constants, but calls, construction, await/yield, and tagged
 * templates are not allowed because they can perform application/bootstrap work during import.
 */
function hasUnsafeTopLevelRuntime(sourceFile: ts.SourceFile): boolean {
  for (const statement of sourceFile.statements) {
    if (ts.isExpressionStatement(statement) || ts.isClassDeclaration(statement)) return true;
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (initializer === undefined || unwrapHookFunction(initializer) !== undefined) continue;
      const result = { unsafe: false };
      /** Finds eagerly evaluated constructs but does not enter nested inert functions. */
      const visit = (node: ts.Node): void => {
        if (result.unsafe || (node !== initializer && ts.isFunctionLike(node))) return;
        if (
          ts.isCallExpression(node) ||
          ts.isNewExpression(node) ||
          ts.isAwaitExpression(node) ||
          ts.isYieldExpression(node) ||
          ts.isTaggedTemplateExpression(node)
        ) {
          result.unsafe = true;
          return;
        }
        ts.forEachChild(node, visit);
      };
      visit(initializer);
      if (result.unsafe) return true;
    }
  }
  return false;
}

/** Maps direct named hook exports to their top-level function implementations. */
function collectExportedHookFunctions(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, HookFunction> {
  const functionsByLocalName = new Map<string, HookFunction>();
  const exportedLocalNames = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      functionsByLocalName.set(statement.name.text, statement);
      if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
        exportedLocalNames.set(statement.name.text, statement.name.text);
      }
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const implementation = unwrapHookFunction(declaration.initializer);
        if (implementation === undefined) continue;
        functionsByLocalName.set(declaration.name.text, implementation);
        if (exported) exportedLocalNames.set(declaration.name.text, declaration.name.text);
      }
      continue;
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        exportedLocalNames.set(element.name.text, (element.propertyName ?? element.name).text);
      }
    }
  }
  return new Map(
    [...exportedLocalNames].flatMap(([exportName, localName]) => {
      const implementation = functionsByLocalName.get(localName);
      return implementation === undefined ? [] : [[exportName, implementation] as const];
    }),
  );
}

/**
 * Proves one hook body is a closed state/action pair with no unknown runtime calls.
 *
 * The proof deliberately supports only direct top-level bindings. This covers reusable visibility
 * controllers while avoiding control-flow aliases whose runtime behavior would require evaluation.
 */
function isSelfContainedLocalUiStateHook(
  hookFunction: HookFunction,
  reactBindings: ReactHookBindings,
): boolean {
  const body = hookFunction.body;
  if (body === undefined || !ts.isBlock(body)) return false;
  const states: LocalStateBinding[] = [];
  const callbackInitializers = new Map<string, ts.Expression>();
  const returnExpressions: ts.Expression[] = [];
  for (const statement of body.statements) {
    if (ts.isReturnStatement(statement) && statement.expression !== undefined) {
      returnExpressions.push(statement.expression);
      continue;
    }
    if (!ts.isVariableStatement(statement)) return false;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (initializer === undefined) return false;
      const stateElement = ts.isArrayBindingPattern(declaration.name)
        ? declaration.name.elements[0]
        : undefined;
      const setterElement = ts.isArrayBindingPattern(declaration.name)
        ? declaration.name.elements[1]
        : undefined;
      if (
        stateElement !== undefined &&
        setterElement !== undefined &&
        ts.isBindingElement(stateElement) &&
        ts.isBindingElement(setterElement) &&
        ts.isIdentifier(stateElement.name) &&
        ts.isIdentifier(setterElement.name) &&
        ts.isCallExpression(unwrapExpression(initializer)) &&
        isReactHookCall(
          unwrapExpression(initializer) as ts.CallExpression,
          STATE_HOOK_NAME,
          reactBindings,
        )
      ) {
        states.push({
          stateName: stateElement.name.text,
          setterName: setterElement.name.text,
        });
        continue;
      }
      if (ts.isIdentifier(declaration.name)) {
        callbackInitializers.set(declaration.name.text, initializer);
        continue;
      }
      return false;
    }
  }
  if (states.length === 0 || returnExpressions.length === 0) return false;
  const setterNames = new Set(states.map((state) => state.setterName));
  const actionNames = new Set(
    [...callbackInitializers].flatMap(([name, initializer]) =>
      isSafeStateAction(initializer, setterNames, reactBindings) ? [name] : [],
    ),
  );
  if (actionNames.size === 0 || hasUnknownHookCall(body, setterNames, reactBindings)) return false;
  const returnedNames = collectReferencedIdentifiers(returnExpressions);
  return (
    states.some((state) => returnedNames.has(state.stateName)) &&
    [...actionNames].some((actionName) => returnedNames.has(actionName))
  );
}

/** Proves an action is a direct callback whose only runtime call updates a local state setter. */
function isSafeStateAction(
  initializer: ts.Expression,
  setterNames: ReadonlySet<string>,
  reactBindings: ReactHookBindings,
): boolean {
  const current = unwrapExpression(initializer);
  let callback: ts.Expression | undefined = current;
  if (ts.isCallExpression(current)) {
    if (!isReactHookCall(current, CALLBACK_HOOK_NAME, reactBindings)) return false;
    callback = current.arguments[0];
  }
  if (
    callback === undefined ||
    (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
  ) {
    return false;
  }
  let setterCalls = 0;
  const result = { safe: true };
  /** Allows syntax wrappers and static expressions, while rejecting every call except a setter. */
  const visit = (node: ts.Node): void => {
    if (!result.safe || (node !== callback && ts.isFunctionLike(node))) return;
    if (ts.isCallExpression(node)) {
      const stateValue = node.arguments[0];
      if (
        !ts.isIdentifier(node.expression) ||
        !setterNames.has(node.expression.text) ||
        node.arguments.length !== 1 ||
        stateValue === undefined ||
        !isStaticStateValue(stateValue)
      ) {
        result.safe = false;
        return;
      }
      setterCalls += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(callback);
  return result.safe && setterCalls > 0;
}

/** Rejects effects, queries, helpers, and every call outside React state/callback or its setter. */
function hasUnknownHookCall(
  body: ts.Block,
  setterNames: ReadonlySet<string>,
  reactBindings: ReactHookBindings,
): boolean {
  let unknown = false;
  /** Visits callbacks too because their calls execute when the returned UI action fires. */
  const visit = (node: ts.Node): void => {
    if (unknown) return;
    if (
      ts.isCallExpression(node) &&
      !isReactHookCall(node, STATE_HOOK_NAME, reactBindings) &&
      !isReactHookCall(node, CALLBACK_HOOK_NAME, reactBindings) &&
      !(ts.isIdentifier(node.expression) && setterNames.has(node.expression.text))
    ) {
      unknown = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return unknown;
}

/** Matches either a named React hook import or a method on an imported React namespace. */
function isReactHookCall(
  call: ts.CallExpression,
  importedName: typeof STATE_HOOK_NAME | typeof CALLBACK_HOOK_NAME,
  bindings: ReactHookBindings,
): boolean {
  const expression = call.expression;
  if (ts.isIdentifier(expression)) {
    return (importedName === STATE_HOOK_NAME ? bindings.stateHooks : bindings.callbackHooks).has(
      expression.text,
    );
  }
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    bindings.namespaces.has(expression.expression.text) &&
    expression.name.text === importedName
  );
}

/** Allows deterministic visibility values without evaluating project functions or identifiers. */
function isStaticStateValue(expression: ts.Expression): boolean {
  const current = unwrapExpression(expression);
  return (
    current.kind === ts.SyntaxKind.TrueKeyword ||
    current.kind === ts.SyntaxKind.FalseKeyword ||
    current.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(current) && current.text === 'undefined') ||
    ts.isStringLiteralLike(current) ||
    ts.isNumericLiteral(current) ||
    (ts.isPrefixUnaryExpression(current) && ts.isNumericLiteral(current.operand))
  );
}

/** Collects identifier references from returned expressions without resolving or evaluating them. */
function collectReferencedIdentifiers(expressions: readonly ts.Expression[]): ReadonlySet<string> {
  const names = new Set<string>();
  /** Records every identifier; declaration names cannot appear inside the supplied expressions. */
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) names.add(node.text);
    ts.forEachChild(node, visit);
  };
  for (const expression of expressions) visit(expression);
  return names;
}

/** Removes transparent TypeScript wrappers before classifying an expression. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
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

/** Unwraps transparent TypeScript syntax around a top-level arrow/function initializer. */
function unwrapHookFunction(expression: ts.Expression | undefined): HookFunction | undefined {
  if (expression === undefined) return undefined;
  const current = unwrapExpression(expression);
  return ts.isArrowFunction(current) || ts.isFunctionExpression(current) ? current : undefined;
}

/** Checks a declaration modifier without depending on deprecated mutable modifier arrays. */
function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((item) => item.kind === kind) === true
  );
}

/** Selects TS/TSX parsing without consulting the filesystem or project compiler configuration. */
function readScriptKind(sourcePath: string): ts.ScriptKind {
  if (/\.[cm]?tsx$/iu.test(sourcePath)) return ts.ScriptKind.TSX;
  if (/\.[cm]?jsx$/iu.test(sourcePath)) return ts.ScriptKind.JSX;
  if (/\.[cm]?ts$/iu.test(sourcePath)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}
