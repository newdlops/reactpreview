/** Measures generated neural ranking with a deterministic, fully populated retained model. */
import { buildSync } from 'esbuild';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const iterations = Number(process.argv[2] ?? 100);
if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 1000) {
  throw new Error('Iterations must be an integer between 1 and 1000.');
}
const built = buildSync({
  absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
  entryPoints: [
    'src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource.ts',
  ],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});
const factory = { exports: {} };
vm.runInNewContext(built.outputFiles[0].text, { module: factory, exports: factory.exports });
const source = factory.exports.createPreviewInspectorNeuralResidualRuntimeSource();
const context = vm.createContext({});
vm.runInContext(
  `
  const previewEntryRevision = 1;
  const previewInspectorSession = {};
  ${source}
  const model = createPreviewInspectorNeuralResidualModel();
  for (const key of PREVIEW_INSPECTOR_NEURAL_RESIDUAL_HEAD_KEYS) {
    model.heads[key] = {
      evidence: 100, outputBias: 0.1, outputWeights: Array(16).fill(0.05), updates: 100,
    };
  }
  model.updates = 1000;
  for (let index = 0; index < 192; index++) {
    const family = PREVIEW_INSPECTOR_NEURAL_RESIDUAL_HEAD_KEYS[index % 10];
    model.candidateOutcomes[family + ':' + index.toString(16).padStart(8, '0')] = {
      attempts: 3, consecutiveFailures: 0, evidence: 2.5, lastConfidence: 0.85,
      lastLabel: 1, rewardSum: 2.5, sequence: index + 1,
    };
  }
  model.outcomeSequence = 192;
  previewInspectorSession.neuralResidualModel = model;
  const specification = {
    blockerKind: 'runtime-fallback', holeKind: 'rendered-collection-consumer-data',
    numbers: { requiredPathCount: 16, rowCount: 24 },
    texts: ['Collection.filter(candidate).map(renderRow)', 'Table', '/fixture/Table.tsx'],
    tokens: ['compiler-call-result-candidate', 'role:collection-filter-predicate'],
  };
  const candidates = Array.from({ length: 12 }, (_, index) => ({
    id: 'candidate-' + index, deterministicRank: index,
    tokens: ['strategy:typed-row-' + index], numbers: { rowCount: index + 1 },
  }));
  globalThis.benchmark = (iterations) => {
    let last;
    for (let index = 0; index < iterations; index++) {
      last = selectPreviewInspectorNeuralResidualCandidate(specification, candidates);
    }
    return last;
  };
  globalThis.countValidation = () => {
    const normalizeHead = normalizePreviewInspectorNeuralResidualHead;
    const normalizeOutcome = normalizePreviewInspectorNeuralResidualOutcome;
    let heads = 0, outcomes = 0;
    normalizePreviewInspectorNeuralResidualHead = (...args) => { heads++; return normalizeHead(...args); };
    normalizePreviewInspectorNeuralResidualOutcome = (...args) => { outcomes++; return normalizeOutcome(...args); };
    try {
      benchmark(1);
      return { heads, outcomes };
    } finally {
      normalizePreviewInspectorNeuralResidualHead = normalizeHead;
      normalizePreviewInspectorNeuralResidualOutcome = normalizeOutcome;
    }
  };
`,
  context,
);
context.benchmark(20);
const durationsMs = [];
const cpuMs = [];
let result;
for (let sample = 0; sample < 5; sample++) {
  const cpu = process.cpuUsage();
  const started = performance.now();
  result = context.benchmark(iterations);
  durationsMs.push(performance.now() - started);
  const used = process.cpuUsage(cpu);
  cpuMs.push((used.user + used.system) / 1000);
}

/** Returns the middle measured sample without changing the recorded observation order. */
function median(items) {
  return [...items].sort((left, right) => left - right)[Math.floor(items.length / 2)];
}

console.log(
  JSON.stringify(
    {
      iterations,
      candidatesPerDecision: 12,
      retainedOutcomes: 192,
      durationsMs,
      medianMs: median(durationsMs),
      medianCpuMs: median(cpuMs),
      validationPerSelection: context.countValidation(),
      resultHash: createHash('sha256').update(JSON.stringify(result)).digest('hex'),
      sourceHash: createHash('sha256').update(source).digest('hex'),
    },
    null,
    2,
  ),
);
