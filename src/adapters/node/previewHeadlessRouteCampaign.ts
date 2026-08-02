/** Runs a frozen static route inventory sequentially through isolated headless Chromium instances. */
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PreviewCompiler } from '../../application/previewCompiler';
import {
  PreviewCompilationError,
  PreviewRouteExecutionPlanInvariantError,
  type PreviewBuildRequest,
  type PreviewDiagnostic,
  type PreviewResolutionConfinement,
  type PreviewRouteExecutionPlanInvariantEvidence,
} from '../../domain/preview';
import {
  PreviewBuildStalledError,
  type PreviewBuildExecutionContext,
} from '../../domain/previewBuildExecution';
import type {
  PreviewInspectorCompleteRouteInventory,
  PreviewInspectorCompleteRouteInventoryLimits,
  PreviewInspectorCompleteRunnableRoute,
} from '../esbuild/inspector/previewInspectorCompleteRouteInventory';
import {
  PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_DIGEST,
  PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_VERSION,
} from '../esbuild/inspector/previewInspectorCompleteRouteInventory';
import {
  PREVIEW_TARGET_FACADE_OWNERSHIP_POLICY_DIGEST,
  PREVIEW_TARGET_FACADE_OWNERSHIP_POLICY_VERSION,
} from '../esbuild/inspector/previewInspectorTargetModuleContract';
import {
  PREVIEW_ABSENCE_EXECUTION_ROOT_POLICY_DIGEST,
  PREVIEW_ABSENCE_EXECUTION_ROOT_POLICY_VERSION,
} from '../esbuild/inspector/previewInspectorExecutionRootModuleContract';
import {
  PREVIEW_METAFILE_DEPENDENCY_RECOVERY_POLICY_DIGEST,
  PREVIEW_METAFILE_DEPENDENCY_RECOVERY_POLICY_VERSION,
} from '../esbuild/previewBuildResult';
import {
  assertPreviewResolutionPaths,
  createPreviewResolutionConfinementIdentity,
  normalizePreviewResolutionConfinement,
} from '../esbuild/previewResolutionConfinement';
import {
  PREVIEW_OWNED_NAMESPACE_POLICY_DIGEST,
  PREVIEW_OWNED_NAMESPACE_POLICY_VERSION,
} from '../esbuild/previewOwnedNamespaceRegistry';
import {
  PREVIEW_SYNTHETIC_INPUT_POLICY_DIGEST,
  PREVIEW_SYNTHETIC_INPUT_POLICY_VERSION,
} from '../esbuild/previewSyntheticInputRegistry';
import {
  PREVIEW_ROUTE_EXECUTION_PLAN_POLICY_DIGEST,
  PREVIEW_ROUTE_EXECUTION_PLAN_POLICY_VERSION,
} from '../esbuild/previewRouteExecutionPlan';
import {
  PREVIEW_HEADLESS_FAILED_CAPTURE_MS,
  PREVIEW_HEADLESS_STABILIZATION_CAP_MS,
  PREVIEW_HEADLESS_STABILIZATION_QUIET_MS,
  renderPreviewHeadlessly,
  type PreviewHeadlessRendererOptions,
  type PreviewHeadlessResult,
} from './previewHeadlessRenderer';
import {
  PREVIEW_MANAGED_CHILD_ENVIRONMENT_POLICY_DIGEST,
  PREVIEW_MANAGED_CHILD_ENVIRONMENT_POLICY_VERSION,
} from './previewManagedChildEnvironment';
import {
  assertPreviewCompilerWorkerIsolation,
  PREVIEW_INVENTORY_COMPILER_ISOLATION_POLICY_DIGEST,
  PREVIEW_INVENTORY_COMPILER_ISOLATION_POLICY_VERSION,
} from '../worker/previewCompilerWorkerIsolation';

const CAMPAIGN_VERSION = 7;
const COMPILER_ISOLATION_VERSION = 2;
const COMPILER_DEADLINE_VERSION = 1;
const EVIDENCE_POLICY_VERSION = 3;
const ROUTE_TARGET_OWNERSHIP_POLICY_VERSION = 3;
const RETRY_POLICY_VERSION = 1;
const RESOLUTION_CONFINEMENT_VERSION = 3;
const DEFAULT_COMPILE_TIMEOUT_MS = 60_000;
const DEFAULT_RENDER_TIMEOUT_MS = 15_000;
const MAX_ERROR_TEXT = 8_192;

/** Direct compiler capability used only for frozen inert inventory collection. */
export interface PreviewHeadlessRouteCampaignCompiler {
  collectCompleteRouteInventory(
    request: PreviewBuildRequest,
    limits?: Partial<PreviewInspectorCompleteRouteInventoryLimits>,
    signal?: AbortSignal,
  ): Promise<PreviewInspectorCompleteRouteInventory>;
}

/** Restartable worker compiler boundary required for route compilation. */
export interface PreviewHeadlessRouteCampaignIsolatedCompiler extends PreviewCompiler {
  /** Resolves after cancellation acknowledgement or confirmed forced worker retirement. */
  waitForCancellationRecovery(): Promise<void>;
}

/** Terminal status for one runnable inventory row. */
export type PreviewHeadlessRouteCampaignStatus =
  | 'cleanup-failed'
  | 'compile-failed'
  | 'compile-timeout'
  | 'execution-plan-invariant'
  | 'insufficient-evidence'
  | 'partial-blocked'
  | 'post-commit-failed'
  | 'protocol-error'
  | 'ready'
  | 'ready-empty'
  | 'render-timeout'
  | 'runtime-failed';

/** Versioned successor header that makes migration policy immutable and auditable. */
export interface PreviewHeadlessRouteCampaignLedgerHeader {
  readonly absenceExecutionRootPolicyDigest: string;
  readonly engineDigest: string;
  readonly inventoryDigest: string;
  readonly inventoryCompilerIsolationPolicyDigest: string;
  readonly inventoryCompilerIsolationPolicyVersion: 3;
  readonly inventoryReplayPolicyDigest: string;
  readonly executionPlanPolicyDigest: string;
  readonly kind: 'header';
  readonly managedChildEnvironmentPolicyDigest: string;
  readonly maxRoutes?: number;
  readonly metafileDependencyRecoveryPolicyDigest: string;
  readonly namespaceConfinementPolicyDigest: string;
  readonly requestDigest: string;
  readonly resolutionConfinement?: PreviewResolutionConfinement;
  readonly routeIds: readonly string[];
  readonly retryRouteIds: readonly string[];
  readonly syntheticInputPolicyDigest: string;
  readonly targetFacadeOwnershipPolicyDigest: string;
  readonly version: 7;
}

/** Bounded terminal evidence for one route. */
export interface PreviewHeadlessRouteCampaignRecord {
  readonly diagnostics: readonly PreviewDiagnostic[];
  readonly durationMs: number;
  readonly error?: string;
  readonly headless?: PreviewHeadlessResult;
  readonly routeExecutionPlanInvariantEvidence?: PreviewRouteExecutionPlanInvariantEvidence;
  readonly kind: 'route';
  readonly routeId: string;
  readonly status: PreviewHeadlessRouteCampaignStatus;
  readonly version: 7;
}

/** Deterministic aggregate derived only from inventory rows and terminal records. */
export interface PreviewHeadlessRouteCampaignSummary {
  readonly duplicate: number;
  readonly failed: number;
  readonly insufficientEvidence: number;
  readonly otherFailed: number;
  readonly pending: number;
  readonly partialBlocked: number;
  readonly postCommitFailed: number;
  readonly ready: number;
  readonly readyEmpty: number;
  readonly resumed: number;
  readonly runnable: number;
  readonly total: number;
  readonly unresolved: number;
}

/** Machine-readable final artifact written atomically after each completed route. */
export interface PreviewHeadlessRouteCampaignReport {
  readonly absenceExecutionRootPolicyDigest: string;
  readonly engineDigest: string;
  readonly inventory: PreviewInspectorCompleteRouteInventory;
  readonly inventoryCompilerIsolationPolicyDigest: string;
  readonly inventoryCompilerIsolationPolicyVersion: 3;
  readonly inventoryDigest: string;
  readonly inventoryReplayPolicyDigest: string;
  readonly executionPlanPolicyDigest: string;
  readonly managedChildEnvironmentPolicyDigest: string;
  readonly maxRoutes?: number;
  readonly metafileDependencyRecoveryPolicyDigest: string;
  readonly namespaceConfinementPolicyDigest: string;
  readonly requestDigest: string;
  readonly resolutionConfinement?: PreviewResolutionConfinement;
  readonly results: readonly PreviewHeadlessRouteCampaignRecord[];
  readonly routeIds: readonly string[];
  readonly retryRouteIds: readonly string[];
  readonly summary: PreviewHeadlessRouteCampaignSummary;
  readonly syntheticInputPolicyDigest: string;
  readonly targetFacadeOwnershipPolicyDigest: string;
  readonly version: 7;
}

/** Caller-owned paths, deadlines, isolated compiler, and optional deterministic test seam. */
export interface RunPreviewHeadlessRouteCampaignOptions {
  readonly chromiumPath?: string;
  readonly compileTimeoutMs?: number;
  /** Direct compiler used only for complete inert inventory collection. */
  readonly compiler: PreviewHeadlessRouteCampaignCompiler;
  readonly inventoryLimits?: Partial<PreviewInspectorCompleteRouteInventoryLimits>;
  readonly ledgerPath: string;
  /** Maximum total terminal records, including records already present on resume. */
  readonly maxRoutes?: number;
  readonly predecessorLedgerPath?: string;
  readonly renderRoute?: (
    compiler: PreviewCompiler,
    request: PreviewBuildRequest,
    options: PreviewHeadlessRendererOptions,
  ) => Promise<PreviewHeadlessResult>;
  readonly renderTimeoutMs?: number;
  readonly reportPath: string;
  readonly request: PreviewBuildRequest;
  /** Optional runnable route IDs. Execution remains in frozen inventory order. */
  readonly routeIds?: readonly string[];
  readonly retryRouteIds?: readonly string[];
  /** Collects and stages immutable artifacts without compiling or rendering a route. */
  readonly stageOnly?: boolean;
  /** Long-lived restartable worker that owns all sequential route builds. */
  readonly routeCompiler: PreviewHeadlessRouteCampaignIsolatedCompiler;
  readonly signal?: AbortSignal;
  readonly virtualTimeMs?: number;
}

/** Runs or resumes one sequential successor campaign and durably reports every terminal route. */
export async function runPreviewHeadlessRouteCampaign(
  options: RunPreviewHeadlessRouteCampaignOptions,
): Promise<PreviewHeadlessRouteCampaignReport> {
  assertPreviewCompilerWorkerIsolation(process.execArgv, process.env.NODE_OPTIONS);
  const compileTimeoutMs = normalizeTimeout(options.compileTimeoutMs, DEFAULT_COMPILE_TIMEOUT_MS);
  const renderTimeoutMs = normalizeTimeout(options.renderTimeoutMs, DEFAULT_RENDER_TIMEOUT_MS);
  const maxRoutes = normalizeMaxRoutes(options.maxRoutes);
  const routeIds = normalizeRouteIds(options.routeIds ?? [], 'Campaign route');
  const retryRouteIds = normalizeRetryRouteIds(options.retryRouteIds ?? []);
  if (options.predecessorLedgerPath !== undefined || retryRouteIds.length > 0) {
    throw new Error(
      'Campaign v5.5 requires a fresh ledger and does not carry predecessor terminal records.',
    );
  }
  const analysisRequest = createAnalysisRequest(options.request);
  const resolutionConfinement = createPreviewResolutionConfinementIdentity(analysisRequest);
  const inventory = await options.compiler.collectCompleteRouteInventory(
    analysisRequest,
    options.inventoryLimits,
    options.signal,
  );
  assertPreviewResolutionPaths(
    normalizePreviewResolutionConfinement(analysisRequest),
    inventory.dependencyPaths,
  );
  const requestDigest = digestJson(analysisRequest);
  const inventoryDigest = digestJson(inventory);
  const runnable = inventory.entries.filter(
    (entry): entry is PreviewInspectorCompleteRunnableRoute => entry.disposition === 'runnable',
  );
  const runnableIds = new Set(runnable.map((entry) => entry.id));
  for (const routeId of routeIds) {
    if (!runnableIds.has(routeId)) {
      throw new Error(`Campaign route ID is absent from the runnable inventory: ${routeId}`);
    }
  }
  const selectedRouteIds = new Set(routeIds);
  const selectedRoutes =
    routeIds.length === 0 ? runnable : runnable.filter((route) => selectedRouteIds.has(route.id));
  const engineDigest = digestJson({
    absenceExecutionRootPolicyDigest: PREVIEW_ABSENCE_EXECUTION_ROOT_POLICY_DIGEST,
    absenceExecutionRootPolicyVersion: PREVIEW_ABSENCE_EXECUTION_ROOT_POLICY_VERSION,
    campaignVersion: CAMPAIGN_VERSION,
    compilerDeadlineVersion: COMPILER_DEADLINE_VERSION,
    compilerIsolationVersion: COMPILER_ISOLATION_VERSION,
    compileTimeoutMs,
    evidencePolicyVersion: EVIDENCE_POLICY_VERSION,
    executionPlanPolicyDigest: PREVIEW_ROUTE_EXECUTION_PLAN_POLICY_DIGEST,
    executionPlanPolicyVersion: PREVIEW_ROUTE_EXECUTION_PLAN_POLICY_VERSION,
    failedCaptureMs: PREVIEW_HEADLESS_FAILED_CAPTURE_MS,
    inventoryReplayPolicyDigest: PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_DIGEST,
    inventoryReplayPolicyVersion: PREVIEW_COMPLETE_ROUTE_REPLAY_POLICY_VERSION,
    inventoryCompilerIsolationPolicyDigest:
      PREVIEW_INVENTORY_COMPILER_ISOLATION_POLICY_DIGEST,
    inventoryCompilerIsolationPolicyVersion:
      PREVIEW_INVENTORY_COMPILER_ISOLATION_POLICY_VERSION,
    renderTimeoutMs,
    namespaceConfinementPolicyDigest: PREVIEW_OWNED_NAMESPACE_POLICY_DIGEST,
    namespaceConfinementPolicyVersion: PREVIEW_OWNED_NAMESPACE_POLICY_VERSION,
    resolutionConfinementVersion: RESOLUTION_CONFINEMENT_VERSION,
    managedChildEnvironmentPolicyDigest: PREVIEW_MANAGED_CHILD_ENVIRONMENT_POLICY_DIGEST,
    managedChildEnvironmentPolicyVersion: PREVIEW_MANAGED_CHILD_ENVIRONMENT_POLICY_VERSION,
    metafileDependencyRecoveryPolicyDigest: PREVIEW_METAFILE_DEPENDENCY_RECOVERY_POLICY_DIGEST,
    metafileDependencyRecoveryPolicyVersion: PREVIEW_METAFILE_DEPENDENCY_RECOVERY_POLICY_VERSION,
    retryPolicyVersion: RETRY_POLICY_VERSION,
    routeTargetOwnershipPolicyVersion: ROUTE_TARGET_OWNERSHIP_POLICY_VERSION,
    stabilizationCapMs: PREVIEW_HEADLESS_STABILIZATION_CAP_MS,
    stabilizationQuietMs: PREVIEW_HEADLESS_STABILIZATION_QUIET_MS,
    syntheticInputPolicyDigest: PREVIEW_SYNTHETIC_INPUT_POLICY_DIGEST,
    syntheticInputPolicyVersion: PREVIEW_SYNTHETIC_INPUT_POLICY_VERSION,
    targetFacadeOwnershipPolicyDigest: PREVIEW_TARGET_FACADE_OWNERSHIP_POLICY_DIGEST,
    targetFacadeOwnershipPolicyVersion: PREVIEW_TARGET_FACADE_OWNERSHIP_POLICY_VERSION,
    virtualTimeMs: options.virtualTimeMs,
  });
  const header: PreviewHeadlessRouteCampaignLedgerHeader = Object.freeze({
    absenceExecutionRootPolicyDigest: PREVIEW_ABSENCE_EXECUTION_ROOT_POLICY_DIGEST,
    engineDigest,
    executionPlanPolicyDigest: PREVIEW_ROUTE_EXECUTION_PLAN_POLICY_DIGEST,
    inventoryDigest,
    inventoryCompilerIsolationPolicyDigest:
      PREVIEW_INVENTORY_COMPILER_ISOLATION_POLICY_DIGEST,
    inventoryCompilerIsolationPolicyVersion:
      PREVIEW_INVENTORY_COMPILER_ISOLATION_POLICY_VERSION,
    inventoryReplayPolicyDigest: inventory.replayPolicy.digest,
    kind: 'header',
    managedChildEnvironmentPolicyDigest: PREVIEW_MANAGED_CHILD_ENVIRONMENT_POLICY_DIGEST,
    ...(maxRoutes === undefined ? {} : { maxRoutes }),
    metafileDependencyRecoveryPolicyDigest: PREVIEW_METAFILE_DEPENDENCY_RECOVERY_POLICY_DIGEST,
    namespaceConfinementPolicyDigest: PREVIEW_OWNED_NAMESPACE_POLICY_DIGEST,
    requestDigest,
    ...(resolutionConfinement === undefined ? {} : { resolutionConfinement }),
    routeIds,
    retryRouteIds,
    syntheticInputPolicyDigest: PREVIEW_SYNTHETIC_INPUT_POLICY_DIGEST,
    targetFacadeOwnershipPolicyDigest: PREVIEW_TARGET_FACADE_OWNERSHIP_POLICY_DIGEST,
    version: 7,
  });
  const resumedRecords = await openOrCreateLedger(
    options.ledgerPath,
    header,
    [],
  );
  const recordsByRouteId = new Map(
    resumedRecords.map((record) => [record.routeId, record] as const),
  );
  for (const routeId of recordsByRouteId.keys()) {
    if (!runnableIds.has(routeId)) {
      throw new Error(
        `Campaign ledger contains a route absent from the frozen inventory: ${routeId}`,
      );
    }
    if (routeIds.length > 0 && !selectedRouteIds.has(routeId)) {
      throw new Error(
        `Campaign ledger contains a route outside the selected route IDs: ${routeId}`,
      );
    }
  }
  if (maxRoutes !== undefined && recordsByRouteId.size > maxRoutes) {
    throw new Error(
      `Campaign ledger contains ${recordsByRouteId.size.toString()} records, exceeding maxRoutes=${maxRoutes.toString()}.`,
    );
  }
  const resumed = recordsByRouteId.size;
  let report = createReport(inventory, [...recordsByRouteId.values()], resumed, header);
  await writeReportAtomically(options.reportPath, report);

  for (const route of options.stageOnly === true ? [] : selectedRoutes) {
    if (isSignalAborted(options.signal)) break;
    if (maxRoutes !== undefined && recordsByRouteId.size >= maxRoutes) break;
    if (recordsByRouteId.has(route.id)) continue;
    const startedAt = Date.now();
    const routeSelection = Object.freeze(
      route.executionPlan.selection.map((step) => Object.freeze({ ...step })),
    );
    const request = Object.freeze({
      ...analysisRequest,
      inspectorRouteSelection: routeSelection,
      routeExecutionPlan: route.executionPlan,
      ...(routeSelection.length === 0
        ? {}
        : { inspectorTargetMode: 'selected-route-leaf' as const }),
      renderMode: 'page-inspector' as const,
    });
    let record: PreviewHeadlessRouteCampaignRecord;
    try {
      if (routeSelection.length === 0) {
        throw new PreviewCompilationError(
          'React Preview could not validate the selected route leaf for runtime ownership.',
          [
            {
              message: 'A runnable campaign route did not contain a route selection.',
              severity: 'error',
            },
          ],
        );
      }
      const compiler = createDeadlineCompiler(
        options.routeCompiler,
        compileTimeoutMs,
        options.signal,
      );
      const headless = await (options.renderRoute ?? renderPreviewHeadlessly)(compiler, request, {
        ...(options.chromiumPath === undefined ? {} : { chromiumPath: options.chromiumPath }),
        timeoutMs: renderTimeoutMs,
        ...(options.virtualTimeMs === undefined ? {} : { virtualTimeMs: options.virtualTimeMs }),
      });
      if (isSignalAborted(options.signal)) break;
      record = createHeadlessRecord(route.id, headless, Date.now() - startedAt);
    } catch (error) {
      if (isSignalAborted(options.signal)) break;
      const timedOut =
        error instanceof PreviewHeadlessCampaignCompileTimeoutError ||
        error instanceof PreviewBuildStalledError;
      record = Object.freeze({
        diagnostics:
          error instanceof PreviewCompilationError ? Object.freeze([...error.diagnostics]) : [],
        durationMs: Date.now() - startedAt,
        error: boundText(error instanceof Error ? error.message : String(error)),
        kind: 'route',
        routeId: route.id,
        ...(error instanceof PreviewRouteExecutionPlanInvariantError
          ? { routeExecutionPlanInvariantEvidence: error.evidence }
          : {}),
        status:
          error instanceof PreviewRouteExecutionPlanInvariantError
            ? 'execution-plan-invariant'
            : timedOut
              ? 'compile-timeout'
              : 'compile-failed',
        version: 7,
      });
    }
    if (isSignalAborted(options.signal)) break;
    await appendLedgerRecord(options.ledgerPath, record);
    recordsByRouteId.set(route.id, record);
    report = createReport(inventory, [...recordsByRouteId.values()], resumed, header);
    await writeReportAtomically(options.reportPath, report);
    if (record.status === 'execution-plan-invariant') break;
  }
  return report;
}

/** Produces the concise human-readable line printed by the CLI. */
export function formatPreviewHeadlessRouteCampaignSummary(
  summary: PreviewHeadlessRouteCampaignSummary,
): string {
  return [
    `total=${summary.total.toString()}`,
    `runnable=${summary.runnable.toString()}`,
    `ready=${summary.ready.toString()}`,
    `ready-empty=${summary.readyEmpty.toString()}`,
    `partial-blocked=${summary.partialBlocked.toString()}`,
    `post-commit-failed=${summary.postCommitFailed.toString()}`,
    `insufficient-evidence=${summary.insufficientEvidence.toString()}`,
    `other-failed=${summary.otherFailed.toString()}`,
    `failed=${summary.failed.toString()}`,
    `unresolved=${summary.unresolved.toString()}`,
    `duplicate=${summary.duplicate.toString()}`,
    `resumed=${summary.resumed.toString()}`,
    `pending=${summary.pending.toString()}`,
  ].join(' ');
}

/** Races one worker request against a hard deadline, then awaits its recovery barrier. */
function createDeadlineCompiler(
  compiler: PreviewHeadlessRouteCampaignIsolatedCompiler,
  timeoutMs: number,
  campaignSignal?: AbortSignal,
): PreviewCompiler {
  return {
    compile: async (request: PreviewBuildRequest, context?: PreviewBuildExecutionContext) => {
      const controller = new AbortController();
      const detachContext = forwardAbort(context?.signal, controller);
      const detachCampaign = forwardAbort(campaignSignal, controller);
      const timeoutState = { timedOut: false };
      let timeoutReject!: (error: Error) => void;
      const watchdog = new Promise<never>((_resolve, reject) => {
        timeoutReject = reject;
      });
      const timer = setTimeout(() => {
        timeoutState.timedOut = true;
        controller.abort();
        void compiler.waitForCancellationRecovery().then(
          () => {
            timeoutReject(new PreviewHeadlessCampaignCompileTimeoutError(timeoutMs));
          },
          () => {
            timeoutReject(new PreviewHeadlessCampaignCompileTimeoutError(timeoutMs));
          },
        );
      }, timeoutMs);
      try {
        const compilation = compiler.compile(request, {
          ...(context?.reportProgress === undefined
            ? {}
            : { reportProgress: context.reportProgress }),
          signal: controller.signal,
        });
        return await Promise.race([compilation, watchdog]);
      } catch (error) {
        if (timeoutState.timedOut) {
          if (!(error instanceof PreviewHeadlessCampaignCompileTimeoutError)) {
            await compiler.waitForCancellationRecovery();
          }
          throw new PreviewHeadlessCampaignCompileTimeoutError(timeoutMs);
        }
        throw error;
      } finally {
        clearTimeout(timer);
        detachContext();
        detachCampaign();
      }
    },
  };
}

/** Converts one isolated browser outcome into an immutable terminal campaign record. */
function createHeadlessRecord(
  routeId: string,
  headless: PreviewHeadlessResult,
  durationMs: number,
): PreviewHeadlessRouteCampaignRecord {
  const cleanupComplete =
    headless.cleanup.browserTerminated &&
    headless.cleanup.profileRemoved &&
    headless.cleanup.serverClosed;
  const status: PreviewHeadlessRouteCampaignStatus = !cleanupComplete
    ? 'cleanup-failed'
    : headless.timeoutDiagnostic !== undefined
      ? 'render-timeout'
      : headless.status === 'protocol-error'
        ? 'protocol-error'
        : headless.status === 'failed'
          ? 'runtime-failed'
          : (headless.stabilizedOutcome ?? 'insufficient-evidence');
  return Object.freeze({
    diagnostics: Object.freeze([...headless.diagnostics]),
    durationMs,
    headless,
    kind: 'route',
    routeId,
    status,
    version: 7,
  });
}

/** Rebuilds the deterministic campaign report from its frozen inventory and durable records. */
function createReport(
  inventory: PreviewInspectorCompleteRouteInventory,
  records: readonly PreviewHeadlessRouteCampaignRecord[],
  resumed: number,
  header: PreviewHeadlessRouteCampaignLedgerHeader,
): PreviewHeadlessRouteCampaignReport {
  const orderedResults = Object.freeze(
    [...records].sort((left, right) => left.routeId.localeCompare(right.routeId)),
  );
  const runnable = inventory.counts.runnable;
  const ready = orderedResults.filter((record) => record.status === 'ready').length;
  const readyEmpty = orderedResults.filter((record) => record.status === 'ready-empty').length;
  const partialBlocked = orderedResults.filter(
    (record) => record.status === 'partial-blocked',
  ).length;
  const postCommitFailed = orderedResults.filter(
    (record) => record.status === 'post-commit-failed',
  ).length;
  const insufficientEvidence = orderedResults.filter(
    (record) => record.status === 'insufficient-evidence',
  ).length;
  const otherFailed =
    orderedResults.length -
    ready -
    readyEmpty -
    partialBlocked -
    postCommitFailed -
    insufficientEvidence;
  const summary = Object.freeze({
    duplicate: inventory.counts.duplicate,
    failed: partialBlocked + postCommitFailed + insufficientEvidence + otherFailed,
    insufficientEvidence,
    otherFailed,
    pending: runnable - orderedResults.length,
    partialBlocked,
    postCommitFailed,
    ready,
    readyEmpty,
    resumed,
    runnable,
    total: inventory.counts.total,
    unresolved: inventory.counts.unresolved,
  });
  return Object.freeze({
    absenceExecutionRootPolicyDigest: header.absenceExecutionRootPolicyDigest,
    engineDigest: header.engineDigest,
    executionPlanPolicyDigest: header.executionPlanPolicyDigest,
    inventory,
    inventoryCompilerIsolationPolicyDigest:
      header.inventoryCompilerIsolationPolicyDigest,
    inventoryCompilerIsolationPolicyVersion:
      header.inventoryCompilerIsolationPolicyVersion,
    inventoryDigest: header.inventoryDigest,
    inventoryReplayPolicyDigest: header.inventoryReplayPolicyDigest,
    managedChildEnvironmentPolicyDigest: header.managedChildEnvironmentPolicyDigest,
    ...(header.maxRoutes === undefined ? {} : { maxRoutes: header.maxRoutes }),
    metafileDependencyRecoveryPolicyDigest: header.metafileDependencyRecoveryPolicyDigest,
    namespaceConfinementPolicyDigest: header.namespaceConfinementPolicyDigest,
    requestDigest: header.requestDigest,
    ...(header.resolutionConfinement === undefined
      ? {}
      : { resolutionConfinement: header.resolutionConfinement }),
    results: orderedResults,
    routeIds: header.routeIds,
    retryRouteIds: header.retryRouteIds,
    summary,
    syntheticInputPolicyDigest: header.syntheticInputPolicyDigest,
    targetFacadeOwnershipPolicyDigest: header.targetFacadeOwnershipPolicyDigest,
    version: 7,
  });
}

/** Creates a fresh v5.5 ledger or validates an existing v5.5 ledger before resume. */
async function openOrCreateLedger(
  ledgerPath: string,
  expectedHeader: PreviewHeadlessRouteCampaignLedgerHeader,
  migratedRecords: readonly PreviewHeadlessRouteCampaignRecord[],
): Promise<readonly PreviewHeadlessRouteCampaignRecord[]> {
  await mkdir(path.dirname(path.resolve(ledgerPath)), { recursive: true });
  let contents: string;
  try {
    contents = await readFile(ledgerPath, 'utf8');
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
    const initialContents = `${[
      JSON.stringify(expectedHeader),
      ...migratedRecords.map((record) => JSON.stringify(record)),
    ].join('\n')}\n`;
    await writeFile(ledgerPath, initialContents, { encoding: 'utf8', flag: 'wx' });
    return Object.freeze([...migratedRecords]);
  }
  const lines = splitLedgerLines(contents);
  const headerValue = parseLedgerValue(lines[0], 'header');
  if (headerValue.version !== expectedHeader.version) {
    throw new Error('Campaign ledger does not match the frozen request, inventory, or engine.');
  }
  const header = headerValue as unknown as PreviewHeadlessRouteCampaignLedgerHeader;
  if (
    header.absenceExecutionRootPolicyDigest !== expectedHeader.absenceExecutionRootPolicyDigest ||
    header.requestDigest !== expectedHeader.requestDigest ||
    header.inventoryDigest !== expectedHeader.inventoryDigest ||
    header.inventoryCompilerIsolationPolicyDigest !==
      expectedHeader.inventoryCompilerIsolationPolicyDigest ||
    headerValue.inventoryCompilerIsolationPolicyVersion !==
      expectedHeader.inventoryCompilerIsolationPolicyVersion ||
    header.inventoryReplayPolicyDigest !== expectedHeader.inventoryReplayPolicyDigest ||
    header.executionPlanPolicyDigest !== expectedHeader.executionPlanPolicyDigest ||
    header.engineDigest !== expectedHeader.engineDigest ||
    header.maxRoutes !== expectedHeader.maxRoutes ||
    header.managedChildEnvironmentPolicyDigest !==
      expectedHeader.managedChildEnvironmentPolicyDigest ||
    header.metafileDependencyRecoveryPolicyDigest !==
      expectedHeader.metafileDependencyRecoveryPolicyDigest ||
    header.namespaceConfinementPolicyDigest !== expectedHeader.namespaceConfinementPolicyDigest ||
    stableJson(header.resolutionConfinement) !== stableJson(expectedHeader.resolutionConfinement) ||
    stableJson(header.routeIds) !== stableJson(expectedHeader.routeIds) ||
    stableJson(header.retryRouteIds) !== stableJson(expectedHeader.retryRouteIds) ||
    header.syntheticInputPolicyDigest !== expectedHeader.syntheticInputPolicyDigest ||
    header.targetFacadeOwnershipPolicyDigest !== expectedHeader.targetFacadeOwnershipPolicyDigest
  ) {
    throw new Error('Campaign ledger does not match the frozen request, inventory, or engine.');
  }
  const records = lines.slice(1).map((line) => {
    const recordValue = parseLedgerValue(line, 'route');
    if (recordValue.version !== 7 || typeof recordValue.routeId !== 'string') {
      throw new Error('Campaign ledger contains an incompatible route record.');
    }
    const record = recordValue as unknown as PreviewHeadlessRouteCampaignRecord;
    return Object.freeze(record);
  });
  assertUniqueRouteRecords(records, 'Campaign ledger');
  return Object.freeze(records);
}

/** Rejects duplicate route terminals before campaign state is trusted. */
function assertUniqueRouteRecords(
  records: readonly { readonly routeId: string }[],
  label: string,
): void {
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.routeId)) {
      throw new Error(`${label} contains duplicate terminal route records: ${record.routeId}`);
    }
    ids.add(record.routeId);
  }
}

/** Durably appends one terminal record and fsyncs it before report publication. */
async function appendLedgerRecord(
  ledgerPath: string,
  record: PreviewHeadlessRouteCampaignRecord,
): Promise<void> {
  const handle = await open(ledgerPath, 'a');
  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Replaces the human-readable report atomically after durable ledger append. */
async function writeReportAtomically(
  reportPath: string,
  report: PreviewHeadlessRouteCampaignReport,
): Promise<void> {
  const absolutePath = path.resolve(reportPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${process.pid.toString()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(report, undefined, 2)}\n`, 'utf8');
  await rename(temporaryPath, absolutePath);
}

/** Freezes one analysis-only request shared by inventory collection and request identity. */
function createAnalysisRequest(request: PreviewBuildRequest): PreviewBuildRequest {
  const analysisRequest = {
    ...request,
    renderMode: 'page-inspector',
  } as const;
  Reflect.deleteProperty(analysisRequest, 'inspectorRouteSelection');
  Reflect.deleteProperty(analysisRequest, 'inspectorTargetMode');
  Reflect.deleteProperty(analysisRequest, 'routeExecutionPlan');
  return Object.freeze(analysisRequest);
}

/** Hashes stable JSON for request, inventory, and engine identities. */
function digestJson(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

/** Serializes JSON-compatible data with deterministic object-key ordering. */
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

/** Splits JSONL while tolerating a final newline. */
function splitLedgerLines(contents: string): readonly string[] {
  return contents.split(/\r?\n/gu).filter((line) => line.trim().length > 0);
}

/** Parses and minimally validates one untrusted ledger JSONL value. */
function parseLedgerValue(
  source: string | undefined,
  expectedKind: 'header' | 'route',
): Record<string, unknown> {
  if (source === undefined) throw new Error('Campaign ledger is empty.');
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('Campaign ledger contains malformed JSON.');
  }
  if (value === null || typeof value !== 'object' || Reflect.get(value, 'kind') !== expectedKind) {
    throw new Error(`Campaign ledger is missing its ${expectedKind} record.`);
  }
  return value as Record<string, unknown>;
}

/** Normalizes the explicitly unsupported predecessor retry route selector. */
function normalizeRetryRouteIds(routeIds: readonly string[]): readonly string[] {
  return normalizeRouteIds(routeIds, 'Retry route');
}

/** Normalizes and deduplicates one explicit route-ID selector. */
function normalizeRouteIds(routeIds: readonly string[], label: string): readonly string[] {
  const normalized = routeIds.map((routeId) => routeId.trim());
  if (normalized.some((routeId) => routeId.length === 0)) {
    throw new Error(`${label} IDs cannot be empty.`);
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} IDs must be unique.`);
  }
  return Object.freeze([...normalized].sort());
}

/** Accepts only a positive safe campaign route bound. */
function normalizeMaxRoutes(maxRoutes: number | undefined): number | undefined {
  if (maxRoutes === undefined) return undefined;
  if (!Number.isSafeInteger(maxRoutes) || maxRoutes <= 0) {
    throw new Error('Campaign maxRoutes must be a positive safe integer.');
  }
  return maxRoutes;
}

/** Forwards one optional abort signal and returns a listener cleanup callback. */
function forwardAbort(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (signal === undefined)
    return () => {
      // No listener was attached.
    };
  const abort = (): void => {
    controller.abort();
  };
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  return () => {
    signal.removeEventListener('abort', abort);
  };
}

/** Checks an optional signal without manufacturing one for CLI callers. */
function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/** Normalizes one positive safe timeout duration. */
function normalizeTimeout(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isSafeInteger(value) || value < 1 ? fallback : value;
}

/** Bounds durable error text written to campaign artifacts. */
function boundText(value: string): string {
  return value.slice(0, MAX_ERROR_TEXT);
}

/** Recognizes a missing ledger before its exclusive initial creation. */
function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && Reflect.get(error, 'code') === 'ENOENT';
}

/** Campaign-local timeout used to classify hard compile deadlines durably. */
class PreviewHeadlessCampaignCompileTimeoutError extends Error {
  /** Creates one campaign-local hard compilation deadline error. */
  public constructor(timeoutMs: number) {
    super(`Preview compilation exceeded ${timeoutMs.toString()} ms.`);
    this.name = 'PreviewHeadlessCampaignCompileTimeoutError';
  }
}
