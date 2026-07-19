/** Verifies strict source editing and explicit cross-analyzer overlap reconciliation. */
import { describe, expect, it } from 'vitest';
import {
  applyPreviewSourceReplacements,
  PreviewSourceTransformError,
  selectCompatiblePreviewSourceReplacements,
  type PreviewSourceReplacement,
} from '../../../../src/adapters/esbuild/staticResources/previewSourceReplacement';

describe('preview source replacement policy', () => {
  /** Keeps strict callers able to detect uncoordinated overlapping analyzer output. */
  it('rejects overlaps when edits are applied without an explicit compatibility policy', () => {
    expect(() =>
      applyPreviewSourceReplacements('useContext(AppContext)', [
        createReplacement(0, 22, 'contextFallback()'),
        createReplacement(0, 22, 'runtimeHookFallback()'),
      ]),
    ).toThrow(PreviewSourceTransformError);
  });

  /** Keeps the first dedicated analyzer when two transforms own the exact same call range. */
  it('deduplicates exact ranges using deterministic analyzer discovery order', () => {
    const context = createReplacement(0, 22, 'contextFallback()');
    const runtime = createReplacement(0, 22, 'runtimeHookFallback()');

    expect(selectCompatiblePreviewSourceReplacements([context, runtime])).toEqual([context]);
  });

  /** Lets a richer proven fallback replace a placeholder only when both own the exact call. */
  it('uses explicit priority to break an exact-range tie', () => {
    const placeholder = createReplacement(0, 22, 'emptyContextFallback()');
    const demandShaped = {
      ...createReplacement(0, 22, 'demandShapedContextFallback()'),
      priority: 1,
    };

    expect(selectCompatiblePreviewSourceReplacements([placeholder, demandShaped])).toEqual([
      demandShaped,
    ]);
  });

  /** Prefers a resource macro nested inside a broader optional hook fallback expression. */
  it('keeps the narrower transform and every disjoint source edit', () => {
    const hook = createReplacement(0, 40, 'hookFallback()');
    const dynamicImport = createReplacement(12, 32, 'boundedImport()');
    const disjoint = createReplacement(44, 49, 'other()');

    expect(selectCompatiblePreviewSourceReplacements([hook, dynamicImport, disjoint])).toEqual([
      dynamicImport,
      disjoint,
    ]);
  });
});

/** Creates one concise replacement fixture with offsets against an imaginary source string. */
function createReplacement(
  start: number,
  end: number,
  replacement: string,
): PreviewSourceReplacement {
  return { end, replacement, start };
}
