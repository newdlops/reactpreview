/** Checks exact-source probe reuse without omitting runtime instrumentation or retaining ASTs. */
import { describe, expect, it, vi } from 'vitest';
import * as deferred from '../../../../src/adapters/esbuild/staticResources/previewDeferredUiTriggerInstrumentation';
import * as instrumentation from '../../../../src/adapters/esbuild/staticResources/previewRuntimeSourceInstrumentation';
import { canPassThroughPreviewDependency } from '../../../../src/adapters/esbuild/staticResources/previewDependencyPassThroughPolicy';

const plainSource = 'export const Panel = () => <section>Ready</section>;';

describe('runtime instrumentation probe reuse', () => {
  it('skips the expensive probe when compatibility already requires full transformation', () => {
    const probe = vi.spyOn(instrumentation, 'mayRequirePreviewRuntimeSourceInstrumentation');
    expect(
      canPassThroughPreviewDependency(
        '/workspace/Provider.tsx',
        "import { usePanel } from './usePanel'; export const Panel = () => <main>{usePanel().name}</main>;",
        { instrumentRenderConditions: true, selectiveDependencyPassThrough: true },
      ),
    ).toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });

  it('proves one unchanged source once across repeated preparation passes', () => {
    const probe = vi.spyOn(deferred, 'instrumentPreviewDeferredUiTriggers');
    for (let index = 0; index < 40; index += 1) {
      expect(
        instrumentation.mayRequirePreviewRuntimeSourceInstrumentation(
          '/cache/reuse.tsx',
          plainSource,
        ),
      ).toBe(false);
    }
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('rechecks edits, restored contents, and different source grammars', () => {
    const probe = vi.spyOn(deferred, 'instrumentPreviewDeferredUiTriggers');
    const path = '/cache/edits.tsx';
    expect(instrumentation.mayRequirePreviewRuntimeSourceInstrumentation(path, plainSource)).toBe(
      false,
    );
    expect(
      instrumentation.mayRequirePreviewRuntimeSourceInstrumentation(
        path,
        'export const Panel = () => open && <main />;',
      ),
    ).toBe(true);
    expect(instrumentation.mayRequirePreviewRuntimeSourceInstrumentation(path, plainSource)).toBe(
      false,
    );
    expect(
      instrumentation.mayRequirePreviewRuntimeSourceInstrumentation('/cache/edits.ts', plainSource),
    ).toBe(true);
    expect(
      instrumentation.mayRequirePreviewRuntimeSourceInstrumentation(
        '/cache/edits.mdx',
        plainSource,
      ),
    ).toBe(true);
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['deferred', 'export const Panel = () => <button onClick={() => modal.show()}>Open</button>;'],
    [
      'effect',
      "import { useEffect as effect } from 'react'; export function Panel() { effect(() => {}); return <main />; }",
    ],
    ['async', 'async function Panel() { return <main />; } export const App = () => <Panel />;'],
    ['malformed', 'export const Panel = () => open ? <main /> :'],
  ])('keeps %s instrumentation required on cache hits', (name, source) => {
    for (let index = 0; index < 2; index += 1) {
      expect(
        instrumentation.mayRequirePreviewRuntimeSourceInstrumentation(
          '/cache/' + name + '.tsx',
          source,
        ),
      ).toBe(true);
    }
  });

  it('bounds retained entries and recomputes an evicted source', () => {
    const probe = vi.spyOn(deferred, 'instrumentPreviewDeferredUiTriggers');
    const path = '/cache/evicted.tsx';
    instrumentation.mayRequirePreviewRuntimeSourceInstrumentation(path, plainSource);
    for (let index = 0; index < 128; index += 1) {
      instrumentation.mayRequirePreviewRuntimeSourceInstrumentation(
        '/cache/entry-' + String(index) + '.tsx',
        plainSource,
      );
    }
    instrumentation.mayRequirePreviewRuntimeSourceInstrumentation(path, plainSource);
    expect(probe).toHaveBeenCalledTimes(130);
  });

  it('bounds retained source bytes independently from the entry limit', () => {
    const probe = vi.spyOn(deferred, 'instrumentPreviewDeferredUiTriggers');
    const source = plainSource + '/*' + 'x'.repeat(50 * 1024) + '*/';
    for (let index = 0; index < 12; index += 1) {
      instrumentation.mayRequirePreviewRuntimeSourceInstrumentation(
        '/cache/bytes-' + String(index) + '.tsx',
        source,
      );
    }
    instrumentation.mayRequirePreviewRuntimeSourceInstrumentation('/cache/bytes-0.tsx', source);
    expect(probe).toHaveBeenCalledTimes(13);
  });

  it('never retains a large source', () => {
    const probe = vi.spyOn(deferred, 'instrumentPreviewDeferredUiTriggers');
    const source = plainSource + '/*' + 'x'.repeat(64 * 1024) + '*/';
    for (let index = 0; index < 2; index += 1) {
      expect(
        instrumentation.mayRequirePreviewRuntimeSourceInstrumentation('/cache/large.tsx', source),
      ).toBe(false);
    }
    expect(probe).toHaveBeenCalledTimes(2);
  });
});
