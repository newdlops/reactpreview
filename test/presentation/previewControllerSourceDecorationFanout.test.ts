/**
 * Verifies that the extension-scoped preview controller owns exactly one visible-editor listener
 * and fans that event into every live panel's source-decoration service. The panel session itself
 * is replaced with a narrow observer so this suite tests manager ownership without duplicating the
 * source-decoration and panel-runtime integration covered by their dedicated suites.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type { BuildPreview } from '../../src/application/buildPreview';
import type { ResolvedPreviewTarget } from '../../src/presentation/activePreviewTarget';
import { PreviewController } from '../../src/presentation/previewController';

/** Controller-created session surface exposed to fan-out assertions. */
interface ObservedSession {
  readonly dispose: ReturnType<typeof vi.fn>;
  readonly refreshInspectorSourceDecoration: ReturnType<typeof vi.fn>;
}

/** Hoisted resolver and session buckets consumed by module replacement factories. */
const controllerState = vi.hoisted(() => ({
  activeTarget: vi.fn(),
  sessions: [] as ObservedSession[],
}));

/** Hoisted VS Code event state proves listener cardinality and allows deterministic emission. */
const vscodeState = vi.hoisted(() => ({
  panels: [] as FanoutPanel[],
  visibleEditorListenerDisposals: [] as ReturnType<typeof vi.fn>[],
  visibleEditorListeners: [] as ((editors: readonly unknown[]) => void)[],
}));

vi.mock('../../src/presentation/activePreviewTarget', () => ({
  resolveActivePreviewTarget: controllerState.activeTarget,
  resolvePinnedPreviewTarget: vi.fn(),
}));

vi.mock('../../src/presentation/previewPanelSession', () => ({
  /** Minimal session observer retaining the same disposal callback contract as the real session. */
  PreviewPanelSession: class {
    public readonly documentUri: unknown;
    public readonly dispose = vi.fn(() => {
      this.close();
    });
    public readonly isActive = false;
    public readonly refresh = vi.fn();
    public readonly refreshForConfiguration = vi.fn();
    public readonly refreshForDocument = vi.fn(() => false);
    public readonly refreshInspectorSourceDecoration = vi.fn();
    public readonly start = vi.fn();
    public readonly targetPath: string;
    private closed = false;

    /** Captures immutable target identity and subscribes to user-driven panel closure. */
    public constructor(
      private readonly options: {
        readonly callbacks: { readonly onDidDispose: (session: unknown) => void };
        readonly initialTarget: ResolvedPreviewTarget;
        readonly panel: FanoutPanel;
      },
    ) {
      this.documentUri = options.initialTarget.documentUri;
      this.targetPath = options.initialTarget.request.documentPath;
      options.panel.onDidDispose(() => {
        this.close();
      });
      controllerState.sessions.push(this);
    }

    /** Reports whether a refresh command refers to this immutable target. */
    public targetsDocument(documentPath: string): boolean {
      return this.targetPath === documentPath;
    }

    /** Notifies the controller exactly once when code or the user closes this session. */
    private close(): void {
      if (this.closed) return;
      this.closed = true;
      this.options.callbacks.onDidDispose(this);
    }
  },
}));

vi.mock('vscode', () => {
  /** Minimal immutable URI used by target and resource-root construction. */
  class FakeUri {
    /** Retains one filesystem path. */
    public constructor(public readonly fsPath: string) {}

    /** Creates a file URI without filesystem access. */
    public static file(filePath: string): FakeUri {
      return new FakeUri(filePath);
    }
  }

  /** Registers an event callback into a mutable bucket and removes it on disposal. */
  function registerListener<Value>(listeners: Value[], listener: Value): vscode.Disposable {
    listeners.push(listener);
    return {
      dispose: (): void => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
    };
  }

  return {
    Uri: FakeUri,
    ViewColumn: { Beside: 2 },
    window: {
      createWebviewPanel: (): FanoutPanel => {
        const panel = new FanoutPanel();
        vscodeState.panels.push(panel);
        return panel;
      },
      onDidChangeVisibleTextEditors: (listener: (editors: readonly unknown[]) => void) => {
        vscodeState.visibleEditorListeners.push(listener);
        const disposal = vi.fn(() => {
          const index = vscodeState.visibleEditorListeners.indexOf(listener);
          if (index >= 0) vscodeState.visibleEditorListeners.splice(index, 1);
        });
        vscodeState.visibleEditorListenerDisposals.push(disposal);
        return { dispose: disposal };
      },
      showWarningMessage: vi.fn(() => Promise.resolve(undefined)),
    },
    workspace: {
      onDidChangeConfiguration: (listener: unknown) => registerListener([], listener),
      onDidChangeTextDocument: (listener: unknown) => registerListener([], listener),
      onDidSaveTextDocument: (listener: unknown) => registerListener([], listener),
    },
  };
});

/** Small panel emitter used only to drive user-owned session disposal. */
class FanoutPanel {
  public active = false;
  public title = 'React Preview';
  private readonly disposeListeners: (() => void)[] = [];

  /** Placeholder webview shape retained because the controller passes the panel through options. */
  public readonly webview = {};

  /** Registers a session-owned panel disposal callback. */
  public onDidDispose(listener: () => void): vscode.Disposable {
    this.disposeListeners.push(listener);
    return { dispose: vi.fn() };
  }

  /** Emits a user-driven panel close. */
  public dispose(): void {
    for (const listener of [...this.disposeListeners]) listener();
  }
}

afterEach(() => {
  vi.clearAllMocks();
  controllerState.sessions.length = 0;
  vscodeState.panels.length = 0;
  vscodeState.visibleEditorListenerDisposals.length = 0;
  vscodeState.visibleEditorListeners.length = 0;
});

describe('PreviewController source-decoration visibility fan-out', () => {
  /** One extension listener serves two sessions, then stops visiting a user-disposed panel. */
  it('fans visible editors into live sessions and removes disposed sessions', async () => {
    const firstTarget = createTarget('/workspace/src/First.tsx');
    const secondTarget = createTarget('/workspace/src/Second.tsx');
    controllerState.activeTarget.mockReturnValueOnce(firstTarget).mockReturnValueOnce(secondTarget);
    const controller = new PreviewController(
      { execute: vi.fn(), releaseArtifact: vi.fn() } as unknown as BuildPreview,
      vscode.Uri.file('/artifacts'),
      { debug: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as vscode.LogOutputChannel,
    );

    await controller.open('component');
    await controller.open('component');
    expect(vscodeState.visibleEditorListeners).toHaveLength(1);
    expect(controllerState.sessions).toHaveLength(2);

    const editors = [{ document: { fileName: '/workspace/src/First.tsx' } }];
    vscodeState.visibleEditorListeners[0]?.(editors);
    expect(controllerState.sessions[0]?.refreshInspectorSourceDecoration).toHaveBeenCalledWith(
      editors,
    );
    expect(controllerState.sessions[1]?.refreshInspectorSourceDecoration).toHaveBeenCalledWith(
      editors,
    );

    vscodeState.panels[0]?.dispose();
    vi.clearAllMocks();
    vscodeState.visibleEditorListeners[0]?.(editors);
    expect(controllerState.sessions[0]?.refreshInspectorSourceDecoration).not.toHaveBeenCalled();
    expect(controllerState.sessions[1]?.refreshInspectorSourceDecoration).toHaveBeenCalledWith(
      editors,
    );

    controller.dispose();
    expect(vscodeState.visibleEditorListenerDisposals[0]).toHaveBeenCalledOnce();
    expect(vscodeState.visibleEditorListeners).toHaveLength(0);
  });
});

/** Creates one immutable React target accepted by the controller's command boundary. */
function createTarget(documentPath: string): ResolvedPreviewTarget {
  return {
    documentName: documentPath.split('/').at(-1) ?? documentPath,
    documentUri: vscode.Uri.file(documentPath),
    request: {
      dependencySnapshots: [],
      documentPath,
      language: 'tsx',
      sourceText: 'export default function Target() { return null; }',
      workspaceRoot: '/workspace',
    },
  };
}
