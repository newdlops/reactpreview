import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import ts from 'typescript';
import {
  previewTsxCorpusDigest,
  writePreviewTsxCorpusJsonAtomic,
} from './previewHeadlessTsxCorpusCampaignArtifacts';
import type { PreviewTsxCorpusManifestRow } from './previewHeadlessTsxCorpusCampaignTypes';
import {
  PREVIEW_TSX_CORPUS_TRIAGE_FORMAT,
  PREVIEW_TSX_CORPUS_TRIAGE_MODE,
  previewTsxCorpusSelectionDigest,
  type PreviewTsxCorpusTriageSelectionArtifact,
  type PreviewTsxCorpusTriageSelectionEntry,
} from './previewHeadlessTsxCorpusSelection';

const SOURCE_BYTE_LIMIT = 2 * 1024 * 1024;
const SOURCE_NODE_LIMIT = 50_000;
const SOURCE_READ_CONCURRENCY = 64;

const REGRESSION_ANCHORS = Object.freeze([
  'legal/right-to-consent-or-consult/components/investment-agreement-management-modal/investment-agreement-upload-modal.tsx',
  'legal/right-to-consent-or-consult/pages/rtcc-investment-contract-management-page/investment-agreement-management-modals.tsx',
  'legal/right-to-consent-or-consult/pages/rtcc-investment-contract-management-page/rtcc-investment-contract-management-page.tsx',
]);

const SIGNATURE_WEIGHTS = new Map<string, number>([
  ['conditional-empty-return', 16],
  ['authored-throw', 14],
  ['provider-context', 13],
  ['portal-dom', 13],
  ['route-owner', 12],
  ['overlay-component', 11],
  ['iterable-assumption', 10],
  ['browser-capability', 9],
  ['redux', 9],
  ['apollo-graphql', 8],
  ['formik', 8],
  ['styled-theme', 8],
  ['router', 8],
  ['dynamic-import', 7],
  ['environment', 7],
  ['network', 7],
  ['redirect', 7],
  ['unguarded-value-read', 6],
  ['style-asset', 4],
]);

const FRONTIER_LAYERS = new Map<string, string>([
  ['conditional-empty-return', 'reachability'],
  ['route-owner', 'navigation'],
  ['router', 'navigation'],
  ['redirect', 'navigation'],
  ['provider-context', 'provider-data'],
  ['redux', 'provider-data'],
  ['apollo-graphql', 'provider-data'],
  ['formik', 'provider-data'],
  ['iterable-assumption', 'value-shape'],
  ['unguarded-value-read', 'value-shape'],
  ['authored-throw', 'runtime'],
  ['dynamic-import', 'runtime'],
  ['browser-capability', 'environment'],
  ['environment', 'environment'],
  ['network', 'environment'],
  ['portal-dom', 'overlay'],
  ['overlay-component', 'overlay'],
  ['styled-theme', 'styling'],
  ['style-asset', 'styling'],
]);

const PATH_RISKS = Object.freeze([
  { label: 'modal', token: 'modal', weight: 14 },
  { label: 'dialog', token: 'dialog', weight: 12 },
  { label: 'drawer', token: 'drawer', weight: 12 },
  { label: 'popover', token: 'popover', weight: 11 },
  { label: 'overlay', token: 'overlay', weight: 11 },
  { label: 'provider', token: 'provider', weight: 9 },
  { label: 'route', token: 'route', weight: 8 },
  { label: 'context', token: 'context', weight: 7 },
  { label: 'menu', token: 'menu', weight: 7 },
  { label: 'page', token: '/pages/', weight: 4 },
]);

interface HistoricalClassification {
  readonly category: string;
  readonly index: number;
  readonly path: string;
  readonly reason: string;
  readonly source: string;
}

interface SignatureCount {
  readonly count: number;
  readonly family: string;
}

interface StaticCensus {
  readonly bucket: 'malformed' | 'non-exportable' | 'oversized' | 'ready';
  readonly exportable: boolean;
  readonly signatureCounts: readonly SignatureCount[];
  readonly signatures: readonly string[];
}

interface CandidateFrontier {
  readonly observedBlockerReasons: readonly string[];
  readonly observedCategories: readonly string[];
  readonly potentialFamilies: readonly string[];
  readonly potentialLayerCount: number;
  readonly potentialSites: number;
  readonly signatureCounts: StaticCensus['signatureCounts'];
}

interface TriageCandidate {
  readonly census: StaticCensus;
  readonly frontier: CandidateFrontier;
  readonly history: readonly HistoricalClassification[];
  readonly historical?: HistoricalClassification;
  readonly index: number;
  readonly mandatory: boolean;
  readonly path: string;
  readonly priority: number;
  readonly reasons: readonly string[];
  readonly row: PreviewTsxCorpusManifestRow;
  readonly signatures: readonly string[];
  readonly stratum: string;
}

export interface PreviewHeadlessTsxCorpusTriageOptions {
  readonly cap: number;
  readonly histories: readonly string[];
  readonly manifestPath: string;
  readonly outputPath: string;
  readonly selectionStrategy?: 'complete-history' | 'representative-history';
  readonly sourceRoot: string;
}

interface HistoricalClassificationWire {
  readonly category?: unknown;
  readonly index?: unknown;
  readonly path?: unknown;
  readonly reason?: unknown;
}

interface HistoricalReport {
  readonly classifications?: readonly HistoricalClassificationWire[];
}

/** Performs source-only blocker/Unrendered triage; it deliberately does not claim a render result. */
export async function runPreviewHeadlessTsxCorpusTriage(
  options: PreviewHeadlessTsxCorpusTriageOptions,
): Promise<PreviewTsxCorpusTriageSelectionArtifact> {
  if (!Number.isSafeInteger(options.cap) || options.cap < 1) {
    throw new Error('Static triage cap must be a positive safe integer.');
  }
  const totalStartedAt = performance.now();
  const manifestBytes = await readFile(options.manifestPath);
  const manifest = parseManifest(manifestBytes.toString('utf8'));
  const manifestSha256 = previewTsxCorpusDigest(manifestBytes);
  const history = await readHistoricalClassifications(options.histories, manifest);
  const scanStartedAt = performance.now();
  const candidates = await mapWithConcurrency(
    manifest,
    SOURCE_READ_CONCURRENCY,
    async (row, index) => scanRow(row, index, options.sourceRoot, history.get(index)),
  );
  const scanElapsedMs = Math.max(0.001, performance.now() - scanStartedAt);
  const selectionStrategy = options.selectionStrategy ?? 'complete-history';
  const selection =
    selectionStrategy === 'representative-history'
      ? selectRepresentativeCandidates(candidates, options.cap)
      : selectCandidates(candidates, options.cap);
  const knownBlockers = candidates.filter((candidate) =>
    candidate.frontier.observedCategories.includes('blocker'),
  );
  const knownUnrendered = candidates.filter((candidate) =>
    candidate.frontier.observedCategories.includes('Unrendered'),
  );
  const potentialBlockers = candidates.filter(
    (candidate) => candidate.frontier.potentialLayerCount > 0,
  );
  const selectedIndices = new Set(selection.map((entry) => entry.index));
  const knownBlockersSelected = knownBlockers.filter((candidate) =>
    selectedIndices.has(candidate.index),
  ).length;
  const knownUnrenderedSelected = knownUnrendered.filter((candidate) =>
    selectedIndices.has(candidate.index),
  ).length;
  const totalElapsedMs = Math.max(0.001, performance.now() - totalStartedAt);
  const artifact: PreviewTsxCorpusTriageSelectionArtifact = {
    format: PREVIEW_TSX_CORPUS_TRIAGE_FORMAT,
    generatedAt: new Date().toISOString(),
    histories: options.histories.map((historyPath) => path.resolve(historyPath)),
    manifestRows: manifest.length,
    manifestSha256,
    mode: PREVIEW_TSX_CORPUS_TRIAGE_MODE,
    scan: {
      elapsedMs: scanElapsedMs,
      exportableRows: candidates.filter((candidate) => candidate.census.exportable).length,
      malformedRows: candidates.filter((candidate) => candidate.census.bucket === 'malformed')
        .length,
      oversizedRows: candidates.filter((candidate) => candidate.census.bucket === 'oversized')
        .length,
      ratePerMinute: (manifest.length * 60_000) / scanElapsedMs,
      rows: manifest.length,
    },
    selection: {
      digest: previewTsxCorpusSelectionDigest(selection),
      entries: selection,
      requestedCap: options.cap,
      strategy: selectionStrategy,
    },
    summary: {
      explicitRegressionAnchors: candidates.filter((candidate) =>
        REGRESSION_ANCHORS.includes(candidate.path),
      ).length,
      knownBlockerRecall: recall(knownBlockersSelected, knownBlockers.length),
      knownBlockers: knownBlockers.length,
      knownBlockersSelected,
      knownUnrendered: knownUnrendered.length,
      knownUnrenderedRecall: recall(knownUnrenderedSelected, knownUnrendered.length),
      knownUnrenderedSelected,
      maximumPotentialLayers: Math.max(
        0,
        ...candidates.map((candidate) => candidate.frontier.potentialLayerCount),
      ),
      multiLayerPotentialRows: candidates.filter(
        (candidate) => candidate.frontier.potentialLayerCount > 1,
      ).length,
      observedBlockerRecall: recall(knownBlockersSelected, knownBlockers.length),
      observedBlockerRows: knownBlockers.length,
      observedBlockerRowsSelected: knownBlockersSelected,
      observedUnrenderedRows: knownUnrendered.length,
      potentialBlockerRows: potentialBlockers.length,
      potentialBlockerSites: potentialBlockers.reduce(
        (total, candidate) => total + candidate.frontier.potentialSites,
        0,
      ),
      selectedRows: selection.length,
    },
    total: {
      elapsedMs: totalElapsedMs,
      ratePerMinute: (manifest.length * 60_000) / totalElapsedMs,
    },
    version: 2,
  };
  const checksum = await writePreviewTsxCorpusJsonAtomic(options.outputPath, artifact);
  await writePreviewTsxCorpusJsonAtomic(`${options.outputPath}.checksum.json`, checksum);
  return artifact;
}

/** Verifies and analyzes one immutable manifest row without executing authored code. */
async function scanRow(
  row: PreviewTsxCorpusManifestRow,
  index: number,
  sourceRoot: string,
  history: readonly HistoricalClassification[] | undefined,
): Promise<TriageCandidate> {
  const sourcePath = path.resolve(sourceRoot, row.path);
  const bytes = await readFile(sourcePath);
  if (bytes.byteLength !== row.bytes || sha256(bytes) !== row.sha256) {
    throw new Error(`Frozen triage source changed: ${row.path}`);
  }
  const census = censusSource(bytes.toString('utf8'), row.path);
  const observedHistory = history ?? [];
  const historical = observedHistory.at(-1);
  const frontier = createCandidateFrontier(census, observedHistory);
  const reasons = new Set<string>();
  let priority = 0;
  const mandatory =
    frontier.observedCategories.includes('blocker') ||
    frontier.observedCategories.includes('Unrendered');
  for (const category of frontier.observedCategories) reasons.add(`historical:${category}`);
  if (observedHistory.length > 0) {
    priority += Math.max(...observedHistory.map((item) => historicalPriority(item.category)));
    priority += Math.min(8, frontier.observedBlockerReasons.length) * 100;
  }
  if (REGRESSION_ANCHORS.includes(row.path)) {
    reasons.add('regression-anchor:rtcc-investment-agreement');
    priority += 90_000;
  }
  for (const item of census.signatureCounts) {
    reasons.add(`static:${item.family}`);
    const repetitionMultiplier = 1 + Math.min(4, Math.floor(Math.log2(item.count)));
    priority += (SIGNATURE_WEIGHTS.get(item.family) ?? 1) * repetitionMultiplier;
  }
  if (frontier.potentialLayerCount > 0) {
    reasons.add(`latent-frontier:${frontier.potentialLayerCount.toString()}-layers`);
    reasons.add(`latent-sites:${frontier.potentialSites.toString()}`);
    priority += frontier.potentialLayerCount * 20;
  }
  const loweredPath = row.path.toLowerCase();
  for (const risk of PATH_RISKS) {
    if (loweredPath.includes(risk.token)) {
      reasons.add(`path-risk:${risk.label}`);
      priority += risk.weight;
    }
  }
  if (census.bucket !== 'ready') {
    reasons.add(`census:${census.bucket}`);
    priority += 50;
  }
  if (reasons.size === 0) reasons.add('coverage:manifest-jsx-export');
  return {
    census,
    frontier,
    history: observedHistory,
    ...(historical === undefined ? {} : { historical }),
    index,
    mandatory: mandatory || REGRESSION_ANCHORS.includes(row.path),
    path: row.path,
    priority,
    reasons: Object.freeze([...reasons].sort()),
    row,
    signatures: census.signatures,
    stratum: breadthStratum(row.path),
  };
}

/** Keeps all regression anchors, then fills the cap by static risk and breadth. */
function selectCandidates(
  candidates: readonly TriageCandidate[],
  requestedCap: number,
): readonly PreviewTsxCorpusTriageSelectionEntry[] {
  const selected: TriageCandidate[] = [];
  const selectedIndices = new Set<number>();
  const mandatoryGroups = [
    candidates.filter((candidate) => candidate.frontier.observedCategories.includes('Unrendered')),
    candidates.filter((candidate) => candidate.frontier.observedCategories.includes('blocker')),
    candidates.filter(
      (candidate) =>
        candidate.mandatory &&
        !candidate.frontier.observedCategories.includes('Unrendered') &&
        !candidate.frontier.observedCategories.includes('blocker'),
    ),
  ];
  for (const group of mandatoryGroups) {
    for (const candidate of roundRobinByStratum(group)) {
      addSelection(selected, selectedIndices, candidate);
    }
  }
  const effectiveCap = Math.max(requestedCap, selected.length);
  appendSelectionQuota(
    selected,
    selectedIndices,
    candidates.filter((candidate) =>
      candidate.frontier.observedCategories.includes('blank/empty output'),
    ),
    Math.min(16, effectiveCap - selected.length),
  );
  appendSelectionQuota(
    selected,
    selectedIndices,
    candidates.filter((candidate) =>
      candidate.frontier.observedCategories.includes('incomplete page composition'),
    ),
    Math.min(8, effectiveCap - selected.length),
  );
  const coveredSignatures = new Set(selected.flatMap((candidate) => candidate.signatures));
  const stratumCounts = new Map<string, number>();
  for (const candidate of selected) {
    stratumCounts.set(candidate.stratum, (stratumCounts.get(candidate.stratum) ?? 0) + 1);
  }
  const available = candidates.filter((candidate) => !selectedIndices.has(candidate.index));
  while (selected.length < effectiveCap && available.length > 0) {
    available.sort((left, right) => {
      const leftValue = selectionValue(left, coveredSignatures, stratumCounts);
      const rightValue = selectionValue(right, coveredSignatures, stratumCounts);
      return rightValue - leftValue || left.path.localeCompare(right.path);
    });
    const next = available.shift();
    if (next === undefined) break;
    addSelection(selected, selectedIndices, next);
    next.signatures.forEach((signature) => coveredSignatures.add(signature));
    stratumCounts.set(next.stratum, (stratumCounts.get(next.stratum) ?? 0) + 1);
  }
  return Object.freeze(selected.map(toSelectionEntry));
}

/**
 * Builds a small, deterministic diagnosis corpus without weakening the default full-recall mode.
 *
 * Historical blockers remain the first tier, but novel blocker reasons, static risk layers, syntax
 * signatures, and source strata outrank another near-duplicate from the same feature directory.
 * Explicit regression anchors are retained first so a short iteration corpus never forgets the
 * user-reported modal/Page Context failures that motivated the campaign.
 */
function selectRepresentativeCandidates(
  candidates: readonly TriageCandidate[],
  requestedCap: number,
): readonly PreviewTsxCorpusTriageSelectionEntry[] {
  const selected: TriageCandidate[] = [];
  const selectedIndices = new Set<number>();
  const coveredBlockerReasons = new Set<string>();
  const coveredLayers = new Set<string>();
  const coveredSignatures = new Set<string>();
  const stratumCounts = new Map<string, number>();
  const addTracked = (candidate: TriageCandidate): void => {
    if (selected.length >= requestedCap || selectedIndices.has(candidate.index)) return;
    addSelection(selected, selectedIndices, candidate);
    candidate.frontier.observedBlockerReasons.forEach((reason) =>
      coveredBlockerReasons.add(reason),
    );
    candidate.frontier.potentialFamilies.forEach((family) => {
      const layer = FRONTIER_LAYERS.get(family);
      if (layer !== undefined) coveredLayers.add(layer);
    });
    candidate.signatures.forEach((signature) => coveredSignatures.add(signature));
    stratumCounts.set(candidate.stratum, (stratumCounts.get(candidate.stratum) ?? 0) + 1);
  };

  for (const candidate of candidates
    .filter((item) => REGRESSION_ANCHORS.includes(item.path))
    .sort((left, right) => left.path.localeCompare(right.path))) {
    addTracked(candidate);
  }

  const available = candidates.filter(
    (candidate) => !selectedIndices.has(candidate.index) && candidate.reasons.length > 0,
  );
  while (selected.length < requestedCap && available.length > 0) {
    available.sort((left, right) => {
      const tierDifference = representativeHistoryTier(right) - representativeHistoryTier(left);
      if (tierDifference !== 0) return tierDifference;
      const valueDifference =
        representativeSelectionValue(
          right,
          coveredBlockerReasons,
          coveredLayers,
          coveredSignatures,
          stratumCounts,
        ) -
        representativeSelectionValue(
          left,
          coveredBlockerReasons,
          coveredLayers,
          coveredSignatures,
          stratumCounts,
        );
      return valueDifference || left.path.localeCompare(right.path);
    });
    const next = available.shift();
    if (next === undefined) break;
    addTracked(next);
  }
  return Object.freeze(selected.map(toSelectionEntry));
}

/** Keeps known Unrendered/blocker outcomes ahead of blank and incomplete fallback coverage. */
function representativeHistoryTier(candidate: TriageCandidate): number {
  const categories = candidate.frontier.observedCategories;
  if (categories.includes('Unrendered')) return 4;
  if (categories.includes('blocker')) return 3;
  if (categories.includes('blank/empty output')) return 2;
  if (categories.includes('incomplete page composition') || candidate.mandatory) return 1;
  return 0;
}

/** Scores breadth evidence only; historical severity is handled by the separate tier above. */
function representativeSelectionValue(
  candidate: TriageCandidate,
  coveredBlockerReasons: ReadonlySet<string>,
  coveredLayers: ReadonlySet<string>,
  coveredSignatures: ReadonlySet<string>,
  stratumCounts: ReadonlyMap<string, number>,
): number {
  const newBlockerReasons = candidate.frontier.observedBlockerReasons.filter(
    (reason) => !coveredBlockerReasons.has(reason),
  ).length;
  const candidateLayers = new Set(
    candidate.frontier.potentialFamilies
      .map((family) => FRONTIER_LAYERS.get(family))
      .filter((layer): layer is string => layer !== undefined),
  );
  const newLayers = [...candidateLayers].filter((layer) => !coveredLayers.has(layer)).length;
  const newSignatures = candidate.signatures.filter(
    (signature) => !coveredSignatures.has(signature),
  ).length;
  const stratumCount = stratumCounts.get(candidate.stratum) ?? 0;
  return (
    newBlockerReasons * 100_000 +
    newLayers * 20_000 +
    newSignatures * 2_000 +
    (stratumCount === 0 ? 8_000 : 0) +
    candidate.frontier.potentialLayerCount * 250 +
    Math.min(250, candidate.frontier.potentialSites) -
    stratumCount * 4_000
  );
}

/** Scores novel signatures and underrepresented source strata above redundant rows. */
function selectionValue(
  candidate: TriageCandidate,
  coveredSignatures: ReadonlySet<string>,
  stratumCounts: ReadonlyMap<string, number>,
): number {
  const newSignatures = candidate.signatures.filter(
    (signature) => !coveredSignatures.has(signature),
  ).length;
  const stratumCount = stratumCounts.get(candidate.stratum) ?? 0;
  return (
    candidate.priority * 100 +
    newSignatures * 60 +
    (stratumCount === 0 ? 120 : 0) -
    stratumCount * 15
  );
}

/** Interleaves mandatory rows so early deep-render waves are not directory-clustered. */
function roundRobinByStratum(candidates: readonly TriageCandidate[]): readonly TriageCandidate[] {
  const groups = new Map<string, TriageCandidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.stratum) ?? [];
    group.push(candidate);
    groups.set(candidate.stratum, group);
  }
  for (const group of groups.values()) {
    group.sort(
      (left, right) => right.priority - left.priority || left.path.localeCompare(right.path),
    );
  }
  const strata = [...groups.keys()].sort();
  const result: TriageCandidate[] = [];
  for (let offset = 0; ; offset += 1) {
    let appended = false;
    for (const stratum of strata) {
      const candidate = groups.get(stratum)?.[offset];
      if (candidate !== undefined) {
        result.push(candidate);
        appended = true;
      }
    }
    if (!appended) return Object.freeze(result);
  }
}

/** Adds a candidate once while preserving deterministic insertion order. */
function addSelection(
  selected: TriageCandidate[],
  selectedIndices: Set<number>,
  candidate: TriageCandidate,
): void {
  if (selectedIndices.has(candidate.index)) return;
  selected.push(candidate);
  selectedIndices.add(candidate.index);
}

/** Reserves bounded breadth for blank and incomplete outcomes that can mask Unrendered output. */
function appendSelectionQuota(
  selected: TriageCandidate[],
  selectedIndices: Set<number>,
  candidates: readonly TriageCandidate[],
  quota: number,
): void {
  let appended = 0;
  for (const candidate of roundRobinByStratum(candidates)) {
    if (appended >= quota) return;
    const sizeBefore = selected.length;
    addSelection(selected, selectedIndices, candidate);
    if (selected.length > sizeBefore) appended += 1;
  }
}

/** Removes scan-only state from one durable selection entry. */
function toSelectionEntry(candidate: TriageCandidate): PreviewTsxCorpusTriageSelectionEntry {
  return {
    ...(candidate.historical === undefined
      ? {}
      : {
          historicalCategory: candidate.historical.category,
          historicalReason: candidate.historical.reason,
        }),
    frontier: candidate.frontier,
    index: candidate.index,
    path: candidate.path,
    priority: candidate.priority,
    reasons: candidate.reasons,
    sha256: candidate.row.sha256,
    signatures: candidate.signatures,
    stratum: candidate.stratum,
  };
}

/** Produces a bounded syntax-only risk census for one TSX source. */
function censusSource(sourceText: string, fileName: string): StaticCensus {
  if (Buffer.byteLength(sourceText, 'utf8') > SOURCE_BYTE_LIMIT) {
    return emptyCensus('oversized');
  }
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
  const signatureCounts = new Map<string, number>();
  const budget = { nodeCount: 0, overBudget: false };
  const visit = (node: ts.Node): void => {
    budget.nodeCount += 1;
    if (budget.nodeCount > SOURCE_NODE_LIMIT) {
      budget.overBudget = true;
      return;
    }
    for (const family of censusFamilies(node)) {
      signatureCounts.set(family, Math.min(1_000, (signatureCounts.get(family) ?? 0) + 1));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (budget.overBudget) {
    return emptyCensus('oversized');
  }
  const parseDiagnostics = (
    source as ts.SourceFile & { readonly parseDiagnostics: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if (parseDiagnostics.length > 0) {
    return emptyCensus('malformed');
  }
  const exportable = hasRuntimeExport(source);
  const counts = Object.freeze(
    [...signatureCounts]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([family, count]) => Object.freeze({ count, family })),
  );
  return {
    bucket: exportable ? 'ready' : 'non-exportable',
    exportable,
    signatureCounts: counts,
    signatures: Object.freeze(counts.map((item) => item.family)),
  };
}

/** Creates an empty bounded census for sources that cannot be parsed safely. */
function emptyCensus(bucket: 'malformed' | 'oversized'): StaticCensus {
  return {
    bucket,
    exportable: false,
    signatureCounts: Object.freeze([]),
    signatures: Object.freeze([]),
  };
}

/** Combines all observed terminals with independent static risk layers for one file. */
function createCandidateFrontier(
  census: StaticCensus,
  history: readonly HistoricalClassification[],
): CandidateFrontier {
  const observedCategories = Object.freeze([...new Set(history.map((item) => item.category))]);
  const observedBlockerReasons = Object.freeze([
    ...new Set(
      history
        .filter((item) => item.category === 'blocker' || item.category === 'Unrendered')
        .map((item) => `${item.category}: ${item.reason}`),
    ),
  ]);
  const potentialFamilies = Object.freeze(
    census.signatureCounts
      .filter((item) => FRONTIER_LAYERS.has(item.family))
      .map((item) => item.family),
  );
  const potentialLayers = new Set(
    potentialFamilies
      .map((family) => FRONTIER_LAYERS.get(family))
      .filter((layer): layer is string => layer !== undefined),
  );
  const potentialFamilySet = new Set(potentialFamilies);
  return Object.freeze({
    observedBlockerReasons,
    observedCategories,
    potentialFamilies,
    potentialLayerCount: potentialLayers.size,
    potentialSites: census.signatureCounts
      .filter((item) => potentialFamilySet.has(item.family))
      .reduce((total, item) => total + item.count, 0),
    signatureCounts: census.signatureCounts,
  });
}

/** Maps syntax nodes to framework-general isolated-render risk families. */
function censusFamilies(node: ts.Node): readonly string[] {
  const families: string[] = [];
  if (ts.isThrowStatement(node)) families.push('authored-throw');
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    families.push('dynamic-import');
  }
  if (ts.isReturnStatement(node) && isEmptyRenderExpression(node.expression)) {
    families.push('conditional-empty-return');
  }
  if (
    ts.isConditionalExpression(node) &&
    (isEmptyRenderExpression(node.whenTrue) || isEmptyRenderExpression(node.whenFalse))
  ) {
    families.push('conditional-empty-return');
  }
  if (ts.isForOfStatement(node) || ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) {
    families.push('iterable-assumption');
  }
  if (ts.isPropertyAccessExpression(node) && node.name.text === 'value' && !node.questionDotToken) {
    families.push('unguarded-value-read');
  }
  if (ts.isCallExpression(node)) {
    const name = callableName(node.expression);
    if (name === 'createPortal') families.push('portal-dom');
    if (name === 'fetch' || name === 'XMLHttpRequest') families.push('network');
    if (name === 'push' || name === 'replace' || name === 'navigate') families.push('redirect');
  }
  if (ts.isImportDeclaration(node)) {
    const moduleName = ts.isStringLiteralLike(node.moduleSpecifier)
      ? node.moduleSpecifier.text
      : '';
    if (/\.(?:css|s[ac]ss|less|svg|png|jpe?g|gif|webp|woff2?)$/iu.test(moduleName)) {
      families.push('style-asset');
    }
    if (/(?:apollo|graphql)/iu.test(moduleName)) families.push('apollo-graphql');
    if (/formik/iu.test(moduleName)) families.push('formik');
    if (/(?:redux|react-redux)/iu.test(moduleName)) families.push('redux');
    if (/(?:react-router|router)/iu.test(moduleName)) families.push('router');
    if (/(?:styled-components|emotion)/iu.test(moduleName)) families.push('styled-theme');
  }
  if (ts.isIdentifier(node)) {
    if (node.text === 'process' || node.text === 'global') families.push('environment');
    if (node.text === 'window' || node.text === 'document' || node.text === 'navigator') {
      families.push('browser-capability');
    }
    if (
      /^(?:useContext|createContext|Provider)$/u.test(node.text) ||
      node.text.endsWith('Provider')
    ) {
      families.push('provider-context');
    }
    if (/^(?:Route|Routes|RouterProvider|createBrowserRouter|useNavigate)$/u.test(node.text)) {
      families.push('route-owner');
    }
    if (/(?:Modal|Dialog|Drawer|Popover|Overlay|Menu)$/u.test(node.text)) {
      families.push('overlay-component');
    }
  }
  return families;
}

/** Recognizes authored expressions that intentionally produce no visible React element. */
function isEmptyRenderExpression(expression: ts.Expression | undefined): boolean {
  return (
    expression === undefined ||
    expression.kind === ts.SyntaxKind.NullKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isIdentifier(expression) && expression.text === 'undefined')
  );
}

/** Returns the terminal callable identifier without retaining authored names in artifacts. */
function callableName(expression: ts.LeftHandSideExpression): string {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return '';
}

/** Distinguishes runtime exports from type-only TSX modules. */
function hasRuntimeExport(source: ts.SourceFile): boolean {
  if (/\.d\.ts$/iu.test(source.fileName)) return false;
  return source.statements.some((statement) => {
    if (ts.isExportAssignment(statement)) return !statement.isExportEquals;
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) return false;
      if (statement.exportClause === undefined) return true;
      if (ts.isNamedExports(statement.exportClause)) {
        return statement.exportClause.elements.some((specifier) => !specifier.isTypeOnly);
      }
      return ts.isNamespaceExport(statement.exportClause);
    }
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    const exported = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) return false;
    const declared = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword);
    if (declared) return false;
    if (ts.isFunctionDeclaration(statement) && statement.body === undefined) return false;
    return (
      !ts.isInterfaceDeclaration(statement) &&
      !ts.isTypeAliasDeclaration(statement) &&
      !ts.isImportDeclaration(statement)
    );
  });
}

/** Appends terminal reports in argument order so fixed blockers remain sticky regression anchors. */
async function readHistoricalClassifications(
  historyPaths: readonly string[],
  manifest: readonly PreviewTsxCorpusManifestRow[],
): Promise<ReadonlyMap<number, readonly HistoricalClassification[]>> {
  const result = new Map<number, HistoricalClassification[]>();
  for (const historyPath of historyPaths) {
    const bytes = await readFile(historyPath);
    await verifyOptionalChecksum(historyPath, bytes);
    const report = JSON.parse(bytes.toString('utf8')) as HistoricalReport;
    if (report.classifications === undefined || !Array.isArray(report.classifications)) {
      throw new Error(`Historical report has no classifications: ${historyPath}`);
    }
    const classifications: readonly HistoricalClassificationWire[] = report.classifications;
    for (const classification of classifications) {
      if (
        typeof classification.index !== 'number' ||
        !Number.isSafeInteger(classification.index) ||
        typeof classification.path !== 'string' ||
        typeof classification.category !== 'string' ||
        typeof classification.reason !== 'string'
      ) {
        throw new Error(`Historical report contains an invalid classification: ${historyPath}`);
      }
      const row = manifest[classification.index];
      if (row?.path !== classification.path) {
        throw new Error(`Historical report diverges from the manifest: ${historyPath}`);
      }
      const lineage = result.get(classification.index) ?? [];
      lineage.push({
        category: classification.category,
        index: classification.index,
        path: classification.path,
        reason: classification.reason,
        source: path.resolve(historyPath),
      });
      result.set(classification.index, lineage);
    }
  }
  return new Map([...result].map(([index, lineage]) => [index, Object.freeze(lineage)] as const));
}

/** Verifies a historical report when its sibling checksum is available. */
async function verifyOptionalChecksum(filePath: string, bytes: Buffer): Promise<void> {
  try {
    const checksum = JSON.parse(await readFile(`${filePath}.checksum.json`, 'utf8')) as {
      readonly bytes?: unknown;
      readonly sha256?: unknown;
    };
    if (checksum.bytes !== bytes.byteLength || checksum.sha256 !== previewTsxCorpusDigest(bytes)) {
      throw new Error(`Historical report checksum mismatch: ${filePath}`);
    }
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
}

/** Parses the sorted immutable JSONL corpus inventory. */
function parseManifest(source: string): readonly PreviewTsxCorpusManifestRow[] {
  const lines = source.trimEnd().split('\n');
  if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
    throw new Error('Static triage manifest is empty.');
  }
  const rows = lines.map((line) => JSON.parse(line) as PreviewTsxCorpusManifestRow);
  const paths = rows.map((row) => row.path);
  const sortedPaths = [...paths].sort();
  if (
    new Set(paths).size !== paths.length ||
    paths.some((sourcePath, index) => sourcePath !== sortedPaths[index])
  ) {
    throw new Error('Static triage manifest paths must be unique and sorted.');
  }
  return Object.freeze(rows);
}

/** Bounds source reads while retaining manifest order in the result. */
async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<readonly R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex++;
      const value = values[index];
      if (value === undefined) return;
      results[index] = await mapper(value, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return Object.freeze(results);
}

/** Gives observed blocker-like outcomes priority over inferred static risks. */
function historicalPriority(category: string): number {
  switch (category) {
    case 'Unrendered':
      return 120_000;
    case 'blocker':
      return 110_000;
    case 'blank/empty output':
      return 60;
    case 'incomplete page composition':
      return 45;
    case 'runtime/build failure':
      return 8;
    default:
      return 0;
  }
}

/** Creates a stable project-area bucket from the first three path segments. */
function breadthStratum(sourcePath: string): string {
  return sourcePath.split('/').slice(0, 3).join('/') || 'root';
}

/** Returns closed recall, treating an empty known set as vacuously complete. */
function recall(selected: number, total: number): number {
  return total === 0 ? 1 : selected / total;
}

/** Hashes the exact source bytes consumed by the census. */
function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Identifies an absent optional checksum without suppressing other I/O failures. */
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
