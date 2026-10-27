/** Reads item callbacks only from unshadowed, statically imported Lodash ordering utilities. */
import ts from 'typescript';
import { unwrapPreviewRuntimeExpression } from './previewRuntimeHookSyntax';

type UtilityBinding = 'namespace' | 'orderBy' | 'sortBy';
const bindingsBySource = new WeakMap<ts.SourceFile, ReadonlyMap<string, UtilityBinding>>();

/** One syntax-proven collection and its inline item readers; no workspace code is executed. */
export interface PreviewGraphqlCollectionUtilityUsage {
  /** Direct first argument whose exact fragment origin is checked by the caller. */
  readonly collection: ts.Expression;
  /** At most eight inline item readers; imported or dynamic iteratees remain opaque. */
  readonly callbacks: readonly (ts.ArrowFunction | ts.FunctionExpression)[];
}

/**
 * Reads direct ordering iteratees, including a bounded literal iteratee list. Arbitrary methods,
 * computed names, optional calls, spread arguments and shadowed imports remain opaque.
 */
export function readPreviewGraphqlCollectionUtilityUsage(
  call: ts.CallExpression,
): PreviewGraphqlCollectionUtilityUsage | undefined {
  if (call.questionDotToken !== undefined) return undefined;
  const callee = unwrapPreviewRuntimeExpression(call.expression);
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee) &&
        callee.questionDotToken === undefined &&
        ['orderBy', 'sortBy'].includes(callee.name.text) &&
        ts.isIdentifier(callee.expression)
      ? callee.expression.text
      : undefined;
  if (name === undefined) return undefined;
  const binding = collectUtilityBindings(call.getSourceFile()).get(name);
  if (
    binding === undefined ||
    (ts.isIdentifier(callee) ? binding === 'namespace' : binding !== 'namespace')
  )
    return undefined;
  const collection = call.arguments[0];
  const iteratee = call.arguments[1];
  if (
    collection === undefined ||
    iteratee === undefined ||
    ts.isSpreadElement(collection) ||
    ts.isSpreadElement(iteratee)
  )
    return undefined;
  const value = unwrapPreviewRuntimeExpression(iteratee);
  const candidates = ts.isArrayLiteralExpression(value) ? value.elements : [value];
  if (candidates.length === 0 || candidates.length > 8) return undefined;
  const callbacks = candidates.map((candidate) => unwrapPreviewRuntimeExpression(candidate));
  if (
    !callbacks.every(
      (callback) => ts.isArrowFunction(callback) || ts.isFunctionExpression(callback),
    )
  )
    return undefined;
  return { collection, callbacks };
}

/** Caches import identity per immutable AST, conservatively rejecting any local name collision. */
function collectUtilityBindings(source: ts.SourceFile): ReadonlyMap<string, UtilityBinding> {
  const cached = bindingsBySource.get(source);
  if (cached !== undefined) return cached;
  const bindings = new Map<string, UtilityBinding>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const clause = statement.importClause;
    if (clause === undefined || clause.phaseModifier !== undefined) continue;
    const match = /^(lodash(?:-es)?)(?:\/(orderBy|sortBy)(?:\.js)?)?$/u.exec(
      statement.moduleSpecifier.text,
    );
    if (match === null) continue;
    const selected = match[2] as 'orderBy' | 'sortBy' | undefined;
    if (clause.name !== undefined) bindings.set(clause.name.text, selected ?? 'namespace');
    const named = clause.namedBindings;
    if (named !== undefined && ts.isNamespaceImport(named) && selected === undefined)
      bindings.set(named.name.text, 'namespace');
    if (named !== undefined && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        if (element.isTypeOnly) continue;
        const exported = element.propertyName?.text ?? element.name.text;
        if (exported === 'default') bindings.set(element.name.text, selected ?? 'namespace');
        else if (selected === undefined && (exported === 'orderBy' || exported === 'sortBy'))
          bindings.set(element.name.text, exported);
      }
    }
  }
  if (bindings.size > 0) {
    const discardBinding = (name: ts.BindingName): void => {
      if (ts.isIdentifier(name)) bindings.delete(name.text);
      else
        for (const element of name.elements)
          if (ts.isBindingElement(element)) discardBinding(element.name);
    };
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) || ts.isParameter(node)) discardBinding(node.name);
      else if (
        (ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isClassDeclaration(node) ||
          ts.isClassExpression(node)) &&
        node.name !== undefined
      )
        bindings.delete(node.name.text);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  bindingsBySource.set(source, bindings);
  return bindings;
}
