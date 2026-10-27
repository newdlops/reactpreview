/** Builds and publishes pinned previews while the session owns host events and resource disposal. */
import * as vscode from 'vscode';
import type { PreparedPreview } from '../domain/preview';
import { isPreviewBuildCancellation, isPreviewBuildStall } from '../domain/previewBuildExecution';
import type { PreviewProgressStage } from '../domain/previewProgress';
import { canonicalizeExistingPath, createExistingPathIdentitySet } from '../shared/pathIdentity';
import type { PreviewTargetIssue, ResolvedPreviewTarget } from './activePreviewTarget';
import { formatPreviewCompilerActivity } from './previewCompilerActivityLog';
import { describeBuildFailure, formatDiagnostic } from './previewFailure';
import { preparePreviewFirstPaint } from './previewFirstPaint';
import { createHotReloadScriptUri } from './previewHotReloadProtocol';
import type { PreviewPanelBuildScope } from './previewPanelBuildScope';
import { rememberPreviewFailureDependencies } from './previewPanelSessionUtilities';
import { createPreviewPanelTitle } from './previewPanelTitle';
import type {
  PreviewPreparedApplicationHandle,
  PreviewPreparedApplicationOrigin,
} from './previewPreparedApplication';
import { createPreviewProgressMessage } from './previewProgress';
import { createPreviewHtml } from './webview/previewHtml';

/** Coordinates cancellable source resolution and build publication using caller-owned state. */
export async function rebuildPreviewPanelSession(
  scope: PreviewPanelBuildScope,
  requestedRevision: number,
  signal: AbortSignal,
  capturedTarget?: ResolvedPreviewTarget,
): Promise<void> {
  let target: PreviewTargetIssue | ResolvedPreviewTarget;
  let awaitingBrowserApplication = false;
  try {
    target = capturedTarget ?? (await scope.options.resolveTarget(scope.documentUri(), signal));
  } catch (error) {
    if (isPreviewBuildCancellation(error, signal)) {
      scope.clearBuildExecution(requestedRevision);
      return;
    }
    if (!scope.isCurrentRevision(requestedRevision)) {
      scope.clearBuildExecution(requestedRevision);
      return;
    }
    scope.options.log.error('React preview target resolution failed.', error);
    scope.performanceTrace.finish('failed', requestedRevision);
    scope.renderTargetIssue(
      {
        message:
          'The pinned source file could not be reopened. Check the file and refresh this preview.',
        title: 'Preview target unavailable',
      },
      requestedRevision,
    );
    scope.clearBuildExecution(requestedRevision);
    return;
  }
  if (!scope.isCurrentRevision(requestedRevision)) {
    scope.clearBuildExecution(requestedRevision);
    return;
  }
  if (signal.aborted) {
    scope.clearBuildExecution(requestedRevision);
    return;
  }
  if ('title' in target) {
    scope.performanceTrace.finish('failed', requestedRevision);
    scope.renderTargetIssue(target, requestedRevision);
    scope.clearBuildExecution(requestedRevision);
    return;
  }
  if (!scope.targetsDocument(target.request.documentPath)) {
    scope.performanceTrace.finish('failed', requestedRevision);
    scope.renderTargetIssue(
      {
        message: 'The pinned preview target changed identity and was not followed.',
        title: 'Preview target changed',
      },
      requestedRevision,
    );
    scope.clearBuildExecution(requestedRevision);
    return;
  }
  const routeTarget = scope.inspectorRouteSelection.applyTo(target);
  const buildTarget = scope.inspectorRouteSelection.isPendingSelection
    ? routeTarget
    : scope.inspectorPageCandidateSelection.applyTo(routeTarget);
  scope.options.panel.title = createPreviewPanelTitle(buildTarget.request.documentPath);
  try {
    const firstPaint = await preparePreviewFirstPaint({
      buildPreview: scope.options.buildPreview,
      context: {
        reportProgress: (stage, activity) => {
          if (activity !== undefined)
            scope.options.log.debug(formatPreviewCompilerActivity(activity));
          scope.renderProgress(requestedRevision, target.documentName, stage);
        },
        signal,
      },
      preparationMode: scope.preparationState.current,
      renderMode: scope.options.renderMode,
      request: buildTarget.request,
    });
    const preparedPreview = firstPaint.preparedPreview;
    if (!scope.isCurrentRevision(requestedRevision)) {
      scope.releaseArtifact(preparedPreview.artifact.contentHash);
      scope.inspectorRouteSelection.rollback();
      scope.preparationState.rollbackSelection();
      return;
    }
    try {
      scope.renderProgress(requestedRevision, target.documentName, 'loading-preview');
      const interactionId =
        scope.inspectorSelection.currentBuildRevision() === requestedRevision
          ? scope.inspectorSelection.currentInteractionId()
          : undefined;
      const origin: PreviewPreparedApplicationOrigin = {
        buildRevision: requestedRevision,
        ...(interactionId === undefined ? {} : { interactionId }),
        kind: 'foreground',
        requiresContextEnrichment: firstPaint.requiresContextEnrichment,
      };
      const handle = scope.commitPreparedPreview(
        target.documentName,
        preparedPreview,
        requestedRevision,
        origin,
      );
      scope.bindPreparedForegroundApplication(handle, origin);
      if (handle.disposition === 'already-displayed') {
        scope.settlePreparedApplication(handle.applicationId, origin, requestedRevision);
      } else {
        awaitingBrowserApplication = true;
        if (origin.requiresContextEnrichment) {
          scope.state.pendingContextEnrichmentInputs.set(handle.applicationId, {
            artifactHash: preparedPreview.artifact.contentHash,
            signal,
            target: buildTarget,
          });
        }
      }
    } catch (error) {
      scope.releaseArtifact(preparedPreview.artifact.contentHash);
      throw error;
    }
  } catch (error) {
    if (isPreviewBuildCancellation(error, signal)) {
      scope.inspectorRouteSelection.rollback();
      scope.preparationState.rollbackSelection();
      return;
    }
    if (!scope.isCurrentRevision(requestedRevision)) {
      scope.inspectorRouteSelection.rollback();
      scope.preparationState.rollbackSelection();
      return;
    }
    const failure = describeBuildFailure(error);
    if (isPreviewBuildStall(error) && error.activity !== undefined)
      scope.options.log.debug(formatPreviewCompilerActivity(error.activity));
    scope.options.log.error(
      `React preview build failed; retaining the last good preview. Target: ${target.request.documentPath}; mode: ${scope.options.renderMode}.${failure.details === undefined ? '' : `\n${failure.details}`}${scope.formatFrontierMismatchEvidenceSuffix(error)}`,
      error,
    );
    scope.performanceTrace.finish('failed', requestedRevision);
    scope.rollbackInspectorSelection(requestedRevision, 'build-failed');
    rememberPreviewFailureDependencies(
      scope.state.dependencies,
      error,
      target.request.workspaceRoot,
    );
    if (scope.state.artifactHash === undefined) {
      scope.renderRetryableError(
        {
          message: failure.message,
          title: 'Preview build failed',
          ...(failure.details === undefined ? {} : { details: failure.details }),
        },
        requestedRevision,
      );
    } else {
      scope.renderProgress(requestedRevision, target.documentName, 'ready');
    }
  } finally {
    if (!awaitingBrowserApplication) scope.clearBuildExecution(requestedRevision);
  }
}

/** Coordinates artifact ownership and browser application admission using caller-owned state. */
export function commitPreparedPanelPreview(
  scope: PreviewPanelBuildScope,
  documentName: string,
  preparedPreview: PreparedPreview,
  requestedRevision: number,
  origin: PreviewPreparedApplicationOrigin = {
    buildRevision: requestedRevision,
    kind: 'foreground',
    requiresContextEnrichment: false,
  },
): PreviewPreparedApplicationHandle {
  scope.retryController.clear();
  const nextDependencies = createExistingPathIdentitySet([
    scope.targetPath,
    ...preparedPreview.dependencies,
  ]);
  scope.inspectorSourceGesture.configure(preparedPreview.inspectorSourceGestureSecret);
  const nextDependencyDirectories = new Set(
    preparedPreview.watchDirectories.map(canonicalizeExistingPath),
  );
  for (const diagnostic of preparedPreview.diagnostics) {
    scope.options.log.warn(formatDiagnostic(diagnostic));
  }
  const publishedScriptUri = scope.options.panel.webview
    .asWebviewUri(vscode.Uri.parse(preparedPreview.artifact.scriptLocation, true))
    .toString(true);
  const scriptUri = createHotReloadScriptUri(
    publishedScriptUri,
    requestedRevision,
    preparedPreview.artifact.contentHash,
  );
  const stylesheetLocation = preparedPreview.artifact.stylesheetLocation;
  const stylesheetUri =
    stylesheetLocation === undefined
      ? undefined
      : scope.options.panel.webview
          .asWebviewUri(vscode.Uri.parse(stylesheetLocation, true))
          .toString(true);
  const publicAssetUri =
    preparedPreview.publicAssetRoot === undefined
      ? undefined
      : scope.documentUri().with({
          path: vscode.Uri.file(preparedPreview.publicAssetRoot).path,
        });
  if (scope.options.artifactResourceRoot !== undefined) {
    scope.options.panel.webview.options = {
      ...scope.options.panel.webview.options,
      localResourceRoots:
        publicAssetUri === undefined
          ? [scope.options.artifactResourceRoot]
          : [scope.options.artifactResourceRoot, publicAssetUri],
    };
  }
  const publicAssetBaseUri =
    publicAssetUri === undefined
      ? undefined
      : `${scope.options.panel.webview
          .asWebviewUri(publicAssetUri)
          .toString(true)
          .replace(/\/+$/u, '')}/`;
  const moduleImports = preparedPreview.artifact.moduleImports?.map(
    ({ scriptLocation, specifier }) => ({
      specifier,
      uri: scope.options.panel.webview
        .asWebviewUri(vscode.Uri.parse(scriptLocation, true))
        .toString(true),
    }),
  );
  const nextModuleImportMapIdentity = createModuleImportMapIdentity(moduleImports);
  const progressTiming = scope.progressGate.snapshot(requestedRevision);
  const baseState = {
    documentName,
    kind: 'ready' as const,
    pageContextFrontierId: scope.inspectorPageCandidateSelection.currentFrontierId(),
    remoteStylesheets: vscode.workspace
      .getConfiguration('reactPreview')
      .get<boolean>('remoteStylesheets', true),
    ...(moduleImports === undefined ? {} : { moduleImports }),
    runtimeRevision: requestedRevision,
    ...(progressTiming === undefined ? {} : { progressTiming }),
    runtimeToken: `${requestedRevision.toString()}:${preparedPreview.artifact.contentHash}`,
    scriptUri,
    ...(preparedPreview.publicApplicationOrigin === undefined
      ? {}
      : { publicApplicationOrigin: preparedPreview.publicApplicationOrigin }),
    ...(publicAssetBaseUri === undefined ? {} : { publicAssetBaseUri }),
  };
  const nextHtml = createPreviewHtml(
    scope.options.panel.webview.cspSource,
    stylesheetUri === undefined
      ? baseState
      : {
          ...baseState,
          stylesheetUri,
        },
  );
  const previousArtifactHash = scope.state.artifactHash;
  const frontierChanged =
    scope.options.renderMode === 'page-inspector' &&
    scope.state.pageContextFrontierId !== baseState.pageContextFrontierId;
  if (previousArtifactHash === preparedPreview.artifact.contentHash && !frontierChanged) {
    scope.state.dependencies = nextDependencies;
    scope.state.dependencyDirectories = nextDependencyDirectories;
    scope.replaceDirectoryWatchers(nextDependencyDirectories);
    scope.releaseArtifact(preparedPreview.artifact.contentHash);
    const awaitsSharedRuntime =
      scope.state.pendingInitialRuntime?.artifactHash === previousArtifactHash ||
      [...scope.state.pendingHotReloads.values()].some(
        (pending) => pending.nextArtifactHash === previousArtifactHash,
      );
    if (awaitsSharedRuntime) {
      const sharedInitialRuntime =
        scope.state.pendingInitialRuntime?.artifactHash === previousArtifactHash
          ? scope.state.pendingInitialRuntime
          : undefined;
      const sharedApplication =
        sharedInitialRuntime ??
        [...scope.state.pendingHotReloads.values()].find(
          (pending) => pending.nextArtifactHash === previousArtifactHash,
        );
      if (sharedApplication === undefined) throw new Error('Missing shared preview application.');
      scope.state.pendingSameArtifactRevision = {
        applicationId: sharedApplication.applicationId,
        artifactHash: previousArtifactHash,
        documentName,
        origin,
        revision: requestedRevision,
      };
      return {
        applicationId: sharedApplication.applicationId,
        disposition:
          sharedInitialRuntime === undefined ? 'awaiting-hot-reload' : 'awaiting-runtime',
      };
    } else {
      scope.renderProgress(requestedRevision, documentName, 'ready', nextHtml);
    }
    return {
      applicationId: `displayed:${previousArtifactHash}`,
      disposition: 'already-displayed',
    };
  }
  const requiresDocumentNavigation =
    previousArtifactHash === undefined ||
    scope.state.moduleImportMapIdentity !== nextModuleImportMapIdentity;
  const hotScriptUri = requiresDocumentNavigation ? undefined : scriptUri;
  if (requiresDocumentNavigation) {
    // Do not accept the incoming lease until VS Code accepts the initial complete document.
    scope.options.panel.webview.html = nextHtml;
  }
  scope.state.dependencies = nextDependencies;
  scope.state.dependencyDirectories = nextDependencyDirectories;
  scope.state.artifactHash = preparedPreview.artifact.contentHash;
  scope.state.pageContextFrontierId = baseState.pageContextFrontierId;
  scope.replaceDirectoryWatchers(nextDependencyDirectories);
  if (requiresDocumentNavigation) {
    scope.state.moduleImportMapIdentity = nextModuleImportMapIdentity;
    scope.startInitialRuntimeWatchdog(
      preparedPreview.artifact.contentHash,
      baseState.runtimeToken,
      requestedRevision,
      origin,
    );
    if (previousArtifactHash !== undefined) {
      scope.options.log.debug(
        'React preview replaced the webview document because its browser import map changed.',
      );
      scope.releaseSupersededDocumentArtifacts(previousArtifactHash);
    }
    return { applicationId: baseState.runtimeToken, disposition: 'awaiting-runtime' };
  }
  if (hotScriptUri !== undefined) {
    const applicationId = scope.postHotReload(
      previousArtifactHash,
      preparedPreview.artifact.contentHash,
      hotScriptUri,
      stylesheetUri,
      nextHtml,
      requestedRevision,
      baseState.runtimeToken,
      origin,
    );
    return { applicationId, disposition: 'awaiting-hot-reload' };
  }
  return { applicationId: baseState.runtimeToken, disposition: 'awaiting-runtime' };
}

/** Coordinates revision-scoped progress and fallback delivery using caller-owned state. */
export function renderPreviewPanelProgress(
  scope: PreviewPanelBuildScope,
  requestedRevision: number,
  documentName: string,
  stage: PreviewProgressStage,
  fallbackHtml?: string,
): void {
  const duplicate = scope.progressGate.isCurrent(requestedRevision, stage);
  if (
    !scope.isCurrentRevision(requestedRevision) ||
    !scope.progressGate.accept(requestedRevision, stage)
  ) {
    return;
  }
  scope.performanceTrace.transition(requestedRevision, documentName, stage);
  scope.publishInspectorSelectionStatuses(
    scope.inspectorSelection.reportProgress(
      requestedRevision,
      stage,
      scope.state.displayedRuntimeRevision,
    ),
  );
  if (scope.state.artifactHash === undefined) {
    if (stage === 'ready' || duplicate) {
      return;
    }
    try {
      const progressTiming = scope.progressGate.snapshot(requestedRevision);
      scope.options.panel.webview.html = createPreviewHtml(scope.options.panel.webview.cspSource, {
        documentName,
        kind: 'loading',
        revision: requestedRevision,
        ...(progressTiming === undefined ? {} : { progressTiming }),
        stage,
      });
    } catch (error) {
      scope.options.log.debug('Could not update initial React preview progress.', error);
    }
    return;
  }
  try {
    const delivery = scope.options.panel.webview.postMessage(
      createPreviewProgressMessage(
        stage,
        requestedRevision,
        scope.progressGate.snapshot(requestedRevision),
      ),
    );
    void Promise.resolve(delivery).then(
      (delivered) => {
        if (!delivered && fallbackHtml !== undefined) {
          scope.replaceWithProgressFallback(requestedRevision, fallbackHtml);
        }
      },
      (error: unknown) => {
        scope.options.log.debug('Could not update React preview progress.', error);
        if (fallbackHtml !== undefined) {
          scope.replaceWithProgressFallback(requestedRevision, fallbackHtml);
        }
      },
    );
  } catch (error) {
    scope.options.log.debug('Could not post React preview progress.', error);
    if (fallbackHtml !== undefined) {
      scope.replaceWithProgressFallback(requestedRevision, fallbackHtml);
    }
  }
}

/** Creates a stable identity for the prepared artifact’s ordered browser module mappings. */
function createModuleImportMapIdentity(
  moduleImports: readonly { readonly specifier: string; readonly uri: string }[] | undefined,
): string {
  return JSON.stringify(
    [...(moduleImports ?? [])]
      .sort((left, right) =>
        left.specifier === right.specifier
          ? left.uri.localeCompare(right.uri)
          : left.specifier.localeCompare(right.specifier),
      )
      .map(({ specifier, uri }) => [specifier, uri]),
  );
}
