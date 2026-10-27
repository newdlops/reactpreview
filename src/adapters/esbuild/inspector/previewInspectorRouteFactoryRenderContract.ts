/**
 * Reads returned Route-slot syntax and its exact factory-parameter identity without executing code.
 * Local declarations are indexed once per callback; separate sibling scopes do not erase a genuine
 * capture, and nested callbacks contribute only their own returned expressions.
 */
import ts from 'typescript';
import type { PreviewInspectorRouteFactorySlotEvidence } from './previewInspectorRouteFactory';

/** Route syntax supporting one factory owner, independent from its selectable page-map choices. */
interface RouteFactoryRenderContract {
  /** First-parameter bindings read directly beneath a returned Routes boundary. */
  readonly routeSlots: readonly PreviewInspectorRouteFactorySlotEvidence[];
  /** Literal wildcard Route found in those returned expressions. */
  readonly hasWildcardFallback: boolean;
  /** Exact returned Route occurrences reserved for authored catch-all rendering. */
  readonly wildcardFallbacks: readonly RouteFactoryWildcardFallbackSyntax[];
}

/** Source-only identity of a literal catch-all Route in the factory's returned JSX. */
interface RouteFactoryWildcardFallbackSyntax {
  /** Start of the complete Route element, in UTF-16 source offsets. */
  readonly occurrenceStart: number;
  /** Exclusive end of that same Route element. */
  readonly occurrenceEnd: number;
  /** Literal authored catch-all spelling, without interpreting project expressions. */
  readonly pattern: '*' | '/*';
}

/**
 * Reads the first authored callback through inert wrappers; computed/rest bindings never become slots.
 *
 * @param callExpression Source factory call whose returned callback syntax is inspected.
 * @param sourceFile Snapshot providing stable occurrence offsets.
 * @returns Immutable slot and fallback evidence; no project expressions are executed.
 */
export function readRouteFactoryRenderContract(
  callExpression: ts.CallExpression,
  sourceFile: ts.SourceFile,
): RouteFactoryRenderContract {
  const callback = callExpression.arguments
    .slice(3)
    .map(unwrapRouteFactorySyntax)
    .find(
      (argument): argument is ts.ArrowFunction | ts.FunctionExpression =>
        ts.isArrowFunction(argument) || ts.isFunctionExpression(argument),
    );
  const parameter = callback?.parameters[0];
  if (callback === undefined) {
    return Object.freeze({
      hasWildcardFallback: false,
      routeSlots: Object.freeze([]),
      wildcardFallbacks: Object.freeze([]),
    });
  }
  const bindings = new Map<string, string>();
  const elements =
    parameter !== undefined && ts.isObjectBindingPattern(parameter.name)
      ? parameter.name.elements
      : [];
  for (const element of elements) {
    if (element.dotDotDotToken !== undefined || !ts.isIdentifier(element.name)) continue;
    const property = element.propertyName ?? element.name;
    if (ts.isIdentifier(property) || ts.isStringLiteralLike(property)) {
      bindings.set(element.name.text, property.text);
    }
  }
  const aliases = collectRouteSlotAliases(callback, bindings);
  const shadowed = collectShadowingBindings(callback, parameter, bindings, aliases);
  const slots: PreviewInspectorRouteFactorySlotEvidence[] = [];
  const fallbacks = new Map<number, RouteFactoryWildcardFallbackSyntax>();
  /** Traverses returned syntax while keeping nested function statements outside the contract. */
  const inspectRoutes = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) {
      if (isRuntimeFunction(node)) {
        for (const expression of collectOwnedReturns(node)) inspectRoutes(expression);
      }
      return;
    }
    if (ts.isJsxElement(node) && readJsxTagName(node.openingElement.tagName) === 'Routes') {
      const inspectChildren = (children: readonly ts.JsxChild[]): void => {
        for (const child of children) {
          if (
            ts.isJsxExpression(child) &&
            child.expression !== undefined &&
            ts.isIdentifier(child.expression)
          ) {
            const reference = child.expression;
            const propertyName = bindings.get(reference.text);
            if (propertyName !== undefined && !isShadowedReference(reference, callback, shadowed)) {
              slots.push(
                Object.freeze({
                  localName: reference.text,
                  occurrenceStart: child.getStart(sourceFile),
                  propertyName,
                }),
              );
            }
          }
          const opening = ts.isJsxElement(child)
            ? child.openingElement
            : ts.isJsxSelfClosingElement(child)
              ? child
              : undefined;
          if (opening !== undefined && readJsxTagName(opening.tagName) === 'Route') {
            const pattern = readLiteralWildcardRoutePath(opening.attributes);
            if (pattern !== undefined) {
              const occurrenceStart = child.getStart(sourceFile);
              fallbacks.set(
                occurrenceStart,
                Object.freeze({ occurrenceStart, occurrenceEnd: child.end, pattern }),
              );
            }
            if (ts.isJsxElement(child)) inspectChildren(child.children);
          }
        }
      };
      inspectChildren(node.children);
    }
    ts.forEachChild(node, inspectRoutes);
  };
  for (const expression of collectOwnedReturns(callback)) inspectRoutes(expression);
  const routeSlots = slots
    .filter(
      (slot, index, values) =>
        values.findIndex((value) => value.occurrenceStart === slot.occurrenceStart) === index,
    )
    .sort((left, right) => left.occurrenceStart - right.occurrenceStart);
  const wildcardFallbacks = Object.freeze(
    [...fallbacks.values()].sort((left, right) => left.occurrenceStart - right.occurrenceStart),
  );
  return Object.freeze({
    hasWildcardFallback: wildcardFallbacks.length > 0,
    routeSlots: Object.freeze(routeSlots),
    wildcardFallbacks,
  });
}

/** Collects only returns owned by this function, including guarded returns but no nested returns. */
function collectOwnedReturns(functionLike: ts.FunctionLikeDeclaration): readonly ts.Expression[] {
  const body = functionLike.body;
  if (body === undefined) return [];
  if (!ts.isBlock(body)) return [body];
  const expressions: ts.Expression[] = [];
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

/** Separates executable function bodies from call signatures and function types. */
function isRuntimeFunction(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

/** Indexes only declarations capable of hiding a candidate first-parameter binding. */
function collectShadowingBindings(
  callback: ts.ArrowFunction | ts.FunctionExpression,
  parameter: ts.ParameterDeclaration | undefined,
  candidates: ReadonlyMap<string, string>,
  aliases: ReadonlySet<ts.VariableDeclaration>,
): ReadonlyMap<ts.Node, ReadonlySet<string>> {
  const namesByScope = new Map<ts.Node, Set<string>>();
  const append = (scope: ts.Node, binding: ts.BindingName): void => {
    if (!ts.isIdentifier(binding)) {
      for (const element of binding.elements) {
        if (ts.isBindingElement(element)) append(scope, element.name);
      }
      return;
    }
    if (!candidates.has(binding.text)) return;
    const names = namesByScope.get(scope) ?? new Set<string>();
    names.add(binding.text);
    namesByScope.set(scope, names);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isParameter(node) && node !== parameter) {
      append(node.parent, node.name);
    } else if (ts.isCatchClause(node) && node.variableDeclaration !== undefined) {
      append(node.block, node.variableDeclaration.name);
    } else if (
      ts.isVariableDeclaration(node) &&
      !ts.isCatchClause(node.parent) &&
      !aliases.has(node)
    ) {
      const functionScoped =
        ts.isVariableDeclarationList(node.parent) &&
        (node.parent.flags & ts.NodeFlags.BlockScoped) === 0;
      const scope = findDeclarationScope(node.parent, callback, functionScoped);
      const unchangedParameterRedeclaration =
        functionScoped &&
        scope === callback &&
        node.initializer === undefined &&
        ts.isIdentifier(node.name) &&
        candidates.has(node.name.text) &&
        !ts.isForInStatement(node.parent.parent) &&
        !ts.isForOfStatement(node.parent.parent);
      if (!unchangedParameterRedeclaration) append(scope, node.name);
    } else if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isEnumDeclaration(node)) &&
      node.name !== undefined
    ) {
      append(findDeclarationScope(node.parent, callback, false), node.name);
    } else if (
      (ts.isFunctionExpression(node) || ts.isClassExpression(node)) &&
      node !== callback &&
      node.name !== undefined
    ) {
      append(node, node.name);
    }
    ts.forEachChild(node, visit);
  };
  visit(callback);
  return namesByScope;
}

/**
 * Follows prior callback-local const aliases and identity-preserving array filters only.
 * The callback still runs its authored filters; this proves where its returned Route elements came
 * from without evaluating predicates, treating mapped values or mutable aliases as route slots.
 */
function collectRouteSlotAliases(
  callback: ts.ArrowFunction | ts.FunctionExpression,
  bindings: Map<string, string>,
): ReadonlySet<ts.VariableDeclaration> {
  const aliases = new Set<ts.VariableDeclaration>();
  if (!ts.isBlock(callback.body)) return aliases;
  for (const statement of callback.body.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      (statement.declarationList.flags & ts.NodeFlags.Const) === 0
    )
      continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.initializer === undefined ||
        bindings.has(declaration.name.text)
      )
        continue;
      let source = unwrapRouteFactorySyntax(declaration.initializer);
      let depth = 0;
      while (
        ts.isCallExpression(source) &&
        ts.isPropertyAccessExpression(source.expression) &&
        source.expression.name.text === 'filter' &&
        source.questionDotToken === undefined &&
        source.expression.questionDotToken === undefined &&
        source.arguments.length === 1 &&
        depth++ < 8
      ) {
        source = unwrapRouteFactorySyntax(source.expression.expression);
      }
      const propertyName = ts.isIdentifier(source) ? bindings.get(source.text) : undefined;
      if (propertyName === undefined) continue;
      bindings.set(declaration.name.text, propertyName);
      aliases.add(declaration);
    }
  }
  return aliases;
}

/** Models block/loop/case bindings and function-wide var bindings without building a type program. */
function findDeclarationScope(node: ts.Node, callback: ts.Node, functionScoped: boolean): ts.Node {
  let current = node;
  while (current !== callback && !ts.isSourceFile(current)) {
    if (ts.isFunctionLike(current) || ts.isClassStaticBlockDeclaration(current)) return current;
    if (
      !functionScoped &&
      (ts.isBlock(current) ||
        ts.isCaseBlock(current) ||
        ts.isForStatement(current) ||
        ts.isForInStatement(current) ||
        ts.isForOfStatement(current))
    )
      return current;
    current = current.parent;
  }
  return current;
}

/** A same-spelled name is admitted only when no intervening declaration replaces its identity. */
function isShadowedReference(
  reference: ts.Identifier,
  callback: ts.Node,
  namesByScope: ReadonlyMap<ts.Node, ReadonlySet<string>>,
): boolean {
  let current = reference.parent;
  while (!ts.isSourceFile(current)) {
    if (namesByScope.get(current)?.has(reference.text) === true) return true;
    if (current === callback) return false;
    current = current.parent;
  }
  return true;
}

/** Reads the terminal tag spelling without resolving or executing project component values. */
function readJsxTagName(tagName: ts.JsxTagNameExpression): string {
  return tagName.getText().split('.').at(-1) ?? '';
}

/** Reads literal catch-all syntax through inert TypeScript wrappers, never calls or bindings. */
function readLiteralWildcardRoutePath(attributes: ts.JsxAttributes): '*' | '/*' | undefined {
  const attribute = attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === 'path',
  );
  const initializer = attribute?.initializer;
  const expression =
    initializer !== undefined && ts.isJsxExpression(initializer)
      ? initializer.expression
      : initializer;
  const literal = expression === undefined ? undefined : unwrapRouteFactorySyntax(expression);
  return literal !== undefined &&
    ts.isStringLiteralLike(literal) &&
    (literal.text === '*' || literal.text === '/*')
    ? literal.text
    : undefined;
}

/** Removes only inert syntax while preserving node identity; never follows calls or bindings. */
function unwrapRouteFactorySyntax(expression: ts.Expression): ts.Expression {
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
