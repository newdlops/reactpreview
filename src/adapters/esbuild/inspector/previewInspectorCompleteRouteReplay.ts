/** Correlates exact replay identities and execution plans against frozen inventory rows. */
import path from 'node:path';
import type { PreviewInspectorRouteSelectionStep } from '../../../domain/preview';
import {
  freezeOwner,
  freezeSelection,
  freezeUnresolvedBase,
  sameOwner,
  sameRecord,
  sameSelection,
} from './previewInspectorCompleteRouteBranches';
import type {
  CollectPreviewInspectorCompleteRouteInventoryOptions,
  PreviewCompleteRouteInventoryTelemetryEmitter,
  PreviewCompleteRouteInventoryTelemetryEvent,
  PreviewInspectorCompleteRouteBaseEntry,
  PreviewInspectorCompleteRouteEntry,
  PreviewInspectorCompleteRouteOwner,
  PreviewInspectorExactReplayedRouteEntry,
  PreviewInspectorExactRouteReplay,
  PreviewInspectorExactRouteReplayResult,
  PreviewInspectorPlanlessRunnableRoute,
  PreviewInspectorProvisionalRouteEntry,
} from './previewInspectorCompleteRouteModel';
import {
  isPreviewCompleteRouteInventoryTelemetryCheckpoint,
  PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_DIGEST,
} from './previewInspectorCompleteRouteTelemetry';
import { createPreviewInspectorRouteBranchId } from './previewInspectorRouteBranchIdentity';
import {
  collectPreviewInspectorRouteBranchPlan,
  createPreviewInspectorRouteBranchSelectionPrefixProvider,
  type PreviewInspectorRouteBranchPlan,
  type PreviewInspectorRouteOwnerLocationInventoryMemo,
} from './previewInspectorRouteBranchPlan';
import { collectPreviewInspectorRouteParameterValues } from './previewInspectorRoutePattern';

/** Replays every provisional runnable and demotes any identity that is not exact. */
export async function applyExactReplayDispositions(
  provisionalEntries: readonly PreviewInspectorProvisionalRouteEntry[],
  options: CollectPreviewInspectorCompleteRouteInventoryOptions,
  rootOwner: PreviewInspectorCompleteRouteOwner,
  dependencyPaths: Set<string>,
  ownerLocationInventoryMemo: PreviewInspectorRouteOwnerLocationInventoryMemo,
  prefixProvider: ReturnType<typeof createPreviewInspectorRouteBranchSelectionPrefixProvider>,
  telemetry: PreviewCompleteRouteInventoryTelemetryEmitter | undefined,
): Promise<{
  readonly entries: readonly PreviewInspectorExactReplayedRouteEntry[];
  readonly replayPasses: number;
}> {
  const exactRunnables = new Map<string, PreviewInspectorPlanlessRunnableRoute>();
  const replacements = new Map<string, PreviewInspectorExactReplayedRouteEntry>();
  let replayPasses = 0;
  const replayTotal = provisionalEntries.filter(
    (entry) => entry.disposition === 'runnable' || entry.disposition === 'duplicate',
  ).length;
  telemetry?.emit({
    phase: 'replay-branches',
    ...replayPrefixCounters(prefixProvider),
    replayCompleted: 0,
    replayTotal,
    transition: 'start',
  });
  for (const entry of provisionalEntries) {
    if (entry.disposition !== 'runnable') continue;
    replayPasses += 1;
    const plan = await collectReplayPlan(
      options,
      rootOwner,
      entry.selection,
      ownerLocationInventoryMemo,
      prefixProvider,
    );
    collectReplayDependencies(plan, dependencyPaths);
    const result = correlateExactReplay(entry, plan, rootOwner);
    if (result.exact) {
      const runnable = Object.freeze({
        ...entry,
        replay: result.replay,
      }) satisfies PreviewInspectorPlanlessRunnableRoute;
      exactRunnables.set(entry.id, runnable);
      replacements.set(entry.id, runnable);
    } else {
      replacements.set(
        entry.id,
        Object.freeze({
          ...freezeUnresolvedBase(entry),
          disposition: 'unresolved' as const,
          reason: result.reason,
        }),
      );
    }
    emitReplayCheckpoint();
  }
  for (const entry of provisionalEntries) {
    if (entry.disposition !== 'duplicate') continue;
    replayPasses += 1;
    const plan = await collectReplayPlan(
      options,
      rootOwner,
      entry.selection,
      ownerLocationInventoryMemo,
      prefixProvider,
    );
    collectReplayDependencies(plan, dependencyPaths);
    const target =
      plan.selectionResolution === 'exact' && plan.selectedBranchId !== undefined
        ? exactRunnables.get(plan.selectedBranchId)
        : undefined;
    if (target !== undefined) {
      const targetReplay = correlateExactReplay(target, plan, rootOwner);
      if (targetReplay.exact) {
        replacements.set(
          entry.id,
          Object.freeze({
            ...entry,
            duplicateOf: target.id,
            replay: targetReplay.replay,
          }),
        );
        emitReplayCheckpoint();
        continue;
      }
    }
    replacements.set(
      entry.id,
      Object.freeze({
        ...freezeUnresolvedBase(entry),
        disposition: 'unresolved' as const,
        reason: 'exact-replay-target-unavailable' as const,
      }),
    );
    emitReplayCheckpoint();
  }
  const result = Object.freeze({
    entries: Object.freeze(
      provisionalEntries.map((entry): PreviewInspectorExactReplayedRouteEntry => {
        const replacement = replacements.get(entry.id);
        if (replacement !== undefined) return replacement;
        if (entry.disposition === 'unresolved') return entry;
        throw new Error(`Exact route replay did not classify provisional branch: ${entry.id}`);
      }),
    ),
    replayPasses,
  });
  telemetry?.emit({
    phase: 'replay-branches',
    ...replayPrefixCounters(prefixProvider),
    replayCompleted: replayPasses,
    replayTotal,
    transition: 'complete',
  });
  return result;

  /** Emits one replay checkpoint without changing replay ordering or classification. */
  function emitReplayCheckpoint(): void {
    if (!isPreviewCompleteRouteInventoryTelemetryCheckpoint(replayPasses, replayTotal)) return;
    telemetry?.emit({
      phase: 'replay-branches',
      ...replayPrefixCounters(prefixProvider),
      replayCompleted: replayPasses,
      replayTotal,
      transition: 'checkpoint',
    });
  }
}

/** Promotes only routes proven by the real fast compiler planner; failures remain accounted. */
export async function applyExecutionPlanDispositions(
  replayedEntries: readonly PreviewInspectorExactReplayedRouteEntry[],
  options: CollectPreviewInspectorCompleteRouteInventoryOptions,
): Promise<readonly PreviewInspectorCompleteRouteEntry[]> {
  const entries: PreviewInspectorCompleteRouteEntry[] = [];
  const executionPlanTotal = replayedEntries.filter(
    (entry) => entry.disposition === 'runnable',
  ).length;
  let routeOrdinal = 0;
  for (const entry of replayedEntries) {
    if (entry.disposition !== 'runnable') {
      entries.push(entry);
      continue;
    }
    routeOrdinal += 1;
    const executionPlan = await options.prepareExecutionPlan(
      entry,
      Object.freeze({ routeOrdinal, total: executionPlanTotal }),
    );
    if (executionPlan === undefined) {
      entries.push(
        Object.freeze({
          ...freezeUnresolvedBase(entry),
          disposition: 'unresolved' as const,
          reason: 'execution-plan-unavailable' as const,
        }),
      );
      continue;
    }
    entries.push(
      Object.freeze({
        ...entry,
        executionPlan,
      }),
    );
  }
  return Object.freeze(entries);
}

/** Collects one inert branch plan for an exact public route selection. */
export async function collectReplayPlan(
  options: CollectPreviewInspectorCompleteRouteInventoryOptions,
  rootOwner: PreviewInspectorCompleteRouteOwner,
  selection: readonly PreviewInspectorRouteSelectionStep[],
  ownerLocationInventoryMemo: PreviewInspectorRouteOwnerLocationInventoryMemo,
  selectionPrefixProvider: ReturnType<
    typeof createPreviewInspectorRouteBranchSelectionPrefixProvider
  >,
): Promise<PreviewInspectorRouteBranchPlan> {
  return collectPreviewInspectorRouteBranchPlan({
    documentPath: rootOwner.sourcePath,
    exportName: rootOwner.exportName,
    ownerLocationInventoryMemo,
    readSource: options.readSource,
    ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
    renderChain: options.renderChain,
    selection,
    selectionPrefixProvider,
    sourcePaths: options.sourcePaths,
  });
}

/** Captures phase-local enumeration statistics immediately before one telemetry emission. */
export function enumerationPrefixCounters(
  provider: ReturnType<typeof createPreviewInspectorRouteBranchSelectionPrefixProvider>,
): Pick<
  PreviewCompleteRouteInventoryTelemetryEvent,
  | 'enumerationPrefixComputationCount'
  | 'enumerationPrefixEntryCount'
  | 'enumerationPrefixHitCount'
  | 'enumerationPrefixRequestCount'
> {
  const statistics = provider.getStatistics();
  return {
    enumerationPrefixComputationCount: statistics.computations,
    enumerationPrefixEntryCount: statistics.entries,
    enumerationPrefixHitCount: statistics.hits,
    enumerationPrefixRequestCount: statistics.requests,
  };
}

/** Captures phase-local replay statistics immediately before one telemetry emission. */
export function replayPrefixCounters(
  provider: ReturnType<typeof createPreviewInspectorRouteBranchSelectionPrefixProvider>,
): Pick<
  PreviewCompleteRouteInventoryTelemetryEvent,
  | 'replayPrefixComputationCount'
  | 'replayPrefixEntryCount'
  | 'replayPrefixHitCount'
  | 'replayPrefixRequestCount'
> {
  const statistics = provider.getStatistics();
  return {
    replayPrefixComputationCount: statistics.computations,
    replayPrefixEntryCount: statistics.entries,
    replayPrefixHitCount: statistics.hits,
    replayPrefixRequestCount: statistics.requests,
  };
}

/** Correlates a provisional entry to one independently selected exact branch identity. */
export function correlateExactReplay(
  entry: PreviewInspectorCompleteRouteBaseEntry,
  plan: PreviewInspectorRouteBranchPlan,
  rootOwner: PreviewInspectorCompleteRouteOwner,
): PreviewInspectorExactRouteReplayResult {
  if (plan.selectionResolution !== 'exact') {
    return Object.freeze({ exact: false, reason: 'exact-replay-non-exact-selection' });
  }
  const selected =
    plan.selectedBranchId === undefined
      ? undefined
      : plan.branches.find((branch) => branch.id === plan.selectedBranchId);
  const active = plan.activeLocation;
  const parent =
    selected?.parentId === undefined
      ? undefined
      : plan.branches.find((branch) => branch.id === selected.parentId);
  const owner =
    selected?.depth === 0 || parent?.sourcePath === undefined
      ? rootOwner
      : freezeOwner(parent.sourcePath, parent.exportName ?? 'default');
  const exportName = selected?.exportName;
  const sourcePath = selected?.sourcePath;
  const parameters =
    selected === undefined
      ? Object.freeze({})
      : collectPreviewInspectorRouteParameterValues(selected.pattern, selected.pathname);
  if (
    selected === undefined ||
    active === undefined ||
    exportName === undefined ||
    sourcePath === undefined
  ) {
    return Object.freeze({ exact: false, reason: 'exact-replay-identity-mismatch' });
  }
  const exact =
    plan.selectedBranchId === entry.id &&
    selected.id === createPreviewInspectorRouteBranchId(entry.selection) &&
    sameSelection(selected.selectionPath, entry.selection) &&
    selected.componentName === entry.componentName &&
    selected.pattern === entry.pattern &&
    selected.pathname === entry.pathname &&
    sameOwner(owner, entry.owner) &&
    exportName === entry.exportName &&
    entry.sourcePath !== undefined &&
    path.normalize(sourcePath) === path.normalize(entry.sourcePath) &&
    active.componentName === entry.componentName &&
    active.componentExportName === exportName &&
    active.componentSourcePath !== undefined &&
    path.normalize(active.componentSourcePath) === path.normalize(sourcePath) &&
    active.pattern === entry.pattern &&
    active.pathname === entry.pathname &&
    sameRecord(parameters, entry.parameters);
  if (!exact) {
    return Object.freeze({ exact: false, reason: 'exact-replay-identity-mismatch' });
  }
  const executionRoot = plan.executionRoot;
  const ownerChain = freezeReplayOwnerChain(active, executionRoot, rootOwner);
  return Object.freeze({
    exact: true,
    replay: Object.freeze({
      branchId: selected.id,
      componentName: selected.componentName,
      executionRoot: Object.freeze({
        basePattern: executionRoot?.basePattern ?? '/',
        exportName: executionRoot?.exportName ?? rootOwner.exportName,
        sourcePath: path.normalize(executionRoot?.sourcePath ?? rootOwner.sourcePath),
      }),
      exportName,
      owner,
      ownerChain,
      parameters,
      pathname: selected.pathname,
      pattern: selected.pattern,
      policyDigest: PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_DIGEST,
      routeSelectionResolution: 'exact' as const,
      runtimeTarget: freezeOwner(sourcePath, exportName),
      selection: freezeSelection(selected.selectionPath),
      sourcePath: path.normalize(sourcePath),
      version: 1 as const,
    }),
  });
}

/** Freezes exact route mounts, falling back only to the proven execution root. */
export function freezeReplayOwnerChain(
  active: NonNullable<PreviewInspectorRouteBranchPlan['activeLocation']>,
  executionRoot: PreviewInspectorRouteBranchPlan['executionRoot'],
  rootOwner: PreviewInspectorCompleteRouteOwner,
): PreviewInspectorExactRouteReplay['ownerChain'] {
  const mounts = (active.routeMounts ?? []).map((mount) =>
    Object.freeze({
      basePattern: mount.basePath,
      exportName: mount.exportName,
      sourcePath: path.normalize(mount.sourcePath),
    }),
  );
  if (mounts.length > 0) return Object.freeze(mounts);
  return Object.freeze([
    Object.freeze({
      basePattern: executionRoot?.basePattern ?? '/',
      exportName: executionRoot?.exportName ?? rootOwner.exportName,
      sourcePath: path.normalize(executionRoot?.sourcePath ?? rootOwner.sourcePath),
    }),
  ]);
}

/** Adds normalized replay dependencies to the complete inventory manifest. */
export function collectReplayDependencies(
  plan: PreviewInspectorRouteBranchPlan,
  dependencyPaths: Set<string>,
): void {
  for (const dependencyPath of plan.dependencyPaths) {
    dependencyPaths.add(path.normalize(dependencyPath));
  }
}
