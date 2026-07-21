/**
 * Infers numeric hook-result paths that participate in JavaScript Array-length construction.
 *
 * This module is deliberately syntax-only. It records the narrow constraint needed to replace an
 * application `-1`/NaN sentinel with the compiler's neutral number without changing ordinary
 * negative business values used by comparisons, labels, or arithmetic outside an Array length.
 */
import ts from 'typescript';
import { readPreviewRuntimeHookBindingPropertyName } from './previewRuntimeHookBindingPattern';
import {
  findNearestPreviewRuntimeFunction,
  isPreviewRuntimeFunction,
  unwrapPreviewRuntimeExpression,
  unwrapPreviewRuntimeParentExpression,
} from './previewRuntimeHookSyntax';

/** Runtime metadata understood by generated-value completion. */
export interface PreviewRuntimeHookArrayLengthConstraintMetadata {
  /** Relative hook-result paths that must hold a bounded preview-safe Array length. */
  readonly nonNegativeNumberPaths?: readonly string[];
}

/** One local identifier and the corresponding property path in the hook result. */
interface ArrayLengthBinding {
  readonly identifier: ts.Identifier;
  readonly path: string;
}

/** Adds immutable constraint metadata only when the authored hook binding proves it. */
export function applyPreviewRuntimeHookArrayLengthConstraints<
  T extends PreviewRuntimeHookArrayLengthConstraintMetadata,
>(call: ts.CallExpression, fallback: T): T {
  const bindings = readHookResultBindings(call);
  const paths = bindings
    .filter(({ identifier }) => isUsedBySingleArgumentArrayConstructor(identifier))
    .map(({ path }) => path);
  const uniquePaths = [...new Set(paths)];
  return uniquePaths.length === 0
    ? fallback
    : { ...fallback, nonNegativeNumberPaths: Object.freeze(uniquePaths) };
}

/** Reads direct identifier, object, and tuple bindings attached to the hook call. */
function readHookResultBindings(call: ts.CallExpression): readonly ArrayLengthBinding[] {
  const expression = unwrapPreviewRuntimeParentExpression(call);
  const declaration = expression.parent;
  if (!ts.isVariableDeclaration(declaration) || declaration.initializer !== expression) return [];
  return readBindingIdentifiers(declaration.name, []);
}

/** Recursively maps a destructured local name back to its stable hook-result path. */
function readBindingIdentifiers(
  binding: ts.BindingName,
  path: readonly string[],
): readonly ArrayLengthBinding[] {
  if (ts.isIdentifier(binding)) {
    return [{ identifier: binding, path: path.length === 0 ? '<root>' : path.join('.') }];
  }
  const bindings: ArrayLengthBinding[] = [];
  for (const [index, element] of binding.elements.entries()) {
    if (ts.isOmittedExpression(element) || element.dotDotDotToken !== undefined) continue;
    const propertyName = ts.isArrayBindingPattern(binding)
      ? String(index)
      : readPreviewRuntimeHookBindingPropertyName(element);
    if (propertyName === undefined) continue;
    bindings.push(...readBindingIdentifiers(element.name, [...path, propertyName]));
  }
  return bindings;
}

/**
 * Proves that one binding occurs inside the sole argument of `new Array(length)`.
 *
 * Nested closures are allowed when they capture the binding, while a parameter with the same name
 * terminates that branch. The check intentionally excludes `Array(a, b)` because those arguments
 * are array elements rather than a length contract.
 */
function isUsedBySingleArgumentArrayConstructor(identifier: ts.Identifier): boolean {
  const owner = findNearestPreviewRuntimeFunction(identifier);
  if (owner === undefined) return false;
  let found = false;
  /** Traverses the component body without interpreting any project expression. */
  const visit = (node: ts.Node): void => {
    if (
      found ||
      (node !== owner &&
        isPreviewRuntimeFunction(node) &&
        functionShadowsIdentifier(node, identifier.text))
    ) {
      return;
    }
    if (
      ts.isNewExpression(node) &&
      isGlobalArrayIdentifier(node.expression) &&
      node.arguments?.length === 1 &&
      containsIdentifierReference(node.arguments[0], identifier.text)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  return found;
}

/** Recognizes the direct native-looking Array constructor without evaluating aliases. */
function isGlobalArrayIdentifier(expression: ts.Expression): boolean {
  const unwrapped = unwrapPreviewRuntimeExpression(expression);
  return ts.isIdentifier(unwrapped) && unwrapped.text === 'Array';
}

/** Finds one value reference while rejecting property names and shadowed nested functions. */
function containsIdentifierReference(root: ts.Node | undefined, identifierName: string): boolean {
  if (root === undefined) return false;
  let found = false;
  /** Keeps the scan bounded to the already selected constructor argument. */
  const visit = (node: ts.Node): void => {
    if (
      found ||
      (node !== root &&
        isPreviewRuntimeFunction(node) &&
        functionShadowsIdentifier(node, identifierName))
    ) {
      return;
    }
    if (ts.isIdentifier(node) && node.text === identifierName && !isPropertyName(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

/** Distinguishes `value` reads from the `value` key in `object.value` or `{ value: local }`. */
function isPropertyName(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === identifier) ||
    (ts.isPropertyAssignment(parent) &&
      parent.name === identifier &&
      parent.initializer !== identifier)
  );
}

/** Reports whether a nested function parameter hides the outer hook-result binding. */
function functionShadowsIdentifier(scope: ts.FunctionLikeDeclaration, name: string): boolean {
  return scope.parameters.some((parameter) => bindingContainsIdentifier(parameter.name, name));
}

/** Recursively searches an identifier, object, or tuple binding for one local name. */
function bindingContainsIdentifier(binding: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(binding)) return binding.text === name;
  return binding.elements.some(
    (element) => !ts.isOmittedExpression(element) && bindingContainsIdentifier(element.name, name),
  );
}
