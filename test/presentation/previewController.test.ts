/**
 * Verifies that the controller manages multiple pinned panels without using focus as a build event.
 * The VS Code mock exposes panel and workspace event emitters while real PreviewPanelSession logic
 * exercises independent revisions, dependency routing, and artifact lease replacement.
 */
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type { BuildPreview } from '../../src/application/buildPreview';
import type { PreviewBuildRequest, PreparedPreview } from '../../src/domain/preview';
import type { ResolvedPreviewTarget } from '../../src/presentation/activePreviewTarget';
import { PreviewController } from '../../src/presentation/previewController';

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
    /** Minimal webview surface used by secure HTML rendering. */
    private failNextUriConversion = false;
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
    expect(panelA?.options.retainContextWhenHidden).toBe(true);
    expect(panelB?.options.retainContextWhenHidden).toBe(true);
    expect(execute.mock.calls.map(([request]) => request.documentPath)).toEqual([
      targetA.request.documentPath,
      targetB.request.documentPath,
    ]);

    execute.mockClear();
    vscodeState.changeListeners[0]?.({ document: { fileName: '/workspace/src/Shared.tsx' } });
    await vi.advanceTimersByTimeAsync(300);
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(2);
    });
    expect(execute.mock.calls.map(([request]) => request.documentPath).sort()).toEqual(
      [targetA.request.documentPath, targetB.request.documentPath].sort(),
    );

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

  /** Rebuilds a pinned panel when either project runtime setup setting changes for its resource. */
  it('routes setup configuration changes to existing sessions', async () => {
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

    for (const changedSetting of ['reactPreview.setupFile', 'reactPreview.useStorybookPreview']) {
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

  /** Converts a rejected pinned-document lookup into a panel error and releases its old artifact. */
  it('contains pinned target resolution failures inside the affected session', async () => {
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
    panel?.focus();

    await controller.refresh();
    await vi.waitFor(() => {
      expect(errorLog).toHaveBeenCalledWith(
        'React preview target resolution failed.',
        expect.any(Error),
      );
      expect(releaseArtifact).toHaveBeenCalledWith('unavailable-first-build');
    });

    controller.dispose();
  });

  /** Releases both the rejected new artifact and the old display when ready-state commit fails. */
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
    panel?.focus();
    panel?.failNextCommit();

    await controller.refresh();
    await vi.waitFor(() => {
      expect(releaseArtifact).toHaveBeenCalledWith('commit-artifact-2');
      expect(releaseArtifact).toHaveBeenCalledWith('commit-artifact-1');
    });

    controller.dispose();
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

/** Test-only subset exposed by the fake webview panel. */
interface TestPanel {
  /** Creation options supplied by the controller. */
  readonly options: Record<string, unknown>;
  /** Emits a disposal event. */
  dispose(): void;
  /** Makes the next ready-state conversion throw. */
  failNextCommit(): void;
  /** Emits a focus-only view-state event. */
  focus(): void;
}

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
