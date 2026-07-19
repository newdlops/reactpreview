/**
 * Instruments callable styled-components theme tokens without assuming project-specific names.
 * A preview can discover the correct root theme and still encounter an incomplete nested provider;
 * wrapping only statically proven theme-helper callees lets the browser recover that one CSS value
 * while preserving the project's arguments, provider hierarchy, and every non-style expression.
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
  const sourceFile = createPreviewStyledTemplateSourceFile(sourcePath, sourceText);
  if (hasPreviewStyledTemplateParseDiagnostics(sourceFile)) {
    return { imports: [], replacements: [] };
  }
  const bindings = collectPreviewStyledTemplateBindings(sourceFile);
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

/** Visits call expressions once and retains only callees proven to be inside a styled template. */
function collectThemeHelperCalls(
  sourceFile: ts.SourceFile,
  bindings: PreviewStyledTemplateBindings,
): readonly ThemeHelperCall[] {
  const calls: ThemeHelperCall[] = [];
  const visit = (node: ts.Node): void => {
    if (
      calls.length <= MAX_THEME_HELPERS_PER_SOURCE &&
      ts.isCallExpression(node) &&
      node.questionDotToken === undefined &&
      (ts.isPropertyAccessExpression(node.expression) ||
        ts.isElementAccessExpression(node.expression)) &&
      !hasPreviewOptionalPropertyChain(node.expression) &&
      isInsidePreviewStyledTemplate(node, bindings)
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
  const propertyName = readPreviewStaticPropertyName(callee);
  if (propertyName === undefined) return undefined;
  const segments: string[] = [propertyName];
  let current: ts.Expression = unwrapPreviewStyledExpression(callee.expression);
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    const name = readPreviewStaticPropertyName(current);
    if (name === undefined) return undefined;
    if (name === 'theme') {
      return segments.length === 0
        ? undefined
        : { callee, themeExpression: current, themePath: [...segments].reverse() };
    }
    segments.push(name);
    current = unwrapPreviewStyledExpression(current.expression);
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
  const start = call.callee.getStart(sourceFile);
  const position = sourceFile.getLineAndCharacterOfPosition(start);
  const themeExpression = sourceText.slice(
    call.themeExpression.getStart(sourceFile),
    call.themeExpression.end,
  );
  const evidence = {
    column: position.character + 1,
    line: position.line + 1,
    sourcePath: sourceFile.fileName.replaceAll('\\', '/'),
  };
  return `${resolverBinding}((${themeExpression}), ${JSON.stringify(call.themePath)}, ${JSON.stringify(evidence)})`;
}
