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
  const root = fixture.contract.PATHS.workingDirectory;
  /** Rebases only this unit graph; frozen production authority paths remain unchanged. */
  const relocate = (sourcePath: string): string => {
    if (!sourcePath.startsWith(policy.ROOT + '/')) throw new Error('Unexpected fixture root.');
    return root + sourcePath.slice(policy.ROOT.length);
  };
  return {
    ...policy,
    ROOT: root,
    VALIDATOR_PATH: relocate(policy.VALIDATOR_PATH),
    PREFLIGHT_PATH: relocate(policy.PREFLIGHT_PATH),
    ATTEMPT_PATH: relocate(policy.ATTEMPT_PATH),
    TERMINAL_PATH: relocate(policy.TERMINAL_PATH),
    PROFILE_VALIDATION_PATH: relocate(policy.PROFILE_VALIDATION_PATH),
    RUN_EVIDENCE_PATH: relocate(policy.RUN_EVIDENCE_PATH),
    REFERENCE_PATH: relocate(policy.REFERENCE_PATH),
    PRODUCTION_MANIFEST_PATH: relocate(policy.PRODUCTION_MANIFEST_PATH),
    V4_PATHS: {
      ...policy.V4_PATHS,
      preflight: relocate(policy.V4_PATHS.preflight),
      attempt: relocate(policy.V4_PATHS.attempt),
      terminal: relocate(policy.V4_PATHS.terminal),
      profileValidation: relocate(policy.V4_PATHS.profileValidation),
      runEvidence: relocate(policy.V4_PATHS.runEvidence),
      reference: relocate(policy.V4_PATHS.reference),
    },
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
