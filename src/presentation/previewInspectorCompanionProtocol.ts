/**
 * Defines the bounded message contract used by the separate React Inspector editor tab.
 * The preview webview remains the only project-code runtime; the companion tab receives an
 * extension-owned UI mirror and forwards narrowly described DOM interactions back to that runtime.
 */
import path from 'node:path';
import { isPreviewSourcePath } from '../domain/previewTarget';

/** Maximum serialized Inspector markup accepted from one preview runtime snapshot. */
const MAX_COMPANION_HTML_LENGTH = 8 * 1024 * 1024;

/** Maximum generated Inspector stylesheet accepted alongside one UI snapshot. */
const MAX_COMPANION_CSS_LENGTH = 512 * 1024;

/** Maximum editable value forwarded from the companion tab to one preview control. */
const MAX_COMPANION_VALUE_LENGTH = 2 * 1024 * 1024;

/** Maximum filesystem identity and editor coordinate accepted from one mirrored source button. */
const MAX_COMPANION_SOURCE_PATH_LENGTH = 16_384;
const MAX_COMPANION_SOURCE_COORDINATE = 10_000_000;

/** Maximum collector-issued tree identity accepted for one explicit companion reveal. */
const MAX_COMPANION_TREE_NODE_ID_LENGTH = 16_384;

/** Stable opaque identity assigned to one interactive element inside the preview Shadow DOM. */
const COMPANION_REMOTE_ID_PATTERN = /^rpi-[1-9][0-9]{0,9}$/u;

/** Keyboard values required by the component tree's accessible navigation behavior. */
const COMPANION_KEY_VALUES = new Set([
  ' ',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'Enter',
]);

/** Serializable Inspector document emitted by the authoritative preview webview. */
export interface PreviewInspectorCompanionSnapshot {
  /** Static extension-generated CSS used by the mirrored Inspector controls. */
  readonly css: string;
  /** Sanitized by the receiver before insertion into the companion webview. */
  readonly html: string;
  /** Monotonic preview-session sequence used to discard delayed snapshots. */
  readonly sequence: number;
  /**
   * One-shot external navigation intent. `true` reveals the selected row; a string reveals the
   * exact collector row. Ordinary pointer and keyboard selections omit this field so snapshots
   * preserve the user's current tree and document scroll coordinates.
   */
  readonly treeReveal?: true | string;
  /** Exact message discriminator routed only from preview to companion. */
  readonly type: 'react-preview-inspector-companion-snapshot';
}

/** Supported user event forwarded from the separate tab to its authoritative preview element. */
export interface PreviewInspectorCompanionAction {
  /** Checked state supplied only by checkbox-like controls. */
  readonly checked?: boolean;
  /** Exact bounded interaction kind reconstructed inside the preview Shadow DOM. */
  readonly eventType: 'change' | 'click' | 'dblclick' | 'input' | 'keydown';
  /** Keyboard value supplied only for accessible tree navigation. */
  readonly key?: string;
  /** Opaque identity minted by the preview runtime rather than a selector from the user. */
  readonly remoteId: string;
  /** Exact message discriminator routed only from companion to preview. */
  readonly type: 'react-preview-inspector-companion-action';
  /** Editable input value supplied for input and change interactions. */
  readonly value?: string;
}

/** Handshake sent after the companion document installs its event bridge. */
export interface PreviewInspectorCompanionReady {
  /** Exact message discriminator used to replay the latest retained snapshot. */
  readonly type: 'react-preview-inspector-companion-ready';
}

/** Focus request emitted when a wireframe blocker marker is activated in the renderer tab. */
export interface PreviewInspectorCompanionRevealRequest {
  /** Exact zero-payload discriminator accepted only from the paired preview webview. */
  readonly type: 'react-preview-inspector-companion-reveal';
}

/** Trusted-click source location emitted only by the extension-owned companion document. */
export interface PreviewInspectorCompanionOpenSourceRequest {
  /** Optional one-based source column paired with `line`. */
  readonly column?: number;
  /** Optional one-based source line exposed by JSX/static graph metadata. */
  readonly line?: number;
  /** Optional zero-based source occurrence retained when line metadata is unavailable. */
  readonly occurrenceStart?: number;
  /** Exact absolute component source path later checked against the committed dependency graph. */
  readonly sourcePath: string;
  /** Exact message discriminator routed only from the companion panel. */
  readonly type: 'react-preview-inspector-companion-open-source';
}

/** Parses and bounds one untrusted preview-to-extension Inspector snapshot. */
export function readPreviewInspectorCompanionSnapshot(
  value: unknown,
): PreviewInspectorCompanionSnapshot | undefined {
  if (!isMessageRecord(value) || value.type !== 'react-preview-inspector-companion-snapshot') {
    return undefined;
  }
  const { css, html, sequence, treeReveal } = value;
  if (
    typeof html !== 'string' ||
    html.length > MAX_COMPANION_HTML_LENGTH ||
    typeof css !== 'string' ||
    css.length > MAX_COMPANION_CSS_LENGTH ||
    !Number.isSafeInteger(sequence) ||
    (sequence as number) < 1 ||
    (treeReveal !== undefined &&
      treeReveal !== true &&
      (typeof treeReveal !== 'string' ||
        treeReveal.length === 0 ||
        treeReveal.length > MAX_COMPANION_TREE_NODE_ID_LENGTH))
  ) {
    return undefined;
  }
  return Object.freeze({
    css,
    html,
    sequence: sequence as number,
    ...(treeReveal === undefined ? {} : { treeReveal }),
    type: 'react-preview-inspector-companion-snapshot' as const,
  });
}

/** Parses one companion-to-preview interaction without accepting arbitrary browser events. */
export function readPreviewInspectorCompanionAction(
  value: unknown,
): PreviewInspectorCompanionAction | undefined {
  if (!isMessageRecord(value) || value.type !== 'react-preview-inspector-companion-action') {
    return undefined;
  }
  const { checked, eventType, key, remoteId, value: controlValue } = value;
  if (
    typeof remoteId !== 'string' ||
    !COMPANION_REMOTE_ID_PATTERN.test(remoteId) ||
    !['change', 'click', 'dblclick', 'input', 'keydown'].includes(String(eventType)) ||
    (checked !== undefined && typeof checked !== 'boolean') ||
    (controlValue !== undefined &&
      (typeof controlValue !== 'string' || controlValue.length > MAX_COMPANION_VALUE_LENGTH)) ||
    (key !== undefined && (typeof key !== 'string' || !COMPANION_KEY_VALUES.has(key))) ||
    (eventType === 'keydown' && key === undefined) ||
    (eventType !== 'keydown' && key !== undefined)
  ) {
    return undefined;
  }
  return Object.freeze({
    eventType: eventType as PreviewInspectorCompanionAction['eventType'],
    remoteId,
    type: 'react-preview-inspector-companion-action' as const,
    ...(checked === undefined ? {} : { checked }),
    ...(key === undefined ? {} : { key }),
    ...(controlValue === undefined ? {} : { value: controlValue }),
  });
}

/** Recognizes the zero-payload readiness handshake from the extension-owned companion document. */
export function isPreviewInspectorCompanionReady(
  value: unknown,
): value is PreviewInspectorCompanionReady {
  return isMessageRecord(value) && value.type === 'react-preview-inspector-companion-ready';
}

/** Recognizes the renderer's bounded request to focus its already-created Inspector companion. */
export function isPreviewInspectorCompanionRevealRequest(
  value: unknown,
): value is PreviewInspectorCompanionRevealRequest {
  return isMessageRecord(value) && value.type === 'react-preview-inspector-companion-reveal';
}

/** Parses one companion source click before the session applies its committed-graph allowlist. */
export function readPreviewInspectorCompanionOpenSourceRequest(
  value: unknown,
): PreviewInspectorCompanionOpenSourceRequest | undefined {
  if (!isMessageRecord(value) || value.type !== 'react-preview-inspector-companion-open-source') {
    return undefined;
  }
  const { column, line, occurrenceStart, sourcePath } = value;
  if (
    typeof sourcePath !== 'string' ||
    sourcePath.length === 0 ||
    sourcePath.length > MAX_COMPANION_SOURCE_PATH_LENGTH ||
    sourcePath.includes('\0') ||
    !path.isAbsolute(sourcePath) ||
    !isPreviewSourcePath(sourcePath) ||
    !isOptionalSourceCoordinate(line) ||
    !isOptionalSourceCoordinate(column) ||
    !isOptionalSourceOffset(occurrenceStart) ||
    (column !== undefined && line === undefined)
  ) {
    return undefined;
  }
  return Object.freeze({
    sourcePath,
    type: 'react-preview-inspector-companion-open-source' as const,
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
    ...(occurrenceStart === undefined ? {} : { occurrenceStart }),
  });
}

/** Accepts a bounded positive one-based editor coordinate. */
function isOptionalSourceCoordinate(value: unknown): value is number | undefined {
  return (
    value === undefined ||
    (Number.isSafeInteger(value) &&
      (value as number) > 0 &&
      (value as number) <= MAX_COMPANION_SOURCE_COORDINATE)
  );
}

/** Accepts a bounded non-negative source offset. */
function isOptionalSourceOffset(value: unknown): value is number | undefined {
  return (
    value === undefined ||
    (Number.isSafeInteger(value) &&
      (value as number) >= 0 &&
      (value as number) <= MAX_COMPANION_SOURCE_COORDINATE)
  );
}

/** Narrows structured-clone input to a non-array record before any property reads. */
function isMessageRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
