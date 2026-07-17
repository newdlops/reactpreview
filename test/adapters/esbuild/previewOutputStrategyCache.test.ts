/** Verifies bounded hot-reload reuse for targets that previously exceeded split artifact fan-out. */
import { describe, expect, it } from 'vitest';
import { PreviewOutputStrategyCache } from '../../../src/adapters/esbuild/previewOutputStrategyCache';

describe('PreviewOutputStrategyCache', () => {
  /** Retains immutable split evidence, refreshes reads, and clears all host-session identities. */
  it('remembers and clears coalesced target strategies', () => {
    const cache = new PreviewOutputStrategyCache();

    cache.write('target-a', 2400);
    expect(cache.read('target-a')).toEqual({ splitOutputCount: 2400 });
    expect(Object.isFrozen(cache.read('target-a'))).toBe(true);

    cache.clear();
    expect(cache.read('target-a')).toBeUndefined();
  });
});
