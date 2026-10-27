/** Verifies native-leaf repair cannot widen ordinary collection demand or exceed parser bounds. */
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { mergePreviewRuntimeHookCollectionContracts } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookCollectionContract';
import { createPreviewGeneratedListExpression } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookUsageTree';

describe('native collection contract repair', () => {
  /** Local native behavior wins at the exact path, while the selected child contract owns text. */
  it('repairs an existing native leaf without retaining unrelated local fields', () => {
    const preferred = `Object.freeze({ title: "Selected title", routes: ${createPreviewGeneratedListExpression('"route"')} })`;
    const local = `Object.freeze({ title: "Discarded title", extra: true, routes: ${createPreviewGeneratedListExpression('new RegExp(".*")')} })`;
    const expression = mergePreviewRuntimeHookCollectionContracts(preferred, [local]);
    expect(expression).toBeDefined();
    const value = runInNewContext(`(${expression ?? 'undefined'})`) as {
      readonly routes: readonly RegExp[];
      readonly title: string;
    };

    expect(value.title).toBe('Selected title');
    expect(value.routes[0]?.test('/company/1')).toBe(true);
    expect(value).not.toHaveProperty('extra');
    expect(expression).not.toContain('Discarded title');
  });

  /** Optional native paths keep only their structural containers and the required native leaf. */
  it('adds a missing native path without materializing its ordinary optional siblings', () => {
    const preferred = 'Object.freeze({ label: "Page" })';
    const local = `Object.freeze({ optional: Object.freeze({ label: "Unrequested", routes: ${createPreviewGeneratedListExpression('new RegExp(".*")')} }) })`;
    const expression = mergePreviewRuntimeHookCollectionContracts(preferred, [local]);
    const value = runInNewContext(`(${expression ?? 'undefined'})`) as {
      readonly optional: { readonly routes: readonly RegExp[] };
    };

    expect(value.optional.routes[0]?.test('/company/1')).toBe(true);
    expect(value.optional).not.toHaveProperty('label');
  });

  /** Ordinary contracts keep the previous selection without any extra parsing or broad merge. */
  it('leaves collections without native evidence on the existing selection path', () => {
    expect(
      mergePreviewRuntimeHookCollectionContracts('Object.freeze({ id: "one" })', [
        'Object.freeze({ id: "two", additional: true })',
      ]),
    ).toBeUndefined();
  });

  /** Oversized and unsafe compiler shapes fail open to the caller's existing selected item. */
  it('declines oversized or prototype-mutating collection contracts', () => {
    const native = 'Object.freeze({ route: new RegExp(".*") })';
    expect(
      mergePreviewRuntimeHookCollectionContracts(
        `Object.freeze({ label: ${JSON.stringify('x'.repeat(64 * 1024))} })`,
        [native],
      ),
    ).toBeUndefined();
    expect(
      mergePreviewRuntimeHookCollectionContracts('Object.freeze({ "__proto__": 1 })', [native]),
    ).toBeUndefined();
  });
});
