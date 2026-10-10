/**
 * Locates JSX that a component returns before its final `return`.
 *
 * Preview hook fallbacks continue past early returns (`if (!token) return <SignedOut />`), so a
 * route declared only in such a branch is not what the preview renders. Route ranking uses these
 * ranges to keep the default route on the branch that is actually drawn.
 */
import path from 'node:path';
import ts from 'typescript';

/** Source offsets of one early `return` statement, end-exclusive. */
export interface PreviewInspectorEarlyReturnRange {
  readonly end: number;
  readonly start: number;
}

/**
 * Collects `return` statements nested in an `if` that precedes a function body's last top-level
 * `return`. Returns inside nested functions belong to those functions and are visited separately.
 */
export function collectPreviewInspectorEarlyReturnRanges(
  sourcePath: string,
  sourceText: string,
): readonly PreviewInspectorEarlyReturnRange[] {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    // Plain TypeScript cannot contain JSX; every other module may.
    /\.[cm]?ts$/iu.test(sourcePath) ? ts.ScriptKind.TS : ts.ScriptKind.TSX,
  );
  const ranges: PreviewInspectorEarlyReturnRange[] = [];
  const collectReturns = (node: ts.Node): void => {
    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      ranges.push(Object.freeze({ end: node.getEnd(), start: node.getStart(sourceFile) }));
    }
    if (!ts.isFunctionLike(node)) ts.forEachChild(node, collectReturns);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && 'body' in node && node.body !== undefined) {
      const body = node.body as ts.Node;
      if (ts.isBlock(body)) {
        let finalReturnIndex = -1;
        body.statements.forEach((statement, index) => {
          if (ts.isReturnStatement(statement)) finalReturnIndex = index;
        });
        for (const statement of body.statements.slice(0, Math.max(finalReturnIndex, 0))) {
          if (ts.isIfStatement(statement)) ts.forEachChild(statement, collectReturns);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return Object.freeze(ranges);
}

/** Reports whether a source offset lies inside one collected early `return`. */
export function isPreviewInspectorEarlyReturnOccurrence(
  ranges: readonly PreviewInspectorEarlyReturnRange[],
  offset: number,
): boolean {
  return ranges.some((range) => offset >= range.start && offset < range.end);
}

/** Keeps routes declared only in a skipped early `return` behind the branch the preview draws. */
export const PREVIEW_INSPECTOR_EARLY_RETURN_ROUTE_PENALTY = 5_000;

/** Scores route occurrences of one owner module; occurrences in other modules are unaffected. */
export function createPreviewInspectorEarlyReturnRoutePenalty(
  sourcePath: string,
  sourceText: string | undefined,
): (occurrence: { readonly occurrenceStart: number; readonly sourcePath: string }) => number {
  const ranges =
    sourceText === undefined
      ? []
      : collectPreviewInspectorEarlyReturnRanges(sourcePath, sourceText);
  const ownerPath = path.normalize(sourcePath);
  return (occurrence) =>
    path.normalize(occurrence.sourcePath) === ownerPath &&
    isPreviewInspectorEarlyReturnOccurrence(ranges, occurrence.occurrenceStart)
      ? PREVIEW_INSPECTOR_EARLY_RETURN_ROUTE_PENALTY
      : 0;
}
