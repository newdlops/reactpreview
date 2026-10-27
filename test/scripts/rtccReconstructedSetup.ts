/**
 * Rebinds archive identities only in the V3 unit-test module graph.
 * The production official CLI retains its frozen identities and still rejects missing originals.
 */
import { vi } from 'vitest';
import { getReconstructedArchive } from '../support/rtccReconstructedArchive';

vi.mock('../../scripts/validation/rtcc-v3-official-policy.mjs', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../scripts/validation/rtcc-v3-official-policy.mjs')>();
  return getReconstructedArchive(original).policyExports;
});

vi.mock(
  '../../scripts/validate-rtcc-preview-complete-route-profile-v3.mjs',
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import('../../scripts/validate-rtcc-preview-complete-route-profile-v3.mjs')
      >();
    const fixture = getReconstructedArchive();
    return {
      ...original,
      AUTHORITY_PATH: fixture.policyExports.authorityPathFixed,
      AUTHORITY_SHA256: fixture.authoritySha256,
      AUTHORITY_POLICY: fixture.policyExports.authorityPolicy,
    };
  },
);
