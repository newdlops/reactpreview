import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewHotReloadRuntimeSource } from '../../../src/adapters/esbuild/previewHotReloadRuntimeSource';

describe('createPreviewHotReloadRuntimeSource', () => {
  it.each([
    ['1', undefined, 1, false],
    ['12', undefined, 12, false],
    ['1', 13, 13, true],
    ['1', 0, 0, true],
    ['1', -1, 1, false],
    ['1', 1.5, 1, false],
    ['1', Number.MAX_SAFE_INTEGER + 1, 1, false],
    [undefined, undefined, 0, false],
    ['invalid', undefined, 0, false],
    ['-1', undefined, 0, false],
    ['1.5', undefined, 0, false],
    ['9007199254740992', undefined, 0, false],
  ])(
    'pins entry identity from mount %s and active revision %s',
    (mountRevision, active, expected, isHotReload) => {
      const source = createPreviewHotReloadRuntimeSource('');
      const boundary = source.indexOf('/** Replaces one module-owned');
      expect(boundary).toBeGreaterThan(0);
      const context = vm.createContext({
        mountNode: { dataset: { reactPreviewRuntimeRevision: mountRevision } },
      });
      if (active !== undefined) {
        Reflect.set(context, Symbol.for('newdlops.react-file-preview.hot-runtime'), {
          activeReloadRevision: active,
        });
      }
      expect(vm.runInContext(source.slice(0, boundary) + '\npreviewEntryRevision;', context)).toBe(
        expected,
      );
      expect(vm.runInContext('previewEntryIsHotReload;', context)).toBe(isHotReload);
    },
  );

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
