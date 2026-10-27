/** Emits compiler-owned condition registration, scalar metadata, and stable identities. */
import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import { createPreviewRenderExpressionFingerprint } from './previewReactRenderOutcomeSyntax';
import { isReactConditionLocalStateBound } from './reactConditionStateBinding';
import {
  boundMetadataText,
  PREVIEW_INSPECTOR_API_SYMBOL,
  type PreparedReactConditionalRenderReplacement,
  type ReactConditionalRenderCandidate,
  type ReactConditionalRenderMetadata,
  type ReactConditionalScalarExpression,
} from './reactConditionalModel';
import {
  findNearestOverlayRuntimeFunction,
  readOverlayRuntimeFunctionName,
  unwrapConditionalExpression,
} from './reactConditionalOverlaySyntax';

/** Creates a stable resolver call without evaluating or duplicating the authored expression. */
export function createConditionalRenderReplacement(
  sourceFile: ts.SourceFile,
  sourcePath: string,
  candidate: ReactConditionalRenderCandidate,
  occurrence: number,
): PreparedReactConditionalRenderReplacement {
  const start = candidate.condition.getStart(sourceFile);
  const end = candidate.condition.end;
  const authoredExpression = sourceFile.text.slice(start, end);
  const location = sourceFile.getLineAndCharacterOfPosition(start);
  const runtimeOwner = findNearestOverlayRuntimeFunction(candidate.condition);
  const runtimeOwnerName =
    runtimeOwner === undefined
      ? undefined
      : readOverlayRuntimeFunctionName(runtimeOwner, sourceFile);
  const scalarExpression = inferConditionalScalarExpression(candidate.condition);
  const metadata: ReactConditionalRenderMetadata = {
    authoredExpression: boundMetadataText(authoredExpression.replace(/\s+/gu, ' ')),
    ...(candidate.negateRuntimeResult === true ? { authoredExpressionNegated: true } : {}),
    column: location.character + 1,
    expression: boundMetadataText(
      (candidate.expressionLabel ?? authoredExpression).replace(/\s+/gu, ' '),
    ),
    expressionFingerprint: createPreviewRenderExpressionFingerprint(authoredExpression),
    line: location.line + 1,
    ...(runtimeOwnerName === undefined ? {} : { ownerName: runtimeOwnerName }),
    ...(scalarExpression === undefined ? {} : { scalarExpression }),
    ...(isReactConditionLocalStateBound(candidate.condition) ? { stateBound: true } : {}),
    sourcePath: path.normalize(sourcePath),
    ...candidate.metadata,
    ...(candidate.metadata.kind === 'overlay-visibility' && runtimeOwnerName !== undefined
      ? { runtimeOwnerName }
      : {}),
  };
  const conditionId = createConditionalRenderIdentity(sourcePath, metadata, occurrence);
  const apiExpression = `globalThis[Symbol.for(${JSON.stringify(PREVIEW_INSPECTOR_API_SYMBOL)})]`;
  const resolverPrefix =
    candidate.metadata.kind === 'logical-and'
      ? `${apiExpression}.resolveRenderConditionLazy(${JSON.stringify(conditionId)}, () => (`
      : `${apiExpression}.resolveRenderCondition(${JSON.stringify(conditionId)}, (`;
  const resolverSuffix = `), ${JSON.stringify(metadata)})`;
  return {
    conditionId,
    definition: { id: conditionId, metadata },
    ...(candidate.overlayActivationTerminal === undefined
      ? {}
      : { overlayActivationTerminal: candidate.overlayActivationTerminal }),
    replacement: {
      end,
      prefix: candidate.negateRuntimeResult === true ? `!(${resolverPrefix}` : resolverPrefix,
      start,
      suffix: candidate.negateRuntimeResult === true ? `${resolverSuffix})` : resolverSuffix,
    },
  };
}

/** Converts a safe, bounded subset of authored scalar logic into inert compiler evidence. */
export function inferConditionalScalarExpression(
  expression: ts.Expression,
  depth = 0,
): ReactConditionalScalarExpression | undefined {
  if (depth > 6) return undefined;
  const current = unwrapConditionalExpression(expression);
  if (ts.isPrefixUnaryExpression(current) && current.operator === ts.SyntaxKind.ExclamationToken) {
    const operand = inferConditionalScalarExpression(current.operand, depth + 1);
    return operand === undefined ? undefined : { kind: 'not', operand };
  }
  if (!ts.isBinaryExpression(current)) return undefined;
  if (
    current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    current.operatorToken.kind === ts.SyntaxKind.BarBarToken
  ) {
    const left = inferConditionalScalarExpression(current.left, depth + 1);
    const right = inferConditionalScalarExpression(current.right, depth + 1);
    if (left === undefined || right === undefined) return undefined;
    return {
      kind: current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? 'and' : 'or',
      left,
      right,
    };
  }
  const operator = readConditionalScalarComparisonOperator(current.operatorToken.kind);
  if (operator === undefined) return undefined;
  const leftPath = readConditionalScalarPath(current.left);
  const rightValue = readConditionalScalarLiteral(current.right);
  if (leftPath !== undefined && rightValue.supported) {
    return { kind: 'comparison', operator, path: leftPath, value: rightValue.value };
  }
  const rightPath = readConditionalScalarPath(current.right);
  const leftValue = readConditionalScalarLiteral(current.left);
  return rightPath !== undefined && leftValue.supported
    ? { kind: 'comparison', operator, path: rightPath, value: leftValue.value }
    : undefined;
}

/** Reads only equality operators whose primitive result is stable under operand reversal. */
export function readConditionalScalarComparisonOperator(
  kind: ts.SyntaxKind,
): '==' | '!=' | '===' | '!==' | undefined {
  if (kind === ts.SyntaxKind.EqualsEqualsToken) return '==';
  if (kind === ts.SyntaxKind.ExclamationEqualsToken) return '!=';
  if (kind === ts.SyntaxKind.EqualsEqualsEqualsToken) return '===';
  if (kind === ts.SyntaxKind.ExclamationEqualsEqualsToken) return '!==';
  return undefined;
}

/** Reads a side-effect-free identifier/property chain such as `state.status`. */
export function readConditionalScalarPath(expression: ts.Expression): string | undefined {
  let current = unwrapConditionalExpression(expression);
  const segments: string[] = [];
  while (ts.isPropertyAccessExpression(current) && current.questionDotToken === undefined) {
    segments.unshift(current.name.text);
    current = unwrapConditionalExpression(current.expression);
    if (segments.length > 8) return undefined;
  }
  if (!ts.isIdentifier(current)) return undefined;
  segments.unshift(current.text);
  const value = segments.join('.');
  return value.length <= 160 ? value : undefined;
}

/** Distinguishes an unsupported expression from the supported `undefined`-free literal set. */
export function readConditionalScalarLiteral(
  expression: ts.Expression,
):
  | { readonly supported: false }
  | { readonly supported: true; readonly value: boolean | null | number | string } {
  const current = unwrapConditionalExpression(expression);
  if (ts.isStringLiteralLike(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
    return { supported: true, value: current.text.slice(0, 160) };
  }
  if (ts.isNumericLiteral(current)) {
    const value = Number(current.text);
    return Number.isFinite(value) ? { supported: true, value } : { supported: false };
  }
  if (current.kind === ts.SyntaxKind.TrueKeyword) return { supported: true, value: true };
  if (current.kind === ts.SyntaxKind.FalseKeyword) return { supported: true, value: false };
  if (current.kind === ts.SyntaxKind.NullKeyword) return { supported: true, value: null };
  return { supported: false };
}

/** Emits one inert module batch so hot edits can replace stale short-circuited definitions. */
export function createConditionalRenderDefinitionsRegistration(
  sourcePath: string,
  definitions: readonly PreparedReactConditionalRenderReplacement['definition'][],
): string {
  const api = `globalThis[Symbol.for(${JSON.stringify(PREVIEW_INSPECTOR_API_SYMBOL)})]`;
  return `try { ${api}?.registerRenderConditionDefinitions?.(${JSON.stringify(path.normalize(sourcePath))}, ${JSON.stringify(definitions)}); } catch { /* Inspector registration must not break the authored module. */ }`;
}

/** Creates an opaque, hot-reload-stable identity from source semantics and bounded occurrence order. */
export function createConditionalRenderIdentity(
  sourcePath: string,
  metadata: ReactConditionalRenderMetadata,
  occurrence: number,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        path.normalize(sourcePath),
        metadata.kind,
        metadata.expressionFingerprint,
        metadata.expression,
        metadata.truthyLabel,
        metadata.falsyLabel,
        occurrence,
      ]),
    )
    .digest('hex')
    .slice(0, 24);
}

/** Selects a JSX-capable parser grammar for every source extension accepted by the compiler. */
export function selectConditionalScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.ts' || extension === '.mts' || extension === '.cts') return ts.ScriptKind.TS;
  return ts.ScriptKind.JSX;
}

/** Restricts instrumentation to modules esbuild can load as JavaScript or TypeScript source. */
export function isJavaScriptLikeSource(sourcePath: string): boolean {
  return /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/iu.test(sourcePath);
}

/** Avoids a TypeScript parse for modules with no plausible supported conditional JSX syntax. */
export function mayContainConditionalJsx(sourceText: string): boolean {
  const containsReactFactory = sourceText.includes('React.createElement');
  return (
    (sourceText.includes('<') || containsReactFactory) &&
    (sourceText.includes('&&') ||
      sourceText.includes('?') ||
      sourceText.includes('if') ||
      sourceText.includes('createPortal') ||
      (sourceText.includes('return null') &&
        /\b[A-Za-z_$][\w$]*(?:Modal|Dialog|Drawer|Popover|Overlay|Portal|Sheet|Lightbox|Tooltip|Toast|Snackbar|Dropdown|Menu)\b/u.test(
          sourceText,
        )) ||
      /\b(?:active|defaultOpen|defaultVisible|expanded|hidden|isHidden|isOpen|isVisible|open|present|show|shown|visible)\s*=/u.test(
        sourceText,
      ))
  );
}

/** Rejects parser recovery so replacements never address an incomplete or ambiguous syntax tree. */
export function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return diagnostics !== undefined && diagnostics.length > 0;
}
