/** Verifies that only machine-independent release measurements enter the shipped seed. */
import { describe, expect, it } from 'vitest';
import { createPreviewAdapterStrategySeed } from '../../../src/adapters/node/previewTailwindStrategyMatrix';
import { PREVIEW_TAILWIND_STRATEGY_FAMILY as FAMILY } from '../../../src/adapters/esbuild/previewTailwindStrategySelection';

describe('createPreviewAdapterStrategySeed', () => {
  /** Passes and release-specific failures are seeded; native-binary failures stay local. */
  it('seeds passes and machine-independent failures only', () => {
    const pipeline = { checks: {}, durationMs: 0, warnings: [] };
    const seed = createPreviewAdapterStrategySeed([
      {
        features: [0.4, 0, 1, 1, 0, 0, 1],
        measurements: [
          { durationMs: 9, environmentIndependent: true, passed: true, strategy: 'v4-postcss' },
          {
            durationMs: 1,
            environmentIndependent: true,
            error:
              'It looks like you are trying to use `tailwindcss` directly as a PostCSS plugin.',
            passed: false,
            strategy: 'legacy-content',
          },
        ],
        boundedPipeline: pipeline,
        packageKey: 'tailwindcss@4.1.0',
        pipeline,
        version: '4.1.0',
      },
      {
        features: [0.4, 0, 1, 1, 0, 0, 1],
        measurements: [
          {
            durationMs: 7,
            environmentIndependent: false,
            error: 'Missing field `negated` on ScannerOptions.sources',
            passed: false,
            strategy: 'v4-postcss-scan',
          },
        ],
        boundedPipeline: pipeline,
        packageKey: 'tailwindcss@4.0.0',
        pipeline,
        version: '4.0.0',
      },
    ]);

    expect(seed.outcomes).toEqual({
      [`${FAMILY}|tailwindcss@4.1.0|legacy-content`]: { at: 0, passed: false },
      [`${FAMILY}|tailwindcss@4.1.0|v4-postcss`]: { at: 0, passed: true },
    });
    expect(Object.keys(seed.heads).sort()).toEqual([
      `${FAMILY}|legacy-content`,
      `${FAMILY}|v4-postcss`,
    ]);
  });
});
