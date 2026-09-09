/** Replays identical owned outcomes through v2, pre-change v1 and the online-only production runtime. */
import { buildSync } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { mergeSpecification } from './corpus.mjs';

const directory = process.argv[2];
const baselinePath = process.argv[3];
if (!directory || !baselinePath)
  throw new Error(
    'Usage: node scripts/neural-recovery/verify-runtime.mjs <trained-directory> <baseline-runtime.json>',
  );
const root = fileURLToPath(new URL('../../', import.meta.url));
const prefix = './src/adapters/esbuild/pageInspector/';
const built = buildSync({
  stdin: {
    contents: `export { createPreviewInspectorNeuralResidualRuntimeSource } from '${prefix}previewInspectorNeuralResidualRuntimeSource';
   export { previewInspectorRecoveryPriorArtifact } from '${prefix}previewInspectorRecoveryPriorArtifact';`,
    resolveDir: root,
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});
const factory = { exports: {} };
vm.runInNewContext(built.outputFiles[0].text, { module: factory, exports: factory.exports });
const source = factory.exports.createPreviewInspectorNeuralResidualRuntimeSource();
const artifact = factory.exports.previewInspectorRecoveryPriorArtifact;
const baselineSource = JSON.parse(await readFile(resolve(baselinePath), 'utf8')).source;
const manifest = JSON.parse(await readFile(resolve(directory, 'corpus-manifest.json'), 'utf8'));
const training = JSON.parse(await readFile(resolve(directory, 'training-report.json'), 'utf8'));
const experiments = JSON.parse(
  await readFile(resolve(directory, 'evaluation-cases.json'), 'utf8'),
).test;

/** Creates a profile-free production runtime; models get the same independent observed labels. */
function createRuntime(runtimeSource = source, enabled = true) {
  return vm.runInNewContext(`
    const previewEntryRevision = 1;
    const previewInspectorSession = {};
    ${runtimeSource}
    ${enabled ? '' : 'rankPreviewInspectorRecoveryPrior = () => undefined;'}
    ({
      begin: (key, cold = false) => {
        previewInspectorSession.activeTargetReachabilityKey = key;
        previewInspectorSession.neuralAssistanceExplorationPolicy = undefined;
        if (cold) previewInspectorSession.neuralResidualModel = createPreviewInspectorNeuralResidualModel();
      },
      exclude: (ids) => { previewInspectorSession.neuralAssistanceExplorationPolicy = {
        origin: 'user-neural', mode: 'alternate', excludedCandidateIds: ids,
      }; },
      infer: (features) => runPreviewInspectorRecoveryPrior(new Float32Array(features), readPreviewInspectorRecoveryPriorNetwork()),
      cost: typeof estimatePreviewInspectorRecoveryPriorCost === 'function' ? estimatePreviewInspectorRecoveryPriorCost : undefined,
      select: selectPreviewInspectorNeuralResidualCandidate,
      train: trainPreviewInspectorNeuralResidualDecision,
      model: serializePreviewInspectorNeuralResidualModel,
      cache: () => previewInspectorRecoveryPriorScores.size,
    });
  `);
}

const cold = createRuntime();
const oldCold = createRuntime(baselineSource);
const parityVectors = JSON.parse(await readFile(resolve(directory, 'runtime-parity.json'), 'utf8'));
let parityError = 0;
for (const row of parityVectors)
  parityError = Math.max(parityError, Math.abs(cold.infer(row.features) - row.score));
if (parityError > 0.00005) throw new Error('Runtime arithmetic mismatch: ' + parityError);
const artifactSha = createHash('sha256')
  .update(Buffer.from(artifact.weights, 'base64'))
  .digest('hex');
if (artifactSha !== training.artifact.weightsSha256)
  throw new Error('Runtime artifact differs from evaluated weights.');
const runtimes = {
  v2: createRuntime(),
  v1: createRuntime(baselineSource),
  online: createRuntime(source, false),
};

/** Allocates counters without conflating estimated structural work with measured policy time. */
function counters() {
  return { first: 0, solved: 0, solvedWithinThree: 0, attempts: 0, workUnits: 0, policyMs: 0 };
}
const results = {
  coldFirst: 0,
  v1ColdFirst: 0,
  baselineFirst: 0,
  priorApplied: 0,
  coldAttempts: 0,
  coldCost: 0,
  v1ColdCost: 0,
  v2: counters(),
  v1: counters(),
  online: counters(),
  families: {},
  suites: {},
};

/** Replays selected alternatives; only executed, verified labels teach the unchanged v4 learner. */
function recover(runtime, experiment, key) {
  runtime.begin(key);
  const excluded = [];
  const result = counters();
  const started = performance.now();
  for (let index = 0; index < experiment.candidates.length; index += 1) {
    runtime.exclude(excluded);
    const selected = runtime.select(experiment.specification, experiment.candidates);
    const candidate = experiment.candidates.find((item) => item.id === selected?.candidateId);
    if (candidate === undefined || excluded.includes(candidate.id))
      throw new Error('A verified/excluded candidate was repeated.');
    excluded.push(candidate.id);
    result.workUnits += cold.cost(mergeSpecification(experiment.specification, candidate));
    runtime.train(selected.decision, candidate.observation.label, 1);
    if (candidate.observation.label === 1) {
      result.solved = 1;
      result.first = Number(index === 0);
      result.solvedWithinThree = Number(index < 3);
      break;
    }
  }
  result.attempts = excluded.length;
  result.policyMs = performance.now() - started;
  return result;
}

/** Accumulates replay work until the first true output, including unsolved portfolios. */
function workUntilOutput(order, experiment) {
  let work = 0;
  for (const candidate of order) {
    work += cold.cost(mergeSpecification(experiment.specification, candidate));
    if (candidate.observation.label) break;
  }
  return work;
}

for (const [index, experiment] of experiments.entries()) {
  const key = experiment.group;
  experiment.specification.texts = ['owned-fixture/' + key + '.tsx'];
  const baseline = [...experiment.candidates].sort(
    (left, right) => left.deterministicRank - right.deterministicRank,
  );
  cold.begin(key, true);
  oldCold.begin(key, true);
  const chosen = cold.select(experiment.specification, experiment.candidates);
  const oldChosen = oldCold.select(experiment.specification, experiment.candidates);
  const selected = experiment.candidates.find((candidate) => candidate.id === chosen?.candidateId);
  const oldSelected = experiment.candidates.find(
    (candidate) => candidate.id === oldChosen?.candidateId,
  );
  if (!selected || !oldSelected) throw new Error('Runtime did not return an admitted candidate.');
  const order = [selected, ...baseline.filter((candidate) => candidate !== selected)];
  const oldOrder = [oldSelected, ...baseline.filter((candidate) => candidate !== oldSelected)];
  const success = order.findIndex((candidate) => candidate.observation.label === 1);
  if (success >= 0) results.coldAttempts += success + 1;
  results.coldCost += workUntilOutput(order, experiment);
  results.v1ColdCost += workUntilOutput(oldOrder, experiment);
  results.coldFirst += selected.observation.label;
  results.v1ColdFirst += oldSelected.observation.label;
  results.baselineFirst += baseline[0].observation.label;
  results.priorApplied += Number(chosen.decision.priorScore !== undefined);
  const perCase = {
    cases: 1,
    v2Cold: selected.observation.label,
    v1Cold: oldSelected.observation.label,
    baseline: baseline[0].observation.label,
    v2First: 0,
    v1First: 0,
    onlineFirst: 0,
  };
  const names = index % 2 ? ['v1', 'online', 'v2'] : ['v2', 'online', 'v1'];
  for (const name of names) {
    const result = recover(runtimes[name], experiment, key);
    for (const [metric, value] of Object.entries(result)) results[name][metric] += value;
    perCase[name + 'First'] = result.first;
  }
  for (const [collection, group] of [
    [results.families, experiment.family],
    [results.suites, experiment.suite ?? experiment.family],
  ]) {
    collection[group] ??= {};
    for (const [metric, value] of Object.entries(perCase))
      collection[group][metric] = (collection[group][metric] ?? 0) + value;
  }
  if (index % 2000 === 0)
    console.log(JSON.stringify({ casesReplayed: index, total: experiments.length }));
}

if (
  results.coldFirst !== training.test.modelFirst ||
  results.baselineFirst !== training.test.baselineFirst ||
  results.priorApplied !== training.test.priorApplied ||
  results.coldAttempts !== training.test.modelAttempts ||
  Math.abs(results.coldCost - training.test.modelCost) > 0.001
)
  throw new Error('Production cold ordering/cost differs from held-out evaluation.');
if (
  results.coldFirst < results.v1ColdFirst ||
  results.v2.solved !== results.v1.solved ||
  results.v2.solved !== results.online.solved ||
  results.v2.attempts > results.v1.attempts ||
  results.v2.attempts > results.online.attempts ||
  results.v2.workUnits > results.v1.workUnits ||
  Object.values(results.families).some((family) => family.v2Cold < family.v1Cold)
)
  throw new Error('V2 regresses previous/online policy on the same corpus; do not package.');

const sample = experiments.find(
  (experiment) => experiment.family === 'page-choice' && experiment.candidates.length >= 3,
);
const timings = {};
for (const [name, runtimeSource] of [
  ['v2', source],
  ['v1', baselineSource],
]) {
  const timing = createRuntime(runtimeSource);
  const start = performance.now();
  timing.select(sample.specification, sample.candidates);
  const durations = [];
  const firstMs = performance.now() - start;
  for (let index = 0; index < 500; index += 1) {
    const started = performance.now();
    timing.select(sample.specification, sample.candidates);
    durations.push(performance.now() - started);
  }
  durations.sort((left, right) => left - right);
  timings[name] = {
    firstMs,
    repeatedP50Ms: durations[250],
    repeatedP95Ms: durations[475],
    cacheEntries: timing.cache(),
  };
}
const result = {
  artifact: { id: artifact.id, parameters: artifact.parameters, sha256: artifactSha },
  cases: manifest.splits.test,
  parityVectors: parityVectors.length,
  maxParityError: parityError,
  timings,
  preservedModelVersion: runtimes.v2.model().version,
  results,
  limitations:
    'Owned observed-label replay, not end-to-end rerender timing or independent real user projects.',
};
await writeFile(
  resolve(directory, 'runtime-validation.json'),
  JSON.stringify(result, null, 2) + '\n',
);
console.log(JSON.stringify(result, null, 2));
