/**
 * Registers React Preview's stable command surface before any compiler or cache is initialized.
 * Keeping this boundary lightweight prevents an adapter startup failure from degrading a contributed
 * command into VS Code's opaque `command not found` notification.
 */
import * as vscode from 'vscode';

/** Label that opens VS Code's built-in Workspace Trust management editor. */
const MANAGE_WORKSPACE_TRUST_ACTION = 'Manage Workspace Trust';

/** Label that reveals activation and command failures in the extension output channel. */
const SHOW_REACT_PREVIEW_LOG_ACTION = 'Show React Preview Log';

/** Public and compatibility command identifiers owned by this extension. */
export const REACT_PREVIEW_COMMAND_IDS = Object.freeze({
  open: 'reactPreview.open',
  openComponentGallery: 'reactPreview.openComponentGallery',
  openPageInspector: 'reactPreview.openPageInspector',
  refresh: 'reactPreview.refresh',
});

/** Lazy actions supplied by the extension composition root after command registration succeeds. */
export interface PreviewCommandActions {
  /** Opens the selected file inside its inferred application page. */
  readonly openPageInspector: () => Promise<void>;
  /** Opens every renderable export without requiring page ancestry. */
  readonly openComponentGallery: () => Promise<void>;
  /** Rebuilds the focused or source-matched preview. */
  readonly refresh: () => Promise<void>;
}

/** Dependencies required to expose commands without constructing compiler adapters eagerly. */
export interface PreviewCommandRegistrationOptions {
  /** Actions whose controller and compiler dependencies may be initialized lazily. */
  readonly actions: PreviewCommandActions;
  /** Extension output channel that receives actionable command-boundary failures. */
  readonly log: vscode.LogOutputChannel;
}

/** One command descriptor used to register the public commands through a uniform safety boundary. */
interface PreviewCommandDescriptor {
  /** Stable identifier referenced by the extension manifest and existing keybindings. */
  readonly id: string;
  /** Human-readable operation included in diagnostics. */
  readonly label: string;
  /** Trusted action invoked only after the workspace policy check succeeds. */
  readonly run: () => Promise<void>;
}

/**
 * Registers all commands immediately and rolls back partial registration if VS Code rejects one.
 * Runtime services remain lazy because the supplied actions are not called during registration.
 *
 * @param options Trusted lazy actions and the extension diagnostic channel.
 * @returns Disposables that the extension context owns for the complete activation lifetime.
 */
export function registerPreviewCommands(
  options: PreviewCommandRegistrationOptions,
): readonly vscode.Disposable[] {
  const descriptors: readonly PreviewCommandDescriptor[] = [
    {
      id: REACT_PREVIEW_COMMAND_IDS.open,
      label: 'open page context',
      run: options.actions.openPageInspector,
    },
    {
      id: REACT_PREVIEW_COMMAND_IDS.openPageInspector,
      label: 'open page context compatibility alias',
      run: options.actions.openPageInspector,
    },
    {
      id: REACT_PREVIEW_COMMAND_IDS.openComponentGallery,
      label: 'open component gallery',
      run: options.actions.openComponentGallery,
    },
    {
      id: REACT_PREVIEW_COMMAND_IDS.refresh,
      label: 'refresh preview',
      run: options.actions.refresh,
    },
  ];
  const registrations: vscode.Disposable[] = [];
  try {
    for (const descriptor of descriptors) {
      registrations.push(
        vscode.commands.registerCommand(
          descriptor.id,
          createProtectedCommandHandler(descriptor, options.log),
        ),
      );
    }
  } catch (error) {
    for (const registration of registrations) {
      registration.dispose();
    }
    throw error;
  }
  return registrations;
}

/**
 * Wraps one command with Workspace Trust enforcement and visible initialization diagnostics.
 *
 * @param descriptor Command identity, label and lazy trusted action.
 * @param log Extension output channel retained even when runtime initialization fails.
 * @returns VS Code command callback that always settles recoverable failures itself.
 */
function createProtectedCommandHandler(
  descriptor: PreviewCommandDescriptor,
  log: vscode.LogOutputChannel,
): () => Promise<void> {
  return async () => {
    try {
      if (!(await requestWorkspaceTrust())) {
        return;
      }
      await descriptor.run();
    } catch (error) {
      const summary = summarizeCommandError(error);
      log.error(`React Preview could not ${descriptor.label}. ${summary}`, error);
      const selection = await vscode.window.showErrorMessage(
        `React Preview could not ${descriptor.label}: ${summary}`,
        SHOW_REACT_PREVIEW_LOG_ACTION,
      );
      if (selection === SHOW_REACT_PREVIEW_LOG_ACTION) {
        log.show(true);
      }
    }
  };
}

/**
 * Refuses to bundle workspace source in Restricted Mode while keeping the command discoverable.
 * The built-in trust editor is opened only after an explicit user selection; the preview action must
 * be invoked again after trust is granted so code execution never follows a trust change implicitly.
 *
 * @returns `true` only when it is safe for the caller to initialize workspace-code services.
 */
async function requestWorkspaceTrust(): Promise<boolean> {
  if (vscode.workspace.isTrusted) {
    return true;
  }
  const selection = await vscode.window.showWarningMessage(
    'React Preview executes bundled workspace code. Trust this workspace, then run the preview command again.',
    MANAGE_WORKSPACE_TRUST_ACTION,
  );
  if (selection === MANAGE_WORKSPACE_TRUST_ACTION) {
    await vscode.commands.executeCommand('workbench.trust.manage');
  }
  return false;
}

/**
 * Produces a bounded single-line notification while preserving the original value in the log.
 *
 * @param error Unknown thrown value from a lazy action or VS Code command API.
 * @returns Readable failure summary safe for a compact notification.
 */
function summarizeCommandError(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const normalizedMessage = rawMessage.replace(/\s+/gu, ' ').trim();
  if (normalizedMessage.length === 0) {
    return 'Unknown extension-host error.';
  }
  return normalizedMessage.length <= 240
    ? normalizedMessage
    : `${normalizedMessage.slice(0, 239)}\u2026`;
}
