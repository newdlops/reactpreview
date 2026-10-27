/** Shared deterministic fixtures and race controls for previewController.test.ts. */
import path from 'node:path';
import { vi } from 'vitest';
import * as vscode from 'vscode';
import type { PreparedPreview } from '../../src/domain/preview';
import type { ResolvedPreviewTarget } from '../../src/presentation/activePreviewTarget';

/** Returns a complete inert log channel so lifecycle traces can use every severity safely. */
export function createPreviewControllerTestLog(): vscode.LogOutputChannel {
  return {
    append: vi.fn(),
    appendLine: vi.fn(),
    clear: vi.fn(),
    debug: vi.fn(),
    dispose: vi.fn(),
    error: vi.fn(),
    hide: vi.fn(),
    info: vi.fn(),
    logLevel: 3,
    name: 'React Preview test',
    onDidChangeLogLevel: vi.fn(() => ({ dispose: vi.fn() })),
    replace: vi.fn(),
    show: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
  };
}

/** Test-only subset exposed by each fake filesystem watcher. */
export interface TestWatcher {
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
export function createTarget(documentPath: string): ResolvedPreviewTarget {
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
export function createPreparedPreview(
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
export interface Deferred<Value> {
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
export function createDeferred<Value>(): Deferred<Value> {
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
export async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
