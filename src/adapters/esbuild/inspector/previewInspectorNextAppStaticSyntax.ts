/**
 * Supplies syntax-only guards for bounded Next App `generateStaticParams` inference.
 *
 * This module owns lexical binding and loop-shape recognition so the parameter evidence reader can
 * focus on value traversal. Every helper operates on an already parsed TypeScript tree; no project
 * module is imported, evaluated, or searched outside the caller's explicit source boundary.
 */
import path from 'node:path';
import ts from 'typescript';

/** One lexical declaration reached before a use without crossing its owning block. */
export interface StaticLocalBinding {
  readonly bindingKey: string;
  readonly initializer: ts.Expression;
  readonly propertyName?: string;
}

/** Recursion guard shared by local aliases, computed properties, and imported object literals. */
export interface StaticExpressionReadState {
  readonly depth: number;
  readonly visited: ReadonlySet<string>;
}

/** Literal allow-list guard that filters values yielded by one `for...in` registry loop. */
export interface StaticForInIncludesGuard {
  readonly allowedValues: readonly string[];
  readonly propertyName: string;
}

/** Recursively detects a named binding so unsupported destructuring shadows outer bindings. */
export function bindingNameContainsIdentifier(name: ts.BindingName, localName: string): boolean {
  if (ts.isIdentifier(name)) return name.text === localName;
  return name.elements.some(
    (element) =>
      !ts.isOmittedExpression(element) && bindingNameContainsIdentifier(element.name, localName),
  );
}

/** Classifies the identifier introduced by a `for...in` or `for...of` initializer. */
export function readLoopBindingMatch(
  initializer: ts.Expression | ts.VariableDeclarationList,
  localName: string,
): 'identifier' | 'unsupported' | undefined {
  if (ts.isIdentifier(initializer)) {
    return initializer.text === localName ? 'unsupported' : undefined;
  }
  if (!ts.isVariableDeclarationList(initializer)) return undefined;
  for (const declaration of initializer.declarations) {
    if (!bindingNameContainsIdentifier(declaration.name, localName)) continue;
    return ts.isIdentifier(declaration.name) ? 'identifier' : 'unsupported';
  }
  return undefined;
}

/** Proves that a loop-bound value contributes to an imperative parameter collection push. */
export function isExpressionInsideCollectionPush(
  expression: ts.Expression,
  owner: ts.ForInStatement | ts.ForOfStatement,
): boolean {
  for (let current: ts.Node = expression; current !== owner; current = current.parent) {
    if (!ts.isCallExpression(current)) continue;
    const callee = unwrapExpression(current.expression);
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'push') return true;
  }
  return false;
}

/** Detects one bounded `.push(...)` sink anywhere in an iterator body for local alias tracing. */
export function loopContainsCollectionPush(owner: ts.ForInStatement | ts.ForOfStatement): boolean {
  let visited = 0;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || visited >= 512) return;
    visited += 1;
    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression);
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'push') {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(owner.statement);
  return found;
}

/**
 * Reads `[literal, ...].includes(item.property)` when it directly guards a loop's push sink.
 * The item alias must be assigned from `collection[loopKey]`, preventing an unrelated condition
 * elsewhere in the body from filtering the inferred registry entry.
 */
export function readForInLiteralIncludesGuard(
  owner: ts.ForInStatement,
  loopKeyName: string,
): StaticForInIncludesGuard | undefined {
  let result: StaticForInIncludesGuard | undefined;
  let visited = 0;
  const visit = (node: ts.Node): void => {
    if (result !== undefined || visited >= 512) return;
    visited += 1;
    if (ts.isIfStatement(node) && nodeContainsCollectionPush(node.thenStatement)) {
      const guard = findLiteralIncludesGuard(node.expression);
      if (guard !== undefined) {
        const binding = findVisibleStaticLocalBinding(
          owner.getSourceFile(),
          guard.itemLocalName,
          guard.itemExpression,
        );
        const initializer = binding?.initializer && unwrapExpression(binding.initializer);
        const keyExpression =
          initializer !== undefined && ts.isElementAccessExpression(initializer)
            ? unwrapExpression(initializer.argumentExpression)
            : undefined;
        if (
          binding?.propertyName === undefined &&
          initializer !== undefined &&
          ts.isElementAccessExpression(initializer) &&
          keyExpression !== undefined &&
          ts.isIdentifier(keyExpression) &&
          keyExpression.text === loopKeyName &&
          unwrapExpression(initializer.expression).getText() ===
            unwrapExpression(owner.expression).getText()
        ) {
          result = Object.freeze({
            allowedValues: Object.freeze(guard.allowedValues),
            propertyName: guard.propertyName,
          });
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(owner.statement);
  return result;
}

/** Finds one literal `.includes(item.property)` term inside a bounded Boolean condition. */
function findLiteralIncludesGuard(expression: ts.Expression):
  | {
      readonly allowedValues: string[];
      readonly itemExpression: ts.Identifier;
      readonly itemLocalName: string;
      readonly propertyName: string;
    }
  | undefined {
  let result:
    | {
        readonly allowedValues: string[];
        readonly itemExpression: ts.Identifier;
        readonly itemLocalName: string;
        readonly propertyName: string;
      }
    | undefined;
  let visited = 0;
  const visit = (node: ts.Node): void => {
    if (result !== undefined || visited >= 64) return;
    visited += 1;
    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'includes'
    ) {
      const collection = unwrapExpression(node.expression.expression);
      const argument = node.arguments[0] && unwrapExpression(node.arguments[0]);
      if (
        ts.isArrayLiteralExpression(collection) &&
        argument !== undefined &&
        ts.isPropertyAccessExpression(argument) &&
        ts.isIdentifier(argument.expression)
      ) {
        const allowedValues = collection.elements
          .slice(0, 16)
          .map((element) =>
            ts.isSpreadElement(element) || ts.isOmittedExpression(element)
              ? undefined
              : readSafeScalar(unwrapExpression(element)),
          );
        if (allowedValues.length > 0 && allowedValues.every((value) => value !== undefined)) {
          result = {
            allowedValues,
            itemExpression: argument.expression,
            itemLocalName: argument.expression.text,
            propertyName: argument.name.text,
          };
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return result;
}

/** Detects a `.push(...)` call inside one already bounded syntax subtree. */
function nodeContainsCollectionPush(node: ts.Node): boolean {
  let found = false;
  let visited = 0;
  const visit = (current: ts.Node): void => {
    if (found || visited >= 256) return;
    visited += 1;
    if (ts.isCallExpression(current)) {
      const callee = unwrapExpression(current.expression);
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'push') {
        found = true;
        return;
      }
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

/** Finds the closest preceding lexical variable binding visible at one expression use. */
export function findVisibleStaticLocalBinding(
  sourceFile: ts.SourceFile,
  localName: string,
  usage: ts.Node,
): StaticLocalBinding | undefined {
  let closest: StaticLocalBinding | undefined;
  let closestStart = -1;
  const usageStart = usage.getStart(sourceFile);
  const visit = (node: ts.Node): void => {
    if (node.getStart(sourceFile) >= usageStart) return;
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      const propertyName = readLocalBindingProperty(node.name, localName);
      if (propertyName !== null && isLexicalDeclarationVisibleAt(node, usage)) {
        const declarationStart = node.getStart(sourceFile);
        if (declarationStart > closestStart) {
          closestStart = declarationStart;
          closest = {
            bindingKey: `${path.normalize(sourceFile.fileName)}\0${localName}\0${String(declarationStart)}`,
            initializer: node.initializer,
            ...(propertyName === undefined ? {} : { propertyName }),
          };
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return closest;
}

/** Recognizes only `await import("literal")` used by a local object destructure. */
export function readAwaitedDynamicImportSpecifier(expression: ts.Expression): string | undefined {
  let current = unwrapExpression(expression);
  if (!ts.isAwaitExpression(current)) return undefined;
  current = unwrapExpression(current.expression);
  const argument = ts.isCallExpression(current) ? current.arguments[0] : undefined;
  return ts.isCallExpression(current) &&
    current.expression.kind === ts.SyntaxKind.ImportKeyword &&
    current.arguments.length === 1 &&
    argument !== undefined &&
    ts.isStringLiteralLike(argument)
    ? argument.text
    : undefined;
}

/** Advances one bounded expression step without changing the active cycle set. */
export function incrementStaticExpressionReadState(
  state: StaticExpressionReadState,
): StaticExpressionReadState {
  return Object.freeze({ depth: state.depth + 1, visited: state.visited });
}

/** Adds one lexical/import binding to the current recursion path or rejects a cycle. */
export function visitStaticExpressionBinding(
  state: StaticExpressionReadState,
  bindingKey: string,
  maximumDepth: number,
): StaticExpressionReadState | undefined {
  if (state.depth >= maximumDepth || state.visited.has(bindingKey)) return undefined;
  const visited = new Set(state.visited);
  visited.add(bindingKey);
  return Object.freeze({ depth: state.depth + 1, visited });
}

/** Restricts one reached file to the known inventory or an explicitly trusted source root. */
export function isPathInsideStaticSourceBoundary(
  sourcePath: string,
  inventory: ReadonlySet<string>,
  sourceBoundary?: string,
): boolean {
  if (inventory.has(sourcePath)) return true;
  if (sourceBoundary === undefined) return false;
  const relative = path.relative(sourceBoundary, path.resolve(sourcePath));
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

/** Tests a standard TypeScript export modifier without accepting a later alias export. */
export function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ===
      true
  );
}

/** Maps a simple identifier or first-level object destructure to its initializer property. */
function readLocalBindingProperty(
  bindingName: ts.BindingName,
  localName: string,
): string | undefined | null {
  if (ts.isIdentifier(bindingName)) return bindingName.text === localName ? undefined : null;
  if (!ts.isObjectBindingPattern(bindingName)) return null;
  for (const element of bindingName.elements) {
    if (!ts.isIdentifier(element.name) || element.name.text !== localName) continue;
    return element.propertyName === undefined
      ? element.name.text
      : (readStaticPropertyName(element.propertyName) ?? null);
  }
  return null;
}

/** Ensures a block-scoped declaration's owner contains the reached use site. */
function isLexicalDeclarationVisibleAt(
  declaration: ts.VariableDeclaration,
  usage: ts.Node,
): boolean {
  let owner: ts.Node = declaration;
  while (!ts.isBlock(owner) && !ts.isSourceFile(owner)) owner = owner.parent;
  for (let current: ts.Node = usage; ; current = current.parent) {
    if (current === owner) return true;
    if (ts.isSourceFile(current)) return false;
  }
}

/** Converts static property syntax without evaluating computed expressions. */
export function readStaticPropertyName(name: ts.PropertyName | undefined): string | undefined {
  if (name === undefined) return undefined;
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

/** Accepts pathname-safe string/number literals and rejects arbitrary conversions. */
export function readSafeScalar(expression: ts.Expression): string | undefined {
  const value =
    ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression)
      ? expression.text
      : undefined;
  return value !== undefined &&
    value.length > 0 &&
    value.length <= 64 &&
    !/[\\/\u0000-\u001f\u007f]/u.test(value)
    ? value
    : undefined;
}

/** Removes syntax-only type wrappers while preserving calls and property access. */
export function unwrapExpression(expression: ts.Expression): ts.Expression {
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
