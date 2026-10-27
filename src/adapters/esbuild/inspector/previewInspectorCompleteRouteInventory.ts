/** Coordinates CompleteRouteInventory using bounded authored-source evidence. */
import path from 'node:path';
import type { PreviewInspectorRouteSelectionStep } from '../../../domain/preview';
import {
  classifyBranch,
  compareObservedBranches,
  freezeOwner,
  inferBranchOwner,
  normalizeLimits,
} from './previewInspectorCompleteRouteBranches';
import type {
  CollectPreviewInspectorCompleteRouteInventoryOptions,
  ObservedBranch,
  PreviewInspectorCompleteRouteBaseEntry,
  PreviewInspectorCompleteRouteInventory,
  PreviewInspectorExactRouteReplayResult,
} from './previewInspectorCompleteRouteModel';
import {
  applyExactReplayDispositions,
  applyExecutionPlanDispositions,
  correlateExactReplay,
  enumerationPrefixCounters,
} from './previewInspectorCompleteRouteReplay';
import {
  isPreviewCompleteRouteInventoryTelemetryCheckpoint,
  PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_DIGEST,
  PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_VERSION,
} from './previewInspectorCompleteRouteTelemetry';
import {
  collectPreviewInspectorRouteBranchPlan,
  createPreviewInspectorRouteBranchSelectionPrefixProvider,
  createPreviewInspectorRouteOwnerLocationInventoryMemo,
} from './previewInspectorRouteBranchPlan';

/**
 * Expands every selectable branch sequentially until all leaves are classified or a limit is hit.
 */
export async function collectPreviewInspectorCompleteRouteInventory(
  options: CollectPreviewInspectorCompleteRouteInventoryOptions,
): Promise<PreviewInspectorCompleteRouteInventory> {
  const limits = normalizeLimits(options.limits);
  const rootOwner = freezeOwner(options.documentPath, options.exportName);
  const branches = new Map<string, ObservedBranch>();
  const dependencyPaths = new Set<string>([rootOwner.sourcePath]);
  const queuedSelections = new Set<string>();
  const queue: (readonly PreviewInspectorRouteSelectionStep[])[] = [];
  let analysisPasses = 0;
  let truncated = false;
  const ownerLocationInventoryMemo = createPreviewInspectorRouteOwnerLocationInventoryMemo({
    readSource: options.readSource,
    ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
    renderChain: options.renderChain,
    sourcePaths: options.sourcePaths,
  });
  const enumerationPrefixProvider = createPreviewInspectorRouteBranchSelectionPrefixProvider();

  try {
    options.telemetry?.emit({
      analysisPasses: 0,
      discoveredBranches: 0,
      ...enumerationPrefixCounters(enumerationPrefixProvider),
      phase: 'enumerate-branches',
      queuedSelections: 0,
      transition: 'start',
    });
    enqueue(Object.freeze([]));
    while (queue.length > 0) {
      if (analysisPasses >= limits.maximumAnalysisPasses) {
        truncated = true;
        break;
      }
      const selection = queue.shift();
      if (selection === undefined) break;
      analysisPasses += 1;
      const plan = await collectPreviewInspectorRouteBranchPlan({
        documentPath: rootOwner.sourcePath,
        exportName: rootOwner.exportName,
        ownerLocationInventoryMemo,
        readSource: options.readSource,
        ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
        renderChain: options.renderChain,
        selectionPrefixProvider: enumerationPrefixProvider,
        ...(selection.length === 0 ? {} : { selection }),
        sourcePaths: options.sourcePaths,
      });
      for (const dependencyPath of plan.dependencyPaths) {
        dependencyPaths.add(path.normalize(dependencyPath));
      }
      for (const branch of plan.branches) {
        const existing = branches.get(branch.id);
        if (existing === undefined) {
          if (branches.size >= limits.maximumBranches) {
            truncated = true;
            continue;
          }
          branches.set(branch.id, {
            branch,
            owner: inferBranchOwner(branch, plan.branches, branches, rootOwner),
          });
        } else if (
          branch.childState === 'expanded' ||
          (branch.childState === 'leaf' && existing.branch.childState === 'unknown')
        ) {
          existing.branch = branch;
        }
        if (
          branch.selectable === true &&
          branch.childState === 'unknown' &&
          branch.selectionPath.length <= limits.maximumDepth
        ) {
          enqueue(branch.selectionPath);
        } else if (
          branch.selectable === true &&
          branch.childState === 'unknown' &&
          branch.selectionPath.length > limits.maximumDepth
        ) {
          truncated = true;
        }
      }
      if (
        isPreviewCompleteRouteInventoryTelemetryCheckpoint(
          analysisPasses,
          limits.maximumAnalysisPasses,
        )
      ) {
        options.telemetry?.emit({
          analysisPasses,
          discoveredBranches: branches.size,
          ...enumerationPrefixCounters(enumerationPrefixProvider),
          phase: 'enumerate-branches',
          queuedSelections: queuedSelections.size,
          transition: 'checkpoint',
        });
      }
    }
    if (
      analysisPasses > 0 &&
      !isPreviewCompleteRouteInventoryTelemetryCheckpoint(
        analysisPasses,
        limits.maximumAnalysisPasses,
      )
    ) {
      options.telemetry?.emit({
        analysisPasses,
        discoveredBranches: branches.size,
        ...enumerationPrefixCounters(enumerationPrefixProvider),
        phase: 'enumerate-branches',
        queuedSelections: queuedSelections.size,
        transition: 'checkpoint',
      });
    }
    options.telemetry?.emit({
      analysisPasses,
      discoveredBranches: branches.size,
      ...enumerationPrefixCounters(enumerationPrefixProvider),
      phase: 'enumerate-branches',
      queuedSelections: queuedSelections.size,
      transition: 'complete',
    });
  } finally {
    enumerationPrefixProvider.release();
    ownerLocationInventoryMemo.release();
  }

  const ordered = [...branches.values()].sort(compareObservedBranches);
  const provisionalEntries = Object.freeze(
    ordered.map(({ branch, owner }) =>
      classifyBranch(branch, owner, ordered, rootOwner, truncated),
    ),
  );
  const replayOwnerLocationInventoryMemo = createPreviewInspectorRouteOwnerLocationInventoryMemo({
    readSource: options.readSource,
    ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
    renderChain: options.renderChain,
    sourcePaths: options.sourcePaths,
  });
  const replayPrefixProvider = createPreviewInspectorRouteBranchSelectionPrefixProvider();
  let replayed: Awaited<ReturnType<typeof applyExactReplayDispositions>>;
  try {
    replayed = await applyExactReplayDispositions(
      provisionalEntries,
      options,
      rootOwner,
      dependencyPaths,
      replayOwnerLocationInventoryMemo,
      replayPrefixProvider,
      options.telemetry,
    );
  } finally {
    replayPrefixProvider.release();
    replayOwnerLocationInventoryMemo.release();
  }
  const entries = await applyExecutionPlanDispositions(replayed.entries, options);
  options.telemetry?.emit({
    phase: 'finalize-inventory',
    transition: 'start',
  });
  const counts = Object.freeze({
    duplicate: entries.filter((entry) => entry.disposition === 'duplicate').length,
    runnable: entries.filter((entry) => entry.disposition === 'runnable').length,
    total: entries.length,
    unresolved: entries.filter((entry) => entry.disposition === 'unresolved').length,
  });
  const inventory = Object.freeze({
    analysisPasses,
    complete: !truncated,
    counts,
    dependencyPaths: Object.freeze([...dependencyPaths].sort()),
    entries,
    limits,
    owner: rootOwner,
    predecessorVersion: 3 as const,
    replayPasses: replayed.replayPasses,
    replayPolicy: Object.freeze({
      digest: PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_DIGEST,
      predecessorVersion: 3 as const,
      version: PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_VERSION,
    }),
    truncated,
    version: 4 as const,
  });
  options.telemetry?.emit({
    phase: 'finalize-inventory',
    transition: 'complete',
  });
  return inventory;

  /** Enqueues one public selection exactly once in stable breadth-first order. */
  function enqueue(selection: readonly PreviewInspectorRouteSelectionStep[]): void {
    const frozen = Object.freeze(
      selection.map((step) =>
        Object.freeze({ componentName: step.componentName, pattern: step.pattern }),
      ),
    );
    const identity = JSON.stringify(frozen);
    if (queuedSelections.has(identity)) return;
    queuedSelections.add(identity);
    queue.push(frozen);
  }
}

/**
 * Replays one frozen runnable entry with the same inert compiler inputs used by inventory analysis.
 */
export async function replayPreviewInspectorCompleteRouteEntry(
  options: Omit<CollectPreviewInspectorCompleteRouteInventoryOptions, 'prepareExecutionPlan'>,
  entry: PreviewInspectorCompleteRouteBaseEntry,
): Promise<PreviewInspectorExactRouteReplayResult> {
  const rootOwner = freezeOwner(options.documentPath, options.exportName);
  const plan = await collectPreviewInspectorRouteBranchPlan({
    documentPath: rootOwner.sourcePath,
    exportName: rootOwner.exportName,
    readSource: options.readSource,
    ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
    renderChain: options.renderChain,
    selection: entry.selection,
    sourcePaths: options.sourcePaths,
  });
  return correlateExactReplay(entry, plan, rootOwner);
}
export type {
  CollectPreviewInspectorCompleteRouteInventoryOptions,
  PreviewCompleteRouteInventoryExecutionProgress,
  PreviewCompleteRouteInventoryTelemetryEmitter,
  PreviewCompleteRouteInventoryTelemetryEvent,
  PreviewCompleteRouteInventoryTelemetryEventDraft,
  PreviewCompleteRouteInventoryTelemetryObserver,
  PreviewCompleteRouteInventoryTelemetryPhase,
  PreviewCompleteRouteInventoryTelemetryTransition,
  PreviewInspectorCompleteDuplicateRoute,
  PreviewInspectorCompleteRouteBaseEntry,
  PreviewInspectorCompleteRouteCounts,
  PreviewInspectorCompleteRouteEntry,
  PreviewInspectorCompleteRouteInventory,
  PreviewInspectorCompleteRouteInventoryLimits,
  PreviewInspectorCompleteRouteOwner,
  PreviewInspectorCompleteRouteUnresolvedReason,
  PreviewInspectorCompleteRunnableRoute,
  PreviewInspectorCompleteUnresolvedRoute,
  PreviewInspectorExactRouteReplay,
  PreviewInspectorExactRouteReplayResult,
  PreviewInspectorPlanlessRunnableRoute,
} from './previewInspectorCompleteRouteModel';
export {
  createPreviewCompleteRouteInventoryTelemetryEmitter,
  isPreviewCompleteRouteInventoryExecutionTelemetryCheckpoint,
  isPreviewCompleteRouteInventoryTelemetryCheckpoint,
  PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_COMPUTED_MAXIMUM_EVENTS,
  PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_MAXIMUM_EVENTS,
  PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_POLICY,
  PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_POLICY_DIGEST,
  PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_POLICY_VERSION,
  PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_DIGEST,
  PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_VERSION,
  PreviewCompleteRouteInventoryTelemetryOverflowError,
} from './previewInspectorCompleteRouteTelemetry';
