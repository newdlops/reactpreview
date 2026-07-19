/**
 * Verifies that public commands exist before trusted runtime services are initialized.
 * These tests keep Restricted Mode and adapter failures actionable instead of allowing VS Code to
 * collapse an activation failure into an opaque `command not found` notification.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import {
  REACT_PREVIEW_COMMAND_IDS,
  registerPreviewCommands,
  type PreviewCommandActions,
} from '../../src/presentation/previewCommandRegistration';

const vscodeState = vi.hoisted(() => ({
  executeCommand: vi.fn(),
  registeredCommands: new Map<string, () => Promise<void>>(),
  showErrorMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  trusted: true,
}));

vi.mock('vscode', () => ({
  commands: {
    executeCommand: vscodeState.executeCommand,
    registerCommand: (id: string, handler: () => Promise<void>) => {
      vscodeState.registeredCommands.set(id, handler);
      return {
        dispose: () => {
          vscodeState.registeredCommands.delete(id);
        },
      };
    },
  },
  window: {
    showErrorMessage: vscodeState.showErrorMessage,
    showWarningMessage: vscodeState.showWarningMessage,
  },
  workspace: {
    get isTrusted(): boolean {
      return vscodeState.trusted;
    },
  },
}));

afterEach(() => {
  vscodeState.executeCommand.mockReset();
  vscodeState.registeredCommands.clear();
  vscodeState.showErrorMessage.mockReset();
  vscodeState.showWarningMessage.mockReset();
  vscodeState.trusted = true;
});

describe('registerPreviewCommands', () => {
  /** Registers every public ID without touching any lazy controller action. */
  it('publishes the command surface before runtime initialization', () => {
    const actions = createCommandActions();
    const log = createLogChannel();

    const registrations = registerPreviewCommands({ actions, log: log.channel });

    expect([...vscodeState.registeredCommands.keys()]).toEqual([
      REACT_PREVIEW_COMMAND_IDS.open,
      REACT_PREVIEW_COMMAND_IDS.openPageInspector,
      REACT_PREVIEW_COMMAND_IDS.openComponentGallery,
      REACT_PREVIEW_COMMAND_IDS.refresh,
    ]);
    expect(actions.openPageInspector).not.toHaveBeenCalled();
    expect(actions.openComponentGallery).not.toHaveBeenCalled();
    expect(actions.refresh).not.toHaveBeenCalled();

    for (const registration of registrations) {
      registration.dispose();
    }
    expect(vscodeState.registeredCommands.size).toBe(0);
  });

  /** Routes a trusted gallery command to the exact lazy action once. */
  it('executes a trusted command after registration', async () => {
    const actions = createCommandActions();
    registerPreviewCommands({ actions, log: createLogChannel().channel });

    await executeRegisteredCommand(REACT_PREVIEW_COMMAND_IDS.openComponentGallery);

    expect(actions.openComponentGallery).toHaveBeenCalledOnce();
    expect(actions.openPageInspector).not.toHaveBeenCalled();
  });

  /** Opens trust management without initializing workspace-code services in Restricted Mode. */
  it('keeps an untrusted command actionable without executing it', async () => {
    vscodeState.trusted = false;
    vscodeState.showWarningMessage.mockResolvedValue('Manage Workspace Trust');
    const actions = createCommandActions();
    registerPreviewCommands({ actions, log: createLogChannel().channel });

    await executeRegisteredCommand(REACT_PREVIEW_COMMAND_IDS.open);

    expect(actions.openPageInspector).not.toHaveBeenCalled();
    expect(vscodeState.executeCommand).toHaveBeenCalledWith('workbench.trust.manage');
    expect(vscodeState.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Trust this workspace'),
      'Manage Workspace Trust',
    );
  });

  /** Reports lazy adapter failures while preserving the already-registered command. */
  it('logs command failures and offers the diagnostic channel', async () => {
    const actions = createCommandActions();
    actions.openComponentGallery.mockRejectedValue(new Error('worker startup\nfailed'));
    vscodeState.showErrorMessage.mockResolvedValue('Show React Preview Log');
    const log = createLogChannel();
    registerPreviewCommands({ actions, log: log.channel });

    await executeRegisteredCommand(REACT_PREVIEW_COMMAND_IDS.openComponentGallery);

    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('worker startup failed'),
      expect.any(Error),
    );
    expect(log.show).toHaveBeenCalledWith(true);
    expect(vscodeState.registeredCommands).toHaveProperty('size', 4);
  });
});

/**
 * Creates isolated lazy actions whose invocation counts represent runtime construction attempts.
 *
 * @returns Mocked command actions accepted by the production registration boundary.
 */
function createCommandActions(): PreviewCommandActions & {
  readonly openComponentGallery: ReturnType<typeof vi.fn<() => Promise<void>>>;
  readonly openPageInspector: ReturnType<typeof vi.fn<() => Promise<void>>>;
  readonly refresh: ReturnType<typeof vi.fn<() => Promise<void>>>;
} {
  return {
    openComponentGallery: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    openPageInspector: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    refresh: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

/**
 * Creates the diagnostic methods exercised by protected command failure handling.
 *
 * @returns Typed fake LogOutputChannel with observable error and reveal methods.
 */
function createLogChannel(): {
  readonly channel: vscode.LogOutputChannel;
  readonly error: ReturnType<typeof vi.fn>;
  readonly show: ReturnType<typeof vi.fn>;
} {
  const error = vi.fn();
  const show = vi.fn();
  return {
    channel: { error, show } as unknown as vscode.LogOutputChannel,
    error,
    show,
  };
}

/**
 * Executes one command handler captured by the VS Code mock.
 *
 * @param id Stable command identifier expected to have been registered.
 * @returns Promise settled after the complete protected handler finishes.
 */
async function executeRegisteredCommand(id: string): Promise<void> {
  const handler = vscodeState.registeredCommands.get(id);
  expect(handler).toBeDefined();
  await handler?.();
}
