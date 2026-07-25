/**
 * Classifies custom hooks by authored value flow instead of treating every `useX` import as data.
 *
 * A custom hook is often an orchestration layer: it receives a query/store/context value, applies
 * defaults, filters records, computes Boolean branches, or normalizes a view model. Replacing that
 * whole function with a generated value erases the application's rendering decisions. This module
 * keeps such authored computation authentic while allowing a direct external-hook pass-through to
 * remain a cheap projection leaf. It parses source only; no workspace code is evaluated.
 */
import ts from 'typescript';
import { hasPreviewInspectorLocalUiStateHookInSourceFile } from './previewInspectorLocalUiStateHook';
import { hasPreviewInspectorStaticRenderDataHookInSourceFile } from './previewInspectorStaticRenderDataHook';

const HOOK_NAME_PATTERN = /^use[A-Z0-9_$][A-Za-z0-9_$]*$/u;

type HookFunction = ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression;

/** Local syntax facts required to follow expressions that contribute to one hook's return value. */
interface HookValueFlow {
  /** Direct local variable initializers followed without crossing a function boundary. */
  readonly initializers: ReadonlyMap<string, ts.Expression>;
  /** Function parameters and destructured hook results that are transparent input values. */
  readonly transparentNames: ReadonlySet<string>;
}

/**
 * Returns true when a demanded hook owns authored rendering logic that must execute verbatim.
 *
 * Specialized proofs first retain React-local state controllers and substantial UI catalogs. The
 * general value-flow pass then detects defaults, branch control, object/view-model construction,
 * collection transforms, formatter calls, and transforming callbacks passed to another hook.
 * Conversely, `return useQuery(...)`, `return query.data`, and equivalent direct aliases remain
 * projectable leaves so VirtualPage can still bound expensive backend/application graphs.
 *
 * @param sourcePath Absolute source identity used only to select the TypeScript parser mode.
 * @param sourceText Dirty-editor or filesystem source snapshot; parsed but never evaluated.
 * @param exportNames Exact runtime-hook exports demanded by the retained importer.
 */
export function hasPreviewInspectorAuthoredHookLogic(
  sourcePath: string,
  sourceText: string,
  exportNames: readonly string[],
): boolean {
  const demandedExports = [...new Set(exportNames)];
  if (
    demandedExports.length === 0 ||
    demandedExports.some(
      (exportName) => exportName !== 'default' && !HOOK_NAME_PATTERN.test(exportName),
    )
  ) {
    return false;
  }
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    readScriptKind(sourcePath),
  );
  if (
    hasPreviewInspectorLocalUiStateHookInSourceFile(sourceFile, demandedExports) ||
    hasPreviewInspectorStaticRenderDataHookInSourceFile(sourceFile, demandedExports)
  ) {
    return true;
  }
  const functionsByExport = collectExportedHookFunctions(sourceFile);
  return (
    demandedExports.some((exportName) => {
      const hookFunction = functionsByExport.get(exportName);
      return hookFunction !== undefined && hookOwnsAuthoredReturnLogic(hookFunction);
    }) || hasDemandedHookReexport(sourceFile, demandedExports)
  );
}

/**
 * Keeps a hook barrel authentic long enough for the corridor to classify its concrete child.
 *
 * Explicit re-exports and one unambiguous wildcard barrel are structural routing nodes, not value
 * leaves. Retaining the barrel lets the next resolver edge decide whether the implementation owns
 * computation or is itself a direct data/effect pass-through.
 */
function hasDemandedHookReexport(
  sourceFile: ts.SourceFile,
  exportNames: readonly string[],
): boolean {
  const demanded = new Set(exportNames);
  const wildcardDeclarations: ts.ExportDeclaration[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier === undefined) continue;
    const clause = statement.exportClause;
    if (clause === undefined) {
      wildcardDeclarations.push(statement);
      continue;
    }
    if (
      ts.isNamedExports(clause) &&
      clause.elements.some((element) => !element.isTypeOnly && demanded.has(element.name.text))
    ) {
      return true;
    }
  }
  return wildcardDeclarations.length === 1;
}

/**
 * Detects value construction and control flow owned by one exported hook implementation.
 *
 * Multiple authored returns are themselves a branch decision, even when each returns a transparent
 * property. Binding defaults also affect visible state before the final return and are retained.
 */
function hookOwnsAuthoredReturnLogic(hookFunction: HookFunction): boolean {
  const body = hookFunction.body;
  if (body === undefined) return false;
  if (!ts.isBlock(body)) {
    return expressionOwnsAuthoredTransform(body, createExpressionBodyFlow(hookFunction), new Set());
  }
  const flow = collectHookValueFlow(hookFunction);
  const returns = collectOwnedReturnExpressions(body);
  if (returns.length === 0) return false;
  if (hasOwnedControlFlow(body) || hasBindingDefault(body)) return true;
  return returns.some((expression) => expressionOwnsAuthoredTransform(expression, flow, new Set()));
}

/** Treats an expression-bodied hook's parameters as the only transparent local inputs. */
function createExpressionBodyFlow(hookFunction: HookFunction): HookValueFlow {
  return {
    initializers: new Map(),
    transparentNames: new Set(
      hookFunction.parameters.flatMap((parameter) => readBindingNames(parameter.name)),
    ),
  };
}

/**
 * Collects direct aliases and transparent hook-result bindings in the current function body.
 *
 * Destructuring a direct hook call does not itself transform data. Its bound names therefore act as
 * source values until a return expression filters, combines, defaults, or reconstructs them.
 */
function collectHookValueFlow(hookFunction: HookFunction): HookValueFlow {
  const body = hookFunction.body;
  const initializers = new Map<string, ts.Expression>();
  const transparentNames = new Set(
    hookFunction.parameters.flatMap((parameter) => readBindingNames(parameter.name)),
  );
  if (body === undefined || !ts.isBlock(body)) return { initializers, transparentNames };
  for (const statement of body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.initializer === undefined) continue;
      if (ts.isIdentifier(declaration.name)) {
        initializers.set(declaration.name.text, declaration.initializer);
        continue;
      }
      if (isDirectHookCall(unwrapExpression(declaration.initializer))) {
        for (const name of readBindingNames(declaration.name)) transparentNames.add(name);
      }
    }
  }
  return { initializers, transparentNames };
}

/**
 * Reports whether a returned expression constructs or computes a value beyond transparent access.
 *
 * Direct hook calls and property chains are leaves. Ordinary calls, operators, literals, arrays,
 * objects, templates, and callbacks are authored output logic. Local aliases are expanded with a
 * cycle guard so `const rows = query.data; return rows` stays a projectable pass-through.
 */
function expressionOwnsAuthoredTransform(
  expression: ts.Expression,
  flow: HookValueFlow,
  visitingNames: Set<string>,
): boolean {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) {
    if (current.text === 'undefined' || flow.transparentNames.has(current.text)) return false;
    const initializer = flow.initializers.get(current.text);
    if (initializer === undefined) return true;
    if (visitingNames.has(current.text)) return true;
    visitingNames.add(current.text);
    const result = expressionOwnsAuthoredTransform(initializer, flow, visitingNames);
    visitingNames.delete(current.text);
    return result;
  }
  if (ts.isPropertyAccessExpression(current)) {
    return expressionOwnsAuthoredTransform(current.expression, flow, visitingNames);
  }
  if (ts.isElementAccessExpression(current)) {
    return (
      expressionOwnsAuthoredTransform(current.expression, flow, visitingNames) ||
      !isStaticPropertyKey(current.argumentExpression)
    );
  }
  if (ts.isCallExpression(current)) {
    if (!isDirectHookCall(current)) return true;
    return current.arguments.some(argumentContainsTransformingCallback);
  }
  if (ts.isConditionalExpression(current) || ts.isBinaryExpression(current)) return true;
  if (ts.isObjectLiteralExpression(current)) {
    return current.properties.some((property) => {
      if (ts.isPropertyAssignment(property)) {
        return (
          expressionOwnsAuthoredTransform(property.initializer, flow, visitingNames) ||
          expressionReferencesTransparentInput(property.initializer, flow, new Set())
        );
      }
      if (ts.isShorthandPropertyAssignment(property)) {
        return expressionReferencesTransparentInput(property.name, flow, new Set());
      }
      if (ts.isSpreadAssignment(property)) {
        return (
          expressionOwnsAuthoredTransform(property.expression, flow, visitingNames) ||
          expressionReferencesTransparentInput(property.expression, flow, new Set())
        );
      }
      return ts.isMethodDeclaration(property) || ts.isGetAccessorDeclaration(property);
    });
  }
  if (ts.isArrayLiteralExpression(current)) {
    return current.elements.some((element) => {
      if (ts.isOmittedExpression(element)) return false;
      const value = ts.isSpreadElement(element) ? element.expression : element;
      return (
        expressionOwnsAuthoredTransform(value, flow, visitingNames) ||
        expressionReferencesTransparentInput(value, flow, new Set())
      );
    });
  }
  if (
    ts.isTemplateExpression(current) ||
    ts.isTaggedTemplateExpression(current) ||
    ts.isArrowFunction(current) ||
    ts.isFunctionExpression(current) ||
    ts.isPrefixUnaryExpression(current) ||
    ts.isPostfixUnaryExpression(current) ||
    ts.isNewExpression(current)
  ) {
    return true;
  }
  if (current.kind === ts.SyntaxKind.NullKeyword || current.kind === ts.SyntaxKind.VoidExpression) {
    return false;
  }
  /*
   * A standalone primitive/small static object is indistinguishable from a permission/session
   * leaf. Substantial UI catalogs have already passed the specialized syntax proof above.
   */
  if (
    ts.isLiteralExpression(current) ||
    current.kind === ts.SyntaxKind.TrueKeyword ||
    current.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return false;
  }
  return current.kind !== ts.SyntaxKind.ThisKeyword;
}

/**
 * Reports whether an expression carries a parameter or direct hook result into a reconstructed
 * return object/array, even when the access itself performs no arithmetic or method call.
 */
function expressionReferencesTransparentInput(
  expression: ts.Expression,
  flow: HookValueFlow,
  visitingNames: Set<string>,
): boolean {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) {
    if (flow.transparentNames.has(current.text)) return true;
    const initializer = flow.initializers.get(current.text);
    if (initializer === undefined || visitingNames.has(current.text)) return false;
    visitingNames.add(current.text);
    const result = expressionReferencesTransparentInput(initializer, flow, visitingNames);
    visitingNames.delete(current.text);
    return result;
  }
  if (ts.isPropertyAccessExpression(current)) {
    return expressionReferencesTransparentInput(current.expression, flow, visitingNames);
  }
  if (ts.isElementAccessExpression(current)) {
    return (
      expressionReferencesTransparentInput(current.expression, flow, visitingNames) ||
      expressionReferencesTransparentInput(current.argumentExpression, flow, visitingNames)
    );
  }
  if (ts.isCallExpression(current)) {
    if (isDirectHookCall(current)) return true;
    return (
      expressionReferencesTransparentInput(current.expression, flow, visitingNames) ||
      current.arguments.some((argument) =>
        expressionReferencesTransparentInput(argument, flow, visitingNames),
      )
    );
  }
  let found = false;
  /** Scans value expressions but does not treat nested callback parameters as outer inputs. */
  const visit = (node: ts.Node): void => {
    if (found || (node !== current && ts.isFunctionLike(node))) return;
    if (
      ts.isExpression(node) &&
      node !== current &&
      expressionReferencesTransparentInput(node, flow, new Set(visitingNames))
    ) {
      found = true;
      return;
    }
    if (ts.isExpression(node) && node !== current) return;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(current, visit);
  return found;
}

/**
 * Finds selector/useMemo/query-option callbacks that transform an external value before return.
 *
 * Non-function configuration such as a GraphQL document or variables object does not by itself
 * make the enclosing direct hook call an authored transformation. Nested function properties such
 * as React Query's `select` are inspected recursively without executing the options object.
 */
function argumentContainsTransformingCallback(argument: ts.Expression): boolean {
  const current = unwrapExpression(argument);
  if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
    const body = current.body;
    if (!ts.isBlock(body)) {
      return expressionOwnsAuthoredTransform(body, createExpressionBodyFlow(current), new Set());
    }
    const flow = collectHookValueFlow(current);
    return (
      hasOwnedControlFlow(body) ||
      hasBindingDefault(body) ||
      collectOwnedReturnExpressions(body).some((expression) =>
        expressionOwnsAuthoredTransform(expression, flow, new Set()),
      )
    );
  }
  if (ts.isObjectLiteralExpression(current)) {
    return current.properties.some((property) => {
      if (ts.isPropertyAssignment(property)) {
        return argumentContainsTransformingCallback(property.initializer);
      }
      if (ts.isMethodDeclaration(property) && property.body !== undefined) {
        return argumentContainsTransformingCallback(
          ts.factory.createFunctionExpression(
            undefined,
            undefined,
            undefined,
            undefined,
            property.parameters,
            undefined,
            property.body,
          ),
        );
      }
      return false;
    });
  }
  if (ts.isArrayLiteralExpression(current)) {
    return current.elements.some(
      (element) =>
        !ts.isOmittedExpression(element) &&
        argumentContainsTransformingCallback(
          ts.isSpreadElement(element) ? element.expression : element,
        ),
    );
  }
  return false;
}

/** Recognizes a direct React/custom hook call by its call target, never by module allowlists. */
function isDirectHookCall(expression: ts.Expression): boolean {
  if (!ts.isCallExpression(expression)) return false;
  const target = unwrapExpression(expression.expression);
  if (ts.isIdentifier(target)) return HOOK_NAME_PATTERN.test(target.text);
  return (
    (ts.isPropertyAccessExpression(target) || ts.isPropertyAccessChain(target)) &&
    HOOK_NAME_PATTERN.test(target.name.text)
  );
}

/** Finds returns owned by the current function while stopping at every nested callback boundary. */
function collectOwnedReturnExpressions(body: ts.Block): readonly ts.Expression[] {
  const expressions: ts.Expression[] = [];
  /** Walks statements and control-flow containers without entering nested functions. */
  const visit = (node: ts.Node): void => {
    if (node !== body && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      expressions.push(node.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return expressions;
}

/**
 * Detects authored branching around the hook's return path.
 *
 * Conditions are kept even if both return arms are transparent aliases because choosing between
 * them is application rendering logic that a generated caller value cannot reconstruct.
 */
function hasOwnedControlFlow(body: ts.Block): boolean {
  let found = false;
  /** Stops at callbacks so a query's internal implementation cannot affect this module decision. */
  const visit = (node: ts.Node): void => {
    if (found || (node !== body && ts.isFunctionLike(node))) return;
    if (
      ts.isIfStatement(node) ||
      ts.isSwitchStatement(node) ||
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isTryStatement(node)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

/** Reports authored destructuring/default parameters that alter missing external values. */
function hasBindingDefault(body: ts.Block): boolean {
  let found = false;
  /** Checks local declarations only; nested callback defaults belong to that callback's own pass. */
  const visit = (node: ts.Node): void => {
    if (found || (node !== body && ts.isFunctionLike(node))) return;
    if (ts.isBindingElement(node) && node.initializer !== undefined) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

/** Maps direct named/default hook exports to their top-level function implementations. */
function collectExportedHookFunctions(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, HookFunction> {
  const functionsByLocalName = new Map<string, HookFunction>();
  const exportedLocalNames = new Map<string, string>();
  const directExports = new Map<string, HookFunction>();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      if (statement.name !== undefined) functionsByLocalName.set(statement.name.text, statement);
      if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
        if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
          directExports.set('default', statement);
        } else if (statement.name !== undefined) {
          exportedLocalNames.set(statement.name.text, statement.name.text);
        }
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
      continue;
    }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const expression = unwrapExpression(statement.expression);
      const implementation = unwrapHookFunction(expression);
      if (implementation !== undefined) directExports.set('default', implementation);
      else if (ts.isIdentifier(expression)) exportedLocalNames.set('default', expression.text);
    }
  }
  for (const [exportName, localName] of exportedLocalNames) {
    const implementation = functionsByLocalName.get(localName);
    if (implementation !== undefined) directExports.set(exportName, implementation);
  }
  return directExports;
}

/** Reads every identifier introduced by an identifier/object/array binding pattern. */
function readBindingNames(name: ts.BindingName): readonly string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : readBindingNames(element.name),
  );
}

/** Allows fixed object keys to remain transparent property selection. */
function isStaticPropertyKey(expression: ts.Expression): boolean {
  const current = unwrapExpression(expression);
  return ts.isStringLiteralLike(current) || ts.isNumericLiteral(current);
}

/** Removes transparent TypeScript wrappers before structural classification. */
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

/** Unwraps a function-valued export or local hook declaration. */
function unwrapHookFunction(expression: ts.Expression | undefined): HookFunction | undefined {
  if (expression === undefined) return undefined;
  const current = unwrapExpression(expression);
  return ts.isArrowFunction(current) || ts.isFunctionExpression(current) ? current : undefined;
}

/** Checks declaration modifiers without relying on deprecated mutable modifier arrays. */
function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((item) => item.kind === kind) === true
  );
}

/** Selects TS/TSX parsing without consulting project compiler state or the filesystem. */
function readScriptKind(sourcePath: string): ts.ScriptKind {
  if (/\.[cm]?tsx$/iu.test(sourcePath)) return ts.ScriptKind.TSX;
  if (/\.[cm]?jsx$/iu.test(sourcePath)) return ts.ScriptKind.JSX;
  if (/\.[cm]?ts$/iu.test(sourcePath)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}
