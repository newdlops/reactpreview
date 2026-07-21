/**
 * Verifies the panel-owned bridge from component-tree selection to VS Code source decoration.
 * Tests keep editors explicit to prove the service never opens or focuses a document, retains a
 * pending selection, and clears stale marks when ordering or document identity changes.
 */
import path from 'node:path';
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';
import * as vscode from 'vscode';
import type { PreviewInspectorSourceSelectionRequest } from '../../src/presentation/previewInspectorProtocol';
import {
  PreviewInspectorSourceDecoration,
  type PreviewInspectorSourceDecorationContext,
} from '../../src/presentation/previewInspectorSourceDecoration';

const vscodeState = vi.hoisted(() => ({
  createDecorationType: vi.fn(),
  visibleTextEditors: [] as vscode.TextEditor[],
}));

vi.mock('vscode', () => {
  /** Zero-based editor position retained by decoration assertions. */
  class FakePosition {
    /** Retains one bounded source coordinate. */
    public constructor(
      public readonly line: number,
      public readonly character: number,
    ) {}
  }

  /** Collapsed source range attached to one whole-line decoration style. */
  class FakeRange {
    /** Retains exact start and end positions. */
    public constructor(
      public readonly start: FakePosition,
      public readonly end: FakePosition,
    ) {}
  }

  /** Theme token wrapper retained in style creation assertions. */
  class FakeThemeColor {
    /** Retains the VS Code theme color identifier. */
    public constructor(public readonly id: string) {}
  }

  return {
    OverviewRulerLane: { Center: 2 },
    Position: FakePosition,
    Range: FakeRange,
    ThemeColor: FakeThemeColor,
    window: {
      createTextEditorDecorationType: vscodeState.createDecorationType,
      visibleTextEditors: vscodeState.visibleTextEditors,
    },
  };
});

const SOURCE_PATH = path.normalize('/workspace/src/Card.tsx');
const OTHER_PATH = path.normalize('/workspace/src/Other.tsx');

afterEach(() => {
  vi.clearAllMocks();
  vscodeState.visibleTextEditors.length = 0;
});

describe('PreviewInspectorSourceDecoration', () => {
  /** Clamps authored coordinates and renders an exact mark only in an already-visible editor. */
  it('decorates the matching visible source with the exact style', () => {
    const exact = createDecorationType('exact');
    vscodeState.createDecorationType.mockReturnValue(exact.type);
    const editor = createEditor(SOURCE_PATH, ['first', 'second']);
    vscodeState.visibleTextEditors.push(editor.editor);
    const service = new PreviewInspectorSourceDecoration();

    service.select(createSelection(1, { column: 99, line: 99 }), createContext());

    expect(vscodeState.createDecorationType).toHaveBeenCalledWith(
      expect.objectContaining({ borderStyle: 'solid', isWholeLine: true }),
    );
    const decorationCall = editor.setDecorations.mock.calls[0];
    const decoration = decorationCall?.[1][0] as vscode.DecorationOptions | undefined;
    expect(decorationCall?.[0]).toBe(exact.type);
    expect(decoration?.hoverMessage).toContain('selected');
    expect(decoration?.range.start).toMatchObject({ character: 6, line: 1 });
  });

  /** Keeps an inferred source pending and applies it when a matching editor later becomes visible. */
  it('reapplies a pending selection with the approximate style', () => {
    const approximate = createDecorationType('approximate');
    vscodeState.createDecorationType.mockReturnValue(approximate.type);
    const service = new PreviewInspectorSourceDecoration();

    service.select(createSelection(1, { approximate: true, occurrenceStart: 8 }), createContext());
    expect(vscodeState.createDecorationType).not.toHaveBeenCalled();

    const editor = createEditor(SOURCE_PATH, ['first', 'second']);
    service.applyVisibleEditors([editor.editor]);

    expect(vscodeState.createDecorationType).toHaveBeenCalledWith(
      expect.objectContaining({ borderStyle: 'dashed', isWholeLine: true }),
    );
    const decorationCall = editor.setDecorations.mock.calls[0];
    const decoration = decorationCall?.[1][0] as vscode.DecorationOptions | undefined;
    expect(decorationCall?.[0]).toBe(approximate.type);
    expect(decoration?.hoverMessage).toContain('inferred');
    expect(decoration?.range.start).toMatchObject({ character: 2, line: 1 });
  });

  /** Rejects stale revision and reordered messages without replacing the current source mark. */
  it('guards runtime revision and monotonic selection order', () => {
    const exact = createDecorationType('exact');
    vscodeState.createDecorationType.mockReturnValue(exact.type);
    const editor = createEditor(SOURCE_PATH, ['first']);
    vscodeState.visibleTextEditors.push(editor.editor);
    const debug = createDebugSpy();
    const context = createContext(debug);
    const service = new PreviewInspectorSourceDecoration();

    service.select(createSelection(4, { line: 1 }), context);
    service.select(createSelection(3, { line: 1 }), context);
    service.select(
      {
        runtimeRevision: 6,
        sequence: 5,
        type: 'react-preview-inspector-source-selected',
      },
      context,
    );

    expect(vscodeState.createDecorationType).toHaveBeenCalledTimes(1);
    expect(editor.setDecorations).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('reordered'));
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('stale'));
  });

  /** Does not let an unauthorized high sequence starve the next authorized tree selection. */
  it('advances ordering only after graph authorization', () => {
    const exact = createDecorationType('exact');
    vscodeState.createDecorationType.mockReturnValue(exact.type);
    const editor = createEditor(SOURCE_PATH, ['first']);
    vscodeState.visibleTextEditors.push(editor.editor);
    const service = new PreviewInspectorSourceDecoration();
    const debug = createDebugSpy();
    const context = createContext(debug);

    service.select(createSelection(99, { line: 1, sourcePath: OTHER_PATH }), context);
    service.select(createSelection(2, { line: 1 }), context);

    expect(editor.setDecorations).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('outside'));
  });

  /** A matching edit invalidates both visible and pending state while unrelated edits do nothing. */
  it('invalidates only the selected source document', () => {
    const exact = createDecorationType('exact');
    vscodeState.createDecorationType.mockReturnValue(exact.type);
    const editor = createEditor(SOURCE_PATH, ['first']);
    vscodeState.visibleTextEditors.push(editor.editor);
    const service = new PreviewInspectorSourceDecoration();
    service.select(createSelection(1, { line: 1 }), createContext());

    service.invalidateDocument(OTHER_PATH);
    service.applyVisibleEditors([editor.editor]);
    expect(editor.setDecorations).toHaveBeenCalledTimes(3);

    service.invalidateDocument(SOURCE_PATH);
    service.applyVisibleEditors([editor.editor]);
    expect(editor.setDecorations).toHaveBeenLastCalledWith(exact.type, []);
    expect(editor.setDecorations).toHaveBeenCalledTimes(4);
  });

  /** Clear envelopes and disposal release the visible mark and lazily-created style exactly once. */
  it('clears and disposes decoration resources', () => {
    const exact = createDecorationType('exact');
    vscodeState.createDecorationType.mockReturnValue(exact.type);
    const editor = createEditor(SOURCE_PATH, ['first']);
    vscodeState.visibleTextEditors.push(editor.editor);
    const service = new PreviewInspectorSourceDecoration();
    service.select(createSelection(1, { line: 1 }), createContext());

    service.select(
      {
        runtimeRevision: 5,
        sequence: 2,
        type: 'react-preview-inspector-source-selected',
      },
      createContext(),
    );
    service.dispose();
    service.dispose();

    expect(editor.setDecorations).toHaveBeenLastCalledWith(exact.type, []);
    expect(exact.dispose).toHaveBeenCalledTimes(1);
  });
});

/** Decoration handle plus its direct disposal spy for lint-safe assertions. */
interface TestDecorationType {
  readonly dispose: ReturnType<typeof vi.fn>;
  readonly type: vscode.TextEditorDecorationType;
}

/** Creates one disposable decoration handle returned by the mocked VS Code API. */
function createDecorationType(kind: string): TestDecorationType {
  const dispose = vi.fn();
  return {
    dispose,
    type: { dispose, kind } as unknown as vscode.TextEditorDecorationType,
  };
}

/** Visible editor plus a direct decoration spy for lint-safe assertions. */
interface TestEditor {
  readonly editor: vscode.TextEditor;
  readonly setDecorations: Mock<
    (
      decorationType: vscode.TextEditorDecorationType,
      rangesOrOptions: readonly vscode.Range[] | readonly vscode.DecorationOptions[],
    ) => void
  >;
}

/** Creates a current-buffer document and editor with inspectable decoration calls. */
function createEditor(fileName: string, lines: readonly string[]): TestEditor {
  const document = {
    fileName,
    lineAt: (line: number) => ({ text: lines[line] ?? '' }),
    lineCount: lines.length,
    positionAt: (offset: number) => {
      let remaining = Math.max(0, Math.min(offset, lines.join('\n').length));
      for (const [line, text] of lines.entries()) {
        if (remaining <= text.length) return new vscode.Position(line, remaining);
        remaining -= text.length + 1;
      }
      const line = Math.max(0, lines.length - 1);
      return new vscode.Position(line, lines[line]?.length ?? 0);
    },
    uri: { authority: '', fsPath: fileName, scheme: 'file' },
  } as unknown as vscode.TextDocument;
  const setDecorations =
    vi.fn<
      (
        decorationType: vscode.TextEditorDecorationType,
        rangesOrOptions: readonly vscode.Range[] | readonly vscode.DecorationOptions[],
      ) => void
    >();
  return {
    editor: { document, setDecorations } as unknown as vscode.TextEditor,
    setDecorations,
  };
}

/** Creates one located request while allowing individual coordinate and path overrides. */
function createSelection(
  sequence: number,
  fields: Partial<Extract<PreviewInspectorSourceSelectionRequest, { sourcePath: string }>>,
): Extract<PreviewInspectorSourceSelectionRequest, { sourcePath: string }> {
  return {
    runtimeRevision: 5,
    sequence,
    sourcePath: SOURCE_PATH,
    type: 'react-preview-inspector-source-selected',
    ...fields,
  };
}

/** Creates the committed graph and provider context used by a single preview session. */
function createContext(
  debug: Mock<(message: string, ...args: unknown[]) => void> = createDebugSpy(),
): PreviewInspectorSourceDecorationContext {
  return {
    currentRuntimeRevision: 5,
    dependencyPaths: new Set([SOURCE_PATH]),
    enabled: true,
    log: { debug },
    pinnedDocumentUri: {
      authority: '',
      fsPath: '/workspace/src/Target.tsx',
      scheme: 'file',
    } as vscode.Uri,
  };
}

/** Creates a directly assertable diagnostic spy with an explicit non-method call signature. */
function createDebugSpy(): Mock<(message: string, ...args: unknown[]) => void> {
  return vi.fn<(message: string, ...args: unknown[]) => void>();
}
