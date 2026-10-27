/** Covers schemas behavior for validateRtccPreviewCompleteRouteProfileV3. */
/** Verifies authored-source validateRtccPreviewCompleteRouteProfileV3 invariants. */
import './rtccReconstructedSetup';
import { rmSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  MountedSchemaFixtureEntry,
  SchemaFixtureCheck,
  SchemaFixtureEntry,
  SchemaFixtureEvidence,
  SchemaFixturePayload,
} from './rtccV3SchemaFixtureTypes';

import {
  assertEvidenceSchema,
  assertProfileValidationSchema,
  assertSemanticReportSchema,
  persistOfficialArtifacts,
} from '../../scripts/validation/rtcc-v3-official-artifacts.mjs';

import {
  checkFailed,
  expectBodyRejectedBeforeWrite,
  officialBody,
  outputNames,
  persistedArtifacts,
  readAuthorityFixture,
  reorderInPlace,
  temporaryDirectories,
} from './validateRtccPreviewCompleteRouteProfileV3Fixtures';

afterEach(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
  temporaryDirectories.clear();
});

describe('complete-route profile v3', () => {
  it.each([
    [
      'profile authority missing',
      'profile',
      (value: SchemaFixturePayload) => {
        delete value.authority.lineCount;
      },
    ],
    [
      'profile authority reorder',
      'profile',
      (value: SchemaFixturePayload) => {
        reorderInPlace(value.authority);
      },
    ],
    [
      'profile nested extra',
      'profile',
      (value: SchemaFixturePayload) => {
        value.inventory.extra = true;
      },
    ],
    [
      'profile authority hash',
      'profile',
      (value: SchemaFixturePayload) => {
        value.authority.sha256 = '0'.repeat(64);
      },
    ],
    [
      'profile inconsistent',
      'profile',
      (value: SchemaFixturePayload) => {
        value.engineTerminal.executionPlanCompleted = 680;
      },
    ],
    [
      'semantic authority missing',
      'semantic',
      (value: SchemaFixturePayload) => {
        delete value.authority.lineCount;
      },
    ],
    [
      'semantic authority reorder',
      'semantic',
      (value: SchemaFixturePayload) => {
        reorderInPlace(value.authority);
      },
    ],
    [
      'semantic nested extra',
      'semantic',
      (value: SchemaFixturePayload) => {
        value.inventory.extra = true;
      },
    ],
    [
      'semantic authority hash',
      'semantic',
      (value: SchemaFixturePayload) => {
        value.authority.sha256 = '0'.repeat(64);
      },
    ],
    [
      'semantic inconsistent',
      'semantic',
      (value: SchemaFixturePayload) => {
        value.violations.pop();
      },
    ],
  ] as const)('rejects exact official payload mutation %s', (_name, kind, mutate) => {
    const run = persistedArtifacts();
    const value = structuredClone(
      kind === 'profile' ? run.artifacts.validation : run.artifacts.semantic,
    ) as SchemaFixturePayload;
    mutate(value);
    const assertion =
      kind === 'profile' ? assertProfileValidationSchema : assertSemanticReportSchema;
    expect(() => assertion(value)).toThrow();
  });

  it.each([
    [
      'header production aggregate',
      (body: SchemaFixturePayload) => {
        body.header.productionAggregate = '0'.repeat(64);
      },
    ],
    [
      'header digest',
      (body: SchemaFixturePayload) => {
        body.header.sourceManifestDigest = '0'.repeat(64);
      },
    ],
    [
      'nested inventory mount',
      (body: SchemaFixturePayload) => {
        (
          body.inventory.entries.find(
            (entry: SchemaFixtureEntry) =>
              entry.disposition === 'runnable' && entry.executionPlan.recipe.mounts.length > 0,
          ) as MountedSchemaFixtureEntry
        ).executionPlan.recipe.mounts[0].basePath = '/forged';
      },
    ],
    [
      'inventory counts',
      (body: SchemaFixturePayload) => {
        body.inventory.counts.runnable = 680;
      },
    ],
    [
      'check name',
      (body: SchemaFixturePayload) => {
        body.checks[0].name = 'forged';
      },
    ],
    [
      'check passed',
      (body: SchemaFixturePayload) => {
        body.checks[0].passed = false;
      },
    ],
    [
      'check detail',
      (body: SchemaFixturePayload) => {
        const check = body.checks.find(
          (item: SchemaFixtureCheck) => item.detail !== undefined,
        ) as Required<SchemaFixtureCheck>;
        check.detail = `${check.detail}-forged`;
      },
    ],
    [
      'check order',
      (body: SchemaFixturePayload) => {
        [body.checks[0], body.checks[1]] = [body.checks[1], body.checks[0]];
      },
    ],
    [
      'violation entry',
      (body: SchemaFixturePayload) => {
        body.violations[0] = {
          ...body.violations[0],
          tokenOffset: body.violations[0].tokenOffset + 1,
        };
      },
    ],
    [
      'first violation',
      (body: SchemaFixturePayload) => {
        body.firstViolation = {
          ...body.firstViolation,
          tokenOffset: body.firstViolation.tokenOffset + 1,
        };
      },
    ],
    [
      'blocker entry',
      (body: SchemaFixturePayload) => {
        body.blockers[0] = { ...body.blockers[0], reason: 'forged' };
      },
    ],
    [
      'first blocker',
      (body: SchemaFixturePayload) => {
        body.firstBlocker = { ...body.firstBlocker, reason: 'forged' };
      },
    ],
    [
      'structural result',
      (body: SchemaFixturePayload) => {
        body.structuralResult = 'fail';
      },
    ],
    [
      'semantic result',
      (body: SchemaFixturePayload) => {
        body.semanticResult = 'pass';
      },
    ],
    [
      'release result',
      (body: SchemaFixturePayload) => {
        body.releaseResult = 'go';
      },
    ],
  ] as const)('rejects forged caller body %s before the first write', (_name, mutate) => {
    expectBodyRejectedBeforeWrite(mutate);
  });

  it('cross-checks evidence output hashes and rejects invalid payloads before any write', () => {
    const run = persistedArtifacts();
    const evidence = structuredClone(run.artifacts.evidence) as SchemaFixtureEvidence;
    evidence.outputHashes.profileValidation = '0'.repeat(64);
    expect(() =>
      assertEvidenceSchema(evidence, {
        gateSha256: run.prepared.gate.sha256,
        moduleHashes: run.prepared.gate.gate.bindings,
        bytes: run.artifacts.bytes.slice(0, 3),
      }),
    ).toThrow();
    const writes: unknown[][] = [];
    const body = officialBody() as SchemaFixturePayload;
    body.authority.sha256 = '0'.repeat(64);
    expect(() =>
      persistOfficialArtifacts({
        paths: outputNames,
        body,
        expectedExitCode: 1,
        gate: run.prepared.gate.gate,
        gateSha256: run.prepared.gate.sha256,
        moduleHashes: run.prepared.gate.gate.bindings,
        predecessors: run.preflight.predecessors,
        invocation: run.preflight.invocation,
        writeFile: (...args: unknown[]) => {
          writes.push(args);
        },
      }),
    ).toThrow('profile-validation-schema-drift');
    expect(writes).toHaveLength(0);
  });

  it('binds exact authority inventory limits and policy digests', async () => {
    const frozen = await vi.importActual<
      typeof import('../../scripts/validate-rtcc-preview-complete-route-profile-v3.mjs')
    >('../../scripts/validate-rtcc-preview-complete-route-profile-v3.mjs');
    expect(frozen.AUTHORITY_POLICY.inventory).toMatchObject({
      maximumAnalysisPasses: 4096,
      maximumBranches: 8192,
      maximumDepth: 64,
      replayPolicyDigest: '274a9aecd52944871f1a88940416e3a2e485490d8d287f0e0235a635c7e89601',
      executionPlanPolicyDigest: 'e0aa9adf1c3c766fb629e7048ef9ee949eeef49a7522e2ede0889d0ced58eb6e',
      mountFallbackEvidenceDigest:
        'd17d8781254638a9e879ece557268d55e155c634694ffbaf6fb03eaf9687f3e7',
    });
    expect(checkFailed(readAuthorityFixture().authorityReport, 'inventory-policy')).toBe(false);
    expect(checkFailed(readAuthorityFixture().authorityReport, 'execution-plan-policy')).toBe(
      false,
    );
  });
});
