/** Resolves a nested route module's immutable base path without evaluating its application body. */
import ts from 'typescript';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';
import { resolvePreviewInspectorStaticExport } from './previewInspectorStaticBindingTrace';

/**
 *
 */
/** Resolves a nested owner export through safe static aliases and reads its mount pattern. */
export async function resolvePreviewInspectorRouteFactoryOwner(options: {
  readonly exportName: string;
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  readonly sourcePath: string;
}): Promise<
  | {
      readonly basePattern: string;
      readonly dependencyPaths: readonly string[];
      readonly exportName: string;
      readonly sourcePath: string;
    }
  | undefined
> {
  const value = await resolvePreviewInspectorStaticExport(options);
  if (value === undefined) return undefined;
  const call = unwrapToCall(value.expression, value.sourceFile);
  if (call === undefined) return undefined;
  const basePattern = readBase(
    call.arguments[0],
    value.sourceFile,
    call.getStart(value.sourceFile),
  );
  if (basePattern === undefined) return undefined;
  return Object.freeze({
    basePattern,
    dependencyPaths: Object.freeze([value.sourcePath]),
    exportName: options.exportName,
    sourcePath: value.sourcePath,
  });
}

/**
 *
 */
/** Follows a same-file immutable alias only far enough to obtain a factory call. */
function unwrapToCall(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): ts.CallExpression | undefined {
  let value = unwrap(expression);
  if (ts.isIdentifier(value)) {
    const initializer = readPriorConst(sourceFile, value.text, Number.MAX_SAFE_INTEGER);
    if (initializer !== undefined) value = unwrap(initializer);
  }
  return ts.isCallExpression(value) ? value : undefined;
}

/**
 *
 */
/** Reads a literal or prior immutable string base, rejecting computed runtime expressions. */
function readBase(
  expression: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
  before: number,
): string | undefined {
  if (expression === undefined) return undefined;
  const value = unwrap(expression);
  if (ts.isStringLiteralLike(value) || ts.isNoSubstitutionTemplateLiteral(value))
    return value.text.startsWith('/') ? value.text : undefined;
  if (!ts.isIdentifier(value)) return undefined;
  const initializer = readPriorConst(sourceFile, value.text, before);
  const literal = initializer === undefined ? undefined : unwrap(initializer);
  return literal !== undefined &&
    (ts.isStringLiteralLike(literal) || ts.isNoSubstitutionTemplateLiteral(literal)) &&
    literal.text.startsWith('/')
    ? literal.text
    : undefined;
}

/**
 *
 */
/** Looks up one unambiguous, prior top-level const initializer. */
function readPriorConst(
  sourceFile: ts.SourceFile,
  name: string,
  before: number,
): ts.Expression | undefined {
  const matches: ts.Expression[] = [];
  for (const statement of sourceFile.statements) {
    if (
      statement.getStart(sourceFile) >= before ||
      !ts.isVariableStatement(statement) ||
      (statement.declarationList.flags & ts.NodeFlags.Const) === 0
    )
      continue;
    for (const declaration of statement.declarationList.declarations)
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === name &&
        declaration.initializer !== undefined
      )
        matches.push(declaration.initializer);
  }
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 *
 */
/** Removes transparent TypeScript wrappers from a static value. */
function unwrap(expression: ts.Expression): ts.Expression {
  let value = expression;
  while (
    ts.isParenthesizedExpression(value) ||
    ts.isAsExpression(value) ||
    ts.isSatisfiesExpression(value) ||
    ts.isNonNullExpression(value) ||
    ts.isTypeAssertionExpression(value)
  )
    value = value.expression;
  return value;
}
