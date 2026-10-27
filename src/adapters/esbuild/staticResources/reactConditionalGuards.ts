/** Recognizes render-prop and continuation-safe authored guard expressions. */
import ts from 'typescript';
import { type PreviewReactRenderTerminalAnalyzer } from './previewReactRenderTerminal';
import {
  hasPreviewSelectedTargetExitPath,
  readPreviewEarlyReturnBranchRoles,
} from './previewSelectedTargetExit';
import {
  describeReturnedRenderExpression,
  inferFallbackBranch,
  isConventionalReactFallbackExpression,
  isDirectReactRenderExpression,
  isNavigationBranchLabel,
} from './reactConditionalBranches';
import type {
  OverlayRuntimeFunction,
  PreviewReactGuardedAccessPath,
  ReactConditionalRenderCandidate,
  ReactDomPortalBindings,
} from './reactConditionalModel';
import {
  findNearestOverlayRuntimeFunction,
  readOverlayRuntimeFunctionName,
  readStaticPropertyName,
  unwrapConditionalExpression,
} from './reactConditionalOverlaySyntax';
import { isPreviewReactEmptyCollectionSafetyGuard } from './reactEmptyCollectionGuard';
import { isPreviewReactQueryLifecycleSafetyGuard } from './reactQueryLifecycleGuard';

/**
 * Converts a component-local early render exit into a target-reachability gate.
 *
 * A login, permission, loading, or empty-state component can commit successfully while preventing
 * every statement below it from mounting. Runtime error boundaries cannot observe that situation,
 * so this bounded transform records which branch must be taken to continue the authored component.
 * Only a single direct JSX/null return is admitted; general control flow remains untouched.
 */
export function collectEarlyReturnGateCandidate(
  statement: ts.IfStatement,
  sourceFile: ts.SourceFile,
  portalBindings: ReactDomPortalBindings,
  invokedLocalRenderFunctions: ReadonlySet<ts.Node>,
  terminalAnalyzer: PreviewReactRenderTerminalAnalyzer,
): ReactConditionalRenderCandidate | undefined {
  const owner = findNearestOverlayRuntimeFunction(statement);
  if (owner === undefined) return undefined;
  const ownerName = readOverlayRuntimeFunctionName(owner, sourceFile);
  if (
    ownerName === undefined ||
    (!/^[$_\p{Lu}]/u.test(ownerName) && !invokedLocalRenderFunctions.has(owner))
  ) {
    return undefined;
  }
  const thenRender = readSingleReturnedRenderExpression(
    statement.thenStatement,
    portalBindings,
    owner,
    terminalAnalyzer,
  );
  const elseRender =
    statement.elseStatement === undefined
      ? undefined
      : readSingleReturnedRenderExpression(
          statement.elseStatement,
          portalBindings,
          owner,
          terminalAnalyzer,
        );
  const thenThrows = thenRender === undefined && hasSingleTerminalThrow(statement.thenStatement);
  const elseThrows =
    statement.elseStatement !== undefined &&
    elseRender === undefined &&
    hasSingleTerminalThrow(statement.elseStatement);
  if (thenRender === undefined && elseRender === undefined && !thenThrows && !elseThrows) {
    return undefined;
  }
  if ((thenRender !== undefined || thenThrows) && (elseRender !== undefined || elseThrows)) {
    if (thenRender === undefined || elseRender === undefined) return undefined;
  }
  if (thenRender !== undefined && elseRender !== undefined) {
    const truthyLabel = describeReturnedRenderExpression(thenRender, sourceFile, portalBindings);
    const falsyLabel = describeReturnedRenderExpression(elseRender, sourceFile, portalBindings);
    return {
      condition: statement.expression,
      expressionLabel: `<${ownerName}> branch: ${statement.expression.getText(sourceFile)}`,
      metadata: {
        ...inferFallbackBranch(truthyLabel, falsyLabel),
        falsyLabel,
        kind: 'early-return',
        ownerName,
        truthyLabel,
      },
    };
  }
  const returnedBranch = thenRender !== undefined || thenThrows ? 'truthy' : 'falsy';
  const roles = readPreviewEarlyReturnBranchRoles(statement, returnedBranch);
  const exit = returnedBranch === 'truthy' ? statement.thenStatement : statement.elseStatement;
  const selectedPathEvidence = exit !== undefined && hasPreviewSelectedTargetExitPath(exit);
  const requiresAuthoredState =
    roles.continuesPastExit &&
    (isPreviewReactContinuationSafetyGuard(statement, returnedBranch) ||
      isPreviewReactEmptyCollectionSafetyGuard(statement, returnedBranch) ||
      isPreviewReactQueryLifecycleSafetyGuard(statement, returnedBranch));
  const thrownBranch = returnedBranch === 'truthy' ? thenThrows : elseThrows;
  const returnedLabel = thrownBranch
    ? 'thrown error'
    : describeReturnedRenderExpression(thenRender ?? elseRender, sourceFile, portalBindings);
  const continuationLabel = `continue <${ownerName}>`;
  const role = isNavigationBranchLabel(returnedLabel) ? ('navigation' as const) : undefined;
  return {
    condition: statement.expression,
    expressionLabel: `<${ownerName}> gate: ${statement.expression.getText(sourceFile)}`,
    metadata: {
      fallbackBranch: roles.fallbackBranch,
      falsyLabel: returnedBranch === 'falsy' ? returnedLabel : continuationLabel,
      kind: 'early-return',
      ownerName,
      ...(role === undefined ? {} : { role }),
      ...(requiresAuthoredState ? { requiresAuthoredState: true as const } : {}),
      ...(thrownBranch && roles.continuesPastExit
        ? { synchronousContinuation: true as const }
        : {}),
      targetBranch: roles.targetBranch,
      ...(roles.continuesPastExit && !selectedPathEvidence
        ? {}
        : { targetBranchEvidence: 'selected-target' as const }),
      truthyLabel: returnedBranch === 'truthy' ? returnedLabel : continuationLabel,
    },
  };
}

/** Recognizes a direct or block-terminal throw without interpreting preceding project statements. */
export function hasSingleTerminalThrow(statement: ts.Statement): boolean {
  if (ts.isBlock(statement)) {
    const terminalStatement = statement.statements.at(-1);
    return terminalStatement !== undefined && hasSingleTerminalThrow(terminalStatement);
  }
  return ts.isThrowStatement(statement);
}

/**
 * Rejects an automatic continuation when the return protects a value consumed later in the body.
 *
 * Registration and data-loading components commonly render `null` or an error placeholder for one
 * commit and then populate a ref/context in an effect. Forcing `if (!value) return ...` to continue
 * cannot create that value; it only moves the failure to the first later dereference. Such guards
 * must settle through the authored state update while navigation/permission gates remain selectable.
 */
export function isPreviewReactContinuationSafetyGuard(
  statement: ts.IfStatement,
  returnedBranch: 'falsy' | 'truthy',
): boolean {
  const guarded = readPreviewReactMissingGuardedAccess(statement.expression, returnedBranch);
  if (guarded === undefined || !ts.isBlock(statement.parent)) return false;
  const statementIndex = statement.parent.statements.indexOf(statement);
  if (statementIndex < 0) return false;
  const continuations = statement.parent.statements.slice(statementIndex + 1);
  let visited = 0;
  const consumption = { found: false };
  const visit = (node: ts.Node): void => {
    if (consumption.found || visited >= 512) return;
    visited += 1;
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
      const access = readPreviewReactStaticAccessPath(node);
      if (access !== undefined && havePreviewReactGuardedAccessPath(access, guarded)) {
        if (guarded.names.length > 1 || isPreviewReactUnsafeGuardedRootUse(node)) {
          consumption.found = true;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  for (const continuation of continuations) {
    visit(continuation);
    if (consumption.found) break;
  }
  return consumption.found;
}

/** Reads the value whose absence selects the returned side of a simple null-safety condition. */
export function readPreviewReactMissingGuardedAccess(
  expression: ts.Expression,
  returnedBranch: 'falsy' | 'truthy',
): PreviewReactGuardedAccessPath | undefined {
  const current = unwrapConditionalExpression(expression);
  if (
    returnedBranch === 'truthy' &&
    ts.isPrefixUnaryExpression(current) &&
    current.operator === ts.SyntaxKind.ExclamationToken
  ) {
    return readPreviewReactStaticAccessPath(current.operand);
  }
  if (!ts.isBinaryExpression(current)) return undefined;
  const leftNullish = isPreviewReactNullishGuardLiteral(current.left);
  const rightNullish = isPreviewReactNullishGuardLiteral(current.right);
  if (leftNullish === rightNullish) return undefined;
  const guardedExpression = leftNullish ? current.right : current.left;
  const equality =
    current.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ||
    current.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken;
  const inequality =
    current.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken ||
    current.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
  const missingSelectsReturn =
    (returnedBranch === 'truthy' && equality) || (returnedBranch === 'falsy' && inequality);
  return missingSelectsReturn ? readPreviewReactStaticAccessPath(guardedExpression) : undefined;
}

/** Recognizes only literal null/undefined checks; arbitrary comparisons remain selectable. */
export function isPreviewReactNullishGuardLiteral(expression: ts.Expression): boolean {
  const current = unwrapConditionalExpression(expression);
  return (
    current.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(current) && current.text === 'undefined') ||
    (ts.isVoidExpression(current) && ts.isNumericLiteral(current.expression))
  );
}

/** Converts one identifier/property chain to a bounded syntax-only identity. */
export function readPreviewReactStaticAccessPath(
  expression: ts.Expression,
): PreviewReactGuardedAccessPath | undefined {
  const names: string[] = [];
  let current = unwrapConditionalExpression(expression);
  while (ts.isPropertyAccessExpression(current) && current.questionDotToken === undefined) {
    names.unshift(current.name.text);
    current = unwrapConditionalExpression(current.expression);
  }
  if (!ts.isIdentifier(current)) return undefined;
  names.unshift(current.text);
  return names.length <= 8 ? { names: Object.freeze(names) } : undefined;
}

/** Compares one exact static access without resolving or executing project symbols. */
export function havePreviewReactGuardedAccessPath(
  left: PreviewReactGuardedAccessPath,
  right: PreviewReactGuardedAccessPath,
): boolean {
  return (
    left.names.length === right.names.length &&
    left.names.every((name, index) => name === right.names[index])
  );
}

/** Requires a dereference, forwarding boundary, call, or destructure for a guarded identifier. */
export function isPreviewReactUnsafeGuardedRootUse(expression: ts.Expression): boolean {
  const parent = expression.parent;
  if (
    (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
    parent.expression === expression
  )
    return true;
  if (
    ts.isCallExpression(parent) &&
    (parent.expression === expression || parent.arguments.includes(expression))
  )
    return true;
  if (
    (ts.isJsxExpression(parent) && parent.expression === expression) ||
    (ts.isJsxSpreadAttribute(parent) && parent.expression === expression)
  )
    return true;
  return (
    ts.isVariableDeclaration(parent) &&
    parent.initializer === expression &&
    !ts.isIdentifier(parent.name)
  );
}

/**
 * Reads a terminal return whose value is JSX, a portal, or `null`.
 *
 * A guarded branch may prepare local values or contain a more specific nested early return before
 * its final render return. Entering such a branch still cannot reach the component body that follows
 * the `if`, so the outer guard is the continuation decision the preview engine must expose. Only the
 * terminal statement is classified; preceding project statements are neither interpreted nor moved.
 */
export function readSingleReturnedRenderExpression(
  statement: ts.Statement,
  portalBindings: ReactDomPortalBindings,
  owner: OverlayRuntimeFunction,
  terminalAnalyzer: PreviewReactRenderTerminalAnalyzer,
): ts.Expression | undefined {
  if (ts.isBlock(statement)) {
    const terminalStatement = statement.statements.at(-1);
    return terminalStatement === undefined
      ? undefined
      : readSingleReturnedRenderExpression(
          terminalStatement,
          portalBindings,
          owner,
          terminalAnalyzer,
        );
  }
  if (!ts.isReturnStatement(statement) || statement.expression === undefined) return undefined;
  const expression = unwrapConditionalExpression(statement.expression);
  return expression.kind === ts.SyntaxKind.NullKeyword ||
    isDirectReactRenderExpression(expression, portalBindings) ||
    isConventionalReactFallbackExpression(expression) ||
    isPreviewReactRenderPropReturnCall(expression, owner, terminalAnalyzer)
    ? expression
    : undefined;
}

/** Recognizes conventional render-prop names without treating arbitrary callback props as React. */
export function isPreviewReactRenderPropName(name: string): boolean {
  return name === 'children' || /^render(?:[$_\p{Lu}]|$)/u.test(name) || name.endsWith('Renderer');
}

/** Proves that one local identifier was destructured from a render-prop component parameter. */
export function isPreviewReactRenderPropParameterBinding(
  owner: OverlayRuntimeFunction,
  localName: string,
): boolean {
  for (const parameter of owner.parameters) {
    if (ts.isIdentifier(parameter.name)) {
      if (parameter.name.text === localName && isPreviewReactRenderPropName(parameter.name.text)) {
        return true;
      }
      continue;
    }
    for (const element of parameter.name.elements) {
      if (
        !ts.isBindingElement(element) ||
        element.dotDotDotToken !== undefined ||
        !ts.isIdentifier(element.name) ||
        element.name.text !== localName
      ) {
        continue;
      }
      const sourceName =
        element.propertyName === undefined
          ? element.name.text
          : readStaticPropertyName(element.propertyName);
      if (sourceName !== undefined && isPreviewReactRenderPropName(sourceName)) return true;
    }
  }
  return false;
}

/** Proves a `props.children(...)`-shaped call against the component's direct parameter. */
export function isPreviewReactRenderPropParameterAccess(
  owner: OverlayRuntimeFunction,
  expression: ts.PropertyAccessExpression,
): boolean {
  if (
    !ts.isIdentifier(expression.expression) ||
    !isPreviewReactRenderPropName(expression.name.text)
  ) {
    return false;
  }
  const parameterName = expression.expression.text;
  return owner.parameters.some(
    (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === parameterName,
  );
}

/** Finds compiler-proven React output inside the value object passed to a render prop. */
export function hasPreviewReactRenderPropPayload(
  expression_: ts.Expression,
  terminalAnalyzer: PreviewReactRenderTerminalAnalyzer,
  depth = 0,
): boolean {
  if (depth > 4) return false;
  const expression = unwrapConditionalExpression(expression_);
  if (terminalAnalyzer.analyze(expression) !== undefined) return true;
  if (!ts.isObjectLiteralExpression(expression)) return false;
  return expression.properties.some((property) => {
    if (ts.isPropertyAssignment(property)) {
      return hasPreviewReactRenderPropPayload(property.initializer, terminalAnalyzer, depth + 1);
    }
    if (ts.isShorthandPropertyAssignment(property)) {
      return terminalAnalyzer.analyze(property.name) !== undefined;
    }
    return false;
  });
}

/**
 * Admits an early return through a component-owned render prop when its payload contains proven JSX.
 *
 * The call target must be the component's own `children`/`render*` parameter. This covers wrappers
 * that return `children({ body: <Loader /> })` without classifying unrelated project calls as React.
 */
export function isPreviewReactRenderPropReturnCall(
  expression: ts.Expression,
  owner: OverlayRuntimeFunction,
  terminalAnalyzer: PreviewReactRenderTerminalAnalyzer,
): expression is ts.CallExpression {
  if (!ts.isCallExpression(expression) || expression.questionDotToken !== undefined) return false;
  const callee = unwrapConditionalExpression(expression.expression);
  const parameterOwned = ts.isIdentifier(callee)
    ? isPreviewReactRenderPropParameterBinding(owner, callee.text)
    : ts.isPropertyAccessExpression(callee)
      ? isPreviewReactRenderPropParameterAccess(owner, callee)
      : false;
  return (
    parameterOwned &&
    expression.arguments.some(
      (argument) =>
        !ts.isSpreadElement(argument) &&
        hasPreviewReactRenderPropPayload(argument, terminalAnalyzer),
    )
  );
}
