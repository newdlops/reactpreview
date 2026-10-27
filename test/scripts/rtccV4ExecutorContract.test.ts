/** Verifies reconstructed executor contracts remain read-only and reject missing or drifted inputs. */
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import * as executor from '../../scripts/rtcc-v4-executor-contract.mjs';
import { V4_MODULE_BINDINGS } from '../../scripts/rtcc-v4-module-policy.mjs';
import * as originalPolicy from '../../scripts/validation/rtcc-v3-official-policy.mjs';
import { parsePreviewCompleteRouteInventoryProfileArguments } from '../../src/adapters/node/previewCompleteRouteInventoryProfileCli';
import {
  getV4ReconstructedArchive,
  readV4ReconstructedFile,
} from '../support/rtccV4ReconstructedArchive';

const fixture = getV4ReconstructedArchive(executor, originalPolicy);
const contract = fixture.contract;
const paths = contract.PATHS;
const sourceHash = createHash('sha256')
  .update(readV4ReconstructedFile(paths.executor))
  .digest('hex');

/** Supplies captured observations for simulated inputs without querying or changing processes. */
function prospectiveState(): Record<string, unknown> {
  return {
    state: {
      profileRoot: { exists: false },
      trace: { exists: false },
      processInspection: { exactMatchingCount: 0 },
    },
    frozenLineage: {
      authority: {
        root: {
          path: paths.frozenAuthorityRoot,
          realpath: paths.frozenAuthorityRoot,
          type: 'directory',
          symlink: false,
          entries: ['profile.jsonl'],
        },
        trace: {
          path: paths.frozenAuthorityTrace,
          realpath: paths.frozenAuthorityTrace,
          type: 'regular-file',
          symlink: false,
          sha256: contract.BINDINGS.frozenAuthoritySha256,
          byteCount: contract.FROZEN_AUTHORITY_IDENTITY.byteCount,
          lineCount: contract.FROZEN_AUTHORITY_IDENTITY.lineCount,
          finalLf: true,
        },
      },
    },
  };
}

describe('reconstructed V4 executor evidence contract', () => {
  it('keeps the reconstructed 22-token materialization vector valid for the maintained CLI', () => {
    const vector = executor.EXPECTED_ARGUMENT_VECTOR;
    expect(vector).toHaveLength(22);
    const parsed = parsePreviewCompleteRouteInventoryProfileArguments(vector.slice(2));
    expect(parsed.profileRoot).toBe(executor.PATHS.profileRoot);
    expect(parsed.productionAggregate).toBe(executor.BINDINGS.productionManifestSha256);
    expect(parsed.resolutionConfinement.sourceManifestDigest).toBe(vector[13]);
    expect(parsed.resolutionConfinement.dependencyViewDigest).toBe(vector[15]);
    expect(parsed.resolutionConfinement.policyDigest).toBe(vector[17]);
  });

  it('preserves immutable archived module identities outside the reconstructed test graph', () => {
    expect(V4_MODULE_BINDINGS).toHaveLength(6);
    expect(V4_MODULE_BINDINGS).toContainEqual({
      path: 'scripts/validation/rtcc-v3-structural-telemetry.mjs',
      sha256: 'ab5405405dd04ab3ee909029097a7319f1c43ec78a3e11ed790b97835ab0442c',
    });
    expect(Object.isFrozen(V4_MODULE_BINDINGS)).toBe(true);
    expect(V4_MODULE_BINDINGS.every(Object.isFrozen)).toBe(true);
  });

  it('rejects unknown historical hashes before invoking either read-only port', () => {
    const read = vi.fn((path: string) => Buffer.from(path));
    const exists = vi.fn(() => false);
    const incomplete = executor.createExecutorContract({ read, exists });
    expect(() => incomplete.buildProspectivePreflightFacts({}, sourceHash)).toThrow(
      'executor-historical-bindings-unavailable',
    );
    expect(read).not.toHaveBeenCalled();
    expect(exists).not.toHaveBeenCalled();
  });

  it('builds and validates exact reviewed facts using the regenerated input identities', () => {
    const facts = contract.buildProspectivePreflightFacts(prospectiveState(), sourceHash);
    const reviewed = {
      schemaVersion: 1,
      kind: 'rtcc-preview-reviewed-profile-preflight',
      release: 'v5.5.33',
      solReview: { status: 'PASS', recordedAt: '2026-08-01T00:00:00.000Z' },
      ...facts,
    };
    expect(contract.assertReviewedPreflightSchema(reviewed)).toBe(true);
    expect(facts.observedZeroState.dryRunFilesystemWriteCount).toBe(0);
    expect(facts.observedZeroState.dryRunProfileSpawnApiInvocationCount).toBe(0);
  });

  it('rejects a captured state that already contains the future profile root', () => {
    const state = prospectiveState();
    state.state = {
      profileRoot: { exists: true },
      trace: { exists: false },
      processInspection: { exactMatchingCount: 0 },
    };
    expect(() => contract.buildProspectivePreflightFacts(state, sourceHash)).toThrow(
      'executor-prospective-state-invalid',
    );
  });

  it('rejects a declared route-test hash that disagrees with the supplied source bytes', () => {
    const drifted = executor.createExecutorContract({
      paths,
      bindings: { ...contract.BINDINGS, routePatternTestSha256: '0'.repeat(64) },
      argumentVector: contract.EXPECTED_ARGUMENT_VECTOR,
      frozenAuthorityIdentity: contract.FROZEN_AUTHORITY_IDENTITY,
      read: readV4ReconstructedFile,
      exists: () => false,
    });
    expect(() => drifted.buildProspectivePreflightFacts(prospectiveState(), sourceHash)).toThrow(
      'executor-identity-binding-drift:routePatternTest',
    );
  });
});
