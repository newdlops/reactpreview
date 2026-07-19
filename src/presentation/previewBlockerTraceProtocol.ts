/**
 * Defines the bounded browser-to-extension protocol for chronological blocker diagnostics.
 *
 * The rendered project runs in an untrusted webview and may replace platform objects, so every
 * field is copied into a small plain-data shape before the extension host may read source text or
 * write to the shared Output channel. The protocol intentionally carries only preview-generated
 * selections and diagnostic summaries; it is not a transport for arbitrary application state.
 */
import path from 'node:path';
import { isPreviewSourcePath } from '../domain/previewTarget';

/** Exact discriminator reserved for Page Inspector blocker trace events. */
export const PREVIEW_BLOCKER_TRACE_MESSAGE_TYPE = 'react-preview-blocker-trace';

const TRACE_ID_LIMIT = 160;
const TRACE_TEXT_LIMIT = 4_000;
const TRACE_ERROR_DETAILS_LIMIT = 16_000;
const TRACE_SOURCE_PATH_LIMIT = 16_384;
const TRACE_COORDINATE_LIMIT = 10_000_000;
const TRACE_JSON_DEPTH_LIMIT = 6;
const TRACE_JSON_NODE_LIMIT = 512;
const TRACE_JSON_CHARACTER_LIMIT = 64 * 1024;
const TRACE_LIST_LIMIT = 128;
const TRACE_BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const TRACE_EVENT_KINDS = new Set<PreviewBlockerTraceEventKind>([
  'auto-selection',
  'blocker-discovered',
  'blocker-updated',
  'render-result',
  'subsequent-error',
]);

/** Chronological stages emitted by the deterministic blocker resolver. */
export type PreviewBlockerTraceEventKind =
  | 'auto-selection'
  | 'blocker-discovered'
  | 'blocker-updated'
  | 'render-result'
  | 'subsequent-error';

/** JSON-compatible value retained after depth, node-count, and text-budget validation. */
export type PreviewBlockerTraceJson =
  | boolean
  | number
  | string
  | null
  | readonly PreviewBlockerTraceJson[]
  | { readonly [key: string]: PreviewBlockerTraceJson };

/** Authored source evidence that the host may enrich only after graph authorization. */
export interface PreviewBlockerTraceSource {
  readonly column?: number;
  readonly line?: number;
  readonly occurrenceStart?: number;
  readonly sourcePath: string;
}

/** One blocker identity and the deterministic facts used to classify it. */
export interface PreviewBlockerTraceBlocker {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly ownerName?: string;
  readonly source?: PreviewBlockerTraceSource;
  readonly summary?: PreviewBlockerTraceJson;
}

/** One Auto/Smart choice made by the extension before the next render pass. */
export interface PreviewBlockerTraceAutoSelection {
  readonly action: string;
  readonly generatedPaths: readonly string[];
  readonly mode: string;
  readonly reason?: string;
  readonly selectedValue?: PreviewBlockerTraceJson;
}

/** Blocker-set difference observed after an Auto/Smart choice remounted the page. */
export interface PreviewBlockerTraceRenderResult {
  readonly changedBlockerIds: readonly string[];
  readonly discoveredBlockerIds: readonly string[];
  readonly remainingBlockerIds: readonly string[];
  readonly resolvedBlockerIds: readonly string[];
}

/** Console or React-boundary failure observed after a deterministic resolver decision. */
export interface PreviewBlockerTraceError {
  readonly details?: string;
  readonly exportName?: string;
  readonly level: string;
  readonly location?: string;
  readonly message: string;
  readonly phase?: string;
  readonly source: string;
}

/** Selected preview identity included in every event so multiple pinned tabs remain distinguishable. */
export interface PreviewBlockerTraceTarget {
  readonly exportName?: string;
  readonly pageCandidateId?: string;
  readonly renderScenario?: string;
  /** Hot-entry revision that emitted this event inside the persistent pinned webview. */
  readonly revision?: number;
}

/** Validated chronological trace event written to the React Preview Output channel. */
export interface PreviewBlockerTraceEvent {
  readonly auto?: PreviewBlockerTraceAutoSelection;
  readonly blocker?: PreviewBlockerTraceBlocker;
  readonly error?: PreviewBlockerTraceError;
  readonly event: PreviewBlockerTraceEventKind;
  readonly result?: PreviewBlockerTraceRenderResult;
  readonly sequence: number;
  readonly target?: PreviewBlockerTraceTarget;
  readonly timestamp: string;
  readonly traceId: string;
}

/** Browser envelope containing exactly one validated blocker trace event. */
export interface PreviewBlockerTraceMessage {
  readonly event: PreviewBlockerTraceEvent;
  readonly type: typeof PREVIEW_BLOCKER_TRACE_MESSAGE_TYPE;
}

/** Reports whether an untrusted message claims the blocker trace discriminator. */
export function isPreviewBlockerTraceMessage(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).type === PREVIEW_BLOCKER_TRACE_MESSAGE_TYPE
  );
}

/**
 * Parses and bounds one webview trace event before it can trigger source reads or Output writes.
 *
 * @param value Untrusted structured-clone value received from a preview webview.
 * @returns A recursively frozen plain-data message, or `undefined` for malformed input.
 */
export function readPreviewBlockerTraceMessage(
  value: unknown,
): PreviewBlockerTraceMessage | undefined {
  if (!isPreviewBlockerTraceMessage(value)) return undefined;
  const envelope = value as Record<string, unknown>;
  const event = readPreviewBlockerTraceEvent(envelope.event);
  if (event === undefined) return undefined;
  return Object.freeze({ event, type: PREVIEW_BLOCKER_TRACE_MESSAGE_TYPE });
}

/** Copies the explicit event fields while rejecting contradictory or unbounded primary identity. */
function readPreviewBlockerTraceEvent(value: unknown): PreviewBlockerTraceEvent | undefined {
  if (!isTraceRecord(value)) return undefined;
  const event = readRequiredTraceText(value.event, 40);
  const traceId = readRequiredTraceText(value.traceId, TRACE_ID_LIMIT);
  const timestamp = readRequiredTraceText(value.timestamp, 80);
  const sequence = value.sequence;
  if (
    event === undefined ||
    !TRACE_EVENT_KINDS.has(event as PreviewBlockerTraceEventKind) ||
    traceId === undefined ||
    timestamp === undefined ||
    !Number.isSafeInteger(sequence) ||
    (sequence as number) < 1
  ) {
    return undefined;
  }

  const blocker = value.blocker === undefined ? undefined : readTraceBlocker(value.blocker);
  const auto = value.auto === undefined ? undefined : readTraceAutoSelection(value.auto);
  const result = value.result === undefined ? undefined : readTraceRenderResult(value.result);
  const error = value.error === undefined ? undefined : readTraceError(value.error);
  const target = value.target === undefined ? undefined : readTraceTarget(value.target);
  if (
    (value.blocker !== undefined && blocker === undefined) ||
    (value.auto !== undefined && auto === undefined) ||
    (value.result !== undefined && result === undefined) ||
    (value.error !== undefined && error === undefined) ||
    (value.target !== undefined && target === undefined)
  ) {
    return undefined;
  }

  return Object.freeze({
    ...(auto === undefined ? {} : { auto }),
    ...(blocker === undefined ? {} : { blocker }),
    ...(error === undefined ? {} : { error }),
    event: event as PreviewBlockerTraceEventKind,
    ...(result === undefined ? {} : { result }),
    sequence: sequence as number,
    ...(target === undefined ? {} : { target }),
    timestamp,
    traceId,
  });
}

/** Parses one source-backed blocker and its bounded deterministic summary. */
function readTraceBlocker(value: unknown): PreviewBlockerTraceBlocker | undefined {
  if (!isTraceRecord(value)) return undefined;
  const id = readRequiredTraceText(value.id, TRACE_ID_LIMIT);
  const kind = readRequiredTraceText(value.kind, 120);
  const name = readRequiredTraceText(value.name, TRACE_TEXT_LIMIT);
  const ownerName = readOptionalTraceText(value.ownerName, TRACE_TEXT_LIMIT);
  const source = value.source === undefined ? undefined : readTraceSource(value.source);
  const summary = value.summary === undefined ? undefined : copyBoundedTraceJson(value.summary);
  if (
    id === undefined ||
    kind === undefined ||
    name === undefined ||
    ownerName === null ||
    (value.source !== undefined && source === undefined) ||
    (value.summary !== undefined && summary === undefined)
  ) {
    return undefined;
  }
  return Object.freeze({
    id,
    kind,
    name,
    ...(ownerName === undefined ? {} : { ownerName }),
    ...(source === undefined ? {} : { source }),
    ...(summary === undefined ? {} : { summary }),
  });
}

/** Parses one Auto selection while retaining only generated paths and JSON-safe selected values. */
function readTraceAutoSelection(value: unknown): PreviewBlockerTraceAutoSelection | undefined {
  if (!isTraceRecord(value)) return undefined;
  const action = readRequiredTraceText(value.action, TRACE_TEXT_LIMIT);
  const mode = readRequiredTraceText(value.mode, 120);
  const reason = readOptionalTraceText(value.reason, TRACE_TEXT_LIMIT);
  const generatedPaths = readTraceTextList(value.generatedPaths);
  const selectedValue =
    value.selectedValue === undefined ? undefined : copyBoundedTraceJson(value.selectedValue);
  if (
    action === undefined ||
    mode === undefined ||
    reason === null ||
    generatedPaths === undefined ||
    (value.selectedValue !== undefined && selectedValue === undefined)
  ) {
    return undefined;
  }
  return Object.freeze({
    action,
    generatedPaths,
    mode,
    ...(reason === undefined ? {} : { reason }),
    ...(selectedValue === undefined ? {} : { selectedValue }),
  });
}

/** Parses the four explicit blocker-set lists emitted after a remount. */
function readTraceRenderResult(value: unknown): PreviewBlockerTraceRenderResult | undefined {
  if (!isTraceRecord(value)) return undefined;
  const changedBlockerIds = readTraceTextList(value.changedBlockerIds);
  const discoveredBlockerIds = readTraceTextList(value.discoveredBlockerIds);
  const remainingBlockerIds = readTraceTextList(value.remainingBlockerIds);
  const resolvedBlockerIds = readTraceTextList(value.resolvedBlockerIds);
  if (
    changedBlockerIds === undefined ||
    discoveredBlockerIds === undefined ||
    remainingBlockerIds === undefined ||
    resolvedBlockerIds === undefined
  ) {
    return undefined;
  }
  return Object.freeze({
    changedBlockerIds,
    discoveredBlockerIds,
    remainingBlockerIds,
    resolvedBlockerIds,
  });
}

/** Parses a subsequent console/boundary row without retaining stack objects or arbitrary arguments. */
function readTraceError(value: unknown): PreviewBlockerTraceError | undefined {
  if (!isTraceRecord(value)) return undefined;
  const level = readRequiredTraceText(value.level, 40);
  const message = readRequiredTraceText(value.message, TRACE_TEXT_LIMIT);
  const source = readRequiredTraceText(value.source, 120);
  const details = readOptionalTraceText(value.details, TRACE_ERROR_DETAILS_LIMIT);
  const exportName = readOptionalTraceText(value.exportName, TRACE_TEXT_LIMIT);
  const location = readOptionalTraceText(value.location, TRACE_SOURCE_PATH_LIMIT);
  const phase = readOptionalTraceText(value.phase, TRACE_TEXT_LIMIT);
  if (
    level === undefined ||
    message === undefined ||
    source === undefined ||
    details === null ||
    exportName === null ||
    location === null ||
    phase === null
  ) {
    return undefined;
  }
  return Object.freeze({
    ...(details === undefined ? {} : { details }),
    ...(exportName === undefined ? {} : { exportName }),
    level,
    ...(location === undefined ? {} : { location }),
    message,
    ...(phase === undefined ? {} : { phase }),
    source,
  });
}

/** Parses the selected export/page identity used to separate simultaneous pinned previews. */
function readTraceTarget(value: unknown): PreviewBlockerTraceTarget | undefined {
  if (!isTraceRecord(value)) return undefined;
  const exportName = readOptionalTraceText(value.exportName, TRACE_TEXT_LIMIT);
  const pageCandidateId = readOptionalTraceText(value.pageCandidateId, TRACE_TEXT_LIMIT);
  const renderScenario = readOptionalTraceText(value.renderScenario, 120);
  const revision = value.revision;
  if (
    exportName === null ||
    pageCandidateId === null ||
    renderScenario === null ||
    (revision !== undefined && (!Number.isSafeInteger(revision) || (revision as number) < 0))
  )
    return undefined;
  return Object.freeze({
    ...(exportName === undefined ? {} : { exportName }),
    ...(pageCandidateId === undefined ? {} : { pageCandidateId }),
    ...(renderScenario === undefined ? {} : { renderScenario }),
    ...(revision === undefined ? {} : { revision: revision as number }),
  });
}

/** Validates an absolute authored JS/TS source location before graph authorization. */
function readTraceSource(value: unknown): PreviewBlockerTraceSource | undefined {
  if (!isTraceRecord(value)) return undefined;
  const sourcePath = value.sourcePath;
  const line = value.line;
  const column = value.column;
  const occurrenceStart = value.occurrenceStart;
  if (
    typeof sourcePath !== 'string' ||
    sourcePath.length === 0 ||
    sourcePath.length > TRACE_SOURCE_PATH_LIMIT ||
    sourcePath.includes('\0') ||
    !path.isAbsolute(sourcePath) ||
    !isPreviewSourcePath(sourcePath) ||
    !isOptionalTraceCoordinate(line, false) ||
    !isOptionalTraceCoordinate(column, false) ||
    !isOptionalTraceCoordinate(occurrenceStart, true) ||
    (column !== undefined && line === undefined)
  ) {
    return undefined;
  }
  return Object.freeze({
    ...(column === undefined ? {} : { column: column as number }),
    ...(line === undefined ? {} : { line: line as number }),
    ...(occurrenceStart === undefined ? {} : { occurrenceStart: occurrenceStart as number }),
    sourcePath,
  });
}

/** Copies a short string list and rejects partial or oversized browser values. */
function readTraceTextList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > TRACE_LIST_LIMIT) return undefined;
  const values: string[] = [];
  for (const item of value) {
    const text = readRequiredTraceText(item, TRACE_TEXT_LIMIT);
    if (text === undefined) return undefined;
    values.push(text);
  }
  return Object.freeze(values);
}

/** Recursively copies one JSON value under a shared node and character budget. */
function copyBoundedTraceJson(value: unknown): PreviewBlockerTraceJson | undefined {
  const result = copyTraceJsonValue(value, 0, { characters: 0, nodes: 0 });
  return result.valid ? result.value : undefined;
}

/** Internal discriminated result keeps invalid input distinct from valid JSON `null`. */
function copyTraceJsonValue(
  value: unknown,
  depth: number,
  budget: { characters: number; nodes: number },
): { readonly valid: true; readonly value: PreviewBlockerTraceJson } | { readonly valid: false } {
  budget.nodes += 1;
  if (budget.nodes > TRACE_JSON_NODE_LIMIT || depth > TRACE_JSON_DEPTH_LIMIT) {
    return { valid: false };
  }
  if (value === null || typeof value === 'boolean') return { valid: true, value };
  if (typeof value === 'number' && Number.isFinite(value)) return { valid: true, value };
  if (typeof value === 'string') {
    budget.characters += value.length;
    return budget.characters <= TRACE_JSON_CHARACTER_LIMIT
      ? { valid: true, value }
      : { valid: false };
  }
  if (Array.isArray(value)) {
    if (value.length > TRACE_LIST_LIMIT) return { valid: false };
    const result: PreviewBlockerTraceJson[] = [];
    for (const item of value) {
      const copied = copyTraceJsonValue(item, depth + 1, budget);
      if (!copied.valid) return copied;
      result.push(copied.value);
    }
    return { valid: true, value: Object.freeze(result) };
  }
  if (!isTraceRecord(value)) return { valid: false };
  const entries = Object.entries(value);
  if (entries.length > TRACE_LIST_LIMIT) return { valid: false };
  const result: Record<string, PreviewBlockerTraceJson> = {};
  for (const [propertyName, propertyValue] of entries) {
    if (TRACE_BLOCKED_PROPERTY_NAMES.has(propertyName)) continue;
    budget.characters += propertyName.length;
    if (budget.characters > TRACE_JSON_CHARACTER_LIMIT) return { valid: false };
    const copied = copyTraceJsonValue(propertyValue, depth + 1, budget);
    if (!copied.valid) return copied;
    result[propertyName] = copied.value;
  }
  return { valid: true, value: Object.freeze(result) };
}

/** Reports whether one structured-clone value is a non-array object record. */
function isTraceRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a required non-empty bounded text identity. */
function readRequiredTraceText(value: unknown, limit: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= limit ? value : undefined;
}

/** Reads optional bounded text, returning `null` only for malformed present values. */
function readOptionalTraceText(value: unknown, limit: number): string | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === 'string' && value.length <= limit ? value : null;
}

/** Validates one optional browser source coordinate or zero-based source offset. */
function isOptionalTraceCoordinate(value: unknown, allowZero: boolean): boolean {
  return (
    value === undefined ||
    (Number.isSafeInteger(value) &&
      (value as number) >= (allowZero ? 0 : 1) &&
      (value as number) <= TRACE_COORDINATE_LIMIT)
  );
}
