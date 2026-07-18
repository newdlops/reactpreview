/** Verifies lifecycle and directional relays for the separate React Inspector editor tab. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { PreviewInspectorCompanionPanel } from '../../src/presentation/previewInspectorCompanionPanel';

const vscodeState = vi.hoisted(() => ({ createdPanels: [] as FakePanel[] }));

vi.mock('vscode', () => ({
  ViewColumn: { Beside: 2 },
  window: {
    createWebviewPanel: (
      _viewType: string,
      title: string,
      viewColumn: number,
      options: Record<string, unknown>,
    ): FakePanel => {
      const panel = new FakePanel(title, viewColumn, options);
      vscodeState.createdPanels.push(panel);
      return panel;
    },
  },
}));

/** Minimal evented webview panel used to exercise both message directions without VS Code. */
class FakePanel {
  public disposed = false;
  public readonly postedMessages: unknown[] = [];
  public revealCalls = 0;
  private readonly disposeListeners: (() => void)[] = [];
  private readonly messageListeners: ((value: unknown) => void)[] = [];
  public readonly webview = {
    cspSource: 'vscode-webview://companion-test',
    html: '',
    onDidReceiveMessage: (listener: (value: unknown) => void) =>
      this.register(this.messageListeners, listener),
    postMessage: (message: unknown): Promise<boolean> => {
      this.postedMessages.push(message);
      return Promise.resolve(true);
    },
  };

  /** Retains the construction values required by companion placement assertions. */
  public constructor(
    public readonly title: string,
    public readonly viewColumn: number,
    public readonly options: Record<string, unknown>,
  ) {}

  /** Registers one panel-disposal callback. */
  public onDidDispose(listener: () => void): vscode.Disposable {
    return this.register(this.disposeListeners, listener);
  }

  /** Emits one webview-to-extension message. */
  public emitMessage(message: unknown): void {
    for (const listener of [...this.messageListeners]) listener(message);
  }

  /** Emits one panel closure exactly once. */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const listener of [...this.disposeListeners]) listener();
  }

  /** Records that companion creation returned the visible tab to the renderer. */
  public reveal(): void {
    this.revealCalls += 1;
  }

  /** Stores one listener and returns its exact removal operation. */
  private register<Listener>(listeners: Listener[], listener: Listener): vscode.Disposable {
    listeners.push(listener);
    return {
      dispose: () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
    };
  }
}

afterEach(() => {
  vscodeState.createdPanels.length = 0;
});

describe('PreviewInspectorCompanionPanel', () => {
  /** Retains snapshots until ready and forwards only parsed actions to the authoritative preview. */
  it('relays snapshots, controls, and source clicks without executing a second project bundle', () => {
    const preview = new FakePanel('Target.tsx', 2, {});
    const openSource = vi.fn();
    PreviewInspectorCompanionPanel.attach({
      documentName: 'Target.tsx',
      log: { debug: vi.fn() },
      openSource,
      previewPanel: preview as unknown as vscode.WebviewPanel,
    });
    const companion = vscodeState.createdPanels[0];
    const snapshot = {
      css: '.rpi-shell{display:grid}',
      html: '<aside class="rpi-shell"></aside>',
      sequence: 1,
      type: 'react-preview-inspector-companion-snapshot',
    };

    preview.emitMessage(snapshot);
    expect(companion?.postedMessages).toEqual([]);
    preview.emitMessage({ type: 'react-preview-inspector-companion-reveal' });
    expect(companion?.revealCalls).toBe(1);
    companion?.emitMessage({ type: 'react-preview-inspector-companion-ready' });
    expect(companion?.postedMessages).toEqual([snapshot]);
    companion?.emitMessage({
      eventType: 'click',
      remoteId: 'rpi-1',
      type: 'react-preview-inspector-companion-action',
    });
    expect(preview.postedMessages).toContainEqual({
      eventType: 'click',
      remoteId: 'rpi-1',
      type: 'react-preview-inspector-companion-action',
    });
    companion?.emitMessage({
      line: 4,
      sourcePath: '/workspace/src/Target.tsx',
      type: 'react-preview-inspector-companion-open-source',
    });
    expect(openSource).toHaveBeenCalledWith(
      expect.objectContaining({ line: 4, sourcePath: '/workspace/src/Target.tsx' }),
    );
    expect(companion?.webview.html).toContain('React Page Inspector');
    expect(companion?.webview.html).not.toContain('type="module"');
    expect(preview.revealCalls).toBe(1);
  });

  /** Closing the renderer closes its companion while closing only the companion preserves preview. */
  it('keeps the two tab lifecycles independently scoped', () => {
    const preview = new FakePanel('Target.tsx', 2, {});
    PreviewInspectorCompanionPanel.attach({
      documentName: 'Target.tsx',
      log: { debug: vi.fn() },
      openSource: vi.fn(),
      previewPanel: preview as unknown as vscode.WebviewPanel,
    });
    const companion = vscodeState.createdPanels[0];

    companion?.dispose();
    expect(preview.disposed).toBe(false);

    const nextPreview = new FakePanel('Other.tsx', 2, {});
    PreviewInspectorCompanionPanel.attach({
      documentName: 'Other.tsx',
      log: { debug: vi.fn() },
      openSource: vi.fn(),
      previewPanel: nextPreview as unknown as vscode.WebviewPanel,
    });
    const nextCompanion = vscodeState.createdPanels[1];
    nextPreview.dispose();
    expect(nextCompanion?.disposed).toBe(true);
  });
});
