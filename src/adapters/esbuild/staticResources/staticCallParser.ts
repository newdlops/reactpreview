/**
 * Builds a non-evaluating TypeScript AST index for resource-related JavaScript calls.
 * A real TSX-aware parser is intentionally used here: text scanning can mistake JSX, regular
 * expressions, nested templates, or escaped identifiers and let esbuild perform an unbounded native
 * dynamic-import expansion before a plugin has a chance to enforce workspace boundaries.
 */
import ts from 'typescript';

/** Exact call shapes understood by the preview compatibility transformer. */
export type StaticCallName =
  | 'import'
  | 'import.meta.glob'
  | 'import.meta.globEager'
  | 'new URL'
  | 'require'
  | 'require.context';

/** Source range and raw, AST-delimited arguments for one recognized call expression. */
export interface StaticCallExpression {
  /** Argument expressions without commas, comments, or the surrounding parentheses. */
  readonly arguments: readonly string[];
  /** Exclusive end offset after the call's closing parenthesis. */
  readonly end: number;
  /** Inclusive source offset at the beginning of the callee or `new` keyword. */
  readonly start: number;
}

/** Error raised when syntactically invalid source cannot be indexed safely. */
export class StaticSourceParseError extends Error {
  /** Creates an actionable fail-closed source parsing diagnostic. */
  public constructor(message: string) {
    super(message);
    this.name = 'StaticSourceParseError';
  }
}

/**
 * Parses one source module once and exposes calls and decoded identifiers to later transforms.
 * TypeScript's parser understands TSX text, nested template-expression states, regex literals, and
 * Unicode escapes. That makes this index both more compatible and safer than callee text searches.
 */
export class StaticSourceAnalysis {
  private readonly calls = new Map<StaticCallName, StaticCallExpression[]>();
  private readonly identifiers = new Set<string>();
  private readonly sourceFile: ts.SourceFile;

  /**
   * Creates a syntax index without resolving imports, reading configuration, or executing source.
   *
   * @param sourcePath Absolute path used to select the correct TS, TSX, JS, or JSX grammar.
   * @param sourceText Current editor or filesystem contents to analyze.
   * @throws StaticSourceParseError when the module has a syntax error and cannot be classified safely.
   */
  public constructor(
    private readonly sourcePath: string,
    private readonly sourceText: string,
  ) {
    for (const name of STATIC_CALL_NAMES) {
      this.calls.set(name, []);
    }

    this.sourceFile = ts.createSourceFile(
      sourcePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      getScriptKind(sourcePath),
    );
    this.assertSyntacticallyValid();
    this.visit(this.sourceFile);
    for (const calls of this.calls.values()) {
      calls.sort((left, right) => left.start - right.start);
    }
  }

  /** Returns ordered calls matching one exact supported syntax shape. */
  public findCalls(name: StaticCallName): readonly StaticCallExpression[] {
    return this.calls.get(name) ?? [];
  }

  /** Reports whether a decoded source identifier would collide with generated module bindings. */
  public hasIdentifier(name: string): boolean {
    return this.identifiers.has(name);
  }

  /** Traverses child nodes once, recording decoded identifiers and recognized call expressions. */
  private visit(node: ts.Node): void {
    if (ts.isIdentifier(node)) {
      this.identifiers.add(node.text);
    }

    if (ts.isCallExpression(node)) {
      const name = classifyCallExpression(node);
      if (name !== undefined) {
        this.record(name, node.expression.getStart(this.sourceFile), node.end, node.arguments);
      }
    } else if (ts.isNewExpression(node) && isIdentifierNamed(node.expression, 'URL')) {
      this.record('new URL', node.getStart(this.sourceFile), node.end, node.arguments ?? []);
    }

    ts.forEachChild(node, (child) => {
      this.visit(child);
    });
  }

  /** Stores one call using parser-owned argument boundaries so regex commas remain intact. */
  private record(
    name: StaticCallName,
    start: number,
    end: number,
    arguments_: readonly ts.Expression[],
  ): void {
    this.calls.get(name)?.push({
      arguments: arguments_.map((argument) =>
        this.sourceText.slice(argument.getStart(this.sourceFile), argument.end),
      ),
      end,
      start,
    });
  }

  /** Rejects parser recovery because a missed call could otherwise reach esbuild's native globbing. */
  private assertSyntacticallyValid(): void {
    const diagnostics = (
      this.sourceFile as ts.SourceFile & {
        readonly parseDiagnostics?: readonly ts.DiagnosticWithLocation[];
      }
    ).parseDiagnostics;
    const diagnostic = diagnostics?.[0];
    if (diagnostic === undefined) {
      return;
    }

    const position = this.sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    throw new StaticSourceParseError(
      `${this.sourcePath}:${(position.line + 1).toString()}:${(position.character + 1).toString()}: ${message}`,
    );
  }
}

const STATIC_CALL_NAMES: readonly StaticCallName[] = [
  'import',
  'import.meta.glob',
  'import.meta.globEager',
  'new URL',
  'require',
  'require.context',
];

/** Parses a quoted or interpolation-free template literal without evaluating JavaScript. */
export function parseStaticString(source: string): string | undefined {
  const expression = parseStandaloneExpression(source);
  return expression === undefined ? undefined : readStaticString(expression);
}

/** Parses either one string literal or an array containing only string literal elements. */
export function parseStaticStringList(source: string): readonly string[] | undefined {
  const expression = parseStandaloneExpression(source);
  if (expression === undefined) {
    return undefined;
  }

  const singleValue = readStaticString(expression);
  if (singleValue !== undefined) {
    return [singleValue];
  }
  if (!ts.isArrayLiteralExpression(expression)) {
    return undefined;
  }

  const values: string[] = [];
  for (const element of expression.elements) {
    if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) {
      return undefined;
    }
    const value = readStaticString(element);
    if (value === undefined) {
      return undefined;
    }
    values.push(value);
  }
  return values;
}

/**
 * Parses a template or `+` concatenation into decoded static text around runtime expressions.
 * For `` `./pages/${name}.tsx` `` the result is `['./pages/', '.tsx']`; adjacent runtime
 * expressions produce an empty middle segment. Expression text is deliberately omitted because the
 * original argument is evaluated exactly once by the generated runtime lookup.
 */
export function parseDynamicPathSegments(source: string): readonly string[] | undefined {
  const expression = parseStandaloneExpression(source);
  if (expression === undefined) {
    return undefined;
  }

  const pieces: DynamicPathPiece[] = [];
  collectDynamicPathPieces(expression, pieces);
  if (!pieces.some((piece) => piece === undefined)) {
    return undefined;
  }

  const segments: string[] = [''];
  for (const piece of pieces) {
    if (piece === undefined) {
      segments.push('');
    } else {
      const lastIndex = segments.length - 1;
      segments[lastIndex] = `${segments[lastIndex] ?? ''}${piece}`;
    }
  }
  return segments;
}

/** A decoded static path fragment, or `undefined` for one runtime expression. */
type DynamicPathPiece = string | undefined;

/** Recursively flattens only string concatenation and template syntax into path pieces. */
function collectDynamicPathPieces(expression: ts.Expression, pieces: DynamicPathPiece[]): void {
  const unwrapped = unwrapParentheses(expression);
  const literal = readStaticString(unwrapped);
  if (literal !== undefined) {
    pieces.push(literal);
    return;
  }
  if (ts.isTemplateExpression(unwrapped)) {
    pieces.push(unwrapped.head.text);
    for (const span of unwrapped.templateSpans) {
      pieces.push(undefined, span.literal.text);
    }
    return;
  }
  if (
    ts.isBinaryExpression(unwrapped) &&
    unwrapped.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    collectDynamicPathPieces(unwrapped.left, pieces);
    collectDynamicPathPieces(unwrapped.right, pieces);
    return;
  }
  pieces.push(undefined);
}

/**
 * Parses a simple object literal into raw property values without getters, methods, or spreads.
 * Values remain source text and are subsequently accepted only by option-specific literal checks.
 */
export function parseStaticObject(
  source: string | undefined,
): ReadonlyMap<string, string> | undefined {
  if (source === undefined) {
    return new Map();
  }

  const parsed = parseStandaloneExpressionWithFile(source);
  if (parsed === undefined || !ts.isObjectLiteralExpression(parsed.expression)) {
    return undefined;
  }

  const properties = new Map<string, string>();
  for (const property of parsed.expression.properties) {
    if (!ts.isPropertyAssignment(property)) {
      return undefined;
    }
    const key = readPropertyName(property.name);
    if (key === undefined) {
      return undefined;
    }
    properties.set(key, property.initializer.getText(parsed.sourceFile));
  }
  return properties;
}

/** Reports whether an isolated expression is the exact `import.meta.url` property access. */
export function isStaticImportMetaUrl(source: string): boolean {
  const expression = parseStandaloneExpression(source);
  return (
    expression !== undefined &&
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === 'url' &&
    isImportMetaExpression(expression.expression)
  );
}

/** Classifies one AST call without treating lookalike property chains as preview macros. */
function classifyCallExpression(node: ts.CallExpression): StaticCallName | undefined {
  const expression = unwrapCallee(node.expression);
  if (expression.kind === ts.SyntaxKind.ImportKeyword) {
    return 'import';
  }
  if (isNativeRequireCallee(expression)) {
    return 'require';
  }
  if (!ts.isPropertyAccessExpression(expression)) {
    return undefined;
  }
  if (isIdentifierNamed(expression.expression, 'require') && expression.name.text === 'context') {
    return 'require.context';
  }
  if (!isImportMetaExpression(expression.expression)) {
    return undefined;
  }
  return expression.name.text === 'glob'
    ? 'import.meta.glob'
    : expression.name.text === 'globEager'
      ? 'import.meta.globEager'
      : undefined;
}

/**
 * Recognizes the direct and `module.require` shapes that esbuild constant-folds into native globs.
 * Shadowed identifiers are intentionally still classified: rejecting a rare false positive is safer
 * than allowing an unbounded filesystem expansion that bypasses plugin resolution hooks.
 */
function isNativeRequireCallee(expression: ts.Expression): boolean {
  if (isIdentifierNamed(expression, 'require')) {
    return true;
  }
  if (
    ts.isPropertyAccessExpression(expression) &&
    isIdentifierNamed(unwrapCallee(expression.expression), 'module') &&
    expression.name.text === 'require'
  ) {
    return true;
  }
  return (
    ts.isElementAccessExpression(expression) &&
    isIdentifierNamed(unwrapCallee(expression.expression), 'module') &&
    readStaticStringConcatenation(expression.argumentExpression) === 'require'
  );
}

/** Evaluates only `+`-joined string literals used by esbuild for computed `module.require` access. */
function readStaticStringConcatenation(expression: ts.Expression): string | undefined {
  const unwrapped = unwrapCallee(expression);
  const literal = readStaticString(unwrapped);
  if (literal !== undefined) {
    return literal;
  }
  if (
    !ts.isBinaryExpression(unwrapped) ||
    unwrapped.operatorToken.kind !== ts.SyntaxKind.PlusToken
  ) {
    return undefined;
  }
  const left = readStaticStringConcatenation(unwrapped.left);
  const right = readStaticStringConcatenation(unwrapped.right);
  return left === undefined || right === undefined ? undefined : `${left}${right}`;
}

/** Removes syntax wrappers that do not change the runtime callee identity. */
function unwrapCallee(expression: ts.Expression): ts.Expression {
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

/** Reports whether a property receiver is the exact `import.meta` meta-property. */
function isImportMetaExpression(node: ts.Expression): boolean {
  return (
    ts.isMetaProperty(node) &&
    node.keywordToken === ts.SyntaxKind.ImportKeyword &&
    node.name.text === 'meta'
  );
}

/** Reports whether an expression is an identifier with the decoded requested spelling. */
function isIdentifierNamed(node: ts.Expression, name: string): boolean {
  return ts.isIdentifier(node) && node.text === name;
}

/** Reads the only property-name forms accepted by the non-evaluating option parser. */
function readPropertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

/** Reads a string or interpolation-free template AST node as its decoded literal value. */
function readStaticString(expression: ts.Expression): string | undefined {
  const unwrapped = unwrapParentheses(expression);
  return ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)
    ? unwrapped.text
    : undefined;
}

/** Removes harmless parentheses while preserving every executable expression kind. */
function unwrapParentheses(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

/** Parses one isolated expression and requires full source consumption after normal trivia. */
function parseStandaloneExpression(source: string): ts.Expression | undefined {
  return parseStandaloneExpressionWithFile(source)?.expression;
}

/** Parses an isolated expression and retains its source file for exact initializer text access. */
function parseStandaloneExpressionWithFile(
  source: string,
): { readonly expression: ts.Expression; readonly sourceFile: ts.SourceFile } | undefined {
  const prefix = 'const __reactPreviewStaticValue = ';
  const sourceFile = ts.createSourceFile(
    'react-preview-static-expression.ts',
    `${prefix}${source};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const diagnostics = (
    sourceFile as ts.SourceFile & {
      readonly parseDiagnostics?: readonly ts.DiagnosticWithLocation[];
    }
  ).parseDiagnostics;
  if ((diagnostics?.length ?? 0) > 0 || sourceFile.statements.length !== 1) {
    return undefined;
  }

  const statement = sourceFile.statements[0];
  const declaration =
    statement !== undefined && ts.isVariableStatement(statement)
      ? statement.declarationList.declarations[0]
      : undefined;
  if (declaration?.initializer === undefined || declaration.end !== prefix.length + source.length) {
    return undefined;
  }
  return { expression: declaration.initializer, sourceFile };
}

/** Selects TypeScript's language variant from the module extension. */
function getScriptKind(sourcePath: string): ts.ScriptKind {
  const lowerPath = sourcePath.toLowerCase();
  if (lowerPath.endsWith('.tsx')) {
    return ts.ScriptKind.TSX;
  }
  if (lowerPath.endsWith('.jsx')) {
    return ts.ScriptKind.JSX;
  }
  if (lowerPath.endsWith('.js') || lowerPath.endsWith('.cjs') || lowerPath.endsWith('.mjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}
