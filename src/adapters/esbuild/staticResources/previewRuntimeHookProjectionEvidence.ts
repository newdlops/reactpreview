/**
 * Retains bounded, context-free hook projection proofs across repeated compiler preparation passes.
 * Exact path and source text determine the grammar and every proof. Cached values contain only
 * identifier spellings and offsets; ASTs, imported source, options and runtime decisions are absent.
 */
import ts from 'typescript';
import { readPreviewAnalysisSourceFile } from '../previewAnalysisSourceFile';
import {
  collectRuntimeHookCandidates,
  collectRuntimeHookInventory,
} from './previewRuntimeHookInventory';
import {
  MAX_HOOKS_PER_MODULE,
  type PreviewRuntimeHookProjectionEvidence,
} from './previewRuntimeHookModel';
import {
  hasPreviewRuntimeParseDiagnostics,
  isPreviewRuntimeJavaScriptLikeSource,
  selectPreviewRuntimeScriptKind,
  unwrapPreviewRuntimeExpression,
} from './previewRuntimeHookSyntax';

interface ProjectionProof {
  /** Accounted UTF-16 string payload plus numeric occurrence offsets, in bytes. */
  readonly bytes: number;
  readonly evidence: readonly PreviewRuntimeHookProjectionEvidence[];
  readonly sourceText: string;
}

const proofsByPath = new Map<string, ProjectionProof>();
const MAX_PROOFS = 512;
const MAX_PROOF_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_CHARACTERS = 64 * 1024;
let retainedBytes = 0;

/**
 * Reports direct imported hook calls admitted by the unchanged bounded runtime fallback proof.
 *
 * @param sourcePath Exact authored path used to select TS/JS/JSX grammar.
 * @param sourceText Current source, including dirty editor contents.
 * @returns Frozen spelling/offset proofs; empty or oversized results are never retained.
 */
export function collectPreviewRuntimeHookProjectionEvidence(
  sourcePath: string,
  sourceText: string,
): readonly PreviewRuntimeHookProjectionEvidence[] {
  const cached = proofsByPath.get(sourcePath);
  if (cached?.sourceText === sourceText) {
    proofsByPath.delete(sourcePath);
    proofsByPath.set(sourcePath, cached);
    return cached.evidence;
  }
  if (cached !== undefined) {
    proofsByPath.delete(sourcePath);
    retainedBytes -= cached.bytes;
  }
  if (!isPreviewRuntimeJavaScriptLikeSource(sourcePath) || !sourceText.includes('use')) return [];
  const evidence = inspectProjectionEvidence(sourcePath, sourceText);
  const bytes =
    (sourcePath.length + sourceText.length) * 2 +
    evidence.reduce((total, proof) => total + proof.localName.length * 2 + 8, 0);
  if (evidence.length === 0 || sourceText.length > MAX_SOURCE_CHARACTERS || bytes > MAX_PROOF_BYTES)
    return evidence;
  while (proofsByPath.size >= MAX_PROOFS || retainedBytes + bytes > MAX_PROOF_BYTES) {
    const oldest = proofsByPath.entries().next().value;
    if (oldest === undefined) break;
    proofsByPath.delete(oldest[0]);
    retainedBytes -= oldest[1].bytes;
  }
  proofsByPath.set(sourcePath, { bytes, evidence, sourceText });
  retainedBytes += bytes;
  return evidence;
}

/** Runs the original full proof on a miss, retaining its cap, source order and fail-open policy. */
function inspectProjectionEvidence(
  sourcePath: string,
  sourceText: string,
): readonly PreviewRuntimeHookProjectionEvidence[] {
  const sourceFile = readPreviewAnalysisSourceFile(
    sourcePath,
    sourceText,
    selectPreviewRuntimeScriptKind(sourcePath),
  );
  if (hasPreviewRuntimeParseDiagnostics(sourceFile)) return [];
  const inventory = collectRuntimeHookInventory(sourceFile);
  if (inventory.direct.size === 0) return [];
  const evidence = collectRuntimeHookCandidates(sourceFile, sourceText, inventory)
    .slice(0, MAX_HOOKS_PER_MODULE)
    .filter((candidate) => candidate.fallback.projectionUnsafe !== true)
    .flatMap((candidate) => {
      const expression = unwrapPreviewRuntimeExpression(candidate.call.expression);
      return ts.isIdentifier(expression)
        ? [
            Object.freeze({
              localName: expression.text,
              occurrenceStart: expression.getStart(sourceFile),
            }),
          ]
        : [];
    });
  return Object.freeze(evidence);
}
