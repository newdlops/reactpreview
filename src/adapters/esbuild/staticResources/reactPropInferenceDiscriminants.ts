/** Collects literal branch choices and exact scalar provenance from comparisons and switches. */
import ts from 'typescript';
import type { ExportedFunctionLike, InferenceState } from './reactPropInferenceModel';
import {
  hasPreviewInferredPropExplicitValue,
  hasPreviewInferredPropUsageExactValue,
  readMutablePathNode,
  requirePath,
} from './reactPropInferenceShape';
import {
  isShadowedPathRoot,
  readLiteralValue,
  readPrimitiveValueKind,
  readPropPath,
} from './reactPropInferenceSyntax';

/**
 * Selects the first authored primitive from a direct prop-derived equality comparison.
 *
 * Type inference can prove that a discriminator is a string while still leaving its value empty.
 * A direct comparison supplies a bounded accepted value without evaluating project code, allowing
 * preview data to enter the component's first authored branch instead of its unreachable fallback.
 */
export function collectEqualityDiscriminantRequirements(
  functionLike: ExportedFunctionLike,
  state: InferenceState,
): void {
  const body = functionLike.body;
  if (body === undefined) return;
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && isPrimitiveEqualityOperator(node.operatorToken.kind)) {
      const candidates = [
        {
          expression: node.left,
          value: readLiteralValue(node.right as ts.LiteralTypeNode['literal']),
        },
        {
          expression: node.right,
          value: readLiteralValue(node.left as ts.LiteralTypeNode['literal']),
        },
      ];
      for (const candidate of candidates) {
        const path_ = readPropPath(candidate.expression, state.aliases);
        if (
          candidate.value !== undefined &&
          path_ !== undefined &&
          path_.length > 0 &&
          !isShadowedPathRoot(candidate.expression, state)
        ) {
          // Keep every source-proven scalar branch, not only collection-row branches. The first
          // value still materializes the deterministic preview default, while the bounded domain
          // lets runtime recovery distinguish an invalid placeholder from a real authored value
          // and lets Inspector hand genuine semantic alternatives to the user.
          appendPreviewInferredCandidateValue(state, path_, candidate.value);
          if (
            !hasPreviewInferredPropExplicitValue(state, path_) ||
            (state.collectionDemandDepth > 0 &&
              !hasPreviewInferredPropUsageExactValue(state, path_))
          ) {
            requirePath(
              state,
              path_,
              readPrimitiveValueKind(candidate.value),
              'usage',
              candidate.value,
              true,
            );
          }
          break;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
}

/** Retains a bounded authored value domain without choosing one branch for every generated row. */
export function appendPreviewInferredCandidateValue(
  state: InferenceState,
  path_: readonly string[],
  value: boolean | number | string,
): void {
  requirePath(state, path_, readPrimitiveValueKind(value), 'usage');
  const node = readMutablePathNode(state, path_);
  if (node?.kind !== readPrimitiveValueKind(value)) return;
  const candidateValues = (node.candidateValues ??= []);
  if (
    candidateValues.length < 8 &&
    !candidateValues.some(
      (candidate) => typeof candidate === typeof value && Object.is(candidate, value),
    )
  ) {
    candidateValues.push(value);
  }
}

/** Restricts discriminator evidence to direct primitive equality and inequality operators. */
export function isPrimitiveEqualityOperator(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.EqualsEqualsEqualsToken || kind === ts.SyntaxKind.EqualsEqualsToken;
}

/**
 * Selects the first authored primitive branch for a direct prop-derived switch discriminant.
 *
 * A switch that names every branch with a literal proves a finite accepted value set without
 * evaluating project code. Existing type or usage requirements retain ownership of a prop value;
 * this is solely the bounded fallback for an otherwise unmaterialized discriminant.
 */
export function collectSwitchDiscriminantRequirements(
  functionLike: ExportedFunctionLike,
  state: InferenceState,
): void {
  const body = functionLike.body;
  if (body === undefined) return;
  const visit = (node: ts.Node): void => {
    if (ts.isSwitchStatement(node)) {
      const path_ = readPropPath(node.expression, state.aliases);
      const caseValues = readDirectPrimitiveSwitchCaseValues(node);
      if (
        path_ !== undefined &&
        path_.length > 0 &&
        !isShadowedPathRoot(node.expression, state) &&
        caseValues !== undefined
      ) {
        for (const candidateValue of caseValues) {
          appendPreviewInferredCandidateValue(state, path_, candidateValue);
        }
        if (
          !hasPreviewInferredPropExplicitValue(state, path_) ||
          (state.collectionDemandDepth > 0 && !hasPreviewInferredPropUsageExactValue(state, path_))
        ) {
          const value = caseValues[0];
          if (value !== undefined) {
            requirePath(state, path_, readPrimitiveValueKind(value), 'usage', value, true);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
}

/** Accepts only switches whose non-default clauses are directly authored primitive literals. */
export function readDirectPrimitiveSwitchCaseValues(
  statement: ts.SwitchStatement,
): readonly (boolean | number | string)[] | undefined {
  const values: (boolean | number | string)[] = [];
  for (const clause of statement.caseBlock.clauses) {
    if (!ts.isCaseClause(clause)) continue;
    const value = readLiteralValue(clause.expression as ts.LiteralTypeNode['literal']);
    if (value === undefined) return undefined;
    values.push(value);
  }
  return values.length > 0 ? values : undefined;
}
