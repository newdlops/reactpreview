/** Standalone analyzer-only complete-route inventory profiler. */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  PreviewBuildRequest,
  PreviewResolutionConfinement,
  PreviewSourceLanguage,
} from '../../domain/preview';
import {
  PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_MAXIMUM_EVENTS,
  PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_POLICY_DIGEST,
  PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_POLICY_VERSION,
  type PreviewCompleteRouteInventoryTelemetryEvent,
  type PreviewInspectorCompleteRouteInventory,
} from '../esbuild/inspector/previewInspectorCompleteRouteInventory';
import {
  PreviewCompleteRouteInventoryWorkerClient,
  PreviewCompleteRouteInventoryWorkerError,
} from '../worker/previewCompleteRouteInventoryWorkerClient';
import {
  assertPreviewCompilerWorkerIsolation,
  PREVIEW_INVENTORY_COMPILER_ISOLATION_POLICY_DIGEST,
  PREVIEW_INVENTORY_COMPILER_ISOLATION_POLICY_VERSION,
} from '../worker/previewCompilerWorkerIsolation';

export const PREVIEW_COMPLETE_ROUTE_INVENTORY_PROFILE_SCHEMA_VERSION = 1;
export const PREVIEW_COMPLETE_ROUTE_INVENTORY_PROFILE_CAP_MS = 300_000;

export interface PreviewCompleteRouteInventoryProfileArguments {
  readonly productionAggregate: string;
  readonly profileRoot: string;
  readonly resolutionConfinement: PreviewResolutionConfinement;
  readonly target: string;
  readonly tsconfig?: string;
  readonly workspace: string;
}

interface PreviewCompleteRouteInventoryProfileClient {
  readonly collectCompleteRouteInventory: (
    request: PreviewBuildRequest,
    limits?: undefined,
    signal?: AbortSignal,
  ) => Promise<PreviewInspectorCompleteRouteInventory>;
}

export interface PreviewCompleteRouteInventoryProfileDependencies {
  readonly appendRecord: (profilePath: string, record: string, exclusive: boolean) => Promise<void>;
  readonly createClient: (
    workerPath: string,
    observer: (event: PreviewCompleteRouteInventoryTelemetryEvent) => void,
  ) => PreviewCompleteRouteInventoryProfileClient;
  readonly makeDirectory: (rootPath: string) => Promise<void>;
  readonly readTarget: (targetPath: string) => Promise<string>;
  readonly schedule: (listener: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  readonly unschedule: (timer: ReturnType<typeof setTimeout>) => void;
}

const DEFAULT_DEPENDENCIES: PreviewCompleteRouteInventoryProfileDependencies = {
  appendRecord: (profilePath, record, exclusive) =>
    appendFile(profilePath, record, {
      encoding: 'utf8',
      flag: exclusive ? 'wx' : 'a',
    }),
  createClient: (workerPath, observer) =>
    new PreviewCompleteRouteInventoryWorkerClient(workerPath, {
      onProgress: observer,
    }),
  makeDirectory: async (rootPath) => {
    await mkdir(rootPath);
  },
  readTarget: (targetPath) => readFile(targetPath, 'utf8'),
  schedule: (listener, milliseconds) => setTimeout(listener, milliseconds),
  unschedule: (timer) => {
    clearTimeout(timer);
  },
};

/** Parses frozen inputs, persists bounded JSONL, and returns the analyzer-only terminal code. */
export async function runPreviewCompleteRouteInventoryProfileCli(
  arguments_: readonly string[],
  workerPath: string,
  dependencies: PreviewCompleteRouteInventoryProfileDependencies = DEFAULT_DEPENDENCIES,
): Promise<number> {
  assertPreviewCompilerWorkerIsolation(process.execArgv, process.env.NODE_OPTIONS);
  const values = parsePreviewCompleteRouteInventoryProfileArguments(arguments_);
  const target = path.resolve(values.target);
  const sourceText = await dependencies.readTarget(target);
  const request: PreviewBuildRequest = Object.freeze({
    dependencySnapshots: Object.freeze([]),
    documentPath: target,
    language: inferLanguage(target),
    preparationMode: 'fast',
    renderMode: 'page-inspector',
    resolutionConfinement: values.resolutionConfinement,
    sourceText,
    ...(values.tsconfig === undefined ? {} : { tsconfigPath: path.resolve(values.tsconfig) }),
    useStorybookPreview: true,
    workspaceRoot: path.resolve(values.workspace),
  });
  const profileRoot = path.resolve(values.profileRoot);
  const profilePath = path.join(profileRoot, 'profile.jsonl');
  await dependencies.makeDirectory(profileRoot);
  await dependencies.appendRecord(
    profilePath,
    formatProfileRecord({
      confinementPolicyDigest: values.resolutionConfinement.policyDigest,
      dependencyViewDigest: values.resolutionConfinement.dependencyViewDigest,
      isolationPolicyDigest: PREVIEW_INVENTORY_COMPILER_ISOLATION_POLICY_DIGEST,
      isolationPolicyVersion: PREVIEW_INVENTORY_COMPILER_ISOLATION_POLICY_VERSION,
      kind: 'header',
      maximumEvents: PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_MAXIMUM_EVENTS,
      noRetry: true,
      probeCapMs: PREVIEW_COMPLETE_ROUTE_INVENTORY_PROFILE_CAP_MS,
      productionAggregate: values.productionAggregate,
      schemaVersion: PREVIEW_COMPLETE_ROUTE_INVENTORY_PROFILE_SCHEMA_VERSION,
      sourceManifestDigest: values.resolutionConfinement.sourceManifestDigest,
      telemetryPolicyDigest: PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_POLICY_DIGEST,
      telemetryPolicyVersion: PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_POLICY_VERSION,
    }),
    true,
  );

  const controller = new AbortController();
  const probeState: { capTriggered: boolean; persistenceFailure?: unknown } = {
    capTriggered: false,
  };
  let eventCount = 0;
  let latestEvent: PreviewCompleteRouteInventoryTelemetryEvent | undefined;
  let writeQueue = Promise.resolve();
  let terminalStarted = false;
  const observer = (event: PreviewCompleteRouteInventoryTelemetryEvent): void => {
    if (terminalStarted) return;
    latestEvent = event;
    eventCount += 1;
    writeQueue = writeQueue.then(() =>
      dependencies.appendRecord(
        profilePath,
        formatProfileRecord({
          event,
          kind: 'progress',
          schemaVersion: PREVIEW_COMPLETE_ROUTE_INVENTORY_PROFILE_SCHEMA_VERSION,
        }),
        false,
      ),
    );
    void writeQueue.catch((error: unknown) => {
      if (probeState.persistenceFailure !== undefined) return;
      probeState.persistenceFailure = error;
      controller.abort();
    });
  };
  const client = dependencies.createClient(path.resolve(workerPath), observer);
  const capTimer = dependencies.schedule(() => {
    probeState.capTriggered = true;
    controller.abort();
  }, PREVIEW_COMPLETE_ROUTE_INVENTORY_PROFILE_CAP_MS);
  capTimer.unref();

  let inventory: PreviewInspectorCompleteRouteInventory | undefined;
  let workerFailure: unknown;
  try {
    inventory = await client.collectCompleteRouteInventory(request, undefined, controller.signal);
  } catch (error) {
    workerFailure = error;
  } finally {
    dependencies.unschedule(capTimer);
    terminalStarted = true;
  }
  try {
    await writeQueue;
  } catch {
    return 1;
  }
  if (probeState.persistenceFailure !== undefined) return 1;

  const terminalBase = {
    cleanupConfirmed: true,
    eventCount,
    finalSequence: latestEvent?.sequence ?? 0,
    kind: 'terminal' as const,
    lastCounters: freezeLastCounters(latestEvent),
    lastPhase: latestEvent?.phase,
    noRetry: true,
    schemaVersion: PREVIEW_COMPLETE_ROUTE_INVENTORY_PROFILE_SCHEMA_VERSION,
  };
  if (inventory !== undefined && inventory.complete && !inventory.truncated) {
    try {
      await dependencies.appendRecord(
        profilePath,
        formatProfileRecord({
          ...terminalBase,
          inventory,
          status: 'completed',
        }),
        false,
      );
      return 0;
    } catch {
      return 1;
    }
  }
  const expectedCancellation =
    probeState.capTriggered &&
    workerFailure instanceof PreviewCompleteRouteInventoryWorkerError &&
    workerFailure.code === 'preview-inventory-cancelled';
  try {
    await dependencies.appendRecord(
      profilePath,
      formatProfileRecord({
        ...terminalBase,
        failureCode: classifyProfileFailure(workerFailure),
        status: expectedCancellation ? 'probe-cancelled' : 'failed',
      }),
      false,
    );
  } catch {
    return 1;
  }
  return expectedCancellation ? 2 : 1;
}

/** Parses only snapshot confinement, profile output, and analyzer target inputs. */
export function parsePreviewCompleteRouteInventoryProfileArguments(
  arguments_: readonly string[],
): PreviewCompleteRouteInventoryProfileArguments {
  const values = new Map<string, string>();
  const approvedDependencyRoots: string[] = [];
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (name === undefined || value === undefined || !name.startsWith('--')) {
      throw new Error(`Invalid inventory profile argument near ${name ?? '<missing>'}.`);
    }
    if (name === '--approved-dependency-root') {
      approvedDependencyRoots.push(value);
      continue;
    }
    if (
      ![
        '--confinement-policy-digest',
        '--dependency-view-digest',
        '--production-aggregate',
        '--profile-root',
        '--source-manifest-digest',
        '--source-root',
        '--target',
        '--tsconfig',
        '--workspace',
      ].includes(name)
    ) {
      throw new Error(`Unknown inventory profile argument: ${name}`);
    }
    if (values.has(name)) throw new Error(`Duplicate inventory profile argument: ${name}`);
    values.set(name, value);
  }
  for (const required of [
    '--confinement-policy-digest',
    '--dependency-view-digest',
    '--production-aggregate',
    '--profile-root',
    '--source-manifest-digest',
    '--source-root',
    '--target',
    '--workspace',
  ]) {
    if (!values.has(required)) throw new Error(`Missing inventory profile argument: ${required}`);
  }
  for (const digestName of [
    '--confinement-policy-digest',
    '--dependency-view-digest',
    '--production-aggregate',
    '--source-manifest-digest',
  ]) {
    if (!/^[a-f0-9]{64}$/u.test(values.get(digestName) ?? '')) {
      throw new Error(`Inventory profile argument ${digestName} must be a SHA-256 digest.`);
    }
  }
  const normalizedRoots = approvedDependencyRoots.map((root) => path.resolve(root));
  if (normalizedRoots.length === 0 || new Set(normalizedRoots).size !== normalizedRoots.length) {
    throw new Error('Inventory profile dependency roots must be non-empty and unique.');
  }
  const tsconfig = values.get('--tsconfig');
  return Object.freeze({
    productionAggregate: values.get('--production-aggregate') ?? '',
    profileRoot: values.get('--profile-root') ?? '',
    resolutionConfinement: Object.freeze({
      approvedDependencyRoots: Object.freeze([...normalizedRoots].sort()),
      dependencyViewDigest: values.get('--dependency-view-digest') ?? '',
      policyDigest: values.get('--confinement-policy-digest') ?? '',
      sourceManifestDigest: values.get('--source-manifest-digest') ?? '',
      sourceRoot: path.resolve(values.get('--source-root') ?? ''),
    }),
    target: values.get('--target') ?? '',
    ...(tsconfig === undefined ? {} : { tsconfig }),
    workspace: values.get('--workspace') ?? '',
  });
}

/** Distinguishes the mandatory overflow terminal from other stable worker failures. */
function classifyProfileFailure(workerFailure: unknown): string {
  if (
    workerFailure instanceof Error &&
    workerFailure.message.includes(
      `telemetry exceeded ${PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_MAXIMUM_EVENTS.toString()} events`,
    )
  ) {
    return 'telemetry-overflow';
  }
  return workerFailure instanceof PreviewCompleteRouteInventoryWorkerError
    ? workerFailure.code
    : 'preview-inventory-failed';
}

/** Retains only source-general counters from the last valid progress event. */
function freezeLastCounters(
  event: PreviewCompleteRouteInventoryTelemetryEvent | undefined,
): Readonly<Record<string, number>> {
  if (event === undefined) return Object.freeze({});
  const counters: Record<string, number> = {};
  for (const name of [
    'analysisPasses',
    'queuedSelections',
    'discoveredBranches',
    'replayCompleted',
    'replayTotal',
    'executionPlanCompleted',
    'executionPlanTotal',
    'routeOrdinal',
    'enumerationPrefixRequestCount',
    'enumerationPrefixComputationCount',
    'enumerationPrefixHitCount',
    'enumerationPrefixEntryCount',
    'replayPrefixRequestCount',
    'replayPrefixComputationCount',
    'replayPrefixHitCount',
    'replayPrefixEntryCount',
  ] as const) {
    const value = event[name];
    if (value !== undefined) counters[name] = value;
  }
  return Object.freeze(counters);
}

/** Encodes one append-only schema record without pretty-printing or ambient values. */
function formatProfileRecord(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

/** Maps one supported target extension to the worker request language. */
function inferLanguage(sourcePath: string): PreviewSourceLanguage {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return 'tsx';
  if (extension === '.ts') return 'ts';
  if (extension === '.jsx') return 'jsx';
  if (extension === '.js') return 'js';
  throw new Error(`Unsupported preview target extension: ${extension}`);
}
