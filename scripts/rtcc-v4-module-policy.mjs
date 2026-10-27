/** Preserves frozen V4 validator module identities; reconstructed unit fixtures bind separate real hashes. */
export const V4_MODULE_BINDINGS = Object.freeze(
  [
    {
      path: 'scripts/rtcc-v4-authority-policy.mjs',
      sha256: '51d4584034c78cf2b97b18d854215a4067f9e74dcb3078c83e9a2c284801b550',
    },
    {
      path: 'scripts/rtcc-v4-execution-evidence.mjs',
      sha256: '3fb19c44f23372e820995516cc1a0ee65d36f275db6524e727d67d4635f286ba',
    },
    {
      path: 'scripts/rtcc-v4-compact-validation.mjs',
      sha256: '627bfcc3d4070a45c48b62959f5f318bc0135cd32690811af0243eb68ec29a9a',
    },
    {
      path: 'scripts/validation/rtcc-v3-structural-telemetry.mjs',
      sha256: 'ab5405405dd04ab3ee909029097a7319f1c43ec78a3e11ed790b97835ab0442c',
    },
    {
      path: 'scripts/validation/rtcc-v3-inventory-execution-plan.mjs',
      sha256: '076141d2723a24f14d49898a442c4cbc410f0690948060c463be5a826d4d3fb9',
    },
    {
      path: 'scripts/validation/rtcc-v3-route-semantics.mjs',
      sha256: '2f930258a9f3ffa0f0ee2efc4746e9ec4f766103d0e1a8c8f822f40bd2676b0d',
    },
  ].map((binding) => Object.freeze(binding)),
);
