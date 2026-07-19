/**
 * Routes Page Inspector webview messages that may touch extension-host resources.
 *
 * Keeping blocker trace logging and source navigation behind one adapter prevents the panel session
 * from accumulating protocol details as Inspector features expand. Each child handler still owns
 * its own parser and least-privilege filesystem boundary.
 */
import type * as vscode from 'vscode';
import { handlePreviewBlockerTraceMessage } from './previewBlockerTraceLogger';
import {
  handlePreviewInspectorSourceNavigationMessage,
  type PreviewInspectorSourceNavigationContext,
} from './previewInspectorSourceNavigation';

/** Combined panel state required by blocker tracing and signed source navigation. */
export interface PreviewInspectorHostMessageContext extends PreviewInspectorSourceNavigationContext {
  /** Immutable source target used to label events from simultaneous pinned previews. */
  readonly targetPath: string;
  /** Full log surface narrows independently inside each protocol handler. */
  readonly log: vscode.LogOutputChannel;
}

/**
 * Gives structured blocker traces precedence, then delegates signed editor navigation.
 *
 * @param value Untrusted structured-clone value emitted by the project preview webview.
 * @param context Current panel graph, gesture proof, source URI, and diagnostic channel.
 * @returns `true` only when one Page Inspector host protocol claimed the message.
 */
export function handlePreviewInspectorHostMessage(
  value: unknown,
  context: PreviewInspectorHostMessageContext,
): boolean {
  if (
    handlePreviewBlockerTraceMessage(value, {
      dependencyPaths: context.dependencyPaths,
      enabled: context.enabled,
      log: context.log,
      pinnedDocumentUri: context.pinnedDocumentUri,
      targetPath: context.targetPath,
    })
  ) {
    return true;
  }
  return handlePreviewInspectorSourceNavigationMessage(value, context);
}
