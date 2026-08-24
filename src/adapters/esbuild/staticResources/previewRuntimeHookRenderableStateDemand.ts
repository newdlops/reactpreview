/**
 * Recovers one coherent hook-state discriminator that makes a dormant component render.
 *
 * The value is emitted only as target-guided Smart metadata. Ordinary previews retain the
 * application value; the runtime may select this exact scalar after the chosen component mounted
 * without output. This keeps parent consumers and the target on one state instead of independently
 * forcing JSX conditions.
 */
import ts from 'typescript';
import {
  findNearestPreviewRuntimeFunction,
  isPreviewRuntimeFunction,
  unwrapPreviewRuntimeExpression,
  type PreviewRuntimeFunction,
} from './previewRuntimeHookSyntax';

const RESOURCE_HOST_NAMES = new Set(['audio', 'embed', 'iframe', 'object', 'script', 'video']);
const TRANSIENT_VISIBLE_STATE_NAMES = new Set([
  'loading',
  'pending',
  'fetching',
  'initializing',
  'connecting',
  'preparing',
  'opening',
  'suspended',
]);
const EXITING_VISIBLE_STATE_NAMES = new Set(['closing', 'disconnecting', 'exiting']);

/** One side-effect-free scalar keyed relative to the analyzed hook-result binding. */
export interface PreviewRuntimeHookRenderableStateDemand {
  /** Cold-model order; verified neural learning may reorder candidates with the same path. */
  readonly deterministicRank: number;
  readonly expression: string;
  readonly path: string;
}

interface StaticScalar {
  readonly expression: string;
  readonly key: string;
  readonly semanticName: string;
}

interface TrackedEquality extends StaticScalar {
  readonly path: readonly string[];
}

interface RenderSummary {
  readonly nodeCount: number;
  readonly resourceHostCount: number;
}

interface RenderCandidate extends Omit<
  PreviewRuntimeHookRenderableStateDemand,
  'deterministicRank'
> {
  readonly order: number;
  readonly score: number;
}

/**
 * Finds a literal used by a visible JSX branch after the same property blocks an empty return.
 *
 * A branch such as `state.status === "loading" && <Loader />` is exact scalar evidence. Ordinary
 * states must also occur in a null/false early return so arbitrary tabs do not become automatic
 * choices. A known transient literal may instead own a visible early return directly: that is a
 * time checkpoint rather than a terminal navigation choice. Stable content still ranks ahead of
 * transient/loading and exiting branches; the browser learner can revise that cold order.
 */
export function inferPreviewRuntimeHookRenderableStateDemands(
  identifier: ts.Identifier,
  sourceFile: ts.SourceFile,
): readonly PreviewRuntimeHookRenderableStateDemand[] {
  const owner = findNearestPreviewRuntimeFunction(identifier);
  if (owner === undefined) return Object.freeze([]);
  const hidden = collectBlockingStateValues(owner, identifier.text, sourceFile);
  const candidates: RenderCandidate[] = [];
  const seen = new Set<string>();
  const append = (condition: ts.Expression, rendered: ts.Node, order: number): void => {
    const summary = summarizeRenderedBranch(rendered, owner, sourceFile);
    if (summary.nodeCount === 0) return;
    for (const equality of readTrackedEqualities(condition, identifier.text, sourceFile)) {
      const pathKey = equality.path.join('.');
      const path = pathKey.length === 0 ? '<root>' : pathKey;
      const identity = `${path}\0${equality.key}`;
      const normalizedStateName = equality.semanticName.replace(/[-_\s]/gu, '').toLowerCase();
      const transient = TRANSIENT_VISIBLE_STATE_NAMES.has(normalizedStateName);
      const blocked = hidden.has(`${pathKey}\0${equality.key}`) || hidden.has(`${pathKey}\0*`);
      if (!blocked && !transient) continue;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const transientPenalty = transient ? 800 : 0;
      const exitingPenalty = EXITING_VISIBLE_STATE_NAMES.has(normalizedStateName) ? 1_000 : 0;
      candidates.push({
        expression: equality.expression,
        order,
        path,
        score:
          (blocked ? 400 : 0) -
          transientPenalty -
          exitingPenalty +
          (summary.resourceHostCount === 0 ? 120 : -120 * summary.resourceHostCount) +
          Math.min(summary.nodeCount, 32),
      });
    }
  };
  const visit = (node: ts.Node): void => {
    if (node !== owner && isPreviewRuntimeFunction(node)) return;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      append(node.left, node.right, node.getStart(sourceFile));
    } else if (ts.isConditionalExpression(node)) {
      append(node.condition, node.whenTrue, node.getStart(sourceFile));
    } else if (ts.isIfStatement(node)) {
      const rendered = readReturnedRenderNode(node.thenStatement);
      if (rendered !== undefined) append(node.expression, rendered, node.getStart(sourceFile));
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  /*
   * A parent page often derives a named gate before a local render helper:
   * `const ready = status === "COMPLETED" && tree != null; if (ready) return <Target />`.
   * There is no empty return involving `status`, so the direct-state rule above has no evidence.
   * Keep this alternative target-guided and prefer the most substantial resource-free JSX branch.
   */
  if (candidates.length === 0) {
    candidates.push(...collectDerivedRenderableStateCandidates(owner, identifier.text, sourceFile));
  }
  const retained = new Map<string, RenderCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.path}\0${candidate.expression}`;
    const previous = retained.get(key);
    if (
      previous === undefined ||
      candidate.score > previous.score ||
      (candidate.score === previous.score && candidate.order < previous.order)
    )
      retained.set(key, candidate);
  }
  return Object.freeze(
    [...retained.values()]
      .sort((left, right) => right.score - left.score || left.order - right.order)
      .slice(0, 8)
      .map((candidate, deterministicRank) =>
        Object.freeze({
          deterministicRank,
          expression: candidate.expression,
          path: candidate.path,
        }),
      ),
  );
}

/** Returns the cold-model winner for callers that still consume one deterministic demand. */
export function inferPreviewRuntimeHookRenderableStateDemand(
  identifier: ts.Identifier,
  sourceFile: ts.SourceFile,
): PreviewRuntimeHookRenderableStateDemand | undefined {
  return inferPreviewRuntimeHookRenderableStateDemands(identifier, sourceFile)[0];
}

/** Finds exact equality values transported through a local Boolean gate into returned JSX. */
function collectDerivedRenderableStateCandidates(
  owner: PreviewRuntimeFunction,
  rootName: string,
  sourceFile: ts.SourceFile,
): readonly RenderCandidate[] {
  const trackedValuePaths = collectTrackedValuePaths(owner, rootName);
  const equalitiesByAlias = new Map<string, readonly TrackedEquality[]>();
  const calledLocalFunctions = new Set<string>();
  const collectDeclarations = (node: ts.Node): void => {
    if (node !== owner && isPreviewRuntimeFunction(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const equalities = readPositiveTrackedEqualities(
        node.initializer,
        rootName,
        trackedValuePaths,
        sourceFile,
      );
      if (equalities.length > 0) equalitiesByAlias.set(node.name.text, equalities);
    }
    ts.forEachChild(node, collectDeclarations);
  };
  collectDeclarations(owner);
  if (equalitiesByAlias.size === 0) return [];

  const collectCalls = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = unwrapPreviewRuntimeExpression(node.expression);
      if (ts.isIdentifier(callee)) calledLocalFunctions.add(callee.text);
    }
    ts.forEachChild(node, collectCalls);
  };
  collectCalls(owner);

  const candidates: RenderCandidate[] = [];
  const append = (condition: ts.Expression, rendered: ts.Node, order: number): void => {
    if (!isReachedLocalRenderScope(rendered, owner, calledLocalFunctions)) return;
    const summary = summarizeRenderedBranch(rendered, owner, sourceFile);
    if (summary.nodeCount === 0) return;
    for (const equality of readPositiveDerivedEqualities(
      condition,
      rootName,
      equalitiesByAlias,
      trackedValuePaths,
      sourceFile,
    )) {
      candidates.push({
        expression: equality.expression,
        order,
        path: equality.path.length === 0 ? '<root>' : equality.path.join('.'),
        score: 500 + Math.min(summary.nodeCount, 64) * 20 - summary.resourceHostCount * 2_000,
      });
    }
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      append(node.left, node.right, node.getStart(sourceFile));
    } else if (ts.isConditionalExpression(node)) {
      append(node.condition, node.whenTrue, node.getStart(sourceFile));
    } else if (ts.isIfStatement(node)) {
      const rendered = readReturnedRenderNode(node.thenStatement);
      if (rendered !== undefined) append(node.expression, rendered, node.getStart(sourceFile));
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  return candidates;
}

/** Reads exact values that make a direct tracked equality or positive logical chain truthy. */
function readPositiveTrackedEqualities(
  expression: ts.Expression,
  rootName: string,
  trackedValuePaths: ReadonlyMap<string, readonly string[]>,
  sourceFile: ts.SourceFile,
): readonly TrackedEquality[] {
  const value = unwrapPreviewRuntimeExpression(expression);
  if (
    ts.isBinaryExpression(value) &&
    (value.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      value.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return [
      ...readPositiveTrackedEqualities(value.left, rootName, trackedValuePaths, sourceFile),
      ...readPositiveTrackedEqualities(value.right, rootName, trackedValuePaths, sourceFile),
    ];
  }
  return readAliasedTrackedEqualities(value, rootName, trackedValuePaths, sourceFile);
}

/** Resolves positive gate aliases without treating a negated/dynamic peer as exact evidence. */
function readPositiveDerivedEqualities(
  expression: ts.Expression,
  rootName: string,
  equalitiesByAlias: ReadonlyMap<string, readonly TrackedEquality[]>,
  trackedValuePaths: ReadonlyMap<string, readonly string[]>,
  sourceFile: ts.SourceFile,
): readonly TrackedEquality[] {
  const value = unwrapPreviewRuntimeExpression(expression);
  if (ts.isIdentifier(value)) return equalitiesByAlias.get(value.text) ?? [];
  if (
    ts.isBinaryExpression(value) &&
    (value.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      value.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return [
      ...readPositiveDerivedEqualities(
        value.left,
        rootName,
        equalitiesByAlias,
        trackedValuePaths,
        sourceFile,
      ),
      ...readPositiveDerivedEqualities(
        value.right,
        rootName,
        equalitiesByAlias,
        trackedValuePaths,
        sourceFile,
      ),
    ];
  }
  return readAliasedTrackedEqualities(value, rootName, trackedValuePaths, sourceFile);
}

/** Tracks direct aliases and object destructuring paths rooted at one hook-result binding. */
function collectTrackedValuePaths(
  owner: PreviewRuntimeFunction,
  rootName: string,
): ReadonlyMap<string, readonly string[]> {
  const paths = new Map<string, readonly string[]>([[rootName, Object.freeze([])]]);
  const appendBinding = (binding: ts.BindingName, basePath: readonly string[]): void => {
    if (ts.isIdentifier(binding)) {
      paths.set(binding.text, Object.freeze([...basePath]));
      return;
    }
    for (const [index, element] of binding.elements.entries()) {
      if (ts.isOmittedExpression(element) || element.dotDotDotToken !== undefined) continue;
      const propertyName = ts.isArrayBindingPattern(binding)
        ? String(index)
        : readStaticBindingPropertyName(element);
      if (propertyName === undefined) continue;
      appendBinding(element.name, [...basePath, propertyName]);
    }
  };
  const visit = (node: ts.Node): void => {
    if (node !== owner && isPreviewRuntimeFunction(node)) return;
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      const basePath = readAliasedTrackedPropertyPath(node.initializer, rootName, paths);
      if (basePath !== undefined) appendBinding(node.name, basePath);
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  return paths;
}

/** Reads one non-computed property name from an object binding element. */
function readStaticBindingPropertyName(element: ts.BindingElement): string | undefined {
  const property = element.propertyName ?? element.name;
  if (
    ts.isIdentifier(property) ||
    ts.isStringLiteralLike(property) ||
    ts.isNumericLiteral(property)
  ) {
    return property.text;
  }
  return undefined;
}

/** Reads an equality whose tracked operand may be a destructured alias of the hook result. */
function readAliasedTrackedEqualities(
  expression: ts.Expression,
  rootName: string,
  trackedValuePaths: ReadonlyMap<string, readonly string[]>,
  sourceFile: ts.SourceFile,
): readonly TrackedEquality[] {
  const value = unwrapPreviewRuntimeExpression(expression);
  if (
    !ts.isBinaryExpression(value) ||
    (value.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken &&
      value.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsToken)
  ) {
    return [];
  }
  const leftPath = readAliasedTrackedPropertyPath(value.left, rootName, trackedValuePaths);
  const rightPath = readAliasedTrackedPropertyPath(value.right, rootName, trackedValuePaths);
  const trackedOnLeft = leftPath !== undefined;
  const path = leftPath ?? rightPath;
  const scalar =
    path === undefined
      ? undefined
      : readStaticScalar(trackedOnLeft ? value.right : value.left, sourceFile);
  return path === undefined || scalar === undefined ? [] : [Object.freeze({ ...scalar, path })];
}

/** Resolves a direct alias plus a bounded non-computed descendant path. */
function readAliasedTrackedPropertyPath(
  expression: ts.Expression,
  rootName: string,
  trackedValuePaths: ReadonlyMap<string, readonly string[]>,
): readonly string[] | undefined {
  const suffix: string[] = [];
  let current = unwrapPreviewRuntimeExpression(expression);
  while (ts.isPropertyAccessExpression(current) && current.questionDotToken === undefined) {
    suffix.unshift(current.name.text);
    current = unwrapPreviewRuntimeExpression(current.expression);
  }
  if (!ts.isIdentifier(current)) return undefined;
  const base = current.text === rootName ? [] : trackedValuePaths.get(current.text);
  return base === undefined || base.length + suffix.length > 8
    ? undefined
    : Object.freeze([...base, ...suffix]);
}

/** Rejects JSX hidden in an uncalled local helper while admitting lexical render helpers. */
function isReachedLocalRenderScope(
  node: ts.Node,
  owner: PreviewRuntimeFunction,
  calledLocalFunctions: ReadonlySet<string>,
): boolean {
  let current: ts.Node = node;
  while (current !== owner) {
    if (isPreviewRuntimeFunction(current)) {
      const localName = readLocalFunctionName(current);
      return localName !== undefined && calledLocalFunctions.has(localName);
    }
    current = current.parent;
  }
  return true;
}

/** Recovers a stable same-scope function name without evaluating property or computed bindings. */
function readLocalFunctionName(scope: PreviewRuntimeFunction): string | undefined {
  if (ts.isFunctionDeclaration(scope)) return scope.name?.text;
  const declaration = scope.parent;
  return ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)
    ? declaration.name.text
    : undefined;
}

/** Collects literals whose exact property comparison leads to an explicitly empty early return. */
function collectBlockingStateValues(
  owner: PreviewRuntimeFunction,
  rootName: string,
  sourceFile: ts.SourceFile,
): ReadonlySet<string> {
  const hidden = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (node !== owner && isPreviewRuntimeFunction(node)) return;
    if (
      ts.isIfStatement(node) &&
      node.elseStatement === undefined &&
      statementReturnsEmpty(node.thenStatement)
    ) {
      for (const equality of readTrackedEqualities(node.expression, rootName, sourceFile)) {
        hidden.add(`${equality.path.join('.')}\0${equality.key}`);
        hidden.add(`${equality.path.join('.')}\0*`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  return hidden;
}

/** Reads direct equality leaves, allowing an OR chain to describe several values for one branch. */
function readTrackedEqualities(
  expression: ts.Expression,
  rootName: string,
  sourceFile: ts.SourceFile,
): readonly TrackedEquality[] {
  const value = unwrapPreviewRuntimeExpression(expression);
  if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    return [
      ...readTrackedEqualities(value.left, rootName, sourceFile),
      ...readTrackedEqualities(value.right, rootName, sourceFile),
    ];
  }
  if (
    !ts.isBinaryExpression(value) ||
    (value.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken &&
      value.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsToken)
  ) {
    return [];
  }
  const leftPath = readTrackedPropertyPath(value.left, rootName);
  const rightPath = readTrackedPropertyPath(value.right, rootName);
  const path = leftPath ?? rightPath;
  const peer = leftPath === undefined ? value.left : value.right;
  const scalar = path === undefined ? undefined : readStaticScalar(peer, sourceFile);
  return path === undefined || scalar === undefined ? [] : [Object.freeze({ ...scalar, path })];
}

/** Reads a bounded non-computed property chain rooted at the hook-bound identifier. */
function readTrackedPropertyPath(
  expression: ts.Expression,
  rootName: string,
): readonly string[] | undefined {
  const path: string[] = [];
  let current = unwrapPreviewRuntimeExpression(expression);
  while (ts.isPropertyAccessExpression(current) && current.questionDotToken === undefined) {
    path.unshift(current.name.text);
    current = unwrapPreviewRuntimeExpression(current.expression);
  }
  return ts.isIdentifier(current) && current.text === rootName && path.length <= 8
    ? Object.freeze(path)
    : undefined;
}

/** Serializes only literal scalars and enum-like members already available in module scope. */
function readStaticScalar(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): StaticScalar | undefined {
  const value = unwrapPreviewRuntimeExpression(expression);
  if (ts.isStringLiteralLike(value)) {
    return {
      expression: JSON.stringify(value.text),
      key: `string:${value.text}`,
      semanticName: value.text,
    };
  }
  if (ts.isNumericLiteral(value)) {
    const numeric = Number(value.text);
    return Number.isFinite(numeric)
      ? { expression: String(numeric), key: `number:${String(numeric)}`, semanticName: value.text }
      : undefined;
  }
  if (value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword) {
    const booleanValue = value.kind === ts.SyntaxKind.TrueKeyword;
    return {
      expression: String(booleanValue),
      key: `boolean:${String(booleanValue)}`,
      semanticName: String(booleanValue),
    };
  }
  if (
    ts.isPropertyAccessExpression(value) &&
    value.questionDotToken === undefined &&
    ts.isIdentifier(value.expression) &&
    /^[A-Z]/u.test(value.expression.text)
  ) {
    return {
      expression: value.getText(sourceFile),
      key: `enum:${value.getText(sourceFile)}`,
      semanticName: value.name.text,
    };
  }
  return undefined;
}

/** Counts authored JSX and flags resource hosts whose selected state may start external work. */
function summarizeRenderedBranch(
  branch: ts.Node,
  owner: PreviewRuntimeFunction,
  sourceFile: ts.SourceFile,
): RenderSummary {
  let nodeCount = 0;
  let resourceHostCount = 0;
  const visit = (node: ts.Node): void => {
    if (node !== branch && node !== owner && isPreviewRuntimeFunction(node)) return;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      nodeCount += 1;
      const tag = (ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName)
        .getText(sourceFile)
        .toLowerCase();
      if (RESOURCE_HOST_NAMES.has(tag)) resourceHostCount += 1;
    } else if (ts.isJsxFragment(node)) {
      nodeCount += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(branch);
  return { nodeCount, resourceHostCount };
}

/** Returns the JSX-producing expression from a simple returned branch. */
function readReturnedRenderNode(statement: ts.Statement): ts.Expression | undefined {
  if (ts.isReturnStatement(statement)) return statement.expression;
  if (!ts.isBlock(statement)) return undefined;
  const last = statement.statements.at(-1);
  return last === undefined ? undefined : readReturnedRenderNode(last);
}

/** Proves that the branch terminates with null, false, undefined, or an empty return. */
function statementReturnsEmpty(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement)) {
    const value =
      statement.expression === undefined
        ? undefined
        : unwrapPreviewRuntimeExpression(statement.expression);
    return (
      value === undefined ||
      value.kind === ts.SyntaxKind.NullKeyword ||
      value.kind === ts.SyntaxKind.FalseKeyword ||
      (ts.isIdentifier(value) && value.text === 'undefined')
    );
  }
  if (!ts.isBlock(statement)) return false;
  const last = statement.statements.at(-1);
  return last !== undefined && statementReturnsEmpty(last);
}
