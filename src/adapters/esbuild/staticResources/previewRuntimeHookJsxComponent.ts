/**
 * Infers a React-valid hook fallback when one bound tuple value is used as a direct JSX tag.
 *
 * The analyzer stays inside the binding's runtime owner and follows captured uses only when a
 * nested function does not shadow the binding. It never invokes project code while analyzing.
 */
import ts from 'typescript';
import {
  findNearestPreviewRuntimeFunction,
  isPreviewRuntimeFunction,
  previewRuntimeBindingContainsName,
  previewRuntimeFunctionShadowsName,
  unwrapPreviewRuntimeExpression,
  type PreviewRuntimeFunction,
} from './previewRuntimeHookSyntax';

const MAX_JSX_COMPONENT_USES = 16;
const MAX_JSX_COMPONENT_PAYLOAD_DEPTH = 4;

/** Minimal fallback contract shared with the recursive binding analyzer. */
export interface PreviewRuntimeHookJsxComponentFallback {
  readonly expression: string;
  readonly label: string;
  readonly requiredPaths?: readonly string[];
}

/** Recursive binding seam owned by the main hook instrumentation module. */
export type CreatePreviewRuntimeHookJsxComponentPayload = (
  binding: ts.BindingName,
  sourceFile: ts.SourceFile,
  callResultDepth: number,
) => PreviewRuntimeHookJsxComponentFallback | undefined;

interface JsxComponentPayloadCandidate {
  readonly childIndex: number;
  readonly fallback: PreviewRuntimeHookJsxComponentFallback;
}

/**
 * Builds one frozen component from exact direct JSX-tag evidence for the analyzed identifier.
 * A proven inline render-prop child receives the richest recursively inferred payload; all other
 * function children remain uninvoked while ordinary React children pass through unchanged.
 */
export function inferPreviewRuntimeHookJsxComponentFallback(
  identifier: ts.Identifier,
  sourceFile: ts.SourceFile,
  callResultDepth: number,
  createBindingFallback: CreatePreviewRuntimeHookJsxComponentPayload,
): PreviewRuntimeHookJsxComponentFallback | undefined {
  const owner = findNearestPreviewRuntimeFunction(identifier);
  if (owner === undefined) return undefined;
  const payloads: JsxComponentPayloadCandidate[] = [];
  let directTagUses = 0;
  const visit = (node: ts.Node): void => {
    if (directTagUses >= MAX_JSX_COMPONENT_USES) return;
    if (
      node !== owner &&
      isPreviewRuntimeFunction(node) &&
      runtimeFunctionShadowsBinding(node, identifier.text)
    ) {
      return;
    }
    if (ts.isJsxElement(node) && isDirectTag(node.openingElement.tagName, identifier.text)) {
      directTagUses += 1;
      const payload = readInlineChildPayload(
        node.children,
        sourceFile,
        callResultDepth,
        createBindingFallback,
      );
      if (payload !== undefined) payloads.push(payload);
    } else if (
      ts.isJsxSelfClosingElement(node) &&
      isDirectTag(node.tagName, identifier.text)
    ) {
      directTagUses += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  if (directTagUses === 0) return undefined;
  const payload = [...payloads].sort(
    (left, right) =>
      (right.fallback.requiredPaths?.length ?? 0) -
      (left.fallback.requiredPaths?.length ?? 0),
  )[0];
  return {
    expression: createJsxComponentExpression(payload),
    label:
      payload === undefined
        ? 'generated JSX component'
        : `generated JSX component with ${payload.fallback.label}`,
    requiredPaths: ['<root>()'],
  };
}

/** Accepts only a plain identifier tag, excluding member and namespaced JSX names. */
function isDirectTag(tagName: ts.JsxTagNameExpression, identifierName: string): boolean {
  return ts.isIdentifier(tagName) && tagName.text === identifierName;
}

/** Reads exactly one inline one-parameter function child and recursively shapes its payload. */
function readInlineChildPayload(
  children: readonly ts.JsxChild[],
  sourceFile: ts.SourceFile,
  callResultDepth: number,
  createBindingFallback: CreatePreviewRuntimeHookJsxComponentPayload,
): JsxComponentPayloadCandidate | undefined {
  if (callResultDepth >= MAX_JSX_COMPONENT_PAYLOAD_DEPTH) return undefined;
  const runtimeChildren = children.filter(isRuntimeJsxChild);
  const candidates = runtimeChildren.flatMap((child, childIndex) => {
    if (!ts.isJsxExpression(child) || child.expression === undefined) return [];
    const expression = unwrapPreviewRuntimeExpression(child.expression);
    if (!ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression)) return [];
    const parameter = expression.parameters[0];
    if (
      expression.parameters.length !== 1 ||
      parameter === undefined ||
      parameter.dotDotDotToken !== undefined ||
      parameter.initializer !== undefined
    ) {
      return [];
    }
    const fallback = createBindingFallback(parameter.name, sourceFile, callResultDepth + 1);
    return fallback === undefined ? [] : [{ childIndex, fallback }];
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** Approximates React's authored child slots while dropping whitespace-only JSX text/comments. */
function isRuntimeJsxChild(child: ts.JsxChild): boolean {
  if (ts.isJsxExpression(child)) return child.expression !== undefined;
  return !ts.isJsxText(child) || child.text.trim().length > 0;
}

/** Conservatively skips nested functions that introduce a competing local binding. */
function runtimeFunctionShadowsBinding(
  scope: PreviewRuntimeFunction,
  identifierName: string,
): boolean {
  if (previewRuntimeFunctionShadowsName(scope, identifierName)) return true;
  if (
    ts.isVariableDeclaration(scope.parent) &&
    scope.parent.initializer === scope &&
    previewRuntimeBindingContainsName(scope.parent.name, identifierName)
  ) {
    return true;
  }
  if (
    (ts.isFunctionDeclaration(scope) || ts.isFunctionExpression(scope)) &&
    scope.name?.text === identifierName
  ) {
    return true;
  }
  let shadowed = false;
  const visit = (node: ts.Node): void => {
    if (shadowed) return;
    if (node !== scope && isPreviewRuntimeFunction(node)) {
      if (ts.isFunctionDeclaration(node) && node.name?.text === identifierName) shadowed = true;
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      previewRuntimeBindingContainsName(node.name, identifierName)
    ) {
      shadowed = true;
      return;
    }
    if (
      ts.isClassDeclaration(node) &&
      node.name?.text === identifierName
    ) {
      shadowed = true;
      return;
    }
    if (
      ts.isCatchClause(node) &&
      node.variableDeclaration !== undefined &&
      previewRuntimeBindingContainsName(node.variableDeclaration.name, identifierName)
    ) {
      shadowed = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  if (scope.body !== undefined) visit(scope.body);
  return shadowed;
}

/** Serializes a component that invokes only the statically admitted function-child position. */
function createJsxComponentExpression(
  payload: JsxComponentPayloadCandidate | undefined,
): string {
  const renderFunctionChild =
    payload === undefined
      ? 'null'
      : `previewIndex === ${payload.childIndex.toString()} ? previewChild(${payload.fallback.expression}) : null`;
  const renderSingleFunctionChild =
    payload?.childIndex === 0 ? `previewChildren(${payload.fallback.expression})` : 'null';
  return `Object.freeze((previewProps) => { const previewChildren = previewProps?.children; if (Array.isArray(previewChildren)) { const previewRendered = previewChildren.map((previewChild, previewIndex) => typeof previewChild === "function" ? (${renderFunctionChild}) : previewChild); return previewRendered.some((previewChild) => previewChild !== null && previewChild !== undefined && typeof previewChild !== "boolean") ? previewRendered : null; } if (typeof previewChildren === "function") { const previewRendered = ${renderSingleFunctionChild}; return previewRendered === undefined || typeof previewRendered === "boolean" ? null : previewRendered; } return previewChildren === undefined || typeof previewChildren === "boolean" ? null : previewChildren; })`;
}
