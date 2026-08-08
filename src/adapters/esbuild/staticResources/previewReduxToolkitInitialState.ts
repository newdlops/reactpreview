/** Extracts bounded JSON-literal initial state from locally declared Redux Toolkit slices. */
import ts from 'typescript';
import type { PreviewInferredPropShape } from './reactExportPropInference';

const MAXIMUM_INITIAL_STATE_DEPTH = 8;
const MAXIMUM_INITIAL_STATE_NODES = 128;
const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

type InitialStateFunction = ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression;

interface InitialStateBudget {
  nodes: number;
}

/**
 * Returns exact literal shapes keyed by a `createSlice({ name })` value.
 * Calls are never executed: a state expression may only resolve through local zero-argument
 * functions, local constants, and JSON-compatible literals.
 */
export function collectPreviewReduxToolkitInitialStateShapes(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, PreviewInferredPropShape> {
  const createSliceNames = collectCreateSliceImports(sourceFile);
  if (createSliceNames.size === 0) return new Map();
  const functions = new Map<string, InitialStateFunction>();
  const values = new Map<string, ts.Expression>();
  collectTopLevelInitialStateBindings(sourceFile, functions, values);
  const shapes = new Map<string, PreviewInferredPropShape>();
  const ambiguousNames = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.initializer === undefined) continue;
      const call = unwrapExpression(declaration.initializer);
      if (
        !ts.isCallExpression(call) ||
        !ts.isIdentifier(call.expression) ||
        !createSliceNames.has(call.expression.text)
      ) {
        continue;
      }
      const configuration = call.arguments[0];
      if (configuration === undefined || !ts.isObjectLiteralExpression(configuration)) continue;
      const sliceName = readStaticString(readObjectProperty(configuration, 'name'));
      const initialState = readObjectProperty(configuration, 'initialState');
      if (sliceName === undefined || initialState === undefined || ambiguousNames.has(sliceName)) {
        continue;
      }
      const shape = readStaticInitialStateShape(
        initialState,
        functions,
        values,
        new Set(),
        { nodes: 0 },
        0,
      );
      if (shape === undefined) continue;
      if (shapes.has(sliceName)) {
        shapes.delete(sliceName);
        ambiguousNames.add(sliceName);
      } else {
        shapes.set(sliceName, shape);
      }
    }
  }
  return shapes;
}

/** Records only a named Redux Toolkit factory import, including local aliases. */
function collectCreateSliceImports(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== '@reduxjs/toolkit'
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (!element.isTypeOnly && (element.propertyName ?? element.name).text === 'createSlice') {
        names.add(element.name.text);
      }
    }
  }
  return names;
}

/** Indexes unique top-level functions and value expressions used by initial-state declarations. */
function collectTopLevelInitialStateBindings(
  sourceFile: ts.SourceFile,
  functions: Map<string, InitialStateFunction>,
  values: Map<string, ts.Expression>,
): void {
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      functions.set(statement.name.text, statement);
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      const initializer = unwrapExpression(declaration.initializer);
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
        functions.set(declaration.name.text, initializer);
      } else {
        values.set(declaration.name.text, initializer);
      }
    }
  }
}

/** Resolves one literal state expression while sharing strict recursion and node budgets. */
function readStaticInitialStateShape(
  expression: ts.Expression,
  functions: ReadonlyMap<string, InitialStateFunction>,
  values: ReadonlyMap<string, ts.Expression>,
  activeNames: ReadonlySet<string>,
  budget: InitialStateBudget,
  depth: number,
): PreviewInferredPropShape | undefined {
  if (depth > MAXIMUM_INITIAL_STATE_DEPTH || budget.nodes >= MAXIMUM_INITIAL_STATE_NODES) {
    return undefined;
  }
  budget.nodes += 1;
  const value = unwrapExpression(expression);
  if (ts.isIdentifier(value)) {
    if (activeNames.has(value.text)) return undefined;
    const binding = values.get(value.text);
    return binding === undefined
      ? readPrimitiveInitialStateShape(value)
      : readStaticInitialStateShape(
          binding,
          functions,
          values,
          new Set([...activeNames, value.text]),
          budget,
          depth + 1,
        );
  }
  if (
    ts.isCallExpression(value) &&
    value.arguments.length === 0 &&
    ts.isIdentifier(value.expression)
  ) {
    if (activeNames.has(value.expression.text)) return undefined;
    const function_ = functions.get(value.expression.text);
    const returned = function_ === undefined ? undefined : readDirectReturn(function_);
    return returned === undefined
      ? undefined
      : readStaticInitialStateShape(
          returned,
          functions,
          values,
          new Set([...activeNames, value.expression.text]),
          budget,
          depth + 1,
        );
  }
  const primitive = readPrimitiveInitialStateShape(value);
  if (primitive !== undefined) return primitive;
  if (ts.isObjectLiteralExpression(value)) {
    const properties: Record<string, PreviewInferredPropShape> = {};
    for (const property of value.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const propertyName = readPropertyName(property.name);
      if (propertyName === undefined || BLOCKED_PROPERTY_NAMES.has(propertyName)) continue;
      const child = readStaticInitialStateShape(
        property.initializer,
        functions,
        values,
        activeNames,
        budget,
        depth + 1,
      );
      if (child !== undefined) properties[propertyName] = child;
    }
    return Object.keys(properties).length === 0
      ? undefined
      : Object.freeze({ kind: 'object', properties: Object.freeze(properties) });
  }
  if (ts.isArrayLiteralExpression(value)) {
    if (value.elements.length === 0) return Object.freeze({ kind: 'array' });
    return undefined;
  }
  return undefined;
}

/** Materializes exact primitive literals, including signed numeric values. */
function readPrimitiveInitialStateShape(
  expression: ts.Expression,
): PreviewInferredPropShape | undefined {
  if (ts.isNumericLiteral(expression)) {
    return Object.freeze({ exactValue: true, kind: 'number', value: Number(expression.text) });
  }
  if (ts.isStringLiteralLike(expression)) {
    return Object.freeze({ exactValue: true, kind: 'string', value: expression.text });
  }
  if (expression.kind === ts.SyntaxKind.TrueKeyword) {
    return Object.freeze({ exactValue: true, kind: 'boolean', value: true });
  }
  if (expression.kind === ts.SyntaxKind.FalseKeyword) {
    return Object.freeze({ exactValue: true, kind: 'boolean', value: false });
  }
  if (expression.kind === ts.SyntaxKind.NullKeyword) {
    return Object.freeze({ exactValue: true, kind: 'null', value: null });
  }
  if (
    ts.isPrefixUnaryExpression(expression) &&
    (expression.operator === ts.SyntaxKind.PlusToken ||
      expression.operator === ts.SyntaxKind.MinusToken) &&
    ts.isNumericLiteral(expression.operand)
  ) {
    const value = Number(expression.getText());
    return Number.isFinite(value)
      ? Object.freeze({ exactValue: true, kind: 'number', value })
      : undefined;
  }
  return undefined;
}

/** Reads a direct object-literal property without getters, spreads, or computed keys. */
function readObjectProperty(
  object: ts.ObjectLiteralExpression,
  propertyName: string,
): ts.Expression | undefined {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && readPropertyName(property.name) === propertyName) {
      return property.initializer;
    }
  }
  return undefined;
}

/** Reads one identifier, string, or numeric property name. */
function readPropertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

/** Resolves a direct string literal used as the slice identity. */
function readStaticString(expression: ts.Expression | undefined): string | undefined {
  if (expression === undefined) return undefined;
  const value = unwrapExpression(expression);
  return ts.isStringLiteralLike(value) ? value.text : undefined;
}

/** Reads a concise body or a block with one direct return statement. */
function readDirectReturn(function_: InitialStateFunction): ts.Expression | undefined {
  const body = function_.body;
  if (body === undefined) return undefined;
  if (!ts.isBlock(body)) return body;
  if (body.statements.length !== 1) return undefined;
  const statement = body.statements[0];
  return statement !== undefined && ts.isReturnStatement(statement)
    ? statement.expression
    : undefined;
}

/** Removes TypeScript-only and parenthesis wrappers. */
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
