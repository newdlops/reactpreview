/* eslint-disable jsdoc/require-jsdoc */
/** Selects the highest-fidelity Page Execution candidate admitted by Frontier v2. */
import { createHash } from 'node:crypto';
import type { PreviewCompilerFrontierPolicy } from '../../../domain/previewCompilerFrontier';
import {
  preparePreviewInspectorBundleFrontier,
  type PreparedPreviewInspectorBundleFrontier,
} from './previewInspectorBundleFrontier';
import type { PreviewInspectorAncestorPlan } from './previewInspectorAncestorPlan';
import { createPreviewInspectorPageExecutionCandidates } from './previewInspectorPageExecutionCandidates';
import type {
  PreviewInspectorPageExecutionCandidate,
  PreviewInspectorPageExecutionPlan,
  PreviewInspectorPageFidelity,
} from './previewInspectorPageExecutionTypes';

export type PreviewInspectorFrontierSourceKind =
  'critical-surface' | 'critical-support' | 'optional-surface' | 'optional-support';
export type PreviewInspectorPageFrontierDisposition =
  'accepted-soft' | 'accepted-hard' | 'rejected-hard';

export interface PreparePreviewInspectorPageExecutionSelectionOptions {
  readonly additionalCriticalSourcePaths?: readonly string[];
  readonly candidates: readonly PreviewInspectorPageExecutionCandidate[];
  readonly plan: PreviewInspectorAncestorPlan;
  readonly policy: PreviewCompilerFrontierPolicy;
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly resolveModule: (specifier: string, importer: string) => string | undefined;
  readonly workspaceRoot: string;
}

export interface PreparedPreviewInspectorPageExecutionSelection {
  readonly disposition: PreviewInspectorPageFrontierDisposition;
  readonly executionPlan: PreviewInspectorPageExecutionPlan;
  readonly prepared: PreparedPreviewInspectorBundleFrontier;
}

/** Returns every bounded route/page candidate; framework recipes are composed by Page Execution. */
export function createEligiblePreviewInspectorPageExecutionCandidates(
  plan: PreviewInspectorAncestorPlan,
  selectedPageCandidateId: string | undefined,
  selectedExecutionCandidateId?: string,
): readonly PreviewInspectorPageExecutionCandidate[] {
  const candidates = createPreviewInspectorPageExecutionCandidates({
    plan,
    ...(selectedPageCandidateId === undefined ? {} : { selectedPageCandidateId }),
  });
  return selectedExecutionCandidateId === undefined
    ? candidates
    : candidates.filter((candidate) => candidate.id === selectedExecutionCandidateId);
}

/** Probes a bounded ordered candidate list; filesystem timing never affects the tie-break. */
export async function preparePreviewInspectorPageExecutionSelection(
  options: PreparePreviewInspectorPageExecutionSelectionOptions,
): Promise<PreparedPreviewInspectorPageExecutionSelection | undefined> {
  const maximum = options.policy.mode === 'fast' ? 8 : 12;
  const probes: {
    candidate: PreviewInspectorPageExecutionCandidate;
    disposition: PreviewInspectorPageFrontierDisposition;
    prepared: PreparedPreviewInspectorBundleFrontier;
  }[] = [];
  for (const candidate of options.candidates.slice(0, maximum)) {
    const prepared = await preparePreviewInspectorBundleFrontier({
      ...(options.additionalCriticalSourcePaths === undefined
        ? {}
        : { additionalCriticalSourcePaths: options.additionalCriticalSourcePaths }),
      executionCandidate: candidate,
      plan: options.plan,
      policy: options.policy,
      readSource: options.readSource,
      resolveModule: options.resolveModule,
      workspaceRoot: options.workspaceRoot,
    });
    probes.push({
      candidate,
      disposition: prepared.rejected ? 'rejected-hard' : readDisposition(prepared, options.policy),
      prepared,
    });
  }
  const selected =
    selectHighestFidelity(probes, 'accepted-soft') ??
    selectHighestFidelity(probes, 'accepted-hard');
  if (selected === undefined) return undefined;
  const alternatives = probes.map((probe) => ({
    candidateId: probe.candidate.id,
    fidelity: probe.candidate.fidelity,
    ...(probe.disposition === 'rejected-hard'
      ? { reason: probe.prepared.frontier.summary.truncationReasons[0] ?? 'rejected-hard' }
      : {}),
  }));
  const executionPlan: PreviewInspectorPageExecutionPlan = Object.freeze({
    alternatives: Object.freeze(alternatives),
    browserCandidateId: selected.candidate.browserCandidate.id,
    candidate: selected.candidate,
    descriptorPlan: options.plan,
    executionIdentity: createExecutionIdentity(
      selected.candidate,
      selected.prepared.frontier.identity,
    ),
    frontier: selected.prepared.frontier,
    version: 2,
  });
  return Object.freeze({
    disposition: selected.disposition,
    executionPlan,
    prepared: selected.prepared,
  });
}

function readDisposition(
  prepared: PreparedPreviewInspectorBundleFrontier,
  policy: PreviewCompilerFrontierPolicy,
): PreviewInspectorPageFrontierDisposition {
  const summary = prepared.frontier.summary;
  return summary.totalAuthoredModuleCount <= policy.softMaximumTotalAuthoredModuleCount &&
    summary.exactModuleCount <= policy.softMaximumExactModuleCount &&
    summary.authoredEdgeCount <= policy.softMaximumAuthoredImportEdgeCount &&
    summary.sourceBytes <= policy.softMaximumTotalSourceBytes
    ? 'accepted-soft'
    : 'accepted-hard';
}

function compareProbe(
  left: {
    candidate: PreviewInspectorPageExecutionCandidate;
    disposition: PreviewInspectorPageFrontierDisposition;
    prepared: PreparedPreviewInspectorBundleFrontier;
  },
  right: {
    candidate: PreviewInspectorPageExecutionCandidate;
    disposition: PreviewInspectorPageFrontierDisposition;
    prepared: PreparedPreviewInspectorBundleFrontier;
  },
): number {
  return (
    fidelityPriority(left.candidate.fidelity) - fidelityPriority(right.candidate.fidelity) ||
    left.prepared.frontier.summary.totalAuthoredModuleCount -
      right.prepared.frontier.summary.totalAuthoredModuleCount ||
    left.prepared.frontier.summary.authoredEdgeCount -
      right.prepared.frontier.summary.authoredEdgeCount ||
    left.candidate.id.localeCompare(right.candidate.id)
  );
}

/** Applies the documented two-pass policy: soft envelope first, then hard compatibility. */
function selectHighestFidelity(
  probes: readonly {
    candidate: PreviewInspectorPageExecutionCandidate;
    disposition: PreviewInspectorPageFrontierDisposition;
    prepared: PreparedPreviewInspectorBundleFrontier;
  }[],
  disposition: Extract<PreviewInspectorPageFrontierDisposition, 'accepted-soft' | 'accepted-hard'>,
):
  | {
      candidate: PreviewInspectorPageExecutionCandidate;
      disposition: PreviewInspectorPageFrontierDisposition;
      prepared: PreparedPreviewInspectorBundleFrontier;
    }
  | undefined {
  return probes.filter((probe) => probe.disposition === disposition).sort(compareProbe)[0];
}
function fidelityPriority(value: PreviewInspectorPageFidelity): number {
  return [
    'route-page-authentic',
    'route-page-sliced',
    'page-authentic',
    'page-sliced',
    'target-contextual',
    'target-only',
  ].indexOf(value);
}
function createExecutionIdentity(
  candidate: PreviewInspectorPageExecutionCandidate,
  frontierIdentity: string,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ candidate, frontierIdentity, version: 2 }))
    .digest('hex');
}
