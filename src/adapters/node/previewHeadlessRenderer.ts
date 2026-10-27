/** Coordinates compilation, browser execution, evidence parsing, and owned-resource cleanup. */
import { type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PreviewCompiler } from '../../application/previewCompiler';
import type { PreviewBuildRequest, PreviewBundle } from '../../domain/preview';
import { createHotReloadScriptUri } from '../../presentation/previewHotReloadProtocol';
import { createPreviewHtml } from '../../presentation/webview/previewHtml';
import { planPreviewArtifactLayout } from '../vscode/previewArtifactLayout';
import { discoverPreviewChromiumPath } from './previewChromiumPath';
import { createPreviewHeadlessBridgeSource } from './previewHeadlessBridgeSource';
import { executeChromiumWithCdp, spawnPreviewHeadlessProcess } from './previewHeadlessCdp';
import { createProtocolFailure, readBrowserResult } from './previewHeadlessEvidence';
import {
  isBrowserTerminated,
  reportPreviewHeadlessOwnership,
  terminateOwnedBrowser,
  validateRunTimeout,
  validateVirtualTimeBudget,
} from './previewHeadlessLifecycle';
import {
  type PreviewHeadlessRendererOptions,
  type PreviewHeadlessResult,
  DEFAULT_TIMEOUT_MS,
  HEADLESS_BRIDGE_PATH,
  HEADLESS_DOCUMENT_PATH,
  HEADLESS_PUBLIC_ASSET_PREFIX,
} from './previewHeadlessModel';
import {
  closeServer,
  createPreviewHeadlessServer,
  listenOnLoopback,
  mimeTypeForPreviewArtifact,
} from './previewHeadlessServer';

/**
 * Compiles and executes one immutable preview request through the normal artifact and HTML path.
 */
export async function renderPreviewHeadlessly(
  compiler: PreviewCompiler,
  request: PreviewBuildRequest,
  options: PreviewHeadlessRendererOptions = {},
): Promise<PreviewHeadlessResult> {
  const bundle = await compiler.compile(request);
  return renderCompiledPreviewHeadlessly(bundle, request, options);
}

/**
 * Executes a caller-owned immutable compiler result through the normal Page Context document.
 * Campaign lanes use this seam to serialize compilation separately from rendering.
 */
export async function renderCompiledPreviewHeadlessly(
  bundle: PreviewBundle,
  request: PreviewBuildRequest,
  options: PreviewHeadlessRendererOptions = {},
): Promise<PreviewHeadlessResult> {
  const layout = planPreviewArtifactLayout(bundle);
  const revision = 1;
  const token = `${revision.toString()}:${layout.contentHash}`;
  const timeoutMs = validateRunTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const virtualTimeMs = validateVirtualTimeBudget(
    options.virtualTimeMs ?? Math.min(5_000, timeoutMs),
    timeoutMs,
  );
  const chromiumPath = options.chromiumPath ?? discoverPreviewChromiumPath();
  if (chromiumPath === undefined) {
    return {
      ...createProtocolFailure(bundle.diagnostics, [], 'No local Chromium executable was found.'),
      cleanup: { browserTerminated: true, profileRemoved: true, serverClosed: true },
    };
  }
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-headless-'));
  reportPreviewHeadlessOwnership(options, { kind: 'profile-created', profileRoot: temporaryRoot });
  const bindingName = `__reactPreviewHeadless_${randomUUID().replaceAll('-', '')}`;
  const routes = new Map<string, { readonly contents: Uint8Array; readonly type: string }>();
  const requests: string[] = [];
  let browser: ChildProcess | undefined;
  let server: Server | undefined;
  let result: Omit<PreviewHeadlessResult, 'cleanup'> | undefined;
  let browserTerminated = true;
  let profileRemoved = false;
  let serverClosed = false;
  try {
    for (const file of layout.files) {
      routes.set(`/${file.relativePath}`, {
        contents: file.contents,
        type: mimeTypeForPreviewArtifact(file.relativePath),
      });
    }
    routes.set(HEADLESS_BRIDGE_PATH, {
      contents: new TextEncoder().encode(
        createPreviewHeadlessBridgeSource(
          token,
          revision,
          bindingName,
          request.renderMode === 'page-inspector',
          options.neuralResidualModel,
        ),
      ),
      type: 'text/javascript; charset=utf-8',
    });
    server = createPreviewHeadlessServer(routes, requests, bundle.publicAssetRoot);
    const endpoint = await listenOnLoopback(server);
    reportPreviewHeadlessOwnership(options, {
      kind: 'server-listening',
      loopbackHost: endpoint.host,
      loopbackPort: endpoint.port,
      profileRoot: temporaryRoot,
    });
    const origin = `http://${endpoint.host}:${endpoint.port.toString()}`;
    routes.set(HEADLESS_DOCUMENT_PATH, {
      contents: new TextEncoder().encode(
        createPreviewHtml(origin, {
          documentName: path.basename(request.documentPath),
          hostBridgeScriptUri: `${origin}${HEADLESS_BRIDGE_PATH}`,
          kind: 'ready',
          ...(bundle.publicAssetRoot === undefined
            ? {}
            : { publicAssetBaseUri: `${origin}${HEADLESS_PUBLIC_ASSET_PREFIX}` }),
          ...(options.remoteStylesheets === true ? { remoteStylesheets: true } : {}),
          ...(layout.moduleImports === undefined
            ? {}
            : {
                moduleImports: layout.moduleImports.map(({ relativePath, specifier }) => ({
                  specifier,
                  uri: `${origin}/${relativePath}`,
                })),
              }),
          runtimeRevision: revision,
          runtimeToken: token,
          scriptUri: createHotReloadScriptUri(
            `${origin}/${layout.entryPath}`,
            revision,
            layout.contentHash,
          ),
          ...(layout.stylesheetPath === undefined
            ? {}
            : { stylesheetUri: `${origin}/${layout.stylesheetPath}` }),
        }),
      ),
      type: 'text/html; charset=utf-8',
    });
    const execution = await executeChromiumWithCdp(
      chromiumPath,
      `${origin}${HEADLESS_DOCUMENT_PATH}`,
      path.join(temporaryRoot, 'profile'),
      bindingName,
      new Set(routes.keys()),
      timeoutMs,
      virtualTimeMs,
      options.parentEnvironment ?? process.env,
      options.spawnProcess ?? spawnPreviewHeadlessProcess,
      (ownedBrowser) => {
        browser = ownedBrowser;
        browserTerminated = false;
        reportPreviewHeadlessOwnership(options, {
          kind: 'browser-spawned',
          ...(ownedBrowser.pid === undefined ? {} : { pid: ownedBrowser.pid }),
          ...(process.platform === 'win32' || ownedBrowser.pid === undefined
            ? {}
            : { pgid: ownedBrowser.pid }),
          profileRoot: temporaryRoot,
        });
      },
    );
    browserTerminated = execution.exitCode !== null || execution.exitSignal !== null;
    if (browserTerminated) browser = undefined;
    result = readBrowserResult(execution, bundle.diagnostics, requests, token, revision);
  } catch (error) {
    result = createProtocolFailure(
      bundle.diagnostics,
      requests,
      `Headless Chromium execution failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (browser !== undefined && !isBrowserTerminated(browser)) {
      await terminateOwnedBrowser(browser);
    }
    browserTerminated = browser === undefined || isBrowserTerminated(browser);
    reportPreviewHeadlessOwnership(options, {
      kind: 'browser-terminal',
      ...(browser?.pid === undefined ? {} : { pid: browser.pid }),
      ...(process.platform === 'win32' || browser?.pid === undefined ? {} : { pgid: browser.pid }),
      profileRoot: temporaryRoot,
    });
    if (server !== undefined) {
      await closeServer(server);
      serverClosed = !server.listening;
      reportPreviewHeadlessOwnership(options, {
        kind: 'server-closed',
        profileRoot: temporaryRoot,
      });
    } else {
      serverClosed = true;
    }
    await rm(temporaryRoot, { force: true, recursive: true });
    profileRemoved = !existsSync(temporaryRoot);
    reportPreviewHeadlessOwnership(options, {
      kind: 'profile-removed',
      profileRoot: temporaryRoot,
    });
  }
  result ??= createProtocolFailure(
    bundle.diagnostics,
    requests,
    'Headless Chromium execution ended without a result.',
  );
  return {
    ...result,
    cleanup: { browserTerminated, profileRemoved, serverClosed },
  };
}
export {
  createPreviewHeadlessBridgeSource,
  createPreviewHeadlessTimeoutExpression,
} from './previewHeadlessBridgeSource';
export {
  CdpPipeClient,
  createPreviewHeadlessCdpCommands,
  decodePreviewHeadlessCdpFrames,
} from './previewHeadlessCdp';
export {
  classifyPreviewHeadlessStabilizedOutcome,
  readPreviewHeadlessFatalBrowserErrors,
} from './previewHeadlessEvidence';
export {
  PREVIEW_HEADLESS_FAILED_CAPTURE_MS,
  PREVIEW_HEADLESS_STABILIZATION_CAP_MS,
  PREVIEW_HEADLESS_STABILIZATION_QUIET_MS,
} from './previewHeadlessModel';
export type {
  CdpMessage,
  PreviewHeadlessBrowserEvidence,
  PreviewHeadlessCdpCommand,
  PreviewHeadlessCdpFrames,
  PreviewHeadlessCleanup,
  PreviewHeadlessCompositionDiagnostic,
  PreviewHeadlessOwnershipEvent,
  PreviewHeadlessRendererOptions,
  PreviewHeadlessResult,
  PreviewHeadlessSpawnProcess,
  PreviewHeadlessStabilization,
  PreviewHeadlessStabilizedOutcome,
  PreviewHeadlessTerminal,
} from './previewHeadlessModel';
export { mimeTypeForPreviewArtifact } from './previewHeadlessServer';
