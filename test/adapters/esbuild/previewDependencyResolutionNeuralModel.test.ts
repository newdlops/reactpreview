import { describe, expect, it } from 'vitest';
import { PreviewDependencyResolutionNeuralModel } from '../../../src/adapters/esbuild/previewDependencyResolutionNeuralModel';

const FEATURES = {
  declaredPackageRatio: 1,
  errorDensity: 0.5,
  explicitServerBoundary: 0,
  frameworkRuntime: 0,
  jsxConsumer: 1,
  packageCoreRuntime: 0,
  packageServerAffinity: 0,
  packageUiAffinity: 1,
  styleConsumer: 0,
  targetModule: 0,
  useServerDirective: 0,
};

describe('PreviewDependencyResolutionNeuralModel', () => {
  /** Keeps a neutral model subordinate to deterministic safety evidence. */
  it('scores only an admitted action and preserves its bounded feature vector', () => {
    const model = new PreviewDependencyResolutionNeuralModel();
    const score = model.score('acquire-package', FEATURES, 0.9);

    expect(score).toMatchObject({
      action: 'acquire-package',
      modelScore: 0.5,
      updates: 0,
    });
    expect(score.featureVector).toHaveLength(11);
    expect(score.selectionScore).toBeGreaterThan(0.75);
  });

  /** Learns from verified acquisition outcomes without changing the isolated facade head. */
  it('updates only the package head after a compiler-verified result', () => {
    const model = new PreviewDependencyResolutionNeuralModel();
    const packageScore = model.score('acquire-package', FEATURES, 0.7);
    const facadeBefore = model.score('facade-server-contract', FEATURES, 0.7);

    for (let index = 0; index < 5; index += 1) {
      model.recordOutcome(packageScore, true);
    }

    expect(model.score('acquire-package', FEATURES, 0.7).modelScore).toBeGreaterThan(0.5);
    expect(model.score('facade-server-contract', FEATURES, 0.7).modelScore).toBe(
      facadeBefore.modelScore,
    );
    expect(model.score('facade-package-contract', FEATURES, 0.7).modelScore).toBe(0.5);
    expect(model.score('facade-style-contract', FEATURES, 0.7).modelScore).toBe(0.5);
    expect(model.updates).toBe(5);
  });
});
