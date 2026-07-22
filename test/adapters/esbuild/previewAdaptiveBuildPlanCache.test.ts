/** Verifies immutable adaptive evidence reused before native hot rebuilds begin. */
import { describe, expect, it } from 'vitest';
import { PreviewAdaptiveBuildPlanCache } from '../../../src/adapters/esbuild/previewAdaptiveBuildPlanCache';

describe('PreviewAdaptiveBuildPlanCache', () => {
  /** Normalizes reached portal hosts together with router and lexical-global requirements. */
  it('retains a stable portal host plan for the next revision', () => {
    const cache = new PreviewAdaptiveBuildPlanCache();
    cache.write('target', {
      legacyCommonJsGlobalNames: ['txt', 'txt'],
      portalHostIds: ['toast-root', 'dim-root', 'toast-root'],
      referencedGlobalNames: ['dayjs', 'dayjs'],
      routerRequirement: { consumesRouter: true, ownsRouter: false },
    });

    expect(cache.read('target')).toEqual({
      legacyCommonJsGlobalNames: ['txt'],
      portalHostIds: ['dim-root', 'toast-root'],
      referencedGlobalNames: ['dayjs'],
      routerRequirement: { consumesRouter: true, ownsRouter: false },
    });
  });
});
