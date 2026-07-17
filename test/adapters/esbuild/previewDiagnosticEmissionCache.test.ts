/** Verifies bounded one-time admission for informational compiler warnings. */
import { describe, expect, it } from 'vitest';
import { PreviewDiagnosticEmissionCache } from '../../../src/adapters/esbuild/previewDiagnosticEmissionCache';

describe('PreviewDiagnosticEmissionCache', () => {
  /** Emits each identity once until compiler shutdown clears the host-session memory. */
  it('suppresses repeated advisories and resets explicitly', () => {
    const cache = new PreviewDiagnosticEmissionCache();

    expect(cache.admit('missing-ancestor:target')).toBe(true);
    expect(cache.admit('missing-ancestor:target')).toBe(false);
    expect(cache.admit('missing-ancestor:other')).toBe(true);
    cache.clear();
    expect(cache.admit('missing-ancestor:target')).toBe(true);
  });
});
