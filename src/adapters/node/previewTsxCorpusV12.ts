/** Coordinates the filtered acceleration campaign and its candidate artifacts. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { EsbuildPreviewCompiler } from '../esbuild/esbuildPreviewCompiler';
import { renderCompiledPreviewHeadlessly } from './previewHeadlessRenderer';
import {
  readPreviewTsxCorpusChecksummedJson,
  writePreviewTsxCorpusJsonAtomic,
} from './previewHeadlessTsxCorpusCampaignArtifacts';
import {
  validatePreviewTsxCorpusTriageSelection,
  type PreviewTsxCorpusTriageSelectionArtifact,
} from './previewHeadlessTsxCorpusSelection';
import { digest, digestJson, parseManifest, readJsonIfPresent } from './previewTsxCorpusFiles';
import {
  FILTERED_CAMPAIGN_WATCHDOG_RATE_PER_MINUTE,
  FILTERED_JSX_EXPORT_MANIFEST_ROWS,
  FILTERED_JSX_EXPORT_MANIFEST_SHA256,
  type V12AccelerationOptions,
} from './previewTsxCorpusModel';
import { semanticSentinelSignature } from './previewTsxCorpusPreparation';
import { runV12Candidate } from './previewTsxCorpusV12Candidate';
import { v12Request } from './previewTsxCorpusV12Compiler';

/** Runs the requested acceleration campaign and retains a terminal failure report if orchestration rejects. */
export async function acceleratePreviewHeadlessTsxCorpusCampaign(
  options: V12AccelerationOptions,
): Promise<void> {
  let watchdog: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    // esbuild's service handles may be unref'd while a compile promise is still
    // pending. Keep one supervisor-owned handle referenced until the complete
    // acceleration path has either closed its reports or failed.
    watchdog = setTimeout(
      () => {
        reject(new Error('v12 acceleration watchdog expired.'));
      },
      // The all-row audit preserves the ninety-second per-row deadline while
      // allowing its bounded pipeline enough wall time to close every artifact.
      Math.max(
        60,
        Math.ceil(options.windowRows / FILTERED_CAMPAIGN_WATCHDOG_RATE_PER_MINUTE) + 30,
      ) * 60_000,
    );
  });
  try {
    await Promise.race([runV12Acceleration(options), deadline]);
  } finally {
    if (watchdog !== undefined) clearTimeout(watchdog);
  }
}

/** Validates the fixed compiler/browser lane matrix and evaluates its throughput candidates in order. */
export async function runV12Acceleration(options: V12AccelerationOptions): Promise<void> {
  const candidateSelection: unknown = options.candidates;
  if (options.chunkRows !== 8 || candidateSelection !== '12x4,14x4,16x5') {
    throw new Error(
      'v12 accelerate requires eight-row admission windows and candidates 12x4,14x4,16x5.',
    );
  }
  const manifestBytes = await readFile(options.manifestPath);
  const manifest = parseManifest(manifestBytes.toString('utf8'));
  const manifestDigest = digest(manifestBytes);
  const triageSelection =
    options.selectionPath === undefined
      ? undefined
      : await readPreviewTsxCorpusChecksummedJson<PreviewTsxCorpusTriageSelectionArtifact>(
          options.selectionPath,
        );
  if (
    triageSelection === undefined &&
    (manifest.length !== FILTERED_JSX_EXPORT_MANIFEST_ROWS ||
      manifestDigest !== FILTERED_JSX_EXPORT_MANIFEST_SHA256)
  ) {
    throw new Error('v13 acceleration requires the immutable 6,807-row JSX-export manifest.');
  }
  const selectedRows =
    triageSelection === undefined
      ? Array.from({ length: options.windowRows }, (_, offset) => options.windowStart + offset)
      : validatePreviewTsxCorpusTriageSelection(triageSelection, manifest, manifestDigest);
  if (triageSelection === undefined) {
    if (options.windowStart + options.windowRows > manifest.length)
      throw new Error('v12 acceleration window exceeds the frozen manifest.');
  } else if (
    options.windowStart !== 0 ||
    options.windowRows !== selectedRows.length ||
    selectedRows.length > 8
  ) {
    throw new Error(
      'v12 triage selection requires --window-start 0, matching selected rows, and no more than eight entries.',
    );
  }
  const engineDigest = digest(await readFile(options.runtimePath));
  const referenceRow =
    triageSelection === undefined
      ? (() => {
          const corridorSuffix =
            'legal/right-to-consent-or-consult/pages/rtcc-investment-contract-management-page/investment-agreement-management-modals.tsx';
          const corridorMatches = manifest
            .map((row, index) => ({ index, row }))
            .filter(({ row }) => row.path.endsWith(corridorSuffix));
          if (corridorMatches.length !== 1 || corridorMatches[0] === undefined) {
            throw new Error(
              `v12 reference corridor resolution expected one match, found ${corridorMatches.length.toString()}.`,
            );
          }
          return corridorMatches[0];
        })()
      : (() => {
          const index = selectedRows[0];
          const row = index === undefined ? undefined : manifest[index];
          if (index === undefined || row === undefined)
            throw new Error('v12 triage selection has no reference row.');
          return { index, row };
        })();
  const semanticKey = digestJson({
    chromiumPath: path.resolve(options.chromiumPath),
    corridorDigest: referenceRow.row.sha256,
    corridorIndex: referenceRow.index,
    engineDigest,
    manifestDigest,
    manifestRows: manifest.length,
    sourceRoot: path.resolve(options.sourceRoot),
    timeoutMs: 30_000,
    virtualTimeMs: 5_000,
    workspace: path.resolve(options.workspace),
  });
  const selection =
    triageSelection === undefined
      ? {
          digest: digestJson({ windowRows: options.windowRows, windowStart: options.windowStart }),
          mode: 'contiguous-window' as const,
          rows: selectedRows.length,
        }
      : {
          digest: triageSelection.selection.digest,
          mode: triageSelection.mode,
          rows: selectedRows.length,
        };
  const policyDigest = digestJson({ selection, semanticKey });
  if (triageSelection !== undefined) {
    const snapshotPath = path.join(options.artifacts, 'triage-selection.json');
    const checksum = await writePreviewTsxCorpusJsonAtomic(snapshotPath, triageSelection);
    await writePreviewTsxCorpusJsonAtomic(`${snapshotPath}.checksum.json`, checksum);
    await readPreviewTsxCorpusChecksummedJson(snapshotPath);
  }
  const referencePath = path.join(
    options.artifacts,
    'reference',
    engineDigest,
    semanticKey,
    'reference.json',
  );
  const reference = await readJsonIfPresent<{
    readonly semanticKey: string;
    readonly engineDigest: string;
  }>(referencePath);
  if (reference !== undefined) {
    if (reference.semanticKey !== semanticKey || reference.engineDigest !== engineDigest)
      throw new Error('v12 engine-namespaced reference identity mismatch.');
    await readPreviewTsxCorpusChecksummedJson(referencePath);
  } else {
    // The reference is namespaced before lookup.  Foreign namespaces are never
    // inspected or overwritten.
    const row = referenceRow.row;
    const compiler = new EsbuildPreviewCompiler();
    let referenceDeadline: NodeJS.Timeout | undefined;
    try {
      const referenceWork = (async () => {
        const request = await v12Request(row, options.sourceRoot, options.workspace);
        const bundle = await compiler.compile(request);
        return {
          request,
          result: await renderCompiledPreviewHeadlessly(bundle, request, {
            chromiumPath: options.chromiumPath,
            timeoutMs: 30_000,
            virtualTimeMs: 5_000,
          }),
        };
      })();
      const deadline = new Promise<never>((_, reject) => {
        referenceDeadline = setTimeout(() => {
          reject(new Error('v12 reference deadline expired.'));
        }, 120_000);
      });
      const { request, result } = await Promise.race([referenceWork, deadline]);
      if (
        !result.cleanup.browserTerminated ||
        !result.cleanup.profileRemoved ||
        !result.cleanup.serverClosed
      )
        throw new Error('v12 reference renderer cleanup was inconclusive.');
      const checksum = await writePreviewTsxCorpusJsonAtomic(referencePath, {
        engineDigest,
        semanticKey,
        signature: semanticSentinelSignature({
          headless: result,
          index: referenceRow.index,
          kind: 'headless-result',
          documentPath: request.documentPath,
          durationMs: 0,
          path: row.path,
          version: 3,
        }),
        version: 12,
      });
      await writePreviewTsxCorpusJsonAtomic(`${referencePath}.checksum.json`, checksum);
      await readPreviewTsxCorpusChecksummedJson(referencePath);
    } finally {
      if (referenceDeadline !== undefined) clearTimeout(referenceDeadline);
      await compiler.shutdown();
    }
  }
  const aggregate: unknown[] = [];
  // Measure the highest already-bounded topology first. A complete sub-100
  // result is still an honest result and does not justify spending two more
  // full 240-row windows on strictly lower concurrency.
  for (const candidate of [
    { lanes: 16, renders: 5 },
    { lanes: 14, renders: 4 },
    { lanes: 12, renders: 4 },
  ] as const) {
    const root = path.join(
      options.artifacts,
      `candidate-v12-${candidate.lanes.toString()}x${candidate.renders.toString()}`,
    );
    const report = await runV12Candidate(
      {
        ...options,
        engineDigest,
        manifest,
        policyDigest,
        root,
        selectedRows,
        selection,
        semanticKey,
      },
      candidate.lanes,
      candidate.renders,
    );
    aggregate.push(report);
    const checksum = await writePreviewTsxCorpusJsonAtomic(
      path.join(options.artifacts, 'aggregate-report.json'),
      { candidates: aggregate, engineDigest, policyDigest, selection, semanticKey, version: 12 },
    );
    await writePreviewTsxCorpusJsonAtomic(
      path.join(options.artifacts, 'aggregate-report.json.checksum.json'),
      checksum,
    );
    await readPreviewTsxCorpusChecksummedJson(
      path.join(options.artifacts, 'aggregate-report.json'),
    );
    if (report.status === 'selected' || report.status === 'safe-sub-100') return;
  }
  throw new Error('Every v12 candidate failed a safety gate.');
}
