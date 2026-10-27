/** Finds exact overlay visibility and portal evidence in authored runtime functions. */
import ts from 'typescript';
import {
  type ReactConditionalRenderCandidate,
  type ReactDomPortalBindings,
  NEGATIVE_OVERLAY_VISIBILITY_PROPS,
  OVERLAY_COMPONENT_NAME_PATTERN,
  POSITIVE_OVERLAY_VISIBILITY_PROPS,
} from './reactConditionalModel';
import {
  findNearestOverlayRuntimeFunction,
  isOverlayRuntimeFunction,
  readOverlayRuntimeFunctionName,
} from './reactConditionalOverlaySyntax';

/**
 * Converts an overlay component's early `return null` guard into visible-state semantics.
 * A true hidden guard is inverted around the resolver, so an absent override still follows the
 * authored branch while the Inspector consistently exposes true=visible and false=dormant.
 */
export function collectOverlayNullGuardCandidate(
  statement: ts.IfStatement,
  sourceFile: ts.SourceFile,
  portalBindings: ReactDomPortalBindings,
): ReactConditionalRenderCandidate | undefined {
  const thenHidden = statementReturnsNull(statement.thenStatement);
  const elseHidden =
    statement.elseStatement !== undefined && statementReturnsNull(statement.elseStatement);
  if (thenHidden === elseHidden) return undefined;
  const owner = findNearestOverlayRuntimeFunction(statement);
  if (owner === undefined || !isOverlayRuntimeFunction(owner, sourceFile, portalBindings)) {
    return undefined;
  }
  const ownerName = readOverlayRuntimeFunctionName(owner, sourceFile) ?? 'Overlay';
  return {
    condition: statement.expression,
    expressionLabel: `<${ownerName}> visibility: ${statement.expression.getText(sourceFile)}`,
    metadata: {
      falsyLabel: `hidden <${ownerName}> overlay`,
      kind: 'overlay-visibility',
      ownerName,
      role: 'overlay',
      truthyLabel: `visible <${ownerName}> overlay`,
    },
    ...(thenHidden ? { negateRuntimeResult: true } : {}),
  };
}

/** Recognizes a direct or single-block null return without interpreting control flow. */
export function statementReturnsNull(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement))
    return statement.expression?.kind === ts.SyntaxKind.NullKeyword;
  if (!ts.isBlock(statement) || statement.statements.length !== 1) return false;
  const onlyStatement = statement.statements[0];
  return onlyStatement !== undefined && statementReturnsNull(onlyStatement);
}

/** Collects explicit controlled visibility props from conventionally named overlay JSX tags. */
export function collectOverlayVisibilityCandidates(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  sourceFile: ts.SourceFile,
): readonly ReactConditionalRenderCandidate[] {
  const tagName = element.tagName.getText(sourceFile);
  if (!tagName.split('.').some((segment) => OVERLAY_COMPONENT_NAME_PATTERN.test(segment))) {
    return [];
  }
  const candidates: ReactConditionalRenderCandidate[] = [];
  const ownerName = tagName.split('.').at(-1) ?? tagName;
  for (const property of element.attributes.properties) {
    if (!ts.isJsxAttribute(property)) continue;
    const propName = property.name.getText(sourceFile);
    const normalizedPropName = propName.replace(/[-_]/gu, '').toLowerCase();
    const positive = POSITIVE_OVERLAY_VISIBILITY_PROPS.has(normalizedPropName);
    const negative = NEGATIVE_OVERLAY_VISIBILITY_PROPS.has(normalizedPropName);
    const initializer = property.initializer;
    if (
      (!positive && !negative) ||
      initializer === undefined ||
      !ts.isJsxExpression(initializer) ||
      initializer.expression === undefined
    ) {
      continue;
    }
    const authoredExpression = initializer.expression.getText(sourceFile);
    candidates.push({
      condition: initializer.expression,
      expressionLabel: `<${tagName}>.${propName}: ${authoredExpression}`,
      metadata: {
        falsyLabel: `hidden <${tagName}> overlay`,
        kind: 'overlay-visibility',
        ownerName,
        role: 'overlay',
        truthyLabel: `visible <${tagName}> overlay`,
      },
      ...(negative ? { negateRuntimeResult: true } : {}),
    });
  }
  return candidates;
}
