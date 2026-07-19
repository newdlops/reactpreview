/**
 * Validates the browser-to-extension protocol for live renderer health diagnostics.
 * The webview executes untrusted project code, so only enumerated event kinds, bounded JSON values,
 * safe source coordinates, and revision-local identities may reach the shared Output channel.
 */
import path from 'node:path';
import { isPreviewSourcePath } from '../domain/previewTarget';

/** Exact discriminator reserved for renderer health messages. */
export const PREVIEW_RUNTIME_HEALTH_MESSAGE_TYPE = 'react-preview-runtime-health';

const HEALTH_TEXT_LIMIT = 4_000;
const HEALTH_PATH_LIMIT = 16_384;
const HEALTH_JSON_DEPTH_LIMIT = 6;
const HEALTH_JSON_NODE_LIMIT = 512;
const HEALTH_JSON_CHARACTER_LIMIT = 64 * 1024;
const HEALTH_BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const HEALTH_EVENTS = new Set<PreviewRuntimeHealthEventKind>([
  'graphql-interpolation-repaired',
  'page-context-selected',
  'render-attempt-started',
  'render-attempt-settled',
  'runtime-error-cascade',
  'runtime-error-fallback',
  'runtime-error-root',
  'styled-components-instance-warning',
  'theme-boundary-composed',
  'theme-token-repaired',
]);
const HEALTH_SEVERITIES = new Set<PreviewRuntimeHealthSeverity>(['error', 'info', 'warn']);

/** Renderer mechanisms and correlated outcomes admitted by the live health stream. */
export type PreviewRuntimeHealthEventKind =
  | 'graphql-interpolation-repaired'
  | 'page-context-selected'
  | 'render-attempt-started'
  | 'render-attempt-settled'
  | 'runtime-error-cascade'
  | 'runtime-error-fallback'
  | 'runtime-error-root'
  | 'styled-components-instance-warning'
  | 'theme-boundary-composed'
  | 'theme-token-repaired';

/** Fixed severity values used by Output filtering and future Inspector health presentation. */
export type PreviewRuntimeHealthSeverity = 'error' | 'info' | 'warn';

/** JSON-compatible renderer-owned diagnostic value after recursive budget validation. */
export type PreviewRuntimeHealthJson =
  | boolean
  | number
  | string
  | null
  | readonly PreviewRuntimeHealthJson[]
  | { readonly [key: string]: PreviewRuntimeHealthJson };

/** Authored source evidence attached to a compiler-instrumented compatibility decision. */
export interface PreviewRuntimeHealthSource {
  readonly column?: number;
  readonly line?: number;
  readonly sourcePath: string;
}

/** Selected Page Inspector identity included in every event. */
export interface PreviewRuntimeHealthTarget {
  readonly exportName?: string;
  readonly pageCandidateId?: string;
  readonly renderScenario?: string;
}

/** One validated runtime-health event emitted by a pinned preview revision. */
export interface PreviewRuntimeHealthEvent {
  readonly category: string;
  readonly detail: PreviewRuntimeHealthJson;
  readonly event: PreviewRuntimeHealthEventKind;
  readonly eventId: string;
  readonly parentEventId?: string;
  readonly revision: number;
  readonly sequence: number;
  readonly severity: PreviewRuntimeHealthSeverity;
  readonly source?: PreviewRuntimeHealthSource;
  readonly target?: PreviewRuntimeHealthTarget;
  readonly timestamp: string;
}

/** Browser envelope carrying exactly one live renderer-health event. */
export interface PreviewRuntimeHealthMessage {
  readonly event: PreviewRuntimeHealthEvent;
  readonly type: typeof PREVIEW_RUNTIME_HEALTH_MESSAGE_TYPE;
}

/** Reports whether an untrusted value claims the renderer-health message discriminator. */
export function isPreviewRuntimeHealthMessage(value: unknown): value is Record<string, unknown> & {
  readonly type: typeof PREVIEW_RUNTIME_HEALTH_MESSAGE_TYPE;
} {
  return isHealthRecord(value) && value.type === PREVIEW_RUNTIME_HEALTH_MESSAGE_TYPE;
}

/** Parses and recursively freezes one bounded renderer-health message. */
export function readPreviewRuntimeHealthMessage(
  value: unknown,
): PreviewRuntimeHealthMessage | undefined {
  if (!isPreviewRuntimeHealthMessage(value)) return undefined;
  const event = readPreviewRuntimeHealthEvent(value.event);
  return event === undefined
    ? undefined
    : Object.freeze({ event, type: PREVIEW_RUNTIME_HEALTH_MESSAGE_TYPE });
}

/** Validates primary identity, revision, source, target, and bounded diagnostic detail. */
function readPreviewRuntimeHealthEvent(value: unknown): PreviewRuntimeHealthEvent | undefined {
  if (!isHealthRecord(value)) return undefined;
  const category = readHealthText(value.category, 80);
  const event = readHealthText(value.event, 80);
  const eventId = readHealthText(value.eventId, 160);
  const parentEventId = readOptionalHealthText(value.parentEventId, 160);
  const severity = readHealthText(value.severity, 20);
  const timestamp = readHealthText(value.timestamp, 80);
  const revision = value.revision;
  const sequence = value.sequence;
  const detail = copyBoundedHealthJson(value.detail);
  const source = value.source === undefined ? undefined : readHealthSource(value.source);
  const target = value.target === undefined ? undefined : readHealthTarget(value.target);
  if (
    category === undefined ||
    event === undefined ||
    !HEALTH_EVENTS.has(event as PreviewRuntimeHealthEventKind) ||
    eventId === undefined ||
    parentEventId === null ||
    severity === undefined ||
    !HEALTH_SEVERITIES.has(severity as PreviewRuntimeHealthSeverity) ||
    timestamp === undefined ||
    !Number.isSafeInteger(revision) ||
    (revision as number) < 0 ||
    !Number.isSafeInteger(sequence) ||
    (sequence as number) < 1 ||
    detail === undefined ||
    (value.source !== undefined && source === undefined) ||
    (value.target !== undefined && target === undefined)
  ) {
    return undefined;
  }
  return Object.freeze({
    category,
    detail,
    event: event as PreviewRuntimeHealthEventKind,
    eventId,
    ...(parentEventId === undefined ? {} : { parentEventId }),
    revision: revision as number,
    sequence: sequence as number,
    severity: severity as PreviewRuntimeHealthSeverity,
    ...(source === undefined ? {} : { source }),
    ...(target === undefined ? {} : { target }),
    timestamp,
  });
}

/** Accepts authored code or inert JSON route catalogs plus coherent positive coordinates. */
function readHealthSource(value: unknown): PreviewRuntimeHealthSource | undefined {
  if (!isHealthRecord(value)) return undefined;
  const sourcePath = readHealthText(value.sourcePath, HEALTH_PATH_LIMIT);
  const line = readOptionalPositiveInteger(value.line);
  const column = readOptionalPositiveInteger(value.column);
  if (
    sourcePath === undefined ||
    !path.isAbsolute(sourcePath) ||
    !(isPreviewSourcePath(sourcePath) || path.extname(sourcePath).toLowerCase() === '.json') ||
    line === null ||
    column === null ||
    (column !== undefined && line === undefined)
  ) {
    return undefined;
  }
  return Object.freeze({
    ...(column === undefined ? {} : { column }),
    ...(line === undefined ? {} : { line }),
    sourcePath: path.normalize(sourcePath),
  });
}

/** Copies optional selected-target strings without admitting arbitrary renderer state. */
function readHealthTarget(value: unknown): PreviewRuntimeHealthTarget | undefined {
  if (!isHealthRecord(value)) return undefined;
  const exportName = readOptionalHealthText(value.exportName, HEALTH_TEXT_LIMIT);
  const pageCandidateId = readOptionalHealthText(value.pageCandidateId, HEALTH_TEXT_LIMIT);
  const renderScenario = readOptionalHealthText(value.renderScenario, 120);
  if (exportName === null || pageCandidateId === null || renderScenario === null) return undefined;
  return Object.freeze({
    ...(exportName === undefined ? {} : { exportName }),
    ...(pageCandidateId === undefined ? {} : { pageCandidateId }),
    ...(renderScenario === undefined ? {} : { renderScenario }),
  });
}

/** Recursively copies plain JSON within depth, node-count, and character budgets. */
function copyBoundedHealthJson(value: unknown): PreviewRuntimeHealthJson | undefined {
  const state = { characters: 0, nodes: 0, seen: new WeakSet() };
  return copyHealthJsonNode(value, 0, state);
}

/** Copies one JSON node without evaluating accessors or accepting prototype-sensitive keys. */
function copyHealthJsonNode(
  value: unknown,
  depth: number,
  state: { characters: number; nodes: number; seen: WeakSet<object> },
): PreviewRuntimeHealthJson | undefined {
  state.nodes += 1;
  if (state.nodes > HEALTH_JSON_NODE_LIMIT || depth > HEALTH_JSON_DEPTH_LIMIT) return undefined;
  if (typeof value === 'string') {
    state.characters += value.length;
    return state.characters <= HEALTH_JSON_CHARACTER_LIMIT ? value : undefined;
  }
  if (typeof value === 'boolean' || value === null) return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'object' || state.seen.has(value)) return undefined;
  state.seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > 128) return undefined;
    const items: PreviewRuntimeHealthJson[] = [];
    for (const item of value) {
      const copied = copyHealthJsonNode(item, depth + 1, state);
      if (copied === undefined) return undefined;
      items.push(copied);
    }
    return Object.freeze(items);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length > 128 || keys.some((key) => HEALTH_BLOCKED_KEYS.has(key))) return undefined;
  const copiedRecord: Record<string, PreviewRuntimeHealthJson> = {};
  for (const key of keys) {
    state.characters += key.length;
    const copied = copyHealthJsonNode(record[key], depth + 1, state);
    if (state.characters > HEALTH_JSON_CHARACTER_LIMIT || copied === undefined) return undefined;
    copiedRecord[key] = copied;
  }
  return Object.freeze(copiedRecord);
}

/** Reads a required non-empty bounded string. */
function readHealthText(value: unknown, limit: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= limit ? value : undefined;
}

/** Reads an optional bounded string, returning null when an explicitly supplied value is invalid. */
function readOptionalHealthText(value: unknown, limit: number): string | undefined | null {
  return value === undefined ? undefined : (readHealthText(value, limit) ?? null);
}

/** Reads an optional positive integer and distinguishes absence from malformed coordinates. */
function readOptionalPositiveInteger(value: unknown): number | undefined | null {
  return value === undefined
    ? undefined
    : Number.isSafeInteger(value) && (value as number) > 0
      ? (value as number)
      : null;
}

/** Narrows untrusted structured-clone values to ordinary non-array records. */
function isHealthRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
