/**
 * Instruments JSX-bearing boolean conditions for the React Page Inspector.
 *
 * The transform never evaluates project expressions and replaces only the condition operand. With no
 * user override the browser runtime returns the authored value unchanged, preserving JavaScript's
 * original truthiness and `&&` result semantics. Forced states return a boolean only when required to
 * reveal or hide a branch in the static preview.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';

const MAX_CONDITIONS_PER_MODULE = 128;
const MAX_METADATA_TEXT_LENGTH = 180;
const PREVIEW_INSPECTOR_API_SYMBOL = 'newdlops.react-file-preview.page-inspector';

/** One non-overlapping condition expression replacement computed against the parsed source text. */
interface ReactConditionalRenderReplacement {
  /** Exclusive source offset after the authored condition expression. */
  readonly end: number;
  /** Runtime resolver call that evaluates the original expression exactly once. */
  readonly replacement: string;
  /** Inclusive source offset of the authored condition expression. */
  readonly start: number;
}

/** Serializable browser metadata used to label and locate one conditional tree entry. */
interface ReactConditionalRenderMetadata {
  /** One-based source column of the condition expression. */
  readonly column: number;
  /** Bounded human-readable condition source. */
  readonly expression: string;
  /** Branch that appears to be an authored fallback, when its component name is explicit. */
  readonly fallbackBranch?: 'falsy' | 'truthy';
  /** Label rendered when the condition resolves false. */
  readonly falsyLabel: string;
  /** Supported syntax family. */
  readonly kind: 'logical-and' | 'ternary';
  /** One-based source line of the condition expression. */
  readonly line: number;
  /** Absolute source identity retained inside the local webview. */
  readonly sourcePath: string;
  /** Label rendered when the condition resolves true. */
  readonly truthyLabel: string;
}

/** Parsed condition candidate before a stable runtime identity and replacement are generated. */
interface ReactConditionalRenderCandidate {
  /** Authored expression whose truthiness selects the JSX branch. */
  readonly condition: ts.Expression;
  /** Static labels and source data exposed in the Inspector. */
  readonly metadata: Omit<
    ReactConditionalRenderMetadata,
    'column' | 'expression' | 'line' | 'sourcePath'
  >;
}

/**
 * Adds Page Inspector resolver calls to JSX-bearing `condition && child` and ternary expressions.
 *
 * Parse recovery fails closed, non-JSX boolean operations remain byte-for-byte intact, and a bounded
 * per-module inventory prevents generated application code from producing an unbounded Inspector UI.
 *
 * @param sourcePath Absolute workspace source path used for identity and parser grammar.
 * @param sourceText Source after other non-overlapping compatibility rewrites have completed.
 * @returns Instrumented source, or the original source when no supported condition was proven.
 */
export function instrumentReactConditionalRendering(
  sourcePath: string,
  sourceText: string,
): string {
  if (!isJavaScriptLikeSource(sourcePath) || !mayContainConditionalJsx(sourceText)) {
    return sourceText;
  }
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    selectConditionalScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) {
    return sourceText;
  }

  const candidates = collectConditionalRenderCandidates(sourceFile).slice(
    0,
    MAX_CONDITIONS_PER_MODULE,
  );
  const replacements = selectNonOverlappingConditionalReplacements(
    candidates.map((candidate, index) =>
      createConditionalRenderReplacement(sourceFile, sourcePath, candidate, index),
    ),
  );
  return applyConditionalRenderReplacements(sourceText, replacements);
}

/** Collects only boolean expressions whose selected branch directly renders JSX. */
function collectConditionalRenderCandidates(
  sourceFile: ts.SourceFile,
): readonly ReactConditionalRenderCandidate[] {
  const candidates: ReactConditionalRenderCandidate[] = [];
  /** Visits syntax in source order while retaining nested independent branch controls. */
  function visit(node: ts.Node): void {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      isDirectJsxRenderExpression(node.right)
    ) {
      candidates.push({
        condition: node.left,
        metadata: {
          falsyLabel: 'hidden',
          kind: 'logical-and',
          truthyLabel: describeJsxRenderExpression(node.right, sourceFile),
        },
      });
    } else if (
      ts.isConditionalExpression(node) &&
      (isDirectJsxRenderExpression(node.whenTrue) || isDirectJsxRenderExpression(node.whenFalse))
    ) {
      const truthyLabel = describeRenderBranch(node.whenTrue, sourceFile);
      const falsyLabel = describeRenderBranch(node.whenFalse, sourceFile);
      candidates.push({
        condition: node.condition,
        metadata: {
          ...inferFallbackBranch(truthyLabel, falsyLabel),
          falsyLabel,
          kind: 'ternary',
          truthyLabel,
        },
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return candidates;
}

/** Creates a stable resolver call without evaluating or duplicating the authored expression. */
function createConditionalRenderReplacement(
  sourceFile: ts.SourceFile,
  sourcePath: string,
  candidate: ReactConditionalRenderCandidate,
  occurrence: number,
): ReactConditionalRenderReplacement {
  const start = candidate.condition.getStart(sourceFile);
  const end = candidate.condition.end;
  const authoredExpression = sourceFile.text.slice(start, end);
  const location = sourceFile.getLineAndCharacterOfPosition(start);
  const metadata: ReactConditionalRenderMetadata = {
    column: location.character + 1,
    expression: boundMetadataText(authoredExpression.replace(/\s+/gu, ' ')),
    line: location.line + 1,
    sourcePath: path.normalize(sourcePath),
    ...candidate.metadata,
  };
  const conditionId = createConditionalRenderIdentity(sourcePath, metadata, occurrence);
  const apiExpression = `globalThis[Symbol.for(${JSON.stringify(PREVIEW_INSPECTOR_API_SYMBOL)})]`;
  return {
    end,
    replacement: `${apiExpression}.resolveRenderCondition(${JSON.stringify(conditionId)}, (${authoredExpression}), ${JSON.stringify(metadata)})`,
    start,
  };
}

/**
 * Drops pathological overlapping condition ranges while preferring the most specific inner control.
 * Ordinary nested JSX conditions operate on disjoint condition operands and are all preserved.
 */
function selectNonOverlappingConditionalReplacements(
  replacements: readonly ReactConditionalRenderReplacement[],
): readonly ReactConditionalRenderReplacement[] {
  const selected: ReactConditionalRenderReplacement[] = [];
  for (const replacement of [...replacements].sort(
    (left, right) => left.end - left.start - (right.end - right.start),
  )) {
    if (
      selected.some((current) => replacement.start < current.end && replacement.end > current.start)
    ) {
      continue;
    }
    selected.push(replacement);
  }
  return selected.sort((left, right) => left.start - right.start);
}

/** Applies replacements right-to-left so every parser offset continues to address original text. */
function applyConditionalRenderReplacements(
  sourceText: string,
  replacements: readonly ReactConditionalRenderReplacement[],
): string {
  let transformed = sourceText;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    transformed = `${transformed.slice(0, replacement.start)}${replacement.replacement}${transformed.slice(replacement.end)}`;
  }
  return transformed;
}

/** Returns whether one expression directly represents a JSX element or fragment after wrappers. */
function isDirectJsxRenderExpression(expression: ts.Expression): boolean {
  const unwrapped = unwrapConditionalExpression(expression);
  return (
    ts.isJsxElement(unwrapped) ||
    ts.isJsxSelfClosingElement(unwrapped) ||
    ts.isJsxFragment(unwrapped)
  );
}

/** Produces a concise JSX tag label while keeping arbitrary branch expressions bounded. */
function describeRenderBranch(expression: ts.Expression, sourceFile: ts.SourceFile): string {
  return isDirectJsxRenderExpression(expression)
    ? describeJsxRenderExpression(expression, sourceFile)
    : boundMetadataText(unwrapConditionalExpression(expression).getText(sourceFile));
}

/** Reads the authored component/tag name from a direct JSX branch. */
function describeJsxRenderExpression(expression: ts.Expression, sourceFile: ts.SourceFile): string {
  const unwrapped = unwrapConditionalExpression(expression);
  if (ts.isJsxFragment(unwrapped)) {
    return '<Fragment>';
  }
  if (ts.isJsxElement(unwrapped)) {
    return `<${boundMetadataText(unwrapped.openingElement.tagName.getText(sourceFile))}>`;
  }
  if (ts.isJsxSelfClosingElement(unwrapped)) {
    return `<${boundMetadataText(unwrapped.tagName.getText(sourceFile))}>`;
  }
  return 'JSX branch';
}

/** Removes syntax-only wrappers that do not change whether an expression is direct JSX. */
function unwrapConditionalExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Marks a recognizable placeholder/loading/error branch so the UI can call it out explicitly. */
function inferFallbackBranch(
  truthyLabel: string,
  falsyLabel: string,
): Pick<ReactConditionalRenderMetadata, 'fallbackBranch'> | Record<string, never> {
  const truthyFallback = isFallbackBranchLabel(truthyLabel);
  const falsyFallback = isFallbackBranchLabel(falsyLabel);
  if (truthyFallback === falsyFallback) {
    return {};
  }
  return { fallbackBranch: truthyFallback ? 'truthy' : 'falsy' };
}

/** Recognizes common authored fallback component names without assigning project-specific meaning. */
function isFallbackBranchLabel(label: string): boolean {
  return /fallback|empty|error|loading|placeholder|skeleton|spinner|no[-_ ]?data/iu.test(label);
}

/** Creates an opaque, hot-reload-stable identity from source semantics and bounded occurrence order. */
function createConditionalRenderIdentity(
  sourcePath: string,
  metadata: ReactConditionalRenderMetadata,
  occurrence: number,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        path.normalize(sourcePath),
        metadata.kind,
        metadata.expression,
        metadata.truthyLabel,
        metadata.falsyLabel,
        occurrence,
      ]),
    )
    .digest('hex')
    .slice(0, 24);
}

/** Keeps source labels readable without allowing one expression to dominate persisted UI state. */
function boundMetadataText(value: string): string {
  const normalized = value.trim();
  return normalized.length <= MAX_METADATA_TEXT_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_METADATA_TEXT_LENGTH - 1)}…`;
}

/** Selects a JSX-capable parser grammar for every source extension accepted by the compiler. */
function selectConditionalScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.ts' || extension === '.mts' || extension === '.cts') return ts.ScriptKind.TS;
  return ts.ScriptKind.JSX;
}

/** Restricts instrumentation to modules esbuild can load as JavaScript or TypeScript source. */
function isJavaScriptLikeSource(sourcePath: string): boolean {
  return /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/iu.test(sourcePath);
}

/** Avoids a TypeScript parse for modules with no plausible supported conditional JSX syntax. */
function mayContainConditionalJsx(sourceText: string): boolean {
  return sourceText.includes('<') && (sourceText.includes('&&') || sourceText.includes('?'));
}

/** Rejects parser recovery so replacements never address an incomplete or ambiguous syntax tree. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return diagnostics !== undefined && diagnostics.length > 0;
}
