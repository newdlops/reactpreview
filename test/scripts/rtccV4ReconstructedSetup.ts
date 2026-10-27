/** Rebinds only the V4 unit graph to newly generated inputs with their actual byte hashes. */
import { vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getV4ReconstructedArchive } from '../support/rtccV4ReconstructedArchive';

vi.mock('../../scripts/rtcc-v4-module-policy.mjs', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../scripts/rtcc-v4-module-policy.mjs')>();
  return {
    V4_MODULE_BINDINGS: original.V4_MODULE_BINDINGS.map(({ path }) => ({
      path,
      sha256: createHash('sha256')
        .update(readFileSync(new URL('../../' + path, import.meta.url)))
        .digest('hex'),
    })),
  };
});

vi.mock('../../scripts/rtcc-v4-executor-contract.mjs', async (importOriginal) => {
  const executor =
    await importOriginal<typeof import('../../scripts/rtcc-v4-executor-contract.mjs')>();
  const policy = await vi.importActual<
    typeof import('../../scripts/validation/rtcc-v3-official-policy.mjs')
  >('../../scripts/validation/rtcc-v3-official-policy.mjs');
  return { ...executor, ...getV4ReconstructedArchive(executor, policy).contract };
});

vi.mock('../../scripts/rtcc-v4-authority-policy.mjs', async (importOriginal) => {
  const policy =
    await importOriginal<typeof import('../../scripts/rtcc-v4-authority-policy.mjs')>();
  const fixture = getV4ReconstructedArchive();
  const bindings = fixture.contract.BINDINGS;
  return {
    ...policy,
    PLAN_SHA256: bindings.planSha256,
    PRODUCTION_SHA256: bindings.productionManifestSha256,
    REFERENCE_SHA256: fixture.referenceSha256,
    REFERENCE_BLOCKERS_SHA256: fixture.blockersSha256,
    AUTHORITY_POLICY: {
      ...policy.AUTHORITY_POLICY,
      structural: {
        ...policy.AUTHORITY_POLICY.structural,
        header: {
          ...policy.AUTHORITY_POLICY.structural.header,
          productionAggregate: bindings.productionManifestSha256,
        },
      },
      inventory: {
        ...policy.AUTHORITY_POLICY.inventory,
        mountFallbackEvidenceDigest: fixture.mountFallbackEvidenceDigest,
      },
    },
  };
});
