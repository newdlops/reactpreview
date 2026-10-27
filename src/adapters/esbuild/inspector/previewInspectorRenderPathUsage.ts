/** Joins render-graph tag offsets to parent-slice openings without reranking unrelated callers. */
import path from 'node:path';
import type { PreviewRenderChainCandidate } from '../renderGraph';
import type { InspectorUsageCandidate } from './previewInspectorAncestorModel';
import type { PreviewInspectorComponentReference } from './previewInspectorAncestorTypes';

/** Exact next usage retained by the current immutable render corridor. */
export interface PreviewInspectorRenderPathUsage {
  /** Authored module containing the child invocation. */
  readonly consumerPath: string;
  /** Next inner-to-outer step after this usage, never an earlier same-module step. */
  readonly nextStepIndex: number;
  /** UTF-16 source offset emitted by the render graph, usually the JSX tag identifier. */
  readonly occurrenceStart: number;
}

/** Reads one next usage, leaving unsupported value-flow transitions on the existing fallback. */
export function readPreviewInspectorRenderPathUsage(
  renderPath: PreviewRenderChainCandidate | undefined,
  currentRoot: PreviewInspectorComponentReference,
  aliases: readonly string[],
  cursor: number,
): PreviewInspectorRenderPathUsage | undefined {
  const steps = renderPath?.steps ?? [];
  for (let index = cursor; index + 1 < steps.length; index += 1) {
    const child = steps[index];
    const owner = steps[index + 1];
    if (
      child === undefined ||
      owner === undefined ||
      path.normalize(child.sourcePath) !== path.normalize(currentRoot.sourcePath) ||
      !Number.isSafeInteger(child.occurrenceStart) ||
      child.occurrenceStart < 0
    )
      continue;
    const label = child.label.replace(/ \(default\)$/u, '');
    if (
      currentRoot.exportName !== 'default' &&
      currentRoot.exportName !== label &&
      !aliases.includes(label)
    )
      continue;
    return {
      consumerPath: owner.sourcePath,
      nextStepIndex: index + 1,
      occurrenceStart: child.occurrenceStart,
    };
  }
  return undefined;
}

/** Accepts only the same parsed JSX occurrence, accounting for its opening '<' token. */
export function matchesPreviewInspectorRenderPathUsage(
  candidate: InspectorUsageCandidate,
  usage: Pick<PreviewInspectorRenderPathUsage, 'consumerPath' | 'occurrenceStart'>,
): boolean {
  if (path.normalize(candidate.slice.consumerPath) !== path.normalize(usage.consumerPath))
    return false;
  const opening = candidate.slice.occurrenceStart;
  return (
    opening === usage.occurrenceStart ||
    (opening + 1 === usage.occurrenceStart && candidate.sourceText[opening] === '<')
  );
}
