/** Shared, versioned resource isolation for inventory and route compiler workers. */
import { createHash } from 'node:crypto';
import {
  createPreviewManagedChildEnvironment,
  PREVIEW_MANAGED_CHILD_ENVIRONMENT_POLICY_DIGEST,
  PREVIEW_MANAGED_CHILD_ENVIRONMENT_POLICY_VERSION,
} from '../node/previewManagedChildEnvironment';

/** Exact heap-changing Node flags rejected before campaign inventory work begins. */
const AMBIENT_HEAP_OVERRIDE_DENYLIST = Object.freeze([
  '--huge-max-old-generation-size',
  '--initial-old-space-size',
  '--initial_old_space_size',
  '--max-old-space-size',
  '--max_old_space_size',
  '--max-semi-space-size',
  '--max_semi_space_size',
] as const);

/** Widened behavior switches keep the canonical object executable as well as descriptive. */
interface PreviewCompilerWorkerIsolationPolicy {
  readonly ambientHeapOverrideDenylist: readonly string[];
  readonly goMemoryDefault: string;
  readonly goMemoryMaximumBytes: number;
  readonly goMemoryPreserveStricterPositiveInherited: boolean;
  readonly goParallelismDefault: number;
  readonly goParallelismMaximum: number;
  readonly goParallelismPreserveStricterPositiveInherited: boolean;
  readonly inventoryOldGenerationLimitMb: number;
  readonly inventoryRetryPolicy: 'none';
  readonly inventoryShutdownGraceMs: number;
  readonly inventoryTimeoutMs: number;
  readonly inventoryWorkerRelease: 'before-ledger-creation';
  readonly managedChildEnvironmentPolicyDigest: string;
  readonly managedChildEnvironmentPolicyVersion: number;
  readonly policyVersion: 3;
  readonly routeOldGenerationLimitMb: number;
  readonly transport: 'worker-thread';
  readonly workerExecArgv: readonly string[];
}

/** Deeply frozen authority for compiler-worker construction, environment, cleanup, and identity. */
export const PREVIEW_COMPILER_WORKER_ISOLATION_POLICY: Readonly<PreviewCompilerWorkerIsolationPolicy> =
  Object.freeze({
    ambientHeapOverrideDenylist: AMBIENT_HEAP_OVERRIDE_DENYLIST,
    goMemoryDefault: '256MiB',
    goMemoryMaximumBytes: 268_435_456,
    goMemoryPreserveStricterPositiveInherited: true,
    goParallelismDefault: 2,
    goParallelismMaximum: 2,
    goParallelismPreserveStricterPositiveInherited: true,
    inventoryOldGenerationLimitMb: 2_048,
    inventoryRetryPolicy: 'none',
    inventoryShutdownGraceMs: 5_000,
    inventoryTimeoutMs: 1_800_000,
    inventoryWorkerRelease: 'before-ledger-creation',
    managedChildEnvironmentPolicyDigest: PREVIEW_MANAGED_CHILD_ENVIRONMENT_POLICY_DIGEST,
    managedChildEnvironmentPolicyVersion: PREVIEW_MANAGED_CHILD_ENVIRONMENT_POLICY_VERSION,
    policyVersion: 3,
    routeOldGenerationLimitMb: 384,
    transport: 'worker-thread',
    workerExecArgv: Object.freeze([] as string[]),
  });

export const PREVIEW_INVENTORY_WORKER_OLD_GENERATION_LIMIT_MB =
  PREVIEW_COMPILER_WORKER_ISOLATION_POLICY.inventoryOldGenerationLimitMb;
export const PREVIEW_ROUTE_WORKER_OLD_GENERATION_LIMIT_MB =
  PREVIEW_COMPILER_WORKER_ISOLATION_POLICY.routeOldGenerationLimitMb;
export const PREVIEW_INVENTORY_WORKER_TIMEOUT_MS =
  PREVIEW_COMPILER_WORKER_ISOLATION_POLICY.inventoryTimeoutMs;
export const PREVIEW_COMPILER_WORKER_SHUTDOWN_GRACE_MS =
  PREVIEW_COMPILER_WORKER_ISOLATION_POLICY.inventoryShutdownGraceMs;
export const PREVIEW_INVENTORY_COMPILER_ISOLATION_POLICY_VERSION =
  PREVIEW_COMPILER_WORKER_ISOLATION_POLICY.policyVersion;

/** Stable runtime policy identity containing no ambient environment values. */
export const PREVIEW_INVENTORY_COMPILER_ISOLATION_POLICY_DIGEST = createHash('sha256')
  .update(JSON.stringify(PREVIEW_COMPILER_WORKER_ISOLATION_POLICY))
  .digest('hex');

/** Rejects parent flags that would silently override worker resource limits. */
export function assertPreviewCompilerWorkerIsolation(
  execArgv: readonly string[],
  nodeOptions: string | undefined,
): void {
  const inheritedFlags = [
    ...execArgv,
    ...(nodeOptions?.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/gu) ?? []),
  ].map((value) => value.replace(/^(?:["'])|(?:["'])$/gu, ''));
  const deniedFlags = new Set(PREVIEW_COMPILER_WORKER_ISOLATION_POLICY.ambientHeapOverrideDenylist);
  if (
    inheritedFlags.some((value) => {
      const equalsIndex = value.indexOf('=');
      const flag = equalsIndex < 0 ? value : value.slice(0, equalsIndex);
      return deniedFlags.has(flag);
    })
  ) {
    throw new Error('Preview campaign rejects ambient Node heap overrides.');
  }
}

/** Creates the identical bounded environment inherited by both compiler worker types. */
export function createPreviewCompilerWorkerEnvironment(
  parentEnvironment: Readonly<NodeJS.ProcessEnv>,
): NodeJS.ProcessEnv {
  const environment = createPreviewManagedChildEnvironment(parentEnvironment);
  return {
    ...environment,
    GOMEMLIMIT: selectBoundedGoMemoryLimit(environment.GOMEMLIMIT),
    GOMAXPROCS: selectBoundedGoParallelism(environment.GOMAXPROCS),
  };
}

/** Produces the exact Node worker options shared by route and one-shot inventory clients. */
export function createPreviewCompilerWorkerOptions(
  parentEnvironment: Readonly<NodeJS.ProcessEnv>,
  maxOldGenerationSizeMb: number,
): Readonly<{
  env: NodeJS.ProcessEnv;
  execArgv: readonly string[];
  resourceLimits: Readonly<{ maxOldGenerationSizeMb: number }>;
}> {
  return Object.freeze({
    env: createPreviewCompilerWorkerEnvironment(parentEnvironment),
    execArgv: PREVIEW_COMPILER_WORKER_ISOLATION_POLICY.workerExecArgv,
    resourceLimits: Object.freeze({ maxOldGenerationSizeMb }),
  });
}

/** Preserves a stricter inherited Go heap limit while clamping invalid or oversized values. */
function selectBoundedGoMemoryLimit(configuredValue: string | undefined): string {
  if (configuredValue === undefined) {
    return PREVIEW_COMPILER_WORKER_ISOLATION_POLICY.goMemoryDefault;
  }
  const match = /^([0-9]+(?:\.[0-9]+)?)([KMGT]i?B|B)?$/iu.exec(configuredValue.trim());
  if (match === null) return PREVIEW_COMPILER_WORKER_ISOLATION_POLICY.goMemoryDefault;
  const numericValue = Number(match[1]);
  const unit = (match[2] ?? 'B').toUpperCase();
  const multipliers: Readonly<Record<string, number>> = {
    B: 1,
    GB: 1_000_000_000,
    GIB: 1024 ** 3,
    KB: 1_000,
    KIB: 1024,
    MB: 1_000_000,
    MIB: 1024 ** 2,
    TB: 1_000_000_000_000,
    TIB: 1024 ** 4,
  };
  const configuredBytes = numericValue * (multipliers[unit] ?? Number.POSITIVE_INFINITY);
  return PREVIEW_COMPILER_WORKER_ISOLATION_POLICY.goMemoryPreserveStricterPositiveInherited &&
    Number.isFinite(configuredBytes) &&
    configuredBytes > 0 &&
    configuredBytes <= PREVIEW_COMPILER_WORKER_ISOLATION_POLICY.goMemoryMaximumBytes
    ? configuredValue
    : PREVIEW_COMPILER_WORKER_ISOLATION_POLICY.goMemoryDefault;
}

/** Limits inherited Go scheduler width so host configuration cannot multiply allocations. */
function selectBoundedGoParallelism(configuredValue: string | undefined): string {
  const normalized = configuredValue?.trim() ?? '';
  if (!/^[1-9]\d*$/u.test(normalized)) {
    return PREVIEW_COMPILER_WORKER_ISOLATION_POLICY.goParallelismDefault.toString();
  }
  const parsed = Number(normalized);
  return PREVIEW_COMPILER_WORKER_ISOLATION_POLICY.goParallelismPreserveStricterPositiveInherited &&
    Number.isSafeInteger(parsed)
    ? Math.min(parsed, PREVIEW_COMPILER_WORKER_ISOLATION_POLICY.goParallelismMaximum).toString()
    : PREVIEW_COMPILER_WORKER_ISOLATION_POLICY.goParallelismDefault.toString();
}
