/** Builds reproducible numeric training data from owned React executions; no user files are read. */
import { buildSync } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createRecoveryCase, families, mergeSpecification, randomGenerator } from './corpus.mjs';
import { recoveryStages } from './causal-corpus.mjs';

const output = process.argv[2];
const trainingCount = Number(process.argv[3] ?? 1800);
if (
  !output ||
  !Number.isSafeInteger(trainingCount) ||
  trainingCount < 20 ||
  trainingCount > 10000
) {
  throw new Error(
    'Usage: node scripts/neural-recovery/build-corpus.mjs <output-directory> [20..10000 cases per family]',
  );
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const encoderPath =
  'src/adapters/esbuild/pageInspector/previewInspectorRecoveryPriorFeaturesRuntimeSource.ts';
const built = buildSync({
  absWorkingDir: root,
  entryPoints: [encoderPath],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});
const factory = { exports: {} };
vm.runInNewContext(built.outputFiles[0].text, { module: factory, exports: factory.exports });
const helpers = vm.runInNewContext(
  factory.exports.createPreviewInspectorRecoveryPriorFeaturesRuntimeSource() +
    '\n({ encode: encodePreviewInspectorRecoveryPriorFeatures, cost: estimatePreviewInspectorRecoveryPriorCost });',
);
const browserPath = resolve(output, 'browser-corpus.json');
const browser = existsSync(browserPath)
  ? JSON.parse(await readFile(browserPath, 'utf8'))
  : undefined;
const splits = {};
const evaluationCases = {};
const manifest = {
  format: 2,
  seed: 20260909,
  inputSize: 144,
  label: 'owned-target-output-without-exception-or-placeholder',
  cost: 'bounded structural reconstruction work units; not wall-clock labels',
  browserCases: browser?.manifest ?? null,
  limitations:
    'Owned structural suites plus optional isolated browser outcomes; not independent real user projects or calibrated probabilities.',
  encoderSha256: createHash('sha256')
    .update(await readFile(resolve(root, encoderPath)))
    .digest('hex'),
  contextEncoderSha256: createHash('sha256')
    .update(
      await readFile(
        resolve(
          root,
          'src/adapters/esbuild/pageInspector/previewInspectorRecoveryPriorContextRuntimeSource.ts',
        ),
      ),
    )
    .digest('hex'),
  browserCorpusSha256:
    browser === undefined
      ? null
      : createHash('sha256')
          .update(await readFile(browserPath))
          .digest('hex'),
  corpusSha256: createHash('sha256')
    .update(await readFile(new URL('./corpus.mjs', import.meta.url)))
    .update(await readFile(new URL('./causal-corpus.mjs', import.meta.url)))
    .digest('hex'),
  splits: {},
};
const featureSets = [];
for (const [template, name] of ['train', 'validation', 'test'].entries()) {
  const random = randomGenerator(manifest.seed + template * 1000003);
  const count = template === 0 ? trainingCount : Math.max(20, Math.floor(trainingCount / 4));
  const rows = [];
  const cases = [];
  const fingerprints = new Set();
  const observations = { positive: 0, negative: 0, exceptions: 0, originalExceptions: 0 };
  const experiments = [];
  for (const family of families) {
    for (let index = 0; index < count; index += 1) {
      experiments.push(createRecoveryCase(family, random, template, index));
    }
  }
  experiments.push(...(browser?.splits?.[name] ?? []));
  for (const [index, original] of experiments.entries()) {
    for (const [stage, experiment] of recoveryStages(original).entries()) {
      const family = experiment.family;
      if (experiment.initial?.error) observations.originalExceptions++;
      const group = family + ':' + index + ':' + stage;
      cases.push({ ...experiment, group, stage });
      for (const candidate of experiment.candidates) {
        const specification = mergeSpecification(experiment.specification, candidate);
        const features = helpers.encode(specification);
        if (features === undefined || features.length !== manifest.inputSize)
          throw new Error('Unsupported corpus candidate: ' + family);
        const label = candidate.observation.label;
        rows.push({
          features: Array.from(features),
          label,
          family,
          group,
          stage,
          cost: helpers.cost(specification),
          suite: experiment.suite ?? family,
          rank: candidate.deterministicRank,
        });
        fingerprints.add(createHash('sha256').update(Buffer.from(features.buffer)).digest('hex'));
        observations[label === 1 ? 'positive' : 'negative']++;
        if (candidate.observation.error) observations.exceptions++;
      }
    }
  }
  featureSets.push(fingerprints);
  manifest.splits[name] = {
    cases: cases.length,
    baseCases: experiments.length,
    retryCases: cases.length - experiments.length,
    rows: rows.length,
    uniqueFeatureVectors: fingerprints.size,
    observations,
  };
  splits[name] = rows;
  if (name !== 'train') evaluationCases[name] = cases;
}
manifest.crossSplitFeatureOverlaps = {
  trainValidation: [...featureSets[0]].filter((key) => featureSets[1].has(key)).length,
  trainTest: [...featureSets[0]].filter((key) => featureSets[2].has(key)).length,
  validationTest: [...featureSets[1]].filter((key) => featureSets[2].has(key)).length,
};
if (Object.values(manifest.crossSplitFeatureOverlaps).some((count) => count > 0)) {
  throw new Error('Training and holdout feature vectors overlap; fix the split before training.');
}
await mkdir(resolve(output), { recursive: true });
await writeFile(resolve(output, 'corpus.json'), JSON.stringify({ manifest, splits }));
await writeFile(resolve(output, 'corpus-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(resolve(output, 'evaluation-cases.json'), JSON.stringify(evaluationCases));
console.log(JSON.stringify(manifest, null, 2));
