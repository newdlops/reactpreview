/** Proves regenerated inputs retain the complete cardinality and semantic regression contracts. */
import { describe, expect, it } from 'vitest';
import {
  AUTHORITY_POLICY,
  validateTrace,
} from '../../scripts/validate-rtcc-preview-complete-route-profile-v3.mjs';
import { requireAuthoritySemanticFailure } from '../../scripts/validation/rtcc-v3-route-semantics.mjs';
import { parseJsonl } from '../../scripts/validation/rtcc-v3-structural-telemetry.mjs';
import { createReconstructedAuthority } from './rtccReconstructedAuthority';

describe('reconstructed RTCC authority fixture', () => {
  it('recreates all structural checks and the original negative contract without historical files', () => {
    const fixture = createReconstructedAuthority(AUTHORITY_POLICY);
    const report = validateTrace(parseJsonl(fixture.bytes), fixture.policy);
    expect(report.structuralResult).toBe('pass');
    expect((report.checks as { passed: boolean }[]).filter((check) => !check.passed)).toEqual([]);
    expect(report.violations).toHaveLength(31);
    expect(report.blockers).toHaveLength(18);
    expect(requireAuthoritySemanticFailure(report)).toBe(true);
    expect(fixture.records).toHaveLength(1530);
    expect(report.inventory).toMatchObject({
      counts: { duplicate: 47, runnable: 681, total: 746, unresolved: 18 },
    });
  });

  it('repairs the UUID cases while preserving blockers and all schema checks', () => {
    const fixture = createReconstructedAuthority(AUTHORITY_POLICY, true);
    const report = validateTrace(fixture.records, fixture.policy);
    expect((report.checks as { passed: boolean }[]).filter((check) => !check.passed)).toEqual([]);
    expect(report.violations).toEqual([]);
    expect(report.blockers).toHaveLength(18);
    expect(report.releaseResult).toBe('no-go');
  });

  it('is deterministic and returns independent records without writing profile files', () => {
    const first = createReconstructedAuthority(AUTHORITY_POLICY);
    const second = createReconstructedAuthority(AUTHORITY_POLICY);
    expect(first.bytes).toBe(second.bytes);
    expect(first.records).not.toBe(second.records);
    expect(Buffer.byteLength(first.bytes)).toBeLessThan(6_037_478);
  });
});
