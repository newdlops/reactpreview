/**
 * Records a selected imported render-value return without interpreting arbitrary utility code.
 * Only exported synchronous dispatch helpers made of parameter aliases, imported returns and a
 * terminal invariant throw qualify. Boolean overrides still require an exact live render path.
 */
import ts from 'typescript';
import { isPreviewSelectedTargetExit } from './previewSelectedTargetExit';
import type { ReactConditionalRenderCandidate } from './reactConditionalModel';

type DispatchFunction = ts.ArrowFunction | ts.FunctionDeclaration;

/**
 * Collects source-proven selected-return guards; missing or ambiguous target evidence is a no-op.
 * The caller registers the current module's exact selected occurrence names before this analysis.
 */
export function collectPreviewSelectedRenderHelperGuards(
  source: ts.SourceFile,
): readonly ReactConditionalRenderCandidate[] {
  const imports = new Set<string>();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
    )
      continue;
    const clause = statement.importClause;
    if (clause?.name !== undefined) imports.add(clause.name.text);
    if (clause?.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
      for (const binding of clause.namedBindings.elements) {
        if (!binding.isTypeOnly) imports.add(binding.name.text);
      }
    }
  }
  const candidates: ReactConditionalRenderCandidate[] = [];
  for (const statement of source.statements) {
    if (!hasExportModifier(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      candidates.push(...readDispatchGuards(statement, statement.name.text, imports));
    } else if (ts.isVariableStatement(statement)) {
      if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer !== undefined &&
          ts.isArrowFunction(declaration.initializer)
        ) {
          candidates.push(
            ...readDispatchGuards(declaration.initializer, declaration.name.text, imports),
          );
        }
      }
    }
  }
  return candidates;
}

/** Requires a small, side-effect-free dispatch shape before identifying its selected return. */
function readDispatchGuards(
  owner: DispatchFunction,
  ownerName: string,
  imports: ReadonlySet<string>,
): readonly ReactConditionalRenderCandidate[] {
  if (
    owner.body === undefined ||
    !ts.isBlock(owner.body) ||
    owner.body.statements.length > 32 ||
    (ts.isFunctionDeclaration(owner) && owner.asteriskToken !== undefined) ||
    owner.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
  )
    return [];
  const locals = new Set<string>();
  for (const parameter of owner.parameters) {
    if (
      !ts.isIdentifier(parameter.name) ||
      parameter.initializer !== undefined ||
      parameter.dotDotDotToken !== undefined
    )
      return [];
    if (locals.has(parameter.name.text) || imports.has(parameter.name.text)) return [];
    locals.add(parameter.name.text);
  }
  const guards: { statement: ts.IfStatement; call: ts.CallExpression }[] = [];
  let terminal = false;
  for (const statement of owner.body.statements) {
    if (terminal) return [];
    if (ts.isVariableStatement(statement)) {
      if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) return [];
      for (const declaration of statement.declarationList.declarations) {
        if (
          declaration.initializer === undefined ||
          !isLocalAccess(declaration.initializer, locals)
        )
          return [];
        const names = readAliasNames(declaration.name);
        if (names === undefined || names.some((name) => locals.has(name) || imports.has(name)))
          return [];
        for (const name of names) locals.add(name);
      }
    } else if (ts.isIfStatement(statement) && statement.elseStatement === undefined) {
      if (!isDispatchCondition(statement.expression, locals)) return [];
      const call = readImportedReturn(statement.thenStatement, imports, locals);
      if (call === undefined) return [];
      guards.push({ statement, call });
    } else if (ts.isReturnStatement(statement)) {
      if (readImportedReturn(statement, imports, locals) === undefined) return [];
      terminal = true;
    } else if (isInvariantThrow(statement)) {
      terminal = true;
    } else return [];
  }
  if (!terminal) return [];
  return guards.flatMap(({ statement, call }) => {
    if (
      !isBooleanFlag(statement.expression, locals) ||
      !isPreviewSelectedTargetExit(statement.thenStatement)
    )
      return [];
    const targetCallName = (call.expression as ts.Identifier).text;
    return [
      {
        condition: statement.expression,
        expressionLabel: `${ownerName} branch: ${statement.expression.getText()}`,
        metadata: {
          fallbackBranch: 'falsy' as const,
          falsyLabel: `continue ${ownerName}`,
          kind: 'early-return' as const,
          ownerName,
          renderValueHelper: true as const,
          targetBranch: 'truthy' as const,
          targetBranchEvidence: 'selected-target' as const,
          targetCallName,
          truthyLabel: `return ${targetCallName}`,
        },
      },
    ];
  });
}

/** Only parameter-rooted reads are accepted; getters/calls are never executed by the analyzer. */
function isLocalAccess(expression: ts.Expression, locals: ReadonlySet<string>): boolean {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  if (ts.isIdentifier(current)) return locals.has(current.text);
  return (
    ts.isPropertyAccessExpression(current) &&
    current.questionDotToken === undefined &&
    isLocalAccess(current.expression, locals)
  );
}

/** Allows conjunctions in unselected dispatch branches while the selected guard must be one flag. */
function isDispatchCondition(expression: ts.Expression, locals: ReadonlySet<string>): boolean {
  return (
    isBooleanFlag(expression, locals) ||
    (ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      isDispatchCondition(expression.left, locals) &&
      isDispatchCondition(expression.right, locals))
  );
}

/** Runtime checks the actual value is Boolean before this one flag can be guided. */
function isBooleanFlag(expression: ts.Expression, locals: ReadonlySet<string>): boolean {
  return (
    isLocalAccess(expression, locals) ||
    (ts.isPrefixUnaryExpression(expression) &&
      expression.operator === ts.SyntaxKind.ExclamationToken &&
      isLocalAccess(expression.operand, locals))
  );
}

/** Accepts one imported call with inert parameter/literal arguments, with no preceding statements. */
function readImportedReturn(
  statement: ts.Statement,
  imports: ReadonlySet<string>,
  locals: ReadonlySet<string>,
): ts.CallExpression | undefined {
  if (ts.isBlock(statement)) {
    const only = statement.statements.length === 1 ? statement.statements[0] : undefined;
    return only === undefined ? undefined : readImportedReturn(only, imports, locals);
  }
  if (!ts.isReturnStatement(statement) || statement.expression === undefined) return undefined;
  const call = statement.expression;
  if (
    !ts.isCallExpression(call) ||
    !ts.isIdentifier(call.expression) ||
    !imports.has(call.expression.text)
  )
    return undefined;
  return call.arguments.every(
    (argument) =>
      isLocalAccess(argument, locals) ||
      ts.isStringLiteralLike(argument) ||
      ts.isNumericLiteral(argument) ||
      [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(
        argument.kind,
      ),
  )
    ? call
    : undefined;
}

/** Destructuring may only alias direct properties, with no defaults, rest or nested patterns. */
function readAliasNames(name: ts.BindingName): readonly string[] | undefined {
  if (ts.isIdentifier(name)) return [name.text];
  if (!ts.isObjectBindingPattern(name)) return undefined;
  const names: string[] = [];
  for (const element of name.elements) {
    if (
      !ts.isIdentifier(element.name) ||
      element.initializer !== undefined ||
      element.dotDotDotToken !== undefined ||
      (element.propertyName !== undefined && !ts.isIdentifier(element.propertyName))
    )
      return undefined;
    if (names.includes(element.name.text)) return undefined;
    names.push(element.name.text);
  }
  return names;
}

/** A literal Error throw is the sole admitted non-return terminal; arbitrary constructors fail. */
function isInvariantThrow(statement: ts.Statement): boolean {
  if (
    !ts.isThrowStatement(statement) ||
    !(ts.isNewExpression(statement.expression) || ts.isCallExpression(statement.expression))
  )
    return false;
  const expression = statement.expression;
  const argument = expression.arguments?.[0];
  return (
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'Error' &&
    expression.arguments?.length === 1 &&
    argument !== undefined &&
    ts.isStringLiteralLike(argument)
  );
}

/** Exported declarations are the only helper entry points retained in the render graph. */
function hasExportModifier(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    ts
      .getModifiers(statement)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}
