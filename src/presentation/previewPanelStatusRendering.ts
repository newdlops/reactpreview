/** Renders pinned-target and retry diagnostics and delivers bounded Inspector interaction statuses. */
import type { PreviewTargetIssue } from './activePreviewTarget';
import type { PreviewInspectorSelectionStatusMessage } from './previewInspectorSelectionStatusProtocol';
import type { PreviewPanelBuildScope } from './previewPanelBuildScope';
import { createPreviewHtml } from './webview/previewHtml';

/** Renders or posts host-owned status while preserving revision and artifact ownership. */
export function postPreviewPanelSelectionStatuses(
  scope: PreviewPanelBuildScope,
  statuses: readonly PreviewInspectorSelectionStatusMessage[],
): void {
  for (const status of statuses) {
    try {
      void scope.options.panel.webview.postMessage(status);
    } catch (error) {
      scope.options.log.debug('Could not post React Inspector selection status.', error);
    }
  }
}

/** Renders or posts host-owned status while preserving revision and artifact ownership. */
export function renderPreviewPanelRetryableError(
  scope: PreviewPanelBuildScope,
  errorState: { readonly details?: string; readonly message: string; readonly title: string },
  revision: number,
): void {
  const retry = scope.retryController.create(revision);
  try {
    scope.options.panel.webview.html = createPreviewHtml(scope.options.panel.webview.cspSource, {
      kind: 'error',
      message: errorState.message,
      retry,
      title: errorState.title,
      ...(errorState.details === undefined ? {} : { details: errorState.details }),
    });
  } catch (error) {
    scope.options.log.debug('Could not render a retryable React preview error.', error);
  }
}

/** Renders or posts host-owned status while preserving revision and artifact ownership. */
export function renderPreviewPanelTargetIssue(
  scope: PreviewPanelBuildScope,
  issue: PreviewTargetIssue,
  requestedRevision: number,
): void {
  if (scope.state.artifactHash !== undefined) {
    scope.options.log.warn(`${issue.title}: ${issue.message} Last good preview retained.`);
    scope.renderProgress(requestedRevision, scope.options.initialTarget.documentName, 'ready');
    return;
  }
  scope.options.panel.webview.html = createPreviewHtml(scope.options.panel.webview.cspSource, {
    kind: 'error',
    message: issue.message,
    title: issue.title,
  });
  scope.releaseCurrentArtifact();
}
