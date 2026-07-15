/**
 * VS Code extension composition root for React File Preview.
 * This file creates concrete adapters, wires them into the application use case and controller,
 * and registers commands; all preview behavior belongs to the imported architectural layers.
 */
import * as vscode from 'vscode';
import { GlobalStoragePreviewArtifactStore } from './adapters/vscode/globalStoragePreviewArtifactStore';
import { EsbuildPreviewCompiler } from './adapters/esbuild/esbuildPreviewCompiler';
import { BuildPreview } from './application/buildPreview';
import { PreviewController } from './presentation/previewController';

/** Resources that require ordered asynchronous cleanup during extension deactivation. */
interface ActiveExtensionResources {
  /** Store whose serialized queue must finish before its generated source cache is removed. */
  readonly artifactStore: GlobalStoragePreviewArtifactStore;
  /** Controller disposed first to invalidate builds and stop editor-triggered work. */
  readonly controller: PreviewController;
  /** Runtime compiler whose native esbuild service should stop before cache shutdown. */
  readonly compiler: EsbuildPreviewCompiler;
}

let activeResources: ActiveExtensionResources | undefined;

/**
 * Activates the extension by composing dependencies and registering its two public commands.
 *
 * @param context VS Code-managed lifecycle context and global storage location.
 */
export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('React Preview', { log: true });
  const compiler = new EsbuildPreviewCompiler();
  const artifactStore = new GlobalStoragePreviewArtifactStore(context.globalStorageUri, log);
  const buildPreview = new BuildPreview(compiler, artifactStore);
  const controller = new PreviewController(buildPreview, artifactStore.resourceRoot, log);
  activeResources = { artifactStore, compiler, controller };

  /** Opens a new file-pinned preview panel for the current source editor. */
  async function openPreview(): Promise<void> {
    await controller.open();
  }

  /** Immediately rebuilds the focused or source-matched preview, opening one when necessary. */
  async function refreshPreview(): Promise<void> {
    await controller.refresh();
  }

  context.subscriptions.push(
    log,
    compiler,
    artifactStore,
    controller,
    vscode.commands.registerCommand('reactPreview.open', openPreview),
    vscode.commands.registerCommand('reactPreview.refresh', refreshPreview),
  );

  log.info('React File Preview activated.');
}

/**
 * Stops editor work and awaits removal of cached bundles that can contain workspace source code.
 * Context subscriptions may also dispose these resources, so both implementations are idempotent.
 *
 * @returns Promise resolved after the session artifact queue and cache cleanup finish.
 */
export async function deactivate(): Promise<void> {
  const resources = activeResources;
  activeResources = undefined;
  if (resources === undefined) {
    return;
  }

  resources.controller.dispose();
  try {
    await resources.compiler.shutdown();
  } finally {
    await resources.artifactStore.shutdown();
  }
}
