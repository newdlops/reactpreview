/**
 * Verifies transport of extension-generated callable return values through Inspector Smart Fill.
 *
 * This behavior is kept separate from the broad runtime-fallback suite because it defines a narrow
 * compiler/runtime protocol: the Inspector may serialize generated functions, but must never erase
 * a tuple or object return contract that reached project render code.
 */
import { describe, expect, it } from 'vitest';
import {
  PREVIEW_INSPECTOR_CALL_RESULT_TEMPLATE_KEY,
  PREVIEW_INSPECTOR_PROMISE_RESULT_TEMPLATE_KEY,
} from '../../../../src/adapters/esbuild/pageInspector/previewInspectorBlockerValueRuntimeSource';
import {
  PREVIEW_RUNTIME_CALL_RESULT_MARKER_KEY,
  PREVIEW_RUNTIME_PROMISE_RESULT_MARKER_KEY,
} from '../../../../src/adapters/esbuild/staticResources/previewRuntimeCallableFallback';
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

  /** Retains both a generated mutation payload and its Promise return contract. */
  it('preserves generated Promise callables through Smart Fill materialization', async () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      hookName: 'useBaseMutation',
      requiredPaths: ['0()'],
    };
    const result = Object.freeze({ data: Object.freeze({ documentFile: null }) });
    const mutate = (): Promise<typeof result> => Promise.resolve(result);
    Object.defineProperty(mutate, Symbol.for(PREVIEW_RUNTIME_CALL_RESULT_MARKER_KEY), {
      value: result,
    });
    Object.defineProperty(mutate, Symbol.for(PREVIEW_RUNTIME_PROMISE_RESULT_MARKER_KEY), {
      value: true,
    });
    const callable = Object.freeze(mutate);

    fixture.api.resolve(
      () => {
        throw new Error('mutation context unavailable');
      },
      () => [callable],
      metadata,
    );
    const draft = JSON.parse(JSON.stringify(fixture.api.draft('hook-1'))) as readonly unknown[];
    expect(draft).toEqual([
      {
        [PREVIEW_INSPECTOR_PROMISE_RESULT_TEMPLATE_KEY]: {
          data: { documentFile: null },
        },
      },
    ]);

    fixture.api.set('hook-1', draft);
    const manual = fixture.api.resolve(
      () => null,
      () => [],
      metadata,
    ) as readonly [() => Promise<typeof result>];
    await expect(manual[0]()).resolves.toEqual(result);
  });
});
