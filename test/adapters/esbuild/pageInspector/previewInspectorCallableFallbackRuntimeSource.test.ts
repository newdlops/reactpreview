/**
 * Verifies transport of extension-generated callable return values through Inspector Smart Fill.
 *
 * This behavior is kept separate from the broad runtime-fallback suite because it defines a narrow
 * compiler/runtime protocol: the Inspector may serialize generated functions, but must never erase
 * a tuple or object return contract that reached project render code.
 */
import { describe, expect, it } from 'vitest';
import { PREVIEW_INSPECTOR_CALL_RESULT_TEMPLATE_KEY } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorBlockerValueRuntimeSource';
import { PREVIEW_RUNTIME_CALL_RESULT_MARKER_KEY } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeCallableFallback';
import {
  createMetadata,
  createRuntimeFallbackFixture,
} from './support/previewInspectorRuntimeFallbackFixture';

describe('Preview Inspector generated callable fallback transport', () => {
  /** Retains a generated function's static tuple return through editable Smart Fill JSON. */
  it('preserves generated callable return values through Smart Fill materialization', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      hookName: 'usePagePermissionCheck',
      requiredPaths: ['checkPagePermission()'],
    };
    const tuple = Object.freeze([true, Object.freeze([])]);
    const callable = Object.freeze(
      Object.defineProperty(() => tuple, Symbol.for(PREVIEW_RUNTIME_CALL_RESULT_MARKER_KEY), {
        value: tuple,
      }),
    );

    fixture.api.resolve(
      () => {
        throw new Error('permission context unavailable');
      },
      () => ({ checkPagePermission: callable }),
      metadata,
    );
    const draft = JSON.parse(JSON.stringify(fixture.api.draft('hook-1'))) as Record<
      string,
      unknown
    >;
    expect(draft).toEqual({
      checkPagePermission: {
        [PREVIEW_INSPECTOR_CALL_RESULT_TEMPLATE_KEY]: [true, []],
      },
    });

    fixture.api.set('hook-1', draft);
    const manual = fixture.api.resolve(
      () => null,
      () => ({}),
      metadata,
    ) as { checkPagePermission: () => readonly [boolean, readonly unknown[]] };
    expect(manual.checkPagePermission()).toEqual([true, []]);
  });
});
