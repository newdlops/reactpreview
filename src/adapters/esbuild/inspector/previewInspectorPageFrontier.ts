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
export type PreviewInspectorPageFrontierDisposition = 'accepted-unbounded' | 'rejected-structural';

export interface PreparePreviewInspectorPageExecutionSelectionOptions {
  readonly runtimeCompanionSourcePaths?: readonly string[];
  readonly candidates: readonly PreviewInspectorPageExecutionCandidate[];
  readonly plan: PreviewInspectorAncestorPlan;
  readonly policy: PreviewCompilerFrontierPolicy;
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly resolveModule: (specifier: string, importer: string) => string | undefined;
  readonly workspaceRoot: string;
}

export interface PreparedPreviewInspectorPageExecutionSelection {
  readonly kind: 'selected';
  readonly disposition: 'accepted-unbounded';
  readonly executionPlan: PreviewInspectorPageExecutionPlan;
  readonly prepared: PreparedPreviewInspectorBundleFrontier;
}

/** Retains the smallest invalid candidate so terminal diagnostics include real frontier counters. */
export interface RejectedPreviewInspectorPageExecutionSelection {
  readonly candidate: PreviewInspectorPageExecutionCandidate;
  readonly disposition: 'rejected-structural';
  readonly kind: 'rejected';
  readonly prepared: PreparedPreviewInspectorBundleFrontier;
}

export type PreviewInspectorPageExecutionSelection =
  PreparedPreviewInspectorPageExecutionSelection | RejectedPreviewInspectorPageExecutionSelection;

/** Returns every route/page candidate; framework recipes are composed by Page Execution. */
export function createEligiblePreviewInspectorPageExecutionCandidates(
  plan: PreviewInspectorAncestorPlan,
  selectedPageCandidateId: string | undefined,
  selectedExecutionCandidateId?: string,
): readonly PreviewInspectorPageExecutionCandidate[] {
  const candidates = createPreviewInspectorPageExecutionCandidates({
    plan,
    ...(selectedPageCandidateId === undefined ? {} : { selectedPageCandidateId }),
  });
  if (selectedExecutionCandidateId === undefined) return candidates;
  const requested = candidates.filter((candidate) => candidate.id === selectedExecutionCandidateId);
  // Candidate ids include the frozen source/frontier identity and legitimately go stale after an
  // edit.  A stale retry must degrade to deterministic automatic selection, never masquerade as
  // an empty candidate failure.
  return requested.length === 0 ? candidates : requested;
}

/** Probes the ordered candidate list; filesystem timing never affects the tie-break. */
export async function preparePreviewInspectorPageExecutionSelection(
  options: PreparePreviewInspectorPageExecutionSelectionOptions,
): Promise<PreviewInspectorPageExecutionSelection | undefined> {
  const sourceTextByPath = new Map<string, Promise<string | undefined>>();
  const readSharedSource = (sourcePath: string): Promise<string | undefined> => {
    const cached = sourceTextByPath.get(sourcePath);
    if (cached !== undefined) return cached;
    const read = options.readSource(sourcePath);
    sourceTextByPath.set(sourcePath, read);
    return read;
  };
  const probes: {
    candidate: PreviewInspectorPageExecutionCandidate;
    disposition: PreviewInspectorPageFrontierDisposition;
    prepared: PreparedPreviewInspectorBundleFrontier;
  }[] = [];
  for (const candidate of options.candidates) {
    const prepared = await preparePreviewInspectorBundleFrontier({
      ...(options.runtimeCompanionSourcePaths === undefined
        ? {}
        : { runtimeCompanionSourcePaths: options.runtimeCompanionSourcePaths }),
      executionCandidate: candidate,
      plan: options.plan,
      policy: options.policy,
      readSource: readSharedSource,
      resolveModule: options.resolveModule,
      workspaceRoot: options.workspaceRoot,
    });
    probes.push({
      candidate,
      disposition: prepared.rejected ? 'rejected-structural' : 'accepted-unbounded',
      prepared,
    });
  }
  const selected = probes
    .filter((probe) => probe.disposition === 'accepted-unbounded')
    .sort(compareProbe)[0];
  if (selected === undefined) {
    const rejected = [...probes].sort(compareRejectedProbe)[0];
    if (rejected === undefined) return undefined;
    return Object.freeze({
      candidate: rejected.candidate,
      disposition: 'rejected-structural',
      kind: 'rejected',
      prepared: rejected.prepared,
    });
  }
  const alternatives = probes.map((probe) => ({
    candidateId: probe.candidate.id,
    fidelity: probe.candidate.fidelity,
    ...(probe.disposition === 'rejected-structural'
      ? { reason: probe.prepared.frontier.summary.truncationReasons[0] ?? 'rejected-structural' }
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
    disposition: 'accepted-unbounded',
    executionPlan,
    kind: 'selected',
    prepared: selected.prepared,
  });
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

/** Chooses the most compact rejected candidate for terminal telemetry. */
function compareRejectedProbe(
  left: {
    candidate: PreviewInspectorPageExecutionCandidate;
    prepared: PreparedPreviewInspectorBundleFrontier;
  },
  right: {
    candidate: PreviewInspectorPageExecutionCandidate;
    prepared: PreparedPreviewInspectorBundleFrontier;
  },
): number {
  return (
    left.prepared.frontier.summary.totalAuthoredModuleCount -
      right.prepared.frontier.summary.totalAuthoredModuleCount ||
    left.prepared.frontier.summary.authoredEdgeCount -
      right.prepared.frontier.summary.authoredEdgeCount ||
    fidelityPriority(left.candidate.fidelity) - fidelityPriority(right.candidate.fidelity) ||
    left.candidate.id.localeCompare(right.candidate.id)
  );
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
