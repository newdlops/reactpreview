import { describe, expect, it } from 'vitest';
import {
  createPreviewCompilerFrontierPolicy,
  exceedsPreviewCompilerFrontier,
} from '../../src/domain/previewCompilerFrontier';

describe('preview compiler frontier policy', () => {
  it('uses the documented automatic limits and leaves full mode unrestricted', () => {
    expect(createPreviewCompilerFrontierPolicy('fast')).toMatchObject({
      maximumOptionalComponentIdentityCount: 192,
      maximumComponentDepth: 40,
      maximumTotalAuthoredModuleCount: 512,
      softMaximumTotalAuthoredModuleCount: 384,
    });
    expect(createPreviewCompilerFrontierPolicy('corridor')).toMatchObject({
      maximumOptionalComponentIdentityCount: 384,
      maximumComponentDepth: 64,
      maximumTotalAuthoredModuleCount: 1_024,
      softMaximumTotalAuthoredModuleCount: 768,
    });
    expect(createPreviewCompilerFrontierPolicy('full')).toBeUndefined();
  });

  it('preflights only automatic graphs already beyond their total-module contract', () => {
    const fast = createPreviewCompilerFrontierPolicy('fast');
    expect(exceedsPreviewCompilerFrontier({ corridorSourceCount: 512 }, fast)).toBe(false);
    expect(exceedsPreviewCompilerFrontier({ corridorSourceCount: 513 }, fast)).toBe(true);
    expect(exceedsPreviewCompilerFrontier({ corridorSourceCount: 10_000 }, undefined)).toBe(false);
  });
});
