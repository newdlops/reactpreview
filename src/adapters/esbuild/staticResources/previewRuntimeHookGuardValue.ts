/**
 * Infers the Boolean value that lets a component continue past a local early-exit guard.
 *
 * Generated hook data should expose the selected page, not accidentally choose a redirect, loading
 * shell, or null return. This analyzer relies only on explicit control flow: it recognizes a direct
 * Boolean identifier (or its negation) guarding a statement that always returns or throws. It does
 * not guess from project names, route conventions, or runtime package behavior.
 */
import ts from 'typescript';
import {
  findNearestPreviewRuntimeFunction,
  isPreviewRuntimeFunction,
  previewRuntimeBindingContainsName,
  unwrapPreviewRuntimeExpression,
  type PreviewRuntimeFunction,
} from './previewRuntimeHookSyntax';
import {
  inferPreviewRuntimeSemanticFallback,
  type PreviewRuntimeSemanticFallback,
} from './previewRuntimeHookSemantics';

/**
 * Selects a Boolean that avoids every compatible early-exit guard involving one local binding.
 *
 * @param identifier Destructured or direct hook-result binding consumed by component control flow.
 * @returns A deterministic pass-through Boolean, or `undefined` when syntax is absent or conflicts.
 */
export function inferPreviewRuntimeHookGuardPassFallback(
  identifier: ts.Identifier,
): PreviewRuntimeSemanticFallback | undefined {
  const owner = findNearestPreviewRuntimeFunction(identifier);
  if (owner === undefined) return undefined;
  const value = inferGuardPassBoolean(owner, (expression) =>
    ts.isIdentifier(expression) && expression.text === identifier.text,
  );
  return value === undefined ? undefined : createBooleanGuardFallback(value);
}

/**
 * Infers the scalar required by an early-return guard for one exact alias-backed property read.
 *
 * Hook values often flow through an immutable local before a page shell checks access or route
 * identity (`const company = data?.company || cached; if (!company.canView ||
 * String(company.id) !== companyId) return ...`). The hook usage walker already proves the alias
 * origin; this helper only solves the reached guard expression and never resolves project types.
 * `availableBeforePosition` prevents a generated fallback from referencing a later local binding.
 */
export function inferPreviewRuntimeHookExpressionGuardPassFallback(
  expression: ts.Expression,
  availableBeforePosition: number,
): PreviewRuntimeSemanticFallback | undefined {
  const owner = findNearestPreviewRuntimeFunction(expression);
  if (owner === undefined) return undefined;
  const sourceFile = expression.getSourceFile();
  const expressionText = expression.getText(sourceFile);
  const matchesExpression = (candidate: ts.Expression): boolean =>
    candidate.kind === expression.kind && candidate.getText(sourceFile) === expressionText;
  const booleanValue = inferGuardPassBoolean(owner, matchesExpression);
  if (booleanValue !== undefined) return createBooleanGuardFallback(booleanValue);
  return inferGuardPeerFallback(
    expression,
    owner,
    availableBeforePosition,
    sourceFile,
  );
}

/**
 * Infers the closed scalar required after one context-call result is assigned to a stable target.
 *
 * This deliberately accepts only `identifier` and non-computed property targets rooted in a
 * binding owned by the candidate render function. The assignment may occur in a nested callback,
 * but a shadow on the route from that callback to the owner invalidates the proof. Guards are then
 * matched by the resolved root binding and exact static property path, not identifier text alone.
 */
export function inferPreviewRuntimeHookAssignmentGuardPassFallback(
  target: ts.Expression,
  owner: PreviewRuntimeFunction,
): PreviewRuntimeSemanticFallback | undefined {
  const tracked = readStaticAssignmentTarget(target);
  if (tracked === undefined || !isOwnerBindingReachable(target, tracked.root, owner)) {
    return undefined;
  }
  let assignmentCount = 0;
  let invalidWrite = false;
  const visit = (node: ts.Node): void => {
    if (node !== owner && isPreviewRuntimeFunction(node)) {
      if (!isNestedScopeOnTargetRoute(node, target)) return;
    }
    if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
      const written = readStaticAssignmentTarget(node.left);
      if (
        written !== undefined &&
        written.root === tracked.root &&
        isOwnerBindingReachable(node.left, tracked.root, owner)
      ) {
        if (
          node.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
          !sameStaticPath(written.path, tracked.path)
        ) {
          invalidWrite = true;
        } else {
          assignmentCount += 1;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  if (invalidWrite || assignmentCount !== 1) return undefined;
  const passValue = inferGuardPassBoolean(owner, (expression) => {
    const candidate = readStaticAssignmentTarget(expression);
    return (
      candidate !== undefined &&
      candidate.root === tracked.root &&
      sameStaticPath(candidate.path, tracked.path) &&
      isOwnerBindingReachable(expression, tracked.root, owner)
    );
  });
  return passValue === undefined ? undefined : createBooleanGuardFallback(passValue);
}

/** Reads one identifier/property-chain assignment target without admitting computed access. */
function readStaticAssignmentTarget(
  expression: ts.Expression,
): { readonly root: string; readonly path: readonly string[] } | undefined {
  const current = unwrapPreviewRuntimeExpression(expression);
  if (ts.isIdentifier(current)) return { root: current.text, path: Object.freeze([]) };
  if (
    ts.isPropertyAccessExpression(current) &&
    current.questionDotToken === undefined
  ) {
    const owner = readStaticAssignmentTarget(current.expression);
    return owner === undefined
      ? undefined
      : { root: owner.root, path: Object.freeze([...owner.path, current.name.text]) };
  }
  return undefined;
}

/** Rejects writes and guards whose root is not one unique owner parameter or direct local. */
function isOwnerBindingReachable(
  node: ts.Node,
  root: string,
  owner: PreviewRuntimeFunction,
): boolean {
  let declarations = 0;
  for (const parameter of owner.parameters) {
    if (previewRuntimeBindingContainsName(parameter.name, root)) declarations += 1;
  }
  visitOwnerDirectNodes(owner, (candidate) => {
    if (ts.isVariableDeclaration(candidate) && previewRuntimeBindingContainsName(candidate.name, root)) {
      declarations += 1;
    }
  });
  if (declarations !== 1) return false;
  let current: ts.Node | undefined = node;
  while (current !== undefined && current !== owner) {
    if (isPreviewRuntimeFunction(current) && current !== owner) {
      if (current.parameters.some((parameter) => previewRuntimeBindingContainsName(parameter.name, root))) {
        return false;
      }
      let shadowed = false;
      visitOwnerDirectNodes(current, (candidate) => {
        if (ts.isVariableDeclaration(candidate) && previewRuntimeBindingContainsName(candidate.name, root)) {
          shadowed = true;
        }
      });
      if (shadowed) return false;
    }
    current = current.parent;
  }
  return current === owner;
}

/** Visits one function body while excluding nested runtime scopes. */
function visitOwnerDirectNodes(scope: PreviewRuntimeFunction, visitor: (node: ts.Node) => void): void {
  const visit = (node: ts.Node): void => {
    if (node !== scope && isPreviewRuntimeFunction(node)) return;
    if (node !== scope) visitor(node);
    ts.forEachChild(node, visit);
  };
  visit(scope);
}

/** Retains only nested scopes containing the original assignment while counting its peer writes. */
function isNestedScopeOnTargetRoute(scope: PreviewRuntimeFunction, target: ts.Node): boolean {
  let current: ts.Node | undefined = target;
  while (current !== undefined) {
    if (current === scope) return true;
    current = current.parent;
  }
  return false;
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function sameStaticPath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

/** Selects one non-conflicting Boolean demanded by every reached early-return condition. */
function inferGuardPassBoolean(
  owner: ReturnType<typeof findNearestPreviewRuntimeFunction> & {},
  matchesExpression: (expression: ts.Expression) => boolean,
): boolean | undefined {
  const demandedValues = new Set<boolean>();
  const visit = (node: ts.Node): void => {
    if (node !== owner && isPreviewRuntimeFunction(node)) return;
    if (ts.isIfStatement(node)) {
      if (statementAlwaysExits(node.thenStatement) && node.elseStatement === undefined) {
        const passValue = readConditionTrackedValue(
          node.expression,
          matchesExpression,
          false,
        );
        if (passValue !== undefined) demandedValues.add(passValue);
      } else if (
        node.elseStatement !== undefined &&
        statementAlwaysExits(node.elseStatement) &&
        !statementAlwaysExits(node.thenStatement)
      ) {
        const passValue = readConditionTrackedValue(
          node.expression,
          matchesExpression,
          true,
        );
        if (passValue !== undefined) demandedValues.add(passValue);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  if (demandedValues.size !== 1) return undefined;
  return [...demandedValues][0];
}

/** Creates the existing diagnostic shape for a compiler-proven Boolean continuation value. */
function createBooleanGuardFallback(value: boolean): PreviewRuntimeSemanticFallback {
  return {
    expression: String(value),
    kind: 'boolean',
    label: `generated Boolean ${String(value)} to continue past an early return`,
    value,
  };
}

/** Reads the only tracked Boolean value under which an authored condition can reach one branch. */
function readConditionTrackedValue(
  expression: ts.Expression,
  matchesExpression: (expression: ts.Expression) => boolean,
  desiredConditionValue: boolean,
): boolean | undefined {
  const whenFalse = readPossibleConditionValues(expression, matchesExpression, false);
  const whenTrue = readPossibleConditionValues(expression, matchesExpression, true);
  const falseCanReach = whenFalse.has(desiredConditionValue);
  const trueCanReach = whenTrue.has(desiredConditionValue);
  return falseCanReach === trueCanReach ? undefined : trueCanReach;
}

const BOTH_BOOLEAN_VALUES: ReadonlySet<boolean> = new Set([false, true]);

/** Evaluates Boolean possibilities while leaving unrelated runtime values deliberately unknown. */
function readPossibleConditionValues(
  expression: ts.Expression,
  matchesExpression: (expression: ts.Expression) => boolean,
  trackedValue: boolean,
): ReadonlySet<boolean> {
  const current = unwrapPreviewRuntimeExpression(expression);
  if (matchesExpression(current)) return new Set([trackedValue]);
  if (ts.isIdentifier(current)) {
    if (current.text === 'undefined') return new Set([false]);
    return BOTH_BOOLEAN_VALUES;
  }
  if (current.kind === ts.SyntaxKind.TrueKeyword) return new Set([true]);
  if (
    current.kind === ts.SyntaxKind.FalseKeyword ||
    current.kind === ts.SyntaxKind.NullKeyword ||
    ts.isVoidExpression(current)
  ) {
    return new Set([false]);
  }
  if (
    ts.isPrefixUnaryExpression(current) &&
    current.operator === ts.SyntaxKind.ExclamationToken
  ) {
    return new Set(
      [...readPossibleConditionValues(current.operand, matchesExpression, trackedValue)].map(
        (value) => !value,
      ),
    );
  }
  if (
    ts.isBinaryExpression(current) &&
    (current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      current.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    const leftValues = readPossibleConditionValues(
      current.left,
      matchesExpression,
      trackedValue,
    );
    const rightValues = readPossibleConditionValues(
      current.right,
      matchesExpression,
      trackedValue,
    );
    const values = new Set<boolean>();
    for (const left of leftValues) {
      for (const right of rightValues) {
        values.add(
          current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
            ? left && right
            : left || right,
        );
      }
    }
    return values;
  }
  if (ts.isConditionalExpression(current)) {
    return new Set([
      ...readPossibleConditionValues(current.whenTrue, matchesExpression, trackedValue),
      ...readPossibleConditionValues(current.whenFalse, matchesExpression, trackedValue),
    ]);
  }
  return BOTH_BOOLEAN_VALUES;
}

/**
 * Copies a prior local scalar when equality with it is the only way past a compound exit guard.
 */
function inferGuardPeerFallback(
  expression: ts.Expression,
  owner: ReturnType<typeof findNearestPreviewRuntimeFunction> & {},
  availableBeforePosition: number,
  sourceFile: ts.SourceFile,
): PreviewRuntimeSemanticFallback | undefined {
  const comparison = readGuardComparison(expression);
  if (comparison === undefined) return undefined;
  const comparisonText = comparison.node.getText(sourceFile);
  const desiredComparisonValue = inferGuardPassBoolean(
    owner,
    (candidate) =>
      candidate.kind === comparison.node.kind &&
      candidate.getText(sourceFile) === comparisonText,
  );
  if (desiredComparisonValue === undefined) return undefined;
  const equality =
    comparison.node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ||
    comparison.node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken;
  const inequality =
    comparison.node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken ||
    comparison.node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
  const mustEqual =
    (equality && desiredComparisonValue) || (inequality && !desiredComparisonValue);
  if (!mustEqual) return undefined;
  const peer = unwrapPreviewRuntimeExpression(comparison.peer);
  if (
    !ts.isIdentifier(peer) ||
    peer.text === 'undefined' ||
    !isPriorGuardBinding(peer.text, owner, availableBeforePosition)
  ) {
    return undefined;
  }
  const peerText = peer.getText(sourceFile);
  const expressionText =
    comparison.wrapper === undefined
      ? peerText
      : `${comparison.wrapper}(${peerText})`;
  const semantic = inferPreviewRuntimeSemanticFallback(peer.text);
  return {
    expression: expressionText,
    kind:
      comparison.wrapper === 'Number'
        ? 'number'
        : comparison.wrapper === 'Boolean'
          ? 'boolean'
          : (semantic?.kind ?? 'string'),
    label: 'generated value matching a prior local guard peer',
  };
}

/** Exact equality comparison containing the tracked leaf, with one inert built-in coercion allowed. */
function readGuardComparison(expression: ts.Expression):
  | {
      readonly node: ts.BinaryExpression;
      readonly peer: ts.Expression;
      readonly wrapper?: 'Boolean' | 'Number' | 'String';
    }
  | undefined {
  let current: ts.Node = expression;
  let wrapper: 'Boolean' | 'Number' | 'String' | undefined;
  while (
    ts.isParenthesizedExpression(current.parent) ||
    ts.isAsExpression(current.parent) ||
    ts.isSatisfiesExpression(current.parent) ||
    ts.isNonNullExpression(current.parent) ||
    ts.isTypeAssertionExpression(current.parent)
  ) {
    current = current.parent;
  }
  const call = current.parent;
  if (
    ts.isCallExpression(call) &&
    call.arguments.length === 1 &&
    call.arguments[0] === current &&
    ts.isIdentifier(unwrapPreviewRuntimeExpression(call.expression))
  ) {
    const callee = (unwrapPreviewRuntimeExpression(call.expression) as ts.Identifier).text;
    if (callee === 'Boolean' || callee === 'Number' || callee === 'String') {
      wrapper = callee;
      current = call;
    }
  }
  const parent = current.parent;
  if (!ts.isBinaryExpression(parent)) return undefined;
  const operator = parent.operatorToken.kind;
  if (
    operator !== ts.SyntaxKind.EqualsEqualsToken &&
    operator !== ts.SyntaxKind.EqualsEqualsEqualsToken &&
    operator !== ts.SyntaxKind.ExclamationEqualsToken &&
    operator !== ts.SyntaxKind.ExclamationEqualsEqualsToken
  ) {
    return undefined;
  }
  if (parent.left === current) return { node: parent, peer: parent.right, ...(wrapper ? { wrapper } : {}) };
  if (parent.right === current) return { node: parent, peer: parent.left, ...(wrapper ? { wrapper } : {}) };
  return undefined;
}

/** Proves that a unique parameter/const binding is initialized before the generated hook value. */
function isPriorGuardBinding(
  name: string,
  owner: ReturnType<typeof findNearestPreviewRuntimeFunction> & {},
  availableBeforePosition: number,
): boolean {
  let bindingCount = 0;
  let prior = false;
  const bindingContains = (binding: ts.BindingName): boolean => {
    if (ts.isIdentifier(binding)) return binding.text === name;
    return binding.elements.some(
      (element) => !ts.isOmittedExpression(element) && bindingContains(element.name),
    );
  };
  for (const parameter of owner.parameters) {
    if (!bindingContains(parameter.name)) continue;
    bindingCount += 1;
    prior = true;
  }
  const visit = (node: ts.Node): void => {
    if (node !== owner && isPreviewRuntimeFunction(node)) return;
    if (ts.isVariableDeclaration(node) && bindingContains(node.name)) {
      bindingCount += 1;
      if (node.getStart() < availableBeforePosition) prior = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  return bindingCount === 1 && prior;
}

/** Proves that one statement cannot fall through to the following rendered page body. */
function statementAlwaysExits(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return true;
  if (ts.isBlock(statement)) {
    const last = statement.statements.at(-1);
    return last !== undefined && statementAlwaysExits(last);
  }
  return (
    ts.isIfStatement(statement) &&
    statement.elseStatement !== undefined &&
    statementAlwaysExits(statement.thenStatement) &&
    statementAlwaysExits(statement.elseStatement)
  );
}
