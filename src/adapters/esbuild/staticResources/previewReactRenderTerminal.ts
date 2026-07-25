/**
 * Proves bounded React render terminals without evaluating workspace JavaScript.
 *
 * Conditional-render instrumentation needs to distinguish `enabled && <Panel />` from ordinary
 * scalar computation. Direct JSX is trivial, but authored code commonly stores JSX in a local
 * constant, returns it from a map callback, or combines it through arrays and ternaries. This module
 * follows only unique lexical bindings and explicit render-shaped syntax, failing closed on shadowed,
 * ambiguous, cyclic, spread, or dynamically called values.
 */
import ts from 'typescript';
import { readPreviewLocalRenderControlFlowExpression } from './previewReactLocalRenderCalls';
import { expandPreviewReactLogicalAndExpression } from './previewReactLogicalAnd';
import type { PreviewRenderFunction } from './previewReactRenderOutcomeSyntax';

const MAX_RENDER_TERMINAL_DEPTH = 16;
const MAX_RENDER_TERMINAL_LEAVES = 16;

/** A direct JSX/factory/application-specific terminal reached through safe transparent syntax. */
export interface PreviewReactRenderTerminalEvidence {
  /** Direct render leaves in authored evaluation order, bounded for labels and overlay inference. */
  readonly terminals: readonly ts.Expression[];
  /** Local render helpers proven to contribute those leaves to an authored React return path. */
  readonly localRenderFunctions?: readonly PreviewRenderFunction[];
}

/** Extension points for exact terminals such as ReactDOM portals and JSX route records. */
export interface PreviewReactRenderTerminalOptions {
  readonly isAdditionalTerminal?: (expression: ts.Expression) => boolean;
}

type PreviewLexicalBinding =
  | { readonly kind: 'expression'; readonly node: ts.Expression; readonly start: number }
  | { readonly kind: 'function'; readonly node: PreviewRenderFunction; readonly start: number }
  | { readonly kind: 'opaque'; readonly start: number };

type PreviewLexicalScope = ts.Block | ts.SignatureDeclaration | ts.SourceFile;

/** Immutable-enough lookup built once for one source transformation. */
interface PreviewLexicalBindingIndex {
  readonly bindingsByScope: ReadonlyMap<
    PreviewLexicalScope,
    ReadonlyMap<string, readonly PreviewLexicalBinding[]>
  >;
  readonly sourceFile: ts.SourceFile;
}

/** Public analyzer surface reused for every logical guard in one parsed module. */
export interface PreviewReactRenderTerminalAnalyzer {
  readonly analyze: (expression: ts.Expression) => PreviewReactRenderTerminalEvidence | undefined;
  /** Returns lowercase/local helper functions that are actually invoked from an authored JSX path. */
  readonly collectInvokedLocalRenderFunctions: () => ReadonlySet<PreviewRenderFunction>;
}

/** Removes syntax-only wrappers before classifying a terminal or resolving an alias. */
function unwrapPreviewReactRenderTerminal(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Accepts only local helpers whose invocation contract requires no invented runtime behavior. */
function isPreviewSynchronousZeroArgumentRenderFunction(
  functionLike: PreviewRenderFunction,
): boolean {
  if (functionLike.body === undefined || functionLike.parameters.length !== 0) return false;
  const isAsync =
    ts.canHaveModifiers(functionLike) &&
    ts.getModifiers(functionLike)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword);
  if (isAsync) return false;
  return !(
    (ts.isFunctionDeclaration(functionLike) || ts.isFunctionExpression(functionLike)) &&
    functionLike.asteriskToken !== undefined
  );
}

/** Reports a conventional React element factory without accepting arbitrary project calls. */
export function isPreviewReactCreateElementCall(
  expression: ts.Expression,
): expression is ts.CallExpression {
  if (!ts.isCallExpression(expression)) return false;
  const callee = unwrapPreviewReactRenderTerminal(expression.expression);
  return (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === 'createElement' &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'React'
  );
}

/** Adds one binding record without allowing duplicate declarations to become guessed aliases. */
function addPreviewLexicalBinding(
  mutable: Map<PreviewLexicalScope, Map<string, PreviewLexicalBinding[]>>,
  scope: PreviewLexicalScope,
  name: string,
  binding: PreviewLexicalBinding,
): void {
  const bindings = mutable.get(scope) ?? new Map<string, PreviewLexicalBinding[]>();
  const records = bindings.get(name) ?? [];
  records.push(binding);
  bindings.set(name, records);
  mutable.set(scope, bindings);
}

/** Finds the nearest block/function/module whose declarations participate in lexical lookup. */
function findPreviewLexicalScope(node: ts.Node): PreviewLexicalScope {
  let current = node;
  while (!ts.isSourceFile(current)) {
    if (ts.isBlock(current) || ts.isFunctionLike(current)) return current;
    current = current.parent;
  }
  return current;
}

/** Records every identifier in a binding pattern as opaque shadowing evidence. */
function collectPreviewBindingNames(name: ts.BindingName, destination: string[]): void {
  if (ts.isIdentifier(name)) {
    destination.push(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) collectPreviewBindingNames(element.name, destination);
  }
}

/** Builds conservative lexical bindings, including parameters that must shadow outer JSX aliases. */
function createPreviewLexicalBindingIndex(sourceFile: ts.SourceFile): PreviewLexicalBindingIndex {
  const mutable = new Map<PreviewLexicalScope, Map<string, PreviewLexicalBinding[]>>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && !ts.isCatchClause(node.parent)) {
      const scope = findPreviewLexicalScope(node.parent);
      const isConstDeclaration =
        ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0;
      if (isConstDeclaration && ts.isIdentifier(node.name) && node.initializer !== undefined) {
        addPreviewLexicalBinding(mutable, scope, node.name.text, {
          kind: 'expression',
          node: node.initializer,
          start: node.getStart(sourceFile),
        });
      } else {
        const names: string[] = [];
        collectPreviewBindingNames(node.name, names);
        for (const name of names) {
          addPreviewLexicalBinding(mutable, scope, name, {
            kind: 'opaque',
            start: node.getStart(sourceFile),
          });
        }
      }
    } else if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      const scope = findPreviewLexicalScope(node.parent);
      addPreviewLexicalBinding(mutable, scope, node.name.text, {
        kind: 'function',
        node,
        start: node.getStart(sourceFile),
      });
    }
    if (ts.isCatchClause(node) && node.variableDeclaration !== undefined) {
      const names: string[] = [];
      collectPreviewBindingNames(node.variableDeclaration.name, names);
      for (const name of names) {
        addPreviewLexicalBinding(mutable, node.block, name, {
          kind: 'opaque',
          start: node.variableDeclaration.getStart(sourceFile),
        });
      }
    }
    if (ts.isFunctionLike(node)) {
      for (const parameter of node.parameters) {
        const names: string[] = [];
        collectPreviewBindingNames(parameter.name, names);
        for (const name of names) {
          addPreviewLexicalBinding(mutable, node, name, {
            kind: 'opaque',
            start: parameter.getStart(sourceFile),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { bindingsByScope: mutable, sourceFile };
}

/** Resolves exactly one nearest binding and stops on ambiguous or opaque shadowing declarations. */
function resolvePreviewLexicalBinding(
  identifier: ts.Identifier,
  index: PreviewLexicalBindingIndex,
): PreviewLexicalBinding | undefined {
  let current = identifier.parent;
  while (!ts.isSourceFile(current)) {
    if (ts.isBlock(current) || ts.isFunctionLike(current)) {
      const records = index.bindingsByScope.get(current)?.get(identifier.text);
      if (records !== undefined) {
        if (records.length !== 1) return undefined;
        const binding = records[0];
        if (binding === undefined || binding.kind === 'opaque') return undefined;
        /* A block-local value declared after the use would be in its temporal dead zone. Module
         * values may appear after a function declaration because invocation follows initialization. */
        if (
          binding.kind === 'expression' &&
          !ts.isSourceFile(current) &&
          binding.start >= identifier.getStart(index.sourceFile)
        ) {
          return undefined;
        }
        return binding;
      }
    }
    current = current.parent;
  }
  const moduleRecords = index.bindingsByScope.get(current)?.get(identifier.text);
  if (moduleRecords?.length !== 1) return undefined;
  const moduleBinding = moduleRecords[0];
  return moduleBinding?.kind === 'opaque' ? undefined : moduleBinding;
}

/** Reads every callback return without crossing into a nested function. */
export function collectPreviewRenderCallbackReturns(
  callback: PreviewRenderFunction,
): readonly ts.Expression[] {
  if (callback.body === undefined) return [];
  if (!ts.isBlock(callback.body)) return [callback.body];
  const returns: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== callback.body && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      returns.push(node.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(callback.body);
  return returns;
}

/** Proves that a direct return belongs to a conventionally named React component function. */
function isPreviewComponentOwnedReturn(statement: ts.ReturnStatement): boolean {
  let current = statement.parent;
  while (!ts.isSourceFile(current)) {
    if (ts.isFunctionLike(current)) {
      let name: string | undefined;
      if (
        (ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current)) &&
        current.name !== undefined
      ) {
        name = current.name.text;
      } else if (ts.isVariableDeclaration(current.parent) && ts.isIdentifier(current.parent.name)) {
        name = current.parent.name.text;
      }
      return name !== undefined && /^[$_\p{Lu}]/u.test(name);
    }
    current = current.parent;
  }
  return false;
}

/** Creates one bounded analyzer with lexical bindings indexed once for the parsed module. */
export function createPreviewReactRenderTerminalAnalyzer(
  sourceFile: ts.SourceFile,
  options: PreviewReactRenderTerminalOptions = {},
): PreviewReactRenderTerminalAnalyzer {
  const bindings = createPreviewLexicalBindingIndex(sourceFile);

  /** Combines distinct direct leaves while retaining authored order and the public label budget. */
  const combine = (
    records: readonly (PreviewReactRenderTerminalEvidence | undefined)[],
  ): PreviewReactRenderTerminalEvidence | undefined => {
    const terminals: ts.Expression[] = [];
    const localRenderFunctions: PreviewRenderFunction[] = [];
    for (const record of records) {
      for (const terminal of record?.terminals ?? []) {
        if (!terminals.includes(terminal) && terminals.length < MAX_RENDER_TERMINAL_LEAVES) {
          terminals.push(terminal);
        }
      }
      for (const functionLike of record?.localRenderFunctions ?? []) {
        if (!localRenderFunctions.includes(functionLike)) localRenderFunctions.push(functionLike);
      }
    }
    return terminals.length === 0
      ? undefined
      : {
          ...(localRenderFunctions.length === 0 ? {} : { localRenderFunctions }),
          terminals,
        };
  };

  /**
   * Resolves one direct zero-argument local render call through immutable identifier aliases.
   *
   * Imported/member calls remain opaque, and the visited-node set prevents recursive helper aliases
   * from expanding indefinitely. The function body is still syntax; it is never invoked here.
   */
  const resolveLocalRenderFunction = (
    expression_: ts.Expression,
    visitedBindings: ReadonlySet<ts.Node>,
    depth: number,
  ):
    | {
        readonly functionLike: PreviewRenderFunction;
        readonly visitedBindings: ReadonlySet<ts.Node>;
      }
    | undefined => {
    if (depth > MAX_RENDER_TERMINAL_DEPTH) return undefined;
    const expression = unwrapPreviewReactRenderTerminal(expression_);
    if (!ts.isIdentifier(expression)) return undefined;
    const binding = resolvePreviewLexicalBinding(expression, bindings);
    if (binding === undefined || binding.kind === 'opaque' || visitedBindings.has(binding.node)) {
      return undefined;
    }
    const nextVisited = new Set(visitedBindings);
    nextVisited.add(binding.node);
    if (binding.kind === 'function') {
      return isPreviewSynchronousZeroArgumentRenderFunction(binding.node)
        ? { functionLike: binding.node, visitedBindings: nextVisited }
        : undefined;
    }
    const value = unwrapPreviewReactRenderTerminal(binding.node);
    if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
      return isPreviewSynchronousZeroArgumentRenderFunction(value)
        ? { functionLike: value, visitedBindings: nextVisited }
        : undefined;
    }
    return ts.isIdentifier(value)
      ? resolveLocalRenderFunction(value, nextVisited, depth + 1)
      : undefined;
  };

  /** Recursively follows only syntax whose resulting value can carry proven React output. */
  const analyze = (
    expression_: ts.Expression,
    visitedBindings: ReadonlySet<ts.Node>,
    depth: number,
  ): PreviewReactRenderTerminalEvidence | undefined => {
    if (depth > MAX_RENDER_TERMINAL_DEPTH) return undefined;
    const expression = unwrapPreviewReactRenderTerminal(expression_);
    if (
      ts.isJsxElement(expression) ||
      ts.isJsxSelfClosingElement(expression) ||
      ts.isJsxFragment(expression) ||
      isPreviewReactCreateElementCall(expression) ||
      options.isAdditionalTerminal?.(expression) === true
    ) {
      return { terminals: [expression] };
    }
    const logicalAnd = expandPreviewReactLogicalAndExpression(expression);
    if (logicalAnd !== undefined) {
      return analyze(logicalAnd.terminal, visitedBindings, depth + 1);
    }
    if (ts.isConditionalExpression(expression)) {
      return combine([
        analyze(expression.whenTrue, visitedBindings, depth + 1),
        analyze(expression.whenFalse, visitedBindings, depth + 1),
      ]);
    }
    if (ts.isArrayLiteralExpression(expression)) {
      return combine(
        expression.elements.map((element) =>
          ts.isSpreadElement(element) ? undefined : analyze(element, visitedBindings, depth + 1),
        ),
      );
    }
    if (ts.isIdentifier(expression)) {
      const binding = resolvePreviewLexicalBinding(expression, bindings);
      if (binding?.kind !== 'expression' || visitedBindings.has(binding.node)) return undefined;
      const nextVisited = new Set(visitedBindings);
      nextVisited.add(binding.node);
      return analyze(binding.node, nextVisited, depth + 1);
    }
    if (
      ts.isCallExpression(expression) &&
      expression.arguments.length === 0 &&
      expression.questionDotToken === undefined
    ) {
      const resolved = resolveLocalRenderFunction(
        expression.expression,
        visitedBindings,
        depth + 1,
      );
      if (resolved !== undefined) {
        const returned = readPreviewLocalRenderControlFlowExpression(
          resolved.functionLike,
          MAX_RENDER_TERMINAL_DEPTH - depth,
        );
        const evidence =
          returned === undefined
            ? undefined
            : analyze(returned, resolved.visitedBindings, depth + 1);
        if (evidence !== undefined) {
          return {
            localRenderFunctions: [...(evidence.localRenderFunctions ?? []), resolved.functionLike],
            terminals: evidence.terminals,
          };
        }
      }
    }
    if (
      ts.isCallExpression(expression) &&
      ts.isPropertyAccessExpression(expression.expression) &&
      (expression.expression.name.text === 'map' || expression.expression.name.text === 'flatMap')
    ) {
      const callbackValue = expression.arguments[0];
      if (callbackValue === undefined) return undefined;
      const callbackExpression = unwrapPreviewReactRenderTerminal(callbackValue);
      let callback: PreviewRenderFunction | undefined;
      if (ts.isArrowFunction(callbackExpression) || ts.isFunctionExpression(callbackExpression)) {
        callback = callbackExpression;
      } else if (ts.isIdentifier(callbackExpression)) {
        const binding = resolvePreviewLexicalBinding(callbackExpression, bindings);
        if (binding?.kind === 'function') callback = binding.node;
        else if (
          binding?.kind === 'expression' &&
          (ts.isArrowFunction(binding.node) || ts.isFunctionExpression(binding.node))
        ) {
          callback = binding.node;
        }
      }
      return callback === undefined
        ? undefined
        : combine(
            collectPreviewRenderCallbackReturns(callback).map((returned) =>
              analyze(returned, visitedBindings, depth + 1),
            ),
          );
    }
    return undefined;
  };

  /**
   * Finds local render helpers only where authored React output actually consumes their result.
   *
   * JSX child expressions are strong evidence. Direct component returns are also admitted, while JSX
   * attribute callbacks and returns from lowercase event/data helpers remain excluded.
   */
  const collectInvokedLocalRenderFunctions = (): ReadonlySet<PreviewRenderFunction> => {
    const invoked = new Set<PreviewRenderFunction>();
    const visit = (node: ts.Node): void => {
      let expression: ts.Expression | undefined;
      if (
        ts.isJsxExpression(node) &&
        node.expression !== undefined &&
        !ts.isJsxAttribute(node.parent)
      ) {
        expression = node.expression;
      } else if (
        ts.isReturnStatement(node) &&
        node.expression !== undefined &&
        isPreviewComponentOwnedReturn(node)
      ) {
        expression = node.expression;
      }
      if (expression !== undefined) {
        const evidence = analyze(expression, new Set(), 0);
        for (const functionLike of evidence?.localRenderFunctions ?? []) {
          invoked.add(functionLike);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return invoked;
  };

  return {
    analyze: (expression) => analyze(expression, new Set(), 0),
    collectInvokedLocalRenderFunctions,
  };
}
