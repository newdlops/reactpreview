/** Generic command-line entry point for resumable compiler-to-Chromium route campaigns. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  PreviewBuildRequest,
  PreviewResolutionConfinement,
  PreviewSourceLanguage,
} from '../../domain/preview';
import { PreviewCompleteRouteInventoryWorkerClient } from '../worker/previewCompleteRouteInventoryWorkerClient';
import { PreviewCompilerWorkerClient } from '../worker/previewCompilerWorkerClient';
import { assertPreviewCompilerWorkerIsolation } from '../worker/previewCompilerWorkerIsolation';
import {
  formatPreviewHeadlessRouteCampaignSummary,
  runPreviewHeadlessRouteCampaign,
} from './previewHeadlessRouteCampaign';

export interface PreviewHeadlessRouteCampaignArguments {
  readonly chromium: string;
  readonly ledger: string;
  readonly maxRoutes?: number;
  readonly predecessorLedger?: string;
  readonly report: string;
  readonly resolutionConfinement?: PreviewResolutionConfinement;
  readonly routeIds: readonly string[];
  readonly retryRouteIds: readonly string[];
  readonly stageOnly: boolean;
  readonly target: string;
  readonly tsconfig?: string;
  readonly workspace: string;
}

/** Parses inputs, runs to completion, and returns a conventional process exit code. */
export async function runPreviewHeadlessRouteCampaignCli(
  arguments_: readonly string[],
  workerPath: string,
): Promise<number> {
  assertPreviewCompilerWorkerIsolation(process.execArgv, process.env.NODE_OPTIONS);
  const values = parsePreviewHeadlessRouteCampaignArguments(arguments_);
  const target = path.resolve(values.target);
  const workspace = path.resolve(values.workspace);
  const sourceText = await readFile(target, 'utf8');
  const request: PreviewBuildRequest = Object.freeze({
    dependencySnapshots: Object.freeze([]),
    documentPath: target,
    language: inferLanguage(target),
    preparationMode: 'fast',
    renderMode: 'page-inspector',
    ...(values.resolutionConfinement === undefined
      ? {}
      : { resolutionConfinement: values.resolutionConfinement }),
    sourceText,
    ...(values.tsconfig === undefined ? {} : { tsconfigPath: path.resolve(values.tsconfig) }),
    useStorybookPreview: true,
    workspaceRoot: workspace,
  });
  const inventoryCompiler = new PreviewCompleteRouteInventoryWorkerClient(
    path.resolve(workerPath),
  );
  const routeCompiler = new PreviewCompilerWorkerClient(path.resolve(workerPath), {
    cancellationGraceMs: 3_000,
    idleWorkerTimeoutMs: 60_000,
  });
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort();
  };
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  try {
    const report = await runPreviewHeadlessRouteCampaign({
      chromiumPath: path.resolve(values.chromium),
      compiler: inventoryCompiler,
      ledgerPath: path.resolve(values.ledger),
      ...(values.maxRoutes === undefined ? {} : { maxRoutes: values.maxRoutes }),
      ...(values.predecessorLedger === undefined
        ? {}
        : { predecessorLedgerPath: path.resolve(values.predecessorLedger) }),
      reportPath: path.resolve(values.report),
      request,
      routeIds: values.routeIds,
      retryRouteIds: values.retryRouteIds,
      routeCompiler,
      signal: controller.signal,
      stageOnly: values.stageOnly,
    });
    process.stdout.write(`${formatPreviewHeadlessRouteCampaignSummary(report.summary)}\n`);
    return report.summary.pending === 0 ? 0 : 2;
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
    await routeCompiler.shutdown();
  }
}

/** Parses and normalizes the campaign CLI contract without reading the filesystem. */
export function parsePreviewHeadlessRouteCampaignArguments(
  arguments_: readonly string[],
): PreviewHeadlessRouteCampaignArguments {
  const values = new Map<string, string>();
  const approvedDependencyRoots: string[] = [];
  const routeIds: string[] = [];
  const retryRouteIds: string[] = [];
  let stageOnly = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const name = arguments_[index];
    if (!name?.startsWith('--')) {
      throw new Error(`Unexpected campaign argument: ${name ?? '<missing>'}`);
    }
    if (name === '--stage-only') {
      if (stageOnly) throw new Error('Duplicate campaign argument: --stage-only');
      stageOnly = true;
      continue;
    }
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Campaign argument ${name} requires a value.`);
    }
    if (
      ![
        '--approved-dependency-root',
        '--chromium',
        '--confinement-policy-digest',
        '--dependency-view-digest',
        '--ledger',
        '--max-routes',
        '--predecessor-ledger',
        '--report',
        '--route-id',
        '--retry-route',
        '--source-manifest-digest',
        '--source-root',
        '--target',
        '--tsconfig',
        '--workspace',
      ].includes(name)
    ) {
      throw new Error(`Unknown campaign argument: ${name}`);
    }
    if (name === '--approved-dependency-root') {
      approvedDependencyRoots.push(value);
      index += 1;
      continue;
    }
    if (name === '--retry-route' || name === '--route-id') {
      (name === '--retry-route' ? retryRouteIds : routeIds).push(value);
      index += 1;
      continue;
    }
    if (values.has(name)) throw new Error(`Duplicate campaign argument: ${name}`);
    values.set(name, value);
    index += 1;
  }
  for (const required of ['--chromium', '--ledger', '--report', '--target', '--workspace']) {
    if (!values.has(required)) throw new Error(`Missing required campaign argument: ${required}`);
  }
  const tsconfig = values.get('--tsconfig');
  const maxRoutesValue = values.get('--max-routes');
  const predecessorLedger = values.get('--predecessor-ledger');
  const normalizedRouteIds = normalizeRepeatedRouteIds(routeIds, '--route-id');
  const resolutionConfinement = parseResolutionConfinement(values, approvedDependencyRoots);
  return Object.freeze({
    chromium: values.get('--chromium') ?? '',
    ledger: values.get('--ledger') ?? '',
    ...(maxRoutesValue === undefined
      ? {}
      : { maxRoutes: parsePositiveSafeInteger(maxRoutesValue, '--max-routes') }),
    ...(predecessorLedger === undefined ? {} : { predecessorLedger }),
    report: values.get('--report') ?? '',
    ...(resolutionConfinement === undefined ? {} : { resolutionConfinement }),
    routeIds: normalizedRouteIds,
    retryRouteIds: Object.freeze(retryRouteIds),
    stageOnly,
    target: values.get('--target') ?? '',
    ...(tsconfig === undefined ? {} : { tsconfig }),
    workspace: values.get('--workspace') ?? '',
  });
}

/** Requires the complete immutable snapshot-confinement identity or none of it. */
function parseResolutionConfinement(
  values: ReadonlyMap<string, string>,
  approvedDependencyRoots: readonly string[],
): PreviewResolutionConfinement | undefined {
  const sourceRoot = values.get('--source-root');
  const sourceManifestDigest = values.get('--source-manifest-digest');
  const dependencyViewDigest = values.get('--dependency-view-digest');
  const policyDigest = values.get('--confinement-policy-digest');
  const configured =
    sourceRoot !== undefined ||
    sourceManifestDigest !== undefined ||
    dependencyViewDigest !== undefined ||
    policyDigest !== undefined ||
    approvedDependencyRoots.length > 0;
  if (!configured) return undefined;
  if (
    sourceRoot === undefined ||
    sourceManifestDigest === undefined ||
    dependencyViewDigest === undefined ||
    policyDigest === undefined ||
    approvedDependencyRoots.length === 0
  ) {
    throw new Error('Snapshot confinement arguments must be supplied together.');
  }
  const normalizedRoots = approvedDependencyRoots.map((root) => path.resolve(root));
  if (new Set(normalizedRoots).size !== normalizedRoots.length) {
    throw new Error('Approved dependency roots must not contain duplicates.');
  }
  return Object.freeze({
    approvedDependencyRoots: Object.freeze([...normalizedRoots].sort()),
    dependencyViewDigest,
    policyDigest,
    sourceManifestDigest,
    sourceRoot: path.resolve(sourceRoot),
  });
}

/** Trims, validates, and sorts repeatable route filters for stable campaign identity. */
function normalizeRepeatedRouteIds(
  routeIds: readonly string[],
  argumentName: string,
): readonly string[] {
  const normalized = routeIds.map((routeId) => routeId.trim());
  if (normalized.some((routeId) => routeId.length === 0)) {
    throw new Error(`Campaign argument ${argumentName} cannot be empty.`);
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`Campaign argument ${argumentName} must not contain duplicates.`);
  }
  return Object.freeze([...normalized].sort());
}

/** Parses one CLI integer without accepting signs, decimals, zero, or unsafe values. */
function parsePositiveSafeInteger(value: string, argumentName: string): number {
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new Error(`Campaign argument ${argumentName} must be a positive safe integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Campaign argument ${argumentName} must be a positive safe integer.`);
  }
  return parsed;
}

/** Maps a supported source extension to the compiler language discriminator. */
function inferLanguage(sourcePath: string): PreviewSourceLanguage {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return 'tsx';
  if (extension === '.ts') return 'ts';
  if (extension === '.jsx') return 'jsx';
  if (extension === '.js') return 'js';
  throw new Error(`Unsupported preview target extension: ${extension}`);
}
