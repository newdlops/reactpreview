/**
 * VS Code extension composition root for React File Preview.
 * This file creates concrete adapters, wires them into the application use case and controller,
 * and registers commands; all preview behavior belongs to the imported architectural layers.
 */
import * as vscode from 'vscode';
import { GlobalStoragePreviewArtifactStore } from './adapters/vscode/globalStoragePreviewArtifactStore';
import { PreviewCompilerWorkerClient } from './adapters/worker/previewCompilerWorkerClient';
import { BuildPreview } from './application/buildPreview';
import { registerPreviewCommands } from './presentation/previewCommandRegistration';
import { PreviewController } from './presentation/previewController';

/** Resources that require ordered asynchronous cleanup during extension deactivation. */
interface ActiveExtensionResources {
  /** Store whose serialized queue must finish before its generated source cache is removed. */
  readonly artifactStore: GlobalStoragePreviewArtifactStore;
  /** Controller disposed first to invalidate builds and stop editor-triggered work. */
  readonly controller: PreviewController;
  /** Runtime compiler whose native esbuild service should stop before cache shutdown. */
  readonly compiler: PreviewCompilerWorkerClient;
}

/** Lightweight activation state retained even when the trusted runtime has not been requested. */
interface ActiveExtensionState {
  /** VS Code lifecycle context used for packaged paths, storage and late disposable ownership. */
  readonly context: vscode.ExtensionContext;
  /** Diagnostic channel available before compiler construction and after command failures. */
  readonly log: vscode.LogOutputChannel;
  /** Lazily constructed trusted services, absent in Restricted Mode and command-idle windows. */
  resources?: ActiveExtensionResources;
}

let activeState: ActiveExtensionState | undefined;

/**
 * Activates the extension by composing dependencies and registering its public commands.
 *
 * @param context VS Code-managed lifecycle context and global storage location.
 */
export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('React Preview', { log: true });
  const state: ActiveExtensionState = { context, log };
  activeState = state;

  const commandRegistrations = registerPreviewCommands({
    actions: {
      openComponentGallery: async () => {
        await getOrCreateResources(state).controller.open('component');
      },
      openPageInspector: async () => {
        await getOrCreateResources(state).controller.open('page-inspector');
      },
      refresh: async () => {
        await getOrCreateResources(state).controller.refresh();
      },
    },
    log,
  });

  context.subscriptions.push(log, ...commandRegistrations);
  log.info('React File Preview activated; commands registered and runtime services are idle.');
}

/**
 * Creates compiler, artifact and panel services only after a trusted preview command is invoked.
 * The extension entry is an ESM bundle, while the compiler remains a dedicated CommonJS worker;
 * resolving the worker through the context avoids CommonJS-only `__dirname` in the host entry.
 *
 * @param state Current activation state that owns storage and late lifecycle subscriptions.
 * @returns Stable resources shared by every preview tab in the extension-host window.
 */
function getOrCreateResources(state: ActiveExtensionState): ActiveExtensionResources {
  if (state.resources !== undefined) {
    return state.resources;
  }

  const compiler = new PreviewCompilerWorkerClient(
    state.context.asAbsolutePath('dist/previewCompilerWorker.js'),
  );
  const artifactStore = new GlobalStoragePreviewArtifactStore(
    state.context.globalStorageUri,
    state.log,
  );
  const buildPreview = new BuildPreview(compiler, artifactStore);
  const controller = new PreviewController(buildPreview, artifactStore.resourceRoot, state.log);
  const resources = { artifactStore, compiler, controller };
  state.resources = resources;
  state.context.subscriptions.push(compiler, artifactStore, controller);
  state.log.info('React File Preview trusted runtime services initialized.');
  return resources;
}

/**
 * Stops editor work and awaits removal of cached bundles that can contain workspace source code.
 * Context subscriptions may also dispose these resources, so both implementations are idempotent.
 *
 * @returns Promise resolved after the session artifact queue and cache cleanup finish.
 */
export async function deactivate(): Promise<void> {
  const resources = activeState?.resources;
  activeState = undefined;
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
