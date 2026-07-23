/**
 * Writes validated live renderer-health events to the shared React Preview Output channel.
 * Health records stay independent from blocker traces so package identity, theme repair, render
 * attempts, and fallback cascades can be filtered without conflating them with user payload choices.
 */
import type * as vscode from 'vscode';
import {
  isPreviewRuntimeHealthMessage,
  readPreviewRuntimeHealthMessage,
} from './previewRuntimeHealthProtocol';
import { formatPreviewRuntimeHealthSummary } from './previewRuntimeHealthSummary';

/** Host capabilities required to accept one Page Inspector health message. */
export interface PreviewRuntimeHealthLogContext {
  /** Rejects health protocol work from ordinary component-gallery webviews. */
  readonly enabled: boolean;
  /** Shared structured log surface used by every preview session. */
  readonly log: Pick<vscode.LogOutputChannel, 'debug' | 'error' | 'info' | 'warn'>;
  /** Immutable target path distinguishing simultaneous pinned previews. */
  readonly targetPath: string;
}

/** Global promise lane preserves receive order across asynchronous pinned preview sessions. */
let runtimeHealthOutputQueue: Promise<void> = Promise.resolve();

/** Claims, validates, and schedules one live renderer-health Output record. */
export function handlePreviewRuntimeHealthMessage(
  value: unknown,
  context: PreviewRuntimeHealthLogContext,
): boolean {
  if (!isPreviewRuntimeHealthMessage(value)) return false;
  if (!context.enabled) {
    context.log.debug('Ignored a React Preview runtime health event outside Page Inspector mode.');
    return true;
  }
  const message = readPreviewRuntimeHealthMessage(value);
  if (message === undefined) {
    context.log.debug('Ignored a malformed React Preview runtime health event.');
    return true;
  }
  const task = runtimeHealthOutputQueue.then(() => {
    const record = {
      format: 'react-preview-runtime-health/v1',
      previewTarget: context.targetPath,
      ...(message.artifactId === undefined ? {} : { artifactId: message.artifactId }),
      ...(message.runtimeRevision === undefined
        ? {}
        : { runtimeRevision: message.runtimeRevision }),
      ...(message.runtimeSessionId === undefined
        ? {}
        : { runtimeSessionId: message.runtimeSessionId }),
      ...(message.runtimeVersion === undefined ? {} : { runtimeVersion: message.runtimeVersion }),
      ...message.event,
    };
    const summary = formatPreviewRuntimeHealthSummary(message.event);
    const output = [
      'React preview runtime health',
      ...(summary === undefined ? [] : [summary, 'Structured record:']),
      JSON.stringify(record, undefined, 2),
    ].join('\n');
    context.log[message.event.severity](output);
  });
  runtimeHealthOutputQueue = task.catch((error: unknown) => {
    context.log.debug('Could not write a React Preview runtime health event.', error);
  });
  return true;
}
