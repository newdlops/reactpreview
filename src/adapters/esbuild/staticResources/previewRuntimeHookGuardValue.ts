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
  unwrapPreviewRuntimeExpression,
} from './previewRuntimeHookSyntax';
import type { PreviewRuntimeSemanticFallback } from './previewRuntimeHookSemantics';

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
  const demandedValues = new Set<boolean>();
  const visit = (node: ts.Node): void => {
    if (node !== owner && isPreviewRuntimeFunction(node)) return;
    if (ts.isIfStatement(node)) {
      const conditionValue = readConditionTrueIdentifierValue(node.expression, identifier.text);
      if (conditionValue !== undefined) {
        if (statementAlwaysExits(node.thenStatement) && node.elseStatement === undefined) {
          demandedValues.add(!conditionValue);
        } else if (
          node.elseStatement !== undefined &&
          statementAlwaysExits(node.elseStatement) &&
          !statementAlwaysExits(node.thenStatement)
        ) {
          demandedValues.add(conditionValue);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  if (demandedValues.size !== 1) return undefined;
  const value = [...demandedValues][0] ?? false;
  return {
    expression: String(value),
    label: `generated Boolean ${String(value)} to continue past an early return`,
  };
}

/** Reads the identifier value that makes a simple authored condition evaluate to true. */
function readConditionTrueIdentifierValue(
  expression: ts.Expression,
  identifierName: string,
): boolean | undefined {
  let current = unwrapPreviewRuntimeExpression(expression);
  let negated = false;
  while (
    ts.isPrefixUnaryExpression(current) &&
    current.operator === ts.SyntaxKind.ExclamationToken
  ) {
    negated = !negated;
    current = unwrapPreviewRuntimeExpression(current.operand);
  }
  return ts.isIdentifier(current) && current.text === identifierName ? !negated : undefined;
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
