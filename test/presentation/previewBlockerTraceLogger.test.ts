/** Verifies authorized source enrichment and ordered Output records for blocker trace messages. */
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { handlePreviewBlockerTraceMessage } from '../../src/presentation/previewBlockerTraceLogger';

const vscodeState = vi.hoisted(() => ({
  openTextDocument: vi.fn<(uri: vscode.Uri) => Promise<vscode.TextDocument>>(),
  textDocuments: [] as vscode.TextDocument[],
}));

vi.mock('vscode', () => {
  /** Minimal URI retaining local/remote identity through sibling path replacement. */
  class FakeUri {
    /** Stores exact URI components used by the production source reader. */
    public constructor(
      public readonly fsPath: string,
      public readonly scheme = 'file',
      public readonly authority = '',
    ) {}

    /** URI path used by the sibling-resource helper. */
    public get path(): string {
      return this.fsPath;
    }

    /** Creates one local file URI. */
    public static file(filePath: string): FakeUri {
      return new FakeUri(filePath);
    }

    /** Replaces selected components without normalizing the test path. */
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
  }

  return {
    Uri: FakeUri,
    workspace: {
      openTextDocument: vscodeState.openTextDocument,
      textDocuments: vscodeState.textDocuments,
    },
  };
});

const SOURCE_PATH = path.normalize('/workspace/src/ProfileForm.tsx');
const TARGET_PATH = path.normalize('/workspace/src/ProfilePage.tsx');

afterEach(() => {
  vi.clearAllMocks();
  vscodeState.textDocuments.length = 0;
});

describe('Preview blocker trace logger', () => {
  /** Reads only the committed dependency and includes focused authored lines in pretty JSON Output. */
  it('enriches a valid blocker event with a bounded source excerpt', async () => {
    const document = createDocument(SOURCE_PATH, [
      'export function ProfileForm() {',
      '  const context = useFormContext();',
      '  return <span>{context.formikProps.values.name}</span>;',
      '}',
    ]);
    vscodeState.openTextDocument.mockResolvedValue(document);
    const log = { debug: vi.fn(), info: vi.fn() };

    expect(
      handlePreviewBlockerTraceMessage(createTraceMessage(SOURCE_PATH), {
        dependencyPaths: new Set([SOURCE_PATH]),
        enabled: true,
        log,
        pinnedDocumentUri: vscode.Uri.file(TARGET_PATH),
        targetPath: TARGET_PATH,
      }),
    ).toBe(true);

    await vi.waitFor(() => {
      expect(log.info).toHaveBeenCalledTimes(1);
    });
    const output = String(log.info.mock.calls[0]?.[0]);
    expect(output).toContain('React preview blocker trace');
    expect(output).toContain('"format": "react-preview-blocker-trace/v1"');
    expect(output).toContain('"previewTarget": "/workspace/src/ProfilePage.tsx"');
    expect(output).toContain('"runtimeSessionId": "rp-0123456789abcdef01234567"');
    expect(output).toContain('"runtimeRevision": 2');
    expect(output).toContain('"status": "available"');
    expect(output).toContain('context.formikProps.values.name');
    expect(output).toContain('"focus": true');
  });

  /** Logs blocker metadata but never opens a browser-requested file outside the committed graph. */
  it('marks unauthorized source without reading it', async () => {
    const log = { debug: vi.fn(), info: vi.fn() };

    expect(
      handlePreviewBlockerTraceMessage(createTraceMessage(SOURCE_PATH), {
        dependencyPaths: new Set([TARGET_PATH]),
        enabled: true,
        log,
        pinnedDocumentUri: vscode.Uri.file(TARGET_PATH),
        targetPath: TARGET_PATH,
      }),
    ).toBe(true);

    await vi.waitFor(() => {
      expect(log.info).toHaveBeenCalledTimes(1);
    });
    expect(String(log.info.mock.calls[0]?.[0])).toContain('outside-committed-graph');
    expect(vscodeState.openTextDocument).not.toHaveBeenCalled();
  });

  /** Consumes a claimed but malformed trace before it can collide with another host protocol. */
  it('diagnoses malformed trace envelopes without scheduling Output work', () => {
    const log = { debug: vi.fn(), info: vi.fn() };

    expect(
      handlePreviewBlockerTraceMessage(
        { type: 'react-preview-blocker-trace' },
        {
          dependencyPaths: new Set([TARGET_PATH]),
          enabled: true,
          log,
          pinnedDocumentUri: vscode.Uri.file(TARGET_PATH),
          targetPath: TARGET_PATH,
        },
      ),
    ).toBe(true);
    expect(log.debug).toHaveBeenCalledWith(
      'Ignored a malformed React Preview blocker trace message.',
    );
    expect(log.info).not.toHaveBeenCalled();
  });

  /** Refuses host source work when an ordinary component-gallery webview claims the trace type. */
  it('consumes trace messages outside Page Inspector mode without reading or logging source', () => {
    const log = { debug: vi.fn(), info: vi.fn() };

    expect(
      handlePreviewBlockerTraceMessage(createTraceMessage(SOURCE_PATH), {
        dependencyPaths: new Set([SOURCE_PATH]),
        enabled: false,
        log,
        pinnedDocumentUri: vscode.Uri.file(TARGET_PATH),
        targetPath: TARGET_PATH,
      }),
    ).toBe(true);
    expect(log.debug).toHaveBeenCalledWith(
      'Ignored a React Preview blocker trace outside Page Inspector mode.',
    );
    expect(log.info).not.toHaveBeenCalled();
    expect(vscodeState.openTextDocument).not.toHaveBeenCalled();
  });
});

/** Creates a complete Auto event carrying one source-backed hook blocker. */
function createTraceMessage(sourcePath: string): Record<string, unknown> {
  return {
    artifactId: '0123456789abcdef',
    event: {
      auto: {
        action: 'Smart fill minimum hook value',
        generatedPaths: ['formikProps.values.name'],
        mode: 'smart',
        selectedValue: { formikProps: { values: { name: 'Preview name' } } },
      },
      blocker: {
        id: 'hook-form',
        kind: 'runtime-fallback',
        name: 'Missing hook value · useFormContext',
        ownerName: 'ProfileForm',
        source: { line: 3, sourcePath },
        summary: { requiredPaths: ['formikProps.values.name'] },
      },
      event: 'auto-selection',
      sequence: 2,
      timestamp: '2026-07-19T12:00:00.000Z',
      traceId: 'blocker-trace-2',
    },
    runtimeRevision: 2,
    runtimeSessionId: 'rp-0123456789abcdef01234567',
    type: 'react-preview-blocker-trace',
  };
}

/** Creates the small text-document surface used by excerpt line and offset resolution. */
function createDocument(fileName: string, lines: readonly string[]): vscode.TextDocument {
  return {
    fileName,
    lineAt: (line: number) => ({ text: lines[line] ?? '' }),
    lineCount: lines.length,
    positionAt: (offset: number) => {
      const prefix = lines.join('\n').slice(0, Math.max(0, offset));
      return {
        character: prefix.length - prefix.lastIndexOf('\n') - 1,
        line: prefix.split('\n').length - 1,
      };
    },
    uri: vscode.Uri.file(fileName),
  } as unknown as vscode.TextDocument;
}
