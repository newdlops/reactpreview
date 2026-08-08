import { previewTsxCorpusDigest } from './previewHeadlessTsxCorpusCampaignArtifacts';
import type { PreviewTsxCorpusManifestRow } from './previewHeadlessTsxCorpusCampaignTypes';

export const PREVIEW_TSX_CORPUS_TRIAGE_FORMAT = 'react-preview-tsx-static-triage/v2';
export const PREVIEW_TSX_CORPUS_TRIAGE_MODE = 'static-triage' as const;

export interface PreviewTsxCorpusTriageSignatureCount {
  readonly count: number;
  readonly family: string;
}

export interface PreviewTsxCorpusTriageSelectionEntry {
  readonly frontier: Readonly<{
    readonly observedBlockerReasons: readonly string[];
    readonly observedCategories: readonly string[];
    readonly potentialFamilies: readonly string[];
    readonly potentialLayerCount: number;
    readonly potentialSites: number;
    readonly signatureCounts: readonly PreviewTsxCorpusTriageSignatureCount[];
  }>;
  readonly historicalCategory?: string;
  readonly historicalReason?: string;
  readonly index: number;
  readonly path: string;
  readonly priority: number;
  readonly reasons: readonly string[];
  readonly sha256: string;
  readonly signatures: readonly string[];
  readonly stratum: string;
}

export interface PreviewTsxCorpusTriageSelectionArtifact {
  readonly format: typeof PREVIEW_TSX_CORPUS_TRIAGE_FORMAT;
  readonly generatedAt: string;
  readonly histories: readonly string[];
  readonly manifestRows: number;
  readonly manifestSha256: string;
  readonly mode: typeof PREVIEW_TSX_CORPUS_TRIAGE_MODE;
  readonly scan: Readonly<{
    readonly elapsedMs: number;
    readonly exportableRows: number;
    readonly malformedRows: number;
    readonly oversizedRows: number;
    readonly ratePerMinute: number;
    readonly rows: number;
  }>;
  readonly selection: Readonly<{
    readonly digest: string;
    readonly entries: readonly PreviewTsxCorpusTriageSelectionEntry[];
    readonly requestedCap: number;
    /** Complete historical recall remains the default; representative mode is explicitly opt-in. */
    readonly strategy?: 'complete-history' | 'representative-history';
  }>;
  readonly summary: Readonly<{
    readonly explicitRegressionAnchors: number;
    readonly knownBlockerRecall: number;
    readonly knownBlockers: number;
    readonly knownBlockersSelected: number;
    readonly knownUnrendered: number;
    readonly knownUnrenderedRecall: number;
    readonly knownUnrenderedSelected: number;
    readonly maximumPotentialLayers: number;
    readonly multiLayerPotentialRows: number;
    readonly observedBlockerRecall: number;
    readonly observedBlockerRows: number;
    readonly observedBlockerRowsSelected: number;
    readonly observedUnrenderedRows: number;
    readonly potentialBlockerRows: number;
    readonly potentialBlockerSites: number;
    readonly selectedRows: number;
  }>;
  readonly total: Readonly<{
    readonly elapsedMs: number;
    readonly ratePerMinute: number;
  }>;
  readonly version: 2;
}

/** Produces the stable identity used to bind a selected row order to a deep-render campaign. */
export function previewTsxCorpusSelectionDigest(
  entries: readonly PreviewTsxCorpusTriageSelectionEntry[],
): string {
  return previewTsxCorpusDigest(JSON.stringify(entries));
}

/** Closes a static-triage selection over the immutable source manifest it references. */
export function validatePreviewTsxCorpusTriageSelection(
  artifact: PreviewTsxCorpusTriageSelectionArtifact,
  manifest: readonly PreviewTsxCorpusManifestRow[],
  manifestSha256: string,
): readonly number[] {
  const format: unknown = artifact.format;
  const mode: unknown = artifact.mode;
  const version: unknown = artifact.version;
  if (
    format !== PREVIEW_TSX_CORPUS_TRIAGE_FORMAT ||
    mode !== PREVIEW_TSX_CORPUS_TRIAGE_MODE ||
    version !== 2
  ) {
    throw new Error('Unsupported TSX corpus triage selection format.');
  }
  if (artifact.manifestRows !== manifest.length || artifact.manifestSha256 !== manifestSha256) {
    throw new Error('TSX corpus triage selection does not own this frozen manifest.');
  }
  const entries = artifact.selection.entries;
  if (entries.length < 1 || entries.length > 1_000) {
    throw new Error('TSX corpus triage selection must contain between 1 and 1,000 rows.');
  }
  if (artifact.selection.digest !== previewTsxCorpusSelectionDigest(entries)) {
    throw new Error('TSX corpus triage selection digest mismatch.');
  }
  const indices = new Set<number>();
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.index) || entry.index < 0 || entry.index >= manifest.length) {
      throw new Error('TSX corpus triage selection contains an invalid manifest index.');
    }
    if (indices.has(entry.index)) {
      throw new Error(`TSX corpus triage selection repeats row ${entry.index.toString()}.`);
    }
    const row = manifest[entry.index];
    if (
      row?.path !== entry.path ||
      row.sha256 !== entry.sha256 ||
      !Number.isFinite(entry.priority) ||
      entry.reasons.length === 0 ||
      entry.reasons.some((reason) => reason.length === 0) ||
      entry.signatures.some((signature) => signature.length === 0) ||
      !Number.isSafeInteger(entry.frontier.potentialLayerCount) ||
      entry.frontier.potentialLayerCount < 0 ||
      !Number.isSafeInteger(entry.frontier.potentialSites) ||
      entry.frontier.potentialSites < 0 ||
      entry.frontier.signatureCounts.some(
        (item) => item.family.length === 0 || !Number.isSafeInteger(item.count) || item.count < 1,
      ) ||
      entry.stratum.length === 0
    ) {
      throw new Error(`TSX corpus triage selection row ${entry.index.toString()} is invalid.`);
    }
    indices.add(entry.index);
  }
  if (
    artifact.summary.selectedRows !== entries.length ||
    artifact.summary.knownBlockersSelected > artifact.summary.knownBlockers ||
    artifact.summary.knownUnrenderedSelected > artifact.summary.knownUnrendered ||
    artifact.summary.observedBlockerRowsSelected > artifact.summary.observedBlockerRows
  ) {
    throw new Error('TSX corpus triage selection summary is inconsistent.');
  }
  return Object.freeze(entries.map((entry) => entry.index));
}
