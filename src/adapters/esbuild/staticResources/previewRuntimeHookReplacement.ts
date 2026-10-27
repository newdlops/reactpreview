/** Emits private hook instrumentation and stable source-owned identities. */
import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import {
  inferPreviewRuntimeHookSemanticValueDemand,
  readPreviewRuntimeHookIdentityExpression,
} from './previewRuntimeHookFallbackSupport';
import { readPreviewRuntimeHookGraphqlArguments } from './previewRuntimeHookGraphqlArguments';
import { boundMetadataText } from './previewRuntimeHookInventory';
import { type PreviewRuntimeHookCandidate, INSPECTOR_API_SYMBOL } from './previewRuntimeHookModel';
import {
  findNearestPreviewRuntimeFunction as findNearestRuntimeFunction,
  readPreviewRuntimeFunctionName,
} from './previewRuntimeHookSyntax';
import { createPreviewRuntimeHookTypedMetadata } from './previewRuntimeHookTypedFallback';
import type { PreviewSourceReplacement } from './previewSourceReplacement';

/** Creates one stable global resolver call while preserving the original hook invocation once. */
export function createRuntimeHookReplacement(
  sourceFile: ts.SourceFile,
  sourcePath: string,
  sourceText: string,
  candidate: PreviewRuntimeHookCandidate,
  occurrence: number,
): PreviewSourceReplacement {
  const start = candidate.call.getStart(sourceFile);
  const end = candidate.call.end;
  const location = sourceFile.getLineAndCharacterOfPosition(start);
  const originalCall = sourceText.slice(start, end);
  const hookIdentityExpression = readPreviewRuntimeHookIdentityExpression(
    candidate,
    sourceFile,
    sourceText,
  );
  const graphqlArguments = readPreviewRuntimeHookGraphqlArguments(
    candidate.hook.hookName,
    candidate.call,
    sourceFile,
    sourceText,
  );
  const ownerName = readPreviewRuntimeFunctionName(findNearestRuntimeFunction(candidate.call));
  const semanticValueDemand = inferPreviewRuntimeHookSemanticValueDemand(
    candidate.call,
    candidate.fallback,
  );
  const metadata = {
    column: location.character + 1,
    evidence: boundMetadataText(candidate.fallback.evidence),
    fallbackLabel: candidate.fallback.label,
    hookName: candidate.hook.hookName,
    id: createRuntimeHookIdentity(sourcePath, candidate, occurrence),
    // `useX.getState()`/facade calls may run outside render; `Hooks.useFoo()` stays a hook call.
    ...(candidate.hook.hookName.includes('.') ? { invocation: 'member' as const } : {}),
    line: location.line + 1,
    moduleSpecifier: candidate.hook.moduleSpecifier,
    ...(ownerName === undefined ? {} : { ownerName }),
    ...(candidate.fallback.failurePaths === undefined
      ? {}
      : { failurePaths: candidate.fallback.failurePaths }),
    ...(candidate.fallback.passive === true ? { passive: true } : {}),
    ...(candidate.fallback.preserveNullish === true ? { preserveNullish: true } : {}),
    ...(candidate.fallback.preserveSmartValue === true ? { preserveSmartValue: true } : {}),
    ...(candidate.fallback.renderGuardPaths === undefined
      ? {}
      : { renderGuardPaths: candidate.fallback.renderGuardPaths }),
    ...(candidate.fallback.nonNegativeNumberPaths === undefined
      ? {}
      : { nonNegativeNumberPaths: candidate.fallback.nonNegativeNumberPaths }),
    requiredPaths: candidate.fallback.requiredPaths ?? ['<root>'],
    ...(semanticValueDemand === undefined ? {} : { semanticValueDemand }),
    sourcePath: path.normalize(sourcePath),
    ...createPreviewRuntimeHookTypedMetadata(
      candidate.typed,
      candidate.typedOnly === true,
      candidate.fallback.requiredPaths,
    ),
  };
  const api = `globalThis[Symbol.for(${JSON.stringify(INSPECTOR_API_SYMBOL)})]`;
  const metadataExpression =
    candidate.fallback.smartPathValueExpressions === undefined ||
    candidate.fallback.smartPathValueExpressions.length === 0
      ? JSON.stringify(metadata)
      : `Object.assign(${JSON.stringify(metadata)}, { smartPathValues: Object.freeze([${candidate.fallback.smartPathValueExpressions
          .map(
            (value) =>
              `Object.freeze({ path: ${JSON.stringify(value.path)}, value: (${value.expression})${
                value.deterministicRank === undefined
                  ? ''
                  : `, deterministicRank: ${String(value.deterministicRank)}`
              }${value.role === undefined ? '' : `, role: ${JSON.stringify(value.role)}`} })`,
          )
          .join(', ')}]) })`;
  const graphqlRuntimeArguments =
    graphqlArguments === undefined
      ? ', undefined, undefined'
      : `, () => (${graphqlArguments.documentExpression})${
          graphqlArguments.optionsExpression === undefined
            ? ', undefined'
            : `, () => (${graphqlArguments.optionsExpression})`
        }`;
  return {
    end,
    ...(candidate.hook.hookName.endsWith('Context') ? { priority: 1 } : {}),
    replacement: `${api}.resolveRuntimeHook(() => (${originalCall}), () => (${candidate.fallback.expression}), ${metadataExpression}${graphqlRuntimeArguments}, () => (${hookIdentityExpression}))`,
    start,
  };
}

/** Keeps outer hook calls when nested hook arguments would otherwise create overlapping edits. */
export function selectNonOverlappingHookReplacements(
  replacements: readonly PreviewSourceReplacement[],
): readonly PreviewSourceReplacement[] {
  const selected: PreviewSourceReplacement[] = [];
  for (const replacement of [...replacements].sort(
    (left, right) => right.end - right.start - (left.end - left.start),
  )) {
    if (selected.some((item) => replacement.start < item.end && replacement.end > item.start)) {
      continue;
    }
    selected.push(replacement);
  }
  return selected.sort((left, right) => left.start - right.start);
}

/** Creates a hot-reload-stable identity from source semantics and bounded occurrence order. */
export function createRuntimeHookIdentity(
  sourcePath: string,
  candidate: PreviewRuntimeHookCandidate,
  occurrence: number,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        path.normalize(sourcePath),
        candidate.hook.moduleSpecifier,
        candidate.hook.hookName,
        candidate.fallback.evidence,
        candidate.fallback.expression,
        candidate.fallback.preserveNullish === true,
        candidate.fallback.nonNegativeNumberPaths ?? [],
        candidate.fallback.requiredPaths ?? ['<root>'],
        occurrence,
      ]),
    )
    .digest('hex')
    .slice(0, 24);
}
