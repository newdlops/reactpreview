/**
 * Infers bounded hook-result shapes for dynamic element access such as `data[responseKey]`.
 *
 * Static property-path inference cannot serialize a runtime key as a JSON property name. This
 * adapter keeps the authored, side-effect-free identifier expression and proves the selected value
 * is a collection only from its local consumer or a uniquely declared same-file helper parameter.
 */
import ts from 'typescript';
import { isPreviewRuntimeHookArrayUsageProperty } from './previewRuntimeHookPropertyUsage';
import {
  isPreviewRuntimeFunction,
  previewRuntimeFunctionShadowsName,
  unwrapPreviewRuntimeExpression,
  unwrapPreviewRuntimeParentExpression,
  type PreviewRuntimeFunction,
} from './previewRuntimeHookSyntax';

const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const MAXIMUM_DYNAMIC_KEYS = 8;

/** Static fallback contract consumed structurally by the hook instrumentation coordinator. */
export interface PreviewRuntimeHookDynamicElementFallback {
  readonly expression: string;
  readonly label: string;
  readonly requiredPaths: readonly string[];
}

/** Builds a computed-property object only when an exact hook-bound identifier is indexed. */
export function inferPreviewRuntimeHookDynamicElementFallback(
  identifier: ts.Identifier,
  sourceFile: ts.SourceFile,
): PreviewRuntimeHookDynamicElementFallback | undefined {
  const owner = findNearestRuntimeFunction(identifier);
  if (owner === undefined) return undefined;
  const entries = new Map<string, { readonly collection: boolean; readonly expression: string }>();
  const visit = (node: ts.Node): void => {
    if (entries.size >= MAXIMUM_DYNAMIC_KEYS) return;
    if (
      node !== owner &&
      isPreviewRuntimeFunction(node) &&
      previewRuntimeFunctionShadowsName(node, identifier.text)
    )
      return;
    if (ts.isElementAccessExpression(node)) {
      const receiver = unwrapPreviewRuntimeExpression(node.expression);
      const key = readSafeDynamicKey(node.argumentExpression, sourceFile, owner);
      if (ts.isIdentifier(receiver) && receiver.text === identifier.text && key !== undefined) {
        const collection = hasCollectionDemand(node, owner, sourceFile);
        const prior = entries.get(key.text);
        if (prior === undefined || (!prior.collection && collection)) {
          entries.set(key.text, { collection, expression: key.expression });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  if (entries.size === 0) return undefined;
  const properties = [...entries.values()].map(
    (entry) =>
      `[${entry.expression}]: ${entry.collection ? 'Object.freeze([])' : 'Object.freeze({})'}`,
  );
  const requiredPaths = [...entries].map(
    ([text, entry]) => `[${text}]${entry.collection ? '.map()' : ''}`,
  );
  return {
    expression: `Object.freeze({ ${properties.join(', ')} })`,
    label: 'generated computed hook data fields',
    requiredPaths: Object.freeze(requiredPaths),
  };
}

/** Keeps only a literal or ordinary identifier already evaluated by the authored element access. */
function readSafeDynamicKey(
  argument: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
  owner: PreviewRuntimeFunction,
): { readonly expression: string; readonly text: string } | undefined {
  if (argument === undefined) return undefined;
  const value = unwrapPreviewRuntimeExpression(argument);
  if (ts.isIdentifier(value)) {
    if (BLOCKED_PROPERTY_NAMES.has(value.text) || value.text.length > 128) return undefined;
    /*
     * The fallback factory runs at the hook call, before a later callback or local helper receives
     * its index parameter. Reusing that nested binding here emits a free computed key such as
     * `{ [idx]: ... }` and turns otherwise inert fallback data into a ReferenceError. Generated
     * collections contain one representative item, so their conventional callback index is zero.
     * Other nested dynamic keys stay opaque instead of guessing an application-owned key.
     */
    if (findNearestRuntimeFunction(value) !== owner) {
      return /^(?:i|idx|index|itemIndex|rowIndex|columnIndex)$/iu.test(value.text)
        ? { expression: '0', text: '0' }
        : undefined;
    }
    return { expression: value.text, text: value.text };
  }
  if (ts.isStringLiteralLike(value) || ts.isNumericLiteral(value)) {
    if (BLOCKED_PROPERTY_NAMES.has(value.text) || value.text.length > 128) return undefined;
    return {
      expression: sourceFile.text.slice(value.getStart(sourceFile), value.end),
      text: value.text,
    };
  }
  return undefined;
}

/** Follows one immutable local alias or one exact local helper argument to an array contract. */
function hasCollectionDemand(
  expression: ts.Expression,
  owner: PreviewRuntimeFunction,
  sourceFile: ts.SourceFile,
): boolean {
  const value = unwrapPreviewRuntimeParentExpression(expression);
  if (isDirectCollectionConsumer(value)) return true;
  const parent = value.parent;
  if (
    ts.isVariableDeclaration(parent) &&
    parent.initializer === value &&
    ts.isIdentifier(parent.name)
  ) {
    return identifierHasCollectionDemand(parent.name, owner, sourceFile);
  }
  return ts.isCallExpression(parent)
    ? localHelperArgumentRequiresArray(parent, value, sourceFile)
    : false;
}

/** Reads array operations on one uniquely bound local alias without following assignments. */
function identifierHasCollectionDemand(
  declaration: ts.Identifier,
  owner: PreviewRuntimeFunction,
  sourceFile: ts.SourceFile,
): boolean {
  let collection = false;
  const visit = (node: ts.Node): void => {
    if (collection) return;
    if (
      node !== owner &&
      isPreviewRuntimeFunction(node) &&
      previewRuntimeFunctionShadowsName(node, declaration.text)
    )
      return;
    if (ts.isIdentifier(node) && node !== declaration && node.text === declaration.text) {
      const value = unwrapPreviewRuntimeParentExpression(node);
      if (isDirectCollectionConsumer(value)) {
        collection = true;
        return;
      }
      if (
        ts.isCallExpression(value.parent) &&
        localHelperArgumentRequiresArray(value.parent, value, sourceFile)
      ) {
        collection = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  return collection;
}

/** Recognizes an authored collection method, array spread, for-of, or Array.isArray check. */
function isDirectCollectionConsumer(value: ts.Expression): boolean {
  const parent = value.parent;
  if (
    ts.isPropertyAccessExpression(parent) &&
    parent.expression === value &&
    isPreviewRuntimeHookArrayUsageProperty(parent.name.text)
  )
    return true;
  if (ts.isForOfStatement(parent) && parent.expression === value) return true;
  if (ts.isSpreadElement(parent) && ts.isArrayLiteralExpression(parent.parent)) return true;
  if (!ts.isCallExpression(parent)) return false;
  const callee = unwrapPreviewRuntimeExpression(parent.expression);
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(unwrapPreviewRuntimeExpression(callee.expression)) &&
    (unwrapPreviewRuntimeExpression(callee.expression) as ts.Identifier).text === 'Array' &&
    callee.name.text === 'isArray' &&
    parent.arguments[0] === value
  );
}

/** Proves one argument position is array-shaped from a unique same-file function declaration. */
function localHelperArgumentRequiresArray(
  call: ts.CallExpression,
  argument: ts.Expression,
  sourceFile: ts.SourceFile,
): boolean {
  const callee = unwrapPreviewRuntimeExpression(call.expression);
  if (!ts.isIdentifier(callee)) return false;
  const argumentIndex = call.arguments.findIndex(
    (candidate) => unwrapPreviewRuntimeExpression(candidate) === argument,
  );
  if (argumentIndex < 0) return false;
  const helpers = collectNamedRuntimeFunctions(sourceFile, callee.text);
  if (helpers.length !== 1) return false;
  const helper = helpers[0];
  const parameter = helper?.parameters[argumentIndex];
  if (helper === undefined || parameter === undefined || parameter.dotDotDotToken !== undefined) {
    return false;
  }
  if (parameter.type !== undefined && isArrayType(parameter.type)) return true;
  if (!ts.isIdentifier(parameter.name)) return false;
  const parameterName = parameter.name.text;
  let collection = false;
  const visit = (node: ts.Node): void => {
    if (collection) return;
    if (
      node !== helper &&
      isPreviewRuntimeFunction(node) &&
      previewRuntimeFunctionShadowsName(node, parameterName)
    )
      return;
    if (ts.isIdentifier(node) && node !== parameter.name && node.text === parameterName) {
      if (isDirectCollectionConsumer(unwrapPreviewRuntimeParentExpression(node))) {
        collection = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(helper);
  return collection;
}

/** Selects only one unambiguous local function declaration or function-valued variable. */
function collectNamedRuntimeFunctions(
  sourceFile: ts.SourceFile,
  name: string,
): PreviewRuntimeFunction[] {
  const functions: PreviewRuntimeFunction[] = [];
  const visit = (node: ts.Node): void => {
    if (functions.length > 1) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      functions.push(node);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer !== undefined
    ) {
      const initializer = unwrapPreviewRuntimeExpression(node.initializer);
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
        functions.push(initializer);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return functions;
}

/** Recognizes direct and generic Array spellings without resolving application types. */
function isArrayType(typeNode: ts.TypeNode): boolean {
  const value = ts.isParenthesizedTypeNode(typeNode) ? typeNode.type : typeNode;
  return (
    ts.isArrayTypeNode(value) ||
    ts.isTupleTypeNode(value) ||
    (ts.isTypeReferenceNode(value) &&
      ts.isIdentifier(value.typeName) &&
      (value.typeName.text === 'Array' || value.typeName.text === 'ReadonlyArray'))
  );
}

/** Finds the hook/result binding's nearest runtime function. */
function findNearestRuntimeFunction(node: ts.Node): PreviewRuntimeFunction | undefined {
  let current = node.parent;
  while (!ts.isSourceFile(current)) {
    if (isPreviewRuntimeFunction(current)) return current;
    current = current.parent;
  }
  return undefined;
}
