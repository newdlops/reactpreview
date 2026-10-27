/**
 * Infers the literal keys a project reads from a record-typed response field.
 *
 * A declared field such as `outbound_trend?: Record<string, number>` has no properties, so its
 * payload shape is an empty object and a generated response gives `{}`. Code that reads fixed keys
 * (`['w-5', 'w-4'].map((k) => trend[k])`) then sees only missing values and hides the UI built from
 * them. The keys are written in the project, not in the type, so this reader collects them from
 * reads of that exact property: direct element access, one call into a project function whose
 * parameter receives the field, literal arrays iterated by `map`/`forEach`/`for…of`, and `const`
 * key arrays. `Record<string, number>` is one shared instantiation, so evidence is scoped to the
 * property symbol, never to the type. Unknown forms contribute nothing.
 */
import path from 'node:path';
import ts from 'typescript';
import { readPreviewTypeAnalysisNodeCost } from './previewTypedJsonAnalysis';

const MAX_KEYS = 32;
const MAX_FILES = 600;
const MAX_VISITED_NODES = 200_000;
const MAX_KEY_LENGTH = 80;
const ITERATING_METHODS = new Set([
  'every',
  'filter',
  'find',
  'findIndex',
  'flatMap',
  'forEach',
  'map',
  'some',
]);

/** Reads the literal keys read from one record-typed property, cached per property symbol. */
export type PreviewRecordKeyReader = (property: ts.Symbol) => readonly string[];

/**
 * Creates a reader bound to one analysis program.
 *
 * @param program Analysis program that owns `checker`.
 * @param checker Checker used to resolve property, parameter, and alias symbols.
 * @returns Reader returning at most 32 keys in first-seen order; never throws.
 */
export function createPreviewRecordKeyReader(
  program: ts.Program,
  checker: ts.TypeChecker,
): PreviewRecordKeyReader {
  const cache = new Map<ts.Symbol, readonly string[]>();
  return (property) => {
    const cached = cache.get(property);
    if (cached !== undefined) return cached;
    let keys: readonly string[] = [];
    try {
      keys = collectRecordKeys(program, checker, property);
    } catch {
      keys = [];
    }
    cache.set(property, keys);
    return keys;
  };
}

interface KeyCollection {
  readonly keys: string[];
  visited: number;
}

/** Scans project sources for reads of `property` and the keys they use. */
function collectRecordKeys(
  program: ts.Program,
  checker: ts.TypeChecker,
  property: ts.Symbol,
): readonly string[] {
  const name = property.getName();
  const declarations = new Set(property.getDeclarations() ?? []);
  if (declarations.size === 0) return [];
  const collection: KeyCollection = { keys: [], visited: 0 };
  let files = 0;
  for (const sourceFile of program.getSourceFiles()) {
    if (
      sourceFile.isDeclarationFile ||
      sourceFile.fileName.split(path.sep).includes('node_modules') ||
      sourceFile.fileName.includes('/node_modules/') ||
      !sourceFile.text.includes(name)
    ) {
      continue;
    }
    files += 1;
    if (files > MAX_FILES) break;
    const visit = (node: ts.Node): void => {
      if (collection.keys.length >= MAX_KEYS || collection.visited >= MAX_VISITED_NODES) return;
      collection.visited = Math.min(
        MAX_VISITED_NODES,
        collection.visited + readPreviewTypeAnalysisNodeCost(node),
      );
      if (isPropertyRead(node, name) && readsProperty(checker, node, declarations)) {
        collectFromValueUse(checker, node, collection, true);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (collection.keys.length >= MAX_KEYS || collection.visited >= MAX_VISITED_NODES) break;
  }
  return collection.keys;
}

/** Matches `x.name`, `x?.name`, and `x['name']` syntactically. */
function isPropertyRead(node: ts.Node, name: string): node is ts.Expression {
  if (ts.isPropertyAccessExpression(node)) return node.name.text === name;
  return (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression) &&
    node.argumentExpression.text === name
  );
}

/** Confirms the read resolves to one of the property's declarations. */
function readsProperty(
  checker: ts.TypeChecker,
  node: ts.Expression,
  declarations: ReadonlySet<ts.Declaration>,
): boolean {
  const location = ts.isPropertyAccessExpression(node) ? node.name : node;
  const symbol = checker.getSymbolAtLocation(location);
  return (symbol?.getDeclarations() ?? []).some((declaration) => declarations.has(declaration));
}

/**
 * Collects keys from uses of one record value: element access on it, a `const` alias, and (once)
 * the parameter of a project function that receives it as an argument.
 */
function collectFromValueUse(
  checker: ts.TypeChecker,
  value: ts.Expression,
  collection: KeyCollection,
  followCall: boolean,
): void {
  const use = skipTransparentParents(value);
  const parent = use.parent;
  if (ts.isElementAccessExpression(parent) && skipTransparent(parent.expression) === value) {
    for (const key of readKeyExpression(checker, parent.argumentExpression))
      addKey(collection, key);
    return;
  }
  if (
    ts.isVariableDeclaration(parent) &&
    parent.initializer === use &&
    ts.isIdentifier(parent.name)
  ) {
    collectFromSymbolReads(checker, parent.name, parent, collection, followCall);
    return;
  }
  if (followCall && ts.isCallExpression(parent) && parent.arguments.includes(use)) {
    const declaration = checker.getResolvedSignature(parent)?.declaration;
    if (
      declaration === undefined ||
      ts.isJSDocSignature(declaration) ||
      declaration.getSourceFile().isDeclarationFile
    ) {
      return;
    }
    const parameter = declaration.parameters[parent.arguments.indexOf(use)];
    if (
      parameter !== undefined &&
      ts.isIdentifier(parameter.name) &&
      parameter.dotDotDotToken === undefined
    ) {
      collectFromSymbolReads(checker, parameter.name, declaration, collection, false);
    }
  }
}

/** Collects keys from every read of the symbol declared by `name` inside `scope`. */
function collectFromSymbolReads(
  checker: ts.TypeChecker,
  name: ts.Identifier,
  scope: ts.Node,
  collection: KeyCollection,
  followCall: boolean,
): void {
  const symbol = checker.getSymbolAtLocation(name);
  if (symbol === undefined) return;
  const visit = (node: ts.Node): void => {
    if (collection.keys.length >= MAX_KEYS || collection.visited >= MAX_VISITED_NODES) return;
    collection.visited = Math.min(
      MAX_VISITED_NODES,
      collection.visited + readPreviewTypeAnalysisNodeCost(node),
    );
    if (ts.isIdentifier(node) && node !== name && node.text === name.text) {
      if (checker.getSymbolAtLocation(node) === symbol) {
        collectFromValueUse(checker, node, collection, followCall);
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
}

/** Resolves an index expression to literal keys: a literal, or an iterated literal key array. */
function readKeyExpression(checker: ts.TypeChecker, expression: ts.Expression): readonly string[] {
  const current = skipTransparent(expression);
  if (ts.isStringLiteralLike(current)) return [current.text];
  if (!ts.isIdentifier(current)) return [];
  const declaration = checker.getSymbolAtLocation(current)?.valueDeclaration;
  if (declaration === undefined) return [];
  if (ts.isParameter(declaration)) {
    const callback = declaration.parent;
    if (
      (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) ||
      callback.parameters[0] !== declaration
    ) {
      return [];
    }
    const call = callback.parent;
    if (
      !ts.isCallExpression(call) ||
      call.arguments[0] !== callback ||
      !ts.isPropertyAccessExpression(call.expression) ||
      !ITERATING_METHODS.has(call.expression.name.text)
    ) {
      return [];
    }
    return readLiteralArray(checker, call.expression.expression);
  }
  if (
    ts.isVariableDeclaration(declaration) &&
    ts.isVariableDeclarationList(declaration.parent) &&
    ts.isForOfStatement(declaration.parent.parent)
  ) {
    return readLiteralArray(checker, declaration.parent.parent.expression);
  }
  return [];
}

/** Reads `['a', 'b']`, optionally through `as const` or one `const` binding. */
function readLiteralArray(checker: ts.TypeChecker, expression: ts.Expression): readonly string[] {
  let current = skipTransparent(expression);
  if (ts.isIdentifier(current)) {
    const declaration = checker.getSymbolAtLocation(current)?.valueDeclaration;
    if (
      declaration === undefined ||
      !ts.isVariableDeclaration(declaration) ||
      declaration.initializer === undefined ||
      !ts.isVariableDeclarationList(declaration.parent) ||
      (declaration.parent.flags & ts.NodeFlags.Const) === 0
    ) {
      return [];
    }
    current = skipTransparent(declaration.initializer);
  }
  if (!ts.isArrayLiteralExpression(current)) return [];
  const keys: string[] = [];
  for (const element of current.elements) {
    const item = skipTransparent(element);
    if (!ts.isStringLiteralLike(item)) return [];
    keys.push(item.text);
  }
  return keys;
}

/** Adds one bounded, distinct key. */
function addKey(collection: KeyCollection, key: string): void {
  if (
    key.length === 0 ||
    key.length > MAX_KEY_LENGTH ||
    key === '__proto__' ||
    key === 'constructor' ||
    key === 'prototype' ||
    collection.keys.includes(key) ||
    collection.keys.length >= MAX_KEYS
  ) {
    return;
  }
  collection.keys.push(key);
}

/** Climbs parentheses, non-null assertions, and type assertions around a value. */
function skipTransparentParents(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current.parent) ||
    ts.isNonNullExpression(current.parent) ||
    ts.isAsExpression(current.parent) ||
    ts.isSatisfiesExpression(current.parent)
  ) {
    current = current.parent;
  }
  return current;
}

/** Removes parentheses, non-null assertions, and type assertions. */
function skipTransparent(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}
