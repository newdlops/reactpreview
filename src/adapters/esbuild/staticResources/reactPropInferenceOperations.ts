/** Infers neutral values from authored operators and render guards. */
import ts from 'typescript';
import { inferPreviewRuntimeSemanticFallback } from './previewRuntimeHookSemantics';
import { inferReactOverlayVisibilityNeutralValue } from './reactOverlayVisibilityNeutralValue';
import {
  ARRAY_METHOD_NAMES,
  STRING_COLLECTION_SHARED_METHOD_NAMES,
  STRING_METHOD_NAMES,
  type InferenceState,
  type MutableShapeNode,
  type PreviewInferredPropKind,
  type PropPathBinding,
} from './reactPropInferenceModel';
import {
  hasPreviewInferredPropTerminal,
  readMutablePathNode,
  requirePath,
} from './reactPropInferenceShape';
import {
  isAccessExpression,
  readPrimitiveValueKind,
  readPropPath,
  unwrapExpression,
} from './reactPropInferenceSyntax';

/** Ensures receiver prefixes exist only before an authored optional-chain short circuit. */
export function addReceiverContainers(
  state: InferenceState,
  path_: readonly string[],
  exclusiveLength: number,
): void {
  for (let length = 1; length < exclusiveLength; length += 1) {
    requirePath(state, path_.slice(0, length), 'object', 'usage');
  }
}

/**
 * Applies uses behind an optional receiver ('promoWeeks?.has(week)') once other evidence (here
 * 'promoWeeks.get(week)') materialized that receiver anyway: a generated object must then carry
 * those members too. A receiver nothing else proves stays absent, as the optional chain allows.
 */
export function applyMaterializedOptionalOperations(state: InferenceState): void {
  for (const { node, path, receiverLength } of state.optionalOperations ?? []) {
    let receiver: MutableShapeNode | undefined = state.root;
    for (const name of path.slice(0, receiverLength)) receiver = receiver?.children.get(name);
    if (receiver?.kind !== 'object') continue;
    addReceiverContainers(state, path, path.length);
    addOperationRequirement(state, path, node);
  }
}

/** Infers callable/iterable/primitive kinds only when the consuming syntax proves the operation. */
export function addOperationRequirement(
  state: InferenceState,
  path_: readonly string[],
  node: ts.Expression,
): void {
  const parent = node.parent;
  const arithmeticNeutralValue = readArithmeticNeutralValue(node, parent);
  if (arithmeticNeutralValue !== undefined) {
    requirePath(state, path_, 'number', 'usage', arithmeticNeutralValue, true);
    return;
  }
  if (isLogicalEmptyArrayFallback(node, parent)) {
    requirePath(state, path_, 'array', 'usage');
    return;
  }
  if (
    ts.isVariableDeclaration(parent) &&
    parent.initializer === node &&
    ts.isArrayBindingPattern(parent.name)
  ) {
    requirePath(state, path_, 'array', 'usage');
    const arrayNode = readMutablePathNode(state, path_);
    if (arrayNode?.kind === 'array') arrayNode.itemConsumed = true;
    return;
  }
  const logicalFallbackValue = readLogicalPrimitiveFallbackValue(node, parent);
  if (logicalFallbackValue !== undefined) {
    requirePath(
      state,
      path_,
      readPrimitiveValueKind(logicalFallbackValue),
      'usage',
      logicalFallbackValue,
    );
    return;
  }
  const overlayNeutralValue = inferReactOverlayVisibilityNeutralValue(node);
  if (overlayNeutralValue !== undefined) {
    requirePath(state, path_, overlayNeutralValue.kind, 'usage', overlayNeutralValue.value, true);
    return;
  }
  if (
    ((ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) &&
      parent.tagName === node) ||
    (ts.isJsxClosingElement(parent) && parent.tagName === node)
  ) {
    requirePath(state, path_, 'component', 'usage');
    return;
  }
  const directJsxPropName = readDirectJsxPropName(node);
  if (directJsxPropName !== undefined) {
    const semantic =
      inferPreviewUsageSemanticFallback(state, path_.at(-1) ?? '') ??
      inferPreviewUsageSemanticFallback(state, directJsxPropName);
    if (semantic !== undefined) {
      requirePath(state, path_, semantic.kind, 'usage', semantic.value, semantic.exactValue);
      return;
    }
  }
  if (
    ts.isCallExpression(parent) &&
    parent.expression === node &&
    parent.questionDotToken !== undefined
  ) {
    return;
  }
  if (
    ts.isPrefixUnaryExpression(parent) &&
    parent.operator === ts.SyntaxKind.ExclamationToken &&
    parent.operand === node
  ) {
    /* Negation proves truthiness, not Boolean type. Preserve a semantic URL/data value so an exact
     * target can pass `if (!value) return null` instead of receiving a self-defeating `false`. */
    const semantic = inferPreviewUsageSemanticFallback(state, path_.at(-1) ?? '');
    if (isRenderTerminatingNegatedGuard(parent)) {
      if (semantic?.kind === 'boolean') {
        requirePath(state, path_, 'boolean', 'usage', true, true);
      } else if (semantic?.kind === 'number') {
        requirePath(state, path_, 'number', 'usage', 1, true);
      } else if (semantic?.kind === 'null' || semantic === undefined) {
        requirePath(state, path_, 'object', 'usage');
      } else {
        requirePath(state, path_, semantic.kind, 'usage', semantic.value, true);
      }
    } else {
      requirePath(state, path_, semantic?.kind ?? 'boolean', 'usage', semantic?.value ?? false);
    }
    return;
  }
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === node) {
    const methodName = path_.at(-1);
    const receiverPath = path_.slice(0, -1);
    const semanticReceiver = inferPreviewUsageSemanticFallback(state, receiverPath.at(-1) ?? '');
    if (
      receiverPath.length > 0 &&
      methodName === 'toString' &&
      semanticReceiver !== undefined &&
      (semanticReceiver.kind === 'boolean' ||
        semanticReceiver.kind === 'number' ||
        semanticReceiver.kind === 'string')
    ) {
      requirePath(
        state,
        receiverPath,
        semanticReceiver.kind,
        'usage',
        semanticReceiver.value,
        semanticReceiver.exactValue,
      );
      return;
    }
    const sharedStringReceiver =
      methodName !== undefined &&
      STRING_COLLECTION_SHARED_METHOD_NAMES.has(methodName) &&
      semanticReceiver?.kind === 'string';
    if (
      receiverPath.length > 0 &&
      methodName !== undefined &&
      ARRAY_METHOD_NAMES.has(methodName) &&
      !sharedStringReceiver
    ) {
      requirePath(state, receiverPath, 'array', 'usage');
    } else if (
      receiverPath.length > 0 &&
      methodName !== undefined &&
      (STRING_METHOD_NAMES.has(methodName) || sharedStringReceiver)
    ) {
      requirePath(state, receiverPath, 'string', 'usage');
    } else {
      requirePath(state, path_, 'function', 'usage');
    }
    return;
  }
  if (
    (ts.isForOfStatement(parent) && parent.expression === node) ||
    (ts.isSpreadElement(parent) && ts.isArrayLiteralExpression(parent.parent))
  ) {
    requirePath(state, path_, 'array', 'usage');
    return;
  }
  if (
    path_.length > 1 &&
    !hasPreviewInferredPropTerminal(state, path_) &&
    isReactRenderedValueExpression(node)
  ) {
    const semantic = inferPreviewUsageSemanticFallback(state, path_.at(-1) ?? '');
    if (semantic !== undefined) {
      requirePath(state, path_, semantic.kind, 'usage', semantic.value, semantic.exactValue);
    }
  }
  if (
    state.allowRenderedRootScalar &&
    path_.length === 1 &&
    ts.isIdentifier(node) &&
    !hasPreviewInferredPropTerminal(state, path_) &&
    isReactRenderedChildValueExpression(node)
  ) {
    const renderedName = node.text;
    requirePath(
      state,
      path_,
      'string',
      'usage',
      renderedName.length <= 32 ? renderedName : `${renderedName.slice(0, 31)}…`,
    );
    let renderedNode = state.root;
    for (const propertyName of path_) {
      const child = renderedNode.children.get(propertyName);
      if (child === undefined) return;
      renderedNode = child;
    }
    renderedNode.renderedValue = true;
  }
}

/** Distinguishes actual React child content from an opaque JSX attribute forwarding edge. */
export function isReactRenderedChildValueExpression(node: ts.Expression): boolean {
  let current: ts.Expression = node;
  let parent = current.parent;
  while (
    ts.isParenthesizedExpression(parent) ||
    ts.isAsExpression(parent) ||
    ts.isSatisfiesExpression(parent) ||
    ts.isNonNullExpression(parent) ||
    ts.isTypeAssertionExpression(parent)
  ) {
    current = parent;
    parent = current.parent;
  }
  return (
    ts.isJsxExpression(parent) &&
    parent.expression === current &&
    (ts.isJsxElement(parent.parent) || ts.isJsxFragment(parent.parent))
  );
}

/**
 * Carries a prop collection through `const rows = value ?? []` without inventing membership.
 * The empty fallback proves the runtime container kind while preserving every authored item from
 * the left side, so a later `rows.map(...)` can safely refine the original prop's item contract.
 */
export function readEmptyCollectionDefaultPropPath(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, PropPathBinding>,
): readonly string[] | undefined {
  const current = unwrapExpression(expression);
  if (
    !ts.isBinaryExpression(current) ||
    (current.operatorToken.kind !== ts.SyntaxKind.BarBarToken &&
      current.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return undefined;
  }
  const fallback = unwrapExpression(current.right);
  if (!ts.isArrayLiteralExpression(fallback) || fallback.elements.length !== 0) return undefined;
  return readPropPath(current.left, aliases);
}

/** Prefers a source-proven registry key over generic text derived from the field name. */
export function inferPreviewUsageSemanticFallback(
  state: InferenceState,
  rawName: string,
):
  | {
      readonly exactValue?: true;
      readonly kind: PreviewInferredPropKind;
      readonly value?: boolean | number | string | null;
    }
  | undefined {
  const registryValue = state.registryDiscriminantHints.get(rawName);
  if (registryValue !== undefined) {
    return {
      exactValue: true,
      kind: readPrimitiveValueKind(registryValue),
      value: registryValue,
    };
  }
  const semantic = inferPreviewRuntimeSemanticFallback(rawName);
  return semantic === undefined
    ? undefined
    : {
        kind: semantic.kind,
        ...(semantic.value === undefined ? {} : { value: semantic.value }),
      };
}

/** Reads an unchanged value forwarded through one ordinary JSX attribute. */
export function readDirectJsxPropName(expression: ts.Expression): string | undefined {
  const container = expression.parent;
  if (
    !ts.isJsxExpression(container) ||
    container.expression !== expression ||
    !ts.isJsxAttribute(container.parent) ||
    !ts.isIdentifier(container.parent.name)
  ) {
    return undefined;
  }
  return container.parent.name.text;
}

/** Selects the neutral number proven by a direct arithmetic operation. */
export function readArithmeticNeutralValue(
  expression: ts.Expression,
  parent: ts.Node,
): number | undefined {
  if (
    ts.isPrefixUnaryExpression(parent) &&
    parent.operand === expression &&
    (parent.operator === ts.SyntaxKind.PlusToken || parent.operator === ts.SyntaxKind.MinusToken)
  ) {
    return 0;
  }
  if (
    !ts.isBinaryExpression(parent) ||
    (parent.left !== expression && parent.right !== expression)
  ) {
    return undefined;
  }
  const operator = parent.operatorToken.kind;
  if (
    operator === ts.SyntaxKind.AsteriskToken ||
    operator === ts.SyntaxKind.SlashToken ||
    operator === ts.SyntaxKind.PercentToken ||
    operator === ts.SyntaxKind.AsteriskAsteriskToken
  ) {
    return 1;
  }
  if (operator === ts.SyntaxKind.MinusToken) return 0;
  if (operator !== ts.SyntaxKind.PlusToken) return undefined;
  const other = parent.left === expression ? parent.right : parent.left;
  return ts.isNumericLiteral(unwrapExpression(other)) ? 0 : undefined;
}

/** Reuses a direct primitive `value || fallback`/`value ?? fallback` as a render-safe sample. */
export function readLogicalPrimitiveFallbackValue(
  expression: ts.Expression,
  parent: ts.Node,
): boolean | number | string | undefined {
  if (
    !ts.isBinaryExpression(parent) ||
    parent.left !== expression ||
    (parent.operatorToken.kind !== ts.SyntaxKind.BarBarToken &&
      parent.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return undefined;
  }
  const fallback = unwrapExpression(parent.right);
  if (ts.isStringLiteralLike(fallback)) return fallback.text;
  if (ts.isNumericLiteral(fallback)) return Number(fallback.text);
  if (fallback.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (fallback.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

/** Treats a direct `value || []` / `value ?? []` receiver as an Array contract. */
export function isLogicalEmptyArrayFallback(expression: ts.Expression, parent: ts.Node): boolean {
  if (
    !ts.isBinaryExpression(parent) ||
    parent.left !== expression ||
    (parent.operatorToken.kind !== ts.SyntaxKind.BarBarToken &&
      parent.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return false;
  }
  const fallback = unwrapExpression(parent.right);
  return ts.isArrayLiteralExpression(fallback) && fallback.elements.length === 0;
}

/** Reports a negated prop guard whose selected branch exits before visible component output. */
export function isRenderTerminatingNegatedGuard(negation: ts.PrefixUnaryExpression): boolean {
  let condition: ts.Expression = negation;
  let parent = condition.parent;
  while (
    (ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isTypeAssertionExpression(parent)) &&
    parent.expression === condition
  ) {
    condition = parent;
    parent = condition.parent;
  }
  return (
    ts.isIfStatement(parent) &&
    parent.expression === condition &&
    doesStatementTerminateRender(parent.thenStatement)
  );
}

/** Accepts only a direct return/throw or a block whose last statement is a direct terminal. */
export function doesStatementTerminateRender(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return true;
  if (!ts.isBlock(statement)) return false;
  const terminal = statement.statements.at(-1);
  return (
    terminal !== undefined && (ts.isReturnStatement(terminal) || ts.isThrowStatement(terminal))
  );
}

/**
 * Reports whether one prop-derived value reaches JSX output. Semantic keys may seed that leaf while
 * syntax-only wrappers are skipped without following calls or changing unrelated control flow.
 */
export function isReactRenderedValueExpression(node: ts.Expression): boolean {
  let current: ts.Expression = node;
  let parent = current.parent;
  while (
    ts.isParenthesizedExpression(parent) ||
    ts.isAsExpression(parent) ||
    ts.isSatisfiesExpression(parent) ||
    ts.isNonNullExpression(parent) ||
    ts.isTypeAssertionExpression(parent)
  ) {
    current = parent;
    parent = current.parent;
  }
  if (!ts.isJsxExpression(parent) || parent.expression !== current) return false;
  return (
    ts.isJsxAttribute(parent.parent) ||
    ts.isJsxElement(parent.parent) ||
    ts.isJsxFragment(parent.parent)
  );
}

/** Finds the shallowest optional receiver so neutral props preserve authored short-circuiting. */
export function readFirstOptionalReceiverLength(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, PropPathBinding>,
): number | undefined {
  let current = unwrapExpression(expression);
  let selected: number | undefined;
  while (isAccessExpression(current)) {
    if (current.questionDotToken !== undefined) {
      const receiverPath = readPropPath(current.expression, aliases);
      if (receiverPath !== undefined) {
        selected =
          selected === undefined ? receiverPath.length : Math.min(selected, receiverPath.length);
      }
    }
    current = unwrapExpression(current.expression);
  }
  return selected;
}
