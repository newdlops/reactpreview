/**
 * Chooses the Tailwind compile strategy for the installed package version with adapter learning.
 *
 * The version rules pick a strategy first (v4 PostCSS adapter, then the v2/v3 plugin with the
 * `content` or `purge` key). With a learner, a strategy is used without testing only when a previous
 * bounded self-test already proved it for this exact package version. Otherwise the rule pick is
 * self-tested first and kept when it passes; only when it fails are the remaining strategies tried
 * in the learned order. A version whose rule pick broke therefore keeps rendering styled without an
 * extension update, and the outcome is remembered for the next session.
 */
import type { PreviewAdapterStrategyLearner } from './previewAdapterStrategyLearner';
import {
  collectPreviewTailwindStrategyCandidates,
  type PreviewTailwindImplementation,
} from './previewTailwindImplementation';

/** Learning family; the suffix is the feature-schema version, bumped whenever features change. */
export const PREVIEW_TAILWIND_STRATEGY_FAMILY = 'tailwind/f1';
const FAMILY = PREVIEW_TAILWIND_STRATEGY_FAMILY;
const MAX_SELF_TESTS = 3;
const SELF_TEST_TIMEOUT_MS = 4_000;

/**
 * Loads the Tailwind implementation for one style root, verifying it when a learner is present.
 *
 * @param styleRoot Package directory that owns the stylesheet.
 * @param fallbackNodeModulesPaths Managed dependency roots tried after the project's packages.
 * @param configBoundaryRoot Workspace directory that configuration token modules must stay inside.
 * @param learner Optional persistent strategy learner; without it the version rules decide.
 * @returns Implementation to compile with, or `undefined` when no Tailwind compiler is installed.
 */
export async function selectPreviewTailwindImplementation(
  styleRoot: string,
  fallbackNodeModulesPaths: readonly string[],
  configBoundaryRoot: string,
  learner?: PreviewAdapterStrategyLearner,
): Promise<PreviewTailwindImplementation | undefined> {
  const candidates = collectPreviewTailwindStrategyCandidates(
    styleRoot,
    fallbackNodeModulesPaths,
    configBoundaryRoot,
  );
  const rulePick = candidates?.implementations[0];
  if (candidates === undefined || rulePick === undefined || learner === undefined) return rulePick;
  const { features, implementations, packageKey } = candidates;
  const strategyOf = (implementation: PreviewTailwindImplementation): string =>
    implementation.strategy ?? implementation.kind;
  const alternates = learner
    .rank(FAMILY, packageKey, features, implementations.slice(1).map(strategyOf))
    .map((strategy) => implementations.find((candidate) => strategyOf(candidate) === strategy));
  let tested = 0;
  for (const implementation of [rulePick, ...alternates]) {
    if (implementation === undefined) continue;
    const strategy = strategyOf(implementation);
    const known = learner.readOutcome(FAMILY, packageKey, strategy);
    if (known === true) return implementation;
    if (known === false || implementation.selfTest === undefined || tested >= MAX_SELF_TESTS) {
      continue;
    }
    tested += 1;
    const passed = await runBoundedSelfTest(implementation.selfTest.bind(implementation));
    if (passed === undefined) continue;
    learner.record(FAMILY, packageKey, features, strategy, passed);
    if (passed) return implementation;
  }
  return rulePick;
}

/** Runs one self-test; a throw is a failure, a timeout is no evidence. */
async function runBoundedSelfTest(selfTest: () => Promise<boolean>): Promise<boolean | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      resolve(undefined);
    }, SELF_TEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([selfTest().catch(() => false), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
