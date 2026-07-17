/** Verifies error reconstruction and zero-copy bundle transfer-list selection. */
import { describe, expect, it } from 'vitest';
import { PreviewCompilationError } from '../../../src/domain/preview';
import { PreviewBuildCancelledError } from '../../../src/domain/previewBuildExecution';
import {
  collectPreviewBundleTransferList,
  deserializePreviewCompilerWorkerError,
  serializePreviewCompilerWorkerError,
} from '../../../src/adapters/worker/previewCompilerWorkerProtocol';

describe('previewCompilerWorkerProtocol', () => {
  /** Preserves structured compiler diagnostics and cancellation semantics across cloning. */
  it('round-trips domain failures', () => {
    const compilation = new PreviewCompilationError('broken import', [
      { message: 'Could not resolve x', severity: 'error' },
    ]);

    const reconstructed = deserializePreviewCompilerWorkerError(
      serializePreviewCompilerWorkerError(compilation),
    );
    expect(reconstructed).toBeInstanceOf(PreviewCompilationError);
    expect((reconstructed as PreviewCompilationError).diagnostics).toHaveLength(1);
    expect(
      deserializePreviewCompilerWorkerError(
        serializePreviewCompilerWorkerError(new PreviewBuildCancelledError()),
      ),
    ).toBeInstanceOf(PreviewBuildCancelledError);
  });

  /** Selects every unique JavaScript, CSS, and lazy chunk ArrayBuffer exactly once. */
  it('collects transferable output buffers without duplication', () => {
    const shared = new Uint8Array([1, 2]);
    const stylesheet = new Uint8Array([3]);
    const transferList = collectPreviewBundleTransferList({
      chunks: [{ contents: shared, relativePath: 'chunks/a.js' }],
      dependencies: [],
      diagnostics: [],
      javascript: shared,
      stylesheet,
      watchDirectories: [],
    });

    expect(transferList).toEqual([shared.buffer, stylesheet.buffer]);
  });
});
