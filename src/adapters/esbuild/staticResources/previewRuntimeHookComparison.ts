/**
 * Chooses preview-only values for hook results used exclusively in equality guards.
 *
 * A missing selector must not accidentally activate loading, error, or modal overlays merely
 * because the compared enum member was the only nearby value. The render-condition boundary can
 * still flip a statically proven target-path gate later; this helper only keeps the initial branch
 * neutral without evaluating project code.
 */
import ts from 'typescript';

/** Returns source text that makes the authored equality or inequality expression evaluate false. */
export function createPreviewComparisonFalseExpression(
  neutralText: string,
  compared: ts.Expression,
  operator: ts.SyntaxKind,
  sourceFile: ts.SourceFile,
): string {
  if (
    operator === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    operator === ts.SyntaxKind.ExclamationEqualsToken
  ) {
    return compared.getText(sourceFile);
  }
  if (compared.kind === ts.SyntaxKind.TrueKeyword) return 'false';
  if (compared.kind === ts.SyntaxKind.FalseKeyword) return 'true';
  if (ts.isNumericLiteral(compared)) return Number(compared.text) === 0 ? '1' : '0';
  return JSON.stringify(
    ts.isStringLiteral(compared) && compared.text === neutralText
      ? neutralText + '-preview'
      : neutralText,
  );
}
