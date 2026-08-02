import { describe, expect, it } from 'vitest';
import { createPreviewHotReloadRuntimeSource } from '../../../src/adapters/esbuild/previewHotReloadRuntimeSource';

describe('createPreviewHotReloadRuntimeSource', () => {
  it('disposes the old StyleSheetManager target after unmount and before replacement activation', () => {
    const source = createPreviewHotReloadRuntimeSource('');
    const unmount = source.indexOf('previewHotRuntime.root.unmount()');
    const dispose = source.indexOf(
      'previewHotRuntime.activeStyleSheetBoundary?.dispose?.()',
      unmount,
    );
    const activate = source.indexOf('await preparedEntry.activate()', dispose);
    expect(unmount).toBeGreaterThan(-1);
    expect(dispose).toBeGreaterThan(unmount);
    expect(activate).toBeGreaterThan(dispose);
  });

  it('keeps the previous boundary for failures before replacement begins', () => {
    const source = createPreviewHotReloadRuntimeSource('');
    expect(source).toContain('retainedPrevious: !replacementStarted');
    expect(source).toContain('await previewHotRuntime.preparedEntry?.dispose?.()');
  });

  it('invalidates a preparing optional replacement without unmounting the visible root', () => {
    const source = createPreviewHotReloadRuntimeSource('');
    const cancellation = source.indexOf("type !== 'react-preview-hot-reload-cancel'");
    const invalidate = source.indexOf('previewHotRuntime.requestSequence += 1', cancellation);
    const retained = source.indexOf('retainedPrevious: true', invalidate);
    const unmount = source.indexOf('previewHotRuntime.root.unmount()', retained);

    expect(cancellation).toBeGreaterThan(-1);
    expect(invalidate).toBeGreaterThan(cancellation);
    expect(retained).toBeGreaterThan(invalidate);
    expect(unmount).toBeGreaterThan(retained);
  });
});
