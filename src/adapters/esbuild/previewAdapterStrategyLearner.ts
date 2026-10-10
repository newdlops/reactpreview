/**
 * Learns which known integration strategy each installed package version needs.
 *
 * Some preview adapters, such as the Tailwind compiler bridge, have several strategies, and which
 * one a release needs used to be decided only by hand-written version rules, so an incompatible
 * release needed an extension update. The learner keeps two kinds of evidence across sessions:
 * exact outcomes of bounded self-test compiles per package version and strategy, and a tiny online
 * logistic model per strategy over static package-metadata features, so an unseen version is tried
 * first with the strategy that similar versions needed. The model only reorders candidates; callers
 * still verify a strategy before relying on it, and never drop the rule-selected strategy unless its
 * own self-test failed. It chooses among existing strategies and cannot invent a new one.
 *
 * An optional read-only seed, measured offline against real releases, sits under the local evidence:
 * local outcomes override seed outcomes, and local heads learn a residual on top of the seed heads,
 * so a fresh install starts pre-trained while a later seed still reaches existing users.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SCHEMA_VERSION = 1;
const MAX_OUTCOMES = 256;
const LEARNING_RATE = 0.35;
const L2 = 0.001;
const WEIGHT_LIMIT = 6;
const SEPARATOR = '|';

/** Exact self-test outcome for one package version and strategy. */
export interface PreviewAdapterStrategyOutcome {
  /** Milliseconds since the epoch when the outcome was measured. */
  readonly at: number;
  readonly passed: boolean;
}

/** Trainable logistic head of one strategy. */
export interface PreviewAdapterStrategyHead {
  bias: number;
  updates: number;
  weights: number[];
}

/** Persisted learner document; the shipped seed uses the same shape. */
export interface PreviewAdapterStrategyDocument {
  readonly heads: Record<string, PreviewAdapterStrategyHead>;
  readonly outcomes: Record<string, PreviewAdapterStrategyOutcome>;
  readonly schema: number;
}

/** Construction options; omitting the store path keeps learning in memory for one process. */
export interface PreviewAdapterStrategyLearnerOptions {
  /** JSON file in extension global storage, outside every project and the dependency store. */
  readonly storePath?: string;
  /** Test clock. */
  readonly now?: () => number;
  /** Read-only evidence measured offline; never written to the store. */
  readonly seed?: PreviewAdapterStrategyDocument;
}

/** Remembers verified strategies per package version and ranks strategies for unseen versions. */
export class PreviewAdapterStrategyLearner {
  private readonly document: PreviewAdapterStrategyDocument;
  private readonly now: () => number;

  /**
   * Loads previous evidence; a missing, unreadable, or foreign file starts neutral.
   *
   * @param options Optional persistent store path and clock.
   */
  public constructor(private readonly options: PreviewAdapterStrategyLearnerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.document = readDocument(options.storePath) ?? createEmptyDocument();
  }

  /**
   * Reads the verified outcome of one strategy for one exact package version.
   *
   * @param family Adapter family such as `tailwind`.
   * @param packageKey Exact `name@version` identity of the adapted package.
   * @param strategy Strategy identifier.
   * @returns `true`/`false` when measured before, otherwise `undefined`.
   */
  public readOutcome(family: string, packageKey: string, strategy: string): boolean | undefined {
    const key = [family, packageKey, strategy].join(SEPARATOR);
    return this.document.outcomes[key]?.passed ?? this.options.seed?.outcomes[key]?.passed;
  }

  /**
   * Orders candidate strategies: verified passes, unverified by model score, verified failures.
   *
   * @param family Adapter family.
   * @param packageKey Exact package version identity.
   * @param features Static package-metadata features with a family-specific fixed length.
   * @param strategies Candidates in rule order, which also breaks score ties.
   * @returns The same strategies, reordered.
   */
  public rank(
    family: string,
    packageKey: string,
    features: readonly number[],
    strategies: readonly string[],
  ): readonly string[] {
    const scored = strategies.map((strategy, index) => {
      const outcome = this.readOutcome(family, packageKey, strategy);
      const tier = outcome === true ? 0 : outcome === false ? 2 : 1;
      return { index, score: this.score(family, strategy, features), strategy, tier };
    });
    scored.sort(
      (left, right) =>
        left.tier - right.tier ||
        (left.tier === 1 ? right.score - left.score : 0) ||
        left.index - right.index,
    );
    return scored.map(({ strategy }) => strategy);
  }

  /**
   * Model probability that a strategy works for a package with these features.
   *
   * @param family Adapter family.
   * @param strategy Strategy identifier.
   * @param features Static package-metadata features.
   * @returns Probability in (0, 1); 0.5 for a strategy that has never been measured.
   */
  public score(family: string, strategy: string, features: readonly number[]): number {
    return sigmoid(this.logit([family, strategy].join(SEPARATOR), features));
  }

  /**
   * Returns a JSON-safe copy of the local evidence, for building a seed offline.
   *
   * @returns Local outcomes and heads; the seed is not included.
   */
  public exportDocument(): PreviewAdapterStrategyDocument {
    return JSON.parse(JSON.stringify(this.document)) as PreviewAdapterStrategyDocument;
  }

  /** Seed head logit plus the local residual; a head trained on other features is ignored. */
  private logit(headKey: string, features: readonly number[]): number {
    const seedHead = this.options.seed?.heads[headKey];
    const localHead = this.document.heads[headKey];
    let value = 0;
    if (seedHead?.weights.length === features.length) {
      value += seedHead.bias + dot(seedHead.weights, features);
    }
    if (localHead?.weights.length === features.length) {
      value += localHead.bias + dot(localHead.weights, features);
    }
    return value;
  }

  /**
   * Records one self-test outcome, trains the strategy head, and persists the evidence.
   *
   * @param family Adapter family.
   * @param packageKey Exact package version identity.
   * @param features Static package-metadata features.
   * @param strategy Strategy that was tested.
   * @param passed Whether its self-test produced the expected output.
   */
  public record(
    family: string,
    packageKey: string,
    features: readonly number[],
    strategy: string,
    passed: boolean,
  ): void {
    const outcomes = this.document.outcomes;
    outcomes[[family, packageKey, strategy].join(SEPARATOR)] = { at: this.now(), passed };
    pruneOutcomes(outcomes);
    const heads = this.document.heads;
    const headKey = [family, strategy].join(SEPARATOR);
    const head = (heads[headKey] ??= {
      bias: 0,
      updates: 0,
      weights: features.map(() => 0),
    });
    if (head.weights.length !== features.length) head.weights = features.map(() => 0);
    const error = (passed ? 1 : 0) - sigmoid(this.logit(headKey, features));
    head.bias = clamp(head.bias + LEARNING_RATE * error);
    head.weights = head.weights.map((weight, index) =>
      clamp(weight + LEARNING_RATE * (error * (features[index] ?? 0) - L2 * weight)),
    );
    head.updates += 1;
    this.persist();
  }

  /** Writes the document atomically; storage failures leave in-memory learning intact. */
  private persist(): void {
    const storePath = this.options.storePath;
    if (storePath === undefined) return;
    try {
      mkdirSync(path.dirname(storePath), { recursive: true });
      const temporaryPath = `${storePath}.${String(process.pid)}.tmp`;
      writeFileSync(temporaryPath, JSON.stringify(this.document), 'utf8');
      renameSync(temporaryPath, storePath);
    } catch {
      // Learning is an optimization; a read-only profile simply relearns next session.
    }
  }
}

/** Reads and validates a persisted document. */
function readDocument(storePath: string | undefined): PreviewAdapterStrategyDocument | undefined {
  if (storePath === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(storePath, 'utf8'));
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || parsed.schema !== SCHEMA_VERSION) return undefined;
  const document = createEmptyDocument();
  const outcomes = document.outcomes;
  for (const [key, value] of Object.entries(isRecord(parsed.outcomes) ? parsed.outcomes : {})) {
    if (isRecord(value) && typeof value.passed === 'boolean' && typeof value.at === 'number') {
      outcomes[key] = { at: value.at, passed: value.passed };
    }
  }
  pruneOutcomes(outcomes);
  for (const [key, value] of Object.entries(isRecord(parsed.heads) ? parsed.heads : {})) {
    if (
      isRecord(value) &&
      typeof value.bias === 'number' &&
      typeof value.updates === 'number' &&
      Array.isArray(value.weights) &&
      value.weights.every((weight) => typeof weight === 'number' && Number.isFinite(weight))
    ) {
      document.heads[key] = {
        bias: clamp(value.bias),
        updates: value.updates,
        weights: (value.weights as number[]).map(clamp),
      };
    }
  }
  return document;
}

/** Keeps the most recent outcomes within the bound. */
function pruneOutcomes(outcomes: Record<string, PreviewAdapterStrategyOutcome>): void {
  const keys = Object.keys(outcomes);
  if (keys.length <= MAX_OUTCOMES) return;
  keys
    .sort((left, right) => (outcomes[left]?.at ?? 0) - (outcomes[right]?.at ?? 0))
    .slice(0, keys.length - MAX_OUTCOMES)
    .forEach((key) => Reflect.deleteProperty(outcomes, key));
}

/** Creates a neutral document. */
function createEmptyDocument(): PreviewAdapterStrategyDocument {
  return { heads: {}, outcomes: {}, schema: SCHEMA_VERSION };
}

/** Dot product over the shorter vector. */
function dot(weights: readonly number[], features: readonly number[]): number {
  return weights.reduce((sum, weight, index) => sum + weight * (features[index] ?? 0), 0);
}

/** Logistic function. */
function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

/** Bounds one weight. */
function clamp(value: number): number {
  return Math.max(-WEIGHT_LIMIT, Math.min(WEIGHT_LIMIT, Number.isFinite(value) ? value : 0));
}

/** Reports a plain JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
