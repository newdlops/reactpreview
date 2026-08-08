/**
 * Creates the compiler-owned prepared-source contract consumed by the selected-target facade.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import { PreviewCompilationError } from '../../../domain/preview';
import { canonicalizeExistingPath } from '../../../shared/pathIdentity';
import { collectPreviewTargetModuleExportEvidence } from '../previewTargetExports';

/** Stable policy identity for prepared export proof through committed exact Fiber ownership. */
export const PREVIEW_TARGET_FACADE_OWNERSHIP_POLICY_VERSION = 1;
export const PREVIEW_TARGET_FACADE_OWNERSHIP_POLICY_DIGEST = createHash('sha256')
  .update(
    JSON.stringify({
      boundaryIdentity: 'normalized-source-path-and-export',
      compilerEvidence: 'prepared-source-explicit-runtime-exports',
      facadeBindings: 'static-private-original-edge',
      mountedOwnership: 'live-committed-boundary-fiber-only',
      policyVersion: PREVIEW_TARGET_FACADE_OWNERSHIP_POLICY_VERSION,
      preFiberPhasesAreDiagnosticOnly: true,
    }),
  )
  .digest('hex');

/** Exact source and export evidence shared by compiler, PageExecution, and facade generation. */
export interface PreviewInspectorTargetModuleContract {
  /** Every syntax-proven runtime export in the prepared target source. */
  readonly explicitExportNames: readonly string[];
  /** Whether the prepared target source explicitly provides a default binding. */
  readonly hasDefaultExport: boolean;
  /** Whether unresolved bare wildcard re-exports remain present. */
  readonly hasWildcardExport: boolean;
  /** Non-secret identity of the exact prepared source used to derive this contract. */
  readonly preparedSourceDigest: string;
  /** Exact selected facade bindings, each proven in `explicitExportNames`. */
  readonly selectedExportNames: readonly string[];
  /** Selected exports statically proven to forward ordinary `children` through hostless output. */
  readonly transparentOrdinaryChildrenOutputExportNames: readonly string[];
  /** Canonical absolute runtime ownership source path. */
  readonly sourcePath: string;
}

export interface CreatePreviewInspectorTargetModuleContractOptions {
  readonly preparedSourceText: string;
  readonly selectedExportNames: readonly string[];
  readonly sourcePath: string;
}

/**
 * Proves all selected bindings from the prepared module itself and fails closed on ambiguity.
 *
 * A bare `export *` is deliberately not enough to prove a selected binding because that would
 * require resolving a second module graph outside this contract. Explicit aliased re-exports are
 * proven by their public names and remain supported.
 */
export function createPreviewInspectorTargetModuleContract(
  options: CreatePreviewInspectorTargetModuleContractOptions,
): PreviewInspectorTargetModuleContract {
  if (!path.isAbsolute(options.sourcePath)) {
    throw new RangeError('Preview inspector target path must be absolute.');
  }
  const sourcePath = canonicalizeExistingPath(path.normalize(options.sourcePath));
  const selectedExportNames = Object.freeze([...new Set(options.selectedExportNames)]);
  if (selectedExportNames.length === 0) {
    throw new TypeError('Preview inspector requires at least one selected target export.');
  }
  const evidence = collectPreviewTargetModuleExportEvidence(sourcePath, options.preparedSourceText);
  const explicitExports = new Set(evidence.explicitExportNames);
  const missingExport = selectedExportNames.find((exportName) => !explicitExports.has(exportName));
  if (missingExport !== undefined) {
    throw new PreviewCompilationError(
      `React Preview could not prove the selected export "${missingExport}" in the prepared target module.`,
      [
        {
          location: { column: 0, file: sourcePath, line: 1 },
          message: `The exact prepared target module does not explicitly export "${missingExport}".`,
          severity: 'error',
        },
      ],
    );
  }
  return Object.freeze({
    explicitExportNames: evidence.explicitExportNames,
    hasDefaultExport: explicitExports.has('default'),
    hasWildcardExport: evidence.hasWildcardExport,
    preparedSourceDigest: createHash('sha256').update(options.preparedSourceText).digest('hex'),
    selectedExportNames,
    sourcePath,
    transparentOrdinaryChildrenOutputExportNames: Object.freeze(
      selectedExportNames.filter((exportName) =>
        hasTransparentOrdinaryChildrenOutput(sourcePath, options.preparedSourceText, exportName),
      ),
    ),
  });
}

/**
 * Proves only direct function exports whose non-empty render returns preserve their ordinary
 * `children` binding inside hostless JSX composition. The proof deliberately does not follow
 * calls, aliases beyond a local export clause, render callbacks, or intrinsic elements.
 */
function hasTransparentOrdinaryChildrenOutput(
  sourcePath: string,
  sourceText: string,
  exportName: string,
): boolean {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(sourcePath),
  );
  if (
    (sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics?.length !== 0
  ) {
    return false;
  }
  const declaration = findDirectExportFunction(sourceFile, exportName);
  const parameter = declaration?.parameters[0];
  if (declaration === undefined || parameter === undefined) return false;
  const childrenName = readOrdinaryChildrenBinding(parameter);
  if (childrenName === undefined || declaration.body === undefined) return false;
  const returns: ts.ReturnStatement[] = [];
  collectOwnReturns(declaration.body, returns);
  return (
    returns.length !== 0 &&
    returns.some((statement) => isNonEmptyReturn(statement.expression)) &&
    returns.every((statement) =>
      isEmptyInitializationReturn(statement.expression) ||
      forwardsChildrenThroughHostlessComposition(statement.expression, childrenName),
    )
  );
}

function findDirectExportFunction(
  sourceFile: ts.SourceFile,
  exportName: string,
): ts.FunctionLikeDeclaration | undefined {
  const localName = exportName === 'default' ? 'default' : exportName;
  let resolvedName = localName;
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier !== undefined) continue;
    const exportClause = statement.exportClause;
    if (exportClause === undefined || !ts.isNamedExports(exportClause)) continue;
    const exportSpecifier = exportClause.elements.find(
      (element) => !element.isTypeOnly && element.name.text === exportName,
    );
    if (exportSpecifier !== undefined) {
      resolvedName = (exportSpecifier.propertyName ?? exportSpecifier.name).text;
      break;
    }
  }
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.body !== undefined &&
      ((exportName === 'default' && hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) ||
        statement.name?.text === resolvedName)
    ) {
      return statement;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== resolvedName) continue;
      const initializer = declaration.initializer;
      if (initializer !== undefined &&
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
        return initializer;
      }
    }
  }
  return undefined;
}

function readOrdinaryChildrenBinding(parameter: ts.ParameterDeclaration): string | undefined {
  if (parameter.dotDotDotToken !== undefined || !ts.isObjectBindingPattern(parameter.name)) {
    return undefined;
  }
  const children = parameter.name.elements.filter(
    (element) =>
      element.dotDotDotToken === undefined &&
      element.propertyName === undefined &&
      ts.isIdentifier(element.name) &&
      element.name.text === 'children' &&
      element.initializer === undefined,
  );
  return children.length === 1 ? 'children' : undefined;
}

function collectOwnReturns(node: ts.Node, returns: ts.ReturnStatement[]): void {
  if (ts.isFunctionLike(node)) return;
  if (ts.isReturnStatement(node)) returns.push(node);
  ts.forEachChild(node, (child) => collectOwnReturns(child, returns));
}

function isEmptyInitializationReturn(expression: ts.Expression | undefined): boolean {
  const value = unwrap(expression);
  return value === undefined || value.kind === ts.SyntaxKind.NullKeyword || value.kind === ts.SyntaxKind.FalseKeyword;
}

function isNonEmptyReturn(expression: ts.Expression | undefined): boolean {
  return !isEmptyInitializationReturn(expression);
}

function forwardsChildrenThroughHostlessComposition(
  expression: ts.Expression | undefined,
  childrenName: string,
): boolean {
  const value = unwrap(expression);
  if (value === undefined) return false;
  if (ts.isJsxElement(value)) {
    return isHostlessJsxTag(value.openingElement.tagName) && jsxChildrenForwardOnly(value.children, childrenName);
  }
  if (ts.isJsxFragment(value)) return jsxChildrenForwardOnly(value.children, childrenName);
  return false;
}

function jsxChildrenForwardOnly(children: ts.NodeArray<ts.JsxChild>, childrenName: string): boolean {
  const meaningful = children.filter((child) => !ts.isJsxText(child) || child.getText().trim().length !== 0);
  const child = meaningful[0];
  return meaningful.length === 1 && child !== undefined &&
    isDirectChildrenExpression(child, childrenName);
}

function isDirectChildrenExpression(child: ts.JsxChild, childrenName: string): boolean {
  if (ts.isJsxExpression(child)) {
    const expression = unwrap(child.expression);
    return expression !== undefined && ts.isIdentifier(expression) && expression.text === childrenName;
  }
  return ts.isJsxElement(child)
    ? isHostlessJsxTag(child.openingElement.tagName) && jsxChildrenForwardOnly(child.children, childrenName)
    : ts.isJsxFragment(child)
      ? jsxChildrenForwardOnly(child.children, childrenName)
      : false;
}

function isHostlessJsxTag(tagName: ts.JsxTagNameExpression): boolean {
  return !ts.isIdentifier(tagName) || !/^[a-z]/u.test(tagName.text);
}

function unwrap(expression: ts.Expression | undefined): ts.Expression | undefined {
  let value = expression;
  while (
    value !== undefined &&
    (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isTypeAssertionExpression(value) || ts.isSatisfiesExpression(value))
  ) {
    value = value.expression;
  }
  return value;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) === true;
}

function scriptKindForPath(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  return extension === '.tsx' ? ts.ScriptKind.TSX : extension === '.ts' ? ts.ScriptKind.TS : ts.ScriptKind.JSX;
}
