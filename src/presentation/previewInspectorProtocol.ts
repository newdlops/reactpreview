/**
 * Defines the untrusted webview-to-extension protocol used to reveal Page Inspector component
 * sources. Parsing is kept free of VS Code APIs so malformed browser values can be rejected before
 * they reach filesystem, editor, or dependency-graph operations in the extension host.
 */
import path from 'node:path';
import { isPreviewSourcePath } from '../domain/previewTarget';

const MAX_INSPECTOR_SOURCE_PATH_LENGTH = 16_384;
const MAX_INSPECTOR_SOURCE_COORDINATE = 10_000_000;
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
