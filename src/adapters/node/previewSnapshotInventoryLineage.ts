/** Freezes two independent confined route inventories before any campaign ledger is created. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PreviewBuildRequest } from '../../domain/preview';
import type {
  PreviewInspectorCompleteRouteInventory,
  PreviewInspectorCompleteRouteInventoryLimits,
} from '../esbuild/inspector/previewInspectorCompleteRouteInventory';
import {
  assertPreviewResolutionPaths,
  createPreviewResolutionConfinementIdentity,
  normalizePreviewResolutionConfinement,
} from '../esbuild/previewResolutionConfinement';
import { digestPreviewManifest } from './previewTrackedSourceSnapshot';

export interface PreviewSnapshotInventoryCompiler {
  collectCompleteRouteInventory(
    request: PreviewBuildRequest,
    limits?: Partial<PreviewInspectorCompleteRouteInventoryLimits>,
  ): Promise<PreviewInspectorCompleteRouteInventory>;
  shutdown(): Promise<void>;
}

export interface PreviewSnapshotInventoryLineageManifest {
  readonly counts: PreviewInspectorCompleteRouteInventory['counts'];
  readonly dependencyPaths: readonly string[];
  readonly inventoryDigest: string;
  readonly kind: 'react-preview-snapshot-inventory-lineage';
  readonly executionPlanAuditPasses: 2;
  readonly replayPolicy: PreviewInspectorCompleteRouteInventory['replayPolicy'];
  readonly requestDigest: string;
  readonly resolutionConfinement: NonNullable<PreviewBuildRequest['resolutionConfinement']>;
  readonly routes: readonly {
    readonly disposition: PreviewInspectorCompleteRouteInventory['entries'][number]['disposition'];
    readonly executionPlanDigest?: string;
    readonly id: string;
    readonly replayIdentityDigest?: string;
    readonly selection: PreviewInspectorCompleteRouteInventory['entries'][number]['selection'];
  }[];
  readonly predecessorVersion: 2;
  readonly version: 3;
}

export interface FreezePreviewSnapshotInventoryLineageOptions {
  readonly createCompiler: () => PreviewSnapshotInventoryCompiler;
  readonly evidencePath: string;
  readonly limits?: Partial<PreviewInspectorCompleteRouteInventoryLimits>;
  readonly request: PreviewBuildRequest;
}

/** Collects with fresh compilers, rejects any difference, then atomically creates evidence. */
export async function freezePreviewSnapshotInventoryLineage(
  options: FreezePreviewSnapshotInventoryLineageOptions,
): Promise<PreviewSnapshotInventoryLineageManifest> {
  const confinement = normalizePreviewResolutionConfinement(options.request);
  const identity = createPreviewResolutionConfinementIdentity(options.request);
  if (confinement === undefined || identity === undefined) {
    throw new Error('Snapshot inventory lineage requires explicit resolution confinement.');
  }
  const first = await collectWithFreshCompiler(options);
  const second = await collectWithFreshCompiler(options);
  assertPreviewResolutionPaths(confinement, first.dependencyPaths);
  assertPreviewResolutionPaths(confinement, second.dependencyPaths);
  const firstDigest = digestPreviewManifest(first);
  const secondDigest = digestPreviewManifest(second);
  if (firstDigest !== secondDigest || stableJson(first) !== stableJson(second)) {
    throw new Error('Independent snapshot inventory passes do not match.');
  }
  const requestDigest = digestPreviewManifest(options.request);
  const manifest = Object.freeze({
    counts: first.counts,
    dependencyPaths: first.dependencyPaths,
    inventoryDigest: firstDigest,
    kind: 'react-preview-snapshot-inventory-lineage' as const,
    executionPlanAuditPasses: 2 as const,
    replayPolicy: first.replayPolicy,
    requestDigest,
    resolutionConfinement: identity,
    routes: Object.freeze(
      first.entries.map((entry) =>
        Object.freeze({
          disposition: entry.disposition,
          ...(entry.disposition === 'runnable'
            ? { executionPlanDigest: entry.executionPlan.digest }
            : {}),
          id: entry.id,
          ...(entry.disposition === 'unresolved'
            ? {}
            : { replayIdentityDigest: digestPreviewManifest(entry.replay) }),
          selection: entry.selection,
        }),
      ),
    ),
    predecessorVersion: 2 as const,
    version: 3 as const,
  });
  const evidencePath = path.resolve(options.evidencePath);
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(manifest, undefined, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  return manifest;
}

/** Runs one independent inventory pass and always shuts its compiler down. */
async function collectWithFreshCompiler(
  options: FreezePreviewSnapshotInventoryLineageOptions,
): Promise<PreviewInspectorCompleteRouteInventory> {
  const compiler = options.createCompiler();
  try {
    return await compiler.collectCompleteRouteInventory(options.request, options.limits);
  } finally {
    await compiler.shutdown();
  }
}

/** Serializes immutable inventory evidence with deterministic object-key ordering. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
