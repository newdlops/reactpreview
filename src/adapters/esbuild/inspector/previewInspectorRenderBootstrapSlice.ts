/**
 * Recovers render-essential dependency registration from an authored application entry.
 *
 * VirtualPage intentionally avoids evaluating the complete entry because entries commonly start
 * authentication, analytics, backend clients, and route catalogs. Some visual libraries still
 * require a small, synchronous registration call before their React component can render. This
 * module extracts only calls whose receiver and configuration values are statically imported from
 * the same dependency package, such as `Registry.register([Plugin])`.
 *
 * The rule is syntax- and package-identity based. It does not recognize project names, library
 * names, method names, or measured source paths, so the same bounded recovery works across React
 * repositories without turning the extension into a project-specific bootstrap runner.
 */
import path from 'node:path';
import ts from 'typescript';

/** Hard limits keep an unusually large entry from becoming a second application bundle. */
const RENDER_BOOTSTRAP_LIMITS = Object.freeze({
  maximumCalls: 8,
  maximumSourceBytes: 256 * 1024,
});

/** One browser-safe entry slice evaluated before the selected VirtualPage module graph. */
export interface PreviewInspectorRenderBootstrapSlice {
  /** Absolute authored entry whose static statements supplied this slice. */
  readonly sourcePath: string;
  /** Standalone ESM containing minimal imports and accepted registration calls. */
  readonly source: string;
  /** Number of top-level calls retained for diagnostics and regression tests. */
  readonly statementCount: number;
}

/** Static identity of one value imported by the application entry. */
interface ImportedBinding {
  /** Imported member name; `*` represents a namespace binding. */
  readonly importedName: string;
  /** Local identifier referenced by the retained authored statement. */
  readonly localName: string;
  /** Exact bare module request retained for normal project package resolution. */
  readonly moduleSpecifier: string;
  /** Root package identity used to keep a registration inside one dependency family. */
  readonly packageIdentity: string;
}

/** An accepted call plus every import it needs in the generated standalone module. */
interface AcceptedBootstrapCall {
  readonly bindings: readonly ImportedBinding[];
  readonly statement: string;
}

/**
 * Extracts dependency-owned, static top-level registration calls from one application entry.
 *
 * Calls involving local variables, callbacks, JSX, computed code, workspace-relative imports, or
 * values from unrelated packages are rejected. Consequently this slice can restore visual-library
 * initialization without executing the application entry's login, network, or mount sequence.
 *
 * @param sourcePath Absolute entry path used for parser mode and watch provenance.
 * @param sourceText Current editor-or-disk contents of the entry.
 * @returns A standalone bounded ESM slice, or `undefined` when no safe registration was proven.
 */
export function collectPreviewInspectorRenderBootstrapSlice(
  sourcePath: string,
  sourceText: string,
): PreviewInspectorRenderBootstrapSlice | undefined {
  if (
    sourceText.length === 0 ||
    Buffer.byteLength(sourceText, 'utf8') > RENDER_BOOTSTRAP_LIMITS.maximumSourceBytes
  ) {
    return undefined;
  }
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    readScriptKind(sourcePath),
  );
  const bindingsByLocalName = collectImportedBindings(sourceFile);
  if (bindingsByLocalName.size === 0) return undefined;

  const acceptedCalls: AcceptedBootstrapCall[] = [];
  for (const statement of sourceFile.statements) {
    if (acceptedCalls.length >= RENDER_BOOTSTRAP_LIMITS.maximumCalls) break;
    const accepted = collectAcceptedBootstrapCall(statement, sourceFile, bindingsByLocalName);
    if (accepted !== undefined) acceptedCalls.push(accepted);
  }
  if (acceptedCalls.length === 0) return undefined;

  const usedBindings = new Map<string, ImportedBinding>();
  for (const call of acceptedCalls) {
    for (const binding of call.bindings) usedBindings.set(binding.localName, binding);
  }
  const importStatements = [...usedBindings.values()]
    .sort(
      (left, right) =>
        left.moduleSpecifier.localeCompare(right.moduleSpecifier) ||
        left.localName.localeCompare(right.localName),
    )
    .map(createGeneratedImportStatement);
  return Object.freeze({
    source: [
      '/** Render-only dependency bootstrap recovered from the authored application entry. */',
      ...importStatements,
      ...acceptedCalls.map((call) => call.statement),
      'export {};',
      '',
    ].join('\n'),
    sourcePath,
    statementCount: acceptedCalls.length,
  });
}

/** Collects value imports from bare dependency requests while excluding type-only bindings. */
function collectImportedBindings(sourceFile: ts.SourceFile): ReadonlyMap<string, ImportedBinding> {
  const bindings = new Map<string, ImportedBinding>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }
    const moduleSpecifier = statement.moduleSpecifier.text;
    const packageIdentity = readPackageIdentity(moduleSpecifier);
    if (packageIdentity === undefined) continue;
    const importClause = statement.importClause;
    if (importClause === undefined) continue;
    if (importClause.name !== undefined) {
      registerImportedBinding(bindings, {
        importedName: 'default',
        localName: importClause.name.text,
        moduleSpecifier,
        packageIdentity,
      });
    }
    const namedBindings = importClause.namedBindings;
    if (namedBindings === undefined) continue;
    if (ts.isNamespaceImport(namedBindings)) {
      registerImportedBinding(bindings, {
        importedName: '*',
        localName: namedBindings.name.text,
        moduleSpecifier,
        packageIdentity,
      });
      continue;
    }
    for (const element of namedBindings.elements) {
      if (element.isTypeOnly) continue;
      registerImportedBinding(bindings, {
        importedName: (element.propertyName ?? element.name).text,
        localName: element.name.text,
        moduleSpecifier,
        packageIdentity,
      });
    }
  }
  return bindings;
}

/** Stores one immutable import record under the local identifier used by authored code. */
function registerImportedBinding(
  bindings: Map<string, ImportedBinding>,
  binding: ImportedBinding,
): void {
  bindings.set(binding.localName, Object.freeze(binding));
}

/**
 * Accepts only a direct top-level call whose callee and at least one argument are package imports.
 *
 * Requiring an imported argument distinguishes dependency composition from common SDK
 * initialization such as `analytics.init({ key })`, while still covering plugin/module registries.
 */
function collectAcceptedBootstrapCall(
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
  bindingsByLocalName: ReadonlyMap<string, ImportedBinding>,
): AcceptedBootstrapCall | undefined {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) {
    return undefined;
  }
  const call = statement.expression;
  if (call.questionDotToken !== undefined || call.arguments.some(ts.isSpreadElement)) {
    return undefined;
  }
  const calleeBinding = readImportedCalleeBinding(call.expression, bindingsByLocalName);
  if (calleeBinding === undefined) return undefined;

  const argumentBindings = new Map<string, ImportedBinding>();
  for (const argument of call.arguments) {
    if (!collectSafeExpressionBindings(argument, bindingsByLocalName, argumentBindings)) {
      return undefined;
    }
  }
  if (argumentBindings.size === 0) return undefined;
  if (
    [...argumentBindings.values()].some(
      (binding) => binding.packageIdentity !== calleeBinding.packageIdentity,
    )
  ) {
    return undefined;
  }
  return Object.freeze({
    bindings: Object.freeze([
      calleeBinding,
      ...[...argumentBindings.values()].filter(
        (binding) => binding.localName !== calleeBinding.localName,
      ),
    ]),
    statement: statement.getText(sourceFile),
  });
}

/** Resolves an imported function or imported-object method used as the direct call receiver. */
function readImportedCalleeBinding(
  expression: ts.LeftHandSideExpression,
  bindingsByLocalName: ReadonlyMap<string, ImportedBinding>,
): ImportedBinding | undefined {
  let current: ts.Expression = unwrapTransparentExpression(expression);
  while (ts.isPropertyAccessExpression(current) && current.questionDotToken === undefined) {
    current = unwrapTransparentExpression(current.expression);
  }
  return ts.isIdentifier(current) ? bindingsByLocalName.get(current.text) : undefined;
}

/**
 * Verifies that an argument is a data-only expression and records every imported value it reads.
 *
 * The accepted grammar deliberately omits calls, `new`, functions, JSX, assignments, spreads, and
 * local identifiers. Those forms can execute application behavior or depend on omitted state.
 */
function collectSafeExpressionBindings(
  expression: ts.Expression,
  bindingsByLocalName: ReadonlyMap<string, ImportedBinding>,
  usedBindings: Map<string, ImportedBinding>,
): boolean {
  const current = unwrapTransparentExpression(expression);
  if (ts.isIdentifier(current)) {
    if (current.text === 'undefined' || current.text === 'NaN' || current.text === 'Infinity') {
      return true;
    }
    const binding = bindingsByLocalName.get(current.text);
    if (binding === undefined) return false;
    usedBindings.set(binding.localName, binding);
    return true;
  }
  if (isStaticLiteral(current)) return true;
  if (ts.isPropertyAccessExpression(current) && current.questionDotToken === undefined) {
    return collectSafeExpressionBindings(current.expression, bindingsByLocalName, usedBindings);
  }
  if (ts.isArrayLiteralExpression(current)) {
    return current.elements.every(
      (element) =>
        ts.isOmittedExpression(element) ||
        (!ts.isSpreadElement(element) &&
          collectSafeExpressionBindings(element, bindingsByLocalName, usedBindings)),
    );
  }
  if (ts.isObjectLiteralExpression(current)) {
    return current.properties.every((property) =>
      collectSafeObjectPropertyBindings(property, bindingsByLocalName, usedBindings),
    );
  }
  if (ts.isPrefixUnaryExpression(current)) {
    return (
      current.operator !== ts.SyntaxKind.PlusPlusToken &&
      current.operator !== ts.SyntaxKind.MinusMinusToken &&
      collectSafeExpressionBindings(current.operand, bindingsByLocalName, usedBindings)
    );
  }
  if (ts.isVoidExpression(current)) {
    return collectSafeExpressionBindings(current.expression, bindingsByLocalName, usedBindings);
  }
  return false;
}

/** Validates one object-literal field without allowing accessors, methods, or computed behavior. */
function collectSafeObjectPropertyBindings(
  property: ts.ObjectLiteralElementLike,
  bindingsByLocalName: ReadonlyMap<string, ImportedBinding>,
  usedBindings: Map<string, ImportedBinding>,
): boolean {
  if (ts.isPropertyAssignment(property)) {
    return (
      isStaticPropertyName(property.name) &&
      collectSafeExpressionBindings(property.initializer, bindingsByLocalName, usedBindings)
    );
  }
  if (ts.isShorthandPropertyAssignment(property)) {
    return collectSafeExpressionBindings(property.name, bindingsByLocalName, usedBindings);
  }
  return false;
}

/** Recognizes property names that cannot run code while the generated object is created. */
function isStaticPropertyName(name: ts.PropertyName): boolean {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name);
}

/** Recognizes literal leaves accepted inside a registration argument. */
function isStaticLiteral(expression: ts.Expression): boolean {
  return (
    ts.isStringLiteralLike(expression) ||
    ts.isNumericLiteral(expression) ||
    ts.isBigIntLiteral(expression) ||
    ts.isRegularExpressionLiteral(expression) ||
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    expression.kind === ts.SyntaxKind.NullKeyword
  );
}

/** Removes syntax-only wrappers while retaining the underlying runtime expression. */
function unwrapTransparentExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * Reads a dependency package identity from a bare request.
 *
 * Subpaths share the same identity (`library` and `library/plugin`), while scoped packages retain
 * both scope and package name. Relative, absolute, URL, private-import, and Node builtin requests
 * are excluded because they are not portable dependency registrations.
 */
function readPackageIdentity(moduleSpecifier: string): string | undefined {
  if (
    moduleSpecifier.length === 0 ||
    moduleSpecifier.startsWith('.') ||
    moduleSpecifier.startsWith('/') ||
    moduleSpecifier.startsWith('#') ||
    moduleSpecifier.includes(':')
  ) {
    return undefined;
  }
  const segments = moduleSpecifier.split('/').filter(Boolean);
  const firstSegment = segments[0];
  if (firstSegment === undefined) return undefined;
  if (moduleSpecifier.startsWith('@')) {
    const packageName = segments[1];
    return packageName === undefined ? undefined : `${firstSegment}/${packageName}`;
  }
  return firstSegment;
}

/** Emits one minimal ESM import without carrying unrelated application-entry bindings. */
function createGeneratedImportStatement(binding: ImportedBinding): string {
  if (binding.importedName === '*') {
    return `import * as ${binding.localName} from ${JSON.stringify(binding.moduleSpecifier)};`;
  }
  const importedName = /^[A-Za-z_$][\w$]*$/u.test(binding.importedName)
    ? binding.importedName
    : JSON.stringify(binding.importedName);
  return `import { ${importedName} as ${binding.localName} } from ${JSON.stringify(
    binding.moduleSpecifier,
  )};`;
}

/** Selects the parser mode needed to understand JSX without transforming authored source. */
function readScriptKind(sourcePath: string): ts.ScriptKind {
  switch (path.extname(sourcePath).toLowerCase()) {
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.jsx':
      return ts.ScriptKind.JSX;
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}
