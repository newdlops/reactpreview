/**
 * Adds deterministic Emotion `target` identities to authored styled-component factories.
 *
 * Emotion's Babel/SWC transforms normally attach these identities. A lightweight esbuild preview
 * deliberately does not execute project compiler plugins, so interpolating one styled component
 * as a selector from another template otherwise throws at render time. This syntax-only boundary
 * supplies only the missing identity option; it preserves template contents, component arguments,
 * authored options, props, and CSS evaluation order.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import type { PreviewSourceReplacement } from './previewSourceReplacement';

const EMOTION_STYLED_SPECIFIERS = new Set(['@emotion/styled', '@emotion/styled/macro']);
const MAX_EMOTION_FACTORIES = 256;
const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Finds direct factories rooted in an imported Emotion `styled` binding and adds a stable target.
 *
 * Supported authored forms include tagged templates and object/function styles:
 * `styled.div\`...\``, `styled(Component)\`...\``, `styled.div({...})`, and
 * `styled(Component, options)({...})`. Existing target options remain completely untouched.
 *
 * @param sourcePath Absolute authored module identity used to stabilize generated target names.
 * @param sourceText Original JS/JSX/TS/TSX source.
 * @returns Ordered non-overlapping edits addressing the original source text.
 */
export function createEmotionTargetReplacements(
  sourcePath: string,
  sourceText: string,
): readonly PreviewSourceReplacement[] {
  if (!sourceText.includes('@emotion/styled') || !sourceText.includes('styled')) return [];
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    selectScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) return [];
  const styledBindings = collectEmotionStyledBindings(sourceFile);
  if (styledBindings.size === 0) return [];
  const replacements = new Map<string, PreviewSourceReplacement>();

  /** Records only direct styled factory expressions, never arbitrary similarly named objects. */
  const visit = (node: ts.Node): void => {
    if (replacements.size >= MAX_EMOTION_FACTORIES) return;
    if (ts.isTaggedTemplateExpression(node)) {
      recordFactoryReplacement(
        node.tag,
        node,
        sourceFile,
        styledBindings,
        sourcePath,
        replacements,
      );
    } else if (ts.isCallExpression(node)) {
      // In `styled.div(styles)` the callee is the factory. In `styled(Component)(styles)`, the
      // inner call is visited independently and receives the identity before its returned factory
      // consumes the style argument.
      recordFactoryReplacement(
        node.expression,
        node,
        sourceFile,
        styledBindings,
        sourcePath,
        replacements,
      );
      recordFactoryReplacement(node, node, sourceFile, styledBindings, sourcePath, replacements);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return [...replacements.values()].sort((left, right) => left.start - right.start);
}

/** Selects TypeScript parser grammar from the authored suffix. */
function selectScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/** Rejects parser-recovered editor buffers before computing source offsets. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return (diagnostics?.length ?? 0) > 0;
}

/** Collects default or `default as` imports from Emotion's browser styled entry points. */
function collectEmotionStyledBindings(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const bindings = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !EMOTION_STYLED_SPECIFIERS.has(statement.moduleSpecifier.text)
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause === undefined || clause.phaseModifier !== undefined) continue;
    if (clause.name !== undefined) bindings.add(clause.name.text);
    if (clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (!element.isTypeOnly && element.propertyName?.text === 'default') {
          bindings.add(element.name.text);
        }
      }
    }
  }
  return bindings;
}

/** Creates and deduplicates one property- or call-factory source edit. */
function recordFactoryReplacement(
  candidate: ts.Expression,
  owner: ts.Node,
  sourceFile: ts.SourceFile,
  styledBindings: ReadonlySet<string>,
  sourcePath: string,
  replacements: Map<string, PreviewSourceReplacement>,
): void {
  const factory = unwrapExpression(candidate);
  const replacement =
    ts.isPropertyAccessExpression(factory) || ts.isElementAccessExpression(factory)
      ? createIntrinsicFactoryReplacement(factory, owner, sourceFile, styledBindings, sourcePath)
      : ts.isCallExpression(factory)
        ? createComponentFactoryReplacement(factory, owner, sourceFile, styledBindings, sourcePath)
        : undefined;
  if (replacement === undefined) return;
  const key = [replacement.start, replacement.end].join(':');
  if (!replacements.has(key)) replacements.set(key, replacement);
}

/** Rewrites `styled.div` into Emotion's target-aware `styled("div", options)` factory form. */
function createIntrinsicFactoryReplacement(
  factory: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  owner: ts.Node,
  sourceFile: ts.SourceFile,
  styledBindings: ReadonlySet<string>,
  sourcePath: string,
): PreviewSourceReplacement | undefined {
  const root = unwrapExpression(factory.expression);
  if (!ts.isIdentifier(root) || !styledBindings.has(root.text)) return undefined;
  if (!isFactoryUse(factory, owner)) return undefined;
  const intrinsicName = readStaticPropertyName(factory);
  if (intrinsicName === undefined || BLOCKED_PROPERTY_NAMES.has(intrinsicName)) return undefined;
  const start = factory.getStart(sourceFile);
  const end = factory.getEnd();
  const target = createEmotionTarget(sourcePath, start);
  return {
    end,
    replacement: `${root.text}(${JSON.stringify(intrinsicName)}, { target: ${JSON.stringify(target)} })`,
    start,
  };
}

/** Adds a target option to direct `styled(Component[, options])` calls. */
function createComponentFactoryReplacement(
  factory: ts.CallExpression,
  owner: ts.Node,
  sourceFile: ts.SourceFile,
  styledBindings: ReadonlySet<string>,
  sourcePath: string,
): PreviewSourceReplacement | undefined {
  const callee = unwrapExpression(factory.expression);
  if (
    !ts.isIdentifier(callee) ||
    !styledBindings.has(callee.text) ||
    factory.arguments.length < 1 ||
    factory.arguments.length > 2 ||
    !isFactoryUse(factory, owner)
  ) {
    return undefined;
  }
  const existingOptions = factory.arguments[1];
  if (existingOptions !== undefined && objectLiteralHasTarget(existingOptions)) return undefined;
  const component = factory.arguments[0];
  if (component === undefined) return undefined;
  const start = factory.getStart(sourceFile);
  const end = factory.getEnd();
  const target = JSON.stringify(createEmotionTarget(sourcePath, start));
  const componentText = component.getText(sourceFile);
  const optionsText = existingOptions?.getText(sourceFile);
  return {
    end,
    replacement:
      optionsText === undefined
        ? `${callee.text}(${componentText}, { target: ${target} })`
        : `${callee.text}(${componentText}, { ...(${optionsText}), target: ${target} })`,
    start,
  };
}

/**
 * Limits property factories to a template tag or style-call callee. Direct component factories are
 * also admitted because `const factory = styled(Component)` may be consumed in a later statement.
 */
function isFactoryUse(factory: ts.Expression, owner: ts.Node): boolean {
  if (ts.isCallExpression(factory)) return true;
  return (
    (ts.isTaggedTemplateExpression(owner) && owner.tag === factory) ||
    (ts.isCallExpression(owner) && owner.expression === factory)
  );
}

/** Reads a dot property or literal element property without evaluating computed source. */
function readStaticPropertyName(
  expression: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): string | undefined {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  const argument = expression.argumentExpression;
  return ts.isStringLiteral(argument) || ts.isNumericLiteral(argument) ? argument.text : undefined;
}

/** Preserves authored or previously compiler-generated targets without creating duplicate options. */
function objectLiteralHasTarget(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isObjectLiteralExpression(unwrapped)) return false;
  return unwrapped.properties.some((property) => {
    if (
      !ts.isPropertyAssignment(property) &&
      !ts.isShorthandPropertyAssignment(property) &&
      !ts.isMethodDeclaration(property) &&
      !ts.isGetAccessorDeclaration(property) &&
      !ts.isSetAccessorDeclaration(property)
    ) {
      return false;
    }
    const name = property.name;
    return (
      (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) &&
      name.text === 'target'
    );
  });
}

/** Creates a CSS-safe stable identity from module path and original factory offset. */
function createEmotionTarget(sourcePath: string, start: number): string {
  const digest = createHash('sha256')
    .update(`${path.normalize(sourcePath)}\0${String(start)}`)
    .digest('hex')
    .slice(0, 12);
  return `rpe${digest}`;
}

/** Removes only syntax-erased TypeScript wrappers. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}
