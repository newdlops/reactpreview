/**
 * Recovers authored query-state defaults without executing a router or query provider.
 *
 * Query-state libraries commonly keep their value domain in parser declarations such as
 * `parseAsStringLiteral(...).withDefault(DEFAULTS.theme)`. The parser object is runtime-specific,
 * but its final default argument is ordinary side-effect-free source evidence. This adapter reads
 * only same-module object literals and returns an expression evaluated lazily in that module.
 */
import ts from 'typescript';
import {
  readPreviewRuntimeCalleePropertyName,
  unwrapPreviewRuntimeExpression,
} from './previewRuntimeHookSyntax';

/** Static fallback shape consumed by the general hook instrumentation adapter. */
export interface PreviewRuntimeQueryDefaultsFallback {
  readonly expression: string;
  readonly label: string;
  readonly requiredPaths: readonly string[];
}

/** Reads the existing `use-query-params` codec default or returns its neutral object fallback. */
export function readPreviewRuntimeQueryParamDefaultExpression(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  sourceText: string,
): string {
  const codec = call.arguments[1];
  if (codec !== undefined) {
    const unwrapped = unwrapPreviewRuntimeExpression(codec);
    if (
      ts.isCallExpression(unwrapped) &&
      readPreviewRuntimeCalleePropertyName(unwrapped.expression) === 'withDefault' &&
      unwrapped.arguments[1] !== undefined
    ) {
      const fallback = unwrapped.arguments[1];
      return sourceText.slice(fallback.getStart(sourceFile), fallback.end);
    }
  }
  return 'Object.freeze({})';
}

/**
 * Converts a local Nuqs parser map into the map's authored defaults plus an inert setter tuple.
 *
 * Dynamic parser domains, calls, accessors, spreads, and computed keys fail closed. Imported or
 * local identifier/property reads are admitted because the original module already evaluated the
 * same default expression while constructing its parser map.
 */
export function readPreviewRuntimeQueryStatesDefaults(
  call: ts.CallExpression,
  moduleSpecifier: string,
  hookName: string,
  sourceFile: ts.SourceFile,
  sourceText: string,
): PreviewRuntimeQueryDefaultsFallback | undefined {
  if (moduleSpecifier !== 'nuqs' || hookName !== 'useQueryStates') return undefined;
  const parserMap = resolveLocalParserMap(call.arguments[0], sourceFile);
  if (parserMap === undefined) return undefined;
  const properties: string[] = [];
  const requiredPaths: string[] = [];
  for (const property of parserMap.properties.slice(0, 64)) {
    if (!ts.isPropertyAssignment(property)) return undefined;
    const propertyName = readStaticPropertyName(property.name);
    const defaultValue = findWithDefaultArgument(property.initializer);
    if (
      propertyName === undefined ||
      defaultValue === undefined ||
      !isSideEffectFreeDefaultExpression(defaultValue)
    ) {
      return undefined;
    }
    const expression = sourceText.slice(defaultValue.getStart(sourceFile), defaultValue.end);
    properties.push(`${JSON.stringify(propertyName)}: (${expression})`);
    requiredPaths.push(`0.${propertyName}`);
  }
  if (properties.length === 0) return undefined;
  return {
    expression: `Object.freeze([Object.freeze({ ${properties.join(', ')} }), Object.freeze(() => undefined)])`,
    label: 'authored query-state defaults + no-op setter',
    requiredPaths: [...requiredPaths, '1()'],
  };
}

/** Resolves only a direct object literal or an unshadowed same-module top-level constant. */
function resolveLocalParserMap(
  argument: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
): ts.ObjectLiteralExpression | undefined {
  if (argument === undefined) return undefined;
  const unwrapped = unwrapPreviewRuntimeExpression(argument);
  if (ts.isObjectLiteralExpression(unwrapped)) return unwrapped;
  if (!ts.isIdentifier(unwrapped)) return undefined;
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === unwrapped.text &&
        declaration.initializer !== undefined &&
        !hasCompetingValueBinding(sourceFile, declaration.name.text, declaration)
      ) {
        const initializer = unwrapPreviewRuntimeExpression(declaration.initializer);
        return ts.isObjectLiteralExpression(initializer) ? initializer : undefined;
      }
    }
  }
  return undefined;
}

/**
 * Rejects ambiguous lexical identity instead of guessing through a same-name local declaration.
 *
 * A full TypeScript binder would be disproportionate for this syntax-only pass. Treating a name
 * shadowed anywhere below the module as ambiguous is deliberately conservative: an unrelated local
 * shadow can suppress authored-default recovery, but it can never inject defaults from the wrong
 * parser map into a hook call.
 */
function hasCompetingValueBinding(
  sourceFile: ts.SourceFile,
  bindingName: string,
  expectedDeclaration: ts.VariableDeclaration,
): boolean {
  let competing = false;
  const visit = (node: ts.Node): void => {
    if (competing) return;
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      if (node !== expectedDeclaration && bindingContainsName(node.name, bindingName)) {
        competing = true;
        return;
      }
    } else if (ts.isCatchClause(node) && node.variableDeclaration !== undefined) {
      if (bindingContainsName(node.variableDeclaration.name, bindingName)) {
        competing = true;
        return;
      }
    } else if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isClassDeclaration(node) ||
      ts.isClassExpression(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isModuleDeclaration(node) ||
      ts.isImportEqualsDeclaration(node)
    ) {
      if (node.name !== undefined && ts.isIdentifier(node.name) && node.name.text === bindingName) {
        competing = true;
        return;
      }
    } else if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (
        clause !== undefined &&
        (clause.name?.text === bindingName ||
          (clause.namedBindings !== undefined &&
            (ts.isNamespaceImport(clause.namedBindings)
              ? clause.namedBindings.name.text === bindingName
              : clause.namedBindings.elements.some(
                  (element) => element.name.text === bindingName && !element.isTypeOnly,
                ))))
      ) {
        competing = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return competing;
}

/** Recursively checks identifier, object, and tuple declarations for one local value name. */
function bindingContainsName(binding: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(binding)) return binding.text === name;
  return binding.elements.some(
    (element) => !ts.isOmittedExpression(element) && bindingContainsName(element.name, name),
  );
}

/** Walks fluent parser calls until it finds the value supplied to `.withDefault(value)`. */
function findWithDefaultArgument(expression: ts.Expression): ts.Expression | undefined {
  const current = unwrapPreviewRuntimeExpression(expression);
  if (!ts.isCallExpression(current)) return undefined;
  if (
    readPreviewRuntimeCalleePropertyName(current.expression) === 'withDefault' &&
    current.arguments[0] !== undefined
  ) {
    return current.arguments[0];
  }
  const callee = unwrapPreviewRuntimeExpression(current.expression);
  return ts.isPropertyAccessExpression(callee)
    ? findWithDefaultArgument(callee.expression)
    : undefined;
}

/** Reads a bounded non-computed parser-map key. */
function readStaticPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text.length > 0 && name.text.length <= 128 ? name.text : undefined;
  }
  return undefined;
}

/** Admits data expressions while excluding calls, assignment, allocation, and executable syntax. */
function isSideEffectFreeDefaultExpression(expression: ts.Expression): boolean {
  const current = unwrapPreviewRuntimeExpression(expression);
  if (
    ts.isStringLiteralLike(current) ||
    ts.isNumericLiteral(current) ||
    ts.isIdentifier(current) ||
    current.kind === ts.SyntaxKind.TrueKeyword ||
    current.kind === ts.SyntaxKind.FalseKeyword ||
    current.kind === ts.SyntaxKind.NullKeyword
  ) {
    return true;
  }
  if (ts.isPropertyAccessExpression(current)) {
    return isSideEffectFreeDefaultExpression(current.expression);
  }
  if (ts.isElementAccessExpression(current)) {
    return (
      isSideEffectFreeDefaultExpression(current.expression) &&
      (ts.isStringLiteralLike(current.argumentExpression) ||
        ts.isNumericLiteral(current.argumentExpression))
    );
  }
  if (
    ts.isBinaryExpression(current) &&
    current.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
  ) {
    return (
      isSideEffectFreeDefaultExpression(current.left) &&
      isSideEffectFreeDefaultExpression(current.right)
    );
  }
  if (ts.isPrefixUnaryExpression(current)) {
    return isSideEffectFreeDefaultExpression(current.operand);
  }
  return false;
}
