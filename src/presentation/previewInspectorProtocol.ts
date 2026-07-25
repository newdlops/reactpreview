/**
 * Defines the untrusted webview-to-extension protocol used to reveal Page Inspector component
 * sources. Parsing is kept free of VS Code APIs so malformed browser values can be rejected before
 * they reach filesystem, editor, or dependency-graph operations in the extension host.
 */
import path from 'node:path';
import { isPreviewSourcePath } from '../domain/previewTarget';

const MAX_INSPECTOR_SOURCE_PATH_LENGTH = 16_384;
const MAX_INSPECTOR_SOURCE_COORDINATE = 10_000_000;
const MAX_INSPECTOR_SELECTION_SEQUENCE = 10_000_000;
/** Bounds passive JSX branch marks emitted by one preview runtime revision. */
export const MAX_INSPECTOR_BRANCH_SOURCE_DECORATIONS = 256;
const INSPECTOR_GESTURE_NONCE_PATTERN = /^[a-f0-9]{32}$/u;
const INSPECTOR_GESTURE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

/** Validated request emitted when the user opens one component from the Inspector tree. */
export interface PreviewInspectorOpenSourceRequest {
  /** Optional one-based source column; it is meaningful only when `line` is present. */
  readonly column?: number;
  /** Random 128-bit hex nonce consumed once by the extension-host gesture gate. */
  readonly gestureNonce: string;
  /** Base64url HMAC binding this nonce to the exact path and coordinates. */
  readonly gestureToken: string;
  /** Optional one-based source line reported by JSX development metadata or static analysis. */
  readonly line?: number;
  /** Optional zero-based source offset retained by the static render graph. */
  readonly occurrenceStart?: number;
  /** Exact absolute JS or TS path signed by the rendered React component tree. */
  readonly sourcePath: string;
  /** Exact protocol discriminator owned by React Page Inspector. */
  readonly type: 'react-preview-inspector-open-source';
}

/** Common correlation fields carried by every component-tree selection notification. */
interface PreviewInspectorSourceSelectionEnvelope {
  /** Runtime revision that rendered the selected tree row. */
  readonly runtimeRevision: number;
  /** Positive runtime-owned order used to reject delayed selection messages. */
  readonly sequence: number;
  /** Exact protocol discriminator owned by React Page Inspector. */
  readonly type: 'react-preview-inspector-source-selected';
}

/** Validated notification that clears the editor mark when no tree source remains selected. */
export interface PreviewInspectorSourceSelectionClearRequest extends PreviewInspectorSourceSelectionEnvelope {
  readonly sourcePath?: never;
}

/** Validated notification that associates the selected tree row with authored source. */
export interface PreviewInspectorSourceSelectionLocationRequest extends PreviewInspectorSourceSelectionEnvelope {
  /** Whether static inference supplied a best-effort rather than exact authored location. */
  readonly approximate?: boolean;
  /** Optional one-based source column; it is meaningful only when `line` is present. */
  readonly column?: number;
  /** Optional one-based source line reported by JSX metadata or static analysis. */
  readonly line?: number;
  /** Optional zero-based source offset retained by the static render graph. */
  readonly occurrenceStart?: number;
  /** Absolute JS or TS source path retained by the committed preview graph. */
  readonly sourcePath: string;
}

/** Selection protocol accepted by the non-focusing editor decoration service. */
export type PreviewInspectorSourceSelectionRequest =
  PreviewInspectorSourceSelectionClearRequest | PreviewInspectorSourceSelectionLocationRequest;

/** One source-backed Boolean JSX decision rendered as a passive editor annotation. */
export interface PreviewInspectorBranchSourceLocation {
  /** Optional one-based source column retained for an accurate hover anchor. */
  readonly column?: number;
  /** Optional one-based source line for the condition expression. */
  readonly line?: number;
  /** Optional zero-based source offset used when line metadata is unavailable. */
  readonly occurrenceStart?: number;
  /** Absolute React source path retained by the selected-file scenario model. */
  readonly sourcePath: string;
}

/** Validated bounded inventory used to paint all current-file ON/OFF decisions at once. */
export interface PreviewInspectorBranchSourceDecorationRequest {
  /** Runtime revision whose authored source produced these locations. */
  readonly runtimeRevision: number;
  /** Monotonic branch-inventory sequence independent from tree selection ordering. */
  readonly sequence: number;
  /** At most the compiler-owned JSX scenario limit of source-backed decisions. */
  readonly sources: readonly PreviewInspectorBranchSourceLocation[];
  /** Exact passive-decoration protocol discriminator. */
  readonly type: 'react-preview-inspector-branch-sources';
}

/**
 * Parses one structured-clone value without trusting browser-provided paths or coordinates.
 * Coordinates are bounded before the host later clamps them to the current document contents.
 * Requiring an absolute supported source path also prevents an attacker-controlled webview from
 * resolving relative paths against the extension host process directory.
 *
 * @param value Untrusted value received through `Webview.onDidReceiveMessage`.
 * @returns Frozen source request, or `undefined` when any protocol field is malformed.
 */
export function readPreviewInspectorOpenSourceRequest(
  value: unknown,
): PreviewInspectorOpenSourceRequest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const message = value as Record<string, unknown>;
  const sourcePath = message.sourcePath;
  if (
    message.type !== 'react-preview-inspector-open-source' ||
    typeof sourcePath !== 'string' ||
    sourcePath.length === 0 ||
    sourcePath.length > MAX_INSPECTOR_SOURCE_PATH_LENGTH ||
    sourcePath.includes('\0') ||
    !path.isAbsolute(sourcePath) ||
    !isPreviewSourcePath(sourcePath)
  ) {
    return undefined;
  }

  const line = message.line;
  const column = message.column;
  const occurrenceStart = message.occurrenceStart;
  const gestureNonce = message.gestureNonce;
  const gestureToken = message.gestureToken;
  if (
    !isOptionalInspectorSourceCoordinate(line) ||
    !isOptionalInspectorSourceCoordinate(column) ||
    !isOptionalInspectorSourceOffset(occurrenceStart) ||
    typeof gestureNonce !== 'string' ||
    !INSPECTOR_GESTURE_NONCE_PATTERN.test(gestureNonce) ||
    typeof gestureToken !== 'string' ||
    !INSPECTOR_GESTURE_TOKEN_PATTERN.test(gestureToken) ||
    (column !== undefined && line === undefined)
  ) {
    return undefined;
  }

  const baseRequest = {
    gestureNonce,
    gestureToken,
    sourcePath,
    type: 'react-preview-inspector-open-source' as const,
  };
  return Object.freeze({
    ...baseRequest,
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
    ...(occurrenceStart === undefined ? {} : { occurrenceStart }),
  });
}

/**
 * Reports whether an untrusted value claims the tree-selection discriminator. Host routing uses
 * this narrow check to consume malformed selection messages instead of letting them collide with
 * unrelated hot-reload protocols.
 */
export function isPreviewInspectorSourceSelectionMessage(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).type === 'react-preview-inspector-source-selected'
  );
}

/** Reports whether untrusted traffic claims the passive JSX branch-decoration protocol. */
export function isPreviewInspectorBranchSourceDecorationMessage(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).type === 'react-preview-inspector-branch-sources'
  );
}

/**
 * Parses a bounded branch inventory without opening editors or resolving filesystem paths.
 *
 * Every retained item needs an exact absolute React source plus either a one-based line or a
 * zero-based occurrence offset. The panel later applies its committed dependency-graph allowlist.
 *
 * @param value Untrusted structured-clone value from the preview runtime.
 * @returns Frozen branch inventory, including an empty list that explicitly clears old marks.
 */
export function readPreviewInspectorBranchSourceDecorationRequest(
  value: unknown,
): PreviewInspectorBranchSourceDecorationRequest | undefined {
  if (!isPreviewInspectorBranchSourceDecorationMessage(value)) return undefined;
  const message = value as Record<string, unknown>;
  const runtimeRevision = message.runtimeRevision;
  const sequence = message.sequence;
  const sources = message.sources;
  if (
    !Number.isSafeInteger(runtimeRevision) ||
    (runtimeRevision as number) < 0 ||
    !Number.isSafeInteger(sequence) ||
    (sequence as number) <= 0 ||
    (sequence as number) > MAX_INSPECTOR_SELECTION_SEQUENCE ||
    !Array.isArray(sources) ||
    sources.length > MAX_INSPECTOR_BRANCH_SOURCE_DECORATIONS
  ) {
    return undefined;
  }
  const normalizedSources: PreviewInspectorBranchSourceLocation[] = [];
  for (const value of sources) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const source = value as Record<string, unknown>;
    const sourcePath = source.sourcePath;
    const line = source.line;
    const column = source.column;
    const occurrenceStart = source.occurrenceStart;
    if (
      !isInspectorSourcePath(sourcePath) ||
      !isOptionalInspectorSourceCoordinate(line) ||
      !isOptionalInspectorSourceCoordinate(column) ||
      !isOptionalInspectorSourceOffset(occurrenceStart) ||
      (column !== undefined && line === undefined) ||
      (line === undefined && occurrenceStart === undefined)
    ) {
      return undefined;
    }
    normalizedSources.push(
      Object.freeze({
        ...(column === undefined ? {} : { column }),
        ...(line === undefined ? {} : { line }),
        ...(occurrenceStart === undefined ? {} : { occurrenceStart }),
        sourcePath,
      }),
    );
  }
  return Object.freeze({
    runtimeRevision: runtimeRevision as number,
    sequence: sequence as number,
    sources: Object.freeze(normalizedSources),
    type: 'react-preview-inspector-branch-sources',
  });
}

/**
 * Parses one component-tree selection without granting it filesystem or editor authority. A clear
 * notification intentionally carries no path or coordinates. Located selections reuse the same
 * absolute React-source and bounded-coordinate policy as explicit source navigation.
 *
 * @param value Untrusted structured-clone value emitted by the preview runtime.
 * @returns Frozen selection request, or `undefined` when any field is malformed.
 */
export function readPreviewInspectorSourceSelectionRequest(
  value: unknown,
): PreviewInspectorSourceSelectionRequest | undefined {
  if (!isPreviewInspectorSourceSelectionMessage(value)) return undefined;
  const message = value as Record<string, unknown>;
  const runtimeRevision = message.runtimeRevision;
  const sequence = message.sequence;
  if (
    !Number.isSafeInteger(runtimeRevision) ||
    (runtimeRevision as number) < 0 ||
    !Number.isSafeInteger(sequence) ||
    (sequence as number) <= 0 ||
    (sequence as number) > MAX_INSPECTOR_SELECTION_SEQUENCE
  ) {
    return undefined;
  }

  const sourcePath = message.sourcePath;
  const line = message.line;
  const column = message.column;
  const occurrenceStart = message.occurrenceStart;
  const approximate = message.approximate;
  const envelope = {
    runtimeRevision: runtimeRevision as number,
    sequence: sequence as number,
    type: 'react-preview-inspector-source-selected' as const,
  };
  if (sourcePath === undefined) {
    return line === undefined &&
      column === undefined &&
      occurrenceStart === undefined &&
      approximate === undefined
      ? Object.freeze(envelope)
      : undefined;
  }
  if (
    !isInspectorSourcePath(sourcePath) ||
    !isOptionalInspectorSourceCoordinate(line) ||
    !isOptionalInspectorSourceCoordinate(column) ||
    !isOptionalInspectorSourceOffset(occurrenceStart) ||
    (approximate !== undefined && typeof approximate !== 'boolean') ||
    (column !== undefined && line === undefined)
  ) {
    return undefined;
  }
  return Object.freeze({
    ...envelope,
    sourcePath,
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
    ...(occurrenceStart === undefined ? {} : { occurrenceStart }),
    ...(approximate === undefined ? {} : { approximate }),
  });
}

/** Applies the shared absolute React-source policy without interpreting editor coordinates. */
function isInspectorSourcePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_INSPECTOR_SOURCE_PATH_LENGTH &&
    !value.includes('\0') &&
    path.isAbsolute(value) &&
    isPreviewSourcePath(value)
  );
}

/** Reports whether one optional browser coordinate is a bounded positive one-based integer. */
function isOptionalInspectorSourceCoordinate(value: unknown): value is number | undefined {
  return (
    value === undefined ||
    (Number.isSafeInteger(value) &&
      (value as number) > 0 &&
      (value as number) <= MAX_INSPECTOR_SOURCE_COORDINATE)
  );
}

/** Reports whether one optional graph position is a bounded non-negative zero-based offset. */
function isOptionalInspectorSourceOffset(value: unknown): value is number | undefined {
  return (
    value === undefined ||
    (Number.isSafeInteger(value) &&
      (value as number) >= 0 &&
      (value as number) <= MAX_INSPECTOR_SOURCE_COORDINATE)
  );
}
