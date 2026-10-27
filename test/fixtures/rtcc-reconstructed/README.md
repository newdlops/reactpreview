# Reconstructed RTCC inputs

These are unit-test fixtures, not recovered historical execution evidence.

- `v2-failure-lineage.json` was recreated from the retained canonical V2 contract. Its bytes must
  remain single-line canonical JSON with a final LF. The validator test checks the complete bytes
  and rejects a changed run count, so this one file is excluded from Prettier.
- `v2-production-SHA256SUMS` contains 35 simulated production input identities. Its SHA-256 is
  `a085ec299ed7d34059512844e01d1b9d1ddc53e7bba58a156af99fdd76d5a913`.
  The test separately preserves the old manifest identity and rejects these new bytes in official
  mode.

V3/V4 traces and their referenced input bytes are generated in memory. See
[the reconstruction notes](../../../docs/rtcc-verification-reconstruction.md).
