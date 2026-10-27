/** Verifies that persisted campaign policies are validated before typed dispatch can consume them. */
import { describe, expect, it } from 'vitest';
import { PREVIEW_TSX_CORPUS_ARCHITECTURE_ID } from '../../../src/adapters/node/previewHeadlessTsxCorpusCampaignTypes';
import { isPreviewTsxCorpusFrozenPolicy } from '../../../src/adapters/node/previewTsxCorpusPolicy';

const policy = {
  architectureId: PREVIEW_TSX_CORPUS_ARCHITECTURE_ID,
  classifierVersion: 1,
  engineDigest: 'engine',
  laneCount: 12,
  manifestSha256: 'manifest',
  pipelineDepth: 1,
  policyDigest: 'policy',
  protocolVersion: 3,
  reuseMode: 'persistent-compiler-fresh-browser',
  selectedAt: '2026-10-15T00:00:00.000Z',
  sentinels: [{ digest: 'source', fidelity: 'authored', index: 0 }],
  version: 2,
};

describe('persisted corpus policy boundary', () => {
  it('accepts complete policies for each supported lane count', () => {
    for (const laneCount of [12, 14, 16])
      expect(isPreviewTsxCorpusFrozenPolicy({ ...policy, laneCount })).toBe(true);
  });

  it.each([
    null,
    [],
    { ...policy, version: 3 },
    { ...policy, laneCount: 13 },
    { ...policy, laneCount: '12' },
    { ...policy, laneCount: Symbol('invalid') },
    { ...policy, protocolVersion: 4 },
    { ...policy, pipelineDepth: 2 },
    { ...policy, reuseMode: 'fresh-compiler' },
    { ...policy, sentinels: [null] },
    { ...policy, sentinels: [{ digest: 'source', fidelity: 'authored', index: -1 }] },
  ])('rejects malformed or incompatible persisted input %#', (value) => {
    expect(isPreviewTsxCorpusFrozenPolicy(value)).toBe(false);
  });
});
