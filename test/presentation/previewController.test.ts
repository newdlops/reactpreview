/** Verifies multiple pinned panels, independent revisions, dependency routing, and lease transfer. */
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type { BuildPreview } from '../../src/application/buildPreview';
import type { PreviewBuildRequest, PreparedPreview } from '../../src/domain/preview';
import type { ResolvedPreviewTarget } from '../../src/presentation/activePreviewTarget';
import { PreviewController } from '../../src/presentation/previewController';
import {
  createAcknowledgement,
  type HotReloadMessageIdentity,
  readMessageIdentity,
  type TestPreviewPanel as TestPanel,
} from './previewControllerTestProtocol';

const targetResolvers = vi.hoisted(() => ({
  active: vi.fn(),
  pinned: vi.fn(),
}));

const vscodeState = vi.hoisted(() => ({
  changeListeners: [] as ((event: { readonly document: { readonly fileName: string } }) => void)[],
  configurationListeners: [] as ((event: {
    affectsConfiguration: (section: string, resource?: unknown) => boolean;
  }) => void)[],
  panels: [] as unknown[],
  saveListeners: [] as ((document: { readonly fileName: string }) => void)[],
  warnings: [] as string[],
  watchers: [] as unknown[],
}));

vi.mock('../../src/presentation/activePreviewTarget', () => ({
  resolveActivePreviewTarget: targetResolvers.active,
  resolvePinnedPreviewTarget: targetResolvers.pinned,
}));

vi.mock('vscode', () => {
  /** Minimal immutable URI used by panel resources and pinned target identity. */
  class FakeUri {
    /** Creates one fake URI around an absolute path or serialized URI. */
    public constructor(
      public readonly fsPath: string,
      public readonly scheme = 'file',
    ) {}

    /** URI path used when the session preserves a non-file scheme for watcher resources. */
    public get path(): string {
      return this.fsPath;
    }

    /** Creates a file URI used by test target helpers. */
    public static file(filePath: string): FakeUri {
      return new FakeUri(filePath);
    }

    /** Parses artifact locations passed through the domain boundary. */
    public static parse(value: string): FakeUri {
      return new FakeUri(value.replace(/^file:\/\//u, ''));
    }

    /** Serializes one stable file URI. */
    public toString(): string {
      return `file://${this.fsPath}`;
    }

    /** Creates a sibling fake URI with selected path and presentation components replaced. */
    public with(change: { readonly path?: string }): FakeUri {
      return new FakeUri(change.path ?? this.fsPath, this.scheme);
    }
  }

  /** Minimal relative glob descriptor retained so tests can select a session-specific watcher. */
  class FakeRelativePattern {
    /** Stores one watcher base URI and glob text without interpreting either value. */
    public constructor(
      public readonly baseUri: FakeUri,
      public readonly pattern: string,
    ) {}
  }

  /** Mutable filesystem watcher that can emit external create/change/delete events in tests. */
  class FakeFileSystemWatcher {
    /** Whether the owning preview session disposed this watcher. */
    public disposed = false;
    private readonly changeListeners: ((uri: FakeUri) => void)[] = [];
    private readonly createListeners: ((uri: FakeUri) => void)[] = [];
    private readonly deleteListeners: ((uri: FakeUri) => void)[] = [];

    /** Stores the relative pattern supplied by the real session. */
    public constructor(public readonly relativePattern: FakeRelativePattern) {}

    /** Absolute base path exposed to session-isolation assertions. */
    public get basePath(): string {
      return this.relativePattern.baseUri.fsPath;
    }

    /** Registers an external file-content change callback. */
    public onDidChange(listener: (uri: FakeUri) => void): { dispose: () => void } {
      return registerListener(this.changeListeners, listener);
    }

    /** Registers an external file-creation callback. */
    public onDidCreate(listener: (uri: FakeUri) => void): { dispose: () => void } {
      return registerListener(this.createListeners, listener);
    }

    /** Registers an external file-deletion callback. */
    public onDidDelete(listener: (uri: FakeUri) => void): { dispose: () => void } {
      return registerListener(this.deleteListeners, listener);
    }

    /** Emits one file creation below this watcher's discovery root. */
    public fireCreate(filePath: string): void {
      for (const listener of [...this.createListeners]) {
        listener(FakeUri.file(filePath));
      }
    }

    /** Stops events and releases every callback owned by this fake watcher. */
    public dispose(): void {
      this.disposed = true;
      this.changeListeners.length = 0;
      this.createListeners.length = 0;
      this.deleteListeners.length = 0;
    }
  }

  /** Dedicated fake panel with explicit focus and disposal event emitters. */
  class FakePanel {
    /** Whether the panel currently owns focus. */
    public active = false;
    /** Mutable title updated by the real panel session. */
    public title: string;
    /** Creation options inspected by multi-panel assertions. */
    public readonly options: Record<string, unknown>;
    /** Extension-to-webview messages retained for hot-reload assertions. */
    public readonly hotReloadMessages: unknown[] = [];
    /** Minimal webview surface used by secure HTML rendering. */
    private automaticallyAcknowledgesHotReloads = true;
    private failNextUriConversion = false;
    private readonly messageListeners: ((message: unknown) => void)[] = [];
    public readonly webview = {
      asWebviewUri: (uri: FakeUri): FakeUri => {
        if (this.failNextUriConversion) {
          this.failNextUriConversion = false;
          throw new Error('simulated webview URI conversion failure');
        }
        return uri;
      },
      cspSource: 'vscode-webview://preview-test',
      html: '',
      onDidReceiveMessage: (listener: (message: unknown) => void): { dispose: () => void } =>
        registerListener(this.messageListeners, listener),
      postMessage: (message: unknown): Promise<boolean> => {
        if ((message as { readonly type?: unknown } | null)?.type === 'react-preview-progress') {
          return Promise.resolve(true);
        }
        this.hotReloadMessages.push(message);
        const identity = readMessageIdentity(message);
        if (identity !== undefined && this.automaticallyAcknowledgesHotReloads) {
          queueMicrotask(() => {
            this.emitHotReloadAcknowledgement(identity, 'react-preview-hot-reload-ready');
          });
        }
        return Promise.resolve(true);
      },
    };
    private readonly disposeListeners: (() => void)[] = [];
    private readonly viewStateListeners: ((event: { readonly webviewPanel: FakePanel }) => void)[] =
      [];
    /** Stores initial title and webview options. */
    public constructor(title: string, options: Record<string, unknown>) {
      this.title = title;
      this.options = options;
    }
    /** Registers one panel-disposal listener. */
    public onDidDispose(listener: () => void): { dispose: () => void } {
      this.disposeListeners.push(listener);
      return createListenerDisposable(this.disposeListeners, listener);
    }

    /** Registers one focus/visibility listener. */
    public onDidChangeViewState(listener: (event: { readonly webviewPanel: FakePanel }) => void): {
      dispose: () => void;
    } {
      this.viewStateListeners.push(listener);
      return createListenerDisposable(this.viewStateListeners, listener);
    }

    /** Emits a user focus transition without closing or rebuilding the panel. */
    public focus(): void {
      for (const panel of vscodeState.panels as FakePanel[]) {
        panel.active = panel === this;
      }
      for (const listener of [...this.viewStateListeners]) {
        listener({ webviewPanel: this });
      }
    }

    /** Emits user-driven panel disposal. */
    public dispose(): void {
      for (const listener of [...this.disposeListeners]) {
        listener();
      }
    }

    /** Makes the next ready-state URI conversion fail before the session accepts the new lease. */
    public failNextCommit(): void {
      this.failNextUriConversion = true;
    }

    /** Keeps a posted revision pending until the test explicitly emits its browser acknowledgement. */
    public holdHotReloadAcknowledgements(): void {
      this.automaticallyAcknowledgesHotReloads = false;
    }

    /** Emits an acknowledgement for one retained extension-to-webview revision message. */
    public acknowledgeHotReload(
      messageIndex: number,
      type:
        | 'react-preview-hot-reload-failed'
        | 'react-preview-hot-reload-ready' = 'react-preview-hot-reload-ready',
    ): void {
      const identity = readMessageIdentity(this.hotReloadMessages[messageIndex]);
      if (identity !== undefined) {
        this.emitHotReloadAcknowledgement(identity, type);
      }
    }

    /** Delivers one webview-to-extension message to the listeners owned by this panel only. */
    private emitHotReloadAcknowledgement(identity: HotReloadMessageIdentity, type: string): void {
      for (const listener of [...this.messageListeners]) {
        listener(createAcknowledgement(identity, type));
      }
    }
  }

  /** Creates a disposable that removes exactly one fake event listener. */
  function createListenerDisposable<Listener>(
    listeners: Listener[],
    listener: Listener,
  ): { dispose: () => void } {
    return {
      dispose: (): void => {
        const index = listeners.indexOf(listener);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      },
    };
  }

  /** Registers one extension-wide workspace callback in a mutable test bucket. */
  function registerListener<Listener>(
    listeners: Listener[],
    listener: Listener,
  ): { dispose: () => void } {
    listeners.push(listener);
    return createListenerDisposable(listeners, listener);
  }

  return {
    RelativePattern: FakeRelativePattern,
    Uri: FakeUri,
    ViewColumn: { Beside: 2 },
    window: {
      createWebviewPanel: (
        _viewType: string,
        title: string,
        _column: number,
        options: Record<string, unknown>,
      ): FakePanel => {
        const panel = new FakePanel(title, options);
        vscodeState.panels.push(panel);
        return panel;
      },
      showWarningMessage: (message: string): Promise<string> => {
        vscodeState.warnings.push(message);
        return Promise.resolve(message);
      },
    },
    workspace: {
      createFileSystemWatcher: (pattern: FakeRelativePattern): FakeFileSystemWatcher => {
        const watcher = new FakeFileSystemWatcher(pattern);
        vscodeState.watchers.push(watcher);
        return watcher;
      },
      getConfiguration: () => ({ get: (_key: string, fallback: number): number => fallback }),
      onDidChangeConfiguration: (listener: never): unknown =>
        registerListener(vscodeState.configurationListeners, listener),
      onDidChangeTextDocument: (listener: never): unknown =>
        registerListener(vscodeState.changeListeners, listener),
      onDidSaveTextDocument: (listener: never): unknown =>
        registerListener(vscodeState.saveListeners, listener),
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
  targetResolvers.active.mockReset();
  targetResolvers.pinned.mockReset();
  vscodeState.changeListeners.length = 0;
  vscodeState.configurationListeners.length = 0;
  vscodeState.panels.length = 0;
  vscodeState.saveListeners.length = 0;
  vscodeState.warnings.length = 0;
  vscodeState.watchers.length = 0;
});

describe('PreviewController', () => {
  /** Keeps the selected composition mode immutable for independent tabs and later refreshes. */
  it('pins component and page-inspector modes independently for the same source file', async () => {
    const target = createTarget('/workspace/src/SharedTarget.tsx');
    targetResolvers.active.mockReturnValue(target);
    targetResolvers.pinned.mockResolvedValue(target);
    let artifactSequence = 0;
    const execute = vi.fn((request: PreviewBuildRequest): Promise<PreparedPreview> => {
      artifactSequence += 1;
      return Promise.resolve({
        artifact: {
          contentHash: `${request.renderMode ?? 'component'}-${artifactSequence.toString()}`,
          scriptLocation: `file:///artifacts/${artifactSequence.toString()}/entry.js`,
        },
        dependencies: [request.documentPath],
        diagnostics: [],
        watchDirectories: [],
      });
    });
    const controller = new PreviewController(
      { execute, releaseArtifact: vi.fn(() => Promise.resolve()) } as unknown as BuildPreview,
      vscode.Uri.file('/artifacts'),
      { debug: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as vscode.LogOutputChannel,
    );

    await controller.open('component');
    await controller.open('page-inspector');
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(2);
    });
    expect(execute.mock.calls.map(([request]) => request.renderMode)).toEqual([
      'component',
      'page-inspector',
    ]);
    execute.mockClear();
    const inspectorPanel = (vscodeState.panels as TestPanel[])[1];
    inspectorPanel?.focus();
    await controller.refresh();
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    expect(execute.mock.calls[0]?.[0].renderMode).toBe('page-inspector');
    controller.dispose();
  });

  /** Keeps A and B independent across focus, edits, explicit refresh, and one panel disposal. */
  it('creates multiple pinned sessions without rebuilding on panel focus', async () => {
    vi.useFakeTimers();
    const targetA = createTarget('/workspace/src/A.tsx');
    const targetB = createTarget('/workspace/src/B.tsx');
    targetResolvers.active.mockReturnValueOnce(targetA).mockReturnValueOnce(targetB);
    targetResolvers.pinned.mockImplementation((uri: vscode.Uri) =>
      Promise.resolve(uri.fsPath === targetA.documentUri.fsPath ? targetA : targetB),
    );
    let artifactSequence = 0;
    const latestHashByDocument = new Map<string, string>();
    const execute = vi.fn((request: PreviewBuildRequest): Promise<PreparedPreview> => {
      artifactSequence += 1;
      const contentHash = `${path.basename(request.documentPath)}-${artifactSequence.toString()}`;
      latestHashByDocument.set(request.documentPath, contentHash);
      return Promise.resolve({
        artifact: {
          contentHash,
          scriptLocation: `file:///artifacts/${artifactSequence.toString()}/entry.js`,
        },
        dependencies: [request.documentPath, '/workspace/src/Shared.tsx'],
        diagnostics: [],
        watchDirectories: [
          path.join('/workspace/generated-pages', path.parse(request.documentPath).name),
        ],
      });
    });
    const releaseArtifact = vi.fn(() => Promise.resolve());
    const buildPreview = { execute, releaseArtifact } as unknown as BuildPreview;
    const log = {
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    } as unknown as vscode.LogOutputChannel;
    const controller = new PreviewController(buildPreview, vscode.Uri.file('/artifacts'), log);

    await controller.open();
    await controller.open();
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(2);
    });
    const [panelA, panelB] = vscodeState.panels as TestPanel[];
    expect(vscodeState.panels).toHaveLength(2);
    expect(panelA?.title).toBe('A.tsx');
    expect(panelB?.title).toBe('B.tsx');
    expect(panelA?.options.retainContextWhenHidden).toBe(true);
    expect(panelB?.options.retainContextWhenHidden).toBe(true);
    const initialHtmlA = panelA?.webview.html;
    const initialHtmlB = panelB?.webview.html;
    expect(execute.mock.calls.map(([request]) => request.documentPath)).toEqual([
      targetA.request.documentPath,
      targetB.request.documentPath,
    ]);

    execute.mockClear();
    vscodeState.changeListeners[0]?.({ document: { fileName: '/workspace/src/Shared.tsx' } });
    await vi.advanceTimersByTimeAsync(300);
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(4);
    });
    expect(execute.mock.calls.map(([request]) => request.documentPath).sort()).toEqual(
      [targetA.request.documentPath, targetB.request.documentPath]
        .flatMap((documentPath) => [documentPath, documentPath])
        .sort(),
    );
    await vi.waitFor(() => {
      expect(panelA?.hotReloadMessages).toHaveLength(2);
      expect(panelB?.hotReloadMessages).toHaveLength(2);
    });
    expect(panelA?.webview.html).toBe(initialHtmlA);
    expect(panelB?.webview.html).toBe(initialHtmlB);
    await flushMicrotasks();
    execute.mockClear();
    vscodeState.changeListeners[0]?.({ document: { fileName: '/workspace/src/Unrelated.tsx' } });
    await vi.advanceTimersByTimeAsync(300);
    expect(execute).not.toHaveBeenCalled();

    panelA?.focus();
    await Promise.resolve();
    expect(execute).not.toHaveBeenCalled();

    vscodeState.changeListeners[0]?.({ document: { fileName: targetB.request.documentPath } });
    await vi.advanceTimersByTimeAsync(300);
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    expect(execute.mock.calls[0]?.[0].documentPath).toBe(targetB.request.documentPath);

    execute.mockClear();
    const watcherB = (vscodeState.watchers as TestWatcher[]).find(
      (watcher) => watcher.basePath === '/workspace/generated-pages/B',
    );
    watcherB?.fireCreate('/workspace/generated-pages/B/NewPage.tsx');
    await vi.advanceTimersByTimeAsync(300);
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    expect(execute.mock.calls[0]?.[0].documentPath).toBe(targetB.request.documentPath);

    execute.mockClear();
    panelA?.focus();
    await controller.refresh();
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    expect(execute.mock.calls[0]?.[0].documentPath).toBe(targetA.request.documentPath);

    await flushMicrotasks();
    execute.mockClear();
    releaseArtifact.mockClear();
    const currentArtifactA = latestHashByDocument.get(targetA.request.documentPath);
    panelA?.dispose();
    vscodeState.changeListeners[0]?.({ document: { fileName: targetA.request.documentPath } });
    await vi.advanceTimersByTimeAsync(300);
    expect(execute).not.toHaveBeenCalled();
    expect(releaseArtifact).toHaveBeenCalledTimes(1);
    expect(releaseArtifact).toHaveBeenCalledWith(currentArtifactA);
    const watcherA = (vscodeState.watchers as TestWatcher[]).find(
      (watcher) => watcher.basePath === '/workspace/generated-pages/A',
    );
    expect(watcherA?.disposed).toBe(true);

    controller.dispose();
  });

  /** Keeps the old revision leased until the retained webview confirms the new ESM and CSS load. */
  it('transfers an artifact lease only after a hot-reload acknowledgement', async () => {
    const target = createTarget('/workspace/src/HotLease.tsx');
    targetResolvers.active.mockReturnValue(target);
    targetResolvers.pinned.mockResolvedValue(target);
    let buildSequence = 0;
    const execute = vi.fn(() => {
      buildSequence += 1;
      const hash = buildSequence === 1 ? 'hot-old' : 'hot-new';
      return Promise.resolve({
        ...createPreparedPreview(target, hash),
        artifact: {
          contentHash: hash,
          scriptLocation: `file:///artifacts/${hash}/entry.js`,
          stylesheetLocation: `file:///artifacts/${hash}/entry.css`,
        },
      } satisfies PreparedPreview);
    });
    const releaseArtifact = vi.fn<(contentHash: string) => Promise<void>>(() => Promise.resolve());
    const controller = new PreviewController(
      { execute, releaseArtifact } as unknown as BuildPreview,
      vscode.Uri.file('/artifacts'),
      { debug: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as vscode.LogOutputChannel,
    );

    await controller.open();
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    const [panel] = vscodeState.panels as TestPanel[];
    const initialHtml = panel?.webview.html;
    panel?.holdHotReloadAcknowledgements();
    await controller.refresh();
    await vi.waitFor(() => {
      expect(panel?.hotReloadMessages).toHaveLength(1);
    });

    expect(panel?.webview.html).toBe(initialHtml);
    expect(panel?.hotReloadMessages[0]).toMatchObject({
      scriptUri:
        'file:///artifacts/hot-new/entry.js?reactPreviewRevision=2&reactPreviewArtifact=hot-new',
      stylesheetUri: 'file:///artifacts/hot-new/entry.css',
      type: 'react-preview-hot-reload',
    });
    expect(releaseArtifact).not.toHaveBeenCalled();

    panel?.acknowledgeHotReload(0);
    await vi.waitFor(() => {
      expect(releaseArtifact).toHaveBeenCalledWith('hot-old');
    });
    expect(releaseArtifact).toHaveBeenCalledWith('hot-new');
    expect(panel?.webview.html).toBe(initialHtml);

    controller.dispose();
    expect(releaseArtifact).toHaveBeenCalledWith('hot-new');
  });

  /** Falls back to a complete latest document when a live webview never acknowledges the swap. */
  it('releases the old lease and loads the latest document after the hot timeout', async () => {
    vi.useFakeTimers();
    const target = createTarget('/workspace/src/HotTimeout.tsx');
    targetResolvers.active.mockReturnValue(target);
    targetResolvers.pinned.mockResolvedValue(target);
    let buildSequence = 0;
    const execute = vi.fn(() => {
      buildSequence += 1;
      return Promise.resolve(
        createPreparedPreview(target, buildSequence === 1 ? 'timeout-old' : 'timeout-new'),
      );
    });
    const releaseArtifact = vi.fn(() => Promise.resolve());
    const controller = new PreviewController(
      { execute, releaseArtifact } as unknown as BuildPreview,
      vscode.Uri.file('/artifacts'),
      { debug: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as vscode.LogOutputChannel,
    );

    await controller.open();
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    const [panel] = vscodeState.panels as TestPanel[];
    const initialHtml = panel?.webview.html;
    panel?.holdHotReloadAcknowledgements();
    await controller.refresh();
    await vi.waitFor(() => {
      expect(panel?.hotReloadMessages).toHaveLength(1);
    });

    expect(panel?.webview.html).toBe(initialHtml);
    expect(releaseArtifact).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(panel?.webview.html).not.toBe(initialHtml);
    expect(panel?.webview.html).toContain('/artifacts/timeout-new/entry.js');
    expect(releaseArtifact).toHaveBeenCalledWith('timeout-old');
    expect(releaseArtifact).not.toHaveBeenCalledWith('timeout-new');

    controller.dispose();
    expect(releaseArtifact).toHaveBeenCalledWith('timeout-new');
  });

  /** Prevents an older timeout from replacing a newer revision that already acknowledged. */
  it('ignores stale hot-reload fallbacks after a newer revision becomes current', async () => {
    vi.useFakeTimers();
    const target = createTarget('/workspace/src/HotRace.tsx');
    targetResolvers.active.mockReturnValue(target);
    targetResolvers.pinned.mockResolvedValue(target);
    let buildSequence = 0;
    const execute = vi.fn(() => {
      buildSequence += 1;
      return Promise.resolve(createPreparedPreview(target, `race-${buildSequence.toString()}`));
    });
    const releaseArtifact = vi.fn<(contentHash: string) => Promise<void>>(() => Promise.resolve());
    const controller = new PreviewController(
      { execute, releaseArtifact } as unknown as BuildPreview,
      vscode.Uri.file('/artifacts'),
      { debug: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as vscode.LogOutputChannel,
    );

    await controller.open();
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    const [panel] = vscodeState.panels as TestPanel[];
    const initialHtml = panel?.webview.html;
    panel?.holdHotReloadAcknowledgements();
    await controller.refresh();
    await vi.waitFor(() => {
      expect(panel?.hotReloadMessages).toHaveLength(1);
    });
    await controller.refresh();
    await vi.waitFor(() => {
      expect(panel?.hotReloadMessages).toHaveLength(2);
    });

    panel?.acknowledgeHotReload(1);
    await vi.waitFor(() => {
      expect(releaseArtifact).toHaveBeenCalledWith('race-2');
    });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(panel?.webview.html).not.toBe(initialHtml);
    expect(panel?.webview.html).toContain('/artifacts/race-4/entry.js');
    expect(releaseArtifact).toHaveBeenCalledWith('race-1');
    controller.dispose();
    expect(releaseArtifact).toHaveBeenCalledWith('race-4');
  });

  /** Releases a failed replacement while retaining the preceding mounted artifact and document. */
  it('rolls back a hot reload that retained the previous browser tree', async () => {
    const target = createTarget('/workspace/src/HotDispose.tsx');
    targetResolvers.active.mockReturnValue(target);
    targetResolvers.pinned.mockResolvedValue(target);
    let buildSequence = 0;
    const execute = vi.fn(() => {
      buildSequence += 1;
      return Promise.resolve(
        createPreparedPreview(target, buildSequence === 1 ? 'dispose-old' : 'dispose-new'),
      );
    });
    const releaseArtifact = vi.fn<(contentHash: string) => Promise<void>>(() => Promise.resolve());
    const controller = new PreviewController(
      { execute, releaseArtifact } as unknown as BuildPreview,
      vscode.Uri.file('/artifacts'),
      { debug: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as vscode.LogOutputChannel,
    );

    await controller.open();
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    const [panel] = vscodeState.panels as TestPanel[];
    const initialHtml = panel?.webview.html;
    panel?.holdHotReloadAcknowledgements();
    await controller.refresh();
    await vi.waitFor(() => {
      expect(panel?.hotReloadMessages).toHaveLength(1);
    });

    panel?.acknowledgeHotReload(0, 'react-preview-hot-reload-failed');
    await vi.waitFor(() => {
      expect(releaseArtifact).toHaveBeenCalledWith('dispose-new');
    });
    expect(releaseArtifact).not.toHaveBeenCalledWith('dispose-old');
    expect(panel?.webview.html).toBe(initialHtml);

    controller.dispose();
    expect(releaseArtifact).toHaveBeenCalledWith('dispose-old');
  });

  /** Lets a newer identical build await and reuse an already pending browser transfer. */
  it('settles context enrichment through a pending same-hash hot reload', async () => {
    const target = createTarget('/workspace/src/HotUnchanged.tsx');
    targetResolvers.active.mockReturnValue(target);
    targetResolvers.pinned.mockResolvedValue(target);
    let buildSequence = 0;
    const execute = vi.fn(() => {
      buildSequence += 1;
      return Promise.resolve(
        createPreparedPreview(target, buildSequence === 1 ? 'previous-hash' : 'same-hash'),
      );
    });
    const releaseArtifact = vi.fn<(contentHash: string) => Promise<void>>(() => Promise.resolve());
    const controller = new PreviewController(
      { execute, releaseArtifact } as unknown as BuildPreview,
      vscode.Uri.file('/artifacts'),
      { debug: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as vscode.LogOutputChannel,
    );

    await controller.open();
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    const [panel] = vscodeState.panels as TestPanel[];
    const initialHtml = panel?.webview.html;
    panel?.holdHotReloadAcknowledgements();

    await controller.refresh();
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(2);
      expect(panel?.hotReloadMessages).toHaveLength(1);
    });
    await controller.refresh();
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(3);
      expect(releaseArtifact).toHaveBeenCalledWith('same-hash');
    });

    expect(panel?.hotReloadMessages).toHaveLength(1);
    expect(panel?.webview.html).toBe(initialHtml);
    panel?.acknowledgeHotReload(0);
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(4);
      expect(releaseArtifact).toHaveBeenCalledWith('previous-hash');
    });
    controller.dispose();
    expect(releaseArtifact).toHaveBeenCalledWith('same-hash');
  });

  /** Rebuilds a pinned panel when a project runtime or output policy setting changes. */
  it('routes build configuration changes to existing sessions', async () => {
    vi.useFakeTimers();
    const target = createTarget('/workspace/src/Configured.tsx');
    targetResolvers.active.mockReturnValue(target);
    targetResolvers.pinned.mockResolvedValue(target);
    const execute = vi.fn(() => Promise.resolve(createPreparedPreview(target, 'configured')));
    const controller = new PreviewController(
      { execute, releaseArtifact: vi.fn(() => Promise.resolve()) } as unknown as BuildPreview,
      vscode.Uri.file('/artifacts'),
      { debug: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as vscode.LogOutputChannel,
    );

    await controller.open();
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    execute.mockClear();

    for (const changedSetting of [
      'reactPreview.maxOutputSizeMiB',
      'reactPreview.setupFile',
      'reactPreview.useStorybookPreview',
    ]) {
      vscodeState.configurationListeners[0]?.({
        affectsConfiguration: (section) => section === changedSetting,
      });
      await vi.advanceTimersByTimeAsync(300);
      await vi.waitFor(() => {
        expect(execute).toHaveBeenCalledTimes(1);
      });
      execute.mockClear();
    }

    controller.dispose();
  });

  /** Retains the last good panel when a later pinned-document lookup fails transiently. */
  it('contains pinned target resolution failures without discarding the preview', async () => {
    const target = createTarget('/workspace/src/Unavailable.tsx');
    targetResolvers.active.mockReturnValue(target);
    targetResolvers.pinned.mockRejectedValue(new Error('simulated document provider failure'));
    const execute = vi.fn(() =>
      Promise.resolve({
        artifact: {
          contentHash: 'unavailable-first-build',
          scriptLocation: 'file:///artifacts/unavailable-first-build/entry.js',
        },
        dependencies: [target.request.documentPath],
        diagnostics: [],
        watchDirectories: [],
      } satisfies PreparedPreview),
    );
    const releaseArtifact = vi.fn(() => Promise.resolve());
    const errorLog = vi.fn();
    const log = {
      debug: vi.fn(),
      error: errorLog,
      warn: vi.fn(),
    } as unknown as vscode.LogOutputChannel;
    const controller = new PreviewController(
      { execute, releaseArtifact } as unknown as BuildPreview,
      vscode.Uri.file('/artifacts'),
      log,
    );

    await controller.open();
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    const [panel] = vscodeState.panels as TestPanel[];
    const initialHtml = panel?.webview.html;
    panel?.focus();

    await controller.refresh();
    await vi.waitFor(() => {
      expect(errorLog).toHaveBeenCalledWith(
        'React preview target resolution failed.',
        expect.any(Error),
      );
    });
    expect(panel?.webview.html).toBe(initialHtml);
    expect(releaseArtifact).not.toHaveBeenCalled();

    controller.dispose();
    expect(releaseArtifact).toHaveBeenCalledWith('unavailable-first-build');
  });

  /** Releases the rejected new artifact while retaining the last successfully mounted display. */
  it('returns an incoming artifact lease when webview commit fails', async () => {
    const target = createTarget('/workspace/src/CommitFailure.tsx');
    targetResolvers.active.mockReturnValue(target);
    targetResolvers.pinned.mockResolvedValue(target);
    let buildSequence = 0;
    const execute = vi.fn(() => {
      buildSequence += 1;
      return Promise.resolve({
        artifact: {
          contentHash: `commit-artifact-${buildSequence.toString()}`,
          scriptLocation: `file:///artifacts/commit-artifact-${buildSequence.toString()}/entry.js`,
        },
        dependencies: [target.request.documentPath],
        diagnostics: [],
        watchDirectories: [],
      } satisfies PreparedPreview);
    });
    const releaseArtifact = vi.fn(() => Promise.resolve());
    const controller = new PreviewController(
      { execute, releaseArtifact } as unknown as BuildPreview,
      vscode.Uri.file('/artifacts'),
      { debug: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as vscode.LogOutputChannel,
    );

    await controller.open();
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    const [panel] = vscodeState.panels as TestPanel[];
    const initialHtml = panel?.webview.html;
    panel?.focus();
    panel?.failNextCommit();

    await controller.refresh();
    await vi.waitFor(() => {
      expect(releaseArtifact).toHaveBeenCalledWith('commit-artifact-2');
    });
    expect(releaseArtifact).not.toHaveBeenCalledWith('commit-artifact-1');
    expect(panel?.webview.html).toBe(initialHtml);

    controller.dispose();
    expect(releaseArtifact).toHaveBeenCalledWith('commit-artifact-1');
  });

  /** Discards and releases an older build that finishes after a newer pinned revision is visible. */
  it('returns stale out-of-order artifacts without replacing the latest revision', async () => {
    const target = createTarget('/workspace/src/Racing.tsx');
    targetResolvers.active.mockReturnValue(target);
    targetResolvers.pinned.mockResolvedValue(target);
    const firstBuild = createDeferred<PreparedPreview>();
    const secondBuild = createDeferred<PreparedPreview>();
    const execute = vi
      .fn<BuildPreview['execute']>()
      .mockReturnValueOnce(firstBuild.promise)
      .mockReturnValueOnce(secondBuild.promise);
    const releaseArtifact = vi.fn(() => Promise.resolve());
    const controller = new PreviewController(
      { execute, releaseArtifact } as unknown as BuildPreview,
      vscode.Uri.file('/artifacts'),
      { debug: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as vscode.LogOutputChannel,
    );

    await controller.open();
    await controller.refresh();
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(2);
    });
    secondBuild.resolve(createPreparedPreview(target, 'newer-artifact'));
    await Promise.resolve();
    firstBuild.resolve(createPreparedPreview(target, 'older-artifact'));

    await vi.waitFor(() => {
      expect(releaseArtifact).toHaveBeenCalledWith('older-artifact');
    });
    expect(releaseArtifact).not.toHaveBeenCalledWith('newer-artifact');

    controller.dispose();
    expect(releaseArtifact).toHaveBeenCalledWith('newer-artifact');
  });

  /** Returns an artifact that arrives after its panel was disposed during compilation. */
  it('returns an in-flight artifact after panel disposal', async () => {
    const target = createTarget('/workspace/src/Closing.tsx');
    targetResolvers.active.mockReturnValue(target);
    const pendingBuild = createDeferred<PreparedPreview>();
    const execute = vi.fn<BuildPreview['execute']>().mockReturnValue(pendingBuild.promise);
    const releaseArtifact = vi.fn(() => Promise.resolve());
    const controller = new PreviewController(
      { execute, releaseArtifact } as unknown as BuildPreview,
      vscode.Uri.file('/artifacts'),
      { debug: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as vscode.LogOutputChannel,
    );

    await controller.open();
    controller.dispose();
    pendingBuild.resolve(createPreparedPreview(target, 'closed-panel-artifact'));

    await vi.waitFor(() => {
      expect(releaseArtifact).toHaveBeenCalledWith('closed-panel-artifact');
    });
  });
});
/** Test-only subset exposed by each fake filesystem watcher. */
interface TestWatcher {
  /** Absolute relative-pattern base used to select a session watcher. */
  readonly basePath: string;
  /** Whether the owning session disposed this watcher. */
  readonly disposed: boolean;
  /** Emits one created file URI. */
  fireCreate(filePath: string): void;
}

/**
 * Creates one resolved target with a distinct immutable URI and build request.
 *
 * @param documentPath Absolute source path pinned to the new panel.
 * @returns Presentation target accepted by the controller.
 */
function createTarget(documentPath: string): ResolvedPreviewTarget {
  return {
    documentName: path.relative('/workspace', documentPath),
    documentUri: vscode.Uri.file(documentPath),
    request: {
      dependencySnapshots: [],
      documentPath,
      language: 'tsx',
      sourceText: `export default function Preview() { return ${JSON.stringify(documentPath)}; }`,
      workspaceRoot: '/workspace',
    },
  };
}

/**
 * Creates one successful prepared result for lifecycle race tests.
 *
 * @param target Pinned source whose dependency graph owns the result.
 * @param contentHash Distinct artifact identity used by release assertions.
 * @returns Successful application result suitable for resolving a deferred build.
 */
function createPreparedPreview(
  target: ResolvedPreviewTarget,
  contentHash: string,
): PreparedPreview {
  return {
    artifact: {
      contentHash,
      scriptLocation: `file:///artifacts/${contentHash}/entry.js`,
    },
    dependencies: [target.request.documentPath],
    diagnostics: [],
    watchDirectories: [],
  };
}

/** Mutable promise controls used to force a deterministic asynchronous completion order. */
interface Deferred<Value> {
  /** Promise supplied to production code. */
  readonly promise: Promise<Value>;
  /** Resolves the promise from the test body. */
  readonly resolve: (value: Value) => void;
}

/**
 * Creates a promise whose completion is controlled explicitly by a lifecycle test.
 *
 * @returns Deferred promise and its externally callable resolver.
 */
function createDeferred<Value>(): Deferred<Value> {
  let resolvePromise: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value: Value): void => {
      resolvePromise?.(value);
    },
  };
}

/** Flushes queued fake webview acknowledgements before resetting release assertions. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
