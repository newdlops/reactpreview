/**
 * Verifies the Page Inspector source-open protocol and its VS Code host authorization boundary.
 * Browser messages are treated as untrusted: only committed graph files may reach editor APIs, and
 * authored coordinates are clamped to the latest text document rather than trusted directly.
 */
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  createPreviewInspectorGestureToken,
  PreviewInspectorGestureGate,
} from '../../src/presentation/previewInspectorGestureGate';
import {
  readPreviewInspectorOpenSourceRequest,
  type PreviewInspectorOpenSourceRequest,
} from '../../src/presentation/previewInspectorProtocol';
import {
  handlePreviewInspectorSourceNavigationMessage,
  resolveAuthorizedPreviewInspectorSourceIdentity,
  type PreviewInspectorSourceNavigationContext,
} from '../../src/presentation/previewInspectorSourceNavigation';

const vscodeState = vi.hoisted(() => ({
  openTextDocument: vi.fn<(uri: vscode.Uri) => Promise<vscode.TextDocument>>(),
  showTextDocument:
    vi.fn<
      (document: vscode.TextDocument, options: vscode.TextDocumentShowOptions) => Promise<void>
    >(),
  textDocuments: [] as vscode.TextDocument[],
  visibleTextEditors: [] as Pick<vscode.TextEditor, 'document' | 'viewColumn'>[],
}));

vi.mock('vscode', () => {
  /** Minimal immutable URI retaining remote scheme and authority across `with` calls. */
  class FakeUri {
    /** Creates one URI around a filesystem path and optional remote identity. */
    public constructor(
      public readonly fsPath: string,
      public readonly scheme = 'file',
      public readonly authority = '',
    ) {}

    /** URI path used by the production sibling-resource helper. */
    public get path(): string {
      return this.fsPath;
    }

    /** Creates a local file URI. */
    public static file(filePath: string): FakeUri {
      return new FakeUri(filePath);
    }

    /** Replaces selected URI components while retaining the rest. */
    public with(change: {
      readonly authority?: string;
      readonly path?: string;
      readonly scheme?: string;
    }): FakeUri {
      return new FakeUri(
        change.path ?? this.fsPath,
        change.scheme ?? this.scheme,
        change.authority ?? this.authority,
      );
    }

    /** Serializes a stable URI for diagnostics and assertions. */
    public toString(): string {
      return `${this.scheme}://${this.authority}${this.fsPath}`;
    }
  }

  /** Zero-based editor position exposed by selection assertions. */
  class FakePosition {
    /** Retains exact line and character values. */
    public constructor(
      public readonly line: number,
      public readonly character: number,
    ) {}
  }

  /** Collapsed or expanded editor range accepted by `showTextDocument`. */
  class FakeRange {
    /** Retains the start and end positions supplied by navigation. */
    public constructor(
      public readonly start: FakePosition,
      public readonly end: FakePosition,
    ) {}
  }

  return {
    Position: FakePosition,
    Range: FakeRange,
    Uri: FakeUri,
    ViewColumn: { Beside: -2, One: 1, Two: 2 },
    window: {
      showTextDocument: vscodeState.showTextDocument,
      visibleTextEditors: vscodeState.visibleTextEditors,
    },
    workspace: {
      openTextDocument: vscodeState.openTextDocument,
      textDocuments: vscodeState.textDocuments,
    },
  };
});

const SOURCE_PATH = path.normalize('/workspace/src/Card.tsx');
const OUTSIDE_PATH = path.normalize('/workspace/secrets/Outside.tsx');
const GESTURE_SECRET = Buffer.alloc(32, 7).toString('base64url');
const SYNTACTIC_GESTURE_PROOF = {
  gestureNonce: '0'.repeat(32),
  gestureToken: 'A'.repeat(43),
} as const;
let gestureSequence = 0;

afterEach(() => {
  vi.clearAllMocks();
  vscodeState.textDocuments.length = 0;
  vscodeState.visibleTextEditors.length = 0;
  gestureSequence = 0;
});

describe('readPreviewInspectorOpenSourceRequest', () => {
  /** Preserves each supported source-location representation with explicit index semantics. */
  it('accepts absolute source paths with line, column, and graph offsets', () => {
    const message = createSignedSourceMessage({
      column: 7,
      line: 3,
      occurrenceStart: 42,
      sourcePath: SOURCE_PATH,
    });

    expect(readPreviewInspectorOpenSourceRequest(message)).toEqual(message);
  });

  /** Rejects values that could escape host path policy or produce ambiguous editor coordinates. */
  it.each([
    null,
    [],
    {
      ...SYNTACTIC_GESTURE_PROOF,
      sourcePath: 'relative/Card.tsx',
      type: 'react-preview-inspector-open-source',
    },
    {
      ...SYNTACTIC_GESTURE_PROOF,
      sourcePath: '/workspace/Card.css',
      type: 'react-preview-inspector-open-source',
    },
    {
      ...SYNTACTIC_GESTURE_PROOF,
      sourcePath: '/workspace/nul\0Card.tsx',
      type: 'react-preview-inspector-open-source',
    },
    {
      ...SYNTACTIC_GESTURE_PROOF,
      line: 0,
      sourcePath: SOURCE_PATH,
      type: 'react-preview-inspector-open-source',
    },
    {
      ...SYNTACTIC_GESTURE_PROOF,
      line: 1.5,
      sourcePath: SOURCE_PATH,
      type: 'react-preview-inspector-open-source',
    },
    {
      ...SYNTACTIC_GESTURE_PROOF,
      column: 2,
      sourcePath: SOURCE_PATH,
      type: 'react-preview-inspector-open-source',
    },
    {
      ...SYNTACTIC_GESTURE_PROOF,
      occurrenceStart: -1,
      sourcePath: SOURCE_PATH,
      type: 'react-preview-inspector-open-source',
    },
    {
      ...SYNTACTIC_GESTURE_PROOF,
      occurrenceStart: 1.5,
      sourcePath: SOURCE_PATH,
      type: 'react-preview-inspector-open-source',
    },
    { sourcePath: SOURCE_PATH, type: 'react-preview-inspector-open-source' },
  ])('rejects malformed source navigation %#', (message) => {
    expect(readPreviewInspectorOpenSourceRequest(message)).toBeUndefined();
  });
});

describe('handlePreviewInspectorSourceNavigationMessage', () => {
  /** Opens an authorized dependency while clamping one-based JSX coordinates to current text. */
  it('reveals a committed graph source without replacing the inspector column', async () => {
    const document = createDocument(SOURCE_PATH, ['first', 'second']);
    vscodeState.openTextDocument.mockResolvedValue(document);
    const context = createContext([SOURCE_PATH]);

    const handled = handlePreviewInspectorSourceNavigationMessage(
      createSignedSourceMessage({
        column: 99,
        line: 99,
        sourcePath: SOURCE_PATH,
      }),
      context,
    );

    expect(handled).toBe(true);
    await vi.waitFor(() => {
      expect(vscodeState.showTextDocument).toHaveBeenCalledTimes(1);
    });
    expect(vscodeState.openTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: SOURCE_PATH, scheme: 'file' }),
    );
    const [shownDocument, options] = vscodeState.showTextDocument.mock.calls[0] ?? [];
    expect(shownDocument).toBe(document);
    expect(options).toMatchObject({
      preserveFocus: false,
      preview: true,
      viewColumn: vscode.ViewColumn.One,
    });
    expect(options?.selection?.start).toMatchObject({ character: 6, line: 1 });
  });

  /** Uses static graph offsets when React development metadata has no line and column. */
  it('reveals a zero-based occurrence offset in an existing source editor column', async () => {
    const document = createDocument(SOURCE_PATH, ['first', 'second']);
    vscodeState.textDocuments.push(document);
    vscodeState.visibleTextEditors.push({ document, viewColumn: vscode.ViewColumn.Two });
    vscodeState.openTextDocument.mockResolvedValue(document);

    expect(
      handlePreviewInspectorSourceNavigationMessage(
        createSignedSourceMessage({
          occurrenceStart: 8,
          sourcePath: SOURCE_PATH,
        }),
        createContext([SOURCE_PATH]),
      ),
    ).toBe(true);

    await vi.waitFor(() => {
      expect(vscodeState.showTextDocument).toHaveBeenCalledTimes(1);
    });
    expect(vscodeState.openTextDocument).toHaveBeenCalledWith(document.uri);
    const [shownDocument, options] = vscodeState.showTextDocument.mock.calls[0] ?? [];
    expect(shownDocument).toBe(document);
    expect(options?.viewColumn).toBe(vscode.ViewColumn.Two);
    expect(options?.selection?.start).toMatchObject({ character: 2, line: 1 });
  });

  /** Consumes valid but unauthorized requests without opening arbitrary extension-host files. */
  it('denies sources outside the committed dependency graph', async () => {
    const context = createContext([SOURCE_PATH]);

    expect(
      handlePreviewInspectorSourceNavigationMessage(
        createSignedSourceMessage({
          line: 1,
          sourcePath: OUTSIDE_PATH,
        }),
        context,
      ),
    ).toBe(true);
    await Promise.resolve();

    expect(vscodeState.openTextDocument).not.toHaveBeenCalled();
    expect(context.log.debug).toHaveBeenCalledWith(expect.stringContaining('outside'));
  });

  /** Leaves malformed and unrelated values available to the existing runtime protocol readers. */
  it('does not claim unrelated webview messages', () => {
    const context = createContext([SOURCE_PATH]);

    expect(
      handlePreviewInspectorSourceNavigationMessage(
        { revision: 1, token: 'runtime', type: 'react-preview-runtime-ready' },
        context,
      ),
    ).toBe(false);
    expect(
      handlePreviewInspectorSourceNavigationMessage(
        createSignedSourceMessage({
          sourcePath: 'relative.tsx',
        }),
        context,
      ),
    ).toBe(false);
  });

  /** Preserves the pinned target's remote scheme and authority for unopened dependency sources. */
  it('opens remote sibling sources through the pinned document provider', async () => {
    const remoteUri = vscode.Uri.file(SOURCE_PATH).with({
      authority: 'ssh-test',
      scheme: 'vscode-remote',
    });
    const document = createDocument(SOURCE_PATH, ['remote'], remoteUri);
    const localDocument = createDocument(SOURCE_PATH, ['local']);
    vscodeState.textDocuments.push(localDocument);
    vscodeState.openTextDocument.mockResolvedValue(document);
    const context = createContext([SOURCE_PATH], true);

    handlePreviewInspectorSourceNavigationMessage(
      createSignedSourceMessage({
        sourcePath: SOURCE_PATH,
      }),
      context,
    );

    await vi.waitFor(() => {
      expect(vscodeState.openTextDocument).toHaveBeenCalledTimes(1);
    });
    expect(vscodeState.openTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        authority: 'ssh-test',
        fsPath: SOURCE_PATH,
        scheme: 'vscode-remote',
      }),
    );
    expect(vscodeState.openTextDocument).not.toHaveBeenCalledWith(localDocument.uri);
  });

  /** Rejects a replayed or payload-tampered gesture proof before opening another editor. */
  it('consumes a signed UI gesture once and binds it to exact coordinates', async () => {
    const document = createDocument(SOURCE_PATH, ['first', 'second']);
    vscodeState.openTextDocument.mockResolvedValue(document);
    const context = createContext([SOURCE_PATH]);
    const message = createSignedSourceMessage({ line: 1, sourcePath: SOURCE_PATH });

    expect(handlePreviewInspectorSourceNavigationMessage(message, context)).toBe(true);
    expect(handlePreviewInspectorSourceNavigationMessage(message, context)).toBe(true);
    expect(handlePreviewInspectorSourceNavigationMessage({ ...message, line: 2 }, context)).toBe(
      true,
    );
    await vi.waitFor(() => {
      expect(vscodeState.openTextDocument).toHaveBeenCalledTimes(1);
    });
  });

  /** Proves an unknown lexical path returns before the injectable canonical filesystem operation. */
  it('does not canonicalize a path outside the lexical dependency allowlist', () => {
    const canonicalize = vi.fn(() => {
      throw new Error('canonical filesystem access must not run');
    });

    expect(
      resolveAuthorizedPreviewInspectorSourceIdentity(
        OUTSIDE_PATH,
        new Set([SOURCE_PATH]),
        canonicalize,
      ),
    ).toBeUndefined();
    expect(canonicalize).not.toHaveBeenCalled();
  });
});

/** Creates the minimal current text document needed for URI and position calculations. */
function createDocument(
  fileName: string,
  lines: readonly string[],
  uri: vscode.Uri = vscode.Uri.file(fileName),
): vscode.TextDocument {
  return {
    fileName,
    lineAt: (line: number) => ({ text: lines[line] ?? '' }),
    lineCount: lines.length,
    positionAt: (offset: number) => {
      const boundedOffset = Math.max(0, Math.min(offset, lines.join('\n').length));
      let remaining = boundedOffset;
      for (const [line, text] of lines.entries()) {
        if (remaining <= text.length) {
          return new vscode.Position(line, remaining);
        }
        remaining -= text.length + 1;
      }
      const lastLine = Math.max(0, lines.length - 1);
      return new vscode.Position(lastLine, lines[lastLine]?.length ?? 0);
    },
    uri,
  } as unknown as vscode.TextDocument;
}

/** Creates an authorized navigation context with optional remote pinned-document identity. */
function createContext(
  dependencyPaths: readonly string[],
  remote = false,
): PreviewInspectorSourceNavigationContext {
  const pinnedFileUri = vscode.Uri.file('/workspace/src/Target.tsx');
  const pinnedDocumentUri = remote
    ? pinnedFileUri.with({ authority: 'ssh-test', scheme: 'vscode-remote' })
    : pinnedFileUri;
  const gestureGate = new PreviewInspectorGestureGate();
  gestureGate.configure(GESTURE_SECRET);
  return {
    dependencyPaths: new Set(dependencyPaths.map((sourcePath) => path.normalize(sourcePath))),
    enabled: true,
    gestureGate,
    log: { debug: vi.fn<(message: string, ...args: unknown[]) => void>() },
    panelViewColumn: vscode.ViewColumn.Two,
    pinnedDocumentUri,
  };
}

/** Creates the exact browser-shaped request and signs every field with the test entry key. */
function createSignedSourceMessage(
  fields: Omit<PreviewInspectorOpenSourceRequest, 'gestureNonce' | 'gestureToken' | 'type'>,
): PreviewInspectorOpenSourceRequest {
  gestureSequence += 1;
  const unsignedRequest = {
    ...fields,
    gestureNonce: gestureSequence.toString(16).padStart(32, '0'),
    type: 'react-preview-inspector-open-source' as const,
  };
  return {
    ...unsignedRequest,
    gestureToken: createPreviewInspectorGestureToken(GESTURE_SECRET, unsignedRequest),
  };
}
