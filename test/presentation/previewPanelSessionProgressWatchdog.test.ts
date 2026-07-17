/**
 * Verifies the full-document startup watchdog without extending the maximum-sized controller test.
 * The real panel session owns the timer, token validation, error document, and artifact lease;
 * compact VS Code fakes expose only the event and webview surfaces required by those behaviors.
 */
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type { PreparedPreview } from '../../src/domain/preview';
import type { ResolvedPreviewTarget } from '../../src/presentation/activePreviewTarget';
import {
  PreviewPanelSession,
  type PreviewBuildService,
} from '../../src/presentation/previewPanelSession';

vi.mock('vscode', () => {
  /** Immutable URI sufficient for pinned targets and published artifact conversion. */
  class FakeUri {
    /** Stores one path and scheme without performing filesystem access. */
    public constructor(
      public readonly fsPath: string,
      public readonly scheme = 'file',
    ) {}

    /** URI path used by sibling watcher resource construction. */
    public get path(): string {
      return this.fsPath;
    }

    /** Creates a file URI around one absolute fixture path. */
    public static file(filePath: string): FakeUri {
      return new FakeUri(filePath);
    }

    /** Parses the file artifact locations emitted by the application layer. */
    public static parse(value: string): FakeUri {
      return new FakeUri(value.replace(/^file:\/\//u, ''));
    }

    /** Preserves the scheme while replacing selected URI presentation fields. */
    public with(change: { readonly path?: string }): FakeUri {
      return new FakeUri(change.path ?? this.fsPath, this.scheme);
    }

    /** Serializes a stable file URI accepted by generated preview HTML. */
    public toString(): string {
      return `file://${this.fsPath}`;
    }
  }

  /** Stores one filesystem pattern if a future fixture elects to add watch directories. */
  class FakeRelativePattern {
    /** Retains pattern arguments without interpreting the glob. */
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

/** Mutable webview panel used to emit runtime settlement messages into the real session. */
class WatchdogPanel {
  /** Whether this fixture currently represents the focused editor tab. */
  public active = false;
  /** Basename title assigned after pinned target resolution. */
  public title = 'React Preview';
  private readonly disposeListeners: (() => void)[] = [];
  private readonly messageListeners: ((message: unknown) => void)[] = [];
  private readonly viewStateListeners: (() => void)[] = [];

  /** Minimal webview surface consumed by the session under test. */
  public readonly webview = {
    asWebviewUri: (uri: vscode.Uri): vscode.Uri => uri,
    cspSource: 'vscode-webview://progress-watchdog-test',
    html: '',
    onDidReceiveMessage: (listener: (message: unknown) => void): vscode.Disposable =>
      this.register(this.messageListeners, listener),
    postMessage: vi.fn(() => Promise.resolve(true)),
  };

  /** Current complete webview document assigned by the real panel session. */
  public get html(): string {
    return this.webview.html;
  }

  /** Registers one panel disposal callback. */
  public onDidDispose(listener: () => void): vscode.Disposable {
    return this.register(this.disposeListeners, listener);
  }

  /** Registers one focus-state callback. */
  public onDidChangeViewState(listener: () => void): vscode.Disposable {
    return this.register(this.viewStateListeners, listener);
  }

  /** Emits one browser-to-extension runtime settlement message. */
  public emitMessage(message: unknown): void {
    for (const listener of [...this.messageListeners]) {
      listener(message);
    }
  }

  /** Emits panel closure to every listener and clears no unrelated test state. */
  public dispose(): void {
    for (const listener of [...this.disposeListeners]) {
      listener();
    }
  }

  /** Adds a listener and returns the standard idempotent VS Code disposal shape. */
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

describe('PreviewPanelSession initial runtime watchdog', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  /**
   * Converts an entry that never starts into a finite diagnostic state and releases the artifact
   * whose module graph can no longer recover inside the abandoned complete document.
   */
  it('replaces permanent initial loading with an error after the bounded timeout', async () => {
    vi.useFakeTimers();
    const fixture = createSessionFixture('watchdog-timeout');

    fixture.session.start();
    await settleSessionBuild();

    expect(fixture.panel.html).toContain('data-react-preview-runtime-token');
    expect(fixture.panel.html).toContain('1:watchdog-timeout');
    expect(fixture.releaseArtifact).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(29_999);

    expect(fixture.panel.html).toContain('data-react-preview-runtime-token');
    expect(fixture.releaseArtifact).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(fixture.panel.html).toContain('Preview runtime did not start');
    expect(fixture.panel.html).toContain('generated browser modules did not start');
    expect(fixture.releaseArtifact).toHaveBeenCalledTimes(1);
    expect(fixture.releaseArtifact).toHaveBeenCalledWith('watchdog-timeout');

    fixture.session.dispose();
  });

  /**
   * Rejects stale or forged startup acknowledgements and clears the timer only after both the exact
   * full-document token and session revision match the currently pending runtime.
   */
  it.each(['react-preview-runtime-ready', 'react-preview-runtime-failed'] as const)(
    'settles only an exact %s acknowledgement',
    async (messageType) => {
      vi.useFakeTimers();
      const fixture = createSessionFixture('watchdog-acknowledged');

      fixture.session.start();
      await settleSessionBuild();

      fixture.panel.emitMessage({
        revision: 1,
        token: '1:another-artifact',
        type: messageType,
      });
      fixture.panel.emitMessage({
        revision: 2,
        token: '1:watchdog-acknowledged',
        type: messageType,
      });
      await vi.advanceTimersByTimeAsync(29_999);

      expect(fixture.releaseArtifact).not.toHaveBeenCalled();
      expect(fixture.panel.html).not.toContain('Preview runtime did not start');

      fixture.panel.emitMessage({
        revision: 1,
        token: '1:watchdog-acknowledged',
        type: messageType,
      });
      await vi.advanceTimersByTimeAsync(60_000);

      expect(fixture.releaseArtifact).toHaveBeenCalledTimes(1);
      expect(fixture.releaseArtifact).toHaveBeenCalledWith('watchdog-acknowledged');
      expect(fixture.panel.html).not.toContain('Preview runtime did not start');

      fixture.session.dispose();
      expect(fixture.releaseArtifact).toHaveBeenCalledTimes(2);
    },
  );
});

/** Session fixture carrying observable artifact and webview collaborators. */
interface SessionFixture {
  /** Artifact-release spy used to prove finite lease ownership. */
  readonly releaseArtifact: ReturnType<typeof vi.fn>;
  /** Real independently owned panel session. */
  readonly session: PreviewPanelSession;
  /** Browser message and HTML test panel. */
  readonly panel: WatchdogPanel;
}

/**
 * Creates one session whose successful build waits for an explicit browser runtime settlement.
 *
 * @param contentHash Artifact identity encoded into the full-document startup token.
 * @returns Session plus observable panel and release spy.
 */
function createSessionFixture(contentHash: string): SessionFixture {
  const target = createTarget('/workspace/src/WatchdogTarget.tsx');
  const panel = new WatchdogPanel();
  const releaseArtifact = vi.fn(() => Promise.resolve());
  const buildPreview: PreviewBuildService = {
    execute: vi.fn(() => Promise.resolve(createPreparedPreview(target, contentHash))),
    releaseArtifact,
  };
  const session = new PreviewPanelSession({
    buildPreview,
    callbacks: {
      onDidDispose: vi.fn(),
      onDidFocus: vi.fn(),
    },
    initialTarget: target,
    log: {
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    } as unknown as vscode.LogOutputChannel,
    panel: panel as unknown as vscode.WebviewPanel,
    renderMode: 'component',
    resolveTarget: vi.fn(() => Promise.resolve(target)),
  });
  return { panel, releaseArtifact, session };
}

/** Creates one immutable source target pinned to the watchdog panel. */
function createTarget(documentPath: string): ResolvedPreviewTarget {
  return {
    documentName: path.relative('/workspace', documentPath),
    documentUri: vscode.Uri.file(documentPath),
    request: {
      dependencySnapshots: [],
      documentPath,
      language: 'tsx',
      sourceText: 'export default function WatchdogTarget() { return null; }',
      workspaceRoot: '/workspace',
    },
  };
}

/** Creates a browser artifact with no dependency directories or optional stylesheet. */
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

/** Allows the immediate async build and commit chain to reach full-document assignment. */
async function settleSessionBuild(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve();
  }
}
