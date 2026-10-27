/** Classifies and orders bounded route branches while detecting owner cycles. */
import path from 'node:path';
import type { PreviewInspectorRouteSelectionStep } from '../../../domain/preview';
import {
  type ObservedBranch,
  type PreviewInspectorCompleteRouteBaseEntry,
  type PreviewInspectorCompleteRouteInventoryLimits,
  type PreviewInspectorCompleteRouteOwner,
  type PreviewInspectorProvisionalRouteEntry,
  DEFAULT_MAXIMUM_ANALYSIS_PASSES,
  DEFAULT_MAXIMUM_BRANCHES,
  DEFAULT_MAXIMUM_DEPTH,
} from './previewInspectorCompleteRouteModel';
import { type PreviewInspectorRouteBranch } from './previewInspectorRouteBranchPlan';
import { collectPreviewInspectorRouteParameterValues } from './previewInspectorRoutePattern';

/** Retains only immutable route facts when a provisional route is demoted. */
export function freezeUnresolvedBase(
  entry: PreviewInspectorCompleteRouteBaseEntry,
): PreviewInspectorCompleteRouteBaseEntry {
  return Object.freeze({
    id: entry.id,
    componentName: entry.componentName,
    ...(entry.exportName === undefined ? {} : { exportName: entry.exportName }),
    owner: entry.owner,
    parameters: entry.parameters,
    pathname: entry.pathname,
    pattern: entry.pattern,
    selection: entry.selection,
    ...(entry.sourcePath === undefined ? {} : { sourcePath: entry.sourcePath }),
  });
}

/** Freezes one public route selection without parser-owned data. */
export function freezeSelection(
  selection: readonly PreviewInspectorRouteSelectionStep[],
): readonly PreviewInspectorRouteSelectionStep[] {
  return Object.freeze(
    selection.map((step) =>
      Object.freeze({ componentName: step.componentName, pattern: step.pattern }),
    ),
  );
}

/** Compares complete route selections in authored order. */
export function sameSelection(
  left: readonly PreviewInspectorRouteSelectionStep[],
  right: readonly PreviewInspectorRouteSelectionStep[],
): boolean {
  return (
    left.length === right.length &&
    left.every((step, index) => {
      const counterpart = right.at(index);
      return (
        step.componentName === counterpart?.componentName && step.pattern === counterpart.pattern
      );
    })
  );
}

/** Compares normalized source/export owner identities. */
export function sameOwner(
  left: PreviewInspectorCompleteRouteOwner,
  right: PreviewInspectorCompleteRouteOwner,
): boolean {
  return (
    left.exportName === right.exportName &&
    path.normalize(left.sourcePath) === path.normalize(right.sourcePath)
  );
}

/** Compares deterministic route parameter records. */
export function sameRecord(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

/** Attributes a nested choice to the component selected directly above its depth. */
export function inferBranchOwner(
  branch: PreviewInspectorRouteBranch,
  currentBranches: readonly PreviewInspectorRouteBranch[],
  observed: ReadonlyMap<string, ObservedBranch>,
  rootOwner: PreviewInspectorCompleteRouteOwner,
): PreviewInspectorCompleteRouteOwner {
  if (branch.depth === 0 || branch.parentId === undefined) return rootOwner;
  const parent = currentBranches.find((candidate) => candidate.id === branch.parentId);
  const previousParent = observed.get(branch.parentId)?.branch;
  const ownerBranch = parent ?? previousParent;
  return ownerBranch?.sourcePath === undefined
    ? rootOwner
    : freezeOwner(ownerBranch.sourcePath, ownerBranch.exportName ?? 'default');
}

/** Converts branch-planner states to the campaign's exhaustive accounting categories. */
export function classifyBranch(
  branch: PreviewInspectorRouteBranch,
  owner: PreviewInspectorCompleteRouteOwner,
  observed: readonly ObservedBranch[],
  rootOwner: PreviewInspectorCompleteRouteOwner,
  traversalTruncated: boolean,
): PreviewInspectorProvisionalRouteEntry {
  const base = freezeBaseEntry(branch, owner);
  if (branch.duplicateOf !== undefined) {
    return Object.freeze({
      ...base,
      disposition: 'duplicate' as const,
      duplicateOf: branch.duplicateOf,
      reason: 'exact-semantic-route' as const,
    });
  }
  if (branch.childState === 'expanded') {
    const descendant = observed
      .map((item) => item.branch)
      .filter(
        (candidate) =>
          candidate.id !== branch.id &&
          candidate.childState === 'leaf' &&
          selectionStartsWith(candidate.selectionPath, branch.selectionPath),
      )
      .sort(compareBranches)[0];
    if (descendant !== undefined) {
      return Object.freeze({
        ...base,
        disposition: 'duplicate' as const,
        duplicateOf: descendant.id,
        reason: 'expanded-owner' as const,
      });
    }
  }
  const availability = branch.availability;
  if (availability !== undefined) {
    return Object.freeze({
      ...base,
      disposition: 'unresolved' as const,
      reason: availability,
    });
  }
  if (branch.childState === 'leaf' && branch.sourcePath !== undefined) {
    return Object.freeze({ ...base, disposition: 'runnable' as const });
  }
  return Object.freeze({
    ...base,
    disposition: 'unresolved' as const,
    reason:
      traversalTruncated && branch.childState === 'unknown'
        ? 'analysis-limit'
        : branch.sourcePath === undefined
          ? 'component-unresolved'
          : branchCreatesOwnerCycle(branch, observed, rootOwner)
            ? 'cyclic-owner'
            : 'nested-owner-unproven',
  });
}

/** Preserves the exact compiler selection while deriving deterministic parameter evidence. */
export function freezeBaseEntry(
  branch: PreviewInspectorRouteBranch,
  owner: PreviewInspectorCompleteRouteOwner,
): PreviewInspectorCompleteRouteBaseEntry {
  return Object.freeze({
    id: branch.id,
    componentName: branch.componentName,
    ...(branch.exportName === undefined ? {} : { exportName: branch.exportName }),
    owner,
    parameters: collectPreviewInspectorRouteParameterValues(branch.pattern, branch.pathname),
    pathname: branch.pathname,
    pattern: branch.pattern,
    selection: Object.freeze(
      branch.selectionPath.map((step) =>
        Object.freeze({ componentName: step.componentName, pattern: step.pattern }),
      ),
    ),
    ...(branch.sourcePath === undefined ? {} : { sourcePath: path.normalize(branch.sourcePath) }),
  });
}

/** Detects only exact owner identity repetition; no source is evaluated to guess recursion. */
export function branchCreatesOwnerCycle(
  branch: PreviewInspectorRouteBranch,
  observed: readonly ObservedBranch[],
  rootOwner: PreviewInspectorCompleteRouteOwner,
): boolean {
  if (branch.sourcePath === undefined) return false;
  const sourcePath = path.normalize(branch.sourcePath);
  if (sourcePath === rootOwner.sourcePath) return true;
  return observed.some(
    (candidate) =>
      candidate.branch.id !== branch.id &&
      candidate.branch.sourcePath !== undefined &&
      path.normalize(candidate.branch.sourcePath) === sourcePath &&
      selectionStartsWith(branch.selectionPath, candidate.branch.selectionPath),
  );
}

/** Detects whether a deeper selection extends one already observed owner selection. */
export function selectionStartsWith(
  candidate: readonly PreviewInspectorRouteSelectionStep[],
  prefix: readonly PreviewInspectorRouteSelectionStep[],
): boolean {
  return (
    candidate.length > prefix.length &&
    prefix.every((step, index) => {
      const counterpart = candidate.at(index);
      return (
        step.componentName === counterpart?.componentName && step.pattern === counterpart.pattern
      );
    })
  );
}

/** Orders observed branches by their immutable public branch identity. */
export function compareObservedBranches(left: ObservedBranch, right: ObservedBranch): number {
  return compareBranches(left.branch, right.branch);
}

/** Orders branches by depth, pattern, component, and stable identifier. */
export function compareBranches(
  left: PreviewInspectorRouteBranch,
  right: PreviewInspectorRouteBranch,
): number {
  return (
    left.selectionPath.length - right.selectionPath.length ||
    left.pattern.localeCompare(right.pattern) ||
    left.componentName.localeCompare(right.componentName) ||
    left.id.localeCompare(right.id)
  );
}

/** Freezes one normalized route owner. */
export function freezeOwner(
  sourcePath: string,
  exportName: string,
): PreviewInspectorCompleteRouteOwner {
  return Object.freeze({ exportName, sourcePath: path.normalize(sourcePath) });
}

/** Applies safe positive inventory bounds to every analysis dimension. */
export function normalizeLimits(
  limits: Partial<PreviewInspectorCompleteRouteInventoryLimits> | undefined,
): PreviewInspectorCompleteRouteInventoryLimits {
  return Object.freeze({
    maximumAnalysisPasses: normalizeLimit(
      limits?.maximumAnalysisPasses,
      DEFAULT_MAXIMUM_ANALYSIS_PASSES,
    ),
    maximumBranches: normalizeLimit(limits?.maximumBranches, DEFAULT_MAXIMUM_BRANCHES),
    maximumDepth: normalizeLimit(limits?.maximumDepth, DEFAULT_MAXIMUM_DEPTH),
  });
}

/** Normalizes one optional positive safe-integer bound. */
export function normalizeLimit(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isSafeInteger(value) || value < 1 ? fallback : value;
}
