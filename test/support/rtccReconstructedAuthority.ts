/**
 * Recreates deterministic RTCC regression inputs from the maintained one-route fixture.
 * These records simulate the missing archive's contract; they are never historical run evidence.
 * Generation stays in memory so repeated checks leave no multi-megabyte profile files behind.
 */
import {
  canonicalDigest,
  mountFallbackEvidenceDigest,
} from '../../scripts/validation/rtcc-v3-inventory-execution-plan.mjs';
import { validFixture } from './rtccV3Fixture';

type ObjectValue = Record<string, unknown>;
interface Progress {
  event: ObjectValue;
  kind: string;
  schemaVersion: number;
}
type Runnable = ObjectValue & {
  id: string;
  selection: ObjectValue[];
  replay: ObjectValue;
  executionPlan: ObjectValue & {
    recipe: ObjectValue & { mounts: ObjectValue[] };
    selectedBranch: ObjectValue;
  };
};

/** Explicit cardinalities and digests supplied by the validator contract under test. */
export interface ReconstructedAuthorityPolicy {
  /** Telemetry contract, including the expected ordered header and route ordinals. */
  structural: ObjectValue & { header: ObjectValue; requiredOrdinals: readonly number[] };
  /** Inventory cardinalities and policy identities used to construct matching route inputs. */
  inventory: ObjectValue & {
    analysisCount: number;
    replayCount: number;
    total: number;
    runnable: number;
    duplicate: number;
    unresolved: number;
    replayPolicyDigest: string;
    executionPlanPolicyDigest: string;
  };
}

const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** Rejects a changed seed fixture before accessing a missing route or telemetry phase. */
function required<T>(value: T | undefined, description: string): T {
  if (value === undefined) throw new Error('Missing reconstructed fixture seed: ' + description);
  return value;
}

/** Rebinds every nested route value and then hashes the complete new execution plan. */
function createRunnable(
  seed: Runnable,
  index: number,
  policy: ReconstructedAuthorityPolicy,
  repaired: boolean,
): Runnable {
  const entry = structuredClone(seed);
  const id = 'reconstructed-route-' + String(index);
  const parameter =
    !repaired && index < 31
      ? 'aaaaaaaa'
      : '00000000-0000-4000-8000-' + index.toString(16).padStart(12, '0');
  const pattern = '/groups/:groupId(' + uuidPattern + ')' + (index === 30 ? '/*' : '');
  const pathname = '/groups/' + parameter;
  const parameters = { groupId: parameter };
  const selection = structuredClone(seed.selection);
  required(selection.at(-1), 'route selection').pattern = pattern;
  Object.assign(entry, { id, parameters, pathname, pattern, selection });
  Object.assign(entry.replay, {
    branchId: id,
    parameters: structuredClone(parameters),
    pathname,
    pattern,
    policyDigest: policy.inventory.replayPolicyDigest,
    selection: structuredClone(selection),
  });
  const plan = entry.executionPlan;
  Object.assign(plan, {
    browserCandidateId: 'browser:' + id,
    executionCandidateId: 'execution:' + id,
    pageCandidateId: 'browser:' + id,
    policyDigest: policy.inventory.executionPlanPolicyDigest,
    routeId: id,
    selection: structuredClone(selection),
  });
  Object.assign(plan.recipe, { params: structuredClone(parameters), pathname, pattern });
  for (const mount of plan.recipe.mounts) mount.pattern = pattern;
  Object.assign(plan.selectedBranch, { id, pathname, pattern });
  plan.digest = canonicalDigest(
    Object.fromEntries(Object.entries(plan).filter(([key]) => key !== 'digest')),
  );
  return entry;
}

/** Keeps duplicate schema order and links only to valid runnable entries. */
function createDuplicate(target: Runnable, index: number): ObjectValue {
  return {
    id: 'reconstructed-duplicate-' + String(index),
    componentName: target.componentName,
    exportName: target.exportName,
    owner: structuredClone(target.owner),
    parameters: structuredClone(target.parameters),
    pathname: target.pathname,
    pattern: target.pattern,
    selection: structuredClone(target.selection),
    sourcePath: target.sourcePath,
    disposition: 'duplicate',
    duplicateOf: target.id,
    reason: 'exact-semantic-route',
    replay: structuredClone(target.replay),
  };
}

/** Builds ordered unresolved blockers without asserting that an analysis actually ran. */
function createUnresolved(owner: unknown, index: number): ObjectValue {
  return {
    id: 'reconstructed-unresolved-' + String(index),
    componentName: 'Unresolved' + String(index),
    owner: structuredClone(owner),
    parameters: {},
    pathname: '',
    pattern: '',
    selection: [],
    disposition: 'unresolved',
    reason: 'catalog-unresolved',
  };
}

/** Constructs a fresh graph and telemetry stream; callers may mutate their own returned copy. */
export function createReconstructedAuthority(
  template: ReconstructedAuthorityPolicy,
  repaired = false,
): { records: unknown[]; bytes: string; policy: ReconstructedAuthorityPolicy } {
  const policy = structuredClone(template);
  const seed = validFixture();
  const header = seed[0] as ObjectValue;
  const terminal = seed[seed.length - 1] as ObjectValue & { inventory: ObjectValue };
  const inventory = terminal.inventory;
  const originalInventory = inventory as ObjectValue & { entries: Runnable[] };
  const seedEntry = required(originalInventory.entries[0], 'runnable route');
  const runnable = Array.from({ length: policy.inventory.runnable }, (_, index) =>
    createRunnable(seedEntry, index, policy, repaired),
  );
  const duplicates = Array.from({ length: policy.inventory.duplicate }, (_, index) =>
    createDuplicate(
      required(runnable[31 + (index % (runnable.length - 31))], 'valid duplicate target'),
      index,
    ),
  );
  const unresolved = Array.from({ length: policy.inventory.unresolved }, (_, index) =>
    createUnresolved(inventory.owner, index),
  );
  const entries = [...runnable, ...duplicates, ...unresolved];
  Object.assign(inventory, {
    analysisPasses: policy.inventory.analysisCount,
    counts: {
      duplicate: duplicates.length,
      runnable: runnable.length,
      total: entries.length,
      unresolved: unresolved.length,
    },
    entries,
    replayPasses: policy.inventory.replayCount,
  });
  (inventory.replayPolicy as ObjectValue).digest = policy.inventory.replayPolicyDigest;
  policy.inventory.mountFallbackEvidenceDigest = mountFallbackEvidenceDigest(entries);
  Object.assign(header, policy.structural.header);
  const originalProgress = seed.slice(1, -1) as Progress[];
  const enumerationSeed = required(
    originalProgress.find((record) => record.event.phase === 'enumerate-branches'),
    'enumeration phase',
  );
  const replaySeed = required(
    originalProgress.find((record) => record.event.phase === 'replay-branches'),
    'replay phase',
  );
  const executionSeed = originalProgress.filter((record) =>
    String(record.event.phase).startsWith('execution-'),
  );
  const progress: Progress[] = [];
  /** Appends fresh resource counters in their original schema order. */
  const append = (source: Progress): void => {
    const record = structuredClone(source);
    const sequence = progress.length + 1;
    Object.assign(record.event, {
      cpuSystemMicros: sequence,
      cpuUserMicros: sequence,
      elapsedMs: sequence,
      heapUsedBytes: sequence,
      rssBytes: sequence,
      sequence,
    });
    progress.push(record);
  };
  const preparationSeed = required(originalProgress[0], 'preparation phase');
  for (let index = 0; index < 5; index += 1) append(preparationSeed);
  /** Preserves the validator's logarithmic checkpoint sequence and its final checkpoint. */
  const phase = (source: Progress, total: number, counter: string): void => {
    const checkpoints = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512]
      .filter((value) => value < total)
      .concat(total);
    for (const [transition, count] of [
      ['start', 0],
      ...checkpoints.map((value) => ['checkpoint', value]),
      ['complete', total],
    ]) {
      const record = structuredClone(source);
      Object.assign(record.event, { transition, [counter]: count });
      if (counter === 'analysisPasses')
        Object.assign(record.event, { discoveredBranches: count, queuedSelections: count });
      else record.event.replayTotal = total;
      append(record);
    }
  };
  phase(enumerationSeed, policy.inventory.analysisCount, 'analysisPasses');
  phase(replaySeed, policy.inventory.replayCount, 'replayCompleted');
  for (const ordinal of policy.structural.requiredOrdinals) {
    for (const [index, source] of executionSeed.entries()) {
      const record = structuredClone(source);
      Object.assign(record.event, {
        routeOrdinal: ordinal,
        executionPlanTotal: runnable.length,
        executionPlanCompleted: index === executionSeed.length - 1 ? ordinal : ordinal - 1,
      });
      append(record);
    }
  }
  append(required(originalProgress.at(-1), 'finalization phase'));
  Object.assign(terminal, { eventCount: progress.length, finalSequence: progress.length });
  const records = [header, ...progress, terminal];
  return {
    records,
    bytes: records.map((record) => JSON.stringify(record)).join('\n') + '\n',
    policy,
  };
}
