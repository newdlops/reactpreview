/** Stable compiler-owned JSX call-site identities; no project values participate in the key. */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';

export const PREVIEW_JSX_OCCURRENCE_PROP = '__reactPreviewInspectorOccurrence';

/** Returns the same opaque identity for an authored opening tag across virtual module slices. */
export function createPreviewJsxOccurrenceId(sourcePath: string, openingStart: number): string {
  return `rpi:${createHash('sha256')
    .update(path.normalize(canonicalizeExistingPath(sourcePath)))
    .update('\0')
    .update(String(openingStart))
    .digest('hex')
    .slice(0, 32)}`;
}

/** Reads ordered JSX sites even when fast planning intentionally omits reverse usage edges. */
export function readPreviewJsxPathOccurrences(candidate: {
  readonly rootStepIndex?: number;
  readonly edges: readonly { readonly occurrenceId?: string }[];
  readonly renderPath?: {
    readonly steps: readonly {
      readonly sourcePath: string;
      readonly occurrenceStart: number;
      readonly invocation?: {
        readonly mode: string;
        readonly sourcePath?: string;
        readonly slotName?: string;
      };
    }[];
  };
}): { readonly ids: readonly string[]; readonly suspenseFallbackIds: readonly string[] } {
  if (!supportsPreviewJsxPathOccurrenceProof(candidate.renderPath)) {
    return { ids: [], suspenseFallbackIds: [] };
  }
  const steps = candidate.renderPath?.steps ?? [];
  const limit = Math.min(candidate.rootStepIndex ?? steps.length - 1, steps.length - 1);
  const ids: string[] = [];
  const suspenseFallbackIds: string[] = [];
  for (let index = 0; index < limit; index += 1) {
    const child = steps[index];
    const owner = steps[index + 1];
    if (
      child?.invocation === undefined ||
      !['jsx', 'component-prop'].includes(child.invocation.mode) ||
      child.invocation.sourcePath === undefined ||
      owner === undefined ||
      path.normalize(child.invocation.sourcePath) !== path.normalize(owner.sourcePath) ||
      !Number.isSafeInteger(child.occurrenceStart) ||
      child.occurrenceStart <= 0
    )
      continue;
    const id = createPreviewJsxOccurrenceId(owner.sourcePath, child.occurrenceStart - 1);
    ids.push(id);
    if (child.invocation.mode === 'component-prop' && child.invocation.slotName === 'fallback')
      suspenseFallbackIds.push(id);
  }
  return {
    ids:
      ids.length > 0
        ? [...new Set(ids)]
        : candidate.edges
            .map((edge) => edge.occurrenceId)
            .filter((id): id is string => id !== undefined),
    suspenseFallbackIds,
  };
}

/** Leaves mixed imported-return/router-factory paths on their existing dedicated guidance lane. */
export function supportsPreviewJsxPathOccurrenceProof(
  renderPath: Parameters<typeof readPreviewJsxPathOccurrences>[0]['renderPath'],
): boolean {
  if (renderPath === undefined) return true;
  return renderPath.steps
    .slice(0, -1)
    .every(
      (step, index) =>
        step.invocation !== undefined &&
        ['jsx', 'component-prop'].includes(step.invocation.mode) &&
        step.invocation.sourcePath !== undefined &&
        path.normalize(step.invocation.sourcePath) ===
          path.normalize(renderPath.steps[index + 1]?.sourcePath ?? '') &&
        Number.isSafeInteger(step.occurrenceStart) &&
        step.occurrenceStart > 0,
    );
}

/** Returns only ordered JSX identities for consumers that do not need fallback-slot evidence. */
export function readPreviewJsxPathOccurrenceIds(
  candidate: Parameters<typeof readPreviewJsxPathOccurrences>[0],
): readonly string[] {
  return readPreviewJsxPathOccurrences(candidate).ids;
}
