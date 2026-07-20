/**
 * Enriches validated Page Inspector blocker events with authorized source excerpts and writes them
 * as chronological structured records to the shared React Preview Output channel.
 *
 * Browser messages never choose an arbitrary host file: source text is read only when the exact
 * canonical path belongs to the requesting panel's last committed bundle graph. A module-level
 * promise lane preserves receive order across pinned tabs without blocking the extension host.
 */
import * as vscode from 'vscode';
import { canonicalizeExistingPath } from '../shared/pathIdentity';
import {
  isPreviewBlockerTraceMessage,
  readPreviewBlockerTraceMessage,
  type PreviewBlockerTraceMessage,
  type PreviewBlockerTraceSource,
} from './previewBlockerTraceProtocol';
import { resolveAuthorizedPreviewInspectorSourceIdentity } from './previewInspectorSourceNavigation';
import { createPreviewSiblingResourceUri } from './previewPanelSessionUtilities';

const BLOCKER_TRACE_SOURCE_RADIUS = 4;
const BLOCKER_TRACE_SOURCE_LINE_LIMIT = 600;
const BLOCKER_TRACE_ERROR_LIMIT = 1_000;

/** Extension-host capabilities allowed while enriching one panel-owned blocker trace event. */
export interface PreviewBlockerTraceLogContext {
  /** Canonical paths reached by the last committed preview bundle. */
  readonly dependencyPaths: ReadonlySet<string>;
  /** Restricts browser-authored trace events to the explicit Page Inspector rendering mode. */
  readonly enabled: boolean;
  /** Shared diagnostic channel; trace rows use info while malformed reads stay at debug level. */
  readonly log: Pick<vscode.LogOutputChannel, 'debug' | 'info'>;
  /** Pinned document URI whose remote scheme and authority are reused for sibling source reads. */
  readonly pinnedDocumentUri: vscode.Uri;
  /** Immutable target file used to distinguish records from simultaneous preview tabs. */
  readonly targetPath: string;
}

/** One source line retained in the machine-readable Output record. */
interface PreviewBlockerTraceSourceLine {
  readonly focus: boolean;
  readonly line: number;
  readonly text: string;
}

/** Authorized source enrichment or a readable reason that source text was unavailable. */
interface PreviewBlockerTraceSourceExcerpt {
  readonly lines?: readonly PreviewBlockerTraceSourceLine[];
  readonly sourcePath: string;
  readonly status: 'available' | 'outside-committed-graph' | 'read-failed';
  readonly reason?: string;
}

/** Global serialization lane keeps Output order equal to webview message receive order. */
let blockerTraceOutputQueue: Promise<void> = Promise.resolve();

/**
 * Claims one blocker trace protocol message and schedules its structured Output record.
 *
 * Recognized malformed messages are consumed and diagnosed without reaching source navigation or
 * hot-reload handlers. Valid events run asynchronously so source-provider latency cannot block the
 * webview message callback or VS Code UI thread.
 *
 * @param value Untrusted message received from the pinned preview webview.
 * @param context Current graph allowlist, URI identity, target path, and Output channel.
 * @returns `true` when the message claimed the blocker trace discriminator.
 */
export function handlePreviewBlockerTraceMessage(
  value: unknown,
  context: PreviewBlockerTraceLogContext,
): boolean {
  if (!isPreviewBlockerTraceMessage(value)) return false;
  if (!context.enabled) {
    context.log.debug('Ignored a React Preview blocker trace outside Page Inspector mode.');
    return true;
  }
  const message = readPreviewBlockerTraceMessage(value);
  if (message === undefined) {
    context.log.debug('Ignored a malformed React Preview blocker trace message.');
    return true;
  }

  const task = blockerTraceOutputQueue.then(() => writePreviewBlockerTraceEvent(message, context));
  blockerTraceOutputQueue = task.catch((error: unknown) => {
    context.log.debug('Could not write a React Preview blocker trace event.', error);
  });
  return true;
}

/** Reads optional authored source and writes one pretty JSON record with a stable grep marker. */
async function writePreviewBlockerTraceEvent(
  message: PreviewBlockerTraceMessage,
  context: PreviewBlockerTraceLogContext,
): Promise<void> {
  const { event } = message;
  const sourceCode =
    event.blocker?.source === undefined
      ? undefined
      : await readPreviewBlockerTraceSourceExcerpt(event.blocker.source, context);
  const record = {
    format: 'react-preview-blocker-trace/v1',
    previewTarget: context.targetPath,
    ...(message.artifactId === undefined ? {} : { artifactId: message.artifactId }),
    ...(message.runtimeRevision === undefined ? {} : { runtimeRevision: message.runtimeRevision }),
    ...(message.runtimeSessionId === undefined
      ? {}
      : { runtimeSessionId: message.runtimeSessionId }),
    ...(message.runtimeVersion === undefined ? {} : { runtimeVersion: message.runtimeVersion }),
    ...event,
    ...(sourceCode === undefined ? {} : { sourceCode }),
  };
  context.log.info(`React preview blocker trace\n${JSON.stringify(record, undefined, 2)}`);
}

/**
 * Reads a small excerpt only after exact lexical and canonical dependency-graph authorization.
 * Open dirty documents are preferred so the trace describes the code the next hot reload sees.
 */
async function readPreviewBlockerTraceSourceExcerpt(
  source: PreviewBlockerTraceSource,
  context: PreviewBlockerTraceLogContext,
): Promise<PreviewBlockerTraceSourceExcerpt> {
  const sourceIdentity = resolveAuthorizedPreviewInspectorSourceIdentity(
    source.sourcePath,
    context.dependencyPaths,
  );
  if (sourceIdentity === undefined) {
    return Object.freeze({
      sourcePath: source.sourcePath,
      status: 'outside-committed-graph' as const,
    });
  }

  try {
    const openDocument = vscode.workspace.textDocuments.find(
      (document) =>
        document.uri.scheme === context.pinnedDocumentUri.scheme &&
        document.uri.authority === context.pinnedDocumentUri.authority &&
        canonicalizeExistingPath(document.fileName) === sourceIdentity,
    );
    const sourceUri =
      openDocument?.uri ??
      createPreviewSiblingResourceUri(context.pinnedDocumentUri, source.sourcePath);
    const document = openDocument ?? (await vscode.workspace.openTextDocument(sourceUri));
    const focusLine = resolvePreviewBlockerTraceFocusLine(document, source);
    const firstLine = Math.max(0, focusLine - BLOCKER_TRACE_SOURCE_RADIUS);
    const lastLine = Math.min(document.lineCount - 1, focusLine + BLOCKER_TRACE_SOURCE_RADIUS);
    const lines: PreviewBlockerTraceSourceLine[] = [];
    for (let line = firstLine; line <= lastLine; line += 1) {
      const text = document.lineAt(line).text;
      lines.push(
        Object.freeze({
          focus: line === focusLine,
          line: line + 1,
          text:
            text.length <= BLOCKER_TRACE_SOURCE_LINE_LIMIT
              ? text
              : `${text.slice(0, BLOCKER_TRACE_SOURCE_LINE_LIMIT)}…`,
        }),
      );
    }
    return Object.freeze({
      lines: Object.freeze(lines),
      sourcePath: source.sourcePath,
      status: 'available' as const,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return Object.freeze({
      reason: reason.slice(0, BLOCKER_TRACE_ERROR_LIMIT),
      sourcePath: source.sourcePath,
      status: 'read-failed' as const,
    });
  }
}

/** Resolves a one-based line first, then a graph offset, and finally the beginning of the file. */
function resolvePreviewBlockerTraceFocusLine(
  document: vscode.TextDocument,
  source: PreviewBlockerTraceSource,
): number {
  if (source.line !== undefined) {
    return Math.min(Math.max(0, source.line - 1), Math.max(0, document.lineCount - 1));
  }
  if (source.occurrenceStart !== undefined) {
    return document.positionAt(source.occurrenceStart).line;
  }
  return 0;
}
