/**
 * Formats the two page-loading health events as a compact, scan-friendly diagnostic outline.
 *
 * The structured JSON record remains the source of truth, but a page-recognition failure should
 * not require manually correlating candidate, route, reachability, Fiber, and blocker objects.
 * This adapter reads only bounded validated health JSON and never trusts renderer-provided text as
 * terminal control sequences or executable formatting.
 */
import type {
  PreviewRuntimeHealthEvent,
  PreviewRuntimeHealthJson,
} from './previewRuntimeHealthProtocol';

const MAXIMUM_SUMMARY_PATH_ITEMS = 12;
const MAXIMUM_SUMMARY_TREE_ROWS = 16;
const MAXIMUM_SUMMARY_TEXT_LENGTH = 240;

/** Builds a human-readable prefix for page-context and page-composition events. */
export function formatPreviewRuntimeHealthSummary(
  event: PreviewRuntimeHealthEvent,
): string | undefined {
  if (event.event === 'page-context-selected') return formatPageContextSummary(event.detail);
  if (event.event === 'page-composition-snapshot') {
    return formatPageCompositionSummary(event.detail);
  }
  return undefined;
}

/** Explains why one static candidate was selected before any application component evaluates. */
function formatPageContextSummary(detail: PreviewRuntimeHealthJson): string {
  const record = readRecord(detail);
  const complete = record?.candidateComplete === true;
  const candidateCount = readFiniteNumber(record?.candidateCount) ?? 0;
  const candidateId = readText(record?.candidateId) ?? 'unknown';
  const rootExport = readText(record?.rootExport) ?? 'unknown';
  const rootPath = readText(record?.rootSourcePath);
  const route = readText(record?.pathname) ?? '/';
  const stopReason = readText(record?.stopReason) ?? 'unknown';
  const applicationPath = readTextArray(record?.applicationPath);
  const alternatives = readArray(record?.candidateSummaries);
  const completeAlternatives = alternatives.filter(
    (candidate) => readRecord(candidate)?.complete === true,
  ).length;
  return [
    `Page context · ${complete ? 'complete application root' : 'partial context'} · ${rootExport}`,
    `  Candidate: ${clip(candidateId)} · stop=${clip(stopReason)} · alternatives=${candidateCount.toString()} (${completeAlternatives.toString()} complete)`,
    `  Route: ${clip(route)}`,
    ...(rootPath === undefined ? [] : [`  Root source: ${clip(rootPath)}`]),
    `  Authored static path: ${formatPath(applicationPath)}`,
  ].join('\n');
}

/** Combines static page intent with the live/expected Inspector tree after a React commit. */
function formatPageCompositionSummary(detail: PreviewRuntimeHealthJson): string {
  const record = readRecord(detail);
  const candidate = readRecord(record?.candidate);
  const target = readRecord(record?.targetState);
  const counts = readRecord(record?.statusCounts);
  const blockers = readRecord(record?.blockerSummary);
  const route = readRecord(record?.route);
  const mounted = readFiniteNumber(counts?.mounted) ?? 0;
  const observed = readFiniteNumber(counts?.observed) ?? 0;
  const hostOutput = readFiniteNumber(counts?.hostOutput) ?? 0;
  const expected = readFiniteNumber(counts?.expected) ?? 0;
  const activeBlockers = readFiniteNumber(blockers?.active) ?? 0;
  const targetStage = readText(target?.stage) ?? 'untracked';
  const targetExport = readText(target?.exportName) ?? 'unknown';
  const rootExport = readText(candidate?.rootExport) ?? 'unknown';
  const stopReason = readText(candidate?.stopReason) ?? 'unknown';
  const pathname = readText(route?.pathname) ?? '/';
  const missingShellNames = readTextArray(record?.missingShellNames);
  const authoredStaticPath = readTextArray(record?.authoredStaticPath ?? record?.applicationPath);
  const observedFiberPath = readTextArray(record?.observedFiberPath);
  const treeRows = readArray(record?.treeRows).slice(0, MAXIMUM_SUMMARY_TREE_ROWS);
  const treeLines = treeRows.flatMap(formatTreeRow);
  const treeTruncated =
    record?.treeRowsTruncated === true ||
    readArray(record?.treeRows).length > MAXIMUM_SUMMARY_TREE_ROWS;
  return [
    `Page composition · ${clip(targetStage)} · target=${clip(targetExport)}`,
    `  Root: ${clip(rootExport)} · stop=${clip(stopReason)} · route=${clip(pathname)}`,
    `  Runtime: mounted=${mounted.toString()}/${observed.toString()} · host-output=${hostOutput.toString()} · expected=${expected.toString()} · active-blockers=${activeBlockers.toString()}`,
    `  Authored static path: ${formatPath(authoredStaticPath)}`,
    `  Observed Fiber path: ${formatPath(observedFiberPath)}`,
    `  Missing from live tree: ${formatPath(missingShellNames)}`,
    '  Component tree:',
    ...(treeLines.length === 0 ? ['    (no tree rows observed)'] : treeLines),
    ...(treeTruncated ? ['    … additional tree rows remain in the structured record'] : []),
  ].join('\n');
}

/** Renders one bounded pre-order row with an explicit live/expected/blocking state marker. */
function formatTreeRow(value: PreviewRuntimeHealthJson): readonly string[] {
  const row = readRecord(value);
  if (row === undefined) return [];
  const depth = Math.min(24, Math.max(0, readFiniteNumber(row.depth) ?? 0));
  const name = readText(row.name) ?? 'Anonymous';
  const state = readText(row.state) ?? 'unknown';
  const marker =
    row.blocker === true
      ? '!'
      : state === 'mounted-output'
        ? '+'
        : state.startsWith('mounted')
          ? '~'
          : state === 'expected'
            ? '?'
            : '-';
  const currentFile = row.currentFile === true ? ' · current file' : '';
  return [`    ${'  '.repeat(depth)}[${marker}] ${clip(name)} · ${clip(state)}${currentFile}`];
}

/** Joins a bounded path while making an empty static/live path explicit. */
function formatPath(items: readonly string[]): string {
  if (items.length === 0) return '(none)';
  const visible = items.slice(0, MAXIMUM_SUMMARY_PATH_ITEMS).map(clip);
  return (
    visible.join(' > ') +
    (items.length > visible.length ? ` > … +${(items.length - visible.length).toString()}` : '')
  );
}

/** Narrows validated JSON objects without accepting arrays or inherited renderer values. */
function readRecord(
  value: PreviewRuntimeHealthJson | undefined,
): Readonly<Record<string, PreviewRuntimeHealthJson>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Readonly<Record<string, PreviewRuntimeHealthJson>>;
}

/** Narrows one validated JSON array. */
function readArray(
  value: PreviewRuntimeHealthJson | undefined,
): readonly PreviewRuntimeHealthJson[] {
  return Array.isArray(value) ? (value as readonly PreviewRuntimeHealthJson[]) : [];
}

/** Reads a finite number suitable for counts and indentation. */
function readFiniteNumber(value: PreviewRuntimeHealthJson | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Reads and sanitizes one renderer-owned line fragment. */
function readText(value: PreviewRuntimeHealthJson | undefined): string | undefined {
  return typeof value === 'string' ? clip(value) : undefined;
}

/** Reads only string members from one validated JSON array. */
function readTextArray(value: PreviewRuntimeHealthJson | undefined): readonly string[] {
  return readArray(value).flatMap((item) => (typeof item === 'string' ? [clip(item)] : []));
}

/** Removes terminal controls and bounds one human-readable summary fragment. */
function clip(value: string): string {
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').trim();
  return clean.length <= MAXIMUM_SUMMARY_TEXT_LENGTH
    ? clean
    : `${clean.slice(0, MAXIMUM_SUMMARY_TEXT_LENGTH - 1)}…`;
}
