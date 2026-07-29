/* eslint-disable @typescript-eslint/unbound-method */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type { BuildPreview } from '../../src/application/buildPreview';
import type {
  PreviewTargetIssue,
  ResolvedPreviewTarget,
} from '../../src/presentation/activePreviewTarget';
import { PreviewController } from '../../src/presentation/previewController';
import { createPreviewControllerTestWorkspaceState } from './previewControllerTestWorkspaceState';

/** Observable subset of a controller-owned session used by precedence assertions. */
interface ObservedSession {
  readonly documentUri: unknown;
  readonly dispose: () => void;
  isActive: boolean;
  readonly start: ReturnType<typeof vi.fn>;
}

/** Shared observations for the controller's real page-context command boundary. */
const state = vi.hoisted(() => ({
  activeEditor: undefined as { readonly document: unknown } | undefined,
  panels: [] as FakePanel[],
  sessions: [] as ObservedSession[],
  warnings: [] as string[],
  active: vi.fn(),
  constructed: vi.fn(),
  openTextDocument: vi.fn(),
  pinned: vi.fn(),
  preview: vi.fn(),
  showTextDocument: vi.fn(),
  workspace: vi.fn(),
  picker: vi.fn(),
}));

vi.mock('../../src/presentation/activePreviewTarget', () => ({
  resolveActivePreviewTarget: state.active,
  resolvePinnedPreviewTarget: state.pinned,
  resolvePreviewTarget: state.preview,
  resolveWorkspacePreviewTarget: state.workspace,
}));

vi.mock('../../src/presentation/previewInspectorCompanionPanel', () => ({
  PreviewInspectorCompanionPanel: { attach: vi.fn() },
}));

vi.mock('../../src/presentation/previewPanelSession', () => ({
  /** Narrow session substitute that records controller lifecycle calls without building. */
  PreviewPanelSession: class FakeSession {
    /** Immutable URI captured from the controller's resolved target. */
    public readonly documentUri: unknown;
    /** Immutable path captured from the controller's resolved target. */
    public readonly targetPath: string;
    /** Mutable active state selected by retained-session tests. */
    public isActive = false;
    /** Records ordinary focused-session refreshes. */
    public readonly refresh = vi.fn();
    /** Records configuration refreshes routed by the controller. */
    public readonly refreshForConfiguration = vi.fn();
    /** Records document refreshes routed by the controller. */
    public readonly refreshForDocument = vi.fn(() => false);
    /** Records source-decoration refreshes routed by the controller. */
    public readonly refreshInspectorSourceDecoration = vi.fn();
    /** Records initial page-preview scheduling. */
    public readonly start = vi.fn();
    /** Placeholder companion navigation callback retained by the controller contract. */
    public readonly openInspectorCompanionSource = vi.fn();
    /** Prevents duplicate controller disposal callbacks. */
    private disposed = false;

    /** Captures session options and registers the owning panel-disposal callback. */
    public constructor(
      private readonly options: {
        readonly callbacks: { readonly onDidDispose: (session: FakeSession) => void };
        readonly initialTarget: ResolvedPreviewTarget;
        readonly panel: FakePanel;
      },
    ) {
      this.documentUri = options.initialTarget.documentUri;
      this.targetPath = options.initialTarget.request.documentPath;
      options.panel.onDidDispose(() => {
        this.dispose();
      });
      state.constructed(this);
      state.sessions.push(this);
    }

    /** Removes this session from the real controller exactly once. */
    public dispose(): void {
      if (this.disposed) return;
      this.disposed = true;
      this.options.callbacks.onDidDispose(this);
    }

    /** Reports whether a refresh target is this immutable session source. */
    public targetsDocument(documentPath: string): boolean {
      return documentPath === this.targetPath;
    }
  },
}));

vi.mock('vscode', () => {
  /** URI surface preserving file and remote identity for workspace-target tests. */
  class FakeUri {
    /** Creates one URI from its filesystem path, scheme, and authority. */
    public constructor(
      public readonly fsPath: string,
      public readonly scheme = 'file',
      public readonly authority = '',
    ) {}

    /** Creates a file URI. */
    public static file(filePath: string): FakeUri {
      return new FakeUri(filePath);
    }

    /** Parses a serialized URI while retaining remote authority. */
    public static parse(value: string): FakeUri {
      const parsed = new URL(value);
      return new FakeUri(parsed.pathname, parsed.protocol.slice(0, -1), parsed.host);
    }

    /** Serializes this URI for durable state assertions. */
    public toString(): string {
      return this.scheme === 'file'
        ? `file://${this.fsPath}`
        : `${this.scheme}://${this.authority}${this.fsPath}`;
    }
  }
  return {
    Uri: FakeUri,
    ViewColumn: { Beside: 2 },
    workspace: {
      openTextDocument: state.openTextDocument,
      onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
      onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    },
    window: {
      get activeTextEditor(): { readonly document: unknown } | undefined {
        return state.activeEditor;
      },
      createWebviewPanel: vi.fn(() => {
        const panel = new FakePanel();
        state.panels.push(panel);
        return panel;
      }),
      onDidChangeVisibleTextEditors: vi.fn(() => ({ dispose: vi.fn() })),
      showOpenDialog: state.picker,
      showTextDocument: state.showTextDocument,
      showWarningMessage: vi.fn((message: string) => {
        state.warnings.push(message);
        return Promise.resolve(undefined);
      }),
    },
  };
});

/** Small panel surface used only by the mocked session constructor. */
class FakePanel {
  public title = 'React Preview';
  private readonly disposeListeners: (() => void)[] = [];

  /** Registers one session-owned panel disposal listener. */
  public onDidDispose(listener: () => void): vscode.Disposable {
    this.disposeListeners.push(listener);
    return { dispose: vi.fn() };
  }
}

/** Creates a target whose immutable URI is observable through the controller. */
function target(path: string): ResolvedPreviewTarget {
  return targetForUri(vscode.Uri.file(path), path);
}

/** Creates a target that keeps its supplied serialized URI identity intact. */
function targetForUri(documentUri: vscode.Uri, documentPath: string): ResolvedPreviewTarget {
  return {
    documentUri,
    request: { documentPath },
  } as unknown as ResolvedPreviewTarget;
}

/** Creates the controller with a deliberately isolated empty workspace-state fake. */
function controller(
  workspaceState = createPreviewControllerTestWorkspaceState(),
): PreviewController {
  return new PreviewController(
    { execute: vi.fn(), releaseArtifact: vi.fn() } as unknown as BuildPreview,
    vscode.Uri.file('/artifacts'),
    { debug: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as vscode.LogOutputChannel,
    workspaceState,
  );
}

/** Opens one component session to establish a real controller-owned retained session. */
async function openRetainedSession(
  instance: PreviewController,
  path: string,
): Promise<ObservedSession> {
  state.active.mockReturnValueOnce(target(path));
  await instance.open('component');
  const session = state.sessions.at(-1);
  if (session === undefined)
    throw new Error('Expected component open to create a retained session.');
  return session;
}

afterEach(() => {
  vi.clearAllMocks();
  state.activeEditor = undefined;
  state.panels.length = 0;
  state.sessions.length = 0;
  state.warnings.length = 0;
});

describe('PreviewController page-context target selection', () => {
  it('uses a valid active editor without consulting lower-priority sources', async () => {
    const workspaceState = createPreviewControllerTestWorkspaceState();
    const selected = target('/workspace/Active.tsx');
    state.activeEditor = { document: { uri: selected.documentUri } };
    state.preview.mockReturnValueOnce(selected);
    const instance = controller(workspaceState);

    await instance.open('page-inspector');

    expect(state.preview).toHaveBeenCalledOnce();
    expect(state.pinned).not.toHaveBeenCalled();
    expect(state.workspace).not.toHaveBeenCalled();
    expect(state.picker).not.toHaveBeenCalled();
    expect(workspaceState.get).not.toHaveBeenCalled();
    expect(workspaceState.update).toHaveBeenCalledOnce();
    expect(workspaceState.update).toHaveBeenCalledWith('reactPreview.pageContextTarget', {
      uri: 'file:///workspace/Active.tsx',
      version: 1,
    });
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]?.start).toHaveBeenCalledOnce();
    expect(state.warnings).toHaveLength(0);
  });

  it('surfaces an invalid active editor without falling through', async () => {
    const issue: PreviewTargetIssue = { title: 'Unsupported file', message: 'Choose a TSX file.' };
    const workspaceState = createPreviewControllerTestWorkspaceState();
    state.activeEditor = { document: {} };
    state.preview.mockReturnValueOnce(issue);
    const instance = controller(workspaceState);

    await instance.open('page-inspector');

    expect(state.preview).toHaveBeenCalledOnce();
    expect(state.pinned).not.toHaveBeenCalled();
    expect(state.workspace).not.toHaveBeenCalled();
    expect(state.picker).not.toHaveBeenCalled();
    expect(workspaceState.get).not.toHaveBeenCalled();
    expect(workspaceState.update).not.toHaveBeenCalled();
    expect(state.sessions).toHaveLength(0);
    expect(state.warnings).toEqual(['Unsupported file: Choose a TSX file.']);
  });

  it('uses an active retained session before last focus, durable state, or picker', async () => {
    const workspaceState = createPreviewControllerTestWorkspaceState();
    const instance = controller(workspaceState);
    const retained = await openRetainedSession(instance, '/workspace/Retained.tsx');
    retained.isActive = true;
    state.pinned.mockResolvedValueOnce(target('/workspace/Retained.tsx'));

    await instance.open('page-inspector');

    expect(state.pinned).toHaveBeenCalledOnce();
    expect(state.pinned).toHaveBeenCalledWith(retained.documentUri);
    expect(state.workspace).not.toHaveBeenCalled();
    expect(state.picker).not.toHaveBeenCalled();
    expect(workspaceState.get).not.toHaveBeenCalled();
    expect(workspaceState.update).toHaveBeenCalledOnce();
    expect(state.sessions).toHaveLength(2);
    expect(state.sessions[1]?.start).toHaveBeenCalledOnce();
    expect(state.warnings).toHaveLength(0);
  });

  it('surfaces an invalid active retained session without fallback', async () => {
    const issue: PreviewTargetIssue = { title: 'Unavailable', message: 'The source moved.' };
    const workspaceState = createPreviewControllerTestWorkspaceState();
    const instance = controller(workspaceState);
    const retained = await openRetainedSession(instance, '/workspace/Retained.tsx');
    retained.isActive = true;
    state.pinned.mockResolvedValueOnce(issue);

    await instance.open('page-inspector');

    expect(state.pinned).toHaveBeenCalledOnce();
    expect(state.workspace).not.toHaveBeenCalled();
    expect(state.picker).not.toHaveBeenCalled();
    expect(workspaceState.get).not.toHaveBeenCalled();
    expect(workspaceState.update).not.toHaveBeenCalled();
    expect(state.sessions).toHaveLength(1);
    expect(state.warnings).toEqual(['Unavailable: The source moved.']);
  });

  it('uses a still-live last-focused session when none is active', async () => {
    const workspaceState = createPreviewControllerTestWorkspaceState();
    const instance = controller(workspaceState);
    const retained = await openRetainedSession(instance, '/workspace/LastFocused.tsx');
    state.pinned.mockResolvedValueOnce(target('/workspace/LastFocused.tsx'));

    await instance.open('page-inspector');

    expect(retained.isActive).toBe(false);
    expect(state.pinned).toHaveBeenCalledOnce();
    expect(state.pinned).toHaveBeenCalledWith(retained.documentUri);
    expect(state.workspace).not.toHaveBeenCalled();
    expect(state.picker).not.toHaveBeenCalled();
    expect(workspaceState.get).not.toHaveBeenCalled();
    expect(workspaceState.update).toHaveBeenCalledOnce();
    expect(state.sessions).toHaveLength(2);
    expect(state.sessions[1]?.start).toHaveBeenCalledOnce();
  });

  it('ignores a disposed last-focused session and attempts durable selection', async () => {
    const durable = { uri: 'file:///workspace/Durable.tsx', version: 1 };
    const workspaceState = createPreviewControllerTestWorkspaceState(durable);
    const instance = controller(workspaceState);
    const retained = await openRetainedSession(instance, '/workspace/Disposed.tsx');
    retained.dispose();
    state.workspace.mockResolvedValueOnce(target('/workspace/Durable.tsx'));

    await instance.open('page-inspector');

    expect(state.pinned).not.toHaveBeenCalled();
    expect(workspaceState.get).toHaveBeenCalledOnce();
    expect(state.workspace).toHaveBeenCalledOnce();
    expect(state.workspace).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: '/workspace/Durable.tsx' }),
    );
    expect(state.picker).not.toHaveBeenCalled();
    expect(workspaceState.update).toHaveBeenCalledOnce();
    expect(state.sessions).toHaveLength(2);
    expect(state.sessions[1]?.start).toHaveBeenCalledOnce();
    expect(state.warnings).toHaveLength(0);
  });

  it('revalidates a valid durable file URI, rewrites it, and bypasses the picker', async () => {
    const durable = { uri: 'file:///workspace/Durable.tsx', version: 1 };
    const workspaceState = createPreviewControllerTestWorkspaceState(durable);
    state.workspace.mockResolvedValueOnce(target('/workspace/Durable.tsx'));
    const instance = controller(workspaceState);

    await instance.open('page-inspector');

    expect(state.preview).not.toHaveBeenCalled();
    expect(state.pinned).not.toHaveBeenCalled();
    expect(workspaceState.get).toHaveBeenCalledOnce();
    expect(state.workspace).toHaveBeenCalledOnce();
    expect(state.workspace).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: '/workspace/Durable.tsx' }),
    );
    expect(state.picker).not.toHaveBeenCalled();
    expect(workspaceState.update).toHaveBeenCalledWith('reactPreview.pageContextTarget', durable);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]?.start).toHaveBeenCalledOnce();
    expect(state.workspace.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(workspaceState.update).mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(vi.mocked(workspaceState.update).mock.invocationCallOrder[0]).toBeLessThan(
      state.sessions[0]?.start.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(state.warnings).toHaveLength(0);
  });

  it('preserves a valid durable vscode-remote URI scheme and authority on rewrite', async () => {
    const durable = { uri: 'vscode-remote://ssh-remote%2Bhost/workspace/Remote.tsx', version: 1 };
    const workspaceState = createPreviewControllerTestWorkspaceState(durable);
    const remoteUri = vscode.Uri.parse(durable.uri, true);
    state.workspace.mockResolvedValueOnce(targetForUri(remoteUri, '/workspace/Remote.tsx'));
    const instance = controller(workspaceState);

    await instance.open('page-inspector');

    expect(state.workspace).toHaveBeenCalledWith(
      expect.objectContaining({ authority: 'ssh-remote%2Bhost', scheme: 'vscode-remote' }),
    );
    expect(state.picker).not.toHaveBeenCalled();
    expect(workspaceState.update).toHaveBeenCalledWith('reactPreview.pageContextTarget', durable);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]?.start).toHaveBeenCalledOnce();
    expect(state.warnings).toHaveLength(0);
  });

  it.each([
    null,
    [],
    { uri: 'file:///workspace/WrongVersion.tsx', version: 2 },
    { uri: 'file:///workspace/MissingVersion.tsx' },
    { uri: 'file:///workspace/Extra.tsx', version: 1, extra: true },
    { uri: 42, version: 1 },
    { uri: '', version: 1 },
    { uri: '%%%not-a-uri%%%', version: 1 },
  ])(
    'falls from malformed durable state %# to one valid picker selection without building it',
    async (value) => {
      const workspaceState = createPreviewControllerTestWorkspaceState(value);
      const selected = vscode.Uri.file('/workspace/Picked.tsx');
      state.picker.mockResolvedValueOnce([selected]);
      state.workspace.mockResolvedValueOnce(target('/workspace/Picked.tsx'));
      const instance = controller(workspaceState);

      await instance.open('page-inspector');

      expect(state.preview).not.toHaveBeenCalled();
      expect(state.pinned).not.toHaveBeenCalled();
      expect(workspaceState.get).toHaveBeenCalledOnce();
      expect(state.workspace).toHaveBeenCalledOnce();
      expect(state.workspace).toHaveBeenCalledWith(selected);
      expect(state.picker).toHaveBeenCalledOnce();
      expect(workspaceState.update).toHaveBeenCalledWith('reactPreview.pageContextTarget', {
        uri: 'file:///workspace/Picked.tsx',
        version: 1,
      });
      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0]?.start).toHaveBeenCalledOnce();
      expect(state.warnings).toHaveLength(0);
    },
  );

  it.each([
    'stale',
    'unsupported extension',
    'unsupported scheme',
    'outside workspace',
    'moved',
    'unavailable',
  ])(
    'does not build a %s durable target and replaces it only after a valid picker result',
    async (kind) => {
      const durable = { uri: 'file:///workspace/Old.tsx', version: 1 };
      const issue: PreviewTargetIssue = { title: kind, message: 'Durable target cannot be used.' };
      const workspaceState = createPreviewControllerTestWorkspaceState(durable);
      const selected = vscode.Uri.file('/workspace/Replacement.tsx');
      state.workspace
        .mockResolvedValueOnce(issue)
        .mockResolvedValueOnce(target('/workspace/Replacement.tsx'));
      state.picker.mockResolvedValueOnce([selected]);
      const instance = controller(workspaceState);

      await instance.open('page-inspector');

      expect(state.preview).not.toHaveBeenCalled();
      expect(state.pinned).not.toHaveBeenCalled();
      expect(workspaceState.get).toHaveBeenCalledOnce();
      expect(state.workspace).toHaveBeenCalledTimes(2);
      expect(state.workspace).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ fsPath: '/workspace/Old.tsx' }),
      );
      expect(state.picker).toHaveBeenCalledOnce();
      expect(state.workspace).toHaveBeenNthCalledWith(2, selected);
      expect(workspaceState.update).toHaveBeenCalledOnce();
      expect(workspaceState.update).toHaveBeenCalledWith('reactPreview.pageContextTarget', {
        uri: 'file:///workspace/Replacement.tsx',
        version: 1,
      });
      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0]?.start).toHaveBeenCalledOnce();
      expect(state.workspace.mock.invocationCallOrder[0]).toBeLessThan(
        state.picker.mock.invocationCallOrder[0] ?? Infinity,
      );
      expect(state.picker.mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(workspaceState.update).mock.invocationCallOrder[0] ?? Infinity,
      );
      expect(state.warnings).toHaveLength(0);
    },
  );

  it.each([undefined, []])(
    'returns silently when the native picker yields %#',
    async (selections) => {
      const workspaceState = createPreviewControllerTestWorkspaceState();
      state.picker.mockResolvedValueOnce(selections);
      const instance = controller(workspaceState);

      await instance.open('page-inspector');

      expect(state.preview).not.toHaveBeenCalled();
      expect(state.pinned).not.toHaveBeenCalled();
      expect(workspaceState.get).toHaveBeenCalledOnce();
      expect(state.workspace).not.toHaveBeenCalled();
      expect(state.picker).toHaveBeenCalledOnce();
      expect(workspaceState.update).not.toHaveBeenCalled();
      expect(state.sessions).toHaveLength(0);
      expect(state.warnings).toHaveLength(0);
    },
  );

  it('surfaces the exact single-file issue for defensive multiple picker selections', async () => {
    const workspaceState = createPreviewControllerTestWorkspaceState();
    state.picker.mockResolvedValueOnce([
      vscode.Uri.file('/workspace/First.tsx'),
      vscode.Uri.file('/workspace/Second.tsx'),
    ]);
    const instance = controller(workspaceState);

    await instance.open('page-inspector');

    expect(state.preview).not.toHaveBeenCalled();
    expect(state.pinned).not.toHaveBeenCalled();
    expect(workspaceState.get).toHaveBeenCalledOnce();
    expect(state.workspace).not.toHaveBeenCalled();
    expect(state.picker).toHaveBeenCalledOnce();
    expect(workspaceState.update).not.toHaveBeenCalled();
    expect(state.sessions).toHaveLength(0);
    expect(state.warnings).toEqual([
      'Select one preview target: Choose exactly one supported source file for the page-context preview.',
    ]);
  });

  it('opens the native picker with the exact one-file page-context options', async () => {
    state.picker.mockResolvedValueOnce(undefined);
    const instance = controller();

    await instance.open('page-inspector');

    expect(state.picker).toHaveBeenCalledOnce();
    expect(state.picker).toHaveBeenCalledWith({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        'JavaScript / TypeScript': ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts'],
      },
      openLabel: 'Open in React Page Context',
    });
    expect(state.workspace).not.toHaveBeenCalled();
    expect(state.sessions).toHaveLength(0);
    expect(state.warnings).toHaveLength(0);
  });

  it.each(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts'])(
    'resolves, persists, and starts a valid %s picker selection',
    async (extension) => {
      const workspaceState = createPreviewControllerTestWorkspaceState();
      const selected = vscode.Uri.file(`/workspace/Picked.${extension}`);
      state.picker.mockResolvedValueOnce([selected]);
      state.workspace.mockResolvedValueOnce(target(`/workspace/Picked.${extension}`));
      const instance = controller(workspaceState);

      await instance.open('page-inspector');

      expect(state.preview).not.toHaveBeenCalled();
      expect(state.pinned).not.toHaveBeenCalled();
      expect(workspaceState.get).toHaveBeenCalledOnce();
      expect(state.picker).toHaveBeenCalledOnce();
      expect(state.workspace).toHaveBeenCalledOnce();
      expect(state.workspace).toHaveBeenCalledWith(selected);
      expect(workspaceState.update).toHaveBeenCalledWith('reactPreview.pageContextTarget', {
        uri: `file:///workspace/Picked.${extension}`,
        version: 1,
      });
      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0]?.start).toHaveBeenCalledOnce();
      expect(state.warnings).toHaveLength(0);
    },
  );

  it.each([
    {
      issue: {
        message: 'React Preview supports JS/JSX/TS/TSX files and their MJS/CJS/MTS/CTS variants.',
        title: 'Unsupported file type',
      },
      uri: vscode.Uri.file('/workspace/Unsupported.css'),
    },
    {
      issue: {
        message: 'Save the component in a filesystem-backed workspace before previewing it.',
        title: 'Unsupported document',
      },
      uri: vscode.Uri.parse('untitled:/workspace/Untitled.tsx', true),
    },
    {
      issue: {
        message: 'Choose a supported source file from a currently open workspace folder.',
        title: 'Preview target is outside the workspace',
      },
      uri: vscode.Uri.file('/outside/Workspace.tsx'),
    },
    {
      issue: {
        message: 'The pinned preview target could not be reopened: /workspace/Moved.tsx',
        title: 'Preview target unavailable',
      },
      uri: vscode.Uri.file('/workspace/Moved.tsx'),
    },
  ])(
    'surfaces the exact picker policy issue for $issue.title without persistence or start',
    async ({ issue, uri }) => {
      const workspaceState = createPreviewControllerTestWorkspaceState();
      state.picker.mockResolvedValueOnce([uri]);
      state.workspace.mockResolvedValueOnce(issue);
      const instance = controller(workspaceState);

      await instance.open('page-inspector');

      expect(state.preview).not.toHaveBeenCalled();
      expect(state.pinned).not.toHaveBeenCalled();
      expect(workspaceState.get).toHaveBeenCalledOnce();
      expect(state.picker).toHaveBeenCalledOnce();
      expect(state.workspace).toHaveBeenCalledOnce();
      expect(state.workspace).toHaveBeenCalledWith(uri);
      expect(workspaceState.update).not.toHaveBeenCalled();
      expect(state.sessions).toHaveLength(0);
      expect(state.warnings).toEqual([`${issue.title}: ${issue.message}`]);
    },
  );

  it('uses the workspace resolver document path without showing a text editor, then persists before start', async () => {
    const workspaceState = createPreviewControllerTestWorkspaceState();
    const selected = vscode.Uri.file('/workspace/OpenInMemory.tsx');
    state.picker.mockResolvedValueOnce([selected]);
    state.openTextDocument.mockResolvedValueOnce({});
    state.workspace.mockImplementationOnce(async (documentUri: vscode.Uri) => {
      await vscode.workspace.openTextDocument(documentUri);
      return target('/workspace/OpenInMemory.tsx');
    });
    const instance = controller(workspaceState);

    await instance.open('page-inspector');

    expect(state.workspace).toHaveBeenCalledOnce();
    expect(state.workspace).toHaveBeenCalledWith(selected);
    expect(state.openTextDocument).toHaveBeenCalledOnce();
    expect(state.openTextDocument).toHaveBeenCalledWith(selected);
    expect(state.showTextDocument).not.toHaveBeenCalled();
    expect(workspaceState.update).toHaveBeenCalledOnce();
    expect(state.constructed).toHaveBeenCalledOnce();
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]?.start).toHaveBeenCalledOnce();
    expect(state.workspace.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(workspaceState.update).mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(vi.mocked(workspaceState.update).mock.invocationCallOrder[0]).toBeLessThan(
      state.constructed.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(state.constructed.mock.invocationCallOrder[0]).toBeLessThan(
      state.sessions[0]?.start.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it('rejects a persistence failure before any panel or session is created and leaves prior state intact', async () => {
    const prior = { uri: 'file:///workspace/Prior.tsx', version: 1 };
    const cause = new Error('Memento is unavailable');
    const stored: unknown = prior;
    const workspaceState = {
      get: vi.fn(() => stored),
      update: vi.fn(() => Promise.reject(cause)),
    };
    state.workspace.mockResolvedValueOnce(target('/workspace/Prior.tsx'));
    const instance = controller(workspaceState);

    await expect(instance.open('page-inspector')).rejects.toMatchObject({
      cause,
      message:
        'React Preview could not remember the selected page-context target. No preview was opened.',
    });

    expect(workspaceState.get).toHaveBeenCalledOnce();
    expect(state.workspace).toHaveBeenCalledOnce();
    expect(state.picker).not.toHaveBeenCalled();
    expect(workspaceState.update).toHaveBeenCalledOnce();
    expect(stored).toEqual(prior);
    expect(state.constructed).not.toHaveBeenCalled();
    expect(state.panels).toHaveLength(0);
    expect(state.sessions).toHaveLength(0);
    expect(state.warnings).toHaveLength(0);
  });

  it('keeps component mode isolated from page-context durable state, sessions, and picker', async () => {
    const workspaceState = createPreviewControllerTestWorkspaceState({
      uri: 'file:///workspace/Prior.tsx',
      version: 1,
    });
    state.active.mockReturnValueOnce(target('/workspace/Component.tsx'));
    const instance = controller(workspaceState);

    await instance.open('component');

    expect(state.active).toHaveBeenCalledOnce();
    expect(state.preview).not.toHaveBeenCalled();
    expect(state.pinned).not.toHaveBeenCalled();
    expect(state.workspace).not.toHaveBeenCalled();
    expect(state.picker).not.toHaveBeenCalled();
    expect(workspaceState.get).not.toHaveBeenCalled();
    expect(workspaceState.update).not.toHaveBeenCalled();
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]?.start).toHaveBeenCalledOnce();
    expect(state.warnings).toHaveLength(0);
  });
});
