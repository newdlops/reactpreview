/**
 * Instruments non-callable styled-components theme reads with a render-only structural resolver.
 * Callable helpers are handled by a separate transform because their receiver and invocation
 * semantics differ. This module limits edits to complete static paths inside proven styled tagged
 * templates, so application data named `theme` and computed business expressions are untouched.
 */
import ts from 'typescript';
import type { PreviewSourceReplacement } from './previewSourceReplacement';
import {
  collectPreviewStyledTemplateBindings,
  createPreviewStyledTemplateSourceFile,
  hasPreviewOptionalPropertyChain,
  hasPreviewStyledTemplateParseDiagnostics,
  isInsidePreviewStyledTemplate,
  readPreviewStaticPropertyName,
  type PreviewStyledTemplateBindings,
  unwrapPreviewStyledExpression,
} from './previewStyledTemplateSyntax';

const PREVIEW_THEME_SPECIFIER = 'react-preview:theme';
const MAX_THEME_VALUES_PER_SOURCE = 256;

/** Callback supplied by the source transformer to avoid generated identifier collisions. */
export type PreviewThemeValueBindingAllocator = (kind: string) => string;

/** Generated resolver import and complete-expression edits for one authored source module. */
export interface PreviewThemeValueTransform {
  /** Import for the browser value resolver, omitted when no safe theme path was proven. */
  readonly imports: readonly string[];
  /** Complete non-callable property expressions replaced with one safe resolver invocation. */
  readonly replacements: readonly PreviewSourceReplacement[];
}

/** One complete static value path rooted at an authored `.theme` property. */
interface PreviewThemeValueRead {
  /** Outermost property expression replaced as one non-overlapping source range. */
  readonly expression: ts.PropertyAccessExpression | ts.ElementAccessExpression;
  /** Original `.theme` expression evaluated exactly once by the generated resolver call. */
  readonly themeExpression: ts.PropertyAccessExpression | ts.ElementAccessExpression;
  /** Theme-relative static path such as `['flex', 'rowBetween']`. */
  readonly themePath: readonly string[];
}

/**
 * Finds complete non-callable theme reads and replaces only those proven styled-template ranges.
 * Optional chains, assignments, helper callees, computed properties, and malformed editor buffers
 * retain their authored semantics. Source coordinates accompany each resolver so live diagnostics
 * can identify the exact CSS interpolation that required preview-only repair.
 *
 * @param sourcePath Absolute authored source identity embedded in bounded runtime diagnostics.
 * @param sourceText Unmodified workspace source loaded by the preview compiler.
 * @param allocateBinding Collision-safe generated binding allocator.
 * @returns One optional resolver import and bounded, non-overlapping source replacements.
 */
export function createPreviewThemeValueTransform(
  sourcePath: string,
  sourceText: string,
  allocateBinding: PreviewThemeValueBindingAllocator,
): PreviewThemeValueTransform {
  const sourceFile = createPreviewStyledTemplateSourceFile(sourcePath, sourceText);
  if (hasPreviewStyledTemplateParseDiagnostics(sourceFile)) {
    return { imports: [], replacements: [] };
  }
  const bindings = collectPreviewStyledTemplateBindings(sourceFile);
  if (bindings.direct.size === 0 && bindings.namespaces.size === 0) {
    return { imports: [], replacements: [] };
  }
  const valueReads = collectPreviewThemeValueReads(sourceFile, bindings);
  if (valueReads.length === 0 || valueReads.length > MAX_THEME_VALUES_PER_SOURCE) {
    return { imports: [], replacements: [] };
  }

  const resolverBinding = allocateBinding('themeValue');
  return {
    imports: [
      `import { resolvePreviewThemeValue as ${resolverBinding} } from ${JSON.stringify(PREVIEW_THEME_SPECIFIER)};`,
    ],
    replacements: valueReads.map((valueRead) => ({
      end: valueRead.expression.end,
      replacement: createPreviewThemeValueResolverExpression(
        valueRead,
        resolverBinding,
        sourceFile,
        sourcePath,
        sourceText,
      ),
      start: valueRead.expression.getStart(sourceFile),
    })),
  };
}

/** Visits property expressions once and retains only complete, non-callable styled theme paths. */
function collectPreviewThemeValueReads(
  sourceFile: ts.SourceFile,
  bindings: PreviewStyledTemplateBindings,
): readonly PreviewThemeValueRead[] {
  const valueReads: PreviewThemeValueRead[] = [];
  const visit = (node: ts.Node): void => {
    if (
      valueReads.length <= MAX_THEME_VALUES_PER_SOURCE &&
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      !hasPreviewOptionalPropertyChain(node) &&
      isCompletePreviewThemeValueExpression(node) &&
      isInsidePreviewStyledTemplate(node, bindings)
    ) {
      const valueRead = readPreviewThemeValue(node);
      if (valueRead !== undefined) valueReads.push(valueRead);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return valueReads;
}

/** Rejects intermediate path segments, helper callees, and property writes before source editing. */
function isCompletePreviewThemeValueExpression(
  expression: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): boolean {
  const parent = expression.parent;
  if (
    (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
    unwrapPreviewStyledExpression(parent.expression) === expression
  ) {
    return false;
  }
  if (
    ts.isCallExpression(parent) &&
    unwrapPreviewStyledExpression(parent.expression) === expression
  ) {
    return false;
  }
  if (
    ts.isBinaryExpression(parent) &&
    parent.left === expression &&
    parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  ) {
    return false;
  }
  return (
    !ts.isDeleteExpression(parent) &&
    !(ts.isPostfixUnaryExpression(parent) || ts.isPrefixUnaryExpression(parent))
  );
}

/** Reads a static property chain until the nearest `.theme` receiver is reached. */
function readPreviewThemeValue(
  expression: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): PreviewThemeValueRead | undefined {
  const propertyName = readPreviewStaticPropertyName(expression);
  if (propertyName === undefined) return undefined;
  const segments: string[] = [propertyName];
  let current: ts.Expression = unwrapPreviewStyledExpression(expression.expression);
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    const name = readPreviewStaticPropertyName(current);
    if (name === undefined) return undefined;
    if (name === 'theme') {
      return {
        expression,
        themeExpression: current,
        themePath: [...segments].reverse(),
      };
    }
    segments.push(name);
    current = unwrapPreviewStyledExpression(current.expression);
  }
  return undefined;
}

/** Creates one resolver call with the original receiver, static path, and authored coordinates. */
function createPreviewThemeValueResolverExpression(
  valueRead: PreviewThemeValueRead,
  resolverBinding: string,
  sourceFile: ts.SourceFile,
  sourcePath: string,
  sourceText: string,
): string {
  const start = valueRead.expression.getStart(sourceFile);
  const position = sourceFile.getLineAndCharacterOfPosition(start);
  const themeExpression = sourceText.slice(
    valueRead.themeExpression.getStart(sourceFile),
    valueRead.themeExpression.end,
  );
  const evidence = {
    column: position.character + 1,
    line: position.line + 1,
    sourcePath: sourcePath.replaceAll('\\', '/'),
  };
  return `${resolverBinding}((${themeExpression}), ${JSON.stringify(valueRead.themePath)}, ${JSON.stringify(evidence)})`;
}
