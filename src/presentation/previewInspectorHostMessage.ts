/**
 * Routes Page Inspector webview messages that may touch extension-host resources.
 *
 * Keeping blocker trace logging and source navigation behind one adapter prevents the panel session
 * from accumulating protocol details as Inspector features expand. Each child handler still owns
 * its own parser and least-privilege filesystem boundary.
 */
import type * as vscode from 'vscode';
import { handlePreviewBlockerTraceMessage } from './previewBlockerTraceLogger';
import { handlePreviewRuntimeHealthMessage } from './previewRuntimeHealthLogger';
import {
  handlePreviewInspectorSourceNavigationMessage,
  type PreviewInspectorSourceNavigationContext,
} from './previewInspectorSourceNavigation';
import {
  isPreviewInspectorSourceSelectionMessage,
  readPreviewInspectorSourceSelectionRequest,
} from './previewInspectorProtocol';
import type { PreviewInspectorSourceDecoration } from './previewInspectorSourceDecoration';

/** Combined panel state required by blocker tracing and signed source navigation. */
export interface PreviewInspectorHostMessageContext extends PreviewInspectorSourceNavigationContext {
  /** Revision currently committed by the panel; in-flight builds must not decorate old sources. */
  readonly currentRuntimeRevision: number;
  /** Panel-owned source marker retaining one pending selection for later-visible editors. */
  readonly sourceDecoration: PreviewInspectorSourceDecoration;
  /** Immutable source target used to label events from simultaneous pinned previews. */
  readonly targetPath: string;
  /** Full log surface narrows independently inside each protocol handler. */
  readonly log: vscode.LogOutputChannel;
}

/**
 * Routes renderer health and blocker traces before delegating signed editor navigation.
 *
 * @param value Untrusted structured-clone value emitted by the project preview webview.
 * @param context Current panel graph, gesture proof, source URI, and diagnostic channel.
 * @returns `true` only when one Page Inspector host protocol claimed the message.
 */
export function handlePreviewInspectorHostMessage(
  value: unknown,
  context: PreviewInspectorHostMessageContext,
): boolean {
  if (isPreviewInspectorSourceSelectionMessage(value)) {
    const request = readPreviewInspectorSourceSelectionRequest(value);
    if (request === undefined) {
      context.log.debug('Ignored a malformed React Inspector source selection message.');
    } else {
      context.sourceDecoration.select(request, context);
    }
    return true;
  }
  if (
    handlePreviewRuntimeHealthMessage(value, {
      enabled: context.enabled,
      log: context.log,
      targetPath: context.targetPath,
    })
  ) {
    return true;
  }
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
