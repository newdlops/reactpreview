/**
 * Creates static logical-AND outcome edges with chain-level source identity.
 *
 * A short-circuit chain emits one visible path and one hidden path per guard. Keeping their shared
 * identity outside the general outcome walker lets the compact resolver fold those paths without
 * guessing from the subset of guards that JavaScript happened to evaluate.
 */
import ts from 'typescript';
import type { PreviewReactRenderConditionEdge } from './previewReactRenderOutcomeTypes';
import {
  boundedPreviewRenderText,
  createPreviewRenderExpressionFingerprint,
  createPreviewRenderStableId,
  readPreviewRenderLocation,
} from './previewReactRenderOutcomeSyntax';

/** Immutable source context shared by every edge emitted for one authored AND expression. */
interface PreviewReactLogicalAndEdgeContext {
  readonly groupId: string;
  readonly guardCount: number;
  readonly sourceFile: ts.SourceFile;
  readonly sourcePath: string;
}

/** Creates a deterministic group identity from the complete authored AND site. */
function createPreviewReactLogicalAndEdgeContext(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  sourcePath: string,
  guardCount: number,
): PreviewReactLogicalAndEdgeContext {
  const location = readPreviewRenderLocation(sourceFile, expression);
  const expressionFingerprint = createPreviewRenderExpressionFingerprint(
    expression.getText(sourceFile),
  );
  return Object.freeze({
    groupId: createPreviewRenderStableId(
      'logical-and-group',
      sourcePath,
      String(location.line),
      String(location.column),
      expressionFingerprint,
    ),
    guardCount,
    sourceFile,
    sourcePath,
  });
}

/** Creates one frozen truthy/hidden edge at an exact evaluation index in an AND chain. */
function createPreviewReactLogicalAndEdge(
  context: PreviewReactLogicalAndEdgeContext,
  expression: ts.Expression,
  branch: 'falsy' | 'truthy',
  label: string,
  guardIndex: number,
): PreviewReactRenderConditionEdge {
  const location = readPreviewRenderLocation(context.sourceFile, expression);
  const authoredExpression = expression.getText(context.sourceFile);
  const expressionText = boundedPreviewRenderText(authoredExpression);
  const expressionFingerprint = createPreviewRenderExpressionFingerprint(authoredExpression);
  return Object.freeze({
    branch,
    column: location.column,
    expression: expressionText,
    expressionFingerprint,
    id: createPreviewRenderStableId(
      'condition',
      context.sourcePath,
      String(location.line),
      String(location.column),
      'logical-and',
      branch,
      expressionFingerprint,
      expressionText,
      label,
    ),
    kind: 'logical-and',
    label: boundedPreviewRenderText(label),
    line: location.line,
    logicalAndGroupId: context.groupId,
    logicalAndGuardCount: context.guardCount,
    logicalAndGuardIndex: guardIndex,
    selectable: true,
    sourcePath: context.sourcePath,
  });
}

/** Truthy and hidden edges for one guard, ordered exactly like JavaScript evaluates the chain. */
export interface PreviewReactLogicalAndGuardEdges {
  readonly falsy: PreviewReactRenderConditionEdge;
  readonly truthy: PreviewReactRenderConditionEdge;
}

/** Creates every indexed edge for one expanded logical-AND expression in a single bounded pass. */
export function createPreviewReactLogicalAndEdges(
  root: ts.Expression,
  guards: readonly ts.Expression[],
  sourceFile: ts.SourceFile,
  sourcePath: string,
): readonly PreviewReactLogicalAndGuardEdges[] {
  const context = createPreviewReactLogicalAndEdgeContext(
    root,
    sourceFile,
    sourcePath,
    guards.length,
  );
  return Object.freeze(
    guards.map((guard, index) =>
      Object.freeze({
        falsy: createPreviewReactLogicalAndEdge(context, guard, 'falsy', 'hidden', index),
        truthy: createPreviewReactLogicalAndEdge(context, guard, 'truthy', 'truthy', index),
      }),
    ),
  );
}
