import { isPreviewTsxCorpusFrozenPolicy } from './previewTsxCorpusPolicy';
/** Freezes campaign identity, source manifest, reference artifacts, and sentinel contracts. */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { writePreviewTsxCorpusJsonAtomic } from './previewHeadlessTsxCorpusCampaignArtifacts';
import {
  PREVIEW_TSX_CORPUS_CLASSIFIER_VERSION,
  PREVIEW_TSX_CORPUS_STAGE_PROTOCOL_VERSION,
  PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY,
  type PreviewTsxCorpusAttemptKind,
  type PreviewTsxCorpusAttemptRecord,
  type PreviewTsxCorpusWorkerResult,
} from './previewHeadlessTsxCorpusCampaignTypes';
import {
  canonicalExists,
  digest,
  digestJson,
  directoryHasEntries,
  pad,
  parseManifest,
  readJsonIfPresent,
  readLedgerDigests,
  writeBufferAtomic,
  writeJsonAtomic,
} from './previewTsxCorpusFiles';
import { LaneRowFailure, PrimaryLane } from './previewTsxCorpusLane';
import type {
  CampaignIdentity,
  CampaignOptions,
  CampaignState,
  LaneRowOutcome,
} from './previewTsxCorpusModel';

/** Validates immutable inputs and creates or resumes campaign-owned directories, identities, and ledger state. */
export async function prepareCampaign(options: CampaignOptions): Promise<CampaignState> {
  await mkdir(options.artifacts, { recursive: true });
  const manifestSource = await readFile(options.manifestPath, 'utf8');
  const rows = parseManifest(manifestSource);
  const corridorSuffix =
    'legal/right-to-consent-or-consult/pages/rtcc-investment-contract-management-page/investment-agreement-management-modals.tsx';
  const corridorMatches = rows
    .map((row, index) => ({ index, row }))
    .filter(({ row }) => row.path.endsWith(corridorSuffix));
  if (corridorMatches.length !== 1) {
    throw new Error(
      `v9 mandatory corridor resolution expected one match, found ${corridorMatches.length.toString()}.`,
    );
  }
  const corridor = corridorMatches[0];
  if (corridor === undefined || !/^[a-f0-9]{64}$/u.test(corridor.row.sha256)) {
    throw new Error('v9 mandatory corridor digest is absent or invalid.');
  }
  const manifestSha256 = digest(manifestSource);
  const runtimeSource = await readFile(options.runtimePath);
  const engineDigest = digest(runtimeSource);
  const classifierDigest = digestJson({
    classifierVersion: PREVIEW_TSX_CORPUS_CLASSIFIER_VERSION,
    categories: [
      'successful meaningful render',
      'blocker',
      'Unrendered',
      'blank/empty output',
      'incomplete page composition',
      'runtime/build failure',
      'explicitly structurally non-renderable',
    ],
  });
  const policyDigest = digestJson({
    ...PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY,
    stageProtocolVersion: PREVIEW_TSX_CORPUS_STAGE_PROTOCOL_VERSION,
  });
  const campaignArtifacts = path.join(options.artifacts, 'campaigns', engineDigest);
  const campaignOptions = { ...options, artifacts: campaignArtifacts };
  await Promise.all(
    ['attempts', 'canonical', 'canonical-staging', 'raw'].map(async (name) =>
      mkdir(path.join(campaignArtifacts, name), { recursive: true }),
    ),
  );
  const identity: CampaignIdentity = {
    classifierDigest,
    engineDigest,
    manifestSha256,
    phase: options.phase,
    policyDigest,
    sourceRoot: path.resolve(options.sourceRoot),
    version: 1,
    workspace: path.resolve(options.workspace),
  };
  let selectedLaneCount: 12 | 14 | 16 | undefined;
  if (options.policyPath !== undefined) {
    const frozen = await readJsonIfPresent<unknown>(options.policyPath);
    if (
      !isPreviewTsxCorpusFrozenPolicy(frozen) ||
      frozen.manifestSha256 !== manifestSha256 ||
      frozen.engineDigest !== engineDigest ||
      frozen.policyDigest !== policyDigest ||
      (options.primaryJobs !== undefined && frozen.laneCount !== options.primaryJobs) ||
      frozen.sentinels.length === 0 ||
      !frozen.sentinels.some(
        (sentinel) => sentinel.index === corridor.index && sentinel.digest === corridor.row.sha256,
      )
    )
      throw new Error(
        'Frozen v9 policy does not match the exact runtime, manifest, or protocol identity.',
      );
    selectedLaneCount = frozen.laneCount;
  }
  await assertOrWriteIdentity(campaignArtifacts, identity);
  await writeJsonAtomic(path.join(options.artifacts, 'active-campaign.json'), {
    artifacts: path.relative(options.artifacts, campaignArtifacts),
    engineDigest,
    phase: options.phase,
    policyDigest,
    version: 1,
  });
  const ledgerPath = path.join(campaignArtifacts, 'ledger.jsonl');
  const ledgerDigests = await readLedgerDigests(ledgerPath);
  return {
    identity,
    ledgerDigests,
    ledgerWriteChain: Promise.resolve(),
    options: campaignOptions,
    orderedCommits: new Map(),
    orderedFrontier: -1,
    orderedTimeline: [],
    rows,
    ...(selectedLaneCount === undefined ? {} : { selectedLaneCount }),
    sentinelIndices: [corridor.index],
    warmupBarrierEpochMs: undefined,
  };
}

/** Returns manifest-order indices whose canonical record is not already valid for this campaign. */
export async function pendingCanonicalIndices(
  state: CampaignState,
  limit: number,
): Promise<readonly number[]> {
  const pending: number[] = [];
  for (let index = 0; index < limit; index += 1) {
    if (!(await canonicalExists(state, index))) pending.push(index);
  }
  return pending;
}

/** Returns the stable primary-attempt filename for one manifest index. */
export function primaryAttemptRecordPath(state: CampaignState, index: number): string {
  return path.join(state.options.artifacts, 'attempts', pad(index), 'primary.json');
}

/** Runs mandatory sentinel rows at a lane generation boundary and records their exact semantic certification. */
export async function certifyGenerationSentinels(
  state: CampaignState,
  lane: PrimaryLane,
  boundary: 'drain' | 'start',
): Promise<boolean> {
  const comparisons: unknown[] = [];
  for (const index of state.sentinelIndices) {
    let warm: LaneRowOutcome;
    try {
      warm = await lane.run(index);
    } catch (error) {
      if (error instanceof LaneRowFailure) {
        await persistSentinelFailure(state, lane, boundary, 'warm', error);
      }
      throw error;
    }
    await persistSentinelOutcome(state, lane, boundary, 'warm', warm);
    lane.ack(index);
    try {
      const warmSignature = semanticSentinelSignature(warm.result);
      const reference = await loadOrCreateV10Reference(state, lane, index);
      const matched =
        digestJson(warmSignature) === digestJson(reference) &&
        strictCorridorSignature(warmSignature);
      const comparison = { cachedReference: reference, index, matched, warm: warmSignature };
      comparisons.push(comparison);
      const directory = path.join(
        state.options.artifacts,
        'sentinels',
        lane.generationId,
        boundary,
      );
      await mkdir(directory, { recursive: true });
      await writeJsonAtomic(path.join(directory, `${pad(index)}.comparison.json`), {
        ...comparison,
        sha256: digestJson(comparison),
        version: 3,
      });
      if (!matched) return false;
    } catch (error) {
      if (error instanceof LaneRowFailure) {
        await persistSentinelFailure(state, lane, boundary, 'fresh', error);
      }
      throw error;
    }
  }
  return comparisons.length === state.sentinelIndices.length;
}

/** Exactly one fresh corridor reference is retained outside candidate namespaces. */
export async function loadOrCreateV10Reference(
  state: CampaignState,
  lane: PrimaryLane,
  index: number,
): Promise<Readonly<Record<string, unknown>>> {
  if (state.referenceSignature !== undefined) return state.referenceSignature;
  const cachePath = path.join(
    state.options.referenceRoot ?? state.options.artifacts,
    'reference.json',
  );
  const semanticKey = digestJson({
    chromiumPath: path.resolve(state.options.chromiumPath),
    classifierDigest: state.identity.classifierDigest,
    engineDigest: state.identity.engineDigest,
    manifestSha256: state.identity.manifestSha256,
    policyDigest: state.identity.policyDigest,
    sourceRoot: state.identity.sourceRoot,
    timeoutMs: PREVIEW_TSX_CORPUS_SUPERVISOR_POLICY.rendererDeadlineMs,
    virtualTimeMs: 5_000,
    workspace: state.identity.workspace,
  });
  const cached = await readJsonIfPresent<{
    readonly semanticKey: string;
    readonly signature: Readonly<Record<string, unknown>>;
  }>(cachePath);
  if (cached !== undefined) {
    if (cached.semanticKey !== semanticKey)
      throw new Error('v10 cached reference semantic identity mismatch.');
    state.referenceSignature = cached.signature;
    return cached.signature;
  }
  const fresh = new PrimaryLane(state, 10_000 + lane.laneId);
  try {
    const outcome = await fresh.run(index);
    await persistSentinelOutcome(state, lane, 'start', 'fresh', outcome);
    fresh.ack(index);
    const cleanup = await fresh.drainShutdown();
    if (
      !cleanup.closeObserved ||
      !cleanup.groupAbsent ||
      !cleanup.listenersDetached ||
      !cleanup.streamsTerminal
    ) {
      throw new Error('v10 fresh reference cleanup was inconclusive.');
    }
    const signature = semanticSentinelSignature(outcome.result);
    if (!strictCorridorSignature(signature))
      throw new Error('v10 fresh reference lacks strict Page Context fidelity.');
    const reference = { cleanup, semanticKey, signature, version: 10 };
    const checksum = await writePreviewTsxCorpusJsonAtomic(cachePath, reference);
    await writePreviewTsxCorpusJsonAtomic(`${cachePath}.checksum.json`, {
      ...checksum,
      semanticKey,
      version: 10,
    });
    state.referenceSignature = signature;
    return signature;
  } catch (error) {
    await fresh.abort('v10 fresh reference failed.');
    throw error;
  }
}

/** Writes failed sentinel execution and cleanup evidence without issuing a generation certificate. */
export async function persistSentinelFailure(
  state: CampaignState,
  lane: PrimaryLane,
  boundary: 'drain' | 'start',
  mode: 'fresh' | 'warm',
  failure: LaneRowFailure,
): Promise<void> {
  const outcome = failure.outcome;
  const directory = path.join(
    state.options.artifacts,
    'sentinels',
    lane.generationId,
    boundary,
    mode,
    pad(outcome.index),
  );
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeBufferAtomic(path.join(directory, 'stdout'), outcome.stdout),
    writeBufferAtomic(path.join(directory, 'stderr'), outcome.stderr),
    writeBufferAtomic(path.join(directory, 'stages.jsonl'), outcome.stages),
  ]);
  await writeJsonAtomic(path.join(directory, 'failure.json'), {
    cleanup: failure.cleanup,
    commandId: outcome.commandId,
    diagnosticsProtocolValid: outcome.protocolValid,
    generationId: outcome.generationId,
    index: outcome.index,
    laneProcess: outcome.laneProcess,
    lifecycle: outcome.lifecycle,
    reason: failure.message,
    truncation: outcome.truncation,
    version: 3,
  });
}

/** Persists a completed sentinel attempt with the signature used to compare generation fidelity. */
export async function persistSentinelOutcome(
  state: CampaignState,
  lane: PrimaryLane,
  boundary: 'drain' | 'start',
  mode: 'fresh' | 'warm',
  outcome: LaneRowOutcome,
): Promise<void> {
  const directory = path.join(
    state.options.artifacts,
    'sentinels',
    lane.generationId,
    boundary,
    mode,
    pad(outcome.index),
  );
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeBufferAtomic(path.join(directory, 'stdout'), outcome.stdout),
    writeBufferAtomic(path.join(directory, 'stderr'), outcome.stderr),
    writeBufferAtomic(path.join(directory, 'stages.jsonl'), outcome.stages),
  ]);
  await writeJsonAtomic(path.join(directory, 'outcome.json'), {
    commandId: outcome.commandId,
    diagnosticsProtocolValid: outcome.protocolValid,
    generationId: outcome.generationId,
    index: outcome.index,
    result: outcome.result,
    truncation: outcome.truncation,
    version: 3,
  });
}

/** Projects only semantic and fidelity evidence needed to compare a sentinel with its frozen reference. */
export function semanticSentinelSignature(
  result: PreviewTsxCorpusWorkerResult,
): Readonly<Record<string, unknown>> {
  const headless = result.headless;
  const composition = headless?.stabilization?.compositionSnapshot;
  return {
    category:
      result.kind === 'headless-result' && headless?.status === 'ready'
        ? 'successful meaningful render'
        : 'runtime/build failure',
    contextSource: composition?.contextModuleSourcePath,
    errorPresence:
      result.error !== undefined ||
      headless?.protocolError !== undefined ||
      headless?.runtimeErrorText !== undefined,
    fidelity: composition?.pageExecutionFidelity,
    kind: result.kind,
    outcome: headless?.stabilizedOutcome,
    output: composition?.targetHasOutput,
    pageRoot: composition?.targetPageRootCommitted,
    standaloneTarget: composition?.pageExecutionStandaloneTarget === true,
    source: composition?.targetSourcePath,
    stage: composition?.targetStage,
    status: headless?.status,
    target: composition?.targetExportName,
    capReached: headless?.stabilization?.capReached,
    postTerminalSnapshot: headless?.stabilization?.postTerminalSnapshotReceived,
    quiet: headless?.stabilization?.quiet,
    truncated: composition?.criticalEvidenceTruncated,
  };
}

/** Requires the sentinel signature to prove the mandatory authored corridor rather than a degraded fallback. */
export function strictCorridorSignature(signature: Readonly<Record<string, unknown>>): boolean {
  return (
    signature.category === 'successful meaningful render' &&
    signature.fidelity !== 'none' &&
    (signature.fidelity !== 'target-only' || signature.standaloneTarget === true) &&
    signature.output === true &&
    signature.pageRoot === true
  );
}

/** Commits a missing campaign identity or rejects a persisted identity that differs from the current frozen inputs. */
export async function assertOrWriteIdentity(
  artifacts: string,
  identity: CampaignIdentity,
): Promise<void> {
  const filePath = path.join(artifacts, 'identity.json');
  const existing = await readJsonIfPresent<CampaignIdentity>(filePath);
  if (existing === undefined) {
    await writeJsonAtomic(filePath, identity);
    return;
  }
  if (digestJson(existing) !== digestJson(identity)) {
    if (await directoryHasEntries(path.join(artifacts, 'canonical'))) {
      throw new Error('Campaign identity does not match the immutable existing artifact phase.');
    }
    await writeJsonAtomic(
      path.join(artifacts, `identity-precanonical-${existing.engineDigest}.json`),
      existing,
    );
    await writeJsonAtomic(filePath, identity);
  }
}

/** Rejects an attempt record whose source, engine, or policy identity differs from the active campaign. */
export function assertAttemptIdentity(
  record: PreviewTsxCorpusAttemptRecord,
  state: CampaignState,
  index: number,
  attemptKind: PreviewTsxCorpusAttemptKind,
): void {
  const row = state.rows[index];
  // Runtime tags read from persisted records remain unknown until this identity check succeeds.
  const deadlineMs: unknown = record.deadlineMs;
  const version: unknown = record.version;
  if (
    row === undefined ||
    record.index !== index ||
    record.path !== row.path ||
    record.attemptKind !== attemptKind ||
    record.policyDigest !== state.identity.policyDigest ||
    deadlineMs !== 90000 ||
    version !== 3
  ) {
    throw new Error(`Attempt identity mismatch at manifest index ${index.toString()}.`);
  }
}

/** Checks target source evidence against the frozen manifest row before promoting execution fidelity. */
export function targetSourceIsExact(
  value: string | undefined,
  rowPath: string,
  sourceRoot: string,
): boolean {
  if (value === undefined || value.length === 0) return false;
  const expected = path.resolve(sourceRoot, rowPath);
  const actual = path.isAbsolute(value) ? path.resolve(value) : path.resolve(sourceRoot, value);
  return actual === expected;
}
