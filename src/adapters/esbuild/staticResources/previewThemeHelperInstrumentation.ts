/**
 * Instruments callable styled-components theme tokens without assuming project-specific names.
 * A preview can discover the correct root theme and still encounter an incomplete nested provider;
 * wrapping only statically proven theme-helper callees lets the browser recover that one CSS value
 * while preserving the project's arguments, provider hierarchy, and every non-style expression.
 */
import ts from 'typescript';
import type { PreviewSourceReplacement } from './previewSourceReplacement';

const STYLED_COMPONENTS_SPECIFIER = 'styled-components';
const PREVIEW_THEME_SPECIFIER = 'react-preview:theme';
const MAX_THEME_HELPERS_PER_SOURCE = 128;

/** Callback supplied by the source transformer to avoid generated identifier collisions. */
export type PreviewThemeHelperBindingAllocator = (kind: string) => string;

/** Generated import and source edits for one workspace-owned styled-components module. */
export interface PreviewThemeHelperTransform {
  /** Import for the browser helper resolver, omitted when no callable token was proven. */
  readonly imports: readonly string[];
  /** Calee-only edits, leaving arguments available to independent source transforms. */
  readonly replacements: readonly PreviewSourceReplacement[];
}

/** Static import bindings that can own a styled-components tagged template. */
interface StyledTemplateBindings {
  /** Default and named runtime imports such as `styled`, `css`, and `createGlobalStyle`. */
  readonly direct: ReadonlySet<string>;
  /** Namespace imports used as `Styled.css` or another tagged member. */
  readonly namespaces: ReadonlySet<string>;
}

/** A callable property path rooted at a `.theme` member inside a styled template. */
interface ThemeHelperCall {
  /** Original callee expression replaced by the generated resolver expression. */
  readonly callee: ts.PropertyAccessExpression | ts.ElementAccessExpression;
  /** Original `.theme` expression evaluated once before safe path traversal in the runtime. */
  readonly themeExpression: ts.PropertyAccessExpression | ts.ElementAccessExpression;
  /** Theme-relative property path used to consult the exact discovered root theme. */
  readonly themePath: readonly string[];
}

/**
 * Finds direct theme-helper calls inside styled-components tagged templates and guards the callee.
 * Calls elsewhere in business logic, computed properties, optional chains, and parser-recovered
 * editor text remain untouched. Replacing only the callee also avoids conflict with a transform in
 * one of the call's argument expressions.
 *
 * @param sourcePath Source identity used to select the matching TypeScript grammar.
 * @param sourceText Unmodified workspace source loaded by the preview compiler.
 * @param allocateBinding Collision-safe binding allocator owned by the source transformer.
 * @returns One optional import plus bounded, non-overlapping callee replacements.
 */
export function createPreviewThemeHelperTransform(
  sourcePath: string,
  sourceText: string,
  allocateBinding: PreviewThemeHelperBindingAllocator,
): PreviewThemeHelperTransform {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    selectScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) {
    return { imports: [], replacements: [] };
  }
  const bindings = collectStyledTemplateBindings(sourceFile);
  if (bindings.direct.size === 0 && bindings.namespaces.size === 0) {
    return { imports: [], replacements: [] };
  }
  const calls = collectThemeHelperCalls(sourceFile, bindings);
  if (calls.length === 0 || calls.length > MAX_THEME_HELPERS_PER_SOURCE) {
    return { imports: [], replacements: [] };
  }

  const resolverBinding = allocateBinding('themeHelper');
  const replacements = calls.map((call) => ({
    end: call.callee.end,
    replacement: createResolverExpression(call, resolverBinding, sourceFile, sourceText),
    start: call.callee.getStart(sourceFile),
  }));
  return {
    imports: [
      `import { resolvePreviewThemeHelper as ${resolverBinding} } from ${JSON.stringify(PREVIEW_THEME_SPECIFIER)};`,
    ],
    replacements,
  };
}

/** Collects non-erased bindings imported from the styled-components runtime package. */
function collectStyledTemplateBindings(sourceFile: ts.SourceFile): StyledTemplateBindings {
  const direct = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== STYLED_COMPONENTS_SPECIFIER
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause === undefined || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
    if (clause.name !== undefined) direct.add(clause.name.text);
    const namedBindings = clause.namedBindings;
    if (namedBindings !== undefined && ts.isNamespaceImport(namedBindings)) {
      namespaces.add(namedBindings.name.text);
      continue;
    }
    for (const element of namedBindings?.elements ?? []) {
      if (!element.isTypeOnly) direct.add(element.name.text);
    }
  }
  return { direct, namespaces };
}

/** Visits call expressions once and retains only callees proven to be inside a styled template. */
function collectThemeHelperCalls(
  sourceFile: ts.SourceFile,
  bindings: StyledTemplateBindings,
): readonly ThemeHelperCall[] {
  const calls: ThemeHelperCall[] = [];
  const visit = (node: ts.Node): void => {
    if (
      calls.length <= MAX_THEME_HELPERS_PER_SOURCE &&
      ts.isCallExpression(node) &&
      node.questionDotToken === undefined &&
      (ts.isPropertyAccessExpression(node.expression) ||
        ts.isElementAccessExpression(node.expression)) &&
      !hasOptionalChain(node.expression) &&
      isInsideStyledTemplate(node, bindings)
    ) {
      const helper = readThemeHelperCall(node.expression);
      if (helper !== undefined) calls.push(helper);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

/** Reads one static receiver property and its path following the nearest `.theme` segment. */
function readThemeHelperCall(
  callee: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): ThemeHelperCall | undefined {
  const propertyName = readStaticPropertyName(callee);
  if (propertyName === undefined) return undefined;
  const segments: string[] = [propertyName];
  let current: ts.Expression = unwrapExpression(callee.expression);
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    const name = readStaticPropertyName(current);
    if (name === undefined) return undefined;
    if (name === 'theme') {
      return segments.length === 0
        ? undefined
        : { callee, themeExpression: current, themePath: [...segments].reverse() };
    }
    segments.push(name);
    current = unwrapExpression(current.expression);
  }
  return undefined;
}

/** Creates a resolver call that evaluates the original helper receiver exactly once. */
function createResolverExpression(
  call: ThemeHelperCall,
  resolverBinding: string,
  sourceFile: ts.SourceFile,
  sourceText: string,
): string {
  const themeExpression = sourceText.slice(
    call.themeExpression.getStart(sourceFile),
    call.themeExpression.end,
  );
  return `${resolverBinding}((${themeExpression}), ${JSON.stringify(call.themePath)})`;
}

/** Reports whether a node is nested in a tagged template owned by an imported styled binding. */
function isInsideStyledTemplate(node: ts.Node, bindings: StyledTemplateBindings): boolean {
  let current = node.parent;
  while (!ts.isSourceFile(current)) {
    if (ts.isTaggedTemplateExpression(current)) {
      return isStyledTag(current.tag, bindings);
    }
    if (ts.isStatement(current)) return false;
    current = current.parent;
  }
  return false;
}

/** Traces a compound tag such as `styled(Component).attrs({})` to an imported styled root. */
function isStyledTag(expression: ts.Expression, bindings: StyledTemplateBindings): boolean {
  const root = readExpressionRoot(unwrapExpression(expression));
  if (root === undefined) return false;
  return bindings.direct.has(root.text) || bindings.namespaces.has(root.text);
}

/** Returns the leftmost identifier across calls and static property access in one template tag. */
function readExpressionRoot(expression: ts.Expression): ts.Identifier | undefined {
  let current = expression;
  for (;;) {
    if (ts.isCallExpression(current)) {
      current = unwrapExpression(current.expression);
      continue;
    }
    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      current = unwrapExpression(current.expression);
      continue;
    }
    return ts.isIdentifier(current) ? current : undefined;
  }
}

/** Reads dot syntax or a literal element-access key without evaluating computed expressions. */
function readStaticPropertyName(
  expression: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): string | undefined {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  const argument = expression.argumentExpression;
  return ts.isStringLiteral(argument) || ts.isNumericLiteral(argument) ? argument.text : undefined;
}

/** Rejects optional access anywhere in the callee because its short-circuit semantics must survive. */
function hasOptionalChain(expression: ts.Expression): boolean {
  let current = expression;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    if (current.questionDotToken !== undefined) return true;
    current = unwrapExpression(current.expression);
  }
  return false;
}

/** Removes syntax-only wrappers while retaining the original source span for code generation. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
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

/** Maps supported workspace suffixes to TypeScript's matching parser grammar. */
function selectScriptKind(sourcePath: string): ts.ScriptKind {
  const normalized = sourcePath.toLowerCase();
  if (normalized.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (normalized.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (normalized.endsWith('.js')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Refuses parser-recovered source so a half-written editor buffer is never partially rewritten. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return diagnostics !== undefined && diagnostics.length > 0;
}
