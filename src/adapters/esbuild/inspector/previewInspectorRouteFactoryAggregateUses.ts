/**
 * Rejects static component references recovered from locally mutated or escaped route aggregates.
 * This is syntax provenance, not an interpreter: opaque uses keep authored runtime code intact and
 * leave declared choice labels unresolved. Inert aliases and spread copies carry instability to
 * their dependants without treating a changed copy as a mutation of its original container.
 */
import ts from 'typescript';

/**
 * Returns same-file aggregate names whose initializer cannot prove a current component binding.
 *
 * @param sourceFile Parsed authored module; no project code is evaluated.
 * @param factoryCalls Exact calls already admitted by the caller's static factory/base proof.
 * @param isShadowed Existing lexical guard distinguishing unrelated nested names.
 * @returns Unstable aggregate/alias names; their declared labels may remain diagnostic metadata.
 */
export function collectPreviewInspectorUnstableRouteFactoryAggregates(
  sourceFile: ts.SourceFile,
  factoryCalls: ReadonlySet<ts.CallExpression>,
  isShadowed: (identifier: ts.Identifier) => boolean,
): ReadonlySet<string> {
  const initializers = new Map<string, ts.Expression>();
  const aggregates = new Set<string>();
  const dependants = new Map<string, Set<string>>();
  const aliases: [string, string][] = [];
  const unstable = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      (statement.declarationList.flags & ts.NodeFlags.Const) === 0
    )
      continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      const name = declaration.name.text;
      const value = unwrap(declaration.initializer);
      initializers.set(name, value);
      if (hasLiteralAccessor(value)) unstable.add(name);
      if (ts.isObjectLiteralExpression(value) || ts.isArrayLiteralExpression(value))
        aggregates.add(name);
      else if (ts.isIdentifier(value)) aliases.push([name, value.text]);
    }
  }
  for (const [alias, original] of aliases) connect(original, alias);
  const aggregateQueue = [...aggregates];
  for (const aggregate of aggregateQueue) {
    for (const alias of dependants.get(aggregate) ?? []) {
      if (aggregates.has(alias)) continue;
      aggregates.add(alias);
      aggregateQueue.push(alias);
    }
  }
  if (aggregates.size === 0) return aggregates;
  for (const [alias, original] of aliases) {
    if (!aggregates.has(alias) || !aggregates.has(original)) continue;
    connect(original, alias);
    connect(alias, original);
  }
  const visit = (node: ts.Node): void => {
    if (ts.isTypeNode(node) || ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (
      ts.isIdentifier(node) &&
      aggregates.has(node.text) &&
      isRuntimeReference(node) &&
      !isShadowed(node)
    ) {
      if (!isInertUse(node)) unstable.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const pending = [...unstable];
  for (const aggregate of pending) {
    for (const dependant of dependants.get(aggregate) ?? []) {
      if (unstable.has(dependant)) continue;
      unstable.add(dependant);
      pending.push(dependant);
    }
  }
  return unstable;

  /** Adds a local alias or shallow-copy dependency without evaluating either initializer. */
  function connect(original: string, dependant: string): void {
    const values = dependants.get(original) ?? new Set<string>();
    values.add(dependant);
    dependants.set(original, values);
  }

  /** Admits only a const transport or an aggregate used in an already-proven factory slot. */
  function isInertUse(identifier: ts.Identifier): boolean {
    let current: ts.Node = identifier;
    for (;;) {
      const parent = current.parent;
      if (isWrapper(parent) && parent.expression === current) {
        current = parent;
        continue;
      }
      if (
        (ts.isSpreadAssignment(parent) || ts.isSpreadElement(parent)) &&
        parent.expression === current
      ) {
        current = parent.parent;
        if (ts.isObjectLiteralExpression(current) || ts.isArrayLiteralExpression(current)) continue;
        return false;
      }
      if (
        ts.isVariableDeclaration(parent) &&
        parent.initializer === current &&
        ts.isIdentifier(parent.name)
      ) {
        if (
          !aggregates.has(parent.name.text) ||
          initializers.get(parent.name.text) !== unwrap(current as ts.Expression)
        )
          return false;
        connect(identifier.text, parent.name.text);
        return true;
      }
      if (
        (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
        parent.expression === current
      ) {
        const key = ts.isPropertyAccessExpression(parent)
          ? parent.name.text
          : ts.isStringLiteralLike(parent.argumentExpression) ||
              ts.isNumericLiteral(parent.argumentExpression)
            ? parent.argumentExpression.text
            : undefined;
        return key !== undefined && hasOwnDataKey(identifier.text, key) && isPropertyRead(parent);
      }
      return (
        ts.isCallExpression(parent) &&
        factoryCalls.has(parent) &&
        (parent.arguments[1] === current || parent.arguments[2] === current)
      );
    }
  }

  /** Proves a statically named own data property through literal aliases and shallow spreads. */
  function hasOwnDataKey(name: string, key: string): boolean {
    if (key === '__proto__') return false;
    const first = initializers.get(name);
    if (first === undefined) return false;
    const pending: ts.Expression[] = [first];
    const visited = new Set<ts.Expression>();
    for (const expression of pending) {
      const value = unwrap(expression);
      if (visited.has(value)) continue;
      visited.add(value);
      if (ts.isIdentifier(value)) {
        const original = initializers.get(value.text);
        if (original !== undefined) pending.push(original);
      } else if (ts.isObjectLiteralExpression(value)) {
        for (const property of value.properties) {
          if (ts.isSpreadAssignment(property)) pending.push(property.expression);
          else if (
            (ts.isPropertyAssignment(property) ||
              ts.isShorthandPropertyAssignment(property) ||
              ts.isMethodDeclaration(property)) &&
            (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) &&
            property.name.text === key
          )
            return true;
        }
      } else if (ts.isArrayLiteralExpression(value)) {
        if (key === 'length') return true;
        const index = Number(key);
        const selected = value.elements[index];
        if (
          Number.isSafeInteger(index) &&
          index >= 0 &&
          String(index) === key &&
          selected !== undefined &&
          !ts.isOmittedExpression(selected) &&
          value.elements.slice(0, index + 1).every((element) => !ts.isSpreadElement(element))
        )
          return true;
      }
    }
    return false;
  }
}

/** Excludes declaration/property spelling while preserving shorthand/computed runtime uses. */
function isRuntimeReference(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === identifier) return false;
  if (
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent)) &&
    parent.name === identifier
  )
    return false;
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent)) &&
    parent.name === identifier
  )
    return false;
  if (ts.isBindingElement(parent) && parent.propertyName === identifier) return false;
  if (
    (ts.isLabeledStatement(parent) ||
      ts.isBreakStatement(parent) ||
      ts.isContinueStatement(parent)) &&
    parent.label === identifier
  )
    return false;
  return true;
}

/** Recognizes only wrappers that preserve the exact runtime value and alias identity. */
function isWrapper(
  node: ts.Node,
): node is
  | ts.ParenthesizedExpression
  | ts.AsExpression
  | ts.SatisfiesExpression
  | ts.TypeAssertion
  | ts.NonNullExpression {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node)
  );
}

/** Removes type/parenthesis wrappers without visiting or evaluating their expressions. */
function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (isWrapper(current)) current = current.expression;
  return current;
}

/** Literal getters can change another entry while a factory enumerates the registry. */
function hasLiteralAccessor(expression: ts.Expression): boolean {
  const value = unwrap(expression);
  if (ts.isObjectLiteralExpression(value))
    return value.properties.some(
      (property) =>
        ts.isGetAccessorDeclaration(property) ||
        ts.isSetAccessorDeclaration(property) ||
        (ts.isSpreadAssignment(property) && hasLiteralAccessor(property.expression)),
    );
  return (
    ts.isArrayLiteralExpression(value) &&
    value.elements.some(
      (element) => ts.isSpreadElement(element) && hasLiteralAccessor(element.expression),
    )
  );
}

/** Rejects receiver calls and assignment targets while allowing an own data value to be read. */
function isPropertyRead(access: ts.PropertyAccessExpression | ts.ElementAccessExpression): boolean {
  let current: ts.Node = access;
  for (;;) {
    const parent = current.parent;
    if (
      (isWrapper(parent) && parent.expression === current) ||
      (ts.isPropertyAssignment(parent) && parent.initializer === current) ||
      ((ts.isSpreadAssignment(parent) || ts.isSpreadElement(parent)) &&
        parent.expression === current) ||
      ts.isObjectLiteralExpression(parent) ||
      ts.isArrayLiteralExpression(parent)
    ) {
      current = parent;
      continue;
    }
    if (
      ts.isBinaryExpression(parent) &&
      parent.left === current &&
      parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    )
      return false;
    if (
      (ts.isForInStatement(parent) || ts.isForOfStatement(parent)) &&
      parent.initializer === current
    )
      return false;
    if (ts.isDeleteExpression(parent) || ts.isPostfixUnaryExpression(parent)) return false;
    if (
      ts.isPrefixUnaryExpression(parent) &&
      (parent.operator === ts.SyntaxKind.PlusPlusToken ||
        parent.operator === ts.SyntaxKind.MinusMinusToken)
    )
      return false;
    if (
      (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
      parent.expression === current
    )
      return false;
    return !(ts.isTaggedTemplateExpression(parent) && parent.tag === current);
  }
}
