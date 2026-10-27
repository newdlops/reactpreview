/**
 * Verifies that Inspector tree selections are correlated with the React runtime actually displayed
 * by a panel, rather than the newest build revision merely scheduled or prepared in the extension
 * host. These integration tests exercise the real panel-session message router and hot-reload
 * acknowledgement boundary while replacing only the leaf decoration renderer with an observer.
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

/** Selection observations retained by the mocked leaf decoration service. */
interface SourceSelectionObservation {
  readonly accepted: boolean;
  readonly displayedRevision: number;
  readonly requestRevision: number;
}

/** Shared mock state is hoisted so the replacement class is available before session evaluation. */
const decorationState = vi.hoisted(() => ({
  applyVisibleEditors: vi.fn(),
  dispose: vi.fn(),
  invalidateDocument: vi.fn(),
  observations: [] as SourceSelectionObservation[],
}));

vi.mock('../../src/presentation/previewInspectorSourceDecoration', () => ({
  /** Observes the revision contract while leaving authorization unit tests to the real service. */
  PreviewInspectorSourceDecoration: class {
    public readonly applyVisibleEditors = decorationState.applyVisibleEditors;
    public readonly dispose = decorationState.dispose;
    public readonly invalidateDocument = decorationState.invalidateDocument;

    /** Records whether the session supplied the same displayed revision as the browser request. */
    public select(
      request: { readonly runtimeRevision: number },
      context: { readonly currentRuntimeRevision: number },
    ): void {
      decorationState.observations.push({
        accepted: request.runtimeRevision === context.currentRuntimeRevision,
        displayedRevision: context.currentRuntimeRevision,
        requestRevision: request.runtimeRevision,
      });
    }
  },
}));

vi.mock('../../src/presentation/previewFirstPaint', () => ({
  /**
   * Keeps this suite focused on panel revision ownership. Full-context enrichment has independent
   * coverage and would otherwise schedule a second build after each runtime acknowledgement.
   */
  preparePreviewFirstPaint: async (options: {
    readonly buildPreview: Pick<PreviewBuildService, 'execute'>;
    readonly context: Parameters<PreviewBuildService['execute']>[1];
    readonly request: Parameters<PreviewBuildService['execute']>[0];
  }) => ({
    preparedPreview: await options.buildPreview.execute(options.request, options.context),
    requiresContextEnrichment: false,
  }),
}));

vi.mock('vscode', () => {
  /** Immutable file URI sufficient for panel target and artifact conversion. */
  class FakeUri {
    public readonly authority = '';

    /** Retains filesystem identity and provider scheme without consulting the host. */
    public constructor(
      public readonly fsPath: string,
      public readonly scheme = 'file',
    ) {}

    /** URI path used by directory watcher construction. */
    public get path(): string {
      return this.fsPath;
    }

    /** Creates one local file URI. */
    public static file(filePath: string): FakeUri {
      return new FakeUri(filePath);
    }

    /** Parses a serialized artifact URI. */
    public static parse(value: string): FakeUri {
      return new FakeUri(value.replace(/^file:\/\//u, ''));
    }

    /** Preserves provider identity while replacing a selected path. */
    public with(change: { readonly path?: string }): FakeUri {
      return new FakeUri(change.path ?? this.fsPath, this.scheme);
    }

    /** Serializes a stable local resource URI for generated preview HTML. */
    public toString(): string {
      return `file://${this.fsPath}`;
    }
  }

  /** Stores watcher arguments without interpreting filesystem globs. */
  class FakeRelativePattern {
    /** Retains the base URI and glob for API compatibility. */
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

/** Mutable webview panel that exposes browser messages without automatically settling revisions. */
class RevisionPanel {
  public active = false;
  public deliverMessages = true;
  public title = 'React Preview';
  private readonly disposeListeners: (() => void)[] = [];
  private readonly messageListeners: ((message: unknown) => void)[] = [];
  private readonly viewStateListeners: (() => void)[] = [];
  public readonly hotReloadMessages: Record<string, unknown>[] = [];

  /** Minimal webview surface consumed by the real panel session. */
  public readonly webview = {
    asWebviewUri: (uri: vscode.Uri): vscode.Uri => uri,
    cspSource: 'vscode-webview://source-revision-test',
    html: '',
    onDidReceiveMessage: (listener: (message: unknown) => void): vscode.Disposable =>
      this.register(this.messageListeners, listener),
    postMessage: vi.fn((message: unknown) => {
      if ((message as { readonly type?: unknown } | null)?.type === 'react-preview-hot-reload') {
        this.hotReloadMessages.push(message as Record<string, unknown>);
      }
      return Promise.resolve(this.deliverMessages);
    }),
  };

  /** Registers a panel-disposal callback. */
  public onDidDispose(listener: () => void): vscode.Disposable {
    return this.register(this.disposeListeners, listener);
  }

  /** Registers a panel focus-state callback. */
  public onDidChangeViewState(listener: () => void): vscode.Disposable {
    return this.register(this.viewStateListeners, listener);
  }

  /** Delivers one browser-originated protocol value to the session. */
  public emitMessage(message: unknown): void {
    for (const listener of [...this.messageListeners]) listener(message);
  }

  /** Emits user-driven closure to registered listeners. */
  public dispose(): void {
    for (const listener of [...this.disposeListeners]) listener();
  }

  /** Adds one listener and returns an idempotent removal handle. */
  private register<Value>(listeners: Value[], listener: Value): vscode.Disposable {
    listeners.push(listener);
    return {
      dispose: (): void => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
    };
  }
}

afterEach(() => {
  vi.clearAllMocks();
  decorationState.observations.length = 0;
});

describe('PreviewPanelSession displayed Inspector revision', () => {
  it('retains failed execution admissions while allowing an untried replacement', async () => {
    const execute = vi
      .fn<PreviewBuildService['execute']>()
      .mockResolvedValueOnce(createExecutionPreparedPreview(1, 'cold'))
      .mockRejectedValueOnce(new Error('Execution preparation failed'))
      .mockResolvedValueOnce(createExecutionPreparedPreview(3, 'cold'));
    const fixture = createFixture(execute);
    try {
      await startReadyInitialRuntime(fixture, 'execution-1');
      const retainedHtml = fixture.panel.webview.html;
      fixture.panel.emitMessage(createExecutionRetryMessage(1, 'slice-b'));
      await settleAsyncWork();
      expect(execute).toHaveBeenCalledTimes(2);
      expect(fixture.panel.webview.html).toBe(retainedHtml);

      fixture.panel.emitMessage({
        ...createExecutionRetryMessage(1, 'slice-b'),
        interactionId: 'execution:1:2',
      });
      await settleAsyncWork();
      expect(execute).toHaveBeenCalledTimes(2);
      fixture.panel.emitMessage({
        ...createExecutionRetryMessage(1, 'slice-c'),
        interactionId: 'execution:1:3',
      });
      await settleAsyncWork();
      expect(execute).toHaveBeenCalledTimes(3);
      expect(execute.mock.calls[2]?.[0].inspectorPageExecutionCandidateId).toBe('slice-c');
    } finally {
      fixture.session.dispose();
    }
  });

  it.each(['cold', 'hot'] as const)(
    'stops repeated execution requests across %s browser replacements',
    async (mode) => {
      let buildCount = 0;
      const execute = vi.fn<PreviewBuildService['execute']>(() =>
        Promise.resolve(createExecutionPreparedPreview(++buildCount, mode)),
      );
      const fixture = createFixture(execute);
      try {
        await startReadyInitialRuntime(fixture, 'execution-1');
        const initialHtml = fixture.panel.webview.html;
        for (const [index, executionCandidateId] of ['slice-b', 'slice-a'].entries()) {
          fixture.panel.emitMessage(createExecutionRetryMessage(index + 1, executionCandidateId));
          await settleAsyncWork();
          acknowledgeExecutionRuntime(fixture.panel, index + 2, mode);
        }
        expect(execute).toHaveBeenCalledTimes(3);
        expect(fixture.panel.hotReloadMessages).toHaveLength(mode === 'cold' ? 0 : 2);
        expect(fixture.panel.webview.html === initialHtml).toBe(mode === 'hot');

        // Each new webview can forget its entire browser ledger and emit fresh interaction ids.
        for (let sequence = 0; sequence < 10; sequence += 1) {
          fixture.panel.emitMessage({
            ...createExecutionRetryMessage(3, 'slice-b'),
            interactionId: `execution:3:${String(sequence + 10)}`,
          });
          await settleAsyncWork();
        }
        expect(execute).toHaveBeenCalledTimes(3);
        expect(fixture.panel.webview.postMessage).toHaveBeenLastCalledWith(
          expect.objectContaining({ status: 'failed', reason: 'already-active' }),
        );
      } finally {
        fixture.session.dispose();
      }
    },
  );

  it.each(['manual', 'document', 'configuration'] as const)(
    'permits recovery again after a %s refresh, not an automatic execution build',
    async (refresh) => {
      vi.useFakeTimers();
      let buildCount = 0;
      const execute = vi.fn<PreviewBuildService['execute']>(() =>
        Promise.resolve(createExecutionPreparedPreview(++buildCount, 'cold')),
      );
      const fixture = createFixture(execute);
      try {
        await startReadyInitialRuntime(fixture, 'execution-1');
        for (const [index, executionCandidateId] of ['slice-b', 'slice-a'].entries()) {
          fixture.panel.emitMessage(createExecutionRetryMessage(index + 1, executionCandidateId));
          await settleAsyncWork();
          acknowledgeExecutionRuntime(fixture.panel, index + 2, 'cold');
        }
        fixture.panel.emitMessage(createExecutionRetryMessage(3, 'slice-b'));
        await settleAsyncWork();
        expect(execute).toHaveBeenCalledTimes(3);

        if (refresh === 'manual') fixture.session.refresh();
        else if (refresh === 'document')
          expect(fixture.session.refreshForDocument('/workspace/src/SelectedCard.tsx')).toBe(true);
        else fixture.session.refreshForConfiguration();
        await vi.advanceTimersByTimeAsync(300);
        await settleAsyncWork();
        acknowledgeExecutionRuntime(fixture.panel, 4, 'cold');
        fixture.panel.emitMessage(createExecutionRetryMessage(4, 'slice-b'));
        await settleAsyncWork();

        expect(execute).toHaveBeenCalledTimes(5);
        expect(execute.mock.calls[4]?.[0].inspectorPageExecutionCandidateId).toBe('slice-b');
      } finally {
        fixture.session.dispose();
        vi.useRealTimers();
      }
    },
  );

  /** Initial document ownership is available immediately to selections from its embedded runtime. */
  it('accepts the initial displayed revision', async () => {
    const fixture = createFixture(vi.fn(() => Promise.resolve(createPreparedPreview('initial'))));

    fixture.session.start();
    await settleAsyncWork();
    fixture.panel.emitMessage(createSelectionMessage(1, 1));

    expect(decorationState.observations).toEqual([
      { accepted: true, displayedRevision: 1, requestRevision: 1 },
    ]);
    fixture.session.dispose();
  });

  /** A scheduled and then prepared replacement must not supersede the tree still mounted in Chromium. */
  it('keeps revision one current while revision two is building and awaiting acknowledgement', async () => {
    const replacement = createDeferred<PreparedPreview>();
    const execute = vi
      .fn<PreviewBuildService['execute']>()
      .mockResolvedValueOnce(createPreparedPreview('old'))
      .mockReturnValueOnce(replacement.promise);
    const fixture = createFixture(execute);
    await startReadyInitialRuntime(fixture, 'old');

    fixture.session.refresh();
    await settleAsyncWork();
    fixture.panel.emitMessage(createSelectionMessage(1, 1));
    fixture.panel.emitMessage(createSelectionMessage(2, 2));

    replacement.resolve(createPreparedPreview('new'));
    await settleAsyncWork();
    expect(fixture.panel.hotReloadMessages).toHaveLength(1);
    fixture.panel.emitMessage(createSelectionMessage(1, 3));

    expect(decorationState.observations).toEqual([
      { accepted: true, displayedRevision: 1, requestRevision: 1 },
      { accepted: false, displayedRevision: 1, requestRevision: 2 },
      { accepted: true, displayedRevision: 1, requestRevision: 1 },
    ]);
    fixture.session.dispose();
  });

  /** Only an applied hot-reload acknowledgement transfers source-selection ownership to revision two. */
  it('accepts revision two and rejects revision one after the browser applies the hot reload', async () => {
    const fixture = createFixture(
      vi
        .fn<PreviewBuildService['execute']>()
        .mockResolvedValueOnce(createPreparedPreview('old'))
        .mockResolvedValueOnce(createPreparedPreview('new')),
    );
    await startReadyInitialRuntime(fixture, 'old');
    fixture.session.refresh();
    await settleAsyncWork();

    fixture.panel.emitMessage(createHotReloadAcknowledgement(fixture.panel, true));
    fixture.panel.emitMessage(createSelectionMessage(2, 1));
    fixture.panel.emitMessage(createSelectionMessage(1, 2));

    expect(decorationState.observations).toEqual([
      { accepted: true, displayedRevision: 2, requestRevision: 2 },
      { accepted: false, displayedRevision: 2, requestRevision: 1 },
    ]);
    fixture.session.dispose();
  });

  /** A retained replacement failure leaves the preceding browser tree authoritative. */
  it('keeps revision one after a retained hot-reload failure', async () => {
    const fixture = createFixture(
      vi
        .fn<PreviewBuildService['execute']>()
        .mockResolvedValueOnce(createPreparedPreview('old'))
        .mockResolvedValueOnce(createPreparedPreview('rejected')),
    );
    await startReadyInitialRuntime(fixture, 'old');
    fixture.session.refresh();
    await settleAsyncWork();

    fixture.panel.emitMessage(createHotReloadAcknowledgement(fixture.panel, false));
    fixture.panel.emitMessage(createSelectionMessage(1, 1));
    fixture.panel.emitMessage(createSelectionMessage(2, 2));

    expect(decorationState.observations).toEqual([
      { accepted: true, displayedRevision: 1, requestRevision: 1 },
      { accepted: false, displayedRevision: 1, requestRevision: 2 },
    ]);
    fixture.session.dispose();
  });

  it('does not start selected-context enrichment after a retained route replacement', async () => {
    const execute = vi
      .fn<PreviewBuildService['execute']>()
      .mockResolvedValueOnce(createPreparedPreview('old'))
      .mockResolvedValueOnce(createPreparedPreview('selected-route'));
    const fixture = createFixture(execute);
    await startReadyInitialRuntime(fixture, 'old');

    fixture.panel.emitMessage({
      branchId: 'route-0123456789abcdef0123',
      interactionId: 'route:1:retained',
      runtimeRevision: 1,
      selectionPath: [{ componentName: 'SettingsPage', pattern: '/settings' }],
      type: 'react-preview-inspector-route-selected',
    });
    await settleAsyncWork();
    expect(fixture.panel.hotReloadMessages).toHaveLength(1);

    fixture.panel.emitMessage(createHotReloadAcknowledgement(fixture.panel, false));
    await settleAsyncWork();

    expect(execute).toHaveBeenCalledTimes(2);
    fixture.session.dispose();
  });

  /** A new input frontier must reach the browser even when compilation emits identical bytes. */
  it('refreshes a same-hash page context while retaining the displayed revision until acknowledgement', async () => {
    const fixture = createFixture(
      vi.fn<PreviewBuildService['execute']>(() =>
        Promise.resolve(createPreparedPreview('unchanged')),
      ),
    );
    await startReadyInitialRuntime(fixture, 'unchanged');
    const previousFrontier = /data-react-preview-page-context-frontier-id="([^"]+)"/u.exec(
      fixture.panel.webview.html,
    )?.[1];
    expect(previousFrontier).toBeTruthy();
    fixture.session.refresh();
    await settleAsyncWork();

    expect(fixture.panel.hotReloadMessages).toHaveLength(1);
    expect(fixture.panel.hotReloadMessages[0]?.pageContextFrontierId).toEqual(expect.any(String));
    expect(fixture.panel.hotReloadMessages[0]?.pageContextFrontierId).not.toBe(previousFrontier);
    expect(fixture.releaseArtifact).not.toHaveBeenCalled();
    fixture.panel.emitMessage(createSelectionMessage(1, 1));
    fixture.panel.emitMessage(createSelectionMessage(2, 2));
    fixture.panel.emitMessage(createHotReloadAcknowledgement(fixture.panel, true));
    fixture.panel.emitMessage(createSelectionMessage(2, 3));
    expect(fixture.releaseArtifact).toHaveBeenCalledExactlyOnceWith('unchanged');

    expect(decorationState.observations).toEqual([
      { accepted: true, displayedRevision: 1, requestRevision: 1 },
      { accepted: false, displayedRevision: 1, requestRevision: 2 },
      { accepted: true, displayedRevision: 2, requestRevision: 2 },
    ]);
    fixture.session.dispose();
    expect(fixture.releaseArtifact).toHaveBeenCalledTimes(2);
  });

  /** Carries a current browser route choice into only this pinned panel's next immutable request. */
  it('rebuilds the selected hierarchical application path', async () => {
    const execute = vi
      .fn<PreviewBuildService['execute']>()
      .mockResolvedValueOnce(createPreparedPreview('root-route'))
      .mockResolvedValueOnce(createPreparedPreview('selected-route'));
    const fixture = createFixture(execute);
    await startReadyInitialRuntime(fixture, 'root-route');
    const selectionPath = [
      { componentName: 'FeatureApp', pattern: '/feature/*' },
      { componentName: 'SettingsPage', pattern: '/feature/settings' },
    ];

    fixture.panel.emitMessage({
      branchId: 'route-0123456789abcdef0123',
      interactionId: 'route:1:1',
      runtimeRevision: 1,
      selectionPath,
      type: 'react-preview-inspector-route-selected',
    });
    await settleAsyncWork();

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1]?.[0]).toMatchObject({
      inspectorRouteSelection: selectionPath,
      inspectorTargetMode: 'selected-route-leaf',
    });
    fixture.session.dispose();
  });
});

/** Observable collaborators returned for one real panel-session fixture. */
interface RevisionFixture {
  readonly panel: RevisionPanel;
  readonly releaseArtifact: ReturnType<typeof vi.fn>;
  readonly session: PreviewPanelSession;
}

/** Creates one Page Inspector session with a caller-controlled sequence of prepared artifacts. */
function createFixture(execute: ReturnType<typeof vi.fn>): RevisionFixture {
  const target = createTarget('/workspace/src/SelectedCard.tsx');
  const panel = new RevisionPanel();
  const releaseArtifact = vi.fn(() => Promise.resolve());
  const session = new PreviewPanelSession({
    buildPreview: {
      execute: execute as PreviewBuildService['execute'],
      releaseArtifact,
    },
    callbacks: { onDidDispose: vi.fn(), onDidFocus: vi.fn() },
    initialTarget: target,
    log: { debug: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as vscode.LogOutputChannel,
    panel: panel as unknown as vscode.WebviewPanel,
    renderMode: 'page-inspector',
    resolveTarget: vi.fn(() => Promise.resolve(target)),
  });
  return { panel, releaseArtifact, session };
}

/** Creates one immutable source target used by every revision in this suite. */
function createTarget(documentPath: string): ResolvedPreviewTarget {
  return {
    documentName: path.relative('/workspace', documentPath),
    documentUri: vscode.Uri.file(documentPath),
    request: {
      dependencySnapshots: [],
      documentPath,
      language: 'tsx',
      sourceText: 'export default function SelectedCard() { return <div />; }',
      workspaceRoot: '/workspace',
    },
  };
}

/** Creates one published artifact whose hash determines the hot-reload branch. */
function createPreparedPreview(contentHash: string): PreparedPreview {
  return {
    artifact: {
      contentHash,
      scriptLocation: `file:///artifacts/${contentHash}/entry.js`,
    },
    dependencies: ['/workspace/src/SelectedCard.tsx'],
    diagnostics: [],
    watchDirectories: [],
  };
}

/** Forces a real document navigation when an execution changes its browser import map. */
function createExecutionPreparedPreview(revision: number, mode: 'cold' | 'hot'): PreparedPreview {
  const prepared = createPreparedPreview(`execution-${String(revision)}`);
  return mode === 'hot'
    ? prepared
    : {
        ...prepared,
        artifact: {
          ...prepared.artifact,
          moduleImports: [
            { specifier: 'react', scriptLocation: `file:///react-${String(revision)}.js` },
          ],
        },
      };
}

/** Simulates a fresh runtime that requests an alternative with no previous browser history. */
function createExecutionRetryMessage(
  runtimeRevision: number,
  executionCandidateId: string,
): Record<string, unknown> {
  return {
    candidateId: 'page-auto',
    executionCandidateId,
    interactionId: `execution:${String(runtimeRevision)}:1`,
    runtimeRevision,
    type: 'react-preview-inspector-page-execution-retry',
  };
}

/** Settles the exact application handle owned by a cold document or hot module replacement. */
function acknowledgeExecutionRuntime(
  panel: RevisionPanel,
  revision: number,
  mode: 'cold' | 'hot',
): void {
  const pending = panel.hotReloadMessages.at(-1);
  panel.emitMessage(
    mode === 'cold'
      ? {
          revision,
          token: `${String(revision)}:execution-${String(revision)}`,
          type: 'react-preview-runtime-ready',
        }
      : {
          applied: true,
          retainedPrevious: false,
          revision: pending?.revision,
          token: pending?.token,
          type: 'react-preview-hot-reload-ready',
        },
  );
}

/** Creates a syntactically valid component-tree selection for one browser runtime revision. */
function createSelectionMessage(
  runtimeRevision: number,
  sequence: number,
): Record<string, unknown> {
  return {
    line: 1,
    runtimeRevision,
    sequence,
    sourcePath: '/workspace/src/SelectedCard.tsx',
    type: 'react-preview-inspector-source-selected',
  };
}

/** Settles the initial document before a hot replacement so only one browser revision is pending. */
async function startReadyInitialRuntime(
  fixture: RevisionFixture,
  contentHash: string,
): Promise<void> {
  fixture.session.start();
  await settleAsyncWork();
  fixture.panel.emitMessage({
    revision: 1,
    token: `1:${contentHash}`,
    type: 'react-preview-runtime-ready',
  });
}

/** Creates an exact ready or retained-failure acknowledgement for the sole pending hot request. */
function createHotReloadAcknowledgement(
  panel: RevisionPanel,
  applied: boolean,
): Record<string, unknown> {
  const message = panel.hotReloadMessages[0];
  return {
    applied,
    retainedPrevious: !applied,
    revision: message?.revision,
    token: message?.token,
    type: applied ? 'react-preview-hot-reload-ready' : 'react-preview-hot-reload-failed',
  };
}

/** Mutable promise control used to keep one requested build deterministically pending. */
interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}

/** Creates a promise whose completion remains under the test body's control. */
function createDeferred<Value>(): Deferred<Value> {
  let resolvePromise: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value: Value): void => resolvePromise?.(value),
  };
}

/** Allows target resolution, build publication, commit, and message microtasks to settle. */
async function settleAsyncWork(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}
