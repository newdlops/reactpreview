/**
 * Verifies VS Code target capture without starting an Extension Host.
 * The request must carry dirty reachable candidates and an optional non-standard tsconfig path so
 * the compiler can reproduce the editor's current module graph instead of saved files alone.
 */
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  resolveActivePreviewTarget,
  resolvePinnedPreviewTarget,
} from '../../src/presentation/activePreviewTarget';

const vscodeState = vi.hoisted(() => ({
  activeTextEditor: undefined as { document: unknown } | undefined,
  openTextDocument: vi.fn(),
  textDocuments: [] as unknown[],
  trusted: true,
  tsconfig: '',
}));

vi.mock('vscode', () => {
  /** Minimal immutable file URI used by workspace-folder and document comparisons. */
  class FakeUri {
    /** Filesystem document scheme supported by the preview target resolver. */
    public readonly scheme = 'file';

    /**
     * Creates a URI for one absolute fake workspace path.
     *
     * @param fsPath Filesystem path exposed to production code.
     */
    public constructor(public readonly fsPath: string) {}

    /**
     * Serializes a stable identity used to compare workspace folders.
     *
     * @returns File URI string for the fake path.
     */
    public toString(): string {
      return `file://${this.fsPath}`;
    }

    /**
     * Creates the fake equivalent of `vscode.Uri.file`.
     *
     * @param fsPath Absolute test path.
     * @returns Fake file URI.
     */
    public static file(fsPath: string): FakeUri {
      return new FakeUri(fsPath);
    }
  }

  const workspaceFolder = { uri: FakeUri.file('/workspace') };
  const otherWorkspaceFolder = { uri: FakeUri.file('/other') };
  return {
    Uri: FakeUri,
    window: {
      get activeTextEditor(): unknown {
        return vscodeState.activeTextEditor;
      },
    },
    workspace: {
      get isTrusted(): boolean {
        return vscodeState.trusted;
      },
      get textDocuments(): readonly unknown[] {
        return vscodeState.textDocuments;
      },
      getConfiguration: () => ({
        get: (_key: string, fallback: string): string => vscodeState.tsconfig || fallback,
      }),
      getWorkspaceFolder: (uri: FakeUri): unknown => {
        if (uri.fsPath.startsWith('/workspace/')) {
          return workspaceFolder;
        }
        return uri.fsPath.startsWith('/other/') ? otherWorkspaceFolder : undefined;
      },
      openTextDocument: vscodeState.openTextDocument,
    },
  };
});

afterEach(() => {
  vscodeState.activeTextEditor = undefined;
  vscodeState.openTextDocument.mockReset();
  vscodeState.textDocuments = [];
  vscodeState.trusted = true;
  vscodeState.tsconfig = '';
});

describe('resolveActivePreviewTarget', () => {
  /** Captures only supported dirty documents from the active workspace and resolves config paths. */
  it('includes dirty dependency snapshots and an explicit tsconfig', () => {
    const activeDocument = createDocument('/workspace/src/Preview.tsx', false, 'active source');
    const dirtyChild = createDocument('/workspace/src/Child.tsx', true, 'dirty child source');
    const cleanChild = createDocument('/workspace/src/Clean.tsx', false, 'clean child source');
    const unrelatedDirtyChild = createDocument('/other/Other.tsx', true, 'other workspace source');
    vscodeState.activeTextEditor = { document: activeDocument };
    vscodeState.textDocuments = [activeDocument, dirtyChild, cleanChild, unrelatedDirtyChild];
    vscodeState.tsconfig = 'tsconfig.app.json';

    const target = resolveActivePreviewTarget();

    expect('request' in target).toBe(true);
    if (!('request' in target)) {
      return;
    }

    expect(target.request.dependencySnapshots).toEqual([
      {
        documentPath: dirtyChild.fileName,
        language: 'tsx',
        sourceText: 'dirty child source',
      },
    ]);
    expect(target.request.tsconfigPath).toBe(path.join('/workspace', 'tsconfig.app.json'));
    expect(target.documentUri.fsPath).toBe(activeDocument.fileName);
    expect(target.documentName).toBe('src/Preview.tsx');
  });

  /** Reopens the captured URI and ignores an unrelated active editor while refreshing a panel. */
  it('resolves a pinned document without consulting the active editor', async () => {
    const pinnedDocument = createDocument('/workspace/src/Pinned.tsx', true, 'pinned source');
    const activeDocument = createDocument('/workspace/src/Other.tsx', false, 'other source');
    vscodeState.activeTextEditor = { document: activeDocument };
    vscodeState.textDocuments = [pinnedDocument, activeDocument];
    vscodeState.openTextDocument.mockResolvedValue(pinnedDocument);

    const target = await resolvePinnedPreviewTarget(pinnedDocument.uri);

    expect(vscodeState.openTextDocument).toHaveBeenCalledWith(pinnedDocument.uri);
    expect('request' in target).toBe(true);
    if (!('request' in target)) {
      return;
    }
    expect(target.documentUri.fsPath).toBe(pinnedDocument.fileName);
    expect(target.documentName).toBe('src/Pinned.tsx');
    expect(target.request.documentPath).toBe(pinnedDocument.fileName);
    expect(target.request.sourceText).toBe('pinned source');
  });
});

/**
 * Creates the TextDocument subset read by the production target resolver.
 *
 * @param fileName Absolute fake document path.
 * @param isDirty Whether editor text differs from the saved file.
 * @param sourceText Text returned as the immutable build snapshot.
 * @returns Typed fake VS Code document.
 */
function createDocument(
  fileName: string,
  isDirty: boolean,
  sourceText: string,
): vscode.TextDocument {
  return {
    fileName,
    getText: () => sourceText,
    isDirty,
    isUntitled: false,
    uri: vscode.Uri.file(fileName),
  } as vscode.TextDocument;
}
