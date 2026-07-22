/** Verifies pre-build split/coalesced selection without allocating native esbuild output graphs. */
import { describe, expect, it } from 'vitest';
import { PreviewOutputStrategyCache } from '../../../src/adapters/esbuild/previewOutputStrategyCache';

describe('PreviewOutputStrategyCache', () => {
  /** Every build avoids speculative split-file allocation; dynamic initializers remain lazy. */
  it('coalesces every preview mode before native output allocation', () => {
    const cache = new PreviewOutputStrategyCache();

    expect(cache.shouldSplit()).toBe(false);
  });

  /** A component gallery reuses overflow evidence after its first bounded split attempt. */
  it('coalesces a gallery plan after split overflow is recorded', () => {
    const cache = new PreviewOutputStrategyCache();
    cache.write('large-gallery', 2049);

    expect(cache.shouldSplit()).toBe(false);
    expect(cache.read('large-gallery')).toEqual({ splitOutputCount: 2049 });
  });
});
