/**
 * Verifies revision cancellation and debounce coalescing on the real panel session without adding
 * more lines to the maximum-sized controller suite. Minimal VS Code fakes expose only used APIs.
 */
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type { PreparedPreview } from '../../src/domain/preview';
import type { PreviewBuildExecutionContext } from '../../src/domain/previewBuildExecution';
import type { ResolvedPreviewTarget } from '../../src/presentation/activePreviewTarget';
import {
  PreviewPanelSession,
  type PreviewBuildService,
  type PinnedPreviewTargetResolver,
} from '../../src/presentation/previewPanelSession';

vi.mock('vscode', () => {
  /** Immutable URI sufficient for target and artifact conversion. */
  class FakeUri {
    /** Stores one path and scheme without touching the filesystem. */
    public constructor(
      public readonly fsPath: string,
      public readonly scheme = 'file',
    ) {}

    /** URI path used by sibling watcher construction. */
    public get path(): string {
      return this.fsPath;
    }

    /** Creates a file URI for one fixture path. */
    public static file(filePath: string): FakeUri {
      return new FakeUri(filePath);
    }

    /** Parses serialized artifact locations used by the session. */
    public static parse(value: string): FakeUri {
      return new FakeUri(value.replace(/^file:\/\//u, ''));
    }

    /** Preserves identity while changing selected URI fields. */
    public with(change: { readonly path?: string }): FakeUri {
      return new FakeUri(change.path ?? this.fsPath, this.scheme);
    }

    /** Serializes a stable file URI accepted by preview HTML. */
    public toString(): string {
      return `file://${this.fsPath}`;
    }
  }

  /** Retains one watcher pattern for API compatibility. */
  class FakeRelativePattern {
    /** Stores pattern arguments without interpreting the glob. */
    public constructor(
      public readonly base: FakeUri,
      public readonly pattern: string,
    ) {}
  }

  return {
    RelativePattern: FakeRelativePattern,
    Uri: FakeUri,
    workspace: {
      createFileSystemWatcher: vi.fn(() => ({
        dispose: vi.fn(),
        onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
        onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
        onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
      })),
      getConfiguration: vi.fn(() => ({
        get: vi.fn((_name: string, fallback: unknown) => fallback),
      })),
    },
  };
});

/** Mutable webview panel that records status messages and can acknowledge runtime startup. */
class CancellationPanel {
  public active = false;
  public title = 'React Preview';
  private readonly disposeListeners: (() => void)[] = [];
  private readonly messageListeners: ((message: unknown) => void)[] = [];
  private readonly viewStateListeners: (() => void)[] = [];

  /** Minimal webview surface consumed by the session. */
  public readonly webview = {
    asWebviewUri: (uri: vscode.Uri): vscode.Uri => uri,
    cspSource: 'vscode-webview://cancellation-test',
    html: '',
    onDidReceiveMessage: (listener: (message: unknown) => void): vscode.Disposable =>
      this.register(this.messageListeners, listener),
    postMessage: vi.fn(() => Promise.resolve(true)),
  };

  /** Registers a panel-disposal callback. */
  public onDidDispose(listener: () => void): vscode.Disposable {
    return this.register(this.disposeListeners, listener);
  }

  /** Registers a focus-state callback. */
  public onDidChangeViewState(listener: () => void): vscode.Disposable {
    return this.register(this.viewStateListeners, listener);
  }

  /** Emits one browser runtime acknowledgement. */
  public emitMessage(message: unknown): void {
    for (const listener of [...this.messageListeners]) {
      listener(message);
    }
  }

  /** Emits user-driven closure to registered listeners. */
  public dispose(): void {
    for (const listener of [...this.disposeListeners]) {
      listener();
    }
  }

  /** Adds one listener and returns an idempotent disposal shape. */
  private register<Value>(listeners: Value[], listener: Value): vscode.Disposable {
    listeners.push(listener);
    return {
      dispose: (): void => {
        const index = listeners.indexOf(listener);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      },
    };
  }
}

describe('PreviewPanelSession cancellation and coalescing', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  /** Aborts target resolution immediately when a newer manual revision supersedes it. */
  it('passes and aborts a revision-owned signal during pinned target resolution', async () => {
    const observedSignals: AbortSignal[] = [];
    const fixture = createFixture({
      resolveTarget: vi.fn((_uri: vscode.Uri, signal?: AbortSignal) => {
        if (signal !== undefined) {
          observedSignals.push(signal);
        }
        return new Promise<ResolvedPreviewTarget>(() => undefined);
      }),
    });

    fixture.session.refresh();
    await Promise.resolve();
    expect(observedSignals[0]?.aborted).toBe(false);

    fixture.session.refresh();
    await Promise.resolve();
    expect(observedSignals[0]?.aborted).toBe(true);
    expect(observedSignals[1]?.aborted).toBe(false);

    fixture.session.dispose();
    expect(observedSignals[1]?.aborted).toBe(true);
  });

  /** Keeps only the final delayed refresh and aborts an already-running build at scheduling time. */
  it('coalesces repeated configuration changes into the latest build revision', async () => {
    vi.useFakeTimers();
    const contexts: PreviewBuildExecutionContext[] = [];
    const firstBuild = new Promise<PreparedPreview>(() => undefined);
    const fixture = createFixture({
      execute: vi
        .fn<PreviewBuildService['execute']>()
        .mockImplementationOnce((_request, context) => {
          if (context !== undefined) {
            contexts.push(context);
          }
          return firstBuild;
        })
        .mockImplementationOnce((_request, context) => {
          if (context !== undefined) {
            contexts.push(context);
          }
          return Promise.resolve(createPreparedPreview('latest'));
        }),
    });

    fixture.session.start();
    await settleAsyncWork();
    expect(contexts[0]?.signal?.aborted).toBe(false);

    fixture.session.refreshForConfiguration();
    fixture.session.refreshForConfiguration();
    expect(contexts[0]?.signal?.aborted).toBe(true);

    await vi.advanceTimersByTimeAsync(299);
    expect(fixture.execute).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await settleAsyncWork();

    expect(fixture.execute).toHaveBeenCalledTimes(2);
    expect(fixture.resolveTarget).toHaveBeenCalledOnce();
    expect(contexts[1]?.signal?.aborted).toBe(false);
    fixture.session.dispose();
  });

  /** Writes JSON stage durations and closes loading after an exact runtime-ready acknowledgement. */
  it('logs structured duration traces without changing progress messages', async () => {
    const fixture = createFixture({
      execute: vi.fn((_request, context?: PreviewBuildExecutionContext) => {
        context?.reportProgress?.('analyzing-project');
        context?.reportProgress?.('bundling-modules');
        return Promise.resolve(createPreparedPreview('trace-ready'));
      }),
    });

    fixture.session.start();
    await settleAsyncWork();
    fixture.panel.emitMessage({
      revision: 1,
      token: '1:trace-ready',
      type: 'react-preview-runtime-ready',
    });

    const traceMessages = fixture.debug.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.startsWith('React preview performance '));
    expect(traceMessages.some((message) => message.includes('"stage":"resolving-target"'))).toBe(
      true,
    );
    expect(traceMessages.some((message) => message.includes('"stage":"loading-preview"'))).toBe(
      true,
    );
    expect(traceMessages.every((message) => message.includes('"durationMs":'))).toBe(true);
    fixture.session.dispose();
  });
});

/** Observable collaborators returned for one real panel session. */
interface CancellationFixture {
  readonly debug: ReturnType<typeof vi.fn>;
  readonly execute: ReturnType<typeof vi.fn>;
  readonly panel: CancellationPanel;
  readonly resolveTarget: ReturnType<typeof vi.fn>;
  readonly session: PreviewPanelSession;
}

/** Optional overrides for build and target operations used by individual cancellation cases. */
interface CancellationFixtureOverrides {
  readonly execute?: ReturnType<typeof vi.fn>;
  readonly resolveTarget?: ReturnType<typeof vi.fn>;
}

/** Creates one independently owned panel session with observable execution collaborators. */
function createFixture(overrides: CancellationFixtureOverrides = {}): CancellationFixture {
  const target = createTarget('/workspace/src/CancellationTarget.tsx');
  const panel = new CancellationPanel();
  const debug = vi.fn();
  const execute = overrides.execute ?? vi.fn(() => Promise.resolve(createPreparedPreview('ready')));
  const resolveTarget = overrides.resolveTarget ?? vi.fn(() => Promise.resolve(target));
  const session = new PreviewPanelSession({
    buildPreview: {
      execute: execute as PreviewBuildService['execute'],
      releaseArtifact: vi.fn(() => Promise.resolve()),
    },
    callbacks: { onDidDispose: vi.fn(), onDidFocus: vi.fn() },
    initialTarget: target,
    log: { debug, error: vi.fn(), warn: vi.fn() } as unknown as vscode.LogOutputChannel,
    panel: panel as unknown as vscode.WebviewPanel,
    renderMode: 'component',
    resolveTarget: resolveTarget as unknown as PinnedPreviewTargetResolver,
  });
  return { debug, execute, panel, resolveTarget, session };
}

/** Creates one immutable React target pinned to the fixture session. */
function createTarget(documentPath: string): ResolvedPreviewTarget {
  return {
    documentName: path.relative('/workspace', documentPath),
    documentUri: vscode.Uri.file(documentPath),
    request: {
      dependencySnapshots: [],
      documentPath,
      language: 'tsx',
      sourceText: 'export default function CancellationTarget() { return null; }',
      workspaceRoot: '/workspace',
    },
  };
}

/** Creates one browser artifact with no optional style or watcher roots. */
function createPreparedPreview(contentHash: string): PreparedPreview {
  return {
    artifact: {
      contentHash,
      scriptLocation: `file:///artifacts/${contentHash}/entry.js`,
    },
    dependencies: ['/workspace/src/CancellationTarget.tsx'],
    diagnostics: [],
    watchDirectories: [],
  };
}

/** Allows immediate resolver, build, publication, and commit microtasks to settle. */
async function settleAsyncWork(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve();
  }
}
