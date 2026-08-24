/**
 * Scores compiler-admitted dependency recovery actions with a tiny online neural residual.
 * The deterministic caller remains responsible for proving exact manifest, importer, style, and
 * server-boundary evidence; this model may only rank the recovery actions admitted by that proof.
 */

const INPUT_SIZE = 11;
const HIDDEN_SIZE = 8;
const LEARNING_RATE = 0.09;
const L2 = 0.0005;
const WEIGHT_LIMIT = 4;

/** Recovery actions whose outcomes are isolated so package failures cannot poison facade hints. */
export type PreviewDependencyResolutionNeuralAction =
  | 'acquire-package'
  | 'facade-package-contract'
  | 'facade-server-contract'
  | 'facade-style-contract';

/** Bounded semantic evidence supplied without project source or package identities. */
export interface PreviewDependencyResolutionNeuralFeatures {
  readonly declaredPackageRatio: number;
  readonly errorDensity: number;
  readonly explicitServerBoundary: number;
  readonly frameworkRuntime: number;
  readonly jsxConsumer: number;
  readonly packageCoreRuntime: number;
  readonly packageServerAffinity: number;
  readonly packageUiAffinity: number;
  readonly styleConsumer: number;
  readonly targetModule: number;
  readonly useServerDirective: number;
}

/** Opaque score retained with a compiler hint for ordering and verified online learning. */
export interface PreviewDependencyResolutionNeuralScore {
  readonly action: PreviewDependencyResolutionNeuralAction;
  readonly featureVector: readonly number[];
  readonly modelScore: number;
  readonly selectionScore: number;
  readonly updates: number;
}

interface MutableOutputHead {
  bias: number;
  outputWeights: number[];
  updates: number;
}

/**
 * Fixed nonlinear projection plus isolated trainable logistic heads.
 *
 * A neutral head contributes only a small residual to the compiler's evidence confidence. This
 * preserves safe first-run behavior while verified acquisition outcomes improve later ordering in
 * the same standalone compiler process.
 */
export class PreviewDependencyResolutionNeuralModel {
  private readonly heads: Record<PreviewDependencyResolutionNeuralAction, MutableOutputHead> = {
    'acquire-package': createHead(),
    'facade-package-contract': createHead(),
    'facade-server-contract': createHead(),
    'facade-style-contract': createHead(),
  };

  /** Returns the bounded model update count across the isolated recovery heads. */
  public get updates(): number {
    return Object.values(this.heads).reduce((sum, head) => sum + head.updates, 0);
  }

  /** Scores one admitted action without retaining its feature vector or semantic identity. */
  public score(
    action: PreviewDependencyResolutionNeuralAction,
    features: PreviewDependencyResolutionNeuralFeatures,
    deterministicConfidence: number,
  ): PreviewDependencyResolutionNeuralScore {
    const featureVector = encodeFeatures(features);
    const hidden = projectFeatures(featureVector);
    const head = this.heads[action];
    const modelScore = logistic(readLogit(head, hidden));
    const evidenceConfidence = clamp01(deterministicConfidence);
    return Object.freeze({
      action,
      featureVector,
      modelScore,
      // Learned evidence can reorder close safe candidates, but cannot admit an unsafe candidate.
      selectionScore: clamp01(evidenceConfidence * 0.68 + modelScore * 0.32),
      updates: head.updates,
    });
  }

  /** Trains only from a compiler-verified acquisition or applied resolver-contract result. */
  public recordOutcome(
    score: PreviewDependencyResolutionNeuralScore,
    successful: boolean,
    confidence = 1,
  ): void {
    const head = this.heads[score.action];
    const hidden = projectFeatures(score.featureVector);
    const prediction = logistic(readLogit(head, hidden));
    const gradient = (prediction - (successful ? 1 : 0)) * clamp01(confidence);
    head.bias = clampWeight(head.bias - LEARNING_RATE * gradient);
    for (let index = 0; index < head.outputWeights.length; index += 1) {
      const weight = head.outputWeights[index] ?? 0;
      head.outputWeights[index] = clampWeight(
        weight - LEARNING_RATE * (gradient * (hidden[index] ?? 0) + L2 * weight),
      );
    }
    head.updates = Math.min(Number.MAX_SAFE_INTEGER, head.updates + 1);
  }
}

/** Converts named evidence to a normalized, fixed-width numeric input. */
function encodeFeatures(features: PreviewDependencyResolutionNeuralFeatures): readonly number[] {
  const vector = [
    features.declaredPackageRatio,
    features.errorDensity,
    features.explicitServerBoundary,
    features.frameworkRuntime,
    features.jsxConsumer,
    features.packageCoreRuntime,
    features.packageServerAffinity,
    features.packageUiAffinity,
    features.styleConsumer,
    features.targetModule,
    features.useServerDirective,
  ].map(clampSigned);
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return Object.freeze(norm > 0 ? vector.map((value) => value / norm) : vector);
}

/** Applies a deterministic projection so the persisted state needs only small output heads. */
function projectFeatures(features: readonly number[]): readonly number[] {
  return Object.freeze(
    Array.from({ length: HIDDEN_SIZE }, (_, hiddenIndex) => {
      let activation = ((hiddenIndex % 3) - 1) * 0.025;
      for (let inputIndex = 0; inputIndex < INPUT_SIZE; inputIndex += 1) {
        activation += (features[inputIndex] ?? 0) * projectionWeight(hiddenIndex, inputIndex);
      }
      return Math.tanh(activation);
    }),
  );
}

/** Produces stable signed projection weights without retaining a dense input matrix. */
function projectionWeight(hiddenIndex: number, inputIndex: number): number {
  const mixed =
    (Math.imul(hiddenIndex + 1, 0x45d9f3b) ^ Math.imul(inputIndex + 3, 0x27d4eb2d)) >>> 0;
  return ((mixed % 2001) / 1000 - 1) * 0.38;
}

/** Evaluates one isolated action head over the shared nonlinear projection. */
function readLogit(head: MutableOutputHead, hidden: readonly number[]): number {
  return hidden.reduce(
    (logit, value, index) => logit + value * (head.outputWeights[index] ?? 0),
    head.bias,
  );
}

/** Maps a bounded action logit to its probability-like neural score. */
function logistic(value: number): number {
  const bounded = Math.max(-20, Math.min(20, value));
  return 1 / (1 + Math.exp(-bounded));
}

/** Creates one neutral trainable action head with explicitly numeric storage. */
function createHead(): MutableOutputHead {
  return { bias: 0, outputWeights: Array<number>(HIDDEN_SIZE).fill(0), updates: 0 };
}

/** Clamps confidence-like values and rejects non-finite inputs. */
function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/** Clamps source feature values to the model's signed input domain. */
function clampSigned(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

/** Prevents online updates from destabilizing a standalone compiler process. */
function clampWeight(value: number): number {
  return Math.max(-WEIGHT_LIMIT, Math.min(WEIGHT_LIMIT, value));
}
